/**
 * Renders a real mix from synthetic tracks with known, deliberately mismatched
 * tempos, then measures the finished audio to prove the blends land on the beat.
 *
 * Two aligned click tracks produce one onset per beat through the overlap. Two
 * misaligned ones produce a pair of onsets a fraction of a beat apart, which is
 * exactly the flam a bad transition sounds like — so the smallest gap between
 * onsets during a blend is the measurement that matters.
 *
 * Kept as a script because it needs a real ffmpeg.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { analyzeAudioFile, internals } from '../server/lib/analyze.js';
import { decodeMonoPcm, ffmpeg, transcodeToFlac } from '../server/lib/ffmpeg.js';
import { generateMixPlan } from '../src/lib/mixEngine.js';
import { ensureDirs, paths } from '../server/lib/paths.js';
import { renderMix } from '../server/lib/render.js';
import type { TrackInput } from '../src/types.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mixr-beat-'));
const ONSET_HOP = 512;

/**
 * A kick on every beat plus a sustained tone, so tempo and key both read
 * cleanly. Deliberately nothing offbeat: every onset in the finished mix should
 * then be a beat, which is what makes the measurement below unambiguous.
 */
async function generate(name: string, bpm: number, seconds: number, pitch: number): Promise<string> {
  const period = 60 / bpm;
  const expression = `0.9*sin(2*PI*70*t)*exp(-26*mod(t,${period}))` + `+0.25*sin(2*PI*${pitch}*t)`;

  const wav = path.join(dir, `${name}.wav`);
  await ffmpeg(['-v', 'error', '-y', '-f', 'lavfi', '-i', `aevalsrc='${expression}':d=${seconds}:s=44100`, wav]);

  const flac = path.join(dir, `${name}.flac`);
  await transcodeToFlac(wav, flac);
  return flac;
}

/** Onset times in a stretch of audio, spaced far enough apart to be distinct hits. */
function onsetsBetween(samples: Float32Array, sampleRate: number, fromSecond: number, toSecond: number): number[] {
  const envelope = internals.onsetEnvelope(samples);
  const frameRate = sampleRate / ONSET_HOP;

  let peak = 0;
  for (const value of envelope) peak = Math.max(peak, value);
  const threshold = peak * 0.25;

  const onsets: number[] = [];
  for (let frame = 1; frame < envelope.length - 1; frame += 1) {
    const second = (frame + 1) / frameRate;
    if (second < fromSecond || second > toSecond) continue;
    if (envelope[frame] < threshold) continue;
    if (envelope[frame] < envelope[frame - 1] || envelope[frame] < envelope[frame + 1]) continue;
    // Merge the tail of a hit into the hit itself.
    if (onsets.length > 0 && second - onsets[onsets.length - 1] < 0.05) continue;
    onsets.push(second);
  }
  return onsets;
}

async function main() {
  ensureDirs();

  let failures = 0;
  const check = (label: string, actual: string, passed: boolean) => {
    console.log(`  ${passed ? 'ok  ' : 'FAIL'}  ${label.padEnd(30)} ${actual}`);
    if (!passed) failures += 1;
  };

  console.log('\nbeat match check\n');

  const sources = [
    { id: 'a', bpm: 124, pitch: 220 },
    { id: 'b', bpm: 128, pitch: 261.63 },
    { id: 'c', bpm: 122, pitch: 196 },
  ];

  const tracks: TrackInput[] = [];
  const mediaPaths = new Map<string, string>();

  for (const source of sources) {
    const file = await generate(source.id, source.bpm, 120, source.pitch);
    const analysis = await analyzeAudioFile(file);
    mediaPaths.set(source.id, file);
    tracks.push({ id: source.id, title: `Track ${source.id.toUpperCase()}`, provider: 'local', analysis });

    check(
      `${source.bpm} BPM analysed`,
      `bpm=${analysis.bpm} beats=${analysis.beatTimes?.length ?? 0}`,
      Math.abs(analysis.bpm - source.bpm) < 1 && (analysis.beatTimes?.length ?? 0) > 200,
    );
  }

  const plan = generateMixPlan({ title: 'Beat Match Check', tracks, vibe: 'House' });
  console.log('');
  for (const planned of plan.tracks) {
    console.log(
      `    ${planned.title.padEnd(10)} ${String(planned.bpm).padStart(6)} BPM  ` +
        `rate ${(planned.tempoRatio ?? 1).toFixed(4)}  ` +
        `window ${planned.startOffsetSeconds.toFixed(3)}→${planned.endOffsetSeconds.toFixed(3)}  ` +
        `xfade ${(planned.transitionOut?.lengthSeconds ?? 0).toFixed(3)}s`,
    );
  }
  for (const warning of plan.warnings) console.log(`    warning: ${warning}`);
  console.log('');

  const stretched = plan.tracks.filter((track) => (track.tempoRatio ?? 1) !== 1).length;
  check('tempo matching applied', `${stretched} of ${plan.tracks.length} tracks stretched`, stretched >= 2);

  const rendered = await renderMix({ plan, mediaPaths });
  check(
    'render produced audio',
    `${(rendered.sizeBytes / 1_048_576).toFixed(1)} MB, ${rendered.durationSeconds.toFixed(1)}s`,
    rendered.sizeBytes > 100_000,
  );

  const { samples, sampleRate } = await decodeMonoPcm(rendered.absolutePath);

  // Every blend, measured on the finished mix.
  for (let index = 0; index < plan.tracks.length - 1; index += 1) {
    const outgoing = plan.tracks[index];
    const overlap = outgoing.transitionOut?.lengthSeconds ?? 0;
    if (overlap <= 0) continue;

    const blendStart = (plan.tracks[index + 1].mixStartSeconds ?? 0) + 0.2;
    const onsets = onsetsBetween(samples, sampleRate, blendStart, blendStart + overlap - 0.2);

    const gaps: number[] = [];
    for (let step = 1; step < onsets.length; step += 1) gaps.push(onsets[step] - onsets[step - 1]);
    const sorted = [...gaps].sort((left, right) => left - right);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 0;

    // Two aligned tracks hit together, so the pulse through the blend stays
    // evenly spaced. A misaligned pair splits every hit into a close-together
    // pair, which shows up as a gap that is a fraction of a beat. A gap of two
    // whole beats is only a hit the detector missed under the fade.
    let worst = 0;
    for (const gap of gaps) {
      const beats = Math.max(1, Math.round(gap / median));
      worst = Math.max(worst, Math.abs(gap - beats * median));
    }

    const period = 60 / (outgoing.bpm * (outgoing.tempoRatio ?? 1));
    check(
      `blend ${index + 1} stays on the beat`,
      `${onsets.length} onsets every ${(median * 1000).toFixed(0)}ms ` +
        `(beat ${(period * 1000).toFixed(0)}ms), worst ${(worst * 1000).toFixed(0)}ms off`,
      onsets.length >= 6 && worst < median * 0.2,
    );
    if (worst >= median * 0.2) {
      console.log(`          gaps: ${gaps.map((gap) => Math.round(gap * 1000)).join(' ')}`);
    }
  }

  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(rendered.absolutePath, { force: true });

  console.log(failures === 0 ? '\nBlends are beat-matched.\n' : `\n${failures} check(s) failed.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

void main().catch((error) => {
  fs.rmSync(dir, { recursive: true, force: true });
  console.error(`\nFAILED: ${error instanceof Error ? error.message : String(error)}\n`);
  console.error(`  renders live in ${paths.renders}`);
  process.exit(1);
});

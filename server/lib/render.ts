import fs from 'node:fs';
import path from 'node:path';
import type { MixPlan, Vibe } from '../../src/types.js';
import { crossfadeCurveFor, eqFiltersFor, TARGET_LUFS, vibeProfiles } from '../../src/lib/mixEngine.js';
import { ffmpeg, measureLoudness } from './ffmpeg.js';
import { paths } from './paths.js';

export interface RenderSegment {
  mediaPath: string;
  startOffsetSeconds: number;
  playDurationSeconds: number;
  gainDb: number;
  /** Crossfade into the *next* segment, in seconds. */
  transitionOutSeconds: number;
}

export interface MixFilterGraph {
  inputArgs: string[];
  filterComplex: string;
  outputLabel: string;
}

/**
 * Builds the ffmpeg graph for a mix: one trimmed, level-matched, EQ'd input per
 * track, chained together with acrossfade so each blend overlaps the previous
 * output with the next track.
 *
 * Pure and synchronous so the graph can be unit tested without running ffmpeg.
 */
export function buildMixFilterGraph(
  segments: RenderSegment[],
  vibe: Vibe,
  masterFilters: string[] = [],
): MixFilterGraph {
  if (segments.length === 0) throw new Error('A mix needs at least one track.');

  const inputArgs: string[] = [];
  const chains: string[] = [];
  const eq = eqFiltersFor(vibe);
  const curve = crossfadeCurveFor(vibeProfiles[vibe].transitionStyle);

  segments.forEach((segment, index) => {
    // Seeking before -i is the fast path, and it is sample accurate for the
    // FLAC intermediates we always render from.
    inputArgs.push(
      '-ss', segment.startOffsetSeconds.toFixed(3),
      '-t', segment.playDurationSeconds.toFixed(3),
      '-i', segment.mediaPath,
    );

    const stages = [
      'aresample=44100:resampler=soxr',
      'aformat=sample_fmts=fltp:channel_layouts=stereo',
    ];
    if (segment.gainDb !== 0) stages.push(`volume=${segment.gainDb.toFixed(2)}dB`);
    stages.push(...eq);
    // A short fade at the very edges prevents clicks where a cut lands mid-waveform.
    stages.push('afade=t=in:st=0:d=0.02');

    chains.push(`[${index}:a]${stages.join(',')}[a${index}]`);
  });

  let current = '[a0]';
  for (let index = 1; index < segments.length; index += 1) {
    const overlap = segments[index - 1].transitionOutSeconds;
    const label = `[x${index}]`;

    if (overlap <= 0) {
      chains.push(`${current}[a${index}]concat=n=2:v=0:a=1${label}`);
    } else {
      chains.push(
        `${current}[a${index}]acrossfade=d=${overlap.toFixed(3)}:c1=${curve}:c2=${curve}${label}`,
      );
    }
    current = label;
  }

  // The master chain has to live inside the complex graph: ffmpeg refuses to mix
  // simple (-af) and complex filtering on the same output stream.
  if (masterFilters.length > 0) {
    chains.push(`${current}${masterFilters.join(',')}[mix]`);
    current = '[mix]';
  }

  return { inputArgs, filterComplex: chains.join(';'), outputLabel: current };
}

/** ffmpeg metadata file describing one chapter per track, for players that show them. */
export function buildChapterMetadata(plan: MixPlan): string {
  const lines = [';FFMETADATA1', `title=${escapeMetadata(plan.title)}`, 'artist=mixR', `genre=${escapeMetadata(plan.vibe)}`];

  let cursor = 0;
  plan.tracks.forEach((track, index) => {
    const start = Math.round((track.mixStartSeconds ?? cursor) * 1000);
    const outgoing = track.transitionOut?.lengthSeconds ?? 0;
    cursor += track.playDurationSeconds - outgoing;
    const nextStart = index === plan.tracks.length - 1
      ? Math.round(plan.totalDurationSeconds * 1000)
      : Math.round((plan.tracks[index + 1].mixStartSeconds ?? cursor) * 1000);

    // A zero-length chapter is rejected by ffmpeg, so always advance by at least 1 ms.
    const end = Math.max(start + 1, nextStart);
    lines.push('', '[CHAPTER]', 'TIMEBASE=1/1000', `START=${start}`, `END=${end}`, `title=${escapeMetadata(track.title)}`);
  });

  return `${lines.join('\n')}\n`;
}

function escapeMetadata(value: string): string {
  return value.replace(/([=;#\\\n])/g, '\\$1');
}

export interface RenderOptions {
  plan: MixPlan;
  /** Absolute path to the canonical FLAC for each plan track, keyed by track id. */
  mediaPaths: Map<string, string>;
  onProgress?: (update: { fraction: number; detail: string }) => void;
  signal?: AbortSignal;
}

export interface RenderResult {
  file: string;
  absolutePath: string;
  durationSeconds: number;
  sizeBytes: number;
  integratedLufs: number;
}

/**
 * Renders the plan to a 320 kbps MP3.
 *
 * Two passes on purpose: the heavy filter graph produces a lossless
 * intermediate, then a cheap second pass applies one static gain to hit the
 * loudness target. Doing it with a single dynamic loudnorm would pump the whole
 * mix, which is exactly what a DJ set must not do.
 */
export async function renderMix(options: RenderOptions): Promise<RenderResult> {
  const { plan, mediaPaths, onProgress, signal } = options;
  if (plan.tracks.length === 0) throw new Error('That mix has no tracks to render.');

  const segments: RenderSegment[] = plan.tracks.map((track) => {
    const mediaPath = mediaPaths.get(track.trackId);
    if (!mediaPath) throw new Error(`Missing audio for "${track.title}".`);
    if (!fs.existsSync(mediaPath)) throw new Error(`The audio for "${track.title}" is no longer on disk.`);

    return {
      mediaPath,
      startOffsetSeconds: track.startOffsetSeconds,
      playDurationSeconds: track.playDurationSeconds,
      gainDb: track.gainDb ?? 0,
      transitionOutSeconds: track.transitionOut?.lengthSeconds ?? 0,
    };
  });

  fs.mkdirSync(paths.renders, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const slug = plan.title.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 48) || 'mix';
  const baseName = `${slug}-${stamp}`;

  const intermediate = path.join(paths.tmp, `${baseName}.flac`);
  const metadataFile = path.join(paths.tmp, `${baseName}.ffmeta`);
  const finalName = `${baseName}.mp3`;
  const finalPath = path.join(paths.renders, finalName);

  const expectedSeconds = Math.max(1, plan.totalDurationSeconds);
  // Catch any inter-sample peaks the blends introduce before they clip.
  const graph = buildMixFilterGraph(segments, plan.vibe, ['alimiter=limit=0.977:level=false']);

  try {
    // Pass one: build the mix losslessly.
    await ffmpeg(
      [
        '-v', 'error',
        '-y',
        ...graph.inputArgs,
        '-filter_complex', graph.filterComplex,
        '-map', graph.outputLabel,
        '-ar', '44100',
        '-ac', '2',
        '-sample_fmt', 's16',
        '-compression_level', '4',
        '-progress', 'pipe:1',
        intermediate,
      ],
      {
        timeoutMs: 60 * 60_000,
        signal,
        onStdout: (chunk) => {
          for (const match of chunk.matchAll(/out_time_us=(\d+)/g)) {
            const seconds = Number(match[1]) / 1_000_000;
            if (!Number.isFinite(seconds)) continue;
            onProgress?.({
              fraction: Math.min(0.9, seconds / expectedSeconds) * 0.85,
              detail: `Blending ${formatClock(seconds)} of ${formatClock(expectedSeconds)}`,
            });
          }
        },
      },
    );

    onProgress?.({ fraction: 0.88, detail: 'Measuring loudness' });
    const measured = await measureLoudness(intermediate);
    const correction = Number.isFinite(measured.integratedLufs)
      ? Math.max(-12, Math.min(12, TARGET_LUFS - measured.integratedLufs))
      : 0;

    fs.writeFileSync(metadataFile, buildChapterMetadata(plan), 'utf8');

    onProgress?.({ fraction: 0.92, detail: 'Encoding MP3' });

    // Pass two: one static gain, a safety limiter, then the MP3 encode.
    const masterFilters = [
      ...(Math.abs(correction) > 0.05 ? [`volume=${correction.toFixed(2)}dB`] : []),
      'alimiter=limit=0.977:level=false',
    ];

    await ffmpeg(
      [
        '-v', 'error',
        '-y',
        '-i', intermediate,
        '-i', metadataFile,
        '-map', '0:a',
        '-map_metadata', '1',
        '-af', masterFilters.join(','),
        '-c:a', 'libmp3lame',
        '-b:a', '320k',
        '-id3v2_version', '3',
        '-write_id3v1', '1',
        '-progress', 'pipe:1',
        finalPath,
      ],
      {
        timeoutMs: 30 * 60_000,
        signal,
        onStdout: (chunk) => {
          for (const match of chunk.matchAll(/out_time_us=(\d+)/g)) {
            const seconds = Number(match[1]) / 1_000_000;
            if (!Number.isFinite(seconds)) continue;
            onProgress?.({
              fraction: 0.92 + Math.min(1, seconds / expectedSeconds) * 0.08,
              detail: 'Encoding MP3',
            });
          }
        },
      },
    );

    const stats = fs.statSync(finalPath);
    return {
      file: finalName,
      absolutePath: finalPath,
      durationSeconds: expectedSeconds,
      sizeBytes: stats.size,
      integratedLufs: Math.round((measured.integratedLufs + correction) * 10) / 10,
    };
  } catch (error) {
    fs.rmSync(finalPath, { force: true });
    throw error;
  } finally {
    fs.rmSync(intermediate, { force: true });
    fs.rmSync(metadataFile, { force: true });
  }
}

function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  return `${minutes}:${(total % 60).toString().padStart(2, '0')}`;
}

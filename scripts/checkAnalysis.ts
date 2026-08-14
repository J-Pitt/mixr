/**
 * Generates synthetic audio with a known tempo and key, then checks that the
 * analyzer recovers them. Kept as a script because it needs a real ffmpeg.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { analyzeAudioFile } from '../server/lib/analyze.js';
import { ffmpeg } from '../server/lib/ffmpeg.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mixr-check-'));

async function generate(name: string, expression: string, seconds: number): Promise<string> {
  const target = path.join(dir, name);
  await ffmpeg(['-v', 'error', '-y', '-f', 'lavfi', '-i', `aevalsrc='${expression}':d=${seconds}:s=44100`, target]);
  return target;
}

async function main() {
  let failures = 0;
  const check = (label: string, actual: string, passed: boolean) => {
    console.log(`  ${passed ? 'ok  ' : 'FAIL'}  ${label.padEnd(22)} ${actual}`);
    if (!passed) failures += 1;
  };

  console.log('\nanalysis check\n');

  // Clicks every 0.46875s = exactly 128 BPM, with a decaying envelope so each
  // click reads as a distinct onset.
  const beatPeriod = 60 / 128;
  const clickFile = await generate('click.wav', `0.9*sin(2*PI*900*t)*exp(-45*mod(t,${beatPeriod}))`, 40);
  const clickAnalysis = await analyzeAudioFile(clickFile);
  check('128 BPM click', `bpm=${clickAnalysis.bpm} confidence=${clickAnalysis.bpmConfidence}`, Math.abs(clickAnalysis.bpm - 128) <= 1.5);

  // 90 BPM to prove it is not simply anchored near 120.
  const slowPeriod = 60 / 90;
  const slowFile = await generate('slow.wav', `0.9*sin(2*PI*900*t)*exp(-45*mod(t,${slowPeriod}))`, 40);
  const slowAnalysis = await analyzeAudioFile(slowFile);
  check('90 BPM click', `bpm=${slowAnalysis.bpm} confidence=${slowAnalysis.bpmConfidence}`, Math.abs(slowAnalysis.bpm - 90) <= 1.5);

  // C major triad: C4 + E4 + G4.
  const cMajor = await generate('cmajor.wav', '0.3*sin(2*PI*261.63*t)+0.3*sin(2*PI*329.63*t)+0.3*sin(2*PI*392.00*t)', 20);
  const cMajorAnalysis = await analyzeAudioFile(cMajor);
  check('C major triad', `key=${cMajorAnalysis.key} confidence=${cMajorAnalysis.keyConfidence}`, cMajorAnalysis.key === 'C');

  // A minor triad: A3 + C4 + E4.
  const aMinor = await generate('aminor.wav', '0.3*sin(2*PI*220.00*t)+0.3*sin(2*PI*261.63*t)+0.3*sin(2*PI*329.63*t)', 20);
  const aMinorAnalysis = await analyzeAudioFile(aMinor);
  check('A minor triad', `key=${aMinorAnalysis.key} confidence=${aMinorAnalysis.keyConfidence}`, aMinorAnalysis.key === 'Am');

  const duration = Math.abs(clickAnalysis.durationSeconds - 40);
  check('duration accuracy', `${clickAnalysis.durationSeconds}s for a 40s file`, duration < 0.2);
  check('slice count', `${clickAnalysis.slices.length} slices`, clickAnalysis.slices.length === 40);
  check(
    'beat phase',
    `offset=${clickAnalysis.beatOffsetSeconds}s`,
    clickAnalysis.beatOffsetSeconds >= 0 && clickAnalysis.beatOffsetSeconds < beatPeriod + 0.05,
  );

  fs.rmSync(dir, { recursive: true, force: true });
  console.log(failures === 0 ? '\nAnalysis looks correct.\n' : `\n${failures} check(s) failed.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();

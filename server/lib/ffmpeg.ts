import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ProcessError, run } from './proc.js';

const require = createRequire(import.meta.url);

let cachedFfmpeg: string | null = null;

/**
 * ffmpeg-static resolves its binary relative to its own location, which sits
 * inside app.asar once packaged. electron-builder unpacks it, so the real file
 * is in app.asar.unpacked.
 */
function unpacked(binaryPath: string): string {
  return binaryPath.includes(`app.asar${path.sep}`)
    ? binaryPath.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`)
    : binaryPath;
}

function candidatePaths(): string[] {
  const candidates: string[] = [];

  const fromEnv = process.env.MIXR_FFMPEG_PATH?.trim();
  if (fromEnv) candidates.push(fromEnv);

  try {
    const staticPath = require('ffmpeg-static') as string | null;
    if (staticPath) candidates.push(unpacked(staticPath));
  } catch {
    // Falls through to the system binaries below.
  }

  candidates.push('/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg');
  return candidates;
}

export async function resolveFfmpeg(): Promise<string> {
  if (cachedFfmpeg) return cachedFfmpeg;

  const tried: string[] = [];
  for (const candidate of candidatePaths()) {
    tried.push(candidate);
    try {
      if (candidate.includes(path.sep) && !fs.existsSync(candidate)) continue;
      await run(candidate, ['-hide_banner', '-version'], { timeoutMs: 15_000 });
      cachedFfmpeg = candidate;
      return candidate;
    } catch {
      // Try the next candidate.
    }
  }

  // Last resort: whatever `ffmpeg` means on PATH.
  try {
    await run('ffmpeg', ['-hide_banner', '-version'], { timeoutMs: 15_000 });
    cachedFfmpeg = 'ffmpeg';
    return 'ffmpeg';
  } catch {
    throw new Error(
      `Could not find a working ffmpeg. Tried: ${tried.join(', ')}. Install it with "brew install ffmpeg" or set MIXR_FFMPEG_PATH.`,
    );
  }
}

export async function ffmpegVersion(): Promise<string> {
  const binary = await resolveFfmpeg();
  const { stdout } = await run(binary, ['-hide_banner', '-version'], { timeoutMs: 15_000 });
  return stdout.split('\n')[0]?.trim() ?? 'unknown';
}

/**
 * ffmpeg puts the reason for a failure on the last few stderr lines. Surfacing
 * them turns "exited with code 234" into something actionable.
 */
function explain(error: unknown): Error {
  if (!(error instanceof ProcessError)) {
    return error instanceof Error ? error : new Error(String(error));
  }

  const meaningful = error.stderr
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('frame=') && !line.startsWith('size='));

  const detail = meaningful.slice(-3).join(' / ');
  return new Error(detail ? `ffmpeg failed: ${detail}` : error.message);
}

export async function ffmpeg(args: string[], options: Parameters<typeof run>[2] = {}) {
  const binary = await resolveFfmpeg();
  try {
    return await run(binary, ['-hide_banner', '-nostdin', ...args], options);
  } catch (error) {
    throw explain(error);
  }
}

/** Analysis sample rate. Plenty for energy, tempo, and chroma, and 4x faster than 44.1k. */
export const ANALYSIS_SAMPLE_RATE = 22_050;

/**
 * Decodes a file to mono float32 PCM. Duration comes from the sample count,
 * which is exact and avoids needing ffprobe (ffmpeg-static ships no ffprobe).
 */
export async function decodeMonoPcm(
  filePath: string,
  sampleRate = ANALYSIS_SAMPLE_RATE,
): Promise<{ samples: Float32Array; sampleRate: number; durationSeconds: number }> {
  const binary = await resolveFfmpeg();

  return new Promise((resolve, reject) => {
    const child = spawn(
      binary,
      [
        '-hide_banner',
        '-nostdin',
        '-v', 'error',
        '-i', filePath,
        '-vn',
        '-map', 'a:0',
        '-ac', '1',
        '-ar', String(sampleRate),
        '-f', 'f32le',
        '-',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );

    const chunks: Buffer[] = [];
    let total = 0;
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
      total += chunk.length;
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
      if (stderr.length > 200_000) stderr = stderr.slice(-100_000);
    });

    child.on('error', (error) => reject(new Error(`ffmpeg decode failed to start: ${error.message}`)));

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new ProcessError(`ffmpeg could not decode ${path.basename(filePath)}`, code ?? -1, stderr.slice(-2000)));
        return;
      }
      if (total < 4) {
        reject(new Error(`${path.basename(filePath)} decoded to no audio`));
        return;
      }

      const buffer = Buffer.concat(chunks, total);
      // Trim any trailing partial float rather than reading past the end.
      const sampleCount = Math.floor(buffer.byteLength / 4);
      const samples = new Float32Array(sampleCount);
      for (let index = 0; index < sampleCount; index += 1) {
        samples[index] = buffer.readFloatLE(index * 4);
      }

      resolve({ samples, sampleRate, durationSeconds: sampleCount / sampleRate });
    });
  });
}

export interface LoudnessMeasurement {
  integratedLufs: number;
  truePeakDb: number;
  loudnessRange: number;
}

/**
 * Single-pass EBU R128 measurement via loudnorm's JSON report. Used to align
 * track levels before crossfading, the way a DJ would gain-match.
 */
export async function measureLoudness(filePath: string): Promise<LoudnessMeasurement> {
  const { stderr } = await ffmpeg(
    ['-v', 'info', '-i', filePath, '-af', 'loudnorm=print_format=json', '-f', 'null', '-'],
    { timeoutMs: 10 * 60_000 },
  );

  const match = stderr.match(/\{[^{}]*"input_i"[\s\S]*?\}/);
  if (match) {
    try {
      const report = JSON.parse(match[0]) as Record<string, string>;
      const integrated = Number.parseFloat(report.input_i);
      const truePeak = Number.parseFloat(report.input_tp);
      const range = Number.parseFloat(report.input_lra);
      if (Number.isFinite(integrated)) {
        return {
          integratedLufs: integrated,
          truePeakDb: Number.isFinite(truePeak) ? truePeak : 0,
          loudnessRange: Number.isFinite(range) ? range : 0,
        };
      }
    } catch {
      // Fall through to the neutral default below.
    }
  }

  // Digital silence and pathological inputs land here. Treating them as already
  // at target means we apply no gain rather than an absurd correction.
  return { integratedLufs: -14, truePeakDb: -1, loudnessRange: 0 };
}

/**
 * Canonical intermediate: 44.1k stereo FLAC. Lossless so the render keeps full
 * quality, and decodable by both ffmpeg and Chromium for waveform previews.
 */
export async function transcodeToFlac(
  inputPath: string,
  outputPath: string,
  options: { signal?: AbortSignal } = {},
): Promise<void> {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  // The scratch name has to be unique per call. Deriving it from the output
  // alone means two overlapping transcodes of the same track write the same
  // file, and the interleaved result gets renamed into place as a valid-looking
  // but corrupt FLAC. It stays in the same directory so the rename is atomic.
  const partial = `${outputPath}.${process.pid}-${randomBytes(6).toString('hex')}.partial.flac`;

  try {
    await ffmpeg(
      [
        '-v', 'error',
        '-y',
        '-i', inputPath,
        '-vn',
        '-map', 'a:0',
        '-ac', '2',
        '-ar', '44100',
        '-sample_fmt', 's16',
        '-compression_level', '5',
        partial,
      ],
      { timeoutMs: 20 * 60_000, signal: options.signal },
    );
    fs.renameSync(partial, outputPath);
  } catch (error) {
    fs.rmSync(partial, { force: true });
    throw error;
  }
}

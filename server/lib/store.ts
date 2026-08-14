import fs from 'node:fs';
import path from 'node:path';
import type { IngestedTrack, LibrarySnapshot, MixRecord } from '../../src/types.js';
import { paths } from './paths.js';

interface StoreShape {
  version: number;
  mixes: MixRecord[];
  tracks: IngestedTrack[];
}

const EMPTY: StoreShape = { version: 1, mixes: [], tracks: [] };

let cache: StoreShape | null = null;
let cacheStamp: string | null = null;

/**
 * Identifies the exact file the cache was built from. Every write replaces the
 * library by rename, so a new inode alone proves the file changed.
 */
function stampOf(): string | null {
  try {
    const stats = fs.statSync(paths.library);
    return `${stats.ino}:${stats.mtimeMs}:${stats.size}`;
  } catch {
    return null;
  }
}

/**
 * A cache held across writes by another process would make every mutation a
 * lost update: each mutator rewrites the whole file from its own copy, so a
 * stale one silently drops the other's tracks and orphans their media. The
 * stamp check costs a stat and makes each mutation start from what is on disk.
 */
function read(): StoreShape {
  const stamp = stampOf();
  if (cache && stamp === cacheStamp) return cache;

  try {
    const raw = fs.readFileSync(paths.library, 'utf8');
    const parsed = JSON.parse(raw) as Partial<StoreShape>;
    cache = {
      version: parsed.version ?? 1,
      mixes: Array.isArray(parsed.mixes) ? parsed.mixes : [],
      tracks: Array.isArray(parsed.tracks) ? parsed.tracks : [],
    };
  } catch {
    // A missing or corrupt library should never stop the app from starting.
    cache = { ...EMPTY };
  }
  cacheStamp = stamp;
  return cache;
}

function write(next: StoreShape): void {
  cache = next;
  fs.mkdirSync(path.dirname(paths.library), { recursive: true });
  // The scratch name is unique per process so two writers cannot truncate each
  // other's temporary file half-written.
  const temporary = `${paths.library}.${process.pid}.tmp`;
  // Write then rename so a crash mid-write cannot truncate the library.
  fs.writeFileSync(temporary, JSON.stringify(next, null, 2), 'utf8');
  fs.renameSync(temporary, paths.library);
  cacheStamp = stampOf();
}

/**
 * Reads the size of a file that is expected to exist, returning null when it is
 * gone so the caller can prune the entry.
 */
function sizeOf(file: string): number | null {
  try {
    return fs.statSync(file).size;
  } catch {
    return null;
  }
}

/**
 * Drops entries whose media or render file has been deleted behind our back, and
 * refreshes the recorded size from disk. Taking the size from the filesystem
 * rather than trusting the stored value keeps disk totals honest, and repairs
 * entries written before the size was tracked.
 */
function withExistingFiles(shape: StoreShape): StoreShape {
  const tracks: IngestedTrack[] = [];
  for (const track of shape.tracks) {
    const size = sizeOf(path.join(paths.media, track.mediaFile));
    if (size === null) continue;
    tracks.push(track.sizeBytes === size ? track : { ...track, sizeBytes: size });
  }

  const mixes: MixRecord[] = [];
  for (const mix of shape.mixes) {
    const size = sizeOf(path.join(paths.renders, mix.file));
    if (size === null) continue;
    mixes.push(mix.sizeBytes === size ? mix : { ...mix, sizeBytes: size });
  }

  return { ...shape, tracks, mixes };
}

export function snapshot(): LibrarySnapshot {
  const current = read();
  const repaired = withExistingFiles(current);

  // Pruning and size repairs both change the shape, so compare the whole thing
  // rather than just the counts.
  if (JSON.stringify(repaired) !== JSON.stringify(current)) write(repaired);

  return { mixes: repaired.mixes, tracks: repaired.tracks };
}

export function findTrack(id: string): IngestedTrack | undefined {
  return read().tracks.find((track) => track.id === id);
}

/** Inserts or replaces a track, keeping the newest metadata. */
export function upsertTrack(track: IngestedTrack): IngestedTrack {
  const current = read();
  const existing = current.tracks.find((candidate) => candidate.id === track.id);
  const merged: IngestedTrack = existing ? { ...track, addedAt: existing.addedAt, plays: existing.plays } : track;

  write({
    ...current,
    tracks: [merged, ...current.tracks.filter((candidate) => candidate.id !== track.id)],
  });
  return merged;
}

export function addMix(mix: MixRecord): MixRecord {
  const current = read();
  write({ ...current, mixes: [mix, ...current.mixes.filter((candidate) => candidate.id !== mix.id)] });
  return mix;
}

export function findMix(id: string): MixRecord | undefined {
  return read().mixes.find((mix) => mix.id === id);
}

export function recordPlay(kind: 'mix' | 'track', id: string): void {
  const current = read();
  if (kind === 'mix') {
    write({
      ...current,
      mixes: current.mixes.map((mix) => (mix.id === id ? { ...mix, plays: mix.plays + 1 } : mix)),
    });
    return;
  }
  write({
    ...current,
    tracks: current.tracks.map((track) => (track.id === id ? { ...track, plays: track.plays + 1 } : track)),
  });
}

export function deleteMix(id: string): boolean {
  const current = read();
  const mix = current.mixes.find((candidate) => candidate.id === id);
  if (!mix) return false;

  fs.rmSync(path.join(paths.renders, mix.file), { force: true });
  write({ ...current, mixes: current.mixes.filter((candidate) => candidate.id !== id) });
  return true;
}

export function deleteTrack(id: string): boolean {
  const current = read();
  const track = current.tracks.find((candidate) => candidate.id === id);
  if (!track) return false;

  const stillReferenced = current.mixes.some((mix) => mix.plan.tracks.some((entry) => entry.trackId === id));
  if (!stillReferenced) {
    fs.rmSync(path.join(paths.media, track.mediaFile), { force: true });
    fs.rmSync(path.join(paths.analysis, `${id}.json`), { force: true });
  }

  write({ ...current, tracks: current.tracks.filter((candidate) => candidate.id !== id) });
  return true;
}

/** Test hook: forces the next read to hit disk again. */
export function resetCache(): void {
  cache = null;
  cacheStamp = null;
}

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { IngestedTrack } from '../src/types.js';
import { makeTrack } from './helpers/fixtures.js';

// paths.ts resolves the data directory once at import time, so the environment
// has to be set before the store is loaded.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mixr-store-'));
process.env.MIXR_DATA_DIR = dataDir;

const store = await import('../server/lib/store.js');
const { paths } = await import('../server/lib/paths.js');

function ingested(id: string, sizeBytes = 1024): IngestedTrack {
  const track = makeTrack({ id, title: `Song ${id}` });
  return {
    id,
    title: track.title,
    provider: track.provider,
    mediaFile: `${id}.flac`,
    sizeBytes,
    analysis: track.analysis,
    loudness: { integratedLufs: -14, truePeakDb: -1, loudnessRange: 5 },
    addedAt: '2026-01-01T00:00:00.000Z',
    plays: 0,
  };
}

/** Writes the library the way a second mixR process would: atomically, by rename. */
function writeExternally(tracks: IngestedTrack[]): void {
  const temporary = `${paths.library}.external.tmp`;
  fs.writeFileSync(temporary, JSON.stringify({ version: 1, mixes: [], tracks }, null, 2), 'utf8');
  fs.renameSync(temporary, paths.library);
}

function tracksOnDisk(): string[] {
  const parsed = JSON.parse(fs.readFileSync(paths.library, 'utf8')) as { tracks: IngestedTrack[] };
  return parsed.tracks.map((track) => track.id);
}

function media(id: string, bytes: number): void {
  fs.mkdirSync(paths.media, { recursive: true });
  fs.writeFileSync(path.join(paths.media, `${id}.flac`), Buffer.alloc(bytes));
}

beforeEach(() => {
  fs.rmSync(paths.library, { force: true });
  fs.rmSync(paths.media, { recursive: true, force: true });
  store.resetCache();
});

describe('library store', () => {
  it('round-trips a track through disk', () => {
    store.upsertTrack(ingested('a'));
    store.resetCache();
    expect(store.findTrack('a')?.title).toBe('Song a');
  });

  it('keeps the addedAt and play count of a track it replaces', () => {
    store.upsertTrack({ ...ingested('a'), addedAt: '2020-05-05T00:00:00.000Z', plays: 7 });
    const merged = store.upsertTrack({ ...ingested('a'), title: 'Renamed', addedAt: '2026-01-01T00:00:00.000Z' });

    expect(merged.title).toBe('Renamed');
    expect(merged.addedAt).toBe('2020-05-05T00:00:00.000Z');
    expect(merged.plays).toBe(7);
  });

  it('sees a track added by another process without being reset', () => {
    store.upsertTrack(ingested('a'));
    expect(store.findTrack('b')).toBeUndefined();

    writeExternally([ingested('a'), ingested('b')]);

    expect(store.findTrack('b')?.id).toBe('b');
  });

  // Every mutation rewrites the whole file, so a cache held across another
  // process's write would silently drop that process's tracks and leave their
  // media orphaned on disk.
  it('does not drop tracks written by another process', () => {
    store.upsertTrack(ingested('a'));
    writeExternally([ingested('a'), ingested('b')]);

    store.upsertTrack(ingested('c'));

    expect(tracksOnDisk().sort()).toEqual(['a', 'b', 'c']);
  });

  it('keeps tracks written by another process when recording a play or deleting', () => {
    store.upsertTrack(ingested('a'));
    writeExternally([ingested('a'), ingested('b'), ingested('c')]);

    store.recordPlay('track', 'a');
    expect(tracksOnDisk().sort()).toEqual(['a', 'b', 'c']);
    expect(store.findTrack('a')?.plays).toBe(1);

    store.deleteTrack('b');
    expect(tracksOnDisk().sort()).toEqual(['a', 'c']);
  });

  describe('snapshot', () => {
    it('prunes tracks whose media file is gone', () => {
      media('a', 2048);
      store.upsertTrack(ingested('a', 2048));
      store.upsertTrack(ingested('gone', 4096));

      expect(store.snapshot().tracks.map((track) => track.id)).toEqual(['a']);
      expect(tracksOnDisk()).toEqual(['a']);
    });

    it('repairs a size that does not match the file on disk', () => {
      media('a', 3000);
      store.upsertTrack(ingested('a', 999));

      expect(store.snapshot().tracks[0].sizeBytes).toBe(3000);
    });

    it('reports an unknown size from disk rather than leaving it undefined', () => {
      media('a', 1500);
      store.upsertTrack({ ...ingested('a'), sizeBytes: undefined as unknown as number });

      expect(store.snapshot().tracks[0].sizeBytes).toBe(1500);
    });
  });
});

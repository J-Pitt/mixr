import { describe, expect, it } from 'vitest';
import { allVibes, orderTracks } from '../src/lib/mixEngine.js';
import { makeRng, makeTrack, makeTracks } from './helpers/fixtures.js';

const ids = (tracks: { id: string }[]) => tracks.map((track) => track.id);

function shuffle<T>(items: T[], seed: number): T[] {
  const rng = makeRng(seed);
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(rng() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

describe('orderTracks', () => {
  it('keeps exactly the same multiset of ten tracks', () => {
    const tracks = makeTracks(10, 3);
    const ordered = orderTracks(tracks, 'Peak Time');

    expect(ordered).toHaveLength(tracks.length);
    expect(ids(ordered).sort()).toEqual(ids(tracks).sort());
    expect(new Set(ids(ordered)).size).toBe(tracks.length);
    // Same object identities, not copies, so downstream lookups by reference work.
    for (const track of tracks) expect(ordered).toContain(track);
  });

  it('does not mutate the caller array', () => {
    const tracks = makeTracks(6, 8);
    const before = ids(tracks);
    orderTracks(tracks, 'House');
    expect(ids(tracks)).toEqual(before);
  });

  it.each(allVibes)('is deterministic for %s', (vibe) => {
    const tracks = makeTracks(8, 21);
    expect(ids(orderTracks(tracks, vibe))).toEqual(ids(orderTracks(tracks, vibe)));
  });

  it('produces the same order regardless of input order when analysis values are identical', () => {
    // The comparator has to break ties on id, otherwise the sort is inconsistent
    // and the resulting order depends on the engine's sort implementation.
    const tracks = Array.from({ length: 8 }, (_unused, index) =>
      makeTrack({
        id: `same-${index}`,
        analysis: { durationSeconds: 200, bpm: 120, averageEnergy: 0.5, averageBrightness: 0.5 },
      }),
    );

    const baseline = ids(orderTracks(tracks, 'Peak Time'));
    for (const seed of [1, 2, 3, 4, 5]) {
      expect(ids(orderTracks(shuffle(tracks, seed), 'Peak Time')), `seed ${seed}`).toEqual(baseline);
    }
    expect(baseline).toEqual([...baseline].sort());
  });

  it('produces the same order regardless of input order for ties on rank only', () => {
    // Identical energy/bpm but different durations: rank ties, ids differ.
    const tracks = Array.from({ length: 6 }, (_unused, index) =>
      makeTrack({
        id: `tie-${String.fromCharCode(102 - index)}`,
        analysis: { durationSeconds: 180 + index * 7, bpm: 124, averageEnergy: 0.42, averageBrightness: 0.61 },
      }),
    );

    const baseline = ids(orderTracks(tracks, 'Ambient'));
    for (const seed of [11, 12, 13]) {
      expect(ids(orderTracks(shuffle(tracks, seed), 'Ambient')), `seed ${seed}`).toEqual(baseline);
    }
  });

  it('handles zero and one track without throwing', () => {
    expect(orderTracks([], 'Chill')).toEqual([]);
    const single = [makeTrack({ id: 'solo' })];
    expect(ids(orderTracks(single, 'Chill'))).toEqual(['solo']);
  });

  it('opens on the lowest-ranked track for a lift vibe', () => {
    // 'Warm Up' orders by energy and tempo, so the calmest track has to open.
    const calm = makeTrack({ id: 'calm', analysis: { averageEnergy: 0.1, bpm: 90, averageBrightness: 0.3 } });
    const hot = makeTrack({ id: 'hot', analysis: { averageEnergy: 0.95, bpm: 150, averageBrightness: 0.8 } });
    const middle = makeTrack({ id: 'mid', analysis: { averageEnergy: 0.5, bpm: 120, averageBrightness: 0.5 } });

    expect(orderTracks([hot, middle, calm], 'Warm Up')[0].id).toBe('calm');
  });

  it('chains tracks with compatible tempos next to each other', () => {
    const tracks = [
      makeTrack({ id: 'slow-a', analysis: { bpm: 92, averageEnergy: 0.4, averageBrightness: 0.4 } }),
      makeTrack({ id: 'fast-a', analysis: { bpm: 148, averageEnergy: 0.9, averageBrightness: 0.7 } }),
      makeTrack({ id: 'slow-b', analysis: { bpm: 94, averageEnergy: 0.42, averageBrightness: 0.41 } }),
      makeTrack({ id: 'fast-b', analysis: { bpm: 150, averageEnergy: 0.92, averageBrightness: 0.72 } }),
    ];

    const ordered = ids(orderTracks(tracks, 'Peak Time'));
    const slowPositions = [ordered.indexOf('slow-a'), ordered.indexOf('slow-b')].sort((a, b) => a - b);
    // The two tempo clusters must not be interleaved.
    expect(slowPositions[1] - slowPositions[0]).toBe(1);
  });
});

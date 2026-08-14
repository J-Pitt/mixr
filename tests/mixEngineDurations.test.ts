import { describe, expect, it } from 'vitest';
import { allocateDurations, normalizeTransitions } from '../src/lib/mixEngine.js';
import { makeTrack, makeTracks } from './helpers/fixtures.js';

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

const usableOf = (tracks: ReturnType<typeof makeTracks>) =>
  tracks.map((track) => Math.min(track.analysis.usableDurationSeconds, track.analysis.durationSeconds));

describe('allocateDurations', () => {
  it('returns the usable duration of every track when there is no target', () => {
    const tracks = [
      makeTrack({ id: 'a', analysis: { durationSeconds: 300, usableDurationSeconds: 220 } }),
      makeTrack({ id: 'b', analysis: { durationSeconds: 180, usableDurationSeconds: 150 } }),
    ];
    expect(allocateDurations(tracks)).toEqual([220, 150]);
  });

  it('never trusts a usable duration longer than the source', () => {
    const tracks = [makeTrack({ id: 'a', analysis: { durationSeconds: 90, usableDurationSeconds: 400 } })];
    expect(allocateDurations(tracks)).toEqual([90]);
  });

  it.each([undefined, 0, -5, Number.NaN, Number.POSITIVE_INFINITY])(
    'treats %s as "no target"',
    (target) => {
      const tracks = makeTracks(4, 17);
      expect(allocateDurations(tracks, target as number | undefined)).toEqual(usableOf(tracks));
    },
  );

  it('does not inflate durations when the target is longer than the material', () => {
    const tracks = makeTracks(5, 19);
    const natural = usableOf(tracks);
    const allocated = allocateDurations(tracks, (sum(natural) / 60) * 3);
    expect(allocated).toEqual(natural);
    expect(sum(allocated)).toBeLessThanOrEqual(sum(natural));
  });

  it('lands close to a target that is shorter than the material', () => {
    const tracks = makeTracks(6, 23);
    const natural = usableOf(tracks);
    const targetSeconds = Math.floor(sum(natural) * 0.6);
    const allocated = allocateDurations(tracks, targetSeconds / 60);

    // Rounding is per track, so the sum can only drift by half a second each.
    expect(Math.abs(sum(allocated) - targetSeconds)).toBeLessThanOrEqual(tracks.length / 2 + 1);
    for (let index = 0; index < allocated.length; index += 1) {
      expect(allocated[index], `track ${index} was inflated`).toBeLessThanOrEqual(natural[index]);
    }
  });

  it('trims proportionally from whatever has the most room to give', () => {
    const tracks = [
      makeTrack({ id: 'long', analysis: { durationSeconds: 600, usableDurationSeconds: 600 } }),
      makeTrack({ id: 'short', analysis: { durationSeconds: 60, usableDurationSeconds: 60 } }),
    ];
    const allocated = allocateDurations(tracks, 8); // 480s of 660s
    expect(allocated[0]).toBeLessThan(600);
    expect(600 - allocated[0]).toBeGreaterThan(60 - allocated[1]);
    expect(sum(allocated)).toBeLessThanOrEqual(482);
  });

  it('never cuts below the floor, even for an absurdly small target', () => {
    const tracks = [
      makeTrack({ id: 'a', analysis: { durationSeconds: 20, usableDurationSeconds: 20 } }),
      makeTrack({ id: 'b', analysis: { durationSeconds: 15, usableDurationSeconds: 15 } }),
      makeTrack({ id: 'c', analysis: { durationSeconds: 12, usableDurationSeconds: 12 } }),
    ];
    const allocated = allocateDurations(tracks, 0.01);
    // The floor is the shortest track (12s) because it cannot give more than that.
    expect(allocated).toEqual([12, 12, 12]);
  });

  it.each([0.01, 0.05, 0.5, 1, 2, 7.5, 90])(
    'returns positive finite durations for target %s minutes',
    (target) => {
      const tracks = [
        makeTrack({ id: 'tiny', analysis: { durationSeconds: 1, usableDurationSeconds: 1 } }),
        makeTrack({ id: 'small', analysis: { durationSeconds: 2, usableDurationSeconds: 2 } }),
        makeTrack({ id: 'normal', analysis: { durationSeconds: 240, usableDurationSeconds: 200 } }),
      ];
      for (const value of allocateDurations(tracks, target)) {
        expect(Number.isFinite(value), `${value} is not finite`).toBe(true);
        expect(value).toBeGreaterThan(0);
      }
    },
  );

  it('terminates when every track already sits at the floor', () => {
    const tracks = Array.from({ length: 12 }, (_unused, index) =>
      makeTrack({ id: `f${index}`, analysis: { durationSeconds: 45, usableDurationSeconds: 45 } }),
    );
    const started = Date.now();
    const allocated = allocateDurations(tracks, 1); // 60s across 12 x 45s tracks
    expect(Date.now() - started).toBeLessThan(1000);
    expect(allocated).toEqual(Array.from({ length: 12 }, () => 45));
  });

  it('handles an empty track list', () => {
    expect(allocateDurations([])).toEqual([]);
    expect(allocateDurations([], 30)).toEqual([]);
  });

  it('is a pure function of its inputs', () => {
    const tracks = makeTracks(5, 29);
    const snapshot = JSON.stringify(tracks);
    const first = allocateDurations(tracks, 10);
    expect(allocateDurations(tracks, 10)).toEqual(first);
    expect(JSON.stringify(tracks)).toBe(snapshot);
  });
});

describe('normalizeTransitions', () => {
  const feasible = (playDurations: number[], lengths: number[]) =>
    playDurations.every((play, index) => {
      const incoming = index > 0 ? lengths[index - 1] : 0;
      const outgoing = index < lengths.length ? lengths[index] : 0;
      return incoming + outgoing <= play;
    });

  it('leaves comfortable lengths untouched', () => {
    expect(normalizeTransitions([240, 240, 240], [10, 10])).toEqual([10, 10]);
    expect(normalizeTransitions([120, 200], [8])).toEqual([8]);
  });

  it('rounds fractional lengths instead of passing them through', () => {
    expect(normalizeTransitions([240, 240], [9.4])).toEqual([9]);
    expect(normalizeTransitions([240, 240], [9.6])).toEqual([10]);
  });

  it('never returns a negative length', () => {
    for (const lengths of [[-10], [-1, -50], [0, 0]]) {
      for (const value of normalizeTransitions([100, 100, 100].slice(0, lengths.length + 1), lengths)) {
        expect(value).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('never exceeds either adjacent play duration', () => {
    const cases: [number[], number[]][] = [
      [[240, 240, 240], [10, 10]],
      [[20, 15, 12], [16, 16]],
      [[9, 300], [14]],
      [[300, 9], [14]],
      [[5, 5, 5, 5], [20, 20, 20]],
      [[1, 1, 1], [8, 8]],
      [[60, 8, 60], [12, 12]],
      [[0, 100], [10]],
      [[-5, 100], [10]],
    ];

    for (const [playDurations, rawLengths] of cases) {
      const lengths = normalizeTransitions(playDurations, rawLengths);
      expect(lengths).toHaveLength(rawLengths.length);
      lengths.forEach((length, index) => {
        const label = `play=${JSON.stringify(playDurations)} raw=${JSON.stringify(rawLengths)}`;
        expect(length, `${label}: length ${length} exceeds play[${index}]`).toBeLessThanOrEqual(
          Math.max(0, playDurations[index]),
        );
        expect(length, `${label}: length ${length} exceeds play[${index + 1}]`).toBeLessThanOrEqual(
          Math.max(0, playDurations[index + 1]),
        );
        expect(length).toBeGreaterThanOrEqual(0);
      });
    }
  });

  it('keeps the blend budget inside each play window for realistic durations', () => {
    const cases: [number[], number[]][] = [
      [[240, 240, 240, 240], [14, 14, 14]],
      [[45, 45, 45], [20, 20]],
      [[20, 15, 12], [8, 8]],
      [[12, 12, 12, 12, 12], [10, 10, 10, 10]],
      [[1, 1, 1], [8, 8]],
      [[100, 4, 100], [12, 12]],
    ];

    for (const [playDurations, rawLengths] of cases) {
      const lengths = normalizeTransitions(playDurations, rawLengths);
      expect(
        feasible(playDurations, lengths),
        `play=${JSON.stringify(playDurations)} raw=${JSON.stringify(rawLengths)} -> ${JSON.stringify(lengths)}`,
      ).toBe(true);
    }
  });

  // A minimum blend length can only be honoured if both sides still fit inside
  // the track. On a very short interior window the blends drop to zero and the
  // renderer splices instead, rather than crossfading the same audio twice.
  it('keeps in + out inside a 3s interior play window', () => {
    expect(feasible([100, 3, 100], normalizeTransitions([100, 3, 100], [12, 12]))).toBe(true);
  });

  it('keeps in + out inside a 3.5s interior play window', () => {
    expect(feasible([100, 3.5, 100], normalizeTransitions([100, 3.5, 100], [12, 12]))).toBe(true);
  });

  it('handles an empty length list', () => {
    expect(normalizeTransitions([240], [])).toEqual([]);
    expect(normalizeTransitions([], [])).toEqual([]);
  });

  it('is deterministic and does not mutate its inputs', () => {
    const playDurations = [200, 40, 200];
    const rawLengths = [14, 14];
    const first = normalizeTransitions(playDurations, rawLengths);
    expect(normalizeTransitions(playDurations, rawLengths)).toEqual(first);
    expect(playDurations).toEqual([200, 40, 200]);
    expect(rawLengths).toEqual([14, 14]);
  });
});

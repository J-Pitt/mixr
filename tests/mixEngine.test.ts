import { describe, expect, it } from 'vitest';
import {
  allocateDurations,
  clamp,
  crossfadeCurveFor,
  eqFiltersFor,
  generateMixPlan,
  normalizeTransitions,
  orderTracks,
  resolveVibe,
  TARGET_LUFS,
  vibeProfiles,
} from '../src/lib/mixEngine.js';
import type { Vibe } from '../src/types.js';
import { makeTrack, makeTracks } from './helpers/fixtures.js';

const ALL_VIBES = Object.keys(vibeProfiles) as Vibe[];

describe('clamp', () => {
  it('keeps values inside the range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(50, 0, 10)).toBe(10);
  });
});

describe('orderTracks', () => {
  it('is deterministic regardless of input order', () => {
    const tracks = makeTracks(6, 11);
    const forward = orderTracks(tracks, 'Peak Time').map((track) => track.id);
    const backward = orderTracks([...tracks].reverse(), 'Peak Time').map((track) => track.id);
    expect(forward).toEqual(backward);
  });

  it('is stable for tracks that rank identically', () => {
    // Identical analysis means every comparison is a tie, which is exactly the
    // case an inconsistent comparator used to reorder unpredictably.
    const tracks = ['a', 'b', 'c', 'd'].map((id) => makeTrack({ id, analysis: { durationSeconds: 200 } }));
    const first = orderTracks(tracks, 'Chill').map((track) => track.id);
    const second = orderTracks([...tracks].reverse(), 'Chill').map((track) => track.id);
    expect(first).toEqual(second);
  });

  it('keeps every track exactly once for every vibe', () => {
    const tracks = makeTracks(7, 5);
    for (const vibe of ALL_VIBES) {
      const ordered = orderTracks(tracks, vibe);
      expect(ordered).toHaveLength(7);
      expect(new Set(ordered.map((track) => track.id)).size).toBe(7);
    }
  });

  it('opens quiet for a lifting vibe', () => {
    const tracks = [
      makeTrack({ id: 'loud', analysis: { averageEnergy: 0.95, bpm: 140 } }),
      makeTrack({ id: 'quiet', analysis: { averageEnergy: 0.1, bpm: 100 } }),
      makeTrack({ id: 'mid', analysis: { averageEnergy: 0.5, bpm: 120 } }),
    ];
    expect(orderTracks(tracks, 'Warm Up')[0].id).toBe('quiet');
  });

  it('handles zero and one track', () => {
    expect(orderTracks([], 'Peak Time')).toEqual([]);
    expect(orderTracks([makeTrack({ id: 'solo' })], 'Peak Time')).toHaveLength(1);
  });
});

describe('allocateDurations', () => {
  it('returns usable lengths when no target is given', () => {
    const tracks = makeTracks(4, 3);
    const allocated = allocateDurations(tracks);
    allocated.forEach((value, index) => {
      expect(value).toBeLessThanOrEqual(tracks[index].analysis.durationSeconds);
      expect(value).toBeGreaterThan(0);
    });
  });

  it('never allocates more than a track actually has', () => {
    const tracks = makeTracks(5, 9);
    for (const target of [1, 3, 8, 40]) {
      allocateDurations(tracks, target).forEach((value, index) => {
        expect(value).toBeLessThanOrEqual(tracks[index].analysis.durationSeconds);
      });
    }
  });

  it('lands close to the target when there is room to trim', () => {
    const tracks = ['a', 'b', 'c', 'd'].map((id) => makeTrack({ id, analysis: { durationSeconds: 240, outroSecond: 240 } }));
    const total = allocateDurations(tracks, 10).reduce((sum, value) => sum + value, 0);
    expect(total).toBeGreaterThanOrEqual(10 * 60 - 6);
    expect(total).toBeLessThanOrEqual(10 * 60 + 6);
  });

  it('stays positive for an impossibly short target', () => {
    const tracks = makeTracks(3, 2);
    for (const value of allocateDurations(tracks, 0.05)) expect(value).toBeGreaterThan(0);
  });

  it('ignores a target longer than the available material', () => {
    const tracks = [
      makeTrack({ id: 'a', analysis: { durationSeconds: 100, usableDurationSeconds: 100 } }),
      makeTrack({ id: 'b', analysis: { durationSeconds: 100, usableDurationSeconds: 100 } }),
    ];
    expect(allocateDurations(tracks, 60)).toEqual([100, 100]);
  });

  it('ignores nonsense targets', () => {
    const tracks = makeTracks(2, 4);
    const full = allocateDurations(tracks);
    expect(allocateDurations(tracks, Number.NaN)).toEqual(full);
    expect(allocateDurations(tracks, -5)).toEqual(full);
  });
});

describe('normalizeTransitions', () => {
  it('leaves comfortable blends untouched', () => {
    expect(normalizeTransitions([200, 200, 200], [10, 10])).toEqual([10, 10]);
  });

  it('leaves untouched body in a track that hosts two blends', () => {
    const playDurations = [30, 20, 30];
    const lengths = normalizeTransitions(playDurations, [14, 14]);
    expect(lengths[0] + lengths[1]).toBeLessThanOrEqual(playDurations[1] - 1);
  });

  it('never lets a blend outlast its shortest neighbour', () => {
    const playDurations = [60, 8, 60];
    for (const length of normalizeTransitions(playDurations, [12, 12])) {
      expect(length).toBeLessThan(8);
    }
  });

  it('keeps every length non-negative', () => {
    for (const length of normalizeTransitions([5, 4, 6], [20, 20])) {
      expect(length).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('generateMixPlan', () => {
  it('returns an empty plan without throwing', () => {
    const plan = generateMixPlan({ title: '   ', tracks: [], vibe: 'Peak Time' });
    expect(plan.tracks).toHaveLength(0);
    expect(plan.totalDurationSeconds).toBe(0);
    expect(plan.title).toBe('Untitled mix');
    expect(plan.warnings.length).toBeGreaterThan(0);
  });

  it('keeps every play window inside its own track, for every vibe', () => {
    const tracks = makeTracks(5, 17);

    for (const vibe of ALL_VIBES) {
      const plan = generateMixPlan({ title: 'Test', tracks, vibe });

      for (const planTrack of plan.tracks) {
        const source = tracks.find((track) => track.id === planTrack.trackId)!;
        expect(planTrack.startOffsetSeconds).toBeGreaterThanOrEqual(0);
        expect(planTrack.endOffsetSeconds).toBeGreaterThan(planTrack.startOffsetSeconds);
        expect(planTrack.endOffsetSeconds).toBeLessThanOrEqual(source.analysis.durationSeconds + 1e-6);
        expect(planTrack.playDurationSeconds).toBeCloseTo(
          planTrack.endOffsetSeconds - planTrack.startOffsetSeconds,
          5,
        );
      }
    }
  });

  it('makes the total equal play time minus every overlap', () => {
    for (const seed of [1, 8, 21]) {
      const plan = generateMixPlan({ title: 'Test', tracks: makeTracks(5, seed), vibe: 'House' });
      const played = plan.tracks.reduce((sum, track) => sum + track.playDurationSeconds, 0);
      const overlap = plan.tracks.reduce((sum, track) => sum + (track.transitionOut?.lengthSeconds ?? 0), 0);
      expect(plan.totalDurationSeconds).toBe(Math.max(0, Math.round(played - overlap)));
    }
  });

  it('places each track so its blend overlaps the previous one', () => {
    const plan = generateMixPlan({ title: 'Test', tracks: makeTracks(6, 33), vibe: 'Trance' });

    expect(plan.tracks[0].mixStartSeconds).toBe(0);
    for (let index = 1; index < plan.tracks.length; index += 1) {
      const previous = plan.tracks[index - 1];
      const expected =
        (previous.mixStartSeconds ?? 0) + previous.playDurationSeconds - (previous.transitionOut?.lengthSeconds ?? 0);
      expect(plan.tracks[index].mixStartSeconds).toBeCloseTo(expected, 5);
    }
  });

  it('never overlaps two blends inside one track', () => {
    // If a track's incoming and outgoing fades met, the chained acrossfade
    // render would double-fade the same audio.
    const plan = generateMixPlan({ title: 'Test', tracks: makeTracks(6, 44), vibe: 'Ambient' });

    for (const track of plan.tracks) {
      const incoming = track.transitionIn?.lengthSeconds ?? 0;
      const outgoing = track.transitionOut?.lengthSeconds ?? 0;
      expect(incoming + outgoing).toBeLessThanOrEqual(track.playDurationSeconds);
    }
  });

  it('pairs each transition out with the next transition in', () => {
    const plan = generateMixPlan({ title: 'Test', tracks: makeTracks(4, 6), vibe: 'Techno' });

    for (let index = 0; index < plan.tracks.length - 1; index += 1) {
      expect(plan.tracks[index].transitionOut?.lengthSeconds).toBe(
        plan.tracks[index + 1].transitionIn?.lengthSeconds,
      );
    }
    expect(plan.tracks[0].transitionIn).toBeUndefined();
    expect(plan.tracks.at(-1)?.transitionOut).toBeUndefined();
  });

  it('keeps each blend inside the window it fades across', () => {
    const plan = generateMixPlan({ title: 'Test', tracks: makeTracks(5, 12), vibe: 'Late Night' });

    for (const track of plan.tracks) {
      if (track.transitionOut) {
        expect(track.transitionOut.fromSecond).toBeGreaterThanOrEqual(track.startOffsetSeconds - 1e-6);
        expect(track.transitionOut.toSecond).toBeLessThanOrEqual(track.endOffsetSeconds + 1e-6);
        expect(track.transitionOut.toSecond - track.transitionOut.fromSecond).toBeCloseTo(
          track.transitionOut.lengthSeconds,
          5,
        );
      }
      if (track.transitionIn) {
        expect(track.transitionIn.fromSecond).toBeGreaterThanOrEqual(track.startOffsetSeconds - 1e-6);
        expect(track.transitionIn.toSecond).toBeLessThanOrEqual(track.endOffsetSeconds + 1e-6);
      }
    }
  });

  it('trims level so each track meets the loudness target', () => {
    const plan = generateMixPlan({
      title: 'Test',
      vibe: 'Peak Time',
      tracks: [
        makeTrack({ id: 'quiet', loudness: { integratedLufs: -20, truePeakDb: -3, loudnessRange: 5 } }),
        makeTrack({ id: 'loud', loudness: { integratedLufs: -8, truePeakDb: 0.5, loudnessRange: 4 } }),
      ],
    });

    expect(plan.tracks.find((track) => track.trackId === 'quiet')?.gainDb).toBeCloseTo(TARGET_LUFS - -20, 1);
    expect(plan.tracks.find((track) => track.trackId === 'loud')?.gainDb).toBeCloseTo(TARGET_LUFS - -8, 1);
  });

  it('leaves gain flat when loudness was never measured', () => {
    const plan = generateMixPlan({
      title: 'Test',
      vibe: 'Peak Time',
      tracks: [makeTrack({ id: 'a', loudness: null }), makeTrack({ id: 'b', loudness: null })],
    });
    for (const track of plan.tracks) expect(track.gainDb).toBe(0);
  });

  it('clamps absurd gain corrections', () => {
    const plan = generateMixPlan({
      title: 'Test',
      vibe: 'Peak Time',
      tracks: [makeTrack({ id: 'silent', loudness: { integratedLufs: -70, truePeakDb: -40, loudnessRange: 1 } })],
    });
    expect(plan.tracks[0].gainDb).toBeLessThanOrEqual(12);
  });

  it('renders a single track as a straight edit and says so', () => {
    const plan = generateMixPlan({ title: 'Solo', tracks: [makeTrack({ id: 'a' })], vibe: 'Chill' });
    expect(plan.tracks).toHaveLength(1);
    expect(plan.tracks[0].transitionIn).toBeUndefined();
    expect(plan.tracks[0].transitionOut).toBeUndefined();
    expect(plan.warnings.join(' ')).toMatch(/straight edit/i);
  });

  it('respects a target duration', () => {
    const tracks = ['a', 'b', 'c'].map((id) => makeTrack({ id, analysis: { durationSeconds: 240, outroSecond: 240 } }));
    const plan = generateMixPlan({ title: 'Short', tracks, vibe: 'Peak Time', targetMinutes: 4 });
    expect(plan.totalDurationSeconds).toBeLessThanOrEqual(4 * 60);
  });

  it('gives every track a bounded energy preview', () => {
    const plan = generateMixPlan({ title: 'Test', tracks: makeTracks(4, 77), vibe: 'Funk' });
    for (const track of plan.tracks) {
      expect(track.energyPreview.length).toBeGreaterThan(0);
      for (const value of track.energyPreview) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });

  it('survives tracks that are far too short to blend', () => {
    const shorts = ['a', 'b', 'c'].map((id) =>
      makeTrack({ id, analysis: { durationSeconds: 12, usableDurationSeconds: 12, introSecond: 0, outroSecond: 12 } }),
    );
    const plan = generateMixPlan({ title: 'Shorts', tracks: shorts, vibe: 'Festival' });

    expect(plan.totalDurationSeconds).toBeGreaterThan(0);
    for (const track of plan.tracks) {
      expect(track.playDurationSeconds).toBeGreaterThan(0);
      expect(track.endOffsetSeconds).toBeLessThanOrEqual(12 + 1e-6);
    }
  });

  it('flags weak tempo detection', () => {
    const plan = generateMixPlan({
      title: 'Test',
      vibe: 'Peak Time',
      tracks: [
        makeTrack({ id: 'a', analysis: { bpmConfidence: 0.1 } }),
        makeTrack({ id: 'b', analysis: { bpmConfidence: 0.9 } }),
      ],
    });
    expect(plan.warnings.join(' ')).toMatch(/unclear tempo/i);
  });

  it('snaps a window end onto a nearby transition moment', () => {
    const tracks = [
      makeTrack({
        id: 'a',
        analysis: { durationSeconds: 240, usableDurationSeconds: 240, introSecond: 0, transitionMoments: [118] },
      }),
      makeTrack({ id: 'b', analysis: { durationSeconds: 240, usableDurationSeconds: 240, introSecond: 0 } }),
    ];
    const plan = generateMixPlan({ title: 'Snap', tracks, vibe: 'House', targetMinutes: 4 });
    const first = plan.tracks.find((track) => track.trackId === 'a');
    expect(first?.endOffsetSeconds).toBe(118);
  });
});

describe('resolveVibe', () => {
  it('returns the only choice', () => {
    expect(resolveVibe(['Techno'])).toBe('Techno');
  });

  it('always returns one of the selected vibes', () => {
    const selections: Vibe[][] = [
      ['Ambient', 'Festival'],
      ['Ambient', 'Festival', 'House'],
      ['Chill', 'Hype', 'Jazz', 'Techno'],
    ];
    for (const selection of selections) expect(selection).toContain(resolveVibe(selection));
  });

  it('falls back for an empty selection', () => {
    expect(resolveVibe([])).toBe('Peak Time');
  });
});

describe('vibe audio mapping', () => {
  it('gives every vibe a usable profile', () => {
    for (const vibe of ALL_VIBES) {
      const profile = vibeProfiles[vibe];
      expect(profile.eq.length).toBeGreaterThan(0);
      expect(profile.transitionStyle.length).toBeGreaterThan(0);
      expect(profile.transitionRange[0]).toBeGreaterThan(0);
      expect(profile.transitionRange[0]).toBeLessThanOrEqual(profile.transitionRange[1]);
      expect(Array.isArray(eqFiltersFor(vibe))).toBe(true);
    }
  });

  it('returns a fresh filter array so callers cannot mutate the table', () => {
    const first = eqFiltersFor('Techno');
    first.push('volume=100dB');
    expect(eqFiltersFor('Techno')).not.toContain('volume=100dB');
  });

  it('maps transition styles onto sensible curves', () => {
    expect(crossfadeCurveFor('hard cut')).toBe('exp');
    expect(crossfadeCurveFor('long dissolve')).toBe('hsin');
    expect(crossfadeCurveFor('patient fade')).toBe('log');
    expect(crossfadeCurveFor('phrase-locked blend')).toBe('qsin');
  });

  it('produces a valid curve name for every vibe', () => {
    const valid = new Set(['exp', 'hsin', 'log', 'qsin', 'tri']);
    for (const vibe of ALL_VIBES) {
      expect(valid.has(crossfadeCurveFor(vibeProfiles[vibe].transitionStyle))).toBe(true);
    }
  });
});

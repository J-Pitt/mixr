import { describe, expect, it } from 'vitest';
import { allVibes, generateMixPlan, vibeProfiles } from '../src/lib/mixEngine.js';
import type { TrackInput, Vibe } from '../src/types.js';
import { makeSlices, makeTrack, makeTracks } from './helpers/fixtures.js';
import { collectPlanViolations, describeViolations, violationsOf } from './helpers/planInvariants.js';

const planFor = (tracks: TrackInput[], vibe: Vibe = 'Peak Time', targetMinutes?: number) =>
  generateMixPlan({ title: 'Test set', tracks, vibe, targetMinutes });

describe('generateMixPlan — structural invariants', () => {
  it.each(allVibes)('holds every invariant for %s with eight tracks', (vibe) => {
    const tracks = makeTracks(8, 101);
    const plan = planFor(tracks, vibe);
    const violations = collectPlanViolations(plan, tracks);
    expect(violations, describeViolations(violations)).toEqual([]);
  });

  it.each([undefined, 5, 12, 30, 90, 240])('holds every invariant for a %s minute target', (target) => {
    const tracks = makeTracks(10, 202);
    const plan = planFor(tracks, 'Sunset Cruise', target);
    const violations = collectPlanViolations(plan, tracks);
    expect(violations, describeViolations(violations)).toEqual([]);
  });

  it.each([2, 3, 4, 5, 9, 17])('holds every invariant for %s tracks', (count) => {
    const tracks = makeTracks(count, 303 + count);
    const plan = planFor(tracks, 'House');
    expect(plan.tracks).toHaveLength(count);
    const violations = collectPlanViolations(plan, tracks);
    expect(violations, describeViolations(violations)).toEqual([]);
  });

  it('satisfies the total duration identity exactly', () => {
    const tracks = makeTracks(7, 404);
    const plan = planFor(tracks, 'Late Night', 25);

    const playSum = plan.tracks.reduce((sum, track) => sum + track.playDurationSeconds, 0);
    const overlapSum = plan.tracks.reduce((sum, track) => sum + (track.transitionOut?.lengthSeconds ?? 0), 0);
    expect(plan.totalDurationSeconds).toBeCloseTo(playSum - overlapSum, 0);
    expect(Math.abs(plan.totalDurationSeconds - (playSum - overlapSum))).toBeLessThanOrEqual(1);
  });

  it('chains mixStartSeconds monotonically without gaps', () => {
    const tracks = makeTracks(9, 505);
    const plan = planFor(tracks, 'Techno');

    expect(plan.tracks[0].mixStartSeconds).toBe(0);
    for (let index = 1; index < plan.tracks.length; index += 1) {
      const previous = plan.tracks[index - 1];
      const expected =
        (previous.mixStartSeconds ?? 0) +
        previous.playDurationSeconds -
        (previous.transitionOut?.lengthSeconds ?? 0);
      expect(plan.tracks[index].mixStartSeconds).toBe(expected);
      expect(plan.tracks[index].mixStartSeconds!).toBeGreaterThan(previous.mixStartSeconds!);
    }

    const last = plan.tracks[plan.tracks.length - 1];
    expect((last.mixStartSeconds ?? 0) + last.playDurationSeconds).toBeCloseTo(plan.totalDurationSeconds, 0);
  });

  it('pairs every transitionIn with the previous transitionOut', () => {
    const plan = planFor(makeTracks(6, 606), 'Golden Hour');
    for (let index = 1; index < plan.tracks.length; index += 1) {
      expect(plan.tracks[index].transitionIn?.lengthSeconds ?? 0).toBe(
        plan.tracks[index - 1].transitionOut?.lengthSeconds ?? 0,
      );
      expect(plan.tracks[index].transitionIn?.style).toBe(plan.tracks[index - 1].transitionOut?.style);
    }
    expect(plan.tracks[0].transitionIn).toBeUndefined();
    expect(plan.tracks[plan.tracks.length - 1].transitionOut).toBeUndefined();
  });

  it('keeps transition windows inside the play window they belong to', () => {
    const plan = planFor(makeTracks(6, 707), 'Ambient');
    for (const track of plan.tracks) {
      if (track.transitionIn) {
        expect(track.transitionIn.fromSecond).toBeGreaterThanOrEqual(track.startOffsetSeconds);
        expect(track.transitionIn.toSecond).toBeLessThanOrEqual(track.endOffsetSeconds);
        expect(track.transitionIn.toSecond - track.transitionIn.fromSecond).toBeCloseTo(
          track.transitionIn.lengthSeconds,
          6,
        );
      }
      if (track.transitionOut) {
        expect(track.transitionOut.fromSecond).toBeGreaterThanOrEqual(track.startOffsetSeconds);
        expect(track.transitionOut.toSecond).toBeLessThanOrEqual(track.endOffsetSeconds);
        expect(track.transitionOut.toSecond - track.transitionOut.fromSecond).toBeCloseTo(
          track.transitionOut.lengthSeconds,
          6,
        );
      }
    }
  });

  it.each(allVibes)('keeps %s blend lengths inside its transitionRange', (vibe) => {
    // Long, comfortable tracks so the normalizer never has to squeeze anything.
    const tracks = Array.from({ length: 5 }, (_unused, index) =>
      makeTrack({
        id: `long-${index}`,
        analysis: {
          durationSeconds: 400,
          usableDurationSeconds: 380,
          introSecond: 5,
          outroSecond: 385,
          bpm: 124 + index,
          averageEnergy: 0.3 + index * 0.1,
          averageBrightness: 0.4 + index * 0.08,
        },
      }),
    );

    const [min, max] = vibeProfiles[vibe].transitionRange;
    const plan = planFor(tracks, vibe);
    for (const track of plan.tracks) {
      const outgoing = track.transitionOut?.lengthSeconds;
      if (outgoing === undefined) continue;
      expect(outgoing, `${vibe} blend ${outgoing} is outside [${min},${max}]`).toBeGreaterThanOrEqual(min);
      expect(outgoing, `${vibe} blend ${outgoing} is outside [${min},${max}]`).toBeLessThanOrEqual(max);
    }
  });

  it('produces an energy preview of finite values inside [0,1]', () => {
    const plan = planFor(makeTracks(4, 909), 'Chill');
    for (const track of plan.tracks) {
      expect(track.energyPreview.length).toBeGreaterThan(0);
      for (const value of track.energyPreview) {
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });

  it('falls back to a flat energy preview when a track has no slices', () => {
    const tracks = [
      makeTrack({ id: 'noslices', analysis: { slices: [], durationSeconds: 200, usableDurationSeconds: 180 } }),
      makeTrack({ id: 'normal' }),
    ];
    const plan = planFor(tracks, 'Chill');
    const preview = plan.tracks.find((track) => track.trackId === 'noslices')!.energyPreview;
    expect(preview.length).toBeGreaterThan(0);
    expect(preview.every((value) => value === 0.5)).toBe(true);
  });

  it('is deterministic for identical inputs', () => {
    const tracks = makeTracks(8, 1111);
    expect(JSON.stringify(planFor(tracks, 'Funk', 20))).toBe(JSON.stringify(planFor(tracks, 'Funk', 20)));
  });
});

describe('generateMixPlan — degenerate inputs', () => {
  it('returns a valid empty plan with a warning instead of throwing', () => {
    const plan = generateMixPlan({ title: '  ', tracks: [], vibe: 'Hype' });
    expect(plan.tracks).toEqual([]);
    expect(plan.totalDurationSeconds).toBe(0);
    expect(plan.warnings.length).toBeGreaterThan(0);
    expect(plan.title).toBe('Untitled mix');
    expect(plan.vibe).toBe('Hype');
    expect(collectPlanViolations(plan, [])).toEqual([]);
  });

  it('warns that a single track has nothing to blend into', () => {
    const tracks = [makeTrack({ id: 'solo', analysis: { durationSeconds: 300, usableDurationSeconds: 240 } })];
    const plan = planFor(tracks, 'Hip-Hop');

    expect(plan.tracks).toHaveLength(1);
    expect(plan.tracks[0].transitionIn).toBeUndefined();
    expect(plan.tracks[0].transitionOut).toBeUndefined();
    expect(plan.totalDurationSeconds).toBe(plan.tracks[0].playDurationSeconds);
    expect(plan.warnings.some((warning) => /single track/i.test(warning))).toBe(true);
    expect(collectPlanViolations(plan, tracks)).toEqual([]);
  });

  it('keeps the play window inside the source for every track', () => {
    const tracks = [
      makeTrack({ id: 'late-intro', analysis: { durationSeconds: 100, usableDurationSeconds: 100, introSecond: 95, outroSecond: 99 } }),
      makeTrack({ id: 'neg-intro', analysis: { durationSeconds: 120, usableDurationSeconds: 120, introSecond: -20, outroSecond: 100 } }),
      makeTrack({ id: 'huge-intro', analysis: { durationSeconds: 90, usableDurationSeconds: 90, introSecond: 5000, outroSecond: 6000 } }),
    ];
    const plan = planFor(tracks, 'Jazz');
    expect(violationsOf(collectPlanViolations(plan, tracks), 'window-bounds')).toEqual([]);
  });

  it('does not let a snapped end run past the source duration', () => {
    // transitionMoments deliberately sit beyond the end of the file.
    const tracks = [
      makeTrack({
        id: 'snap',
        analysis: {
          durationSeconds: 120,
          usableDurationSeconds: 110,
          introSecond: 4,
          outroSecond: 114,
          transitionMoments: [110, 118, 119, 200],
        },
      }),
      makeTrack({ id: 'other', analysis: { durationSeconds: 200, usableDurationSeconds: 180 } }),
    ];
    const plan = planFor(tracks, 'Reggae');
    const snapped = plan.tracks.find((track) => track.trackId === 'snap')!;
    expect(snapped.endOffsetSeconds).toBeLessThanOrEqual(120);
    expect(violationsOf(collectPlanViolations(plan, tracks), 'window-bounds')).toEqual([]);
  });

  it('survives pathologically short tracks with an aggressive target', () => {
    const tracks = [
      makeTrack({ id: 's20', analysis: { durationSeconds: 20, usableDurationSeconds: 20, introSecond: 0, outroSecond: 20, slices: makeSlices({ seconds: 20 }) } }),
      makeTrack({ id: 's15', analysis: { durationSeconds: 15, usableDurationSeconds: 15, introSecond: 0, outroSecond: 15, slices: makeSlices({ seconds: 15 }) } }),
      makeTrack({ id: 's12', analysis: { durationSeconds: 12, usableDurationSeconds: 12, introSecond: 0, outroSecond: 12, slices: makeSlices({ seconds: 12 }) } }),
    ];

    for (const target of [undefined, 0.05, 0.2, 0.5, 1, 5]) {
      for (const vibe of ['Festival', 'Ambient', 'Peak Time', 'Winter Chill'] as Vibe[]) {
        const plan = generateMixPlan({ title: 'shorties', tracks, vibe, targetMinutes: target });
        const violations = collectPlanViolations(plan, tracks);
        expect(violations, `vibe=${vibe} target=${target}\n${describeViolations(violations)}`).toEqual([]);
      }
    }
  });

  it('survives a ten-track set of very short tracks', () => {
    const tracks = Array.from({ length: 10 }, (_unused, index) =>
      makeTrack({
        id: `tiny-${index}`,
        analysis: {
          durationSeconds: 12 + index,
          usableDurationSeconds: 12 + index,
          introSecond: 0,
          outroSecond: 12 + index,
          slices: makeSlices({ seconds: 12 + index }),
        },
      }),
    );

    for (const target of [undefined, 0.5, 2, 30]) {
      const plan = generateMixPlan({ title: 'shorties', tracks, vibe: 'Drum & Bass', targetMinutes: target });
      const violations = collectPlanViolations(plan, tracks);
      expect(violations, `target=${target}\n${describeViolations(violations)}`).toEqual([]);
    }
  });

  // Every track here has identical analysis, so orderTracks breaks the tie on id
  // and the "m-" track lands in the middle, hosting a blend on both sides.
  const sandwich = (usableSeconds: number) => [
    makeTrack({ id: 'a-long', analysis: { durationSeconds: 200, usableDurationSeconds: 120, introSecond: 0, outroSecond: 120 } }),
    makeTrack({ id: 'm-brief', analysis: { durationSeconds: 200, usableDurationSeconds: usableSeconds, introSecond: 0, outroSecond: usableSeconds } }),
    makeTrack({ id: 'z-long', analysis: { durationSeconds: 200, usableDurationSeconds: 120, introSecond: 0, outroSecond: 120 } }),
  ];

  it('keeps chained crossfades feasible when the middle track only has 8s of usable audio', () => {
    const tracks = sandwich(8);
    const plan = planFor(tracks, 'Peak Time');
    expect(plan.tracks[1].trackId).toBe('m-brief');
    expect(violationsOf(collectPlanViolations(plan, tracks), 'crossfade-feasibility')).toEqual([]);
  });

  // A 3s window cannot host a blend on both sides, so both collapse to a splice.
  it('keeps chained crossfades feasible when the middle track only has 3s of usable audio', () => {
    const tracks = sandwich(3);
    const plan = planFor(tracks, 'Peak Time');
    expect(plan.tracks[1].trackId).toBe('m-brief');
    expect(violationsOf(collectPlanViolations(plan, tracks), 'crossfade-feasibility')).toEqual([]);
  });

  // The renderer seeks with the window and reads with the duration, so a track
  // shorter than a second must not claim more audio than the file holds.
  it('keeps playDurationSeconds equal to the play window for a sub-second track', () => {
    const tracks = [
      makeTrack({ id: 'blip', analysis: { durationSeconds: 0.6, usableDurationSeconds: 0.6, introSecond: 0, outroSecond: 1, slices: [] } }),
      makeTrack({ id: 'normal', analysis: { durationSeconds: 200, usableDurationSeconds: 180, introSecond: 0, outroSecond: 180 } }),
    ];
    const plan = planFor(tracks, 'Chill');
    expect(violationsOf(collectPlanViolations(plan, tracks), 'window-identity')).toEqual([]);
  });

  it('applies a level trim only when loudness was measured', () => {
    const tracks = [
      makeTrack({ id: 'quiet', loudness: { integratedLufs: -20, truePeakDb: -3, loudnessRange: 6 } }),
      makeTrack({ id: 'loud', loudness: { integratedLufs: -6, truePeakDb: -0.5, loudnessRange: 4 } }),
      makeTrack({ id: 'unknown' }),
    ];
    const plan = planFor(tracks, 'Soul');
    const byId = new Map(plan.tracks.map((track) => [track.trackId, track]));

    expect(byId.get('quiet')!.gainDb).toBeCloseTo(6, 5);
    expect(byId.get('loud')!.gainDb).toBeCloseTo(-8, 5);
    expect(byId.get('unknown')!.gainDb).toBe(0);
  });

  it('clamps an absurd loudness measurement to +/-12 dB', () => {
    const tracks = [
      makeTrack({ id: 'silence', loudness: { integratedLufs: -70, truePeakDb: -40, loudnessRange: 1 } }),
      makeTrack({ id: 'hot', loudness: { integratedLufs: 3, truePeakDb: 1, loudnessRange: 2 } }),
      makeTrack({ id: 'broken', loudness: { integratedLufs: Number.NEGATIVE_INFINITY, truePeakDb: 0, loudnessRange: 0 } }),
    ];
    const plan = planFor(tracks, 'Soul');
    for (const track of plan.tracks) {
      expect(Number.isFinite(track.gainDb!)).toBe(true);
      expect(Math.abs(track.gainDb!)).toBeLessThanOrEqual(12);
    }
    expect(plan.tracks.find((track) => track.trackId === 'broken')!.gainDb).toBe(0);
  });

  it('notes weak tempo and key detection', () => {
    const tracks = [
      makeTrack({ id: 'weak', analysis: { bpmConfidence: 0.1, keyConfidence: 0.05, bpm: 111 } }),
      makeTrack({ id: 'strong', analysis: { bpmConfidence: 0.9, keyConfidence: 0.9 } }),
    ];
    const plan = planFor(tracks, 'Trance');
    const weak = plan.tracks.find((track) => track.trackId === 'weak')!;
    const strong = plan.tracks.find((track) => track.trackId === 'strong')!;

    expect(weak.notes.some((note) => /111 BPM/.test(note))).toBe(true);
    expect(weak.notes.some((note) => /[Kk]ey detection/.test(note))).toBe(true);
    expect(strong.notes.some((note) => /BPM was a weak match/.test(note))).toBe(false);
    expect(plan.warnings.some((warning) => /unclear tempo/.test(warning))).toBe(true);
  });

  it('carries identity fields through to the plan', () => {
    const tracks = [
      makeTrack({ id: 'a', title: 'First', artist: 'Someone', provider: 'soundcloud' }),
      makeTrack({ id: 'b', title: 'Second', provider: 'local' }),
    ];
    const plan = planFor(tracks, 'Poolside');
    const byId = new Map(plan.tracks.map((track) => [track.trackId, track]));

    expect(byId.get('a')!.title).toBe('First');
    expect(byId.get('a')!.artist).toBe('Someone');
    expect(byId.get('a')!.provider).toBe('soundcloud');
    expect(byId.get('b')!.provider).toBe('local');
    expect(plan.summary).toContain('2 tracks');
    expect(plan.summary).toContain('1 transitions');
  });

  it('trims the title but keeps a supplied one', () => {
    const tracks = makeTracks(2, 1212);
    expect(generateMixPlan({ title: '  Sunday Session  ', tracks, vibe: 'Chill' }).title).toBe('Sunday Session');
  });
});

describe('generateMixPlan — target duration accounting', () => {
  it('stays inside a target the per-track floor can accommodate', () => {
    const tracks = makeTracks(10, 1313);
    // 10 tracks x the 45s floor = 450s, so anything from 10 minutes up is
    // reachable by trimming alone.
    for (const target of [10, 20, 30]) {
      const plan = planFor(tracks, 'Peak Time', target);
      expect(plan.totalDurationSeconds, `target ${target}`).toBeLessThanOrEqual(target * 60 + 2);
    }
  });

  // DELIBERATE LIMIT: no track is ever cut below MINIMUM_PLAY_SECONDS, so ten
  // songs cannot be squeezed into five minutes. The plan overruns on purpose
  // rather than reducing the set to unrecognisable fragments — but it has to say
  // so, which the following test covers.
  it.fails('never plans a mix longer than the requested target', () => {
    const plan = planFor(makeTracks(10, 1313), 'Peak Time', 5);
    expect(plan.totalDurationSeconds).toBeLessThanOrEqual(5 * 60 + 2);
  });

  it('warns when the mix will overrun the requested target', () => {
    const plan = planFor(makeTracks(10, 1313), 'Peak Time', 5);
    expect(plan.totalDurationSeconds).toBeGreaterThan(5 * 60 + 2);
    // Overrunning silently is the part that matters: the UI shows the target.
    expect(plan.warnings.length, 'a mix that overruns its target must say so').toBeGreaterThan(0);
  });

  it('warns when the material really is shorter than the target', () => {
    const tracks = [
      makeTrack({ id: 'a', analysis: { durationSeconds: 60, usableDurationSeconds: 60 } }),
      makeTrack({ id: 'b', analysis: { durationSeconds: 60, usableDurationSeconds: 60 } }),
    ];
    const plan = planFor(tracks, 'Chill', 30);
    expect(plan.warnings.some((warning) => /longer than the usable material/.test(warning))).toBe(true);
  });

  // Every crossfade removes its own length from the finished runtime, so the
  // allocation has to cover the target plus the overlaps.
  it('lands within 30s of the requested target when there is plenty of material', () => {
    const tracks = makeTracks(10, 1414);
    const usable = tracks.reduce(
      (sum, track) => sum + Math.min(track.analysis.usableDurationSeconds, track.analysis.durationSeconds),
      0,
    );
    expect(usable).toBeGreaterThan(25 * 60);

    const plan = planFor(tracks, 'Peak Time', 25);
    expect(Math.abs(plan.totalDurationSeconds - 25 * 60)).toBeLessThanOrEqual(30);
  });

  it('does not claim a shortage of material when there is plenty', () => {
    const tracks = makeTracks(10, 1414);
    const plan = planFor(tracks, 'Peak Time', 25);
    expect(plan.warnings.some((warning) => /longer than the usable material/.test(warning))).toBe(false);
  });
});

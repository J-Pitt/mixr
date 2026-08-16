import { describe, expect, it } from 'vitest';
import { buildMixFilterGraph } from '../server/lib/render.js';
import {
  BEATS_PER_BAR,
  chooseSetTempo,
  foldTempo,
  generateMixPlan,
  tempoRatioFor,
} from '../src/lib/mixEngine.js';
import type { MixPlan, TrackInput, Vibe } from '../src/types.js';
import { makeAnalysis, makeBeatTimes, makeSegment, makeTrack } from './helpers/fixtures.js';
import { collectPlanViolations, describeViolations, violationsOf } from './helpers/planInvariants.js';
import { parseFilterComplex, parseInputArgs } from './helpers/filterGraph.js';

/** A track whose analysis carries a full beat grid, like a freshly analyzed one. */
function beatTrack(
  id: string,
  bpm: number,
  options: { durationSeconds?: number; offsetSeconds?: number; wobbleSeconds?: number; bpmConfidence?: number } = {},
): TrackInput {
  const durationSeconds = options.durationSeconds ?? 300;
  return makeTrack({
    id,
    analysis: {
      durationSeconds,
      usableDurationSeconds: durationSeconds - 20,
      introSecond: 6,
      outroSecond: durationSeconds - 14,
      bpm,
      bpmConfidence: options.bpmConfidence ?? 0.8,
      beatTimes: makeBeatTimes({
        bpm,
        durationSeconds,
        offsetSeconds: options.offsetSeconds ?? 0.37,
        wobbleSeconds: options.wobbleSeconds,
      }),
    },
  });
}

const planFor = (tracks: TrackInput[], vibe: Vibe = 'House', targetMinutes?: number) =>
  generateMixPlan({ title: 'Beat test', tracks, vibe, targetMinutes });

/**
 * Where each side of a blend sits inside its own source file at the moment the
 * blend begins. This is the whole game: if these two positions are not both on
 * a beat, the two kicks arrive a fraction apart and the handover flams.
 */
function blendStartPositions(plan: MixPlan, index: number) {
  const outgoing = plan.tracks[index];
  const incoming = plan.tracks[index + 1];
  const overlap = outgoing.transitionOut?.lengthSeconds ?? 0;
  const ratio = outgoing.tempoRatio ?? 1;

  return {
    overlap,
    outgoingSecond: outgoing.endOffsetSeconds - overlap * ratio,
    incomingSecond: incoming.startOffsetSeconds,
  };
}

/** Distance from `second` to the nearest beat on the grid. */
function beatError(beats: number[], second: number): number {
  return beats.reduce((best, beat) => Math.min(best, Math.abs(beat - second)), Infinity);
}

/** Where `second` sits between its surrounding beats, as a fraction of a beat. */
function beatPhase(beats: number[], second: number): number {
  for (let index = 0; index < beats.length - 1; index += 1) {
    if (second >= beats[index] && second < beats[index + 1]) {
      return (second - beats[index]) / (beats[index + 1] - beats[index]);
    }
  }
  return 0;
}

/** Phase gap between two tracks, in beats, wrapped into [-0.5, 0.5]. */
function phaseGap(left: number, right: number): number {
  const difference = (left - right) % 1;
  if (difference > 0.5) return difference - 1;
  if (difference < -0.5) return difference + 1;
  return difference;
}

describe('tempo folding and matching', () => {
  it.each([
    [124, 124],
    [62, 124],
    [31, 124],
    [248, 124],
    [90, 90],
    [180, 90],
  ])('folds %s BPM into the matching octave', (bpm, expected) => {
    expect(foldTempo(bpm)).toBeCloseTo(expected, 6);
  });

  it('rejects a tempo that is not a usable number', () => {
    expect(foldTempo(0)).toBe(0);
    expect(foldTempo(Number.NaN)).toBe(0);
    expect(foldTempo(-124)).toBe(0);
  });

  it('picks a set tempo from the tracks that have a grid', () => {
    const tempo = chooseSetTempo([beatTrack('a', 122), beatTrack('b', 124), beatTrack('c', 127)]);
    expect(tempo).toBeCloseTo(124, 6);
  });

  it('has no set tempo when nothing was beat tracked', () => {
    expect(chooseSetTempo([makeTrack({ id: 'a' }), makeTrack({ id: 'b' })])).toBeNull();
  });

  it('ignores tracks whose tempo estimate was a guess', () => {
    const tempo = chooseSetTempo([
      beatTrack('sure-1', 128),
      beatTrack('sure-2', 128),
      beatTrack('unsure', 96, { bpmConfidence: 0.05 }),
    ]);
    expect(tempo).toBeCloseTo(128, 6);
  });

  it('stretches a near-tempo track onto the set tempo', () => {
    const ratio = tempoRatioFor(beatTrack('a', 120).analysis, 124);
    expect(ratio).not.toBeNull();
    expect(ratio!).toBeCloseTo(124 / 120, 3);
  });

  it('matches a half-time track through the octave fold, not by halving its speed', () => {
    const ratio = tempoRatioFor(beatTrack('a', 62).analysis, 124);
    expect(ratio).toBeCloseTo(1, 3);
  });

  it('refuses a stretch big enough to hear', () => {
    expect(tempoRatioFor(beatTrack('a', 100).analysis, 124)).toBeNull();
    expect(tempoRatioFor(beatTrack('a', 145).analysis, 124)).toBeNull();
  });

  it('refuses to match a track with no beat grid', () => {
    expect(tempoRatioFor(makeAnalysis({ bpm: 124 }), 124)).toBeNull();
  });
});

describe('generateMixPlan — beat alignment', () => {
  const tracks = [beatTrack('a', 124), beatTrack('b', 126), beatTrack('c', 122), beatTrack('d', 125)];

  it('holds every structural invariant with beat-tracked material', () => {
    for (const vibe of ['House', 'Techno', 'Ambient', 'Peak Time', 'Chill'] as Vibe[]) {
      for (const target of [undefined, 8, 20]) {
        const plan = planFor(tracks, vibe, target);
        const violations = collectPlanViolations(plan, tracks);
        expect(violations, `vibe=${vibe} target=${target}\n${describeViolations(violations)}`).toEqual([]);
      }
    }
  });

  it('starts and ends every play window on a beat', () => {
    const plan = planFor(tracks);
    for (const planned of plan.tracks) {
      const beats = tracks.find((track) => track.id === planned.trackId)!.analysis.beatTimes!;
      expect(beatError(beats, planned.startOffsetSeconds)).toBeLessThan(1e-6);
      expect(beatError(beats, planned.endOffsetSeconds)).toBeLessThan(1e-6);
    }
  });

  it('gives every play window a whole number of bars', () => {
    const plan = planFor(tracks);
    for (const planned of plan.tracks) {
      const beats = tracks.find((track) => track.id === planned.trackId)!.analysis.beatTimes!;
      const first = beats.findIndex((beat) => Math.abs(beat - planned.startOffsetSeconds) < 1e-6);
      const last = beats.findIndex((beat) => Math.abs(beat - planned.endOffsetSeconds) < 1e-6);
      expect(last - first).toBeGreaterThan(0);
      expect((last - first) % BEATS_PER_BAR).toBe(0);
    }
  });

  it('starts every play window on a downbeat, not just any beat', () => {
    const plan = planFor(tracks);
    for (const planned of plan.tracks) {
      const source = tracks.find((track) => track.id === planned.trackId)!;
      const beats = source.analysis.beatTimes!;
      const origin = beats.findIndex((beat) => Math.abs(beat - source.analysis.beatOffsetSeconds) <= Math.abs(beats[0] - source.analysis.beatOffsetSeconds));
      const first = beats.findIndex((beat) => Math.abs(beat - planned.startOffsetSeconds) < 1e-6);
      expect(first).toBeGreaterThanOrEqual(0);
      expect((first - origin) % BEATS_PER_BAR).toBe(0);
    }
  });

  it('makes every blend a whole number of bars at the set tempo', () => {
    const setTempo = chooseSetTempo(tracks)!;
    const barSeconds = (60 / setTempo) * BEATS_PER_BAR;

    const plan = planFor(tracks);
    for (const planned of plan.tracks) {
      const length = planned.transitionOut?.lengthSeconds;
      if (length === undefined) continue;
      const bars = length / barSeconds;
      expect(Math.abs(bars - Math.round(bars)), `${length}s is ${bars} bars`).toBeLessThan(1e-6);
      expect(Math.round(bars)).toBeGreaterThanOrEqual(1);
    }
  });

  // The point of all of the above.
  it('has both tracks on a beat at the instant every blend starts', () => {
    for (const vibe of ['House', 'Techno', 'Peak Time', 'Golden Hour'] as Vibe[]) {
      const plan = planFor(tracks, vibe);
      for (let index = 0; index < plan.tracks.length - 1; index += 1) {
        const { overlap, outgoingSecond, incomingSecond } = blendStartPositions(plan, index);
        if (overlap <= 0) continue;

        const outgoingBeats = tracks.find((track) => track.id === plan.tracks[index].trackId)!.analysis.beatTimes!;
        const incomingBeats = tracks.find((track) => track.id === plan.tracks[index + 1].trackId)!.analysis.beatTimes!;

        expect(beatError(outgoingBeats, outgoingSecond), `${vibe} blend ${index} leaves off the grid`).toBeLessThan(0.005);
        expect(beatError(incomingBeats, incomingSecond), `${vibe} blend ${index} arrives off the grid`).toBeLessThan(0.005);
      }
    }
  });

  // Alignment at the start is worth nothing if the two tempos pull apart over
  // the ten seconds that follow, which is what happens without a tempo match.
  it('keeps both tracks within a few milliseconds of each other for the whole blend', () => {
    const plan = planFor(tracks, 'House');

    for (let index = 0; index < plan.tracks.length - 1; index += 1) {
      const outgoing = plan.tracks[index];
      const incoming = plan.tracks[index + 1];
      const overlap = outgoing.transitionOut?.lengthSeconds ?? 0;
      if (overlap <= 0) continue;

      const outgoingBeats = tracks.find((track) => track.id === outgoing.trackId)!.analysis.beatTimes!;
      const incomingBeats = tracks.find((track) => track.id === incoming.trackId)!.analysis.beatTimes!;
      const start = blendStartPositions(plan, index);

      // Walk the blend on the mix timeline, map back into each source, and
      // compare where each one sits within its own beat. Both start on a beat,
      // so any gap that opens up is the two tempos pulling apart.
      const beatSeconds = 60 / 124;
      for (let elapsed = 0; elapsed <= overlap; elapsed += 0.25) {
        const outgoingAt = start.outgoingSecond + elapsed * (outgoing.tempoRatio ?? 1);
        const incomingAt = start.incomingSecond + elapsed * (incoming.tempoRatio ?? 1);
        const drift = phaseGap(beatPhase(outgoingBeats, outgoingAt), beatPhase(incomingBeats, incomingAt));
        expect(
          Math.abs(drift) * beatSeconds,
          `blend ${index} at +${elapsed}s drifted ${Math.round(Math.abs(drift) * beatSeconds * 1000)}ms`,
        ).toBeLessThan(0.005);
      }
    }
  });

  it('reports the tempo it matched every track to', () => {
    const plan = planFor(tracks);
    const setTempo = Math.round(chooseSetTempo(tracks)!);
    for (const planned of plan.tracks) {
      expect(planned.notes.some((note) => note.includes(`${setTempo} BPM`))).toBe(true);
      expect(planned.tempoRatio).toBeGreaterThan(1 / 1.09);
      expect(planned.tempoRatio).toBeLessThan(1.09);
    }
    expect(plan.warnings.some((warning) => /beat grid|beat-match/.test(warning))).toBe(false);
  });

  it('describes locked blends in bars', () => {
    const plan = planFor(tracks);
    const rides = plan.tracks.flatMap((planned) => (planned.transitionIn ? [planned.transitionIn.reason] : []));
    expect(rides.length).toBeGreaterThan(0);
    for (const reason of rides) expect(reason).toMatch(/\d+ bars?/);
  });
});

describe('generateMixPlan — material that cannot be beat-matched', () => {
  it('leaves a track at its own tempo when the set tempo is out of reach, and says so', () => {
    const tracks = [beatTrack('house-1', 126), beatTrack('house-2', 126), beatTrack('ballad', 96)];
    const plan = planFor(tracks);
    const ballad = plan.tracks.find((track) => track.trackId === 'ballad')!;

    expect(ballad.tempoRatio).toBe(1);
    expect(plan.warnings.some((warning) => /too far from 126 BPM/.test(warning))).toBe(true);
    expect(collectPlanViolations(plan, tracks)).toEqual([]);
  });

  it('falls back to the energy-based plan when nothing was beat tracked', () => {
    const tracks = [makeTrack({ id: 'a' }), makeTrack({ id: 'b' }), makeTrack({ id: 'c' })];
    const plan = planFor(tracks);

    for (const planned of plan.tracks) expect(planned.tempoRatio).toBe(1);
    expect(plan.warnings.some((warning) => /No usable beat grid/.test(warning))).toBe(true);
    expect(collectPlanViolations(plan, tracks)).toEqual([]);
  });

  it('mixes beat-tracked and untracked material without breaking either', () => {
    const tracks = [beatTrack('tracked-1', 124), makeTrack({ id: 'untracked' }), beatTrack('tracked-2', 125)];
    const plan = planFor(tracks);
    expect(violationsOf(collectPlanViolations(plan, tracks), 'beat-alignment')).toEqual([]);
    expect(plan.tracks.find((track) => track.trackId === 'untracked')!.tempoRatio).toBe(1);
  });

  it('ignores a grid too short to align against', () => {
    const tracks = [
      makeTrack({ id: 'stub', analysis: { beatTimes: [1, 2, 3] } }),
      beatTrack('full', 124),
      beatTrack('full-2', 124),
    ];
    const plan = planFor(tracks);
    expect(plan.tracks.find((track) => track.trackId === 'stub')!.tempoRatio).toBe(1);
    expect(collectPlanViolations(plan, tracks)).toEqual([]);
  });

  it('survives a grid that wanders, without leaving a window half aligned', () => {
    const tracks = [
      beatTrack('drifty-1', 124, { wobbleSeconds: 0.02 }),
      beatTrack('drifty-2', 123, { wobbleSeconds: 0.02 }),
      beatTrack('drifty-3', 125, { wobbleSeconds: 0.02 }),
    ];
    const plan = planFor(tracks);
    const violations = collectPlanViolations(plan, tracks);
    expect(violations, describeViolations(violations)).toEqual([]);

    for (let index = 0; index < plan.tracks.length - 1; index += 1) {
      const { overlap, outgoingSecond } = blendStartPositions(plan, index);
      if (overlap <= 0) continue;
      const beats = tracks.find((track) => track.id === plan.tracks[index].trackId)!.analysis.beatTimes!;
      // A wandering grid cannot do better than the wander itself.
      expect(beatError(beats, outgoingSecond)).toBeLessThan(0.05);
    }
  });

  it('keeps short tracks safe when a bar will not fit', () => {
    const tracks = [
      beatTrack('short-1', 124, { durationSeconds: 20 }),
      beatTrack('short-2', 124, { durationSeconds: 16 }),
      beatTrack('short-3', 124, { durationSeconds: 14 }),
    ];
    for (const target of [undefined, 0.2, 1]) {
      const plan = generateMixPlan({ title: 'shorties', tracks, vibe: 'Techno', targetMinutes: target });
      const violations = collectPlanViolations(plan, tracks);
      expect(violations, `target=${target}\n${describeViolations(violations)}`).toEqual([]);
    }
  });
});

describe('buildMixFilterGraph — tempo matching', () => {
  it('reads more source than it plays when a track is sped up', () => {
    const graph = buildMixFilterGraph(
      [makeSegment({ playDurationSeconds: 100, tempoRatio: 1.02, transitionOutSeconds: 0 })],
      'House',
    );
    const [input] = parseInputArgs(graph.inputArgs);
    expect(input.duration).toBeCloseTo(102, 3);
  });

  it('reads less source when a track is slowed down', () => {
    const graph = buildMixFilterGraph(
      [makeSegment({ playDurationSeconds: 100, tempoRatio: 0.98, transitionOutSeconds: 0 })],
      'House',
    );
    const [input] = parseInputArgs(graph.inputArgs);
    expect(input.duration).toBeCloseTo(98, 3);
  });

  it('applies atempo before the level and tone stages', () => {
    const graph = buildMixFilterGraph(
      [makeSegment({ gainDb: -2, tempoRatio: 1.0325, transitionOutSeconds: 0 })],
      'Warm Up',
    );
    const [chain] = parseFilterComplex(graph.filterComplex);
    const tempoStage = chain.filters.findIndex((filter) => filter === 'atempo=1.0325');
    const volumeStage = chain.filters.findIndex((filter) => filter.startsWith('volume='));
    expect(tempoStage).toBeGreaterThan(0);
    expect(volumeStage).toBeGreaterThan(tempoStage);
  });

  it('leaves a track that already matches untouched', () => {
    for (const tempoRatio of [1, undefined]) {
      const graph = buildMixFilterGraph([makeSegment({ tempoRatio, transitionOutSeconds: 0 })], 'House');
      expect(graph.filterComplex).not.toContain('atempo');
      expect(parseInputArgs(graph.inputArgs)[0].duration).toBeCloseTo(180, 3);
    }
  });

  it('ignores a nonsensical rate rather than emitting a broken filter', () => {
    for (const tempoRatio of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const graph = buildMixFilterGraph([makeSegment({ tempoRatio, transitionOutSeconds: 0 })], 'House');
      expect(graph.filterComplex).not.toContain('atempo');
      expect(parseInputArgs(graph.inputArgs)[0].duration).toBeCloseTo(180, 3);
    }
  });
});

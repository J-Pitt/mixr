import type { EnergySlice, LoudnessMeasurement, Provider, TrackAnalysis, TrackInput } from '../../src/types.js';
import type { RenderSegment } from '../../server/lib/render.js';

/** Deterministic LCG so "random" fixtures reproduce on every run. */
export function makeRng(seed: number): () => number {
  let state = (seed >>> 0) || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

export interface SliceOptions {
  seconds: number;
  baseEnergy?: number;
  baseBrightness?: number;
  rng?: () => number;
}

/** Builds one energy slice per second, with values kept inside [0,1]. */
export function makeSlices({ seconds, baseEnergy = 0.6, baseBrightness = 0.5, rng }: SliceOptions): EnergySlice[] {
  const next = rng ?? makeRng(7);
  const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
  return Array.from({ length: Math.max(0, Math.floor(seconds)) }, (_unused, second) => {
    const energy = clamp01(baseEnergy + (next() - 0.5) * 0.3);
    const brightness = clamp01(baseBrightness + (next() - 0.5) * 0.3);
    return {
      second,
      energy,
      brightness,
      transitionScore: clamp01((1 - energy) * 0.65 + brightness * 0.35),
    };
  });
}

/**
 * A beat grid like the tracker produces: an arbitrary starting phase, a slight
 * wobble, and beats that stop short of the end of the file.
 */
export function makeBeatTimes({
  bpm = 124,
  durationSeconds = 240,
  offsetSeconds = 0.37,
  wobbleSeconds = 0,
  rng,
}: {
  bpm?: number;
  durationSeconds?: number;
  offsetSeconds?: number;
  wobbleSeconds?: number;
  rng?: () => number;
} = {}): number[] {
  const next = rng ?? makeRng(11);
  const period = 60 / bpm;
  const beats: number[] = [];
  for (let second = offsetSeconds; second <= durationSeconds - period; second += period) {
    const wobble = wobbleSeconds === 0 ? 0 : (next() - 0.5) * 2 * wobbleSeconds;
    beats.push(Math.round(Math.max(0, second + wobble) * 1000) / 1000);
  }
  return beats;
}

export function makeAnalysis(overrides: Partial<TrackAnalysis> = {}): TrackAnalysis {
  const durationSeconds = overrides.durationSeconds ?? 240;
  const wholeSeconds = Math.max(1, Math.floor(durationSeconds));
  const introSecond = overrides.introSecond ?? Math.min(8, Math.max(0, wholeSeconds - 1));
  const outroSecond = overrides.outroSecond ?? Math.max(introSecond + 1, wholeSeconds - 10);
  const averageEnergy = overrides.averageEnergy ?? 0.6;
  const averageBrightness = overrides.averageBrightness ?? 0.5;

  return {
    version: overrides.version,
    durationSeconds,
    usableDurationSeconds:
      overrides.usableDurationSeconds ?? Math.max(1, Math.min(durationSeconds, outroSecond - introSecond)),
    bpm: overrides.bpm ?? 124,
    bpmConfidence: overrides.bpmConfidence ?? 0.8,
    beatOffsetSeconds: overrides.beatOffsetSeconds ?? 0.25,
    // Absent by default: most fixtures predate beat tracking, and the planner
    // has to keep working for tracks whose pulse could not be followed.
    beatTimes: overrides.beatTimes,
    key: overrides.key ?? 'Am',
    keyConfidence: overrides.keyConfidence ?? 0.7,
    averageEnergy,
    averageBrightness,
    introSecond,
    outroSecond,
    // Empty by default so play windows are exactly the allocation; tests that
    // exercise snapping pass explicit moments.
    transitionMoments: overrides.transitionMoments ?? [],
    slices:
      overrides.slices ??
      makeSlices({ seconds: wholeSeconds, baseEnergy: averageEnergy, baseBrightness: averageBrightness }),
  };
}

export interface TrackOptions {
  id?: string;
  title?: string;
  artist?: string;
  provider?: Provider;
  loudness?: LoudnessMeasurement | null;
  analysis?: Partial<TrackAnalysis>;
}

let autoId = 0;

export function makeTrack(options: TrackOptions = {}): TrackInput {
  autoId += 1;
  const id = options.id ?? `track-${autoId}`;
  const track: TrackInput = {
    id,
    title: options.title ?? `Song ${id}`,
    provider: options.provider ?? 'youtube',
    analysis: makeAnalysis(options.analysis),
  };
  if (options.artist !== undefined) track.artist = options.artist;
  if (options.loudness) track.loudness = options.loudness;
  return track;
}

/** N tracks with spread-out analysis values, deterministic for a given seed. */
export function makeTracks(count: number, seed = 42, overrides: Partial<TrackAnalysis> = {}): TrackInput[] {
  const rng = makeRng(seed);
  return Array.from({ length: count }, (_unused, index) => {
    const durationSeconds = 150 + Math.floor(rng() * 180);
    const energy = 0.15 + rng() * 0.8;
    const brightness = 0.1 + rng() * 0.85;
    return makeTrack({
      id: `t${index.toString().padStart(2, '0')}`,
      title: `Track ${index}`,
      analysis: {
        durationSeconds,
        bpm: 88 + Math.floor(rng() * 70),
        bpmConfidence: 0.4 + rng() * 0.6,
        averageEnergy: Math.min(1, energy),
        averageBrightness: Math.min(1, brightness),
        keyConfidence: 0.3 + rng() * 0.7,
        ...overrides,
      },
    });
  });
}

export function makeSegment(overrides: Partial<RenderSegment> = {}): RenderSegment {
  return {
    mediaPath: overrides.mediaPath ?? '/tmp/mixr/a.flac',
    startOffsetSeconds: overrides.startOffsetSeconds ?? 12,
    playDurationSeconds: overrides.playDurationSeconds ?? 180,
    gainDb: overrides.gainDb ?? 0,
    transitionInSeconds: overrides.transitionInSeconds,
    transitionOutSeconds: overrides.transitionOutSeconds ?? 8,
    tempoRatio: overrides.tempoRatio,
  };
}

/** N segments whose transitionOut is zero on the final one, like a real plan. */
export function makeSegments(count: number, transitionSeconds = 8): RenderSegment[] {
  return Array.from({ length: count }, (_unused, index) =>
    makeSegment({
      mediaPath: `/tmp/mixr/track-${index}.flac`,
      startOffsetSeconds: index * 3,
      playDurationSeconds: 120 + index * 10,
      gainDb: index % 2 === 0 ? 0 : -1.5,
      transitionInSeconds: index === 0 ? 0 : transitionSeconds,
      transitionOutSeconds: index === count - 1 ? 0 : transitionSeconds,
    }),
  );
}

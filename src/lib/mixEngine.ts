// The .js extension keeps this file importable by the Node server (NodeNext)
// as well as by Vite, since it is shared between both.
import type { MixPlan, MixPlanTrack, TrackAnalysis, TrackInput, Vibe } from '../types.js';

/**
 * Tonal archetype for a vibe. Each maps to a small, gentle ffmpeg EQ chain so
 * the written guidance and the rendered audio cannot drift apart.
 */
export type Tone = 'natural' | 'warm' | 'bright' | 'deep' | 'tight' | 'airy';

export interface VibeProfile {
  eq: string;
  transitionStyle: string;
  transitionRange: [number, number];
  order: 'lift' | 'cruise' | 'peak' | 'dark' | 'moody';
  tone: Tone;
}

export const vibeProfiles: Record<Vibe, VibeProfile> = {
  // ── Time of day ────────────────────────────────────────────────────────────
  'Warm Up': {
    eq: 'Ease the sub slightly, keep mids open, add a gentle high lift as the set climbs.',
    transitionStyle: 'long blend',
    transitionRange: [10, 14],
    order: 'lift',
    tone: 'natural',
  },
  'Sunrise': {
    eq: 'Soft sub, airy highs, minimal mid presence — let the room breathe.',
    transitionStyle: 'gentle dissolve',
    transitionRange: [12, 16],
    order: 'lift',
    tone: 'airy',
  },
  'Morning Coffee': {
    eq: 'Warm low-mids, light sparkle, restrained sub — intimate and clean.',
    transitionStyle: 'slow crossfade',
    transitionRange: [10, 14],
    order: 'cruise',
    tone: 'warm',
  },
  'Midday Drive': {
    eq: 'Punchy lows, presence boost around 3 kHz, a slight high-shelf lift.',
    transitionStyle: 'smooth handoff',
    transitionRange: [8, 12],
    order: 'cruise',
    tone: 'tight',
  },
  'Golden Hour': {
    eq: 'Warm, rich low-mids, softened highs, gentle presence — cinematic feel.',
    transitionStyle: 'silky crossfade',
    transitionRange: [10, 14],
    order: 'cruise',
    tone: 'warm',
  },
  'Sunset Cruise': {
    eq: 'Keep the low mids warm, soften the top end, and let vocals sit forward.',
    transitionStyle: 'silky crossfade',
    transitionRange: [10, 14],
    order: 'cruise',
    tone: 'warm',
  },
  'Blue Hour': {
    eq: 'Deepen the sub, reduce upper-mid harshness, keep highs hazy.',
    transitionStyle: 'slow fade-in',
    transitionRange: [10, 14],
    order: 'dark',
    tone: 'deep',
  },
  'Peak Time': {
    eq: 'Tighten the lows, push presence around the mids, and keep the highs crisp.',
    transitionStyle: 'quick energy handoff',
    transitionRange: [6, 10],
    order: 'peak',
    tone: 'tight',
  },
  'Late Night': {
    eq: 'Roll off some sparkle, lean into sub weight, and keep the center image focused.',
    transitionStyle: 'smoked blend',
    transitionRange: [8, 12],
    order: 'dark',
    tone: 'deep',
  },
  'After Hours': {
    eq: 'Tuck the mids, deepen the low bed, and keep the highs restrained.',
    transitionStyle: 'patient fade',
    transitionRange: [8, 12],
    order: 'moody',
    tone: 'deep',
  },
  'Deep Night': {
    eq: 'Full sub extension, roll off above 8 kHz, mono-compatible low-end.',
    transitionStyle: 'dark dissolve',
    transitionRange: [10, 14],
    order: 'moody',
    tone: 'deep',
  },
  // ── Season & outdoors ───────────────────────────────────────────────────────
  'Spring Bloom': {
    eq: 'Bright, airy highs, light sub, forward mids — optimistic and open.',
    transitionStyle: 'breezy crossfade',
    transitionRange: [10, 14],
    order: 'lift',
    tone: 'airy',
  },
  'Summer Heat': {
    eq: 'Deep sub, scooped mids, sizzling highs — wide and energetic.',
    transitionStyle: 'quick energy handoff',
    transitionRange: [6, 10],
    order: 'peak',
    tone: 'bright',
  },
  'Festival': {
    eq: 'Maximum sub extension, pushed presence, crisp air — built for outdoor PA.',
    transitionStyle: 'hard cut',
    transitionRange: [4, 8],
    order: 'peak',
    tone: 'bright',
  },
  'Beach Party': {
    eq: 'Bright, percussive highs, light sub, forward rhythm — fun and loose.',
    transitionStyle: 'sunny blend',
    transitionRange: [8, 12],
    order: 'cruise',
    tone: 'bright',
  },
  'Poolside': {
    eq: 'Warm mids, soft sub, gentle high shelf — relaxed and spacious.',
    transitionStyle: 'slow crossfade',
    transitionRange: [10, 14],
    order: 'cruise',
    tone: 'warm',
  },
  'Autumn Rain': {
    eq: 'Rolled-off highs, warm mids, modest sub — intimate and reflective.',
    transitionStyle: 'melancholy fade',
    transitionRange: [10, 14],
    order: 'moody',
    tone: 'warm',
  },
  'Winter Chill': {
    eq: 'Crystalline highs, thin sub, cool upper-mids — sparse and clear.',
    transitionStyle: 'slow dissolve',
    transitionRange: [12, 16],
    order: 'dark',
    tone: 'airy',
  },
  'Cozy Cabin': {
    eq: 'Warm low-mids, reduced harsh frequencies, intimate reverb character.',
    transitionStyle: 'gentle crossfade',
    transitionRange: [10, 14],
    order: 'cruise',
    tone: 'warm',
  },
  // ── Genre & sound ───────────────────────────────────────────────────────────
  'House': {
    eq: 'Four-on-the-floor punch, 200 Hz warmth, gentle high-hat sizzle.',
    transitionStyle: 'phrase-locked blend',
    transitionRange: [8, 12],
    order: 'lift',
    tone: 'tight',
  },
  'Techno': {
    eq: 'Tight sub, scooped low-mids, industrial high presence, mono bass.',
    transitionStyle: 'hard cut',
    transitionRange: [4, 8],
    order: 'peak',
    tone: 'tight',
  },
  'Ambient': {
    eq: 'Rolled-off lows, spacious mids, shimmer in the highs — minimal attack.',
    transitionStyle: 'long dissolve',
    transitionRange: [14, 20],
    order: 'moody',
    tone: 'airy',
  },
  'Hip-Hop': {
    eq: 'Deep sub, punchy low-mid snap, presence on the vocal range.',
    transitionStyle: 'bar-locked cut',
    transitionRange: [6, 10],
    order: 'cruise',
    tone: 'deep',
  },
  'R&B': {
    eq: 'Warm sub, forward vocals at 2–4 kHz, gentle high-shelf smoothness.',
    transitionStyle: 'silky blend',
    transitionRange: [8, 12],
    order: 'cruise',
    tone: 'warm',
  },
  'Afrobeats': {
    eq: 'Punchy mid-bass, bright percussion, forward mid presence, wide stereo.',
    transitionStyle: 'rhythmic handoff',
    transitionRange: [6, 10],
    order: 'lift',
    tone: 'bright',
  },
  'Latin': {
    eq: 'Lively percussion highs, warm guitar mids, punchy but not heavy bass.',
    transitionStyle: 'rhythmic blend',
    transitionRange: [6, 10],
    order: 'lift',
    tone: 'bright',
  },
  'Reggae': {
    eq: 'Deep bass, scooped upper-mids, laid-back attack — roots and dub.',
    transitionStyle: 'dub fade',
    transitionRange: [10, 14],
    order: 'cruise',
    tone: 'deep',
  },
  'Jazz': {
    eq: 'Natural mids, warm brush presence, gentle sub, no harshness in the highs.',
    transitionStyle: 'conversational blend',
    transitionRange: [8, 12],
    order: 'moody',
    tone: 'natural',
  },
  'Soul': {
    eq: 'Warm body, forward vocal mids, cushioned low end, organic feel.',
    transitionStyle: 'warm crossfade',
    transitionRange: [8, 12],
    order: 'cruise',
    tone: 'warm',
  },
  'Funk': {
    eq: 'Snappy attack, forward rhythm guitar range, punchy bass, lively highs.',
    transitionStyle: 'groove handoff',
    transitionRange: [6, 10],
    order: 'lift',
    tone: 'tight',
  },
  'Drum & Bass': {
    eq: 'Ultra-tight sub, aggressive mids, hyper-detailed high-end, maximum clarity.',
    transitionStyle: 'stepper cut',
    transitionRange: [4, 8],
    order: 'peak',
    tone: 'tight',
  },
  'Trance': {
    eq: 'Lifted highs, punchy kick sub, open mids — euphoric and wide.',
    transitionStyle: 'energy ramp',
    transitionRange: [8, 12],
    order: 'lift',
    tone: 'bright',
  },
  // ── Mood & energy ───────────────────────────────────────────────────────────
  'Chill': {
    eq: 'Low-shelf boost, reduced upper-mids, smooth highs — easy and warm.',
    transitionStyle: 'soft crossfade',
    transitionRange: [10, 14],
    order: 'cruise',
    tone: 'warm',
  },
  'Hype': {
    eq: 'Maximum punch, boosted presence, bright air, tight mono sub.',
    transitionStyle: 'hard cut',
    transitionRange: [4, 8],
    order: 'peak',
    tone: 'bright',
  },
  'Melancholy': {
    eq: 'Reduced brightness, forward lower-mids, subtle sub — introspective weight.',
    transitionStyle: 'slow fade',
    transitionRange: [12, 16],
    order: 'moody',
    tone: 'warm',
  },
  'Euphoric': {
    eq: 'Lifted highs, open mids, punchy sub — emotional and wide.',
    transitionStyle: 'uplift blend',
    transitionRange: [8, 12],
    order: 'lift',
    tone: 'bright',
  },
  'Romantic': {
    eq: 'Warm body, smooth highs, gentle sub, forward vocal presence.',
    transitionStyle: 'tender crossfade',
    transitionRange: [10, 14],
    order: 'cruise',
    tone: 'warm',
  },
  'Introspective': {
    eq: 'Recessed highs, soft attack, midrange warmth — space between notes.',
    transitionStyle: 'patient dissolve',
    transitionRange: [12, 16],
    order: 'moody',
    tone: 'natural',
  },
  'Dark': {
    eq: 'Scooped mids, heavy sub, rolled-off air — brooding and dense.',
    transitionStyle: 'dark blend',
    transitionRange: [8, 12],
    order: 'dark',
    tone: 'deep',
  },
  'Uplifting': {
    eq: 'High-shelf boost, open presence, punchy lows — joyful and bright.',
    transitionStyle: 'rising blend',
    transitionRange: [8, 12],
    order: 'lift',
    tone: 'bright',
  },
};

/** Relative energy of each vibe, used to blend several into one profile. */
const vibeEnergyScale: Record<Vibe, number> = {
  'Ambient': 1, 'Introspective': 1, 'Melancholy': 1, 'Deep Night': 1, 'Winter Chill': 1,
  'Sunrise': 2, 'Morning Coffee': 2, 'Cozy Cabin': 2, 'Autumn Rain': 2, 'Jazz': 2,
  'Warm Up': 2, 'Chill': 2, 'Reggae': 2,
  'Sunset Cruise': 3, 'Golden Hour': 3, 'Blue Hour': 3, 'Poolside': 3, 'Romantic': 3,
  'Soul': 3, 'R&B': 3, 'Midday Drive': 3, 'Hip-Hop': 3, 'Funk': 3,
  'Late Night': 3, 'After Hours': 3, 'Dark': 3,
  'Spring Bloom': 4, 'Beach Party': 4, 'House': 4, 'Afrobeats': 4, 'Latin': 4,
  'Trance': 4, 'Uplifting': 4, 'Euphoric': 4,
  'Summer Heat': 5, 'Peak Time': 5, 'Techno': 5, 'Drum & Bass': 5,
  'Festival': 5, 'Hype': 5,
};

export const allVibes = Object.keys(vibeProfiles) as Vibe[];

/**
 * Collapses a multi-select of vibes into the single profile whose energy sits
 * closest to their average, so sequencing and EQ have one source of truth.
 */
export function resolveVibe(vibes: Vibe[]): Vibe {
  if (vibes.length === 0) return 'Peak Time';
  if (vibes.length === 1) return vibes[0];

  const average = vibes.reduce((total, vibe) => total + vibeEnergyScale[vibe], 0) / vibes.length;

  // Prefer one of the chosen vibes over an unrelated one that happens to match
  // the average, which is what the original implementation did.
  return vibes.reduce((best, vibe) =>
    Math.abs(vibeEnergyScale[vibe] - average) < Math.abs(vibeEnergyScale[best] - average) ? vibe : best,
  vibes[0]);
}

/** Gentle mastering-style EQ per tone. Nothing here exceeds 2.5 dB. */
const TONE_FILTERS: Record<Tone, string[]> = {
  natural: [],
  warm: ['equalizer=f=200:t=q:w=1.1:g=1.5', 'equalizer=f=3200:t=q:w=1.2:g=-1', 'treble=f=8000:g=-1'],
  bright: ['equalizer=f=3000:t=q:w=1.2:g=1', 'treble=f=8000:g=2'],
  deep: ['equalizer=f=60:t=q:w=1:g=2', 'equalizer=f=2500:t=q:w=1.5:g=-1.5', 'treble=f=9000:g=-2'],
  tight: ['highpass=f=28', 'equalizer=f=100:t=q:w=1.2:g=1.5', 'equalizer=f=400:t=q:w=1.5:g=-1'],
  airy: ['highpass=f=35', 'equalizer=f=250:t=q:w=1.2:g=-1', 'treble=f=10000:g=2.5'],
};

/** Loudness target for the finished mix, matching common streaming levels. */
export const TARGET_LUFS = -14;

const MIN_BODY_SECONDS = 8;
const MIN_TRANSITION_SECONDS = 2;
const MINIMUM_PLAY_SECONDS = 45;

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** ffmpeg EQ chain for a vibe, used by the renderer. */
export function eqFiltersFor(vibe: Vibe): string[] {
  return [...TONE_FILTERS[vibeProfiles[vibe].tone]];
}

/**
 * Maps the written transition style onto an acrossfade curve.
 *
 * Every option here holds roughly constant power across the blend. Curves like
 * `exp` and `log` are equal-*gain*: two unrelated tracks summed through one dip
 * by about 3 dB halfway through, which is the audible sag that makes a
 * crossfade sound like a mistake rather than a mix.
 */
export function crossfadeCurveFor(style: string): string {
  const normalized = style.toLowerCase();
  // A cut is short and percussive, so the steeper of the constant-power pair
  // gets the outgoing track out of the way quickly.
  if (normalized.includes('cut')) return 'qsin';
  if (normalized.includes('dissolve') || normalized.includes('fade')) return 'hsin';
  return 'qsin';
}

/** 4/4 is assumed throughout: every blend is a whole number of four-beat bars. */
export const BEATS_PER_BAR = 4;

/**
 * Widest time-stretch used to beat-match a track. Past roughly this much the
 * stretch stops being transparent, so the track keeps its own tempo instead.
 */
const MAX_TEMPO_STRETCH = 1.08;

/** Tempos are folded into this octave, so a 76 BPM track can lock to a 152 BPM set. */
const TEMPO_FOLD_MIN = 82;

/** Below this the tempo estimate is too weak to beat-match against. */
const MIN_TEMPO_CONFIDENCE = 0.3;

/** Fewer beats than this and there is no grid worth aligning to. */
const MIN_TRACKED_BEATS = 8;

/** Collapses a tempo into a single octave so half-time tracks can still match. */
export function foldTempo(bpm: number): number {
  if (!Number.isFinite(bpm) || bpm <= 0) return 0;
  let folded = bpm;
  while (folded < TEMPO_FOLD_MIN) folded *= 2;
  while (folded >= TEMPO_FOLD_MIN * 2) folded /= 2;
  return folded;
}

/** The tracked beat grid, or null when this track has none worth using. */
function beatGrid(analysis: TrackAnalysis): number[] | null {
  const beats = analysis.beatTimes;
  return beats && beats.length >= MIN_TRACKED_BEATS ? beats : null;
}

/** Index of the beat closest to `second`. The grid is ascending, so binary search. */
function nearestBeatIndex(beats: number[], second: number): number {
  let low = 0;
  let high = beats.length - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (beats[middle] < second) low = middle + 1;
    else high = middle;
  }
  if (low > 0 && Math.abs(beats[low - 1] - second) <= Math.abs(beats[low] - second)) return low - 1;
  return low;
}

/** Index of the first beat at or after `second`, or -1 when there is none. */
function beatIndexAtOrAfter(beats: number[], second: number): number {
  const nearest = nearestBeatIndex(beats, second);
  if (beats[nearest] >= second - 1e-9) return nearest;
  return nearest + 1 < beats.length ? nearest + 1 : -1;
}

/**
 * One tempo for the whole set, so every track's bars are the same length and a
 * blend that starts locked stays locked. Tracks that cannot be stretched to it
 * keep their own tempo and simply do not get beat-matched.
 */
export function chooseSetTempo(tracks: TrackInput[]): number | null {
  const candidates = tracks
    .filter((track) => beatGrid(track.analysis) && track.analysis.bpmConfidence >= MIN_TEMPO_CONFIDENCE)
    .map((track) => foldTempo(track.analysis.bpm))
    .filter((bpm) => bpm > 0)
    .sort((left, right) => left - right);

  if (candidates.length === 0) return null;
  // Lower median, so the choice is deterministic for an even count.
  return candidates[Math.floor((candidates.length - 1) / 2)];
}

/**
 * Playback rate that puts this track on the set tempo, or null when it cannot
 * get there without an audible stretch. Null and a ratio of 1 mean different
 * things: the first says this track will never be locked to its neighbours.
 */
export function tempoRatioFor(analysis: TrackAnalysis, setTempo: number | null): number | null {
  if (!setTempo || !beatGrid(analysis) || analysis.bpmConfidence < MIN_TEMPO_CONFIDENCE) return null;

  const folded = foldTempo(analysis.bpm);
  if (folded <= 0) return null;

  const ratio = setTempo / folded;
  if (ratio > MAX_TEMPO_STRETCH || ratio < 1 / MAX_TEMPO_STRETCH) return null;
  return Math.round(ratio * 10_000) / 10_000;
}

/** Which beat of the bar the tracked grid treats as the downbeat. */
function downbeatPhase(beats: number[], analysis: TrackAnalysis): number {
  const origin = nearestBeatIndex(beats, analysis.beatOffsetSeconds);
  return ((origin % BEATS_PER_BAR) + BEATS_PER_BAR) % BEATS_PER_BAR;
}

/** First downbeat at or after `second`, or -1 when the grid runs out. */
function downbeatIndexAtOrAfter(beats: number[], second: number, analysis: TrackAnalysis): number {
  const startIndex = beatIndexAtOrAfter(beats, second);
  if (startIndex === -1) return -1;

  const phase = downbeatPhase(beats, analysis);
  const remainder = (((startIndex - phase) % BEATS_PER_BAR) + BEATS_PER_BAR) % BEATS_PER_BAR;
  const aligned = remainder === 0 ? startIndex : startIndex + (BEATS_PER_BAR - remainder);
  return aligned < beats.length ? aligned : -1;
}

/**
 * Moves a play window onto the beat grid: it starts on a downbeat and lasts a
 * whole number of bars. Starting on a downbeat lines the incoming kick *and*
 * snare up with the outgoing phrase; a whole number of bars keeps that lock
 * for the length of the blend.
 */
function alignWindowToBeats(
  analysis: TrackAnalysis,
  startSecond: number,
  endSecond: number,
): { start: number; end: number } | null {
  const beats = beatGrid(analysis);
  if (!beats) return null;

  // Only ever move the start forward: reaching back would pull in material the
  // planner deliberately skipped.
  const startIndex = downbeatIndexAtOrAfter(beats, startSecond, analysis);
  if (startIndex === -1) return null;

  const available = beats.length - 1 - startIndex;
  let beatCount = Math.round((nearestBeatIndex(beats, endSecond) - startIndex) / BEATS_PER_BAR) * BEATS_PER_BAR;
  beatCount = Math.min(beatCount, Math.floor(available / BEATS_PER_BAR) * BEATS_PER_BAR);

  // The tracked grid can end before the file does, and the last beat can sit
  // fractionally past the decoded length.
  while (beatCount >= BEATS_PER_BAR && beats[startIndex + beatCount] > analysis.durationSeconds) {
    beatCount -= BEATS_PER_BAR;
  }
  if (beatCount < BEATS_PER_BAR) return null;

  return { start: beats[startIndex], end: beats[startIndex + beatCount] };
}

/**
 * Rounds a blend to whole bars, preferring a length the vibe still asked for.
 * A blend that is not a whole number of bars puts the two tracks a fraction of
 * a beat apart for its entire length, which is the classic smeared handover.
 */
function quantizeBlendToBars(seconds: number, barSeconds: number, min: number, max: number): number {
  if (barSeconds <= 0) return seconds;

  const bars = Math.max(1, Math.round(seconds / barSeconds));
  for (const candidate of [bars, bars - 1, bars + 1, bars - 2, bars + 2]) {
    if (candidate < 1) continue;
    const length = candidate * barSeconds;
    if (length >= min && length <= max) return length;
  }
  return bars * barSeconds;
}

/** Explains a blend in bars once it is locked to the grid, and in seconds when it is not. */
function describeBlend(
  lengthSeconds: number,
  barSeconds: number,
  locked: boolean,
  analysis: TrackAnalysis,
): string {
  const rounded = Math.round(lengthSeconds * 10) / 10;
  if (locked && barSeconds > 0) {
    const bars = Math.max(1, Math.round(lengthSeconds / barSeconds));
    return `Rides in over ${bars} bar${bars === 1 ? '' : 's'} (${rounded}s), beat-locked in ${analysis.key}.`;
  }
  return `Rides in over ${rounded}s at ${analysis.bpm} BPM in ${analysis.key}.`;
}

const orderRank = (analysis: TrackAnalysis, vibe: Vibe) => {
  switch (vibeProfiles[vibe].order) {
    case 'lift':
      return analysis.averageEnergy * 0.65 + (analysis.bpm / 160) * 0.35;
    case 'cruise':
      return analysis.averageBrightness * 0.35 + analysis.averageEnergy * 0.65;
    case 'peak':
      return analysis.averageEnergy * 0.6 + (analysis.bpm / 160) * 0.4;
    case 'dark':
      return analysis.averageEnergy * 0.55 + (1 - analysis.averageBrightness) * 0.45;
    case 'moody':
      return (1 - analysis.averageBrightness) * 0.55 + (analysis.bpm / 160) * 0.45;
  }
};

const transitionCompatibility = (current: TrackAnalysis, next: TrackAnalysis, vibe: Vibe) => {
  const bpmGap = Math.abs(current.bpm - next.bpm) / 50;
  const energyGap = Math.abs(current.averageEnergy - next.averageEnergy);
  const brightnessGap = Math.abs(current.averageBrightness - next.averageBrightness);
  const orderPenalty = (() => {
    switch (vibeProfiles[vibe].order) {
      case 'lift':
        return next.averageEnergy < current.averageEnergy ? 0.4 : 0;
      case 'peak':
        return next.averageEnergy + 0.05 < current.averageEnergy ? 0.35 : 0;
      case 'dark':
      case 'moody':
        return next.averageBrightness > current.averageBrightness + 0.12 ? 0.3 : 0;
      case 'cruise':
        return next.averageEnergy < current.averageEnergy - 0.2 ? 0.25 : 0;
    }
  })();

  return bpmGap * 0.45 + energyGap * 0.35 + brightnessGap * 0.2 + orderPenalty;
};

/**
 * Seeds with the best opener for the vibe, then repeatedly picks whichever
 * remaining track blends most cleanly out of the current one.
 */
export function orderTracks(tracks: TrackInput[], vibe: Vibe): TrackInput[] {
  const pending = [...tracks];
  if (pending.length < 2) return pending;

  // A comparator must return 0 for ties, otherwise the sort is inconsistent and
  // the resulting order is undefined.
  pending.sort((left, right) => {
    const difference = orderRank(left.analysis, vibe) - orderRank(right.analysis, vibe);
    if (difference !== 0) return difference;
    return left.id.localeCompare(right.id);
  });

  const ordered: TrackInput[] = [pending.shift()!];
  while (pending.length > 0) {
    const current = ordered[ordered.length - 1].analysis;
    let bestIndex = 0;
    let bestScore = Infinity;
    pending.forEach((candidate, index) => {
      const score = transitionCompatibility(current, candidate.analysis, vibe);
      if (score < bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    });
    ordered.push(pending.splice(bestIndex, 1)[0]);
  }

  return ordered;
}

/**
 * Distributes a target runtime across tracks, trimming proportionally from
 * whatever has the most room to give.
 */
export function allocateDurations(tracks: TrackInput[], targetMinutes?: number): number[] {
  const durations = tracks.map((track) =>
    Math.max(1, Math.min(track.analysis.usableDurationSeconds, track.analysis.durationSeconds)),
  );
  const total = durations.reduce((sum, value) => sum + value, 0);

  if (!targetMinutes || !Number.isFinite(targetMinutes) || targetMinutes <= 0) return durations;

  const target = targetMinutes * 60;
  if (target >= total) return durations;

  const floor = Math.min(MINIMUM_PLAY_SECONDS, Math.min(...durations));
  if (target <= floor * tracks.length) return durations.map(() => floor);

  const allocated = [...durations];
  let remainingCut = total - target;

  // Guard the loop: each pass must remove something, and rounding is applied
  // only to the final result so the target is not overshot.
  let guard = 0;
  while (remainingCut > 0.5 && guard < 1000) {
    guard += 1;
    const adjustable = allocated
      .map((value, index) => ({ value, index }))
      .filter((entry) => entry.value > floor + 1e-6);
    if (adjustable.length === 0) break;

    const capacity = adjustable.reduce((sum, entry) => sum + (entry.value - floor), 0);
    if (capacity <= 1e-6) break;

    const cutThisPass = Math.min(remainingCut, capacity);
    for (const entry of adjustable) {
      const share = ((entry.value - floor) / capacity) * cutThisPass;
      const cut = Math.min(entry.value - floor, share);
      allocated[entry.index] -= cut;
      remainingCut -= cut;
    }
  }

  return allocated.map((value) => Math.max(1, Math.round(value)));
}

const buildTransitionLength = (fromTrack: TrackAnalysis, toTrack: TrackAnalysis, vibe: Vibe) => {
  const [min, max] = vibeProfiles[vibe].transitionRange;
  const bpmGap = Math.abs(fromTrack.bpm - toTrack.bpm);
  // Close tempos can hold a longer blend; distant ones need to get on with it.
  const bias = bpmGap < 8 ? 2 : bpmGap > 20 ? -1 : 0;
  return clamp(Math.round((min + max) / 2 + bias), min, max);
};

/**
 * Every track has to be long enough to host the blend coming in, the blend
 * going out, and some untouched body in between. Without this, chained
 * crossfades would overlap each other and the render would be mush.
 */
export function normalizeTransitions(playDurations: number[], rawLengths: number[]): number[] {
  const lengths = rawLengths.map((length) => Math.max(0, Math.round(length)));

  for (let pass = 0; pass < 12; pass += 1) {
    let changed = false;

    for (let index = 0; index < playDurations.length; index += 1) {
      const incoming = index > 0 ? lengths[index - 1] : 0;
      const outgoing = index < lengths.length ? lengths[index] : 0;
      const used = incoming + outgoing;
      if (used <= 0) continue;

      // Reserve untouched body in the middle of the track, but never demand
      // more of it than a short track can actually give. Enforcing a fixed
      // minimum here would hand a 3s track a 2s blend on each side, and chained
      // acrossfade would then blend the same audio twice.
      const body = Math.min(MIN_BODY_SECONDS, Math.max(0, playDurations[index]) * 0.4);
      const budget = Math.max(0, playDurations[index] - body);
      if (used <= budget) continue;

      const scale = budget / used;
      if (index > 0) lengths[index - 1] = Math.floor(incoming * scale);
      if (index < lengths.length) lengths[index] = Math.floor(outgoing * scale);
      changed = true;
    }

    if (!changed) break;
  }

  return lengths.map((length, index) => {
    // A blend can never exceed either neighbour's play time.
    const ceiling = Math.max(0, Math.min(playDurations[index], playDurations[index + 1]) - 1);
    const clamped = clamp(length, 0, ceiling);
    // Anything under a second is not audible as a blend, so splice instead.
    return clamped < MIN_TRANSITION_SECONDS / 2 ? 0 : clamped;
  });
}

/**
 * Downsamples the energy curve across a play window to a fixed number of points
 * so the UI can draw a waveform without shipping every second of analysis.
 */
function energyPreview(analysis: TrackAnalysis, startSecond: number, endSecond: number, points = 96): number[] {
  const window = analysis.slices.filter((slice) => slice.second >= startSecond && slice.second < endSecond);
  const source = window.length > 0 ? window : analysis.slices;
  if (source.length === 0) return new Array<number>(points).fill(0.5);

  const preview: number[] = [];
  for (let index = 0; index < points; index += 1) {
    const from = Math.floor((index / points) * source.length);
    const to = Math.max(from + 1, Math.floor(((index + 1) / points) * source.length));
    let sum = 0;
    let counted = 0;
    for (let cursor = from; cursor < to && cursor < source.length; cursor += 1) {
      sum += source[cursor].energy;
      counted += 1;
    }
    preview.push(counted > 0 ? Math.round((sum / counted) * 1000) / 1000 : 0);
  }
  return preview;
}

/** How far a play window may move to land on a musical boundary. */
const SNAP_TOLERANCE_SECONDS = 12;

/**
 * Nudges the end of a play window onto the nearest low-energy moment. Ties go to
 * the earlier moment, and the search is symmetric so the small over- and
 * under-shoots cancel out across a set instead of dragging every mix short.
 */
function snapEnd(analysis: TrackAnalysis, startOffset: number, playDuration: number): number {
  const rawEnd = startOffset + playDuration;
  const floor = startOffset + Math.min(playDuration, MIN_BODY_SECONDS);

  let best = rawEnd;
  let bestGap = Infinity;
  for (const moment of analysis.transitionMoments) {
    if (moment < floor || moment > analysis.durationSeconds) continue;
    const gap = Math.abs(moment - rawEnd);
    if (gap <= SNAP_TOLERANCE_SECONDS && gap < bestGap) {
      bestGap = gap;
      best = moment;
    }
  }

  return clamp(best, floor, analysis.durationSeconds);
}

export function generateMixPlan({
  title,
  tracks,
  vibe,
  targetMinutes,
}: {
  title: string;
  tracks: TrackInput[];
  vibe: Vibe;
  targetMinutes?: number;
}): MixPlan {
  const warnings: string[] = [];
  if (tracks.length === 0) {
    return {
      title: title.trim() || 'Untitled mix',
      vibe,
      targetMinutes,
      totalDurationSeconds: 0,
      tracks: [],
      summary: 'No tracks to sequence.',
      warnings: ['Add at least two songs to build a mix.'],
    };
  }

  const ordered = orderTracks(tracks, vibe);

  // One tempo for the set, and the rate each track needs to sit on it. Beats
  // only stay aligned for the length of a blend if both sides run at the same
  // tempo, so this has to be settled before anything is measured in bars.
  const setTempo = chooseSetTempo(ordered);
  const matched = ordered.map((track) => tempoRatioFor(track.analysis, setTempo));
  const tempoRatios = matched.map((ratio) => ratio ?? 1);
  const barSeconds = setTempo ? (60 / setTempo) * BEATS_PER_BAR : 0;
  /** A blend is only worth measuring in bars when both sides run at the set tempo. */
  const beatLocked = (index: number) => matched[index] !== null && matched[index + 1] !== null;

  // Blend lengths depend only on tempo and vibe, so they can be costed before
  // any material is allocated. Every crossfade removes its own length from the
  // finished runtime, so the tracks have to supply the target plus the overlaps
  // or the mix always lands short of what was asked for.
  const [rangeMin, rangeMax] = vibeProfiles[vibe].transitionRange;
  const rawLengths = ordered.slice(0, -1).map((track, index) => {
    const length = buildTransitionLength(track.analysis, ordered[index + 1].analysis, vibe);
    return beatLocked(index) ? quantizeBlendToBars(length, barSeconds, rangeMin, rangeMax) : length;
  });
  const overlapBudget = rawLengths.reduce((sum, length) => sum + length, 0);

  const hasTarget = Boolean(targetMinutes) && Number.isFinite(targetMinutes) && (targetMinutes as number) > 0;
  const targetSeconds = hasTarget ? (targetMinutes as number) * 60 : 0;

  const build = (requestSeconds: number | undefined) => {
    const allocations = allocateDurations(ordered, requestSeconds === undefined ? undefined : requestSeconds / 60);

    const windows = ordered.map((track, index) => {
      const analysis = track.analysis;
      const maxStart = Math.max(0, analysis.durationSeconds - Math.min(allocations[index], analysis.durationSeconds));
      const rawStart = clamp(analysis.introSecond, 0, maxStart);
      const rawEnd = snapEnd(analysis, rawStart, allocations[index]);

      // Snap to the grid last, so landing on a beat outranks landing on the
      // quietest moment. A blend that starts a fraction of a beat late is the
      // thing that sounds broken; a blend that starts a bar early is not.
      const aligned = alignWindowToBeats(analysis, rawStart, rawEnd);
      const startOffsetSeconds = aligned?.start ?? rawStart;
      const endOffsetSeconds = aligned?.end ?? rawEnd;
      const tempoRatio = tempoRatios[index];

      return {
        startOffsetSeconds,
        endOffsetSeconds,
        tempoRatio,
        // The window is source seconds; the timeline is measured after the
        // stretch, which is what the renderer places and the chapters follow.
        playDurationSeconds: (endOffsetSeconds - startOffsetSeconds) / tempoRatio,
      };
    });

    // normalizeTransitions works in whole seconds, so re-seat the survivors on
    // the bar grid. Only ever downwards, which cannot break the fit it just
    // guaranteed; a blend with no room for a full bar becomes a cut on the beat.
    const lengths = normalizeTransitions(
      windows.map((window) => window.playDurationSeconds),
      rawLengths,
    ).map((length, index) =>
      beatLocked(index) && barSeconds > 0 ? Math.floor(length / barSeconds + 1e-6) * barSeconds : length,
    );
    const total =
      windows.reduce((sum, window) => sum + window.playDurationSeconds, 0) -
      lengths.reduce((sum, length) => sum + length, 0);

    return { windows, lengths, total };
  };

  // Per-track rounding and window snapping both move the runtime a little, so
  // the request is re-costed until it settles at or under the target. When the
  // per-track floor is what is holding the mix open, further passes cannot help
  // and the overrun is reported instead.
  let attempt = build(hasTarget ? targetSeconds + overlapBudget : undefined);
  if (hasTarget) {
    let request = targetSeconds + overlapBudget;
    for (let pass = 0; pass < 4 && attempt.total > targetSeconds; pass += 1) {
      const next = request - (attempt.total - targetSeconds);
      if (next <= 0 || next >= request) break;
      const retry = build(next);
      if (retry.total >= attempt.total) break;
      request = next;
      attempt = retry;
    }
  }

  const { windows, lengths: transitionLengths } = attempt;

  let cursor = 0;
  const planTracks: MixPlanTrack[] = ordered.map((track, index) => {
    const analysis = track.analysis;
    const window = windows[index];
    const incoming = index > 0 ? transitionLengths[index - 1] : 0;
    const outgoing = index < transitionLengths.length ? transitionLengths[index] : 0;

    const mixStartSeconds = cursor;
    cursor += window.playDurationSeconds - outgoing;

    const measuredLufs = track.loudness?.integratedLufs;
    const gainDb =
      measuredLufs !== undefined && Number.isFinite(measuredLufs)
        ? Math.round(clamp(TARGET_LUFS - measuredLufs, -12, 12) * 10) / 10
        : 0;

    const tempoRatio = window.tempoRatio;
    const notes = [
      `Average energy ${Math.round(analysis.averageEnergy * 100)}%, brightness ${Math.round(analysis.averageBrightness * 100)}%.`,
    ];
    if (matched[index] !== null && setTempo) {
      notes.push(
        tempoRatio === 1
          ? `Already on the set tempo of ${Math.round(setTempo)} BPM.`
          : `Beat-matched to ${Math.round(setTempo)} BPM (${tempoRatio > 1 ? '+' : ''}${Math.round((tempoRatio - 1) * 1000) / 10}% tempo).`,
      );
    } else if (setTempo && (incoming > 0 || outgoing > 0)) {
      notes.push(`Too far from ${Math.round(setTempo)} BPM to beat-match, so it plays at its own tempo.`);
    }
    if (analysis.bpmConfidence < 0.35) {
      notes.push(`Tempo is an estimate; ${analysis.bpm} BPM was a weak match.`);
    }
    if (analysis.keyConfidence < 0.3) {
      notes.push('Key detection was inconclusive for this track.');
    }
    if (gainDb !== 0) {
      notes.push(`Level trimmed ${gainDb > 0 ? '+' : ''}${gainDb} dB to match the set.`);
    }

    return {
      trackId: track.id,
      title: track.title,
      artist: track.artist,
      provider: track.provider,
      bpm: analysis.bpm,
      key: analysis.key,
      playDurationSeconds: window.playDurationSeconds,
      startOffsetSeconds: window.startOffsetSeconds,
      endOffsetSeconds: window.endOffsetSeconds,
      tempoRatio,
      eqProfile: vibeProfiles[vibe].eq,
      gainDb,
      mixStartSeconds,
      energyPreview: energyPreview(analysis, window.startOffsetSeconds, window.endOffsetSeconds),
      transitionIn:
        incoming > 0
          ? {
              // Blend lengths are timeline seconds; the span they cover inside
              // the source is that much longer when the track is stretched.
              fromSecond: window.startOffsetSeconds,
              toSecond: window.startOffsetSeconds + incoming * tempoRatio,
              lengthSeconds: incoming,
              style: vibeProfiles[vibe].transitionStyle,
              reason: describeBlend(incoming, barSeconds, matched[index] !== null && matched[index - 1] !== null, analysis),
            }
          : undefined,
      transitionOut:
        outgoing > 0
          ? {
              fromSecond: window.endOffsetSeconds - outgoing * tempoRatio,
              toSecond: window.endOffsetSeconds,
              lengthSeconds: outgoing,
              style: vibeProfiles[vibe].transitionStyle,
              reason: `Hands over during a ${Math.round(analysis.averageEnergy * 100)}% energy stretch.`,
            }
          : undefined,
      notes,
    };
  });

  const totalDurationSeconds =
    planTracks.reduce((sum, track) => sum + track.playDurationSeconds, 0) -
    transitionLengths.reduce((sum, length) => sum + length, 0);

  if (hasTarget) {
    // The longest mix these tracks could possibly produce, so a shortfall is
    // only reported when the material really is the limit.
    const overlapTotal = transitionLengths.reduce((sum, length) => sum + length, 0);
    const material =
      ordered.reduce(
        (sum, track) => sum + Math.min(track.analysis.usableDurationSeconds, track.analysis.durationSeconds),
        0,
      ) - overlapTotal;

    if (totalDurationSeconds < targetSeconds - 30 && material < targetSeconds - 30) {
      warnings.push('The target duration is longer than the usable material, so the mix stays shorter than requested.');
    }
    if (totalDurationSeconds > targetSeconds + 2) {
      const minutes = Math.round(totalDurationSeconds / 6) / 10;
      warnings.push(
        `Keeping every track above ${MINIMUM_PLAY_SECONDS}s means this mix runs ${minutes} minutes, longer than the ${targetMinutes} you asked for. Use fewer songs for a shorter set.`,
      );
    }
  }
  if (planTracks.length === 1) {
    warnings.push('A single track has nothing to blend into, so this renders as a straight edit.');
  }

  if (setTempo) {
    const unmatched = matched.filter((ratio) => ratio === null).length;
    if (unmatched > 0 && planTracks.length > 1) {
      warnings.push(
        `${unmatched} track${unmatched === 1 ? ' is' : 's are'} too far from ${Math.round(setTempo)} BPM to beat-match, so their blends are not locked to the grid.`,
      );
    }
  } else if (planTracks.length > 1) {
    warnings.push('No usable beat grid was found, so blends fall back to energy-based fades rather than beat-matching.');
  }

  const weakTempo = planTracks.filter((_, index) => ordered[index].analysis.bpmConfidence < 0.35).length;
  if (weakTempo > 0) {
    warnings.push(`${weakTempo} track${weakTempo === 1 ? '' : 's'} had an unclear tempo, so blend lengths there are a best guess.`);
  }

  return {
    title: title.trim() || 'Untitled mix',
    vibe,
    targetMinutes,
    totalDurationSeconds: Math.max(0, Math.round(totalDurationSeconds)),
    tracks: planTracks,
    summary: `${planTracks.length} tracks sequenced for a ${vibe.toLowerCase()} set with ${Math.max(0, planTracks.length - 1)} transitions.`,
    warnings,
  };
}

/**
 * Sizes on disk, in MB. Library entries written by older versions can be missing
 * a size, and "NaN MB" is worse than admitting it is unknown.
 */
export const formatMegabytes = (bytes: number | undefined, decimals = 1) => {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return '—';
  return `${(bytes / 1_048_576).toFixed(decimals)} MB`;
};

/** Tempos are measured, so they arrive with decimals nobody needs to read. */
export const formatBpm = (bpm: number) => {
  if (!Number.isFinite(bpm) || bpm <= 0) return '—';
  const rounded = Math.round(bpm * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
};

export const formatSeconds = (seconds: number) => {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const remainder = Math.floor(safe % 60);
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${remainder.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${remainder.toString().padStart(2, '0')}`;
};

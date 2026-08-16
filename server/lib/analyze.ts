import type { EnergySlice, TrackAnalysis } from '../../src/types.js';
import { decodeMonoPcm } from './ffmpeg.js';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const PITCH_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// Krumhansl-Schmuckler key profiles: average perceived stability of each pitch
// class within a major and a minor key.
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function normalizeSeries(values: number[]): number[] {
  if (values.length === 0) return [];
  let min = Infinity;
  let max = -Infinity;
  // A reduce beats Math.min(...values) here: spreading a long track's worth of
  // samples can exceed the argument limit and throw.
  for (const value of values) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  if (max - min < 1e-6) return values.map(() => 0.5);
  return values.map((value) => (value - min) / (max - min));
}

function pearson(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let sumA = 0;
  let sumB = 0;
  for (let i = 0; i < n; i += 1) {
    sumA += a[i];
    sumB += b[i];
  }
  const meanA = sumA / n;
  const meanB = sumB / n;

  let cov = 0;
  let varA = 0;
  let varB = 0;
  for (let i = 0; i < n; i += 1) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    cov += da * db;
    varA += da * da;
    varB += db * db;
  }
  const denominator = Math.sqrt(varA * varB);
  return denominator < 1e-12 ? 0 : cov / denominator;
}

/** In-place iterative radix-2 Cooley-Tukey FFT. Length must be a power of two. */
function fft(real: Float64Array, imag: Float64Array): void {
  const n = real.length;

  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]];
      [imag[i], imag[j]] = [imag[j], imag[i]];
    }
  }

  for (let length = 2; length <= n; length <<= 1) {
    const angle = (-2 * Math.PI) / length;
    const wReal = Math.cos(angle);
    const wImag = Math.sin(angle);
    for (let start = 0; start < n; start += length) {
      let curReal = 1;
      let curImag = 0;
      for (let offset = 0; offset < length / 2; offset += 1) {
        const a = start + offset;
        const b = a + length / 2;
        const tReal = real[b] * curReal - imag[b] * curImag;
        const tImag = real[b] * curImag + imag[b] * curReal;
        real[b] = real[a] - tReal;
        imag[b] = imag[a] - tImag;
        real[a] += tReal;
        imag[a] += tImag;
        const nextReal = curReal * wReal - curImag * wImag;
        curImag = curReal * wImag + curImag * wReal;
        curReal = nextReal;
      }
    }
  }
}

const ONSET_HOP = 512;

/**
 * Hop used for beat tracking. Where the tempo only needs the average spacing,
 * a beat's *position* is spliced against, and 512 samples of quantization is
 * 23 ms — enough to hear two kicks flam. Overlapping windows buy resolution
 * without making the envelope noisy.
 */
const BEAT_HOP = 128;
const BEAT_WINDOW = 512;

/**
 * Half-wave rectified difference of frame energy. Peaks line up with note and
 * drum onsets, which is what both tempo and beat phase are derived from.
 */
function onsetEnvelope(samples: Float32Array, hop = ONSET_HOP, window = hop): Float32Array {
  const frames = Math.floor((samples.length - window) / hop) + 1;
  if (frames < 2) return new Float32Array(0);

  const rms = new Float64Array(frames);
  for (let frame = 0; frame < frames; frame += 1) {
    const start = frame * hop;
    let sum = 0;
    for (let i = start; i < start + window; i += 1) sum += samples[i] * samples[i];
    rms[frame] = Math.sqrt(sum / window);
  }

  const envelope = new Float32Array(frames - 1);
  for (let frame = 1; frame < frames; frame += 1) {
    envelope[frame - 1] = Math.max(0, rms[frame] - rms[frame - 1]);
  }
  return envelope;
}

interface TempoEstimate {
  bpm: number;
  confidence: number;
  beatOffsetSeconds: number;
}

/**
 * Autocorrelation of the onset envelope with mean removal, parabolic peak
 * interpolation for sub-frame precision, and octave correction weighted toward
 * the tempo range humans actually perceive as the pulse.
 */
function estimateTempo(samples: Float32Array, sampleRate: number): TempoEstimate {
  const envelope = onsetEnvelope(samples);
  const frameRate = sampleRate / ONSET_HOP;

  if (envelope.length < 32) return { bpm: 120, confidence: 0, beatOffsetSeconds: 0 };

  // Remove the mean so a loud track does not simply correlate with itself.
  let mean = 0;
  for (const value of envelope) mean += value;
  mean /= envelope.length;
  const centered = new Float64Array(envelope.length);
  for (let i = 0; i < envelope.length; i += 1) centered[i] = envelope[i] - mean;

  const minLag = Math.max(2, Math.floor((60 / 200) * frameRate));
  const maxLag = Math.min(Math.floor(envelope.length / 2), Math.ceil((60 / 50) * frameRate));
  if (maxLag <= minLag) return { bpm: 120, confidence: 0, beatOffsetSeconds: 0 };

  const scores = new Float64Array(maxLag + 1);
  let totalCorrelation = 0;
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let sum = 0;
    for (let i = lag; i < centered.length; i += 1) sum += centered[i] * centered[i - lag];
    scores[lag] = sum / (centered.length - lag);
    totalCorrelation += Math.abs(scores[lag]);
  }

  // Silence, or anything with no onset variation, correlates with nothing. Fall
  // back to a neutral tempo rather than whichever lag the search started on,
  // which would report every ambient track as 200 BPM.
  if (totalCorrelation < 1e-12) return { bpm: 120, confidence: 0, beatOffsetSeconds: 0 };

  // Prefer tempos near 120 BPM, which resolves the half/double ambiguity that
  // plain autocorrelation cannot.
  const preference = (bpm: number) => Math.exp(-0.5 * ((Math.log2(bpm / 120) / 0.65) ** 2));

  let bestLag = minLag;
  let bestWeighted = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    const weighted = scores[lag] * preference((60 * frameRate) / lag);
    if (weighted > bestWeighted) {
      bestWeighted = weighted;
      bestLag = lag;
    }
  }

  // Parabolic interpolation around the winning lag for sub-frame precision.
  let refinedLag = bestLag;
  if (bestLag > minLag && bestLag < maxLag) {
    const before = scores[bestLag - 1];
    const at = scores[bestLag];
    const after = scores[bestLag + 1];
    const denominator = before - 2 * at + after;
    if (Math.abs(denominator) > 1e-12) {
      refinedLag = bestLag + clamp((0.5 * (before - after)) / denominator, -0.5, 0.5);
    }
  }

  const bpm = clamp((60 * frameRate) / refinedLag, 50, 200);

  let positiveMean = 0;
  let counted = 0;
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    positiveMean += Math.abs(scores[lag]);
    counted += 1;
  }
  positiveMean = counted > 0 ? positiveMean / counted : 0;
  const confidence = positiveMean < 1e-12 ? 0 : clamp(scores[bestLag] / positiveMean - 1, 0, 1);

  // Beat phase: slide a pulse train across the opening of the envelope and keep
  // the offset that collects the most onset energy. This is deliberately
  // limited to the first stretch of audio, because even a 0.5% tempo error
  // accumulates into seconds of drift if the grid is extrapolated further.
  const beatPeriodFrames = (60 / bpm) * frameRate;
  const phaseSearchLimit = Math.min(envelope.length, Math.floor(30 * frameRate));
  let bestPhase = 0;
  let bestPhaseScore = -Infinity;
  const phaseSteps = Math.max(1, Math.round(beatPeriodFrames));
  for (let step = 0; step < phaseSteps; step += 1) {
    const phase = (step / phaseSteps) * beatPeriodFrames;
    let sum = 0;
    for (let beat = 0; ; beat += 1) {
      const index = Math.round(phase + beat * beatPeriodFrames);
      if (index >= phaseSearchLimit) break;
      sum += envelope[index];
    }
    if (sum > bestPhaseScore) {
      bestPhaseScore = sum;
      bestPhase = phase;
    }
  }

  return {
    bpm: Math.round(bpm * 10) / 10,
    confidence,
    beatOffsetSeconds: bestPhase / frameRate,
  };
}

/**
 * How strongly the tracker resists spacings that stray from the estimated
 * tempo. Ellis's original value; low enough to follow a drifting drummer,
 * high enough that a syncopated stab cannot pull the grid off the pulse.
 */
const BEAT_TIGHTNESS = 100;

/**
 * Every beat in the track, in seconds.
 *
 * A tempo and a starting phase are not enough to place a blend late in a song:
 * the tempo estimate is only accurate to the resolution of the onset frames, so
 * an extrapolated grid has drifted by whole beats long before the outro. This
 * follows the pulse frame by frame (Ellis 2007, dynamic-programming beat
 * tracking) so the grid is still true where transitions actually happen.
 */
function trackBeats(envelope: Float32Array, frameRate: number, bpm: number, windowFrames = 1): number[] {
  const period = (60 / bpm) * frameRate;
  if (!Number.isFinite(period) || period < 2 || envelope.length < period * 8) return [];

  // Standardize the envelope so the onset reward and the spacing penalty stay
  // on comparable scales whatever the track's level.
  let mean = 0;
  for (const value of envelope) mean += value;
  mean /= envelope.length;
  let variance = 0;
  for (const value of envelope) variance += (value - mean) ** 2;
  const deviation = Math.sqrt(variance / envelope.length);
  if (deviation < 1e-9) return [];

  const strength = new Float64Array(envelope.length);
  for (let i = 0; i < envelope.length; i += 1) strength[i] = (envelope[i] - mean) / deviation;

  const cumulative = new Float64Array(envelope.length);
  const previous = new Int32Array(envelope.length).fill(-1);
  const minGap = Math.max(1, Math.round(period * 0.5));
  const maxGap = Math.max(minGap + 1, Math.round(period * 2));

  for (let i = 0; i < envelope.length; i += 1) {
    let bestScore = -Infinity;
    let bestIndex = -1;
    const from = Math.max(0, i - maxGap);
    for (let j = from; j <= i - minGap; j += 1) {
      // Squared log ratio, so half time and double time are penalized equally.
      const stretch = Math.log((i - j) / period);
      const score = cumulative[j] - BEAT_TIGHTNESS * stretch * stretch;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = j;
      }
    }

    cumulative[i] = bestIndex === -1 ? strength[i] : strength[i] + bestScore;
    previous[i] = bestIndex;
  }

  let last = 0;
  for (let i = 1; i < cumulative.length; i += 1) {
    if (cumulative[i] > cumulative[last]) last = i;
  }

  const frames: number[] = [];
  for (let cursor = last; cursor !== -1; cursor = previous[cursor]) frames.push(cursor);
  frames.reverse();
  if (frames.length < 8) return [];

  // Interpolating the peak either side of each beat recovers most of the
  // remaining frame quantization.
  return frames.map((frame) => {
    let offset = 0;
    if (frame > 0 && frame < envelope.length - 1) {
      const before = envelope[frame - 1];
      const at = envelope[frame];
      const after = envelope[frame + 1];
      const denominator = before - 2 * at + after;
      if (Math.abs(denominator) > 1e-12) offset = clamp((0.5 * (before - after)) / denominator, -0.5, 0.5);
    }
    // Envelope index k is the rise into the window starting at frame k+1. With
    // overlapping windows that rise appears as soon as the window reaches the
    // transient, so the hit itself sits near the window's trailing edge.
    const seconds = (frame + 1 + offset + (windowFrames - 1)) / frameRate;
    return Math.round(Math.max(0, seconds) * 1000) / 1000;
  });
}

/** Tempo implied by the tracked grid, which is finer than the frame-limited estimate. */
function tempoFromBeats(beats: number[]): number | null {
  if (beats.length < 9) return null;

  const gaps: number[] = [];
  for (let i = 1; i < beats.length; i += 1) gaps.push(beats[i] - beats[i - 1]);
  gaps.sort((left, right) => left - right);

  const median = gaps[Math.floor(gaps.length / 2)];
  if (!Number.isFinite(median) || median <= 0) return null;

  // Average only the gaps that agree with the median, so a dropped or doubled
  // beat cannot drag the tempo off.
  let sum = 0;
  let counted = 0;
  for (const gap of gaps) {
    if (Math.abs(gap - median) <= median * 0.12) {
      sum += gap;
      counted += 1;
    }
  }
  if (counted < gaps.length * 0.5) return null;

  const bpm = 60 / (sum / counted);
  return bpm >= 50 && bpm <= 200 ? Math.round(bpm * 100) / 100 : null;
}

const CHROMA_FRAME = 4096;
const CHROMA_HOP = 2048;

/** Chroma vector plus Krumhansl-Schmuckler correlation for the musical key. */
function estimateKey(samples: Float32Array, sampleRate: number): { key: string; confidence: number } {
  if (samples.length < CHROMA_FRAME) return { key: 'unknown', confidence: 0 };

  const window = new Float64Array(CHROMA_FRAME);
  for (let i = 0; i < CHROMA_FRAME; i += 1) {
    window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (CHROMA_FRAME - 1));
  }

  const chroma = new Array<number>(12).fill(0);
  const real = new Float64Array(CHROMA_FRAME);
  const imag = new Float64Array(CHROMA_FRAME);

  // Only bins between C2 and C7 carry useful pitch information; below that is
  // mostly kick drum and above it is mostly cymbals.
  const minFreq = 65;
  const maxFreq = 2100;
  const minBin = Math.max(1, Math.floor((minFreq * CHROMA_FRAME) / sampleRate));
  const maxBin = Math.min(CHROMA_FRAME / 2 - 1, Math.ceil((maxFreq * CHROMA_FRAME) / sampleRate));

  // Cap the work on long tracks by striding through at most ~600 frames.
  const totalFrames = Math.floor((samples.length - CHROMA_FRAME) / CHROMA_HOP) + 1;
  const stride = Math.max(1, Math.floor(totalFrames / 600));

  for (let frame = 0; frame < totalFrames; frame += stride) {
    const start = frame * CHROMA_HOP;
    for (let i = 0; i < CHROMA_FRAME; i += 1) {
      real[i] = samples[start + i] * window[i];
      imag[i] = 0;
    }
    fft(real, imag);

    for (let bin = minBin; bin <= maxBin; bin += 1) {
      const magnitude = Math.hypot(real[bin], imag[bin]);
      if (magnitude < 1e-8) continue;
      const frequency = (bin * sampleRate) / CHROMA_FRAME;
      const midi = 69 + 12 * Math.log2(frequency / 440);
      const pitchClass = ((Math.round(midi) % 12) + 12) % 12;
      chroma[pitchClass] += magnitude;
    }
  }

  const total = chroma.reduce((sum, value) => sum + value, 0);
  if (total < 1e-9) return { key: 'unknown', confidence: 0 };
  const normalized = chroma.map((value) => value / total);

  let bestKey = 'unknown';
  let bestScore = -Infinity;
  let runnerUp = -Infinity;

  for (let rotation = 0; rotation < 12; rotation += 1) {
    const rotated = normalized.map((_, index) => normalized[(index + rotation) % 12]);
    const majorScore = pearson(rotated, MAJOR_PROFILE);
    const minorScore = pearson(rotated, MINOR_PROFILE);

    for (const [score, name] of [
      [majorScore, PITCH_NAMES[rotation]],
      [minorScore, `${PITCH_NAMES[rotation]}m`],
    ] as [number, string][]) {
      if (score > bestScore) {
        runnerUp = bestScore;
        bestScore = score;
        bestKey = name;
      } else if (score > runnerUp) {
        runnerUp = score;
      }
    }
  }

  // Confidence blends absolute fit with how clearly it beat the next candidate.
  const margin = Number.isFinite(runnerUp) ? clamp((bestScore - runnerUp) * 3, 0, 1) : 0;
  const fit = clamp(bestScore, 0, 1);
  return { key: bestKey, confidence: clamp(fit * 0.6 + margin * 0.4, 0, 1) };
}

function buildSlices(energyRaw: number[], brightnessRaw: number[]): EnergySlice[] {
  const energy = normalizeSeries(energyRaw);
  const brightness = normalizeSeries(brightnessRaw);

  return energy.map((value, index) => ({
    second: index,
    energy: value,
    brightness: brightness[index] ?? 0.5,
    transitionScore: clamp((1 - value) * 0.65 + (brightness[index] ?? 0.5) * 0.35, 0, 1),
  }));
}

/**
 * Picks the point where the track has properly started and the point where it
 * begins to wind down, so intros and outros are not mistaken for the body.
 */
function pickIntroOutro(slices: EnergySlice[]): { introSecond: number; outroSecond: number } {
  if (slices.length === 0) return { introSecond: 0, outroSecond: 0 };

  const averageEnergy = slices.reduce((total, slice) => total + slice.energy, 0) / slices.length;
  const lookahead = Math.min(Math.max(8, Math.floor(slices.length * 0.15)), 45);

  const introWindow = slices.slice(0, lookahead);
  const introCandidate = introWindow.find((slice) => slice.energy >= averageEnergy * 0.9) ?? introWindow[0] ?? slices[0];

  const tailStart = Math.max(introCandidate.second + 1, slices.length - lookahead);
  const outroWindow = slices.slice(tailStart);
  const outroCandidate =
    [...outroWindow].reverse().find((slice) => slice.energy >= averageEnergy * 0.85) ??
    outroWindow[outroWindow.length - 1] ??
    slices[slices.length - 1];

  const introSecond = introCandidate.second;
  const outroSecond = Math.max(introSecond + 1, outroCandidate.second);
  return { introSecond, outroSecond };
}

/**
 * Local maxima of the transition score, spaced far enough apart to be distinct
 * blend opportunities rather than neighbouring samples of the same moment.
 */
function deriveTransitionMoments(slices: EnergySlice[]): number[] {
  const minSpacing = 16;
  const edge = 8;
  const usable = slices.filter((slice) => slice.second >= edge && slice.second <= slices.length - edge);
  if (usable.length === 0) return [];

  const ranked = [...usable].sort((a, b) => b.transitionScore - a.transitionScore);
  const chosen: number[] = [];
  for (const slice of ranked) {
    if (chosen.length >= 8) break;
    if (chosen.every((second) => Math.abs(second - slice.second) >= minSpacing)) {
      chosen.push(slice.second);
    }
  }
  return chosen.sort((a, b) => a - b);
}

/**
 * Bumped when the pipeline gains something the planner depends on, so cached
 * analyses from an older build are recomputed instead of quietly disabling the
 * features that need them.
 */
export const ANALYSIS_VERSION = 2;

/** True when a stored analysis was produced by the current pipeline. */
export function isAnalysisCurrent(analysis: TrackAnalysis | undefined): boolean {
  return (analysis?.version ?? 1) >= ANALYSIS_VERSION;
}

/**
 * Full analysis of a real audio file. Every value here is measured, which is
 * what lets the planner and renderer agree on where blends should land.
 */
export async function analyzeAudioFile(filePath: string): Promise<TrackAnalysis> {
  const { samples, sampleRate, durationSeconds } = await decodeMonoPcm(filePath);

  const wholeSeconds = Math.max(1, Math.floor(durationSeconds));
  const energyRaw: number[] = [];
  const brightnessRaw: number[] = [];

  for (let second = 0; second < wholeSeconds; second += 1) {
    const start = second * sampleRate;
    const end = Math.min(start + sampleRate, samples.length);
    let energy = 0;
    let brightness = 0;
    for (let index = start + 1; index < end; index += 1) {
      const current = samples[index];
      energy += current * current;
      brightness += Math.abs(current - samples[index - 1]);
    }
    const length = Math.max(1, end - start);
    energyRaw.push(Math.sqrt(energy / length));
    brightnessRaw.push(brightness / length);
  }

  const slices = buildSlices(energyRaw, brightnessRaw);
  const averageEnergy = slices.reduce((total, slice) => total + slice.energy, 0) / Math.max(1, slices.length);
  const averageBrightness = slices.reduce((total, slice) => total + slice.brightness, 0) / Math.max(1, slices.length);

  const tempo = estimateTempo(samples, sampleRate);
  const key = estimateKey(samples, sampleRate);
  const { introSecond, outroSecond } = pickIntroOutro(slices);

  const beatTimes = trackBeats(
    onsetEnvelope(samples, BEAT_HOP, BEAT_WINDOW),
    sampleRate / BEAT_HOP,
    tempo.bpm,
    BEAT_WINDOW / BEAT_HOP,
  );
  const trackedBpm = tempoFromBeats(beatTimes);

  return {
    version: ANALYSIS_VERSION,
    durationSeconds: Math.round(durationSeconds * 100) / 100,
    usableDurationSeconds: Math.max(1, outroSecond - introSecond),
    // The tracked grid measures the tempo over the whole track rather than to
    // the nearest onset frame, so it wins when it is trustworthy.
    bpm: trackedBpm ?? tempo.bpm,
    bpmConfidence: Math.round(tempo.confidence * 100) / 100,
    beatOffsetSeconds: Math.round(tempo.beatOffsetSeconds * 1000) / 1000,
    beatTimes,
    key: key.key,
    keyConfidence: Math.round(key.confidence * 100) / 100,
    averageEnergy,
    averageBrightness,
    introSecond,
    outroSecond,
    transitionMoments: deriveTransitionMoments(slices),
    slices,
  };
}

export const internals = {
  estimateTempo,
  estimateKey,
  pickIntroOutro,
  deriveTransitionMoments,
  normalizeSeries,
  fft,
  onsetEnvelope,
  trackBeats,
  tempoFromBeats,
};

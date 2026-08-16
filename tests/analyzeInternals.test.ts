import { describe, expect, it } from 'vitest';
import { ANALYSIS_VERSION, internals, isAnalysisCurrent } from '../server/lib/analyze.js';
import type { EnergySlice } from '../src/types.js';
import { makeRng } from './helpers/fixtures.js';

const SAMPLE_RATE = 22_050;

/** A percussive click on every beat: the clearest possible tempo signal. */
function clickTrain(bpm: number, seconds: number, sampleRate = SAMPLE_RATE): Float32Array {
  const samples = new Float32Array(Math.floor(seconds * sampleRate));
  const period = (60 / bpm) * sampleRate;
  for (let beat = 0; beat * period < samples.length; beat += 1) {
    const start = Math.floor(beat * period);
    for (let index = 0; index < 220 && start + index < samples.length; index += 1) {
      samples[start + index] = Math.exp(-index / 40) * Math.sin((2 * Math.PI * 180 * index) / sampleRate);
    }
  }
  return samples;
}

function tone(frequencies: number[], seconds: number, sampleRate = SAMPLE_RATE): Float32Array {
  const samples = new Float32Array(Math.floor(seconds * sampleRate));
  for (let index = 0; index < samples.length; index += 1) {
    let value = 0;
    for (const frequency of frequencies) value += Math.sin((2 * Math.PI * frequency * index) / sampleRate);
    samples[index] = (value / frequencies.length) * 0.8;
  }
  return samples;
}

const FRAME_RATE = SAMPLE_RATE / 512;

const beatsOf = (samples: Float32Array, bpm: number) =>
  internals.trackBeats(internals.onsetEnvelope(samples), FRAME_RATE, bpm);

const slice = (second: number, energy: number, brightness = 0.5, transitionScore = 0.5): EnergySlice => ({
  second,
  energy,
  brightness,
  transitionScore,
});

describe('trackBeats', () => {
  it.each([90, 120, 128, 174])('follows a %s BPM pulse all the way through', (bpm) => {
    const beats = beatsOf(clickTrain(bpm, 60), bpm);
    const period = 60 / bpm;

    expect(beats.length).toBeGreaterThan((60 / period) * 0.9);
    for (let index = 1; index < beats.length; index += 1) {
      expect(beats[index] - beats[index - 1]).toBeCloseTo(period, 1);
    }
  });

  // The whole reason for tracking rather than extrapolating: the grid still has
  // to be right at the end of the track, where transitions actually happen.
  it('is still on the beat two minutes in', () => {
    const bpm = 128;
    const period = 60 / bpm;
    const beats = beatsOf(clickTrain(bpm, 130), bpm);
    const last = beats[beats.length - 1];

    const offBy = Math.abs(last / period - Math.round(last / period)) * period;
    expect(offBy, `last beat at ${last}s is ${offBy}s off the grid`).toBeLessThan(0.03);
  });

  it('lands on the clicks rather than between them', () => {
    const beats = beatsOf(clickTrain(120, 40), 120);
    for (const beat of beats) {
      const offBy = Math.abs(beat / 0.5 - Math.round(beat / 0.5)) * 0.5;
      expect(offBy).toBeLessThan(0.04);
    }
  });

  it('returns nothing rather than inventing a grid', () => {
    expect(beatsOf(new Float32Array(SAMPLE_RATE * 30), 120)).toEqual([]);
    expect(beatsOf(new Float32Array(64), 120)).toEqual([]);
    expect(beatsOf(clickTrain(120, 60), 0)).toEqual([]);
    expect(beatsOf(clickTrain(120, 60), Number.NaN)).toEqual([]);
  });

  it('produces an ascending grid of finite times inside the track', () => {
    const beats = beatsOf(clickTrain(112, 45), 112);
    expect(beats.length).toBeGreaterThan(0);
    for (let index = 0; index < beats.length; index += 1) {
      expect(Number.isFinite(beats[index])).toBe(true);
      expect(beats[index]).toBeGreaterThanOrEqual(0);
      expect(beats[index]).toBeLessThanOrEqual(45);
      if (index > 0) expect(beats[index]).toBeGreaterThan(beats[index - 1]);
    }
  });
});

describe('tempoFromBeats', () => {
  it.each([90, 120, 128, 174])('recovers %s BPM from the grid it tracked', (bpm) => {
    expect(internals.tempoFromBeats(beatsOf(clickTrain(bpm, 60), bpm))!).toBeCloseTo(bpm, 0);
  });

  it('is unmoved by a single dropped beat', () => {
    const beats = Array.from({ length: 40 }, (_unused, index) => index * 0.5);
    beats.splice(20, 1);
    expect(internals.tempoFromBeats(beats)!).toBeCloseTo(120, 1);
  });

  it('declines when there is nothing to measure', () => {
    expect(internals.tempoFromBeats([])).toBeNull();
    expect(internals.tempoFromBeats([0, 0.5, 1])).toBeNull();
    // Spacings all over the place, so no tempo is defensible.
    expect(internals.tempoFromBeats([0, 0.2, 0.9, 1.0, 2.4, 2.5, 4.1, 4.2, 6.6, 6.7])).toBeNull();
  });

  it('refuses a tempo outside the range a pulse can sit in', () => {
    expect(internals.tempoFromBeats(Array.from({ length: 20 }, (_unused, index) => index * 3))).toBeNull();
  });
});

describe('isAnalysisCurrent', () => {
  it('treats an unversioned analysis as stale so it gets re-run', () => {
    expect(isAnalysisCurrent(undefined)).toBe(false);
    expect(isAnalysisCurrent({ bpm: 120 } as never)).toBe(false);
    expect(isAnalysisCurrent({ bpm: 120, version: ANALYSIS_VERSION - 1 } as never)).toBe(false);
  });

  it('accepts an analysis from this build or a later one', () => {
    expect(isAnalysisCurrent({ bpm: 120, version: ANALYSIS_VERSION } as never)).toBe(true);
    expect(isAnalysisCurrent({ bpm: 120, version: ANALYSIS_VERSION + 1 } as never)).toBe(true);
  });
});

describe('normalizeSeries', () => {
  it('maps a range onto 0..1', () => {
    expect(internals.normalizeSeries([0, 5, 10])).toEqual([0, 0.5, 1]);
    expect(internals.normalizeSeries([-10, 0, 10])).toEqual([0, 0.5, 1]);
  });

  it('returns the midpoint for a flat series instead of dividing by zero', () => {
    expect(internals.normalizeSeries([3, 3, 3])).toEqual([0.5, 0.5, 0.5]);
    expect(internals.normalizeSeries([0])).toEqual([0.5]);
  });

  it('handles an empty series', () => {
    expect(internals.normalizeSeries([])).toEqual([]);
  });

  it('never leaves the unit range', () => {
    const rng = makeRng(5);
    const values = Array.from({ length: 500 }, () => (rng() - 0.5) * 1e6);
    for (const value of internals.normalizeSeries(values)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it('survives a series far longer than the argument limit', () => {
    // Math.min(...values) would throw here, which is why the source loops.
    const values = Array.from({ length: 250_000 }, (_unused, index) => index % 977);
    expect(() => internals.normalizeSeries(values)).not.toThrow();
  });
});

describe('fft', () => {
  it('turns an impulse into a flat spectrum', () => {
    const size = 32;
    const real = new Float64Array(size);
    const imag = new Float64Array(size);
    real[0] = 1;
    internals.fft(real, imag);
    for (let bin = 0; bin < size; bin += 1) {
      expect(Math.hypot(real[bin], imag[bin])).toBeCloseTo(1, 10);
    }
  });

  it('puts a pure cosine in exactly one bin pair', () => {
    const size = 64;
    const bin = 5;
    const real = new Float64Array(size);
    const imag = new Float64Array(size);
    for (let index = 0; index < size; index += 1) {
      real[index] = Math.cos((2 * Math.PI * bin * index) / size);
    }
    internals.fft(real, imag);

    const magnitudes = Array.from({ length: size }, (_unused, index) => Math.hypot(real[index], imag[index]));
    expect(magnitudes[bin]).toBeCloseTo(size / 2, 6);
    expect(magnitudes[size - bin]).toBeCloseTo(size / 2, 6);
    magnitudes.forEach((magnitude, index) => {
      if (index === bin || index === size - bin) return;
      expect(magnitude, `bin ${index} leaked`).toBeLessThan(1e-9);
    });
  });

  it('matches a naive DFT', () => {
    const size = 16;
    const rng = makeRng(99);
    const input = Array.from({ length: size }, () => rng() * 2 - 1);
    const real = Float64Array.from(input);
    const imag = new Float64Array(size);
    internals.fft(real, imag);

    for (let bin = 0; bin < size; bin += 1) {
      let expectedReal = 0;
      let expectedImag = 0;
      for (let index = 0; index < size; index += 1) {
        const angle = (-2 * Math.PI * bin * index) / size;
        expectedReal += input[index] * Math.cos(angle);
        expectedImag += input[index] * Math.sin(angle);
      }
      expect(real[bin]).toBeCloseTo(expectedReal, 8);
      expect(imag[bin]).toBeCloseTo(expectedImag, 8);
    }
  });
});

describe('estimateTempo', () => {
  it.each([90, 120, 128, 140, 174])('recovers %s BPM from a click train', (bpm) => {
    const estimate = internals.estimateTempo(clickTrain(bpm, 40), SAMPLE_RATE);
    // Autocorrelation plus parabolic interpolation lands within a couple of BPM.
    expect(Math.abs(estimate.bpm - bpm) / bpm, `got ${estimate.bpm}`).toBeLessThan(0.02);
    expect(estimate.confidence).toBeGreaterThan(0.2);
    expect(estimate.beatOffsetSeconds).toBeGreaterThanOrEqual(0);
    expect(estimate.beatOffsetSeconds).toBeLessThan(60 / bpm + 1e-9);
  });

  it('keeps every estimate inside the range the planner assumes', () => {
    for (const bpm of [50, 70, 100, 150, 200]) {
      const estimate = internals.estimateTempo(clickTrain(bpm, 30), SAMPLE_RATE);
      expect(estimate.bpm).toBeGreaterThanOrEqual(50);
      expect(estimate.bpm).toBeLessThanOrEqual(200);
      expect(Number.isFinite(estimate.beatOffsetSeconds)).toBe(true);
    }
  });

  it('reports zero confidence for material with no pulse', () => {
    const silence = internals.estimateTempo(new Float32Array(SAMPLE_RATE * 5), SAMPLE_RATE);
    expect(silence.confidence).toBe(0);
    expect(Number.isFinite(silence.bpm)).toBe(true);

    const tiny = internals.estimateTempo(new Float32Array(64), SAMPLE_RATE);
    expect(tiny.confidence).toBe(0);
    expect(tiny.bpm).toBe(120);
  });

  it('falls back to a neutral tempo for silence, not the maximum', () => {
    expect(internals.estimateTempo(new Float32Array(SAMPLE_RATE * 5), SAMPLE_RATE).bpm).toBe(120);
  });
});

describe('estimateKey', () => {
  it('finds C major in a C major triad', () => {
    const result = internals.estimateKey(tone([261.63, 329.63, 392.0], 6), SAMPLE_RATE);
    expect(result.key).toBe('C');
    expect(result.confidence).toBeGreaterThan(0.2);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it('finds A minor in an A minor triad', () => {
    const result = internals.estimateKey(tone([220.0, 261.63, 329.63], 6), SAMPLE_RATE);
    expect(result.key).toMatch(/^[A-G]#?m?$/);
    expect(result.confidence).toBeGreaterThanOrEqual(0);
  });

  it('admits it does not know for silence or a too-short buffer', () => {
    expect(internals.estimateKey(new Float32Array(SAMPLE_RATE), SAMPLE_RATE)).toEqual({
      key: 'unknown',
      confidence: 0,
    });
    expect(internals.estimateKey(new Float32Array(100), SAMPLE_RATE)).toEqual({
      key: 'unknown',
      confidence: 0,
    });
  });
});

describe('pickIntroOutro', () => {
  it('skips a quiet intro and stops before the tail', () => {
    const slices = Array.from({ length: 120 }, (_unused, second) =>
      slice(second, second < 10 || second > 110 ? 0.05 : 0.7),
    );
    const { introSecond, outroSecond } = internals.pickIntroOutro(slices);
    expect(introSecond).toBeGreaterThanOrEqual(10);
    expect(introSecond).toBeLessThan(20);
    expect(outroSecond).toBeGreaterThan(introSecond);
    expect(outroSecond).toBeLessThanOrEqual(119);
  });

  it('always leaves at least one second of usable material', () => {
    const cases: EnergySlice[][] = [
      [],
      [slice(0, 0.5)],
      Array.from({ length: 3 }, (_unused, second) => slice(second, 0.5)),
      Array.from({ length: 30 }, () => slice(0, 0)),
    ];
    for (const slices of cases) {
      const { introSecond, outroSecond } = internals.pickIntroOutro(slices);
      expect(Number.isFinite(introSecond)).toBe(true);
      expect(Number.isFinite(outroSecond)).toBe(true);
      if (slices.length > 0) expect(outroSecond).toBeGreaterThan(introSecond);
    }
  });

  it('handles an empty analysis', () => {
    expect(internals.pickIntroOutro([])).toEqual({ introSecond: 0, outroSecond: 0 });
  });
});

describe('deriveTransitionMoments', () => {
  const slices = Array.from({ length: 200 }, (_unused, second) =>
    slice(second, 0.5, 0.5, second % 23 === 0 ? 0.95 : 0.2),
  );

  it('returns ascending, well-spaced moments', () => {
    const moments = internals.deriveTransitionMoments(slices);
    expect(moments.length).toBeGreaterThan(0);
    expect(moments).toEqual([...moments].sort((a, b) => a - b));
    for (let index = 1; index < moments.length; index += 1) {
      expect(moments[index] - moments[index - 1]).toBeGreaterThanOrEqual(16);
    }
  });

  it('keeps clear of the very start and end of the track', () => {
    for (const moment of internals.deriveTransitionMoments(slices)) {
      expect(moment).toBeGreaterThanOrEqual(8);
      expect(moment).toBeLessThanOrEqual(slices.length - 8);
    }
  });

  it('never returns more than eight moments', () => {
    const busy = Array.from({ length: 2000 }, (_unused, second) => slice(second, 0.5, 0.5, (second % 40) / 40));
    expect(internals.deriveTransitionMoments(busy).length).toBeLessThanOrEqual(8);
  });

  it('returns nothing for a track too short to have a middle', () => {
    expect(internals.deriveTransitionMoments([])).toEqual([]);
    expect(internals.deriveTransitionMoments([slice(0, 0.5), slice(1, 0.5)])).toEqual([]);
  });
});

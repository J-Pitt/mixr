import { describe, expect, it } from 'vitest';
import {
  allVibes,
  clamp,
  crossfadeCurveFor,
  eqFiltersFor,
  formatSeconds,
  resolveVibe,
  TARGET_LUFS,
  vibeProfiles,
} from '../src/lib/mixEngine.js';
import { ACROSSFADE_CURVES } from './helpers/filterGraph.js';

describe('vibe data integrity', () => {
  it('exposes a non-trivial vibe list with no duplicates', () => {
    expect(allVibes.length).toBeGreaterThan(10);
    expect(new Set(allVibes).size).toBe(allVibes.length);
  });

  it.each(allVibes)('%s has a coherent profile', (vibe) => {
    const profile = vibeProfiles[vibe];
    expect(profile, `${vibe} has no profile`).toBeTruthy();

    const [min, max] = profile.transitionRange;
    expect(Number.isFinite(min) && Number.isFinite(max), `${vibe} transitionRange is not finite`).toBe(true);
    expect(min, `${vibe} transitionRange min must be positive`).toBeGreaterThan(0);
    expect(max, `${vibe} transitionRange max must be positive`).toBeGreaterThan(0);
    expect(min, `${vibe} transitionRange is inverted`).toBeLessThanOrEqual(max);

    expect(profile.eq.trim().length, `${vibe} has an empty eq description`).toBeGreaterThan(0);
    expect(profile.transitionStyle.trim().length, `${vibe} has an empty transitionStyle`).toBeGreaterThan(0);
    expect(['lift', 'cruise', 'peak', 'dark', 'moody']).toContain(profile.order);
    expect(['natural', 'warm', 'bright', 'deep', 'tight', 'airy']).toContain(profile.tone);
  });

  it('targets a streaming-normalized loudness', () => {
    expect(TARGET_LUFS).toBeLessThan(0);
    expect(TARGET_LUFS).toBeGreaterThanOrEqual(-24);
  });
});

describe('resolveVibe', () => {
  it('falls back to a real vibe for an empty selection', () => {
    const resolved = resolveVibe([]);
    expect(allVibes).toContain(resolved);
    expect(vibeProfiles[resolved]).toBeTruthy();
  });

  it.each(allVibes)('returns %s unchanged when it is the only selection', (vibe) => {
    expect(resolveVibe([vibe])).toBe(vibe);
  });

  it('always returns one of the selected vibes, never an unrelated one', () => {
    for (const left of allVibes) {
      for (const right of allVibes) {
        const resolved = resolveVibe([left, right]);
        expect([left, right], `resolveVibe([${left}, ${right}]) returned ${resolved}`).toContain(resolved);
      }
    }
  });

  it('is deterministic and order-independent enough to stay inside the selection', () => {
    const selection = ['Ambient', 'Peak Time', 'Chill', 'Festival'] as const;
    const first = resolveVibe([...selection]);
    expect(resolveVibe([...selection])).toBe(first);
    expect(selection).toContain(resolveVibe([...selection].reverse()));
  });

  it('handles a selection with repeats', () => {
    expect(resolveVibe(['Techno', 'Techno', 'Techno'])).toBe('Techno');
  });
});

describe('eqFiltersFor', () => {
  it.each(allVibes)('%s produces ffmpeg-safe filter strings', (vibe) => {
    const filters = eqFiltersFor(vibe);
    expect(Array.isArray(filters)).toBe(true);
    for (const filter of filters) {
      expect(filter.length, `${vibe} has an empty filter`).toBeGreaterThan(0);
      // A space here would split the -filter_complex argument and break the render.
      expect(/\s/.test(filter), `${vibe} filter "${filter}" contains whitespace`).toBe(false);
      expect(filter).toMatch(/^[a-z0-9]+=/);
      expect(filter.includes(';'), `${vibe} filter "${filter}" contains a chain separator`).toBe(false);
    }
  });

  it('returns a fresh array so callers cannot corrupt the shared profile', () => {
    const first = eqFiltersFor('Late Night');
    first.push('volume=99dB');
    expect(eqFiltersFor('Late Night')).not.toContain('volume=99dB');
  });
});

describe('crossfadeCurveFor', () => {
  it.each(allVibes)('%s maps to a curve acrossfade accepts', (vibe) => {
    const curve = crossfadeCurveFor(vibeProfiles[vibe].transitionStyle);
    expect(ACROSSFADE_CURVES.has(curve), `${vibe} -> "${curve}" is not a valid acrossfade curve`).toBe(true);
  });

  it.each([
    ['hard cut', 'exp'],
    ['long dissolve', 'hsin'],
    ['patient fade', 'log'],
    ['phrase-locked blend', 'qsin'],
  ])('maps "%s" to %s', (style, expected) => {
    expect(crossfadeCurveFor(style)).toBe(expected);
  });

  it('is case insensitive and still valid for unknown styles', () => {
    expect(crossfadeCurveFor('HARD CUT')).toBe('exp');
    expect(ACROSSFADE_CURVES.has(crossfadeCurveFor(''))).toBe(true);
    expect(ACROSSFADE_CURVES.has(crossfadeCurveFor('something nobody wrote'))).toBe(true);
  });
});

describe('clamp', () => {
  it('bounds values on both sides', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(50, 0, 10)).toBe(10);
    expect(clamp(0, 0, 0)).toBe(0);
  });

  it('prefers the upper bound when the range is inverted', () => {
    // Math.min(max, Math.max(min, value)) — documented behaviour the planner relies on.
    expect(clamp(5, 10, 0)).toBe(0);
  });
});

describe('formatSeconds', () => {
  it.each([
    [0, '0:00'],
    [9, '0:09'],
    [59, '0:59'],
    [60, '1:00'],
    [61.9, '1:01'],
    [599, '9:59'],
    [3600, '1:00:00'],
    [3661, '1:01:01'],
  ])('formats %s as %s', (input, expected) => {
    expect(formatSeconds(input)).toBe(expected);
  });

  it('never produces NaN for hostile input', () => {
    expect(formatSeconds(Number.NaN)).toBe('0:00');
    expect(formatSeconds(-30)).toBe('0:00');
    expect(formatSeconds(Number.POSITIVE_INFINITY)).toBe('0:00');
  });
});

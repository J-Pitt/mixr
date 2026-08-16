import { describe, expect, it } from 'vitest';
import {
  looksLikeFullMix,
  parseTargetBpm,
  suggestedTrackCount,
  suggestSearchQueries,
} from '../src/lib/suggestTracks.js';

describe('parseTargetBpm', () => {
  it('accepts a usable tempo', () => {
    expect(parseTargetBpm('128')).toBe(128);
    expect(parseTargetBpm('128.4')).toBe(128);
  });

  it('rejects empty or out-of-range values', () => {
    expect(parseTargetBpm('')).toBeUndefined();
    expect(parseTargetBpm('12')).toBeUndefined();
    expect(parseTargetBpm('400')).toBeUndefined();
  });
});

describe('suggestedTrackCount', () => {
  it('defaults to eight songs', () => {
    expect(suggestedTrackCount()).toBe(8);
    expect(suggestedTrackCount(0)).toBe(8);
  });

  it('scales with the target length', () => {
    expect(suggestedTrackCount(21)).toBe(6);
    expect(suggestedTrackCount(35)).toBe(10);
    expect(suggestedTrackCount(90)).toBe(12);
  });
});

describe('looksLikeFullMix', () => {
  it('drops hour-long results', () => {
    expect(looksLikeFullMix('House mix', 80 * 60)).toBe(true);
    expect(looksLikeFullMix('Best of house 2024 DJ set', 240)).toBe(true);
    expect(looksLikeFullMix('Around the World', 240)).toBe(false);
  });
});

describe('suggestSearchQueries', () => {
  it('uses the selected vibe buttons and a target BPM', () => {
    expect(suggestSearchQueries({ vibes: ['House', 'Peak Time'], targetBpm: 128 })).toEqual([
      'House 128 bpm',
      'Peak Time 128 bpm',
    ]);
  });

  it('leads with the chosen genre', () => {
    const queries = suggestSearchQueries({
      genre: 'Deep House',
      vibes: ['House', 'Peak Time'],
      targetBpm: 122,
    });
    expect(queries[0]).toBe('Deep House 122 bpm');
    expect(queries).toContain('Peak Time 122 bpm');
    expect(queries).not.toContain('House 122 bpm');
  });

  it('folds in the mix name and songs already on the list', () => {
    const queries = suggestSearchQueries({
      vibes: ['Techno'],
      title: 'Warehouse Friday',
      existingTitles: ['Windowlicker'],
      targetBpm: 132,
    });
    expect(queries).toContain('Techno 132 bpm');
    expect(queries).toContain('Warehouse Friday Techno 132 bpm');
    expect(queries).toContain('Windowlicker Techno');
  });
});

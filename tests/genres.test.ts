import { describe, expect, it } from 'vitest';
import { GENRES, vibeForGenre } from '../src/lib/genres.js';
import { allVibes } from '../src/lib/mixEngine.js';

describe('vibeForGenre', () => {
  it('maps every genre onto a known mix vibe', () => {
    for (const genre of GENRES) {
      expect(allVibes).toContain(vibeForGenre(genre));
    }
  });

  it('keeps exact genre names on their own vibe', () => {
    expect(vibeForGenre('Techno')).toBe('Techno');
    expect(vibeForGenre('Deep House')).toBe('House');
    expect(vibeForGenre('Trap')).toBe('Hip-Hop');
  });
});

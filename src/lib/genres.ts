import type { Vibe } from '../types.js';

export const GENRES = [
  'House',
  'Deep House',
  'Tech House',
  'Techno',
  'Hard Techno',
  'Trance',
  'Progressive',
  'Drum & Bass',
  'Garage',
  'Disco',
  'Indie Dance',
  'Ambient',
  'Hip-Hop',
  'Trap',
  'R&B',
  'Afrobeats',
  'Latin',
  'Reggae',
  'Jazz',
  'Soul',
  'Funk',
] as const;

export type Genre = (typeof GENRES)[number];

/** Closest mix-planning vibe for a search genre. */
const GENRE_VIBE: Record<Genre, Vibe> = {
  House: 'House',
  'Deep House': 'House',
  'Tech House': 'House',
  Techno: 'Techno',
  'Hard Techno': 'Techno',
  Trance: 'Trance',
  Progressive: 'Trance',
  'Drum & Bass': 'Drum & Bass',
  Garage: 'House',
  Disco: 'Funk',
  'Indie Dance': 'House',
  Ambient: 'Ambient',
  'Hip-Hop': 'Hip-Hop',
  Trap: 'Hip-Hop',
  'R&B': 'R&B',
  Afrobeats: 'Afrobeats',
  Latin: 'Latin',
  Reggae: 'Reggae',
  Jazz: 'Jazz',
  Soul: 'Soul',
  Funk: 'Funk',
};

export function vibeForGenre(genre: Genre): Vibe {
  return GENRE_VIBE[genre];
}

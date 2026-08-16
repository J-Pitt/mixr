import type { Vibe } from '../types.js';

export function parseTargetBpm(value: string): number | undefined {
  const bpm = Number(value);
  if (!Number.isFinite(bpm) || bpm < 50 || bpm > 220) return undefined;
  return Math.round(bpm);
}

/** About one track every 3.5 minutes, kept in a usable band. */
export function suggestedTrackCount(targetMinutes?: number): number {
  if (!targetMinutes || !Number.isFinite(targetMinutes) || targetMinutes <= 0) return 8;
  return Math.min(12, Math.max(6, Math.round(targetMinutes / 3.5)));
}

/** Hour-long sets and albums are not useful as one row in a mix. */
export function looksLikeFullMix(title: string, durationSeconds?: number): boolean {
  if (durationSeconds !== undefined && durationSeconds > 12 * 60) return true;
  return /\b(\d+\s*hours?|full (set|mix|album)|dj set|continuous mix)\b/i.test(title);
}

/** Search queries built from the genre, vibe buttons, and whatever else is already filled in. */
export function suggestSearchQueries(input: {
  genre?: string;
  vibes: Vibe[];
  title?: string;
  existingTitles?: string[];
  targetBpm?: number;
}): string[] {
  const bpm = input.targetBpm ? `${Math.round(input.targetBpm)} bpm` : '';
  const title = input.title?.trim() ?? '';
  const genre = input.genre?.trim() ?? '';
  const queries: string[] = [];

  const push = (value: string) => {
    const cleaned = value.replace(/\s+/g, ' ').trim();
    if (cleaned && !queries.includes(cleaned)) queries.push(cleaned);
  };

  if (genre) {
    push(`${genre} ${bpm}`);
    if (title) push(`${title} ${genre} ${bpm}`);
  }

  for (const vibe of input.vibes) {
    const vibeKey = vibe.toLowerCase();
    if (genre && (vibeKey === genre.toLowerCase() || genre.toLowerCase().includes(vibeKey))) continue;
    push(`${vibe} ${bpm}`);
    if (title) push(`${title} ${vibe} ${bpm}`);
  }
  if (title) push(`${title} ${bpm}`);

  const seedTag = genre || input.vibes[0] || '';
  for (const song of (input.existingTitles ?? []).slice(0, 2)) {
    const seed = song.trim();
    if (!seed) continue;
    push(seedTag ? `${seed} ${seedTag}` : seed);
  }

  return queries.slice(0, 6);
}

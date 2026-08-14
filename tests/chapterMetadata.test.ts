import { describe, expect, it } from 'vitest';
import { buildChapterMetadata } from '../server/lib/render.js';
import { generateMixPlan } from '../src/lib/mixEngine.js';
import type { MixPlan, MixPlanTrack } from '../src/types.js';
import { makeTracks } from './helpers/fixtures.js';

interface Chapter {
  start: number;
  end: number;
  timebase: string;
  title: string;
}

function parseChapters(metadata: string): Chapter[] {
  const blocks = metadata.split('[CHAPTER]').slice(1);
  return blocks.map((block) => {
    const start = /^START=(-?\d+)$/m.exec(block);
    const end = /^END=(-?\d+)$/m.exec(block);
    const timebase = /^TIMEBASE=(\S+)$/m.exec(block);
    const title = /^title=(.*)$/m.exec(block);
    if (!start || !end || !timebase) throw new Error(`Malformed chapter block: ${block}`);
    return {
      start: Number(start[1]),
      end: Number(end[1]),
      timebase: timebase[1],
      title: title?.[1] ?? '',
    };
  });
}

const planTrack = (overrides: Partial<MixPlanTrack> & Pick<MixPlanTrack, 'trackId' | 'title'>): MixPlanTrack => ({
  provider: 'youtube',
  bpm: 120,
  key: 'Am',
  playDurationSeconds: 100,
  startOffsetSeconds: 0,
  endOffsetSeconds: 100,
  eqProfile: 'flat',
  energyPreview: [0.5],
  notes: [],
  ...overrides,
});

const manualPlan = (tracks: MixPlanTrack[], totalDurationSeconds: number): MixPlan => ({
  title: 'Manual',
  vibe: 'Chill',
  totalDurationSeconds,
  tracks,
  summary: '',
  warnings: [],
});

describe('buildChapterMetadata', () => {
  const plan = generateMixPlan({ title: 'Friday Set', tracks: makeTracks(5, 77), vibe: 'Late Night' });
  const metadata = buildChapterMetadata(plan);

  it('starts with the ffmetadata magic line', () => {
    expect(metadata.startsWith(';FFMETADATA1\n')).toBe(true);
  });

  it('writes the global header before any chapter', () => {
    const header = metadata.split('[CHAPTER]')[0];
    expect(header).toContain('title=Friday Set');
    expect(header).toContain('artist=mixR');
    expect(header).toContain('genre=Late Night');
  });

  it('emits one chapter per track with a millisecond timebase', () => {
    const chapters = parseChapters(metadata);
    expect(chapters).toHaveLength(plan.tracks.length);
    for (const chapter of chapters) expect(chapter.timebase).toBe('1/1000');
  });

  it('gives every chapter a positive length', () => {
    for (const chapter of parseChapters(metadata)) {
      expect(chapter.end, `chapter ${chapter.title}`).toBeGreaterThan(chapter.start);
    }
  });

  it('keeps chapters ascending and non-overlapping', () => {
    const chapters = parseChapters(metadata);
    for (let index = 1; index < chapters.length; index += 1) {
      expect(chapters[index].start).toBeGreaterThanOrEqual(chapters[index - 1].end);
      expect(chapters[index].start).toBeGreaterThan(chapters[index - 1].start);
    }
  });

  it('lines chapter starts up with the plan timeline', () => {
    const chapters = parseChapters(metadata);
    plan.tracks.forEach((track, index) => {
      expect(chapters[index].start).toBe(Math.round((track.mixStartSeconds ?? 0) * 1000));
    });
    expect(chapters[chapters.length - 1].end).toBe(Math.round(plan.totalDurationSeconds * 1000));
  });

  it('ends with a newline so ffmpeg can parse the final line', () => {
    expect(metadata.endsWith('\n')).toBe(true);
  });

  it('falls back to the running cursor when mixStartSeconds is missing', () => {
    const legacy = manualPlan(
      [
        planTrack({ trackId: 'a', title: 'A', playDurationSeconds: 100, mixStartSeconds: undefined }),
        planTrack({ trackId: 'b', title: 'B', playDurationSeconds: 100, mixStartSeconds: undefined }),
      ],
      200,
    );
    const chapters = parseChapters(buildChapterMetadata(legacy));
    expect(chapters.map((chapter) => [chapter.start, chapter.end])).toEqual([
      [0, 100_000],
      [100_000, 200_000],
    ]);
  });

  it('accounts for crossfade overlap when deriving the cursor', () => {
    const legacy = manualPlan(
      [
        planTrack({
          trackId: 'a',
          title: 'A',
          playDurationSeconds: 100,
          transitionOut: { fromSecond: 90, toSecond: 100, lengthSeconds: 10, style: 'x', reason: 'y' },
        }),
        planTrack({ trackId: 'b', title: 'B', playDurationSeconds: 100 }),
      ],
      190,
    );
    const chapters = parseChapters(buildChapterMetadata(legacy));
    expect(chapters.map((chapter) => [chapter.start, chapter.end])).toEqual([
      [0, 90_000],
      [90_000, 190_000],
    ]);
  });

  it('never emits a zero-length chapter, even for a zero-length track', () => {
    const degenerate = manualPlan(
      [
        planTrack({ trackId: 'a', title: 'A', playDurationSeconds: 0, mixStartSeconds: 0 }),
        planTrack({ trackId: 'b', title: 'B', playDurationSeconds: 10, mixStartSeconds: 0 }),
      ],
      10,
    );
    for (const chapter of parseChapters(buildChapterMetadata(degenerate))) {
      expect(chapter.end).toBeGreaterThan(chapter.start);
    }
  });

  it('handles a single-track plan', () => {
    const single = generateMixPlan({ title: 'Solo', tracks: makeTracks(1, 5), vibe: 'Jazz' });
    const chapters = parseChapters(buildChapterMetadata(single));
    expect(chapters).toHaveLength(1);
    expect(chapters[0].start).toBe(0);
    expect(chapters[0].end).toBe(Math.round(single.totalDurationSeconds * 1000));
  });

  it('produces only a header for an empty plan', () => {
    const empty = generateMixPlan({ title: 'Nothing', tracks: [], vibe: 'Jazz' });
    const output = buildChapterMetadata(empty);
    expect(output).toContain(';FFMETADATA1');
    expect(output).not.toContain('[CHAPTER]');
  });

  it('escapes the ffmetadata special characters in titles', () => {
    const nasty = manualPlan([planTrack({ trackId: 'a', title: 'Song = A; B # C \\ D', mixStartSeconds: 0 })], 100);
    const output = buildChapterMetadata(nasty);

    expect(output).toContain('title=Song \\= A\\; B \\# C \\\\ D');
    // Nothing may be left bare: every special character carries a backslash.
    const value = parseChapters(output)[0].title;
    for (let index = 0; index < value.length; index += 1) {
      if (!'=;#\\'.includes(value[index])) continue;
      if (value[index] === '\\') {
        // A backslash must be part of an escape pair.
        expect('=;#\\\n'.includes(value[index + 1]), `dangling backslash at ${index} in ${value}`).toBe(true);
        index += 1;
        continue;
      }
      expect(value[index - 1], `unescaped ${value[index]} at ${index} in ${value}`).toBe('\\');
    }
  });

  it('escapes newlines in titles and in the mix title', () => {
    const nasty = manualPlan([planTrack({ trackId: 'a', title: 'Line one\nLine two', mixStartSeconds: 0 })], 100);
    nasty.title = 'Mix\nName';
    const output = buildChapterMetadata(nasty);
    expect(output).toContain('title=Line one\\\nLine two');
    expect(output).toContain('title=Mix\\\nName');
    // A raw newline inside a value would otherwise start a bogus metadata key.
    expect(/(^|[^\\])\n[A-Za-z ]+ (one|two)/.test(output)).toBe(false);
  });

  it('escapes the vibe and title in the header', () => {
    const nasty = manualPlan([planTrack({ trackId: 'a', title: 'A', mixStartSeconds: 0 })], 100);
    nasty.title = 'Set #1 = best; really';
    const output = buildChapterMetadata(nasty);
    expect(output).toContain('title=Set \\#1 \\= best\\; really');
  });

  it('is stable across calls', () => {
    expect(buildChapterMetadata(plan)).toBe(metadata);
  });
});

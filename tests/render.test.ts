import { describe, expect, it } from 'vitest';
import { buildChapterMetadata, buildMixFilterGraph } from '../server/lib/render.js';
import { generateMixPlan, vibeProfiles } from '../src/lib/mixEngine.js';
import type { MixPlan, Vibe } from '../src/types.js';
import { makeSegment, makeSegments, makeTracks } from './helpers/fixtures.js';

const ALL_VIBES = Object.keys(vibeProfiles) as Vibe[];

describe('buildMixFilterGraph', () => {
  it('rejects an empty mix', () => {
    expect(() => buildMixFilterGraph([], 'Peak Time')).toThrow();
  });

  it('trims each input with a seek and a duration', () => {
    const graph = buildMixFilterGraph(
      [makeSegment({ mediaPath: '/media/a.flac', startOffsetSeconds: 12.5, playDurationSeconds: 90 })],
      'Peak Time',
    );
    expect(graph.inputArgs).toEqual(['-ss', '12.500', '-t', '90.000', '-i', '/media/a.flac']);
  });

  it('emits one input per track, in order', () => {
    const graph = buildMixFilterGraph(makeSegments(3), 'House');
    expect(graph.inputArgs.filter((arg) => arg === '-i')).toHaveLength(3);
    expect(graph.inputArgs.indexOf('/tmp/mixr/track-0.flac')).toBeLessThan(
      graph.inputArgs.indexOf('/tmp/mixr/track-1.flac'),
    );
    expect(graph.inputArgs.indexOf('/tmp/mixr/track-1.flac')).toBeLessThan(
      graph.inputArgs.indexOf('/tmp/mixr/track-2.flac'),
    );
  });

  it('normalizes rate and layout on every input so acrossfade can join them', () => {
    const graph = buildMixFilterGraph(makeSegments(3), 'Techno');
    for (const index of [0, 1, 2]) expect(graph.filterComplex).toContain(`[${index}:a]aresample=44100`);
    expect(graph.filterComplex.match(/aformat=sample_fmts=fltp:channel_layouts=stereo/g)).toHaveLength(3);
  });

  it('applies gain only where it is non-zero', () => {
    const graph = buildMixFilterGraph(
      [makeSegment({ gainDb: -3.5 }), makeSegment({ gainDb: 0, transitionOutSeconds: 0 })],
      'Peak Time',
    );
    expect(graph.filterComplex).toContain('volume=-3.50dB');
    expect(graph.filterComplex.match(/volume=/g)).toHaveLength(1);
  });

  it('chains crossfades so each consumes the running mix', () => {
    const graph = buildMixFilterGraph(
      [
        makeSegment({ mediaPath: '/a.flac', transitionOutSeconds: 8 }),
        makeSegment({ mediaPath: '/b.flac', transitionOutSeconds: 6 }),
        makeSegment({ mediaPath: '/c.flac', transitionOutSeconds: 0 }),
      ],
      'Peak Time',
    );

    expect(graph.filterComplex).toContain('[a0][a1]acrossfade=d=8.000');
    expect(graph.filterComplex).toContain('[x1][a2]acrossfade=d=6.000');
    expect(graph.filterComplex.match(/acrossfade/g)).toHaveLength(2);
  });

  it('uses the curve the vibe asks for', () => {
    expect(buildMixFilterGraph(makeSegments(2), 'Festival').filterComplex).toContain('c1=exp:c2=exp');
    expect(buildMixFilterGraph(makeSegments(2), 'Ambient').filterComplex).toContain('c1=hsin:c2=hsin');
  });

  it('butt-joins with concat when a transition has no length', () => {
    const graph = buildMixFilterGraph(
      [makeSegment({ transitionOutSeconds: 0 }), makeSegment({ transitionOutSeconds: 0 })],
      'Peak Time',
    );
    expect(graph.filterComplex).toContain('concat=n=2:v=0:a=1');
    expect(graph.filterComplex).not.toContain('acrossfade');
  });

  it('keeps the master chain inside the graph, since ffmpeg forbids -af alongside it', () => {
    const graph = buildMixFilterGraph(makeSegments(2), 'Peak Time', ['alimiter=limit=0.977']);
    expect(graph.filterComplex).toContain('alimiter=limit=0.977[mix]');
    expect(graph.outputLabel).toBe('[mix]');
  });

  it('maps a real label for a single track with no master chain', () => {
    const graph = buildMixFilterGraph([makeSegment()], 'Peak Time');
    expect(graph.outputLabel).toBe('[a0]');
    expect(graph.filterComplex).toContain('[a0]');
  });

  it('produces every label it consumes, for any track count and vibe', () => {
    for (const count of [1, 2, 3, 8]) {
      for (const vibe of ['Peak Time', 'Ambient', 'Festival'] as Vibe[]) {
        const graph = buildMixFilterGraph(makeSegments(count), vibe, ['alimiter=limit=0.977:level=false']);
        const produced = new Set<string>();

        for (const chain of graph.filterComplex.split(';')) {
          const inputs = chain.match(/^(\[[a-z0-9:]+\])+/)?.[0].match(/\[[a-z0-9:]+\]/g) ?? [];
          for (const label of inputs) {
            // Either a raw ffmpeg input stream, or something an earlier chain made.
            expect(/^\[\d+:a\]$/.test(label) || produced.has(label)).toBe(true);
          }
          const output = chain.match(/\[[a-z0-9]+\]$/)?.[0];
          if (output) produced.add(output);
        }

        expect(produced.has(graph.outputLabel)).toBe(true);
      }
    }
  });

  it('never lets a crossfade outlast the audio feeding it', () => {
    // acrossfade fails outright if d exceeds either input, so a real plan must
    // never generate one.
    for (const vibe of ALL_VIBES) {
      const plan = generateMixPlan({ title: 'Test', tracks: makeTracks(5, 23), vibe });
      const segments = plan.tracks.map((track) => ({
        mediaPath: `/tmp/${track.trackId}.flac`,
        startOffsetSeconds: track.startOffsetSeconds,
        playDurationSeconds: track.playDurationSeconds,
        gainDb: track.gainDb ?? 0,
        transitionOutSeconds: track.transitionOut?.lengthSeconds ?? 0,
      }));

      segments.forEach((segment, index) => {
        if (segment.transitionOutSeconds <= 0) return;
        expect(segment.transitionOutSeconds).toBeLessThan(segment.playDurationSeconds);
        expect(segment.transitionOutSeconds).toBeLessThan(segments[index + 1].playDurationSeconds);
      });

      expect(() => buildMixFilterGraph(segments, vibe, ['alimiter=limit=0.977'])).not.toThrow();
    }
  });

  it('quotes nothing it should not, so paths stay intact', () => {
    const graph = buildMixFilterGraph([makeSegment({ mediaPath: '/tmp/a song (remix).flac' })], 'Peak Time');
    // Paths travel as their own argv entries, never inside the filter string.
    expect(graph.inputArgs).toContain('/tmp/a song (remix).flac');
    expect(graph.filterComplex).not.toContain('/tmp/a song');
  });
});

describe('buildChapterMetadata', () => {
  const plan: MixPlan = {
    title: 'Night Drive',
    vibe: 'Late Night',
    totalDurationSeconds: 300,
    summary: '',
    warnings: [],
    tracks: [
      {
        trackId: 'a',
        title: 'First',
        provider: 'youtube',
        bpm: 120,
        key: 'Am',
        playDurationSeconds: 120,
        startOffsetSeconds: 0,
        endOffsetSeconds: 120,
        eqProfile: '',
        mixStartSeconds: 0,
        energyPreview: [],
        transitionOut: { fromSecond: 110, toSecond: 120, lengthSeconds: 10, style: 'blend', reason: '' },
        notes: [],
      },
      {
        trackId: 'b',
        title: 'Second',
        provider: 'youtube',
        bpm: 122,
        key: 'Am',
        playDurationSeconds: 190,
        startOffsetSeconds: 0,
        endOffsetSeconds: 190,
        eqProfile: '',
        mixStartSeconds: 110,
        energyPreview: [],
        transitionIn: { fromSecond: 0, toSecond: 10, lengthSeconds: 10, style: 'blend', reason: '' },
        notes: [],
      },
    ],
  };

  it('writes one chapter per track using mix-relative times', () => {
    const metadata = buildChapterMetadata(plan);

    expect(metadata.startsWith(';FFMETADATA1')).toBe(true);
    expect(metadata).toContain('title=Night Drive');
    expect(metadata.match(/\[CHAPTER\]/g)).toHaveLength(2);
    expect(metadata).toContain('START=0\nEND=110000');
    expect(metadata).toContain('START=110000\nEND=300000');
  });

  it('escapes what ffmpeg treats as syntax', () => {
    const metadata = buildChapterMetadata({
      ...plan,
      title: 'Mix=One;Two#Three',
      tracks: [{ ...plan.tracks[0], title: 'Track=A' }],
    });

    expect(metadata).toContain('title=Mix\\=One\\;Two\\#Three');
    expect(metadata).toContain('title=Track\\=A');
  });

  it('never emits a zero-length chapter', () => {
    const metadata = buildChapterMetadata({
      ...plan,
      totalDurationSeconds: 0,
      tracks: [{ ...plan.tracks[0], mixStartSeconds: 0, playDurationSeconds: 0, transitionOut: undefined }],
    });

    const start = Number(metadata.match(/START=(\d+)/)![1]);
    const end = Number(metadata.match(/END=(\d+)/)![1]);
    expect(end).toBeGreaterThan(start);
  });

  it('produces chapters that march forward for a real plan', () => {
    const generated = generateMixPlan({ title: 'Real', tracks: makeTracks(5, 31), vibe: 'House' });
    const metadata = buildChapterMetadata(generated);

    const starts = [...metadata.matchAll(/START=(\d+)/g)].map((match) => Number(match[1]));
    const ends = [...metadata.matchAll(/END=(\d+)/g)].map((match) => Number(match[1]));

    expect(starts).toHaveLength(generated.tracks.length);
    for (let index = 0; index < starts.length; index += 1) {
      expect(ends[index]).toBeGreaterThan(starts[index]);
      if (index > 0) expect(starts[index]).toBeGreaterThanOrEqual(starts[index - 1]);
    }
  });
});

import { describe, expect, it } from 'vitest';
import { buildMixFilterGraph } from '../server/lib/render.js';
import { allVibes, crossfadeCurveFor, eqFiltersFor, vibeProfiles } from '../src/lib/mixEngine.js';
import type { Vibe } from '../src/types.js';
import { makeSegment, makeSegments } from './helpers/fixtures.js';
import {
  ACROSSFADE_CURVES,
  collectGraphProblems,
  parseFilterComplex,
  parseInputArgs,
} from './helpers/filterGraph.js';

const describeProblems = (problems: { kind: string; detail: string }[]) =>
  problems.map((problem) => `[${problem.kind}] ${problem.detail}`).join('\n');

describe('buildMixFilterGraph — inputs', () => {
  it('emits exactly one -ss/-t/-i triplet per segment, in that order', () => {
    const segments = makeSegments(4);
    const graph = buildMixFilterGraph(segments, 'Peak Time');

    expect(graph.inputArgs.filter((arg) => arg === '-i')).toHaveLength(4);
    expect(graph.inputArgs.filter((arg) => arg === '-ss')).toHaveLength(4);
    expect(graph.inputArgs.filter((arg) => arg === '-t')).toHaveLength(4);

    const parsed = parseInputArgs(graph.inputArgs);
    expect(parsed).toHaveLength(4);
    parsed.forEach((input, index) => {
      expect(input.path).toBe(segments[index].mediaPath);
      expect(input.startOffset).toBeCloseTo(segments[index].startOffsetSeconds, 3);
      expect(input.duration).toBeCloseTo(segments[index].playDurationSeconds, 3);
    });
  });

  it('formats seek and duration with millisecond precision', () => {
    const graph = buildMixFilterGraph(
      [makeSegment({ startOffsetSeconds: 12.3456, playDurationSeconds: 180.6789, transitionOutSeconds: 0 })],
      'Chill',
    );
    expect(graph.inputArgs).toEqual(['-ss', '12.346', '-t', '180.679', '-i', '/tmp/mixr/a.flac']);
  });

  it('keeps the media path as a single argument so spaces survive', () => {
    const path = '/Users/me/Music/My Track (Extended Mix).flac';
    const graph = buildMixFilterGraph([makeSegment({ mediaPath: path, transitionOutSeconds: 0 })], 'Chill');
    expect(graph.inputArgs).toContain(path);
  });

  it('throws a clear error for an empty segment list', () => {
    expect(() => buildMixFilterGraph([], 'Chill')).toThrowError(/at least one track/i);
  });
});

describe('buildMixFilterGraph — graph structure', () => {
  it.each([1, 2, 3, 5, 12])('produces a well-formed graph for %s segments', (count) => {
    const graph = buildMixFilterGraph(makeSegments(count), 'Peak Time');
    const problems = collectGraphProblems(graph, count);
    expect(problems, describeProblems(problems)).toEqual([]);
  });

  it.each(allVibes)('produces a well-formed graph for %s', (vibe) => {
    const graph = buildMixFilterGraph(makeSegments(4), vibe, ['alimiter=limit=0.977:level=false']);
    const problems = collectGraphProblems(graph, 4);
    expect(problems, describeProblems(problems)).toEqual([]);
  });

  it('references every input label exactly once', () => {
    const graph = buildMixFilterGraph(makeSegments(6), 'House');
    const references = [...graph.filterComplex.matchAll(/\[(\d+):a\]/g)].map((match) => match[1]);
    expect(references.sort()).toEqual(['0', '1', '2', '3', '4', '5']);
  });

  it('declares an output label that the last chain actually produces', () => {
    for (const count of [1, 2, 7]) {
      for (const master of [[], ['alimiter=limit=0.977:level=false']]) {
        const graph = buildMixFilterGraph(makeSegments(count), 'Techno', master);
        const chains = parseFilterComplex(graph.filterComplex);
        const last = chains[chains.length - 1];
        expect(last.outputs, `count=${count} master=${master.length}`).toEqual([
          graph.outputLabel.replace(/^\[|\]$/g, ''),
        ]);
      }
    }
  });

  it('never defines a label twice', () => {
    const graph = buildMixFilterGraph(makeSegments(8), 'Trance');
    const outputs = parseFilterComplex(graph.filterComplex).flatMap((chain) => chain.outputs);
    expect(new Set(outputs).size).toBe(outputs.length);
  });

  it('only consumes labels that an earlier chain defined', () => {
    const graph = buildMixFilterGraph(makeSegments(5), 'Trance');
    const defined = new Set<string>();
    for (const chain of parseFilterComplex(graph.filterComplex)) {
      for (const input of chain.inputs) {
        if (/^\d+:a$/.test(input)) continue;
        expect(defined.has(input), `[${input}] is consumed before it is defined`).toBe(true);
      }
      for (const output of chain.outputs) defined.add(output);
    }
  });

  it.each([1, 2, 3, 6, 10])('uses exactly n-1 join stages for %s segments', (count) => {
    const graph = buildMixFilterGraph(makeSegments(count), 'Peak Time');
    const joins = parseFilterComplex(graph.filterComplex).filter((chain) =>
      chain.filters.some((filter) => filter.startsWith('acrossfade') || filter.startsWith('concat')),
    );
    expect(joins).toHaveLength(count - 1);
    for (const join of joins) expect(join.inputs).toHaveLength(2);
  });

  it('produces a valid single-segment graph with no crossfade at all', () => {
    const graph = buildMixFilterGraph([makeSegment({ transitionOutSeconds: 0 })], 'Ambient');
    expect(graph.filterComplex).not.toContain('acrossfade');
    expect(graph.filterComplex).not.toContain('concat');
    expect(graph.outputLabel).toBe('[a0]');
    expect(parseFilterComplex(graph.filterComplex)).toHaveLength(1);
    expect(collectGraphProblems(graph, 1)).toEqual([]);
  });

  it('per-segment chains resample, reformat, and de-click every input', () => {
    const graph = buildMixFilterGraph(makeSegments(3), 'Ambient');
    const chains = parseFilterComplex(graph.filterComplex).slice(0, 3);
    chains.forEach((chain, index) => {
      expect(chain.inputs).toEqual([`${index}:a`]);
      expect(chain.outputs).toEqual([`a${index}`]);
      expect(chain.filters[0]).toContain('aresample=44100');
      expect(chain.filters.some((filter) => filter.startsWith('aformat='))).toBe(true);
      expect(chain.filters[chain.filters.length - 1]).toMatch(/^afade=t=in:st=0:d=/);
    });
  });

  it('applies a volume filter only when a gain is requested', () => {
    const withGain = buildMixFilterGraph([makeSegment({ gainDb: -3.25, transitionOutSeconds: 0 })], 'Chill');
    expect(withGain.filterComplex).toContain('volume=-3.25dB');

    const withoutGain = buildMixFilterGraph([makeSegment({ gainDb: 0, transitionOutSeconds: 0 })], 'Chill');
    expect(withoutGain.filterComplex).not.toContain('volume=');
  });

  it.each(allVibes)('inlines the %s eq chain into every segment', (vibe) => {
    const filters = eqFiltersFor(vibe);
    const graph = buildMixFilterGraph(makeSegments(2), vibe);
    const chains = parseFilterComplex(graph.filterComplex);
    for (let index = 0; index < 2; index += 1) {
      for (const filter of filters) {
        expect(chains[index].filters, `${vibe} segment ${index}`).toContain(filter);
      }
    }
  });
});

describe('buildMixFilterGraph — crossfades', () => {
  it('sets d= to the transitionOut of the segment the blend leaves', () => {
    const segments = [
      makeSegment({ mediaPath: '/a.flac', transitionOutSeconds: 6 }),
      makeSegment({ mediaPath: '/b.flac', transitionOutSeconds: 11.5 }),
      makeSegment({ mediaPath: '/c.flac', transitionOutSeconds: 3 }),
      makeSegment({ mediaPath: '/d.flac', transitionOutSeconds: 0 }),
    ];
    const graph = buildMixFilterGraph(segments, 'Peak Time');
    const durations = [...graph.filterComplex.matchAll(/acrossfade=d=([\d.]+)/g)].map((match) => Number(match[1]));
    expect(durations).toEqual([6, 11.5, 3]);
  });

  it('uses the same curve on both sides, and one ffmpeg accepts', () => {
    for (const vibe of allVibes) {
      const graph = buildMixFilterGraph(makeSegments(3), vibe as Vibe);
      const curves = [...graph.filterComplex.matchAll(/acrossfade=d=[\d.]+:c1=([a-z0-9]+):c2=([a-z0-9]+)/g)];
      expect(curves.length, `${vibe} produced no crossfades`).toBe(2);
      for (const [, c1, c2] of curves) {
        expect(c1).toBe(c2);
        expect(ACROSSFADE_CURVES.has(c1), `${vibe} -> ${c1}`).toBe(true);
        expect(c1).toBe(crossfadeCurveFor(vibeProfiles[vibe as Vibe].transitionStyle));
      }
    }
  });

  it('concatenates instead of emitting acrossfade=d=0, which ffmpeg rejects', () => {
    const segments = [
      makeSegment({ mediaPath: '/a.flac', transitionOutSeconds: 0 }),
      makeSegment({ mediaPath: '/b.flac', transitionOutSeconds: 8 }),
      makeSegment({ mediaPath: '/c.flac', transitionOutSeconds: 0 }),
    ];
    const graph = buildMixFilterGraph(segments, 'Festival');

    expect(graph.filterComplex).not.toContain('d=0.000');
    const joins = parseFilterComplex(graph.filterComplex).filter(
      (chain) => chain.inputs.length === 2,
    );
    expect(joins[0].filters[0]).toMatch(/^concat=n=2:v=0:a=1$/);
    expect(joins[1].filters[0]).toMatch(/^acrossfade=d=8\.000/);
    expect(collectGraphProblems(graph, 3)).toEqual([]);
  });

  it('concatenates when a transition length is negative', () => {
    const segments = [
      makeSegment({ mediaPath: '/a.flac', transitionOutSeconds: -4 }),
      makeSegment({ mediaPath: '/b.flac', transitionOutSeconds: 0 }),
    ];
    const graph = buildMixFilterGraph(segments, 'Festival');
    expect(graph.filterComplex).toContain('concat=n=2:v=0:a=1');
    expect(graph.filterComplex).not.toContain('acrossfade');
  });

  it('chains blends left to right so each one consumes the previous result', () => {
    const graph = buildMixFilterGraph(makeSegments(4), 'House');
    const joins = parseFilterComplex(graph.filterComplex).filter((chain) => chain.inputs.length === 2);
    expect(joins.map((join) => join.inputs)).toEqual([
      ['a0', 'a1'],
      ['x1', 'a2'],
      ['x2', 'a3'],
    ]);
    expect(joins.map((join) => join.outputs.join())).toEqual(['x1', 'x2', 'x3']);
  });
});

describe('buildMixFilterGraph — master chain', () => {
  it('appends the master filters and renames the output to [mix]', () => {
    const graph = buildMixFilterGraph(makeSegments(3), 'Peak Time', [
      'volume=-2.00dB',
      'alimiter=limit=0.977:level=false',
    ]);

    expect(graph.outputLabel).toBe('[mix]');
    const chains = parseFilterComplex(graph.filterComplex);
    const last = chains[chains.length - 1];
    expect(last.inputs).toEqual(['x2']);
    expect(last.filters).toEqual(['volume=-2.00dB', 'alimiter=limit=0.977:level=false']);
    expect(last.outputs).toEqual(['mix']);
    expect(collectGraphProblems(graph, 3)).toEqual([]);
  });

  it('applies the master chain to a single-segment mix too', () => {
    const graph = buildMixFilterGraph([makeSegment({ transitionOutSeconds: 0 })], 'Peak Time', ['alimiter=limit=0.9']);
    expect(graph.outputLabel).toBe('[mix]');
    const chains = parseFilterComplex(graph.filterComplex);
    expect(chains[chains.length - 1].inputs).toEqual(['a0']);
    expect(collectGraphProblems(graph, 1)).toEqual([]);
  });

  it('leaves the output label on the last blend when there is no master chain', () => {
    const graph = buildMixFilterGraph(makeSegments(3), 'Peak Time');
    expect(graph.outputLabel).toBe('[x2]');
    expect(graph.filterComplex).not.toContain('[mix]');
  });

  it('never emits whitespace inside the filter_complex argument', () => {
    const graph = buildMixFilterGraph(makeSegments(5), 'Winter Chill', ['alimiter=limit=0.977:level=false']);
    expect(/\s/.test(graph.filterComplex), graph.filterComplex).toBe(false);
  });

  it('is a pure function of its arguments', () => {
    const segments = makeSegments(3);
    const snapshot = JSON.stringify(segments);
    const first = buildMixFilterGraph(segments, 'Soul', ['alimiter=limit=0.977']);
    const second = buildMixFilterGraph(segments, 'Soul', ['alimiter=limit=0.977']);
    expect(first).toEqual(second);
    expect(JSON.stringify(segments)).toBe(snapshot);
  });
});

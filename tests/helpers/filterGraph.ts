import type { MixFilterGraph } from '../../server/lib/render.js';

export interface ParsedChain {
  raw: string;
  /** Labels consumed by the chain, e.g. `0:a` or `a3`. */
  inputs: string[];
  /** Labels produced by the chain. */
  outputs: string[];
  /** The filters between the labels, split on top-level commas. */
  filters: string[];
}

/**
 * Splits an ffmpeg filter_complex into chains and pulls the labels off each end.
 * Deliberately strict: anything that is not `[label]filters[label]` is an error,
 * because ffmpeg would reject it too.
 */
export function parseFilterComplex(filterComplex: string): ParsedChain[] {
  if (filterComplex.trim() === '') return [];

  return filterComplex.split(';').map((piece) => {
    const chain = piece.trim();
    if (chain === '') throw new Error(`Empty chain in filter_complex: ${filterComplex}`);

    const inputs: string[] = [];
    let start = 0;
    while (chain[start] === '[') {
      const close = chain.indexOf(']', start);
      if (close === -1) throw new Error(`Unterminated input label in chain "${chain}"`);
      inputs.push(chain.slice(start + 1, close));
      start = close + 1;
    }

    const outputs: string[] = [];
    let end = chain.length;
    while (chain[end - 1] === ']') {
      const open = chain.lastIndexOf('[', end - 1);
      if (open === -1 || open < start) throw new Error(`Unterminated output label in chain "${chain}"`);
      outputs.unshift(chain.slice(open + 1, end - 1));
      end = open;
    }

    const body = chain.slice(start, end);
    if (body.includes('[') || body.includes(']')) {
      throw new Error(`Labels appear in the middle of chain "${chain}"`);
    }

    return {
      raw: chain,
      inputs,
      outputs,
      filters: body === '' ? [] : body.split(','),
    };
  });
}

export interface GraphProblem {
  kind:
    | 'duplicate-label'
    | 'undefined-label'
    | 'unconsumed-label'
    | 'source-usage'
    | 'output-label-mismatch'
    | 'empty-filter';
  detail: string;
}

/**
 * Validates the whole class of graph bugs that only show up as an ffmpeg crash:
 * labels defined twice, labels consumed before they exist, dangling
 * intermediates, and a declared output label the graph never produces.
 */
export function collectGraphProblems(graph: MixFilterGraph, segmentCount: number): GraphProblem[] {
  const problems: GraphProblem[] = [];
  const add = (kind: GraphProblem['kind'], detail: string) => problems.push({ kind, detail });

  const chains = parseFilterComplex(graph.filterComplex);
  const defined = new Set<string>();
  const consumed = new Map<string, number>();

  chains.forEach((chain, index) => {
    for (const input of chain.inputs) {
      const isSource = /^\d+:a$/.test(input);
      if (!isSource && !defined.has(input)) {
        add('undefined-label', `chain ${index} ("${chain.raw}") consumes [${input}] before it is defined`);
      }
      consumed.set(input, (consumed.get(input) ?? 0) + 1);
    }
    for (const output of chain.outputs) {
      if (defined.has(output) || /^\d+:a$/.test(output)) {
        add('duplicate-label', `chain ${index} ("${chain.raw}") redefines [${output}]`);
      }
      defined.add(output);
    }
    if (chain.filters.length === 0) {
      add('empty-filter', `chain ${index} ("${chain.raw}") has no filters`);
    }
    for (const filter of chain.filters) {
      if (filter.trim() === '' || /\s/.test(filter)) {
        add('empty-filter', `chain ${index} has a blank or space-containing filter "${filter}"`);
      }
    }
  });

  for (let index = 0; index < segmentCount; index += 1) {
    const label = `${index}:a`;
    const uses = consumed.get(label) ?? 0;
    if (uses !== 1) add('source-usage', `input label [${label}] is referenced ${uses} times, expected exactly 1`);
  }
  for (const label of consumed.keys()) {
    if (/^(\d+):a$/.test(label) && Number(label.split(':')[0]) >= segmentCount) {
      add('source-usage', `graph references [${label}] but there are only ${segmentCount} inputs`);
    }
  }

  const finalLabel = graph.outputLabel.replace(/^\[|\]$/g, '');
  for (const label of defined) {
    const uses = consumed.get(label) ?? 0;
    if (label === finalLabel) continue;
    if (uses !== 1) add('unconsumed-label', `intermediate [${label}] is consumed ${uses} times, expected exactly 1`);
  }

  const lastChain = chains[chains.length - 1];
  if (!lastChain || lastChain.outputs.length !== 1 || lastChain.outputs[0] !== finalLabel) {
    add(
      'output-label-mismatch',
      `outputLabel ${graph.outputLabel} is not produced by the last chain "${lastChain?.raw ?? '(none)'}"`,
    );
  }
  if (!defined.has(finalLabel)) {
    add('output-label-mismatch', `outputLabel ${graph.outputLabel} is never defined by the graph`);
  }

  return problems;
}

/** Groups `['-ss','1.000','-t','2.000','-i','path']` runs back into objects. */
export interface ParsedInput {
  startOffset: number;
  duration: number;
  path: string;
}

export function parseInputArgs(args: string[]): ParsedInput[] {
  const inputs: ParsedInput[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== '-i') continue;
    // -ss and -t are input options, so they must precede the -i they apply to.
    const flags = args.slice(0, index);
    const tIndex = flags.lastIndexOf('-t');
    const ssIndex = flags.lastIndexOf('-ss');
    if (ssIndex === -1 || tIndex === -1) throw new Error(`Input at ${index} is missing -ss/-t: ${args.join(' ')}`);
    if (!(ssIndex < tIndex && tIndex === index - 2)) {
      throw new Error(`Input at ${index} has -ss/-t out of order: ${args.join(' ')}`);
    }
    inputs.push({
      startOffset: Number(args[ssIndex + 1]),
      duration: Number(args[tIndex + 1]),
      path: args[index + 1],
    });
  }
  return inputs;
}

/** Curve names ffmpeg's acrossfade actually accepts. */
export const ACROSSFADE_CURVES = new Set([
  'tri', 'qsin', 'hsin', 'esin', 'log', 'ipar', 'qua', 'cub', 'squ', 'cbr', 'par', 'exp',
  'iqsin', 'ihsin', 'dese', 'desi', 'losi', 'sinc', 'isinc', 'quat', 'quatr', 'qsin2', 'hsin2',
  'nofade',
]);

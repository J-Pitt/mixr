import type { MixPlan, TrackInput } from '../../src/types.js';

export type ViolationKind =
  | 'window-identity'
  | 'window-bounds'
  | 'total-duration'
  | 'mix-start-chain'
  | 'crossfade-feasibility'
  | 'transition-pairing'
  | 'edge-transitions'
  | 'energy-preview'
  | 'track-identity';

export interface Violation {
  kind: ViolationKind;
  detail: string;
}

const ROUNDING_TOLERANCE = 1;
const EXACT_TOLERANCE = 1e-6;

/**
 * Every structural property the renderer, the chapter writer, and the UI
 * timeline rely on. Returned as data rather than assertions so a single test can
 * report which class of invariant broke, and so the known-bug tests can target
 * one class without masking the others.
 */
export function collectPlanViolations(plan: MixPlan, inputs: TrackInput[]): Violation[] {
  const violations: Violation[] = [];
  const add = (kind: ViolationKind, detail: string) => violations.push({ kind, detail });
  const sourceById = new Map(inputs.map((track) => [track.id, track]));

  const planIds = plan.tracks.map((track) => track.trackId);
  const inputIds = inputs.map((track) => track.id);
  if ([...planIds].sort().join('|') !== [...inputIds].sort().join('|')) {
    add('track-identity', `plan tracks ${planIds.join(',')} do not match inputs ${inputIds.join(',')}`);
  }

  plan.tracks.forEach((track, index) => {
    const label = `track[${index}] ${track.trackId}`;
    const incoming = track.transitionIn?.lengthSeconds ?? 0;
    const outgoing = track.transitionOut?.lengthSeconds ?? 0;

    const windowLength = track.endOffsetSeconds - track.startOffsetSeconds;
    if (Math.abs(track.playDurationSeconds - windowLength) > EXACT_TOLERANCE) {
      add(
        'window-identity',
        `${label}: playDurationSeconds ${track.playDurationSeconds} !== endOffsetSeconds ${track.endOffsetSeconds} - startOffsetSeconds ${track.startOffsetSeconds} (${windowLength})`,
      );
    }

    if (track.startOffsetSeconds < 0) {
      add('window-bounds', `${label}: startOffsetSeconds ${track.startOffsetSeconds} is negative`);
    }
    if (track.endOffsetSeconds < track.startOffsetSeconds) {
      add('window-bounds', `${label}: endOffsetSeconds ${track.endOffsetSeconds} precedes startOffsetSeconds ${track.startOffsetSeconds}`);
    }
    const source = sourceById.get(track.trackId);
    if (source && track.endOffsetSeconds > source.analysis.durationSeconds + EXACT_TOLERANCE) {
      add(
        'window-bounds',
        `${label}: endOffsetSeconds ${track.endOffsetSeconds} exceeds source duration ${source.analysis.durationSeconds}`,
      );
    }
    if (track.playDurationSeconds <= 0) {
      add('window-bounds', `${label}: playDurationSeconds ${track.playDurationSeconds} is not positive`);
    }

    if (incoming + outgoing > track.playDurationSeconds + EXACT_TOLERANCE) {
      add(
        'crossfade-feasibility',
        `${label}: transitionIn ${incoming} + transitionOut ${outgoing} exceeds playDurationSeconds ${track.playDurationSeconds}`,
      );
    }
    if (incoming < 0 || outgoing < 0) {
      add('crossfade-feasibility', `${label}: negative transition length in=${incoming} out=${outgoing}`);
    }

    if (index === 0 && track.transitionIn) {
      add('edge-transitions', 'the first track must not have a transitionIn');
    }
    if (index === plan.tracks.length - 1 && track.transitionOut) {
      add('edge-transitions', 'the last track must not have a transitionOut');
    }

    if (index > 0) {
      const previous = plan.tracks[index - 1];
      const previousOut = previous.transitionOut?.lengthSeconds ?? 0;
      if (Math.abs(incoming - previousOut) > EXACT_TOLERANCE) {
        add(
          'transition-pairing',
          `${label}: transitionIn ${incoming} !== previous transitionOut ${previousOut}`,
        );
      }

      const expectedStart = (previous.mixStartSeconds ?? 0) + previous.playDurationSeconds - previousOut;
      const actualStart = track.mixStartSeconds ?? Number.NaN;
      if (!(Math.abs(actualStart - expectedStart) <= EXACT_TOLERANCE)) {
        add(
          'mix-start-chain',
          `${label}: mixStartSeconds ${actualStart} !== previous chain position ${expectedStart}`,
        );
      }
      if (!(actualStart > (previous.mixStartSeconds ?? 0))) {
        add(
          'mix-start-chain',
          `${label}: mixStartSeconds ${actualStart} is not greater than previous ${previous.mixStartSeconds}`,
        );
      }
    } else if (plan.tracks.length > 0 && track.mixStartSeconds !== 0) {
      add('mix-start-chain', `${label}: first track must start at 0, got ${track.mixStartSeconds}`);
    }

    if (!Array.isArray(track.energyPreview) || track.energyPreview.length === 0) {
      add('energy-preview', `${label}: energyPreview is empty`);
    } else {
      const bad = track.energyPreview.find((value) => !Number.isFinite(value) || value < 0 || value > 1);
      if (bad !== undefined) {
        add('energy-preview', `${label}: energyPreview contains ${bad}, expected a finite value in [0,1]`);
      }
    }
  });

  const playSum = plan.tracks.reduce((sum, track) => sum + track.playDurationSeconds, 0);
  const overlapSum = plan.tracks.reduce((sum, track) => sum + (track.transitionOut?.lengthSeconds ?? 0), 0);
  const expectedTotal = playSum - overlapSum;
  if (Math.abs(plan.totalDurationSeconds - expectedTotal) > ROUNDING_TOLERANCE) {
    add(
      'total-duration',
      `totalDurationSeconds ${plan.totalDurationSeconds} !== sum(play) ${playSum} - sum(transitionOut) ${overlapSum} = ${expectedTotal}`,
    );
  }

  return violations;
}

export function violationsOf(violations: Violation[], kind: ViolationKind): string[] {
  return violations.filter((entry) => entry.kind === kind).map((entry) => entry.detail);
}

export function describeViolations(violations: Violation[]): string {
  return violations.map((entry) => `[${entry.kind}] ${entry.detail}`).join('\n');
}

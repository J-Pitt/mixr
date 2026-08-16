import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import type { MixRecord, RenderProgress, TrackInput, TrackRequest, Vibe } from '../../src/types.js';
import { generateMixPlan, resolveVibe } from '../../src/lib/mixEngine.js';
import { expandTrackRequests, ingestTrack } from './ingest.js';
import { paths } from './paths.js';
import { renderMix } from './render.js';
import { addMix } from './store.js';

export interface MixJobRequest {
  title: string;
  vibes: Vibe[];
  targetMinutes?: number;
  tracks: TrackRequest[];
}

interface Job {
  state: RenderProgress;
  controller: AbortController;
  emitter: EventEmitter;
  finished: boolean;
}

const jobs = new Map<string, Job>();

/** Jobs are kept briefly after finishing so a reconnecting client can read the result. */
const RETENTION_MS = 30 * 60_000;

function labelFor(request: TrackRequest): string {
  if (request.kind === 'query') return request.query;
  if (request.kind === 'link') return request.url;
  return path.basename(request.path);
}

function publish(job: Job): void {
  job.emitter.emit('update', job.state);
}

function update(job: Job, patch: Partial<RenderProgress>): void {
  job.state = { ...job.state, ...patch };
  publish(job);
}

export function getJob(jobId: string): RenderProgress | undefined {
  return jobs.get(jobId)?.state;
}

export function subscribe(jobId: string, listener: (state: RenderProgress) => void): () => void {
  const job = jobs.get(jobId);
  if (!job) return () => undefined;

  job.emitter.on('update', listener);
  return () => job.emitter.off('update', listener);
}

export function cancelJob(jobId: string): boolean {
  const job = jobs.get(jobId);
  if (!job || job.finished) return false;
  job.controller.abort();
  return true;
}

export function startMixJob(request: MixJobRequest): string {
  if (request.tracks.length === 0) throw new Error('Add at least one song.');

  const jobId = crypto.randomUUID();
  const controller = new AbortController();
  const job: Job = {
    controller,
    emitter: new EventEmitter(),
    finished: false,
    state: {
      jobId,
      stage: 'queued',
      progress: 0,
      message: 'Getting ready',
      tracks: request.tracks.map((track) => ({ label: labelFor(track), status: 'pending' })),
    },
  };
  // Many clients can watch one job; Node's default cap of 10 is easy to exceed.
  job.emitter.setMaxListeners(50);
  jobs.set(jobId, job);

  void execute(job, request).finally(() => {
    job.finished = true;
    setTimeout(() => jobs.delete(jobId), RETENTION_MS).unref?.();
  });

  return jobId;
}

/** Ingest occupies the first 70% of the bar; rendering the rest. */
const INGEST_SHARE = 0.7;

async function execute(job: Job, request: MixJobRequest): Promise<void> {
  const { signal } = job.controller;

  try {
    update(job, { stage: 'resolving', message: 'Reading the track list' });
    const tracks = await expandTrackRequests(request.tracks, signal);
    update(job, {
      tracks: tracks.map((track) => ({ label: labelFor(track), status: 'pending' })),
    });

    const ingested: TrackInput[] = [];
    const mediaPaths = new Map<string, string>();
    const failures: string[] = [];

    for (let index = 0; index < tracks.length; index += 1) {
      if (signal.aborted) throw new Error('Cancelled');

      const trackRequest = tracks[index];
      const setStatus = (status: 'pending' | 'working' | 'ready' | 'error', detail?: string) => {
        const tracks = [...job.state.tracks];
        tracks[index] = { ...tracks[index], status, detail };
        update(job, { tracks });
      };

      setStatus('working', 'Looking it up');
      const baseProgress = (index / tracks.length) * INGEST_SHARE;
      const slice = INGEST_SHARE / tracks.length;

      try {
        const { track, reused, note } = await ingestTrack(trackRequest, {
          signal,
          onProgress: (progress) => {
            const phaseWeights = { resolving: 0.05, downloading: 0.55, transcoding: 0.75, analyzing: 0.9 };
            const within = progress.phase === 'downloading' && progress.fraction !== undefined
              ? 0.05 + progress.fraction * 0.5
              : phaseWeights[progress.phase];

            const messages = {
              resolving: 'Finding the track',
              downloading: 'Downloading audio',
              transcoding: 'Converting audio',
              analyzing: 'Analyzing tempo and key',
            };
            setStatus('working', messages[progress.phase]);
            update(job, {
              stage: progress.phase === 'analyzing' ? 'analyzing' : 'downloading',
              progress: baseProgress + within * slice,
              message: `${messages[progress.phase]} (${index + 1} of ${tracks.length})`,
            });
          },
        });

        ingested.push({
          id: track.id,
          title: track.title,
          artist: track.artist,
          provider: track.provider,
          analysis: track.analysis,
          loudness: track.loudness,
        });
        mediaPaths.set(track.id, path.join(paths.media, track.mediaFile));

        const detailParts = [`${Math.round(track.analysis.durationSeconds)}s`, `${track.analysis.bpm} BPM`, track.analysis.key];
        if (reused) detailParts.push('cached');
        setStatus('ready', detailParts.join(' · '));
        if (note) failures.push(note);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (signal.aborted) throw new Error('Cancelled');
        setStatus('error', message);
        failures.push(`${labelFor(trackRequest)}: ${message}`);
      }
    }

    if (signal.aborted) throw new Error('Cancelled');

    if (ingested.length === 0) {
      throw new Error(`No songs could be prepared. ${failures[0] ?? ''}`.trim());
    }

    update(job, { stage: 'planning', progress: INGEST_SHARE, message: 'Sequencing the set' });

    const vibe = resolveVibe(request.vibes);
    const plan = generateMixPlan({
      title: request.title,
      vibe,
      targetMinutes: request.targetMinutes,
      tracks: ingested,
    });
    plan.warnings.push(...failures);
    update(job, { plan });

    update(job, { stage: 'rendering', progress: INGEST_SHARE + 0.02, message: 'Rendering the mix' });

    const result = await renderMix({
      plan,
      mediaPaths,
      signal,
      onProgress: ({ fraction, detail }) => {
        update(job, {
          progress: INGEST_SHARE + fraction * (1 - INGEST_SHARE),
          message: detail,
        });
      },
    });

    const mix: MixRecord = {
      id: crypto.randomUUID(),
      title: plan.title,
      vibes: request.vibes,
      plan,
      file: result.file,
      durationSeconds: result.durationSeconds,
      sizeBytes: result.sizeBytes,
      createdAt: new Date().toISOString(),
      plays: 0,
    };
    addMix(mix);

    update(job, {
      stage: 'done',
      progress: 1,
      message: `Mix ready at ${result.integratedLufs} LUFS`,
      mix,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    update(job, {
      stage: 'error',
      message: job.controller.signal.aborted ? 'Cancelled' : message,
      error: job.controller.signal.aborted ? 'Cancelled' : message,
    });
  }
}

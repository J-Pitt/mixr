/**
 * Runs a complete mix job (ingest, plan, render) and reports the result.
 * Usage: npm run check:render -- "song one" "song two" "song three"
 */
import fs from 'node:fs';
import path from 'node:path';
import { getJob, startMixJob } from '../server/lib/jobs.js';
import { cleanTmp, ensureDirs, paths } from '../server/lib/paths.js';
import { formatSeconds } from '../src/lib/mixEngine.js';
import type { TrackRequest, Vibe } from '../src/types.js';

const DEFAULT_SONGS = [
  'daft punk around the world',
  'justice genesis',
  'moderat bad kingdom',
];

async function main() {
  ensureDirs();
  cleanTmp();

  const songs = process.argv.slice(2).filter(Boolean);
  const queries = songs.length > 0 ? songs : DEFAULT_SONGS;
  const vibes: Vibe[] = ['Peak Time'];

  const tracks: TrackRequest[] = queries.map((query) => ({ kind: 'query', query, provider: 'youtube' }));

  console.log(`\nrender check: ${queries.length} tracks, vibe ${vibes.join(' + ')}\n`);
  const startedAt = Date.now();

  const jobId = startMixJob({ title: 'Render Check Set', vibes, targetMinutes: 6, tracks });

  let lastMessage = '';
  for (;;) {
    const job = getJob(jobId);
    if (!job) throw new Error('job vanished');

    const line = `${Math.round(job.progress * 100)}% ${job.stage} — ${job.message}`;
    if (line !== lastMessage) {
      lastMessage = line;
      console.log(`  ${line}`);
    }

    if (job.stage === 'done' || job.stage === 'error') {
      if (job.stage === 'error') throw new Error(job.error ?? 'render failed');

      console.log('\n  track statuses:');
      for (const track of job.tracks) {
        console.log(`    [${track.status}] ${track.label}${track.detail ? ` — ${track.detail}` : ''}`);
      }

      const plan = job.plan!;
      console.log(`\n  plan: ${plan.summary}`);
      console.log(`  planned length: ${formatSeconds(plan.totalDurationSeconds)}`);
      for (const [index, track] of plan.tracks.entries()) {
        const outgoing = track.transitionOut?.lengthSeconds ?? 0;
        console.log(
          `    ${String(index + 1).padStart(2, '0')}. ${track.title.slice(0, 46).padEnd(46)} ` +
            `${String(track.bpm).padStart(5)} BPM  ${track.key.padEnd(3)}  ` +
            `window ${formatSeconds(track.startOffsetSeconds)}→${formatSeconds(track.endOffsetSeconds)}  ` +
            `gain ${(track.gainDb ?? 0).toFixed(1)}dB  xfade ${outgoing}s`,
        );
      }
      for (const warning of plan.warnings) console.log(`    warning: ${warning}`);

      const mix = job.mix!;
      const absolute = path.join(paths.renders, mix.file);
      const sizeMb = (fs.statSync(absolute).size / 1_048_576).toFixed(1);
      console.log(`\n  output: ${absolute}`);
      console.log(`  size: ${sizeMb} MB, planned ${formatSeconds(mix.durationSeconds)}`);
      console.log(`\n  took ${((Date.now() - startedAt) / 1000).toFixed(1)}s\n`);
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 400));
  }
}

void main().catch((error) => {
  console.error(`\nFAILED: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});

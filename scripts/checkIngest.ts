/**
 * Ingests one real track end to end (resolve, download, transcode, analyze) and
 * prints what was measured. Usage: npm run check:ingest -- "song name"
 */
import fs from 'node:fs';
import path from 'node:path';
import { ingestTrack } from '../server/lib/ingest.js';
import { cleanTmp, ensureDirs, paths } from '../server/lib/paths.js';

async function main() {
  ensureDirs();
  cleanTmp();

  const query = process.argv.slice(2).join(' ').trim() || 'daft punk around the world';
  console.log(`\ningest check: "${query}"\n`);

  const startedAt = Date.now();
  let lastPhase = '';

  const { track, reused, note } = await ingestTrack(
    { kind: 'query', query, provider: 'youtube' },
    {
      onProgress: (update) => {
        const percent = update.fraction === undefined ? '' : ` ${Math.round(update.fraction * 100)}%`;
        const line = `${update.phase}${percent}`;
        if (line !== lastPhase) {
          lastPhase = line;
          console.log(`  ${line}`);
        }
      },
    },
  );

  const mediaPath = path.join(paths.media, track.mediaFile);
  const sizeMb = (fs.statSync(mediaPath).size / 1_048_576).toFixed(1);
  const analysis = track.analysis;

  console.log(`\n  title        ${track.title}`);
  console.log(`  artist       ${track.artist ?? '—'}`);
  console.log(`  provider     ${track.provider}${reused ? ' (reused from library)' : ''}`);
  console.log(`  media        ${track.mediaFile} (${sizeMb} MB)`);
  console.log(`  duration     ${analysis.durationSeconds}s`);
  console.log(`  bpm          ${analysis.bpm} (confidence ${analysis.bpmConfidence})`);
  console.log(`  key          ${analysis.key} (confidence ${analysis.keyConfidence})`);
  console.log(`  loudness     ${track.loudness.integratedLufs} LUFS, true peak ${track.loudness.truePeakDb} dBFS`);
  console.log(`  intro/outro  ${analysis.introSecond}s → ${analysis.outroSecond}s`);
  console.log(`  transitions  ${analysis.transitionMoments.join(', ') || '—'}`);
  console.log(`  slices       ${analysis.slices.length}`);
  if (note) console.log(`  note         ${note}`);
  console.log(`\n  took ${((Date.now() - startedAt) / 1000).toFixed(1)}s\n`);
}

void main().catch((error) => {
  console.error(`\nFAILED: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});

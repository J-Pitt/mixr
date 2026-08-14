/**
 * End-to-end check against a already-running mixR API (packaged app or
 * standalone server): builds a mix and waits for the render to finish.
 *
 * Usage: node scripts/checkApi.mjs [port] [song...]
 */
const PORT = Number(process.argv[2] ?? 8787);
const BASE = `http://127.0.0.1:${PORT}`;

const songs = process.argv.slice(3);
const queries = songs.length > 0 ? songs : ['daft punk around the world', 'justice genesis', 'moderat bad kingdom'];

const json = async (path, init) => {
  const response = await fetch(`${BASE}${path}`, init);
  if (!response.ok) throw new Error(`${path} -> ${response.status} ${await response.text()}`);
  return response.json();
};

const tools = await json('/api/tools');
console.log(`ffmpeg: ${tools.ffmpeg.ready ? tools.ffmpeg.version.split('\n')[0] : tools.ffmpeg.error}`);
console.log(`yt-dlp: ${tools.ytdlp.ready ? tools.ytdlp.version : tools.ytdlp.error}`);

const { jobId } = await json('/api/mixes', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    title: 'Packaged Build Test',
    vibes: ['Late Night', 'House'],
    targetMinutes: 5,
    tracks: queries.map((query) => ({ kind: 'query', query, provider: 'youtube' })),
  }),
});

console.log(`\njob ${jobId}`);
const startedAt = Date.now();
let last = '';

for (;;) {
  const job = await json(`/api/mixes/${jobId}`);
  const line = `${Math.round(job.progress * 100)}% ${job.stage} — ${job.message}`;
  if (line !== last) {
    last = line;
    console.log(`  ${line}`);
  }

  if (job.stage === 'error') {
    console.error(`\nFAILED: ${job.error}`);
    process.exit(1);
  }

  if (job.stage === 'done') {
    const mix = job.mix;
    console.log('\n  requested tracks:');
    for (const track of job.tracks) {
      console.log(`    [${track.status}] ${track.label} — ${track.detail ?? ''}`);
    }
    if (mix.plan.warnings.length > 0) {
      console.log('\n  warnings:');
      for (const warning of mix.plan.warnings) console.log(`    ${warning}`);
    }

    console.log(`\n  file:     ${mix.file}`);
    console.log(`  duration: ${Math.round(mix.durationSeconds)}s`);
    console.log(`  size:     ${(mix.sizeBytes / 1_048_576).toFixed(1)} MB`);
    console.log(`  order:`);
    for (const [index, track] of mix.plan.tracks.entries()) {
      console.log(
        `    ${index + 1}. ${track.title.slice(0, 44).padEnd(44)} ${String(track.bpm).padStart(5)} BPM ${track.key.padEnd(3)} xfade ${track.transitionOut?.lengthSeconds ?? 0}s`,
      );
    }

    // Confirm the render is actually served and seekable.
    const head = await fetch(`${BASE}/renders/${encodeURIComponent(mix.file)}`, {
      headers: { Range: 'bytes=0-1023' },
    });
    console.log(`\n  stream:   HTTP ${head.status} ${head.headers.get('content-type')}`);

    const library = await json('/api/library');
    console.log(`  library:  ${library.mixes.length} mixes, ${library.tracks.length} tracks`);
    console.log(`\n  took ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
    process.exit(head.status === 206 ? 0 : 1);
  }

  await new Promise((resolve) => setTimeout(resolve, 800));
}

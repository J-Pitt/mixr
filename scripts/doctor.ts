/**
 * Toolchain diagnostic: verifies ffmpeg and yt-dlp are usable and that search
 * works, then prints where mixR keeps its data. Run with `npm run doctor`.
 */
import { ensureDirs, paths } from '../server/lib/paths.js';
import { ffmpegVersion, resolveFfmpeg } from '../server/lib/ffmpeg.js';
import { ensureYtDlp, search, ytDlpVersion } from '../server/lib/ytdlp.js';

function ok(label: string, detail: string) {
  console.log(`  ok    ${label.padEnd(12)} ${detail}`);
}

function fail(label: string, detail: string) {
  console.log(`  FAIL  ${label.padEnd(12)} ${detail}`);
}

async function main() {
  console.log('\nmixR doctor\n');
  ensureDirs();
  ok('data dir', paths.data);

  let failures = 0;

  try {
    const binary = await resolveFfmpeg();
    ok('ffmpeg', `${await ffmpegVersion()}  [${binary}]`);
  } catch (error) {
    failures += 1;
    fail('ffmpeg', error instanceof Error ? error.message : String(error));
  }

  try {
    let lastLogged = -1;
    const invocation = await ensureYtDlp((fraction) => {
      const percent = Math.floor(fraction * 100);
      if (percent >= lastLogged + 20) {
        lastLogged = percent;
        console.log(`        downloading yt-dlp… ${percent}%`);
      }
    });
    ok('yt-dlp', `${await ytDlpVersion()}  [${invocation.label}]`);
  } catch (error) {
    failures += 1;
    fail('yt-dlp', error instanceof Error ? error.message : String(error));
  }

  if (failures === 0) {
    for (const provider of ['youtube', 'soundcloud'] as const) {
      try {
        const results = await search('daft punk around the world', provider, 3);
        if (results.length === 0) throw new Error('no results');
        const top = results[0];
        ok(provider, `${results.length} results, top: "${top.title}" (${top.durationSeconds ?? '?'}s)`);
      } catch (error) {
        failures += 1;
        fail(provider, error instanceof Error ? error.message : String(error));
      }
    }
  }

  console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();

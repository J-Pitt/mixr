/** Prints raw search results. Usage: npm run check:search -- "song name" */
import { ensureDirs } from '../server/lib/paths.js';
import { search } from '../server/lib/ytdlp.js';

async function main() {
  ensureDirs();
  const query = process.argv.slice(2).join(' ').trim() || 'daft punk around the world';

  for (const provider of ['youtube', 'soundcloud'] as const) {
    console.log(`\n${provider}: "${query}"`);
    try {
      const results = await search(query, provider, 5);
      for (const result of results) {
        const duration = result.durationSeconds ? `${Math.round(result.durationSeconds)}s` : '?';
        console.log(`  ${duration.padStart(6)}  ${result.webpageUrl}`);
        console.log(`          ${result.title}${result.artist ? ` — ${result.artist}` : ''}`);
      }
    } catch (error) {
      console.log(`  FAILED: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  console.log('');
}

void main();

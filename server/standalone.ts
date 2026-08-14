/**
 * Runs the API on its own, for browser-only development (`npm run dev:web`).
 * Inside the desktop app, Electron starts the same server in-process instead.
 */
import { startServer } from './index.js';

const port = Number(process.env.MIXR_PORT ?? 8787);

const started = await startServer(port);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void started.close().then(() => process.exit(0));
  });
}

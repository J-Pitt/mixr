/**
 * Runs the API (and the built UI, when dist/ exists) without Electron.
 * `npm run web` is the production website; `npm run dev:web` is Vite + this
 * process. The desktop app starts the same server in-process instead.
 */
import { startServer } from './index.js';

// Website mode listens on every interface so a Share-by-email link works on the LAN.
if (!process.env.MIXR_HOST) process.env.MIXR_HOST = '0.0.0.0';

const port = Number(process.env.MIXR_PORT ?? 8787);

const started = await startServer(port);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void started.close().then(() => process.exit(0));
  });
}

import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express, { type Response } from 'express';
import type { ToolStatus, TrackRequest, Vibe } from '../src/types.js';
import { allVibes } from '../src/lib/mixEngine.js';
import { ffmpegVersion } from './lib/ffmpeg.js';
import { ingestTrack, isHttpUrl, loadPlaylist, searchTracks } from './lib/ingest.js';
import { cancelJob, getJob, startMixJob, subscribe } from './lib/jobs.js';
import { cleanTmp, ensureDirs, paths } from './lib/paths.js';
import * as store from './lib/store.js';
import { shareUrls } from './lib/share.js';
import { saveUpload } from './lib/uploads.js';
import { ensureYtDlp, findPython, findYtDlp, ytDlpVersion } from './lib/ytdlp.js';

const DEFAULT_PORT = 8787;
const DEFAULT_HOST = '127.0.0.1';

function canBind(port: number, bindHost: string): Promise<boolean> {
  return new Promise((resolve) => {
    const tester = net.createServer();
    tester.once('error', () => resolve(false));
    tester.once('listening', () => {
      tester.close(() => resolve(true));
    });
    tester.listen(port, bindHost);
  });
}

/** Built Vite output, when this process is also the website. */
function resolveClientDir(): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [path.join(process.cwd(), 'dist'), path.join(here, '..', '..', 'dist'), path.join(here, '..', 'dist')];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'index.html'))) return dir;
  }
  return null;
}

function fail(response: Response, status: number, message: string): void {
  response.status(status).json({ error: message });
}

/** Streams a file with range support so <audio> can seek. */
function sendAudio(directory: string, response: Response, filename: string): void {
  // Reject anything that tries to escape the directory.
  const safe = path.basename(filename);
  const absolute = path.join(directory, safe);
  if (!absolute.startsWith(path.resolve(directory) + path.sep) || !fs.existsSync(absolute)) {
    fail(response, 404, 'Not found');
    return;
  }

  response.sendFile(absolute, {
    headers: { 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' },
  });
}

function asVibes(value: unknown): Vibe[] {
  if (!Array.isArray(value)) return [];
  const valid = new Set<string>(allVibes);
  return value.filter((entry): entry is Vibe => typeof entry === 'string' && valid.has(entry));
}

/** Normalizes a free-text row from the UI into a concrete ingest request. */
export function parseTrackRequest(raw: unknown): TrackRequest | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;

  if (value.kind === 'local' && typeof value.path === 'string' && value.path.trim()) {
    return { kind: 'local', path: value.path.trim() };
  }
  if (value.kind === 'link' && typeof value.url === 'string' && isHttpUrl(value.url.trim())) {
    return { kind: 'link', url: value.url.trim() };
  }
  if (value.kind === 'query' && typeof value.query === 'string' && value.query.trim()) {
    const provider = value.provider === 'soundcloud' ? 'soundcloud' : 'youtube';
    return { kind: 'query', query: value.query.trim(), provider };
  }

  // Tolerate a bare string: decide between a link and a search by inspecting it.
  if (typeof value.value === 'string' && value.value.trim()) {
    const text = value.value.trim();
    if (isHttpUrl(text)) return { kind: 'link', url: text };
    const provider = value.provider === 'soundcloud' ? 'soundcloud' : 'youtube';
    return { kind: 'query', query: text, provider };
  }

  return null;
}

export function createApp() {
  const app = express();

  app.use(cors({ origin: true }));
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_request, response) => {
    response.json({ ok: true, dataDir: paths.data });
  });

  app.get('/api/share', (request, response) => {
    const port = request.socket.localPort || Number(process.env.MIXR_PORT ?? DEFAULT_PORT);
    const host = process.env.MIXR_HOST?.trim() || DEFAULT_HOST;
    response.json(shareUrls(port, host !== '127.0.0.1' && host !== 'localhost'));
  });

  app.get('/api/tools', async (_request, response) => {
    const status: ToolStatus = { ffmpeg: { ready: false }, ytdlp: { ready: false } };

    try {
      status.ffmpeg = { ready: true, version: await ffmpegVersion() };
    } catch (error) {
      status.ffmpeg = { ready: false, error: error instanceof Error ? error.message : String(error) };
    }

    try {
      const existing = await findYtDlp();
      if (existing) {
        status.ytdlp = { ready: true, version: (await ytDlpVersion()) ?? undefined };
      } else {
        status.ytdlp = { ready: false, error: 'not installed' };
      }
    } catch (error) {
      status.ytdlp = { ready: false, error: error instanceof Error ? error.message : String(error) };
    }

    response.json(status);
  });

  /** First-run setup: fetch yt-dlp, reporting progress as it downloads. */
  app.post('/api/tools/install', async (_request, response) => {
    response.setHeader('Content-Type', 'text/event-stream');
    response.setHeader('Cache-Control', 'no-cache');
    response.setHeader('Connection', 'keep-alive');
    response.flushHeaders();

    const send = (payload: unknown) => response.write(`data: ${JSON.stringify(payload)}\n\n`);

    try {
      const python = await findPython();
      send({ stage: 'starting', detail: python ? 'Downloading yt-dlp' : 'Downloading yt-dlp (standalone build)' });

      let lastReported = -1;
      const invocation = await ensureYtDlp((fraction) => {
        const percent = Math.floor(fraction * 100);
        if (percent > lastReported) {
          lastReported = percent;
          send({ stage: 'downloading', progress: fraction });
        }
      });

      send({ stage: 'done', detail: invocation.label, version: await ytDlpVersion() });
    } catch (error) {
      send({ stage: 'error', error: error instanceof Error ? error.message : String(error) });
    } finally {
      response.end();
    }
  });

  app.get('/api/search', async (request, response) => {
    const query = String(request.query.q ?? '').trim();
    if (!query) {
      fail(response, 400, 'Provide a search query.');
      return;
    }

    const provider = request.query.provider === 'soundcloud' ? 'soundcloud' : 'youtube';
    const limit = Math.min(10, Math.max(1, Number(request.query.limit ?? 6) || 6));

    try {
      // If the user pasted a link, searching for it is pointless.
      if (isHttpUrl(query)) {
        fail(response, 400, 'That is a link, not a search. Add it directly.');
        return;
      }
      response.json({ results: await searchTracks(query, provider, limit) });
    } catch (error) {
      fail(response, 502, error instanceof Error ? error.message : 'Search failed.');
    }
  });

  /** Expands a YouTube playlist or SoundCloud set into individual tracks. */
  app.get('/api/playlist', async (request, response) => {
    const url = String(request.query.url ?? '').trim();
    if (!url) {
      fail(response, 400, 'Provide a playlist link.');
      return;
    }

    try {
      response.json(await loadPlaylist(url));
    } catch (error) {
      fail(response, 502, error instanceof Error ? error.message : 'Could not read that playlist.');
    }
  });

  /** Browser file picker / drop: store the bytes, then ingest as a local path. */
  app.post(
    '/api/uploads',
    express.raw({ type: () => true, limit: '80mb' }),
    (request, response) => {
      try {
        const filename = String(request.headers['x-filename'] ?? 'upload');
        const body = Buffer.isBuffer(request.body) ? request.body : Buffer.from(request.body ?? []);
        response.status(201).json(saveUpload(filename, body));
      } catch (error) {
        fail(response, 400, error instanceof Error ? error.message : 'Could not store that file.');
      }
    },
  );

  /** Ingests one track immediately, used when adding to the library outside a mix. */
  app.post('/api/tracks', async (request, response) => {
    const parsed = parseTrackRequest(request.body);
    if (!parsed) {
      fail(response, 400, 'Provide a song name, a link, or a file path.');
      return;
    }

    try {
      const { track, reused, note } = await ingestTrack(parsed);
      response.json({ track, reused, note });
    } catch (error) {
      fail(response, 502, error instanceof Error ? error.message : 'Could not add that track.');
    }
  });

  app.get('/api/library', (_request, response) => {
    response.json(store.snapshot());
  });

  app.post('/api/library/plays', (request, response) => {
    const { kind, id } = request.body ?? {};
    if ((kind !== 'mix' && kind !== 'track') || typeof id !== 'string') {
      fail(response, 400, 'Provide kind and id.');
      return;
    }
    store.recordPlay(kind, id);
    response.json({ ok: true });
  });

  app.delete('/api/library/mixes/:id', (request, response) => {
    response.json({ ok: store.deleteMix(request.params.id) });
  });

  app.delete('/api/library/tracks/:id', (request, response) => {
    response.json({ ok: store.deleteTrack(request.params.id) });
  });

  app.post('/api/mixes', (request, response) => {
    const body = request.body ?? {};
    const requests = Array.isArray(body.tracks)
      ? body.tracks.map(parseTrackRequest).filter((entry: TrackRequest | null): entry is TrackRequest => entry !== null)
      : [];

    if (requests.length === 0) {
      fail(response, 400, 'Add at least one song.');
      return;
    }

    const vibes = asVibes(body.vibes);
    if (vibes.length === 0) {
      fail(response, 400, 'Choose at least one vibe.');
      return;
    }

    const targetRaw = Number(body.targetMinutes);
    const targetMinutes = Number.isFinite(targetRaw) && targetRaw > 0 ? targetRaw : undefined;
    const bpmRaw = Number(body.targetBpm);
    const targetBpm = Number.isFinite(bpmRaw) && bpmRaw >= 50 && bpmRaw <= 220 ? bpmRaw : undefined;

    try {
      const jobId = startMixJob({
        title: typeof body.title === 'string' ? body.title : 'Untitled mix',
        vibes,
        targetMinutes,
        targetBpm,
        tracks: requests,
      });
      response.status(202).json({ jobId });
    } catch (error) {
      fail(response, 400, error instanceof Error ? error.message : 'Could not start that mix.');
    }
  });

  app.get('/api/mixes/:jobId', (request, response) => {
    const job = getJob(request.params.jobId);
    if (!job) {
      fail(response, 404, 'That job is no longer available.');
      return;
    }
    response.json(job);
  });

  app.post('/api/mixes/:jobId/cancel', (request, response) => {
    response.json({ ok: cancelJob(request.params.jobId) });
  });

  /** Live progress for a running mix. */
  app.get('/api/mixes/:jobId/events', (request, response) => {
    const initial = getJob(request.params.jobId);
    if (!initial) {
      fail(response, 404, 'That job is no longer available.');
      return;
    }

    response.setHeader('Content-Type', 'text/event-stream');
    response.setHeader('Cache-Control', 'no-cache');
    response.setHeader('Connection', 'keep-alive');
    response.flushHeaders();

    const send = (state: unknown) => response.write(`data: ${JSON.stringify(state)}\n\n`);
    send(initial);

    const unsubscribe = subscribe(request.params.jobId, (state) => {
      send(state);
      if (state.stage === 'done' || state.stage === 'error') {
        unsubscribe();
        response.end();
      }
    });

    // Terminal states can arrive before the subscription is set up.
    if (initial.stage === 'done' || initial.stage === 'error') {
      unsubscribe();
      response.end();
      return;
    }

    // Keep intermediaries from closing an idle connection.
    const keepAlive = setInterval(() => response.write(': ping\n\n'), 15_000);
    request.on('close', () => {
      clearInterval(keepAlive);
      unsubscribe();
    });
    response.on('close', () => clearInterval(keepAlive));
  });

  app.get('/media/:filename', (request, response) => {
    sendAudio(paths.media, response, request.params.filename);
  });

  app.get('/renders/:filename', (request, response) => {
    sendAudio(paths.renders, response, request.params.filename);
  });

  const clientDir = resolveClientDir();
  if (clientDir) {
    app.use(express.static(clientDir));
    app.use((request, response, next) => {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        next();
        return;
      }
      if (request.path.startsWith('/api') || request.path.startsWith('/media') || request.path.startsWith('/renders')) {
        next();
        return;
      }
      response.sendFile(path.join(clientDir, 'index.html'));
    });
  }

  app.use((request, response) => {
    if (request.path.startsWith('/api') || request.path.startsWith('/media') || request.path.startsWith('/renders')) {
      fail(response, 404, `No route for ${request.method} ${request.path}`);
      return;
    }
    fail(response, 404, clientDir ? 'Not found' : 'UI is not built. Run npm run build:client, or use npm run dev:web.');
  });

  return app;
}

export interface StartedServer {
  port: number;
  close: () => Promise<void>;
}

/**
 * Binds to loopback by default. MIXR_HOST can open it on the LAN for the
 * website. Tries the port the Vite proxy expects, then falls back to a free
 * port so a stale process cannot stop the app from launching.
 */
export async function startServer(preferredPort = DEFAULT_PORT): Promise<StartedServer> {
  ensureDirs();
  cleanTmp();

  const app = createApp();
  const host = process.env.MIXR_HOST?.trim() || DEFAULT_HOST;

  const listen = (port: number) =>
    new Promise<import('node:http').Server>((resolve, reject) => {
      const server = app.listen(port, host);
      server.once('listening', () => resolve(server));
      server.once('error', reject);
    });

  // Binding 0.0.0.0 can succeed even when 127.0.0.1:port is already taken by
  // the desktop app. Browsers then hit the old API and see {"error":"Not found"}.
  if (host === '0.0.0.0' && !(await canBind(preferredPort, '127.0.0.1'))) {
    console.warn(
      `[mixr] 127.0.0.1:${preferredPort} is already taken (quit the mixR desktop app). Using another port.`,
    );
  }

  let server: import('node:http').Server;
  try {
    if (host === '0.0.0.0' && !(await canBind(preferredPort, '127.0.0.1'))) {
      server = await listen(0);
    } else {
      server = await listen(preferredPort);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error;
    console.warn(`[mixr] port ${preferredPort} is busy, falling back to a free port`);
    server = await listen(0);
  }

  const { port } = server.address() as AddressInfo;
  const origin = `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}`;
  console.log(`[mixr] api listening on ${origin}`);
  if (resolveClientDir()) console.log(`[mixr] website ${origin}`);
  else console.log('[mixr] API only — run npm run build:client to serve the website from this port');

  return {
    port,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

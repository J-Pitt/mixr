import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform } from 'node:stream';
import { paths } from './paths.js';
import { ProcessError, run } from './proc.js';

export { isPlaylistUrl } from '../../src/lib/playlistUrl.js';

const ZIPAPP_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp';
const MACOS_BINARY_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos';

/** yt-dlp dropped Python 3.9 support, so anything older cannot run the zipapp. */
const MIN_PYTHON = { major: 3, minor: 10 };

/**
 * How to invoke yt-dlp. The zipapp needs a Python interpreter in front of it,
 * so callers cannot assume a bare executable.
 */
export interface YtDlpInvocation {
  command: string;
  prefixArgs: string[];
  label: string;
}

let cached: YtDlpInvocation | null = null;

export type SearchProvider = 'youtube' | 'soundcloud';

export interface ResolvedTrackInfo {
  sourceId: string;
  title: string;
  artist?: string;
  durationSeconds?: number;
  thumbnail?: string;
  webpageUrl: string;
  provider: 'youtube' | 'soundcloud' | 'unknown';
}

const zipappPath = () => path.join(paths.bin, 'yt-dlp.pyz');
const nativePath = () => path.join(paths.bin, 'yt-dlp');

async function probe(invocation: YtDlpInvocation): Promise<boolean> {
  try {
    // The standalone build unpacks itself on every run and can be very slow on
    // older hardware, so this timeout is deliberately generous.
    const { stdout } = await run(invocation.command, [...invocation.prefixArgs, '--version'], { timeoutMs: 120_000 });
    return /^\d{4}\.\d{2}\.\d{2}/.test(stdout.trim());
  } catch {
    return false;
  }
}

/** Finds a Python new enough to run the zipapp. */
export async function findPython(): Promise<string | null> {
  const candidates = [
    process.env.MIXR_PYTHON_PATH?.trim(),
    'python3.14',
    'python3.13',
    'python3.12',
    'python3.11',
    'python3.10',
    '/usr/local/bin/python3.13',
    '/opt/homebrew/bin/python3',
    'python3',
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    if (candidate.includes(path.sep) && !fs.existsSync(candidate)) continue;
    try {
      const { stdout, stderr } = await run(candidate, ['--version'], { timeoutMs: 15_000 });
      const match = `${stdout} ${stderr}`.match(/Python (\d+)\.(\d+)/);
      if (!match) continue;
      const major = Number(match[1]);
      const minor = Number(match[2]);
      if (major > MIN_PYTHON.major || (major === MIN_PYTHON.major && minor >= MIN_PYTHON.minor)) {
        return candidate;
      }
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

/** Returns a usable yt-dlp invocation if one already exists, without downloading. */
export async function findYtDlp(): Promise<YtDlpInvocation | null> {
  if (cached) return cached;

  const override = process.env.MIXR_YTDLP_PATH?.trim();
  if (override) {
    const invocation: YtDlpInvocation = { command: override, prefixArgs: [], label: override };
    if (await probe(invocation)) {
      cached = invocation;
      return invocation;
    }
  }

  // A native yt-dlp on PATH (usually Homebrew) is the fastest option.
  for (const candidate of ['yt-dlp', '/opt/homebrew/bin/yt-dlp', '/usr/local/bin/yt-dlp']) {
    if (candidate.includes(path.sep) && !fs.existsSync(candidate)) continue;
    const invocation: YtDlpInvocation = { command: candidate, prefixArgs: [], label: candidate };
    if (await probe(invocation)) {
      cached = invocation;
      return invocation;
    }
  }

  // Our own zipapp: 3 MB and starts in about a second.
  if (fs.existsSync(zipappPath())) {
    const python = await findPython();
    if (python) {
      const invocation: YtDlpInvocation = {
        command: python,
        prefixArgs: [zipappPath()],
        label: `${python} ${zipappPath()}`,
      };
      if (await probe(invocation)) {
        cached = invocation;
        return invocation;
      }
    }
  }

  // Previously downloaded standalone build.
  if (fs.existsSync(nativePath())) {
    const invocation: YtDlpInvocation = { command: nativePath(), prefixArgs: [], label: nativePath() };
    if (await probe(invocation)) {
      cached = invocation;
      return invocation;
    }
  }

  return null;
}

async function downloadTo(url: string, target: string, onProgress?: (fraction: number) => void): Promise<void> {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const partial = `${target}.partial`;

  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok || !response.body) {
    throw new Error(`Download failed with HTTP ${response.status} for ${url}`);
  }

  const totalBytes = Number(response.headers.get('content-length') ?? 0);
  let received = 0;

  // Counting must happen inside the pipeline. A bare 'data' listener would put
  // the stream into flowing mode and drop chunks before the file is attached.
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      received += chunk.length;
      if (totalBytes > 0) onProgress?.(Math.min(1, received / totalBytes));
      callback(null, chunk);
    },
  });

  fs.rmSync(partial, { force: true });
  try {
    await pipeline(Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]), counter, fs.createWriteStream(partial));

    const written = fs.statSync(partial).size;
    if (totalBytes > 0 && written !== totalBytes) {
      throw new Error(`Download was truncated (${written} of ${totalBytes} bytes).`);
    }

    fs.chmodSync(partial, 0o755);
    fs.renameSync(partial, target);
  } catch (error) {
    fs.rmSync(partial, { force: true });
    throw error;
  }

  // Downloads made outside a browser are not quarantined, but strip the
  // attribute defensively so Gatekeeper never blocks the first run.
  await run('xattr', ['-d', 'com.apple.quarantine', target], { timeoutMs: 10_000 }).catch(() => undefined);
}

/**
 * Installs yt-dlp into the app's data directory. Prefers the 3 MB zipapp, which
 * starts roughly 25x faster than the self-contained binary; falls back to the
 * binary only when no suitable Python exists.
 */
export async function installYtDlp(onProgress?: (fraction: number) => void): Promise<YtDlpInvocation> {
  fs.mkdirSync(paths.bin, { recursive: true });

  const python = await findPython();
  if (python) {
    await downloadTo(ZIPAPP_URL, zipappPath(), onProgress);
    const invocation: YtDlpInvocation = {
      command: python,
      prefixArgs: [zipappPath()],
      label: `${python} ${zipappPath()}`,
    };
    if (await probe(invocation)) {
      cached = invocation;
      return invocation;
    }
    fs.rmSync(zipappPath(), { force: true });
  }

  await downloadTo(MACOS_BINARY_URL, nativePath(), onProgress);
  const invocation: YtDlpInvocation = { command: nativePath(), prefixArgs: [], label: nativePath() };
  if (await probe(invocation)) {
    cached = invocation;
    return invocation;
  }

  fs.rmSync(nativePath(), { force: true });
  throw new Error('Could not get yt-dlp working. Install it manually with "brew install yt-dlp".');
}

export async function ensureYtDlp(onProgress?: (fraction: number) => void): Promise<YtDlpInvocation> {
  return (await findYtDlp()) ?? installYtDlp(onProgress);
}

export async function ytDlpVersion(): Promise<string | null> {
  const invocation = await findYtDlp();
  if (!invocation) return null;
  const { stdout } = await run(invocation.command, [...invocation.prefixArgs, '--version'], { timeoutMs: 120_000 });
  return stdout.trim();
}

const SHARED_ARGS = [
  '--no-warnings',
  '--no-color',
  '--retries', '3',
  '--socket-timeout', '20',
  '--ignore-config',
];

/** Mix jobs and the UI stay usable; a 200-track set would take hours to ingest. */
export const MAX_PLAYLIST_TRACKS = 50;

/**
 * yt-dlp reports the useful part of a failure on an "ERROR:" line. Without
 * lifting it out, callers only ever see "exited with code 1".
 */
function explain(error: unknown): Error {
  if (!(error instanceof ProcessError)) {
    return error instanceof Error ? error : new Error(String(error));
  }

  const lines = error.stderr
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('ERROR:'));

  if (lines.length === 0) return new Error(error.message);

  const detail = lines[lines.length - 1]
    .replace(/^ERROR:\s*/, '')
    .replace(/^\[[^\]]+\]\s*/, '')
    .replace(/^[\w-]+:\s*/, '');

  return new Error(detail || error.message);
}

async function ytDlp(
  args: string[],
  options: Parameters<typeof run>[2] & { playlist?: boolean } = {},
) {
  const { playlist = false, ...runOptions } = options;
  const invocation = await ensureYtDlp();
  const playlistArg = playlist ? '--yes-playlist' : '--no-playlist';
  try {
    return await run(
      invocation.command,
      [...invocation.prefixArgs, ...SHARED_ARGS, playlistArg, ...args],
      runOptions,
    );
  } catch (error) {
    throw explain(error);
  }
}

interface RawEntry {
  id?: string;
  title?: string;
  track?: string;
  artist?: string;
  uploader?: string;
  channel?: string;
  duration?: number;
  thumbnail?: string;
  thumbnails?: { url?: string; preference?: number; width?: number }[];
  webpage_url?: string;
  url?: string;
  extractor_key?: string;
  ie_key?: string;
  _type?: string;
  playlist_count?: number;
  entries?: Array<RawEntry | null>;
}

function pickThumbnail(entry: RawEntry): string | undefined {
  if (entry.thumbnail) return entry.thumbnail;
  const options = entry.thumbnails?.filter((candidate) => Boolean(candidate.url)) ?? [];
  if (options.length === 0) return undefined;
  // Prefer a mid-size image: big enough to look good, small enough to load fast.
  const sorted = [...options].sort((a, b) => (a.width ?? 0) - (b.width ?? 0));
  return (sorted.find((candidate) => (candidate.width ?? 0) >= 300) ?? sorted[sorted.length - 1]).url;
}

function detectProviderFromEntry(entry: RawEntry, fallbackUrl: string): 'youtube' | 'soundcloud' | 'unknown' {
  const key = (entry.extractor_key ?? entry.ie_key ?? '').toLowerCase();
  if (key.includes('youtube')) return 'youtube';
  if (key.includes('soundcloud')) return 'soundcloud';

  const url = entry.webpage_url ?? entry.url ?? fallbackUrl;
  if (/youtube\.com|youtu\.be/i.test(url)) return 'youtube';
  if (/soundcloud\.com/i.test(url)) return 'soundcloud';
  return 'unknown';
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function resolveWebpageUrl(entry: RawEntry, fallbackUrl: string): string | undefined {
  const direct = entry.webpage_url ?? entry.url;
  if (direct && isHttpUrl(direct)) return direct;

  const provider = detectProviderFromEntry(entry, fallbackUrl);
  if (entry.id && provider === 'youtube') return `https://www.youtube.com/watch?v=${entry.id}`;
  if (direct) return direct;
  return undefined;
}

/** SoundCloud --flat-playlist entries often have a URL and no title. */
function titleFromUrl(url: string): string | undefined {
  try {
    const slug = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).at(-1) ?? '');
    if (!slug) return undefined;
    return slug.replace(/[-_+]+/g, ' ').replace(/\s+/g, ' ').trim();
  } catch {
    return undefined;
  }
}

function resolveTitle(entry: RawEntry, webpageUrl: string): string | undefined {
  const titled = (entry.track ?? entry.title)?.trim();
  if (titled && titled !== 'NA' && !/^\[(deleted|private|unavailable)/i.test(titled)) return titled;
  return titleFromUrl(webpageUrl) ?? (entry.id ? `Track ${entry.id}` : undefined);
}

function normalizeEntry(entry: RawEntry, fallbackUrl = ''): ResolvedTrackInfo | null {
  const webpageUrl = resolveWebpageUrl(entry, fallbackUrl);
  if (!webpageUrl) return null;
  const title = resolveTitle(entry, webpageUrl);
  if (!title) return null;
  if (/^\[(deleted|private|unavailable)/i.test(title)) return null;

  return {
    sourceId: entry.id ?? webpageUrl,
    title,
    artist: entry.artist ?? entry.uploader ?? entry.channel,
    durationSeconds: typeof entry.duration === 'number' && entry.duration > 0 ? entry.duration : undefined,
    thumbnail: pickThumbnail(entry),
    webpageUrl,
    provider: detectProviderFromEntry(entry, fallbackUrl),
  };
}

function parseJsonOutput(stdout: string): unknown {
  const trimmed = stdout.trim();
  if (!trimmed || trimmed === 'null') return null;
  const objectStart = trimmed.indexOf('{');
  const arrayStart = trimmed.indexOf('[');
  const start =
    objectStart === -1 ? arrayStart : arrayStart === -1 ? objectStart : Math.min(objectStart, arrayStart);
  if (start === -1) throw new Error('Could not read that playlist.');
  return JSON.parse(trimmed.slice(start));
}

/** Turns a yt-dlp playlist dump into tracks. Exported so tests can cover SoundCloud's title-less entries. */
export function listingFromDump(raw: unknown, sourceUrl: string, limit = MAX_PLAYLIST_TRACKS): PlaylistListing {
  if (!raw || typeof raw !== 'object') {
    throw new Error('That playlist did not contain any playable tracks.');
  }

  const parsed = raw as RawEntry;
  const rawEntries = (parsed.entries ?? (parsed._type === 'playlist' ? [] : [parsed])).filter(
    (entry): entry is RawEntry => entry !== null,
  );
  const tracks = rawEntries
    .map((entry) => normalizeEntry(entry, sourceUrl))
    .filter((entry): entry is ResolvedTrackInfo => entry !== null)
    .filter((entry) => entry.webpageUrl !== sourceUrl)
    .slice(0, limit);

  if (tracks.length === 0) {
    throw new Error('That playlist did not contain any playable tracks.');
  }

  const reportedCount = typeof parsed.playlist_count === 'number' ? parsed.playlist_count : undefined;

  return {
    title: parsed.title?.trim() || 'Playlist',
    url: sourceUrl,
    truncated: reportedCount !== undefined ? reportedCount > tracks.length : rawEntries.length > tracks.length,
    tracks,
  };
}

export interface PlaylistListing {
  title: string;
  url: string;
  truncated: boolean;
  tracks: ResolvedTrackInfo[];
}

/** Enumerates tracks in a YouTube playlist or SoundCloud set, without downloading. */
export async function listPlaylist(
  url: string,
  options: { limit?: number; signal?: AbortSignal } = {},
): Promise<PlaylistListing> {
  const limit = Math.min(MAX_PLAYLIST_TRACKS, Math.max(1, options.limit ?? MAX_PLAYLIST_TRACKS));
  const { stdout } = await ytDlp(
    [
      '--dump-single-json',
      '--flat-playlist',
      '--skip-download',
      '--playlist-end',
      String(limit),
      url,
    ],
    { timeoutMs: 180_000, signal: options.signal, playlist: true },
  );

  return listingFromDump(parseJsonOutput(stdout), url, limit);
}

/** Text search against YouTube or SoundCloud. */
export async function search(
  query: string,
  provider: SearchProvider,
  limit = 6,
  signal?: AbortSignal,
): Promise<ResolvedTrackInfo[]> {
  const prefix = provider === 'soundcloud' ? 'scsearch' : 'ytsearch';
  const { stdout } = await ytDlp(['--dump-single-json', '--flat-playlist', `${prefix}${limit}:${query}`], {
    timeoutMs: 90_000,
    signal,
  });

  const parsed = JSON.parse(stdout) as RawEntry;
  return (parsed.entries ?? [])
    .filter((entry): entry is RawEntry => entry !== null)
    .map((entry) => normalizeEntry(entry))
    .filter((entry): entry is ResolvedTrackInfo => entry !== null);
}

/** Full metadata for one URL, without downloading. */
export async function inspect(url: string, signal?: AbortSignal): Promise<ResolvedTrackInfo> {
  const { stdout } = await ytDlp(['--dump-single-json', '--skip-download', url], {
    timeoutMs: 120_000,
    signal,
  });

  const parsed = JSON.parse(stdout) as RawEntry;
  // Some extractors return a playlist even with --no-playlist; take the first item.
  const first = parsed.entries?.find((item): item is RawEntry => item !== null);
  const entry = parsed._type === 'playlist' ? first ?? parsed : parsed;
  const normalized = normalizeEntry(entry, url);
  if (!normalized) throw new Error('That link did not resolve to a playable track.');
  return normalized;
}

/**
 * YouTube serves some formats only to clients that can present a token its
 * default web player cannot produce, which shows up as a 403 partway through the
 * transfer rather than as a missing format. Asking a different player client
 * picks a stream that is actually servable, so each attempt is tried in turn.
 */
const DOWNLOAD_STRATEGIES: string[][] = [
  [],
  ['--extractor-args', 'youtube:player_client=android,web_safari'],
  ['--extractor-args', 'youtube:player_client=tv,ios'],
];

function isFormatFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /403|forbidden|requested format|unable to download video data|fragment/i.test(message);
}

/** The file yt-dlp actually produced, whichever way it reported it. */
function locateDownload(jobDir: string, pathFile: string): string | null {
  const recorded = fs.existsSync(pathFile) ? fs.readFileSync(pathFile, 'utf8').trim().split('\n')[0] : '';
  if (recorded && fs.existsSync(recorded)) return recorded;

  // Fallback for extractors that skip the after_move hook.
  const found = fs
    .readdirSync(jobDir)
    .filter((entry) => entry.startsWith('audio.'))
    .map((entry) => path.join(jobDir, entry));
  return found[0] ?? null;
}

/**
 * Downloads the best audio-only stream to the scratch directory and returns the
 * resulting file path.
 */
export async function download(
  url: string,
  options: { onProgress?: (fraction: number) => void; signal?: AbortSignal } = {},
): Promise<string> {
  const jobDir = fs.mkdtempSync(path.join(paths.tmp, 'dl-'));
  const pathFile = path.join(jobDir, 'result.txt');

  try {
    let lastError: unknown = new Error('The download produced no audio file.');

    for (const strategy of DOWNLOAD_STRATEGIES) {
      try {
        await ytDlp(
          [
            ...strategy,
            '--newline',
            '--no-part',
            '--concurrent-fragments', '4',
            '-f', 'bestaudio/best',
            '--print-to-file', 'after_move:filepath', pathFile,
            '-o', path.join(jobDir, 'audio.%(ext)s'),
            url,
          ],
          {
            timeoutMs: 20 * 60_000,
            signal: options.signal,
            onStdout: (chunk) => {
              for (const match of chunk.matchAll(/\[download\]\s+([\d.]+)%/g)) {
                const percent = Number.parseFloat(match[1]);
                if (Number.isFinite(percent)) options.onProgress?.(percent / 100);
              }
            },
          },
        );

        const file = locateDownload(jobDir, pathFile);
        if (file) return file;
      } catch (error) {
        lastError = error;
        // A private, removed, or region-locked video will fail the same way on
        // every client, so only format-level failures are worth another attempt.
        if (!isFormatFailure(error) || options.signal?.aborted) throw error;
      }

      // Clear partial output so the next attempt cannot pick it up.
      for (const entry of fs.readdirSync(jobDir)) {
        fs.rmSync(path.join(jobDir, entry), { recursive: true, force: true });
      }
    }

    throw lastError;
  } catch (error) {
    fs.rmSync(jobDir, { recursive: true, force: true });
    throw error;
  }
}

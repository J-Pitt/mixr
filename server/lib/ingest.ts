import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { IngestedTrack, Provider, SearchResult, TrackRequest } from '../../src/types.js';
import { analyzeAudioFile, isAnalysisCurrent } from './analyze.js';
import { measureLoudness, transcodeToFlac } from './ffmpeg.js';
import { paths } from './paths.js';
import { findTrack, upsertTrack } from './store.js';
import {
  download,
  inspect,
  isPlaylistUrl,
  listPlaylist,
  MAX_PLAYLIST_TRACKS,
  search,
  type ResolvedTrackInfo,
} from './ytdlp.js';

export interface IngestProgress {
  (update: { phase: 'resolving' | 'downloading' | 'transcoding' | 'analyzing'; fraction?: number; detail?: string }): void;
}

const AUDIO_EXTENSIONS = new Set([
  '.mp3', '.m4a', '.aac', '.wav', '.aiff', '.aif', '.flac', '.ogg', '.oga', '.opus', '.wma', '.alac', '.webm', '.mp4',
]);

export function detectProvider(value: string): Provider {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    if (hostname.includes('youtube.com') || hostname.includes('youtu.be')) return 'youtube';
    if (hostname.includes('spotify.com')) return 'spotify';
    if (hostname.includes('soundcloud.com')) return 'soundcloud';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

export function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function hash(value: string): string {
  return crypto.createHash('sha1').update(value).digest('hex').slice(0, 16);
}

/**
 * Spotify serves no audio through any public API, so a Spotify link is only
 * useful as metadata. We read the artist and title, then find the actual audio
 * on YouTube.
 */
async function resolveSpotifyMetadata(url: string): Promise<{ title: string; artist?: string }> {
  try {
    const module = await import('spotify-url-info');
    const factory = (module.default ?? module) as (fetcher: typeof fetch) => {
      getPreview: (url: string) => Promise<{ title?: string; artist?: string }>;
    };
    const preview = await factory(fetch).getPreview(url);
    if (preview?.title) return { title: preview.title, artist: preview.artist };
  } catch {
    // Fall through to the oEmbed endpoint, which needs no library.
  }

  const response = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`);
  if (response.ok) {
    const data = (await response.json()) as { title?: string };
    if (data.title) return { title: data.title };
  }

  throw new Error('Could not read that Spotify link. Try pasting a YouTube or SoundCloud link instead.');
}

export interface ResolvedSource {
  provider: Provider;
  title: string;
  artist?: string;
  thumbnail?: string;
  durationHintSeconds?: number;
  /** Set for streaming sources. */
  url?: string;
  /** Set for local files. */
  filePath?: string;
  /** Stable identity for caching. */
  fingerprint: string;
  /** Explains any substitution, e.g. a Spotify link matched on YouTube. */
  note?: string;
}

function fromYtDlp(info: ResolvedTrackInfo, note?: string): ResolvedSource {
  return {
    provider: info.provider,
    title: info.title,
    artist: info.artist,
    thumbnail: info.thumbnail,
    durationHintSeconds: info.durationSeconds,
    url: info.webpageUrl,
    fingerprint: hash(`${info.provider}:${info.sourceId}`),
    note,
  };
}

/** Turns a user request into something concrete we can download or read. */
export async function resolveSource(request: TrackRequest, signal?: AbortSignal): Promise<ResolvedSource> {
  if (request.kind === 'local') {
    const absolute = path.resolve(request.path);
    if (!fs.existsSync(absolute)) throw new Error(`That file no longer exists: ${path.basename(absolute)}`);

    const stats = fs.statSync(absolute);
    if (!stats.isFile()) throw new Error(`${path.basename(absolute)} is not a file.`);
    if (!AUDIO_EXTENSIONS.has(path.extname(absolute).toLowerCase())) {
      throw new Error(`${path.basename(absolute)} does not look like an audio file.`);
    }

    return {
      provider: 'local',
      title: path.basename(absolute).replace(/\.[^.]+$/, ''),
      filePath: absolute,
      fingerprint: hash(`local:${absolute}:${stats.size}:${Math.floor(stats.mtimeMs)}`),
    };
  }

  if (request.kind === 'query') {
    const query = request.query.trim();
    if (!query) throw new Error('Enter a song name to search for.');

    const results = await search(query, request.provider, 1, signal);
    if (results.length === 0) throw new Error(`No ${request.provider} results for "${query}".`);
    return fromYtDlp(results[0]);
  }

  const url = request.url.trim();
  if (!isHttpUrl(url)) throw new Error('That does not look like a link.');

  if (detectProvider(url) === 'spotify') {
    const metadata = await resolveSpotifyMetadata(url);
    const query = [metadata.artist, metadata.title].filter(Boolean).join(' ');
    const results = await search(query, 'youtube', 1, signal);
    if (results.length === 0) throw new Error(`Could not find audio for "${query}".`);
    return fromYtDlp(results[0], `Spotify serves no audio, so this was matched on YouTube from "${query}".`);
  }

  return fromYtDlp(await inspect(url, signal));
}

function asSearchResult(result: ResolvedTrackInfo): SearchResult {
  return {
    sourceId: result.sourceId,
    title: result.title,
    artist: result.artist,
    durationSeconds: result.durationSeconds,
    thumbnail: result.thumbnail,
    webpageUrl: result.webpageUrl,
    provider: result.provider,
  };
}

/** Reads a YouTube playlist or SoundCloud set into individual search-shaped tracks. */
export async function loadPlaylist(
  url: string,
  signal?: AbortSignal,
): Promise<{ title: string; truncated: boolean; limit: number; results: SearchResult[] }> {
  if (!isHttpUrl(url)) throw new Error('That does not look like a link.');

  const provider = detectProvider(url);
  if (provider !== 'youtube' && provider !== 'soundcloud') {
    throw new Error('Paste a YouTube or SoundCloud playlist link.');
  }
  if (!isPlaylistUrl(url)) {
    throw new Error('That looks like a single track. Paste a playlist or set link instead.');
  }

  const listing = await listPlaylist(url, { signal });
  const seen = new Set<string>();
  const results: SearchResult[] = [];
  for (const track of listing.tracks) {
    if (seen.has(track.webpageUrl)) continue;
    seen.add(track.webpageUrl);
    results.push(asSearchResult(track));
  }

  return {
    title: listing.title,
    truncated: listing.truncated,
    limit: MAX_PLAYLIST_TRACKS,
    results,
  };
}

/**
 * Turns playlist links into one link per track so a mix job can ingest them
 * the same way as songs added by hand.
 */
export async function expandTrackRequests(
  requests: TrackRequest[],
  signal?: AbortSignal,
): Promise<TrackRequest[]> {
  const expanded: TrackRequest[] = [];
  const seen = new Set<string>();

  const push = (request: TrackRequest) => {
    const key =
      request.kind === 'link'
        ? `link:${request.url}`
        : request.kind === 'query'
          ? `query:${request.provider}:${request.query}`
          : `local:${request.path}`;
    if (seen.has(key)) return;
    seen.add(key);
    expanded.push(request);
  };

  for (const request of requests) {
    if (request.kind === 'link' && isPlaylistUrl(request.url)) {
      const listing = await listPlaylist(request.url, { signal });
      for (const track of listing.tracks) push({ kind: 'link', url: track.webpageUrl });
      continue;
    }
    push(request);
  }

  if (expanded.length === 0) throw new Error('That playlist did not contain any playable tracks.');
  return expanded;
}

/** Text search surfaced to the UI, with results shaped for display. */
export async function searchTracks(
  query: string,
  provider: 'youtube' | 'soundcloud',
  limit: number,
  signal?: AbortSignal,
): Promise<SearchResult[]> {
  const results = await search(query, provider, limit, signal);
  return results.map(asSearchResult);
}

/**
 * Ingests in progress, keyed by fingerprint. Nothing queues mix jobs, so the
 * same song can be requested twice at once — by two overlapping jobs, or by a
 * job and a manual add. Without this, both would download and transcode the
 * same track and race to publish it.
 */
const inFlight = new Map<string, Promise<IngestedTrack>>();

/**
 * Gets a track all the way to "ready": audio on disk as canonical FLAC, plus a
 * full analysis. Already-ingested tracks are returned straight from the library.
 */
export async function ingestTrack(
  request: TrackRequest,
  options: { onProgress?: IngestProgress; signal?: AbortSignal } = {},
): Promise<{ track: IngestedTrack; reused: boolean; note?: string }> {
  const { onProgress, signal } = options;

  onProgress?.({ phase: 'resolving' });
  const source = await resolveSource(request, signal);

  // A stale analysis still has its audio on disk, so re-running it only costs
  // the analysis pass. Reusing it instead would silently drop the track out of
  // beat-matching for the rest of the library's life.
  const existing = findTrack(source.fingerprint);
  if (existing && fs.existsSync(path.join(paths.media, existing.mediaFile)) && isAnalysisCurrent(existing.analysis)) {
    return { track: existing, reused: true, note: source.note };
  }

  // Join an ingest of the same track that is already running rather than
  // duplicating it. If that one fails we take over ourselves, so a caller is
  // never sunk by an unrelated request being cancelled. The bound only stops a
  // pathological chain of failures from looping.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const pending = inFlight.get(source.fingerprint);
    if (!pending) break;

    onProgress?.({ phase: 'transcoding', detail: `Already adding "${source.title}", waiting for it to finish.` });
    try {
      return { track: await pending, reused: true, note: source.note };
    } catch {
      if (signal?.aborted) throw new Error('Cancelled.');
      // The owner failed or was cancelled; loop to join a newer attempt or run it.
    }
  }

  const work = materializeTrack(source, options);
  inFlight.set(source.fingerprint, work);
  try {
    return { track: await work, reused: false, note: source.note };
  } finally {
    // Only clear our own entry: a later attempt may already have replaced it.
    if (inFlight.get(source.fingerprint) === work) inFlight.delete(source.fingerprint);
  }
}

/** Downloads, transcodes, analyzes, and records one resolved source. */
async function materializeTrack(
  source: ResolvedSource,
  options: { onProgress?: IngestProgress; signal?: AbortSignal },
): Promise<IngestedTrack> {
  const { onProgress, signal } = options;
  const mediaFile = `${source.fingerprint}.flac`;
  const mediaPath = path.join(paths.media, mediaFile);

  let downloadedPath: string | null = null;
  try {
    if (!fs.existsSync(mediaPath)) {
      let sourcePath: string;
      if (source.filePath) {
        sourcePath = source.filePath;
      } else if (source.url) {
        onProgress?.({ phase: 'downloading', fraction: 0 });
        downloadedPath = await download(source.url, {
          signal,
          onProgress: (fraction) => onProgress?.({ phase: 'downloading', fraction }),
        });
        sourcePath = downloadedPath;
      } else {
        throw new Error('Nothing to ingest for that track.');
      }

      onProgress?.({ phase: 'transcoding' });
      await transcodeToFlac(sourcePath, mediaPath, { signal });
    }

    onProgress?.({ phase: 'analyzing' });
    const [analysis, loudness] = await Promise.all([analyzeAudioFile(mediaPath), measureLoudness(mediaPath)]);

    const track: IngestedTrack = {
      id: source.fingerprint,
      title: source.title,
      artist: source.artist,
      provider: source.provider,
      sourceUrl: source.url,
      sourcePath: source.filePath,
      mediaFile,
      sizeBytes: fs.statSync(mediaPath).size,
      thumbnail: source.thumbnail,
      analysis,
      loudness,
      addedAt: new Date().toISOString(),
      plays: 0,
    };

    fs.writeFileSync(path.join(paths.analysis, `${track.id}.json`), JSON.stringify(analysis), 'utf8');
    return upsertTrack(track);
  } finally {
    if (downloadedPath) {
      // The download lands in a per-job scratch directory; remove the whole thing.
      fs.rmSync(path.dirname(downloadedPath), { recursive: true, force: true });
    }
  }
}

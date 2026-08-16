import type {
  IngestedTrack,
  LibrarySnapshot,
  RenderProgress,
  SearchResult,
  ToolStatus,
  TrackRequest,
  Vibe,
} from '../types';

let apiBase = '';

export function setApiBase(base: string): void {
  apiBase = base.replace(/\/$/, '');
}

export function getApiBase(): string {
  return apiBase;
}

/** Absolute URL for a rendered mix, usable as an <audio> source. */
export function mixUrl(file: string): string {
  return `${apiBase}/renders/${encodeURIComponent(file)}`;
}

/** Absolute URL for an ingested track's canonical audio. */
export function mediaUrl(file: string): string {
  return `${apiBase}/media/${encodeURIComponent(file)}`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });

  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // Keep the status-based message.
    }
    throw new Error(message);
  }

  return (await response.json()) as T;
}

export const api = {
  health: () => request<{ ok: boolean; dataDir: string }>('/api/health'),

  tools: () => request<ToolStatus>('/api/tools'),

  library: () => request<LibrarySnapshot>('/api/library'),

  search: (query: string, provider: 'youtube' | 'soundcloud', signal?: AbortSignal) =>
    request<{ results: SearchResult[] }>(
      `/api/search?q=${encodeURIComponent(query)}&provider=${provider}&limit=6`,
      { signal },
    ).then((body) => body.results),

  playlist: (url: string, signal?: AbortSignal) =>
    request<{ title: string; truncated: boolean; limit: number; results: SearchResult[] }>(
      `/api/playlist?url=${encodeURIComponent(url)}`,
      { signal },
    ),

  addTrack: (track: TrackRequest) =>
    request<{ track: IngestedTrack; reused: boolean; note?: string }>('/api/tracks', {
      method: 'POST',
      body: JSON.stringify(track),
    }),

  createMix: (payload: { title: string; vibes: Vibe[]; targetMinutes?: number; tracks: TrackRequest[] }) =>
    request<{ jobId: string }>('/api/mixes', { method: 'POST', body: JSON.stringify(payload) }),

  job: (jobId: string) => request<RenderProgress>(`/api/mixes/${jobId}`),

  cancelJob: (jobId: string) => request<{ ok: boolean }>(`/api/mixes/${jobId}/cancel`, { method: 'POST' }),

  recordPlay: (kind: 'mix' | 'track', id: string) =>
    request<{ ok: boolean }>('/api/library/plays', { method: 'POST', body: JSON.stringify({ kind, id }) }),

  deleteMix: (id: string) => request<{ ok: boolean }>(`/api/library/mixes/${id}`, { method: 'DELETE' }),

  deleteTrack: (id: string) => request<{ ok: boolean }>(`/api/library/tracks/${id}`, { method: 'DELETE' }),
};

/**
 * Subscribes to a render job over server-sent events, falling back to polling if
 * the stream cannot be opened.
 */
export function watchJob(
  jobId: string,
  onUpdate: (state: RenderProgress) => void,
  onDone: (state: RenderProgress) => void,
): () => void {
  let closed = false;
  let source: EventSource | null = null;
  let pollTimer: number | undefined;

  const finish = (state: RenderProgress) => {
    if (closed) return;
    closed = true;
    source?.close();
    if (pollTimer) window.clearTimeout(pollTimer);
    onDone(state);
  };

  const handle = (state: RenderProgress) => {
    if (closed) return;
    onUpdate(state);
    if (state.stage === 'done' || state.stage === 'error') finish(state);
  };

  const startPolling = () => {
    const tick = async () => {
      if (closed) return;
      try {
        handle(await api.job(jobId));
      } catch {
        // The job may have expired; stop quietly.
        closed = true;
        return;
      }
      if (!closed) pollTimer = window.setTimeout(tick, 700);
    };
    void tick();
  };

  try {
    source = new EventSource(`${apiBase}/api/mixes/${jobId}/events`);
    source.onmessage = (event) => {
      try {
        handle(JSON.parse(event.data) as RenderProgress);
      } catch {
        // Ignore malformed frames.
      }
    };
    source.onerror = () => {
      // A closed stream after completion is normal; otherwise fall back.
      if (!closed) {
        source?.close();
        source = null;
        startPolling();
      }
    };
  } catch {
    startPolling();
  }

  return () => {
    closed = true;
    source?.close();
    if (pollTimer) window.clearTimeout(pollTimer);
  };
}

export function isProbablyUrl(value: string): boolean {
  const text = value.trim();
  if (!/^https?:\/\//i.test(text)) return false;
  try {
    new URL(text);
    return true;
  } catch {
    return false;
  }
}

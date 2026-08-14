import { useState } from 'react';
import { getApiBase } from '../lib/api';
import type { ToolStatus } from '../types';

interface SetupBannerProps {
  tools: ToolStatus;
  onInstalled: () => void;
}

/**
 * First-run setup. yt-dlp is fetched on demand rather than bundled, so this is
 * the one moment the app needs the network before it can do anything.
 */
export function SetupBanner({ tools, onInstalled }: SetupBannerProps) {
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState('');

  if (tools.ffmpeg.ready && tools.ytdlp.ready) return null;

  if (!tools.ffmpeg.ready) {
    return (
      <section className="panel setup-panel">
        <p className="eyebrow">Setup needed</p>
        <h2>ffmpeg is missing</h2>
        <p className="summary-note">
          mixR needs ffmpeg to decode and render audio. It normally ships with the app, so this usually means the
          bundled copy could not run. Install it with <code>brew install ffmpeg</code> and reopen mixR.
        </p>
        {tools.ffmpeg.error ? <p className="error-banner">{tools.ffmpeg.error}</p> : null}
      </section>
    );
  }

  const install = () => {
    setInstalling(true);
    setError(null);
    setProgress(0);

    // The install endpoint streams progress, so this reads the response body
    // rather than waiting for a single JSON reply.
    void (async () => {
      try {
        const response = await fetch(`${getApiBase()}/api/tools/install`, { method: 'POST' });
        if (!response.ok || !response.body) throw new Error(`Setup failed (${response.status})`);

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const frames = buffer.split('\n\n');
          buffer = frames.pop() ?? '';
          for (const frame of frames) {
            const line = frame.split('\n').find((entry) => entry.startsWith('data: '));
            if (!line) continue;
            const payload = JSON.parse(line.slice(6)) as {
              stage: string;
              progress?: number;
              detail?: string;
              error?: string;
            };

            if (payload.stage === 'error') throw new Error(payload.error ?? 'Setup failed');
            if (payload.progress !== undefined) setProgress(payload.progress);
            if (payload.detail) setDetail(payload.detail);
            if (payload.stage === 'done') {
              setProgress(1);
              onInstalled();
              return;
            }
          }
        }
        onInstalled();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        setInstalling(false);
      }
    })();
  };

  return (
    <section className="panel setup-panel">
      <p className="eyebrow">One-time setup</p>
      <h2>Get the audio fetcher</h2>
      <p className="summary-note">
        mixR uses yt-dlp to find and download songs from YouTube and SoundCloud. It is a free 3 MB download and lives
        inside mixR's own folder — nothing else on your Mac is touched.
      </p>

      {installing ? (
        <div className="setup-progress">
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
          <p className="summary-note">{detail || `Downloading… ${Math.round(progress * 100)}%`}</p>
        </div>
      ) : (
        <button type="button" className="generate-button" onClick={install}>
          Download yt-dlp
        </button>
      )}

      {error ? <p className="error-banner">{error}</p> : null}
    </section>
  );
}

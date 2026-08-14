import { useState } from 'react';
import { api, mediaUrl } from '../lib/api';
import { formatMegabytes, formatSeconds } from '../lib/mixEngine';
import { MixPlayer } from './MixPlayer';
import type { LibrarySnapshot, MixRecord } from '../types';

interface LibraryViewProps {
  library: LibrarySnapshot;
  onRefresh: () => void;
}

export function LibraryView({ library, onRefresh }: LibraryViewProps) {
  const [openMix, setOpenMix] = useState<MixRecord | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const sum = (values: (number | undefined)[]) =>
    values.reduce<number>(
      (total, value) => total + (typeof value === 'number' && Number.isFinite(value) ? value : 0),
      0,
    );

  const totalBytes = sum([
    ...library.mixes.map((mix) => mix.sizeBytes),
    ...library.tracks.map((track) => track.sizeBytes),
  ]);

  const playTrack = (trackId: string, file: string) => {
    setPreview(preview === file ? null : file);
    if (preview !== file) void api.recordPlay('track', trackId).catch(() => undefined);
  };

  const removeTrack = async (id: string) => {
    await api.deleteTrack(id);
    onRefresh();
  };

  if (openMix) {
    const current = library.mixes.find((mix) => mix.id === openMix.id) ?? openMix;
    return (
      <div className="stack">
        <button type="button" className="ghost-button" onClick={() => setOpenMix(null)}>
          ← All mixes
        </button>
        <MixPlayer
          mix={current}
          onDeleted={() => {
            setOpenMix(null);
            onRefresh();
          }}
        />
      </div>
    );
  }

  return (
    <div className="stack">
      <section className="panel">
        <div className="section-heading block-heading">
          <div>
            <p className="eyebrow">Library</p>
            <h2>
              {library.mixes.length} mix{library.mixes.length === 1 ? '' : 'es'} · {library.tracks.length} track
              {library.tracks.length === 1 ? '' : 's'}
            </h2>
            <p className="summary-note">Using {formatMegabytes(totalBytes, 0)} on disk.</p>
          </div>
          <button type="button" className="ghost-button" onClick={onRefresh}>
            Refresh
          </button>
        </div>

        {library.mixes.length === 0 ? (
          <p className="summary-note">No mixes yet. Build one and it will show up here.</p>
        ) : (
          <ul className="library-list">
            {library.mixes.map((mix) => (
              <li key={mix.id}>
                <button type="button" className="library-row" onClick={() => setOpenMix(mix)}>
                  <span className="library-body">
                    <span className="library-title">{mix.title}</span>
                    <span className="library-meta">
                      {mix.plan.tracks.length} tracks · {mix.vibes.join(', ')} ·{' '}
                      {new Date(mix.createdAt).toLocaleDateString()} · {mix.plays} play{mix.plays === 1 ? '' : 's'}
                    </span>
                  </span>
                  <span className="library-duration">{formatSeconds(mix.durationSeconds)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel">
        <div className="section-heading block-heading">
          <div>
            <p className="eyebrow">Cached songs</p>
            <h2>Analyzed tracks</h2>
            <p className="summary-note">
              These are kept so reusing a song is instant. Deleting one only frees disk space.
            </p>
          </div>
        </div>

        {library.tracks.length === 0 ? (
          <p className="summary-note">Nothing cached yet.</p>
        ) : (
          <div className="track-table">
            <div className="track-table-head">
              <span>Track</span>
              <span>BPM</span>
              <span>Key</span>
              <span>Length</span>
              <span>Size</span>
              <span />
            </div>
            {library.tracks.map((track) => (
              <div key={track.id} className="track-table-row">
                <span className="track-cell-title">
                  <button type="button" className="link-button" onClick={() => playTrack(track.id, track.mediaFile)}>
                    {preview === track.mediaFile ? '❚❚' : '▶'}
                  </button>
                  <span>
                    <strong>{track.title}</strong>
                    {track.artist ? <em> — {track.artist}</em> : null}
                  </span>
                </span>
                <span>{track.analysis.bpm}</span>
                <span>{track.analysis.key}</span>
                <span>{formatSeconds(track.analysis.durationSeconds)}</span>
                <span>{formatMegabytes(track.sizeBytes)}</span>
                <span>
                  <button type="button" className="ghost-button danger small" onClick={() => void removeTrack(track.id)}>
                    Delete
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}

        {preview ? <audio className="preview-audio" src={mediaUrl(preview)} autoPlay controls /> : null}
      </section>
    </div>
  );
}

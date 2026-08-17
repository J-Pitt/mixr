import { useEffect, useRef, useState } from 'react';
import { api, mixUrl } from '../lib/api';
import { bridge, isDesktop } from '../lib/bridge';
import { formatBpm, formatMegabytes, formatSeconds } from '../lib/mixEngine';
import { MixTimeline } from './MixTimeline';
import { ShareEmailButton } from './ShareEmailButton';
import type { MixRecord } from '../types';

interface MixPlayerProps {
  mix: MixRecord;
  onDeleted?: () => void;
}

export function MixPlayer({ mix, onDeleted }: MixPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(mix.durationSeconds);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const countedPlayRef = useRef(false);

  // Reset transport state when a different mix is shown.
  useEffect(() => {
    setPlaying(false);
    setCurrentTime(0);
    setDuration(mix.durationSeconds);
    countedPlayRef.current = false;
  }, [mix.id, mix.durationSeconds]);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (audio.paused) {
      void audio.play().then(() => {
        // Count a play once per mix, the first time it actually starts.
        if (!countedPlayRef.current) {
          countedPlayRef.current = true;
          void api.recordPlay('mix', mix.id).catch(() => undefined);
        }
      });
    } else {
      audio.pause();
    }
  };

  const seek = (seconds: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = seconds;
    setCurrentTime(seconds);
  };

  const save = async () => {
    const desktop = bridge();
    if (!desktop) return;
    const paths = await desktop.getPaths();
    const result = await desktop.saveMix(`${paths.renders}/${mix.file}`, `${mix.title}.mp3`);
    if (result.saved) setSaveMessage(`Saved to ${result.path}`);
    else if (result.error) setSaveMessage(result.error);
  };

  const reveal = async () => {
    const desktop = bridge();
    if (!desktop) return;
    const paths = await desktop.getPaths();
    await desktop.revealInFinder(`${paths.renders}/${mix.file}`);
  };

  const remove = async () => {
    await api.deleteMix(mix.id);
    onDeleted?.();
  };

  const activeIndex = mix.plan.tracks.findIndex((track, index) => {
    const start = track.mixStartSeconds ?? 0;
    const next = mix.plan.tracks[index + 1]?.mixStartSeconds ?? duration;
    return currentTime >= start && currentTime < next;
  });

  return (
    <section className="panel player-panel">
      <div className="section-heading block-heading">
        <div>
          <p className="eyebrow">Mix ready</p>
          <h2>{mix.title}</h2>
          <p className="summary-note">
            {mix.plan.summary} · {mix.vibes.join(', ')} · {formatMegabytes(mix.sizeBytes)}
          </p>
        </div>
        <p className="plan-duration">{formatSeconds(duration)}</p>
      </div>

      <audio
        ref={audioRef}
        src={mixUrl(mix.file)}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onLoadedMetadata={(event) => {
          const loaded = event.currentTarget.duration;
          if (Number.isFinite(loaded) && loaded > 0) setDuration(loaded);
        }}
      />

      <MixTimeline plan={mix.plan} currentTime={currentTime} onSeek={seek} />

      <div className="transport">
        <button type="button" className="play-button" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}>
          {playing ? '❚❚' : '▶'}
        </button>
        <span className="transport-time">
          {formatSeconds(currentTime)} / {formatSeconds(duration)}
        </span>
        <div className="transport-actions">
          {isDesktop() ? (
            <>
              <button type="button" className="ghost-button" onClick={save}>
                Save as…
              </button>
              <button type="button" className="ghost-button" onClick={reveal}>
                Show in Finder
              </button>
            </>
          ) : (
            <a className="ghost-button" href={mixUrl(mix.file)} download={`${mix.title}.mp3`}>
              Download
            </a>
          )}
          <ShareEmailButton title={mix.title} path={`/renders/${encodeURIComponent(mix.file)}`} className="ghost-button" />
          {onDeleted ? (
            <button type="button" className="ghost-button danger" onClick={remove}>
              Delete
            </button>
          ) : null}
        </div>
      </div>

      {saveMessage ? <p className="summary-note">{saveMessage}</p> : null}

      {mix.plan.warnings.length > 0 ? (
        <div className="warning-stack">
          {mix.plan.warnings.map((warning) => (
            <p key={warning} className="warning-banner">
              {warning}
            </p>
          ))}
        </div>
      ) : null}

      <ol className="tracklist">
        {mix.plan.tracks.map((track, index) => {
          const start = track.mixStartSeconds ?? 0;
          return (
            <li key={track.trackId}>
              <button
                type="button"
                className={index === activeIndex ? 'tracklist-row active' : 'tracklist-row'}
                onClick={() => seek(start)}
              >
                <span className="tracklist-index">{String(index + 1).padStart(2, '0')}</span>
                <span className="tracklist-body">
                  <span className="tracklist-title">{track.title}</span>
                  <span className="tracklist-meta">
                    {track.artist ? `${track.artist} · ` : ''}
                    {/* The tempo it plays at, which is the set tempo once it has been matched. */}
                    {formatBpm(track.bpm * (track.tempoRatio ?? 1))} BPM · {track.key} · plays{' '}
                    {formatSeconds(track.startOffsetSeconds)}–{formatSeconds(track.endOffsetSeconds)}
                    {track.transitionOut
                      ? ` · ${Math.round(track.transitionOut.lengthSeconds)}s ${track.transitionOut.style}`
                      : ''}
                  </span>
                </span>
                <span className="tracklist-start">{formatSeconds(start)}</span>
              </button>
            </li>
          );
        })}
      </ol>

      <details className="plan-details">
        <summary>How this mix was built</summary>
        <p className="summary-note">EQ profile: {mix.plan.tracks[0]?.eqProfile}</p>
        <ul className="note-list">
          {mix.plan.tracks.map((track) => (
            <li key={track.trackId}>
              <strong>{track.title}</strong>
              <ul>
                {track.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}

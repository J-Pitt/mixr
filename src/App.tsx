import { useMemo, useState } from 'react';
import {
  analyzeLinkedTrack,
  analyzeUploadedTrack,
  createLinkTrack,
  createUploadTrack,
  detectProvider,
  formatSeconds,
  generateMixPlan,
} from './lib/mixEngine';
import type { MixPlan, TrackInput, Vibe } from './types';

const vibeOptions: Vibe[] = ['Warm Up', 'Sunset Cruise', 'Peak Time', 'Late Night', 'After Hours'];

function App() {
  const [mixTitle, setMixTitle] = useState('Friday Roof Set');
  const [vibe, setVibe] = useState<Vibe>('Peak Time');
  const [targetMinutes, setTargetMinutes] = useState('45');
  const [linkInput, setLinkInput] = useState('');
  const [tracks, setTracks] = useState<TrackInput[]>([]);
  const [mixPlan, setMixPlan] = useState<MixPlan | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const analyzableTracks = useMemo(
    () => tracks.filter((track) => track.analysisStatus === 'ready' || track.analysisStatus === 'fallback'),
    [tracks],
  );

  const patchTrack = (trackId: string, update: (track: TrackInput) => TrackInput) => {
    setTracks((current) => current.map((track) => (track.id === trackId ? update(track) : track)));
  };

  const runAnalysis = async (track: TrackInput) => {
    patchTrack(track.id, (current) => ({ ...current, analysisStatus: 'analyzing', notes: [] }));

    try {
      if (track.source.kind === 'upload') {
        const analysis = await analyzeUploadedTrack(track.source.file);
        patchTrack(track.id, (current) => ({
          ...current,
          analysis,
          analysisStatus: 'ready',
          notes: ['Uploaded audio decoded locally in the browser.'],
        }));
      } else {
        const analysis = analyzeLinkedTrack(track.source.url, track.source.provider);
        patchTrack(track.id, (current) => ({
          ...current,
          analysis,
          analysisStatus: 'fallback',
          notes: ['Streaming link kept as a planning source with estimated analysis.'],
        }));
      }
    } catch (error) {
      patchTrack(track.id, (current) => ({
        ...current,
        analysisStatus: 'error',
        notes: [error instanceof Error ? error.message : 'Analysis failed.'],
      }));
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const nextFiles = Array.from(event.target.files ?? []);
    if (nextFiles.length === 0) {
      return;
    }

    setErrorMessage(null);
    setMixPlan(null);
    const nextTracks = nextFiles.map(createUploadTrack);
    setTracks((current) => [...current, ...nextTracks]);
    await Promise.all(nextTracks.map((track) => runAnalysis(track)));
    event.target.value = '';
  };

  const handleAddLink = async () => {
    const provider = detectProvider(linkInput.trim());
    if (provider === 'unknown') {
      setErrorMessage('Use a YouTube, Spotify, or SoundCloud link.');
      return;
    }

    setErrorMessage(null);
    setMixPlan(null);
    const track = createLinkTrack(linkInput.trim());
    setTracks((current) => [...current, track]);
    setLinkInput('');
    await runAnalysis(track);
  };

  const removeTrack = (trackId: string) => {
    setTracks((current) => current.filter((track) => track.id !== trackId));
    setMixPlan(null);
  };

  const handleGenerateMix = () => {
    if (analyzableTracks.length < 2) {
      setErrorMessage('Add at least two analyzed tracks before generating a mix.');
      return;
    }

    setErrorMessage(null);
    const parsedTarget = targetMinutes.trim() ? Number(targetMinutes) : undefined;
    const plan = generateMixPlan({
      title: mixTitle,
      vibe,
      targetMinutes: parsedTarget && Number.isFinite(parsedTarget) ? parsedTarget : undefined,
      tracks: analyzableTracks,
    });
    setMixPlan(plan);
  };

  return (
    <div className="page-shell">
      <div className="ambient ambient-left" />
      <div className="ambient ambient-right" />
      <main className="app-frame">
        <section className="hero-panel">
          <p className="eyebrow">mixR</p>
          <h1>Turn loose tracks into a DJ-ready mix blueprint.</h1>
          <p className="hero-copy">
            Upload audio or drop streaming links, pick a vibe, set an optional runtime, and let the app score energy second by second to plan order, trims, EQ, and transitions.
          </p>
        </section>

        <section className="control-grid">
          <div className="panel panel-form">
            <label>
              <span>Mix title</span>
              <input value={mixTitle} onChange={(event) => setMixTitle(event.target.value)} placeholder="Warehouse opener" />
            </label>

            <label>
              <span>Vibe</span>
              <div className="vibe-grid">
                {vibeOptions.map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={option === vibe ? 'vibe-chip active' : 'vibe-chip'}
                    onClick={() => setVibe(option)}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </label>

            <label>
              <span>Target length in minutes</span>
              <input
                value={targetMinutes}
                onChange={(event) => setTargetMinutes(event.target.value)}
                inputMode="numeric"
                placeholder="Optional"
              />
            </label>

            <div className="input-stack">
              <span>Add songs</span>
              <label className="upload-dropzone">
                <input type="file" accept="audio/*" multiple onChange={handleFileUpload} />
                <strong>Upload local files</strong>
                <small>MP3, WAV, M4A, FLAC, or any browser-decodable audio file.</small>
              </label>

              <div className="link-row">
                <input
                  value={linkInput}
                  onChange={(event) => setLinkInput(event.target.value)}
                  placeholder="Paste YouTube, Spotify, or SoundCloud link"
                />
                <button type="button" onClick={handleAddLink}>
                  Add link
                </button>
              </div>
            </div>

            <button type="button" className="generate-button" onClick={handleGenerateMix}>
              Build mix
            </button>

            {errorMessage ? <p className="error-banner">{errorMessage}</p> : null}
          </div>

          <div className="panel panel-summary">
            <div className="summary-row">
              <span>Tracks ready</span>
              <strong>{analyzableTracks.length}</strong>
            </div>
            <div className="summary-row">
              <span>Uploads with full analysis</span>
              <strong>{tracks.filter((track) => track.analysisStatus === 'ready').length}</strong>
            </div>
            <div className="summary-row">
              <span>Links using estimate mode</span>
              <strong>{tracks.filter((track) => track.analysisStatus === 'fallback').length}</strong>
            </div>
            <p className="summary-note">
              Uploaded songs are decoded locally and scored one second at a time. Streaming links stay available as planning inputs, but raw audio analysis for those providers needs a backend ingestion pipeline.
            </p>
          </div>
        </section>

        <section className="panel library-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Library</p>
              <h2>Source tracks</h2>
            </div>
            <p>{tracks.length} total</p>
          </div>

          <div className="track-grid">
            {tracks.length === 0 ? (
              <div className="empty-card">Add songs to start building the mix.</div>
            ) : (
              tracks.map((track) => (
                <article key={track.id} className="track-card">
                  <div className="track-topline">
                    <div>
                      <p className="track-title">{track.title}</p>
                      <p className="track-source">
                        {track.source.kind === 'upload' ? 'Local upload' : track.source.provider}
                      </p>
                    </div>
                    <button type="button" className="ghost-button" onClick={() => removeTrack(track.id)}>
                      Remove
                    </button>
                  </div>

                  <div className="status-pill status-pill-" data-state={track.analysisStatus}>
                    {track.analysisStatus}
                  </div>

                  {track.analysis ? (
                    <>
                      <div className="metric-row">
                        <span>{track.analysis.bpm} BPM</span>
                        <span>{track.analysis.key}</span>
                        <span>{formatSeconds(track.analysis.durationSeconds)}</span>
                      </div>
                      <MiniWave slices={track.analysis.slices} />
                      <div className="metric-row muted-row">
                        <span>Intro {formatSeconds(track.analysis.introSecond)}</span>
                        <span>Outro {formatSeconds(track.analysis.outroSecond)}</span>
                      </div>
                    </>
                  ) : null}

                  {track.notes?.length ? <p className="track-note">{track.notes.join(' ')}</p> : null}
                </article>
              ))
            )}
          </div>
        </section>

        <section className="panel plan-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Mix Plan</p>
              <h2>{mixPlan?.title ?? 'No mix generated yet'}</h2>
            </div>
            {mixPlan ? <p>{formatSeconds(mixPlan.totalDurationSeconds)}</p> : null}
          </div>

          {mixPlan ? (
            <>
              <p className="plan-summary">{mixPlan.summary}</p>
              {mixPlan.warnings.map((warning) => (
                <p key={warning} className="warning-banner">
                  {warning}
                </p>
              ))}

              <div className="plan-track-list">
                {mixPlan.tracks.map((track, index) => (
                  <article key={track.trackId} className="plan-track-card">
                    <div className="plan-track-index">{String(index + 1).padStart(2, '0')}</div>
                    <div className="plan-track-body">
                      <div className="track-topline">
                        <div>
                          <p className="track-title">{track.title}</p>
                          <p className="track-source">
                            {track.provider} · {track.bpm} BPM · {track.key}
                          </p>
                        </div>
                        <p className="plan-duration">{formatSeconds(track.playDurationSeconds)}</p>
                      </div>

                      <p className="track-note">EQ: {track.eqProfile}</p>
                      <p className="track-note">
                        Play window: {formatSeconds(track.startOffsetSeconds)} to {formatSeconds(track.endOffsetSeconds)}
                      </p>
                      {track.transitionIn ? (
                        <p className="track-note">
                          Transition in: {track.transitionIn.style} for {track.transitionIn.lengthSeconds}s at {formatSeconds(track.transitionIn.fromSecond)}. {track.transitionIn.reason}
                        </p>
                      ) : null}
                      {track.transitionOut ? (
                        <p className="track-note">
                          Transition out: {track.transitionOut.style} from {formatSeconds(track.transitionOut.fromSecond)} to {formatSeconds(track.transitionOut.toSecond)}. {track.transitionOut.reason}
                        </p>
                      ) : null}
                    </div>
                  </article>
                ))}
              </div>
            </>
          ) : (
            <div className="empty-card">Generate a mix to see the ordered set, trims, and transitions.</div>
          )}
        </section>
      </main>
    </div>
  );
}

function MiniWave({ slices }: { slices: Array<{ second: number; energy: number; brightness: number }> }) {
  const sampleSize = 28;
  const stride = Math.max(1, Math.floor(slices.length / sampleSize));
  const bars = slices.filter((_, index) => index % stride === 0).slice(0, sampleSize);

  return (
    <div className="mini-wave" aria-hidden="true">
      {bars.map((slice) => (
        <span
          key={slice.second}
          className="mini-wave-bar"
          style={{
            height: `${18 + slice.energy * 52}px`,
            opacity: `${0.45 + slice.brightness * 0.55}`,
          }}
        />
      ))}
    </div>
  );
}

export default App;
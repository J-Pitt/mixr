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

  const estimatedTracks = useMemo(
    () => tracks.filter((track) => track.analysisStatus === 'fallback').length,
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
      <div className="ambient ambient-bottom" />
      <main className="app-frame">
        <section className="topbar panel-chrome">
          <div>
            <p className="eyebrow">mixR studio</p>
            <h1>Build a cleaner DJ mix plan.</h1>
            <p className="topbar-copy">Add tracks, pick a vibe, then generate the set order and transition windows.</p>
          </div>
          <div className="topbar-actions simple-actions">
            <span className="header-stat">{analyzableTracks.length} ready</span>
            <button type="button" className="generate-button" onClick={handleGenerateMix}>
              Build mix
            </button>
          </div>
        </section>

        <section className="workspace-grid">
          <aside className="workspace-sidebar panel-chrome">
            <div className="sidebar-section">
              <div className="section-heading stacked-heading compact-heading">
                <div>
                  <p className="eyebrow">Mix setup</p>
                  <h2>Composer</h2>
                </div>
              </div>

              <label>
                <span>Mix title</span>
                <input value={mixTitle} onChange={(event) => setMixTitle(event.target.value)} placeholder="Warehouse opener" />
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
            </div>

            <div className="sidebar-section">
              <div className="section-heading stacked-heading compact-heading">
                <div>
                  <p className="eyebrow">Mood</p>
                  <h3>Vibe</h3>
                </div>
              </div>
              <div className="vibe-grid-simple">
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
            </div>

            <div className="sidebar-section">
              <div className="section-heading stacked-heading compact-heading">
                <div>
                  <p className="eyebrow">Ingest</p>
                  <h3>Add sources</h3>
                </div>
              </div>

              <label className="upload-dropzone">
                <input type="file" accept="audio/*" multiple onChange={handleFileUpload} />
                <strong>Upload local audio</strong>
                <small>Browser-decoded and analyzed second by second for real transition points.</small>
              </label>

              <div className="link-row">
                <input
                  value={linkInput}
                  onChange={(event) => setLinkInput(event.target.value)}
                  placeholder="Paste YouTube, Spotify, or SoundCloud link"
                />
                <button type="button" onClick={handleAddLink}>
                  Add
                </button>
              </div>
              <p className="summary-note">{estimatedTracks > 0 ? `${estimatedTracks} link sources are using estimate mode.` : 'Uploads get full local analysis.'}</p>
              {errorMessage ? <p className="error-banner">{errorMessage}</p> : null}
            </div>
          </aside>

          <section className="workspace-main">
            <section className="panel-chrome library-panel">
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

                      <div className="status-pill" data-state={track.analysisStatus}>
                        {track.analysisStatus}
                      </div>

                      {track.analysis ? (
                        <>
                          <div className="metric-row metric-row-tight">
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

            <section className="panel-chrome plan-panel">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Mix plan</p>
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

                  <div className="timeline-ribbon">
                    {mixPlan.tracks.map((track) => (
                      <div
                        key={track.trackId}
                        className="timeline-segment"
                        style={{ flexGrow: Math.max(1, track.playDurationSeconds) }}
                      >
                        <span>{track.title}</span>
                      </div>
                    ))}
                  </div>

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
          </section>
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
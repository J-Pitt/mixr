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

const vibeGroups: { label: string; vibes: Vibe[] }[] = [
  {
    label: 'Time of day',
    vibes: ['Sunrise', 'Morning Coffee', 'Midday Drive', 'Golden Hour', 'Sunset Cruise', 'Blue Hour', 'Late Night', 'After Hours', 'Deep Night'],
  },
  {
    label: 'Season & outdoors',
    vibes: ['Spring Bloom', 'Summer Heat', 'Festival', 'Beach Party', 'Poolside', 'Autumn Rain', 'Winter Chill', 'Cozy Cabin'],
  },
  {
    label: 'Genre & sound',
    vibes: ['House', 'Techno', 'Drum & Bass', 'Trance', 'Hip-Hop', 'R&B', 'Afrobeats', 'Latin', 'Reggae', 'Jazz', 'Soul', 'Funk', 'Ambient'],
  },
  {
    label: 'Mood & energy',
    vibes: ['Warm Up', 'Peak Time', 'Hype', 'Uplifting', 'Euphoric', 'Chill', 'Romantic', 'Melancholy', 'Introspective', 'Dark'],
  },
];

const allVibes: Vibe[] = vibeGroups.flatMap((g) => g.vibes);

interface SongRow {
  id: string;
  value: string;
  file: File | null;
}

interface SavedMix {
  id: string;
  title: string;
  createdAt: string;
  selectedVibes: Vibe[];
  plan: MixPlan;
}

// Energy scale used to blend multiple vibes into one resolved profile
const vibeScale: Record<Vibe, number> = {
  'Ambient': 1, 'Introspective': 1, 'Melancholy': 1, 'Deep Night': 1, 'Winter Chill': 1,
  'Sunrise': 2, 'Morning Coffee': 2, 'Cozy Cabin': 2, 'Autumn Rain': 2, 'Jazz': 2,
  'Warm Up': 2, 'Chill': 2, 'Reggae': 2,
  'Sunset Cruise': 3, 'Golden Hour': 3, 'Blue Hour': 3, 'Poolside': 3, 'Romantic': 3,
  'Soul': 3, 'R&B': 3, 'Midday Drive': 3, 'Hip-Hop': 3, 'Funk': 3,
  'Late Night': 3, 'After Hours': 3, 'Dark': 3,
  'Spring Bloom': 4, 'Beach Party': 4, 'House': 4, 'Afrobeats': 4, 'Latin': 4,
  'Trance': 4, 'Uplifting': 4, 'Euphoric': 4,
  'Summer Heat': 5, 'Peak Time': 5, 'Techno': 5, 'Drum & Bass': 5,
  'Festival': 5, 'Hype': 5,
};

function App() {
  const [mixTitle, setMixTitle] = useState('Friday Roof Set');
  const [targetMinutes, setTargetMinutes] = useState('45');
  const [selectedVibes, setSelectedVibes] = useState<Vibe[]>(['Peak Time']);
  const [songRows, setSongRows] = useState<SongRow[]>([{ id: crypto.randomUUID(), value: '', file: null }]);
  const [tracks, setTracks] = useState<TrackInput[]>([]);
  const [mixPlan, setMixPlan] = useState<MixPlan | null>(null);
  const [myMixes, setMyMixes] = useState<SavedMix[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isCreatingMix, setIsCreatingMix] = useState(false);

  const patchTrack = (trackId: string, update: (track: TrackInput) => TrackInput) => {
    setTracks((current) => current.map((track) => (track.id === trackId ? update(track) : track)));
  };

  const analyzableTracks = useMemo(
    () => tracks.filter((track) => track.analysisStatus === 'ready' || track.analysisStatus === 'fallback'),
    [tracks],
  );

  const runAnalysis = async (track: TrackInput): Promise<TrackInput> => {
    patchTrack(track.id, (current) => ({ ...current, analysisStatus: 'analyzing', notes: [] }));

    try {
      if (track.source.kind === 'upload') {
        const analysis = await analyzeUploadedTrack(track.source.file);
        const updatedTrack: TrackInput = {
          ...track,
          analysis,
          analysisStatus: 'ready',
          notes: ['Uploaded audio decoded locally in the browser.'],
        };
        patchTrack(track.id, () => updatedTrack);
        return updatedTrack;
      }

      const analysis = analyzeLinkedTrack(track.source.url, track.source.provider);
      const updatedTrack: TrackInput = {
        ...track,
        analysis,
        analysisStatus: 'fallback',
        notes: ['Streaming link kept as a planning source with estimated analysis.'],
      };
      patchTrack(track.id, () => updatedTrack);
      return updatedTrack;
    } catch (error) {
      const updatedTrack: TrackInput = {
        ...track,
        analysisStatus: 'error',
        notes: [error instanceof Error ? error.message : 'Analysis failed.'],
      };
      patchTrack(track.id, () => updatedTrack);
      return updatedTrack;
    }
  };

  const updateSongRow = (rowId: string, update: (row: SongRow) => SongRow) => {
    setSongRows((current) => current.map((row) => (row.id === rowId ? update(row) : row)));
  };

  const addSongRow = () => {
    setSongRows((current) => [...current, { id: crypto.randomUUID(), value: '', file: null }]);
  };

  const removeSongRow = (rowId: string) => {
    setSongRows((current) => (current.length === 1 ? current : current.filter((row) => row.id !== rowId)));
  };

  const toggleVibe = (vibe: Vibe) => {
    setSelectedVibes((current) => {
      if (current.includes(vibe)) {
        return current.length === 1 ? current : current.filter((item) => item !== vibe);
      }
      return [...current, vibe];
    });
  };

  const resolveSelectedVibes = (vibes: Vibe[]) => {
    if (vibes.length === 1) {
      return vibes[0];
    }

    const average = vibes.reduce((total, vibe) => total + vibeScale[vibe], 0) / vibes.length;
    return allVibes.reduce((closest, vibe) => {
      const currentDistance = Math.abs(vibeScale[vibe] - average);
      const closestDistance = Math.abs(vibeScale[closest] - average);
      return currentDistance < closestDistance ? vibe : closest;
    }, allVibes[0]);
  };

  const buildTracksFromRows = () => {
    const completedRows = songRows.filter((row) => row.file || row.value.trim());
    if (completedRows.length < 2) {
      throw new Error('Add at least two songs to create a mix.');
    }

    return completedRows.map((row) => {
      if (row.file) {
        return createUploadTrack(row.file);
      }

      const provider = detectProvider(row.value.trim());
      if (provider === 'unknown') {
        throw new Error('Song links must be from YouTube, Spotify, or SoundCloud.');
      }

      return createLinkTrack(row.value.trim());
    });
  };

  const handleCreateMix = async () => {
    setErrorMessage(null);
    setMixPlan(null);

    if (selectedVibes.length === 0) {
      setErrorMessage('Choose at least one vibe.');
      return;
    }

    try {
      setIsCreatingMix(true);
      const draftTracks = buildTracksFromRows();
      setTracks(draftTracks);

      const analyzedTracks = await Promise.all(draftTracks.map((track) => runAnalysis(track)));
      const readyTracks = analyzedTracks.filter(
        (track) => track.analysisStatus === 'ready' || track.analysisStatus === 'fallback',
      );

      if (readyTracks.length < 2) {
        throw new Error('At least two songs need to analyze successfully to create a mix.');
      }

      const parsedTarget = targetMinutes.trim() ? Number(targetMinutes) : undefined;
      const plan = generateMixPlan({
        title: mixTitle,
        vibe: resolveSelectedVibes(selectedVibes),
        targetMinutes: parsedTarget && Number.isFinite(parsedTarget) ? parsedTarget : undefined,
        tracks: readyTracks,
      });

      setMixPlan(plan);
      setMyMixes((current) => [
        {
          id: crypto.randomUUID(),
          title: plan.title,
          createdAt: new Date().toLocaleString(),
          selectedVibes: [...selectedVibes],
          plan,
        },
        ...current,
      ]);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not create mix.');
    } finally {
      setIsCreatingMix(false);
    }
  };

  return (
    <div className="page-shell">
      <div className="ambient ambient-left" />
      <div className="ambient ambient-right" />
      <main className="app-frame">
        <section className="hero-block">
          <p className="eyebrow">mixR</p>
          <h1>Create polished DJ mixes from your tracks.</h1>
          <p className="hero-copy">
            Build a new mix from uploads or links, combine multiple vibe presets, and get a clean running order with transition timing.
          </p>
        </section>

        <section className="content-grid">
          <section className="panel create-panel">
            <div className="section-heading block-heading">
              <div>
                <p className="eyebrow">Create New Mix</p>
                <h2>Build the set</h2>
              </div>
            </div>

            <div className="form-stack">
              <label>
                <span>Mix title</span>
                <input value={mixTitle} onChange={(event) => setMixTitle(event.target.value)} placeholder="Late rooftop set" />
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

              <div className="form-section">
                <div className="section-heading compact-row">
                  <span>Add songs</span>
                  <button type="button" className="plus-button" onClick={addSongRow}>
                    +
                  </button>
                </div>

                <div className="song-list">
                  {songRows.map((row, index) => (
                    <div key={row.id} className="song-row">
                      <input
                        value={row.value}
                        onChange={(event) => updateSongRow(row.id, (current) => ({ ...current, value: event.target.value }))}
                        placeholder={`Song ${index + 1}: paste YouTube, Spotify, or SoundCloud link`}
                      />
                      <label className="file-button">
                        <input
                          type="file"
                          accept="audio/*"
                          onChange={(event) =>
                            updateSongRow(row.id, (current) => ({
                              ...current,
                              file: event.target.files?.[0] ?? null,
                            }))
                          }
                        />
                        <span>{row.file ? 'Audio selected' : 'Upload'}</span>
                      </label>
                      <button type="button" className="row-remove" onClick={() => removeSongRow(row.id)}>
                        Remove
                      </button>
                      {row.file ? <p className="row-meta">{row.file.name}</p> : null}
                    </div>
                  ))}
                </div>
              </div>

              <div className="form-section">
                <span>Choose vibe</span>
                <div className="vibe-groups">
                  {vibeGroups.map((group) => (
                    <div key={group.label} className="vibe-group">
                      <p className="vibe-group-label">{group.label}</p>
                      <div className="vibe-grid-simple">
                        {group.vibes.map((vibe) => (
                          <button
                            key={vibe}
                            type="button"
                            className={selectedVibes.includes(vibe) ? 'vibe-chip active' : 'vibe-chip'}
                            onClick={() => toggleVibe(vibe)}
                          >
                            {vibe}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                <p className="summary-note">
                  Pick as many as you like. The engine blends them into a single profile for sequencing and EQ.
                </p>
              </div>

              <button type="button" className="generate-button" onClick={handleCreateMix} disabled={isCreatingMix}>
                {isCreatingMix ? 'Creating mix...' : 'Create new mix'}
              </button>

              {errorMessage ? <p className="error-banner">{errorMessage}</p> : null}
            </div>
          </section>

          <section className="panel library-panel">
            <div className="section-heading block-heading">
              <div>
                <p className="eyebrow">Library</p>
                <h2>My mixes and my tracks</h2>
              </div>
            </div>

            <div className="library-grid">
              <div className="library-column">
                <h3>My mixes</h3>
                <div className="library-list">
                  {myMixes.length === 0 ? (
                    <div className="empty-card">Created mixes will appear here.</div>
                  ) : (
                    myMixes.map((mix) => (
                      <article key={mix.id} className="library-card">
                        <p className="track-title">{mix.title}</p>
                        <p className="track-note">{mix.createdAt}</p>
                        <p className="track-note">Vibes: {mix.selectedVibes.join(', ')}</p>
                        <p className="track-note">Runtime: {formatSeconds(mix.plan.totalDurationSeconds)}</p>
                      </article>
                    ))
                  )}
                </div>
              </div>

              <div className="library-column">
                <h3>My tracks</h3>
                <div className="library-list">
                  {tracks.length === 0 ? (
                    <div className="empty-card">Analyzed tracks will appear here.</div>
                  ) : (
                    tracks.map((track) => (
                      <article key={track.id} className="library-card">
                        <div className="track-topline">
                          <p className="track-title">{track.title}</p>
                          <span className="status-pill" data-state={track.analysisStatus}>
                            {track.analysisStatus}
                          </span>
                        </div>
                        {track.analysis ? (
                          <>
                            <p className="track-note">
                              {track.analysis.bpm} BPM · {track.analysis.key} · {formatSeconds(track.analysis.durationSeconds)}
                            </p>
                            <MiniWave slices={track.analysis.slices} />
                          </>
                        ) : null}
                      </article>
                    ))
                  )}
                </div>
              </div>
            </div>
          </section>
        </section>

        <section className="panel plan-panel">
          <div className="section-heading block-heading">
            <div>
              <p className="eyebrow">Latest Mix</p>
              <h2>{mixPlan?.title ?? 'No mix created yet'}</h2>
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
                    </div>
                  </article>
                ))}
              </div>
            </>
          ) : (
            <div className="empty-card">Create a new mix to see the generated running order.</div>
          )}
        </section>
      </main>
    </div>
  );
}

function MiniWave({ slices }: { slices: Array<{ second: number; energy: number; brightness: number }> }) {
  const sampleSize = 24;
  const stride = Math.max(1, Math.floor(slices.length / sampleSize));
  const bars = slices.filter((_, index) => index % stride === 0).slice(0, sampleSize);

  return (
    <div className="mini-wave" aria-hidden="true">
      {bars.map((slice) => (
        <span
          key={slice.second}
          className="mini-wave-bar"
          style={{
            height: `${16 + slice.energy * 44}px`,
            opacity: `${0.45 + slice.brightness * 0.55}`,
          }}
        />
      ))}
    </div>
  );
}

export default App;

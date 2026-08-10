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
  { label: 'Time of day',       vibes: ['Sunrise', 'Morning Coffee', 'Midday Drive', 'Golden Hour', 'Sunset Cruise', 'Blue Hour', 'Late Night', 'After Hours', 'Deep Night'] },
  { label: 'Season & outdoors', vibes: ['Spring Bloom', 'Summer Heat', 'Festival', 'Beach Party', 'Poolside', 'Autumn Rain', 'Winter Chill', 'Cozy Cabin'] },
  { label: 'Genre & sound',     vibes: ['House', 'Techno', 'Drum & Bass', 'Trance', 'Hip-Hop', 'R&B', 'Afrobeats', 'Latin', 'Reggae', 'Jazz', 'Soul', 'Funk', 'Ambient'] },
  { label: 'Mood & energy',     vibes: ['Warm Up', 'Peak Time', 'Hype', 'Uplifting', 'Euphoric', 'Chill', 'Romantic', 'Melancholy', 'Introspective', 'Dark'] },
];

const allVibes: Vibe[] = vibeGroups.flatMap((g) => g.vibes);

interface SongRow { id: string; value: string; file: File | null; }

interface SavedMix {
  id: string;
  title: string;
  createdAt: Date;
  plays: number;
  selectedVibes: Vibe[];
  plan: MixPlan;
}

interface SavedTrack extends TrackInput {
  addedAt: Date;
  plays: number;
}

// Energy scale used to blend multiple vibes into a single resolved profile
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

type MixSortKey   = 'title' | 'createdAt' | 'plays' | 'vibes' | 'runtime';
type TrackSortKey = 'title' | 'addedAt' | 'plays' | 'bpm' | 'key' | 'duration';
type SortDir = 'asc' | 'desc';

function sortMixes(mixes: SavedMix[], key: MixSortKey, dir: SortDir) {
  return [...mixes].sort((a, b) => {
    let cmp = 0;
    if (key === 'title')     cmp = a.title.localeCompare(b.title);
    if (key === 'createdAt') cmp = a.createdAt.getTime() - b.createdAt.getTime();
    if (key === 'plays')     cmp = a.plays - b.plays;
    if (key === 'vibes')     cmp = a.selectedVibes.join().localeCompare(b.selectedVibes.join());
    if (key === 'runtime')   cmp = a.plan.totalDurationSeconds - b.plan.totalDurationSeconds;
    return dir === 'asc' ? cmp : -cmp;
  });
}

function sortTracks(tracks: SavedTrack[], key: TrackSortKey, dir: SortDir) {
  return [...tracks].sort((a, b) => {
    let cmp = 0;
    if (key === 'title')    cmp = a.title.localeCompare(b.title);
    if (key === 'addedAt')  cmp = a.addedAt.getTime() - b.addedAt.getTime();
    if (key === 'plays')    cmp = a.plays - b.plays;
    if (key === 'bpm')      cmp = (a.analysis?.bpm ?? 0) - (b.analysis?.bpm ?? 0);
    if (key === 'key')      cmp = (a.analysis?.key ?? '').localeCompare(b.analysis?.key ?? '');
    if (key === 'duration') cmp = (a.analysis?.durationSeconds ?? 0) - (b.analysis?.durationSeconds ?? 0);
    return dir === 'asc' ? cmp : -cmp;
  });
}

function SortTh({ label, sortKey, current, dir, onClick }: {
  label: string; sortKey: string; current: string; dir: SortDir;
  onClick: (key: string) => void;
}) {
  const active = sortKey === current;
  return (
    <th className={active ? 'sort-th active-th' : 'sort-th'} onClick={() => onClick(sortKey)}>
      {label}
      <span className="sort-arrow">{active ? (dir === 'asc' ? ' ↑' : ' ↓') : ' ↕'}</span>
    </th>
  );
}

function LibraryPage({ mixes, tracks }: { mixes: SavedMix[]; tracks: SavedTrack[] }) {
  const [section, setSection] = useState<'mixes' | 'tracks'>('mixes');
  const [mixSort, setMixSort] = useState<MixSortKey>('createdAt');
  const [mixDir,  setMixDir]  = useState<SortDir>('desc');
  const [trkSort, setTrkSort] = useState<TrackSortKey>('addedAt');
  const [trkDir,  setTrkDir]  = useState<SortDir>('desc');

  const toggleMixSort = (key: string) => {
    const k = key as MixSortKey;
    if (k === mixSort) setMixDir((d) => d === 'asc' ? 'desc' : 'asc');
    else { setMixSort(k); setMixDir('asc'); }
  };
  const toggleTrkSort = (key: string) => {
    const k = key as TrackSortKey;
    if (k === trkSort) setTrkDir((d) => d === 'asc' ? 'desc' : 'asc');
    else { setTrkSort(k); setTrkDir('asc'); }
  };

  const sortedMixes  = useMemo(() => sortMixes(mixes, mixSort, mixDir),   [mixes, mixSort, mixDir]);
  const sortedTracks = useMemo(() => sortTracks(tracks, trkSort, trkDir), [tracks, trkSort, trkDir]);

  return (
    <div className="lib-page">
      <aside className="lib-sidebar">
        <p className="eyebrow">Library</p>
        <button type="button" className={section === 'mixes'  ? 'lib-nav active' : 'lib-nav'} onClick={() => setSection('mixes')}>
          My Mixes <span className="lib-count">{mixes.length}</span>
        </button>
        <button type="button" className={section === 'tracks' ? 'lib-nav active' : 'lib-nav'} onClick={() => setSection('tracks')}>
          My Tracks <span className="lib-count">{tracks.length}</span>
        </button>
      </aside>

      <div className="lib-content">
        {section === 'mixes' && (
          <>
            <h2 className="lib-title">My Mixes</h2>
            {sortedMixes.length === 0 ? (
              <p className="lib-empty">No mixes yet. Create one on the home screen.</p>
            ) : (
              <table className="lib-table">
                <thead>
                  <tr>
                    <SortTh label="Title"      sortKey="title"     current={mixSort} dir={mixDir} onClick={toggleMixSort} />
                    <SortTh label="Date added" sortKey="createdAt" current={mixSort} dir={mixDir} onClick={toggleMixSort} />
                    <SortTh label="Plays"      sortKey="plays"     current={mixSort} dir={mixDir} onClick={toggleMixSort} />
                    <SortTh label="Vibes"      sortKey="vibes"     current={mixSort} dir={mixDir} onClick={toggleMixSort} />
                    <SortTh label="Runtime"    sortKey="runtime"   current={mixSort} dir={mixDir} onClick={toggleMixSort} />
                  </tr>
                </thead>
                <tbody>
                  {sortedMixes.map((mix) => (
                    <tr key={mix.id} className="lib-row">
                      <td className="lib-cell-primary">{mix.title}</td>
                      <td>{mix.createdAt.toLocaleDateString()}</td>
                      <td>{mix.plays}</td>
                      <td className="lib-cell-muted">{mix.selectedVibes.join(', ')}</td>
                      <td>{formatSeconds(mix.plan.totalDurationSeconds)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}

        {section === 'tracks' && (
          <>
            <h2 className="lib-title">My Tracks</h2>
            {sortedTracks.length === 0 ? (
              <p className="lib-empty">No tracks yet. Add songs when creating a mix.</p>
            ) : (
              <table className="lib-table">
                <thead>
                  <tr>
                    <SortTh label="Title"      sortKey="title"    current={trkSort} dir={trkDir} onClick={toggleTrkSort} />
                    <SortTh label="Date added" sortKey="addedAt"  current={trkSort} dir={trkDir} onClick={toggleTrkSort} />
                    <SortTh label="Plays"      sortKey="plays"    current={trkSort} dir={trkDir} onClick={toggleTrkSort} />
                    <SortTh label="BPM"        sortKey="bpm"      current={trkSort} dir={trkDir} onClick={toggleTrkSort} />
                    <SortTh label="Key"        sortKey="key"      current={trkSort} dir={trkDir} onClick={toggleTrkSort} />
                    <SortTh label="Length"     sortKey="duration" current={trkSort} dir={trkDir} onClick={toggleTrkSort} />
                  </tr>
                </thead>
                <tbody>
                  {sortedTracks.map((track) => (
                    <tr key={track.id} className="lib-row">
                      <td className="lib-cell-primary">{track.title}</td>
                      <td>{track.addedAt.toLocaleDateString()}</td>
                      <td>{track.plays}</td>
                      <td>{track.analysis?.bpm ?? '—'}</td>
                      <td>{track.analysis?.key ?? '—'}</td>
                      <td>{track.analysis ? formatSeconds(track.analysis.durationSeconds) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function App() {
  const [view, setView]               = useState<'home' | 'library'>('home');
  const [mixTitle, setMixTitle]       = useState('Friday Roof Set');
  const [targetMinutes, setTargetMinutes] = useState('');
  const [selectedVibes, setSelectedVibes] = useState<Vibe[]>(['Peak Time']);
  const [songRows, setSongRows]       = useState<SongRow[]>([{ id: crypto.randomUUID(), value: '', file: null }]);
  const [myMixes, setMyMixes]         = useState<SavedMix[]>([]);
  const [myTracks, setMyTracks]       = useState<SavedTrack[]>([]);
  const [mixPlan, setMixPlan]         = useState<MixPlan | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isCreatingMix, setIsCreatingMix] = useState(false);

  const runAnalysis = async (track: TrackInput): Promise<TrackInput> => {
    try {
      if (track.source.kind === 'upload') {
        const analysis = await analyzeUploadedTrack(track.source.file);
        return { ...track, analysis, analysisStatus: 'ready' };
      }
      const analysis = analyzeLinkedTrack(track.source.url, track.source.provider);
      return { ...track, analysis, analysisStatus: 'fallback' };
    } catch {
      return { ...track, analysisStatus: 'error' };
    }
  };

  const updateSongRow = (rowId: string, update: (row: SongRow) => SongRow) =>
    setSongRows((cur) => cur.map((r) => r.id === rowId ? update(r) : r));

  const addSongRow = () =>
    setSongRows((cur) => [...cur, { id: crypto.randomUUID(), value: '', file: null }]);

  const removeSongRow = (rowId: string) =>
    setSongRows((cur) => cur.length === 1 ? cur : cur.filter((r) => r.id !== rowId));

  const toggleVibe = (vibe: Vibe) =>
    setSelectedVibes((cur) =>
      cur.includes(vibe)
        ? cur.length === 1 ? cur : cur.filter((v) => v !== vibe)
        : [...cur, vibe],
    );

  const resolveVibes = (vibes: Vibe[]) => {
    if (vibes.length === 1) return vibes[0];
    const avg = vibes.reduce((t, v) => t + vibeScale[v], 0) / vibes.length;
    return allVibes.reduce((best, v) =>
      Math.abs(vibeScale[v] - avg) < Math.abs(vibeScale[best] - avg) ? v : best, allVibes[0]);
  };

  const buildTracksFromRows = () => {
    const filled = songRows.filter((r) => r.file || r.value.trim());
    if (filled.length < 2) throw new Error('Add at least two songs to create a mix.');
    return filled.map((r) => {
      if (r.file) return createUploadTrack(r.file);
      const provider = detectProvider(r.value.trim());
      if (provider === 'unknown') throw new Error('Song links must be from YouTube, Spotify, or SoundCloud.');
      return createLinkTrack(r.value.trim());
    });
  };

  const handleCreateMix = async () => {
    setErrorMessage(null);
    setMixPlan(null);
    if (!selectedVibes.length) { setErrorMessage('Choose at least one vibe.'); return; }
    try {
      setIsCreatingMix(true);
      const draftTracks = buildTracksFromRows();
      const analyzed = await Promise.all(draftTracks.map(runAnalysis));
      const ready = analyzed.filter((t) => t.analysisStatus === 'ready' || t.analysisStatus === 'fallback');
      if (ready.length < 2) throw new Error('At least two songs need to analyze successfully.');

      const parsedTarget = targetMinutes.trim() ? Number(targetMinutes) : undefined;
      const plan = generateMixPlan({
        title: mixTitle,
        vibe: resolveVibes(selectedVibes),
        targetMinutes: parsedTarget && Number.isFinite(parsedTarget) ? parsedTarget : undefined,
        tracks: ready,
      });

      const now = new Date();
      setMixPlan(plan);
      setMyMixes((m) => [{ id: crypto.randomUUID(), title: plan.title, createdAt: now, plays: 0, selectedVibes: [...selectedVibes], plan }, ...m]);
      setMyTracks((existing) => {
        const seen = new Set(existing.map((t) => t.id));
        const fresh = analyzed.filter((t) => !seen.has(t.id)).map((t): SavedTrack => ({ ...t, addedAt: now, plays: 0 }));
        return [...fresh, ...existing];
      });
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
      <div className="ambient ambient-bottom" />

      <nav className="topnav">
        <span className="topnav-logo">mixR</span>
        <div className="topnav-links">
          {view === 'library' && (
            <button type="button" className="topnav-btn" onClick={() => setView('home')}>← Home</button>
          )}
          <button type="button" className={view === 'library' ? 'topnav-lib-btn active' : 'topnav-lib-btn'} onClick={() => setView('library')}>Library</button>
        </div>
      </nav>

      <main className="app-frame">
        {view === 'library' ? (
          <LibraryPage mixes={myMixes} tracks={myTracks} />
        ) : (
          <>
            <section className="hero-block">
              <h1 className="hero-logo">MixR</h1>
              <p className="hero-tagline">Create polished DJ mixes from your tracks.</p>
            </section>

            <section className="panel create-panel">
              <div className="section-heading block-heading">
                <div>
                  <h2>Build the set</h2>
                </div>
              </div>

              <div className="form-stack">
                <label>
                  <span>Mix title</span>
                  <input value={mixTitle} onChange={(e) => setMixTitle(e.target.value)} placeholder="Late rooftop set" />
                </label>

                <label>
                  <span>Target length in minutes <span className="label-optional">(optional)</span></span>
                  <input value={targetMinutes} onChange={(e) => setTargetMinutes(e.target.value)} inputMode="numeric" placeholder="Optional" />
                </label>

                <div className="form-section">
                  <div className="section-heading compact-row">
                    <span>Add songs</span>
                    <button type="button" className="plus-button" onClick={addSongRow}>+</button>
                  </div>
                  <div className="song-list">
                    {songRows.map((row, index) => (
                      <div key={row.id} className="song-row">
                        <input
                          value={row.value}
                          onChange={(e) => updateSongRow(row.id, (r) => ({ ...r, value: e.target.value }))}
                          placeholder={`Song ${index + 1}: paste a link or upload a file →`}
                        />
                        <label className="file-button">
                          <input type="file" accept="audio/*" onChange={(e) => updateSongRow(row.id, (r) => ({ ...r, file: e.target.files?.[0] ?? null }))} />
                          <span>{row.file ? 'Audio selected' : 'Upload'}</span>
                        </label>
                        <button type="button" className="row-remove" onClick={() => removeSongRow(row.id)}>Remove</button>
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
                  <p className="summary-note">Pick as many as you like. The engine blends them into a single profile for sequencing and EQ.</p>
                </div>

                <button type="button" className="generate-button" onClick={handleCreateMix} disabled={isCreatingMix}>
                  {isCreatingMix ? 'Creating mix...' : 'Create new mix'}
                </button>

                {errorMessage ? <p className="error-banner">{errorMessage}</p> : null}
              </div>
            </section>

            {mixPlan && (
              <section className="panel plan-panel">
                <div className="section-heading block-heading">
                  <div>
                    <p className="eyebrow">Latest Mix</p>
                    <h2>{mixPlan.title}</h2>
                  </div>
                  <p>{formatSeconds(mixPlan.totalDurationSeconds)}</p>
                </div>
                <p className="plan-summary">{mixPlan.summary}</p>
                {mixPlan.warnings.map((w) => <p key={w} className="warning-banner">{w}</p>)}
                <div className="plan-track-list">
                  {mixPlan.tracks.map((track, index) => (
                    <article key={track.trackId} className="plan-track-card">
                      <div className="plan-track-index">{String(index + 1).padStart(2, '0')}</div>
                      <div className="plan-track-body">
                        <div className="track-topline">
                          <div>
                            <p className="track-title">{track.title}</p>
                            <p className="track-source">{track.provider} · {track.bpm} BPM · {track.key}</p>
                          </div>
                          <p className="plan-duration">{formatSeconds(track.playDurationSeconds)}</p>
                        </div>
                        <p className="track-note">EQ: {track.eqProfile}</p>
                        <p className="track-note">Play window: {formatSeconds(track.startOffsetSeconds)} to {formatSeconds(track.endOffsetSeconds)}</p>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}

export default App;

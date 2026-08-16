import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, isProbablyUrl, setApiBase, watchJob } from './lib/api';
import { bridge, isDesktop, resolveApiBase } from './lib/bridge';
import { JobProgress } from './components/JobProgress';
import { LibraryView } from './components/LibraryView';
import { MixPlayer } from './components/MixPlayer';
import { SetupBanner } from './components/SetupBanner';
import { emptyRow, SongRows, type SongRow } from './components/SongRows';
import { TitleBar } from './components/TitleBar';
import { GenrePicker } from './components/GenrePicker';
import { VibePicker } from './components/VibePicker';
import { vibeForGenre, type Genre } from './lib/genres';
import {
  looksLikeFullMix,
  parseTargetBpm,
  suggestedTrackCount,
  suggestSearchQueries,
} from './lib/suggestTracks';
import type { LibrarySnapshot, RenderProgress, SearchResult, ToolStatus, TrackRequest, Vibe } from './types';

const EMPTY_LIBRARY: LibrarySnapshot = { mixes: [], tracks: [] };

/** Converts a UI row into a concrete ingest request, or null if it is blank. */
function toRequest(row: SongRow, provider: 'youtube' | 'soundcloud'): TrackRequest | null {
  if (row.localPath) return { kind: 'local', path: row.localPath };
  if (row.picked) return { kind: 'link', url: row.picked.webpageUrl };

  const text = row.text.trim();
  if (!text) return null;
  if (isProbablyUrl(text)) return { kind: 'link', url: text };
  return { kind: 'query', query: text, provider };
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
  const [view, setView] = useState<'home' | 'library'>('home');
  const [isLight, setIsLight] = useState(false);

  const [tools, setTools] = useState<ToolStatus | null>(null);
  const [library, setLibrary] = useState<LibrarySnapshot>(EMPTY_LIBRARY);

  const [title, setTitle] = useState('');
  const [targetMinutes, setTargetMinutes] = useState('');
  const [targetBpm, setTargetBpm] = useState('');
  const [provider, setProvider] = useState<'youtube' | 'soundcloud'>('youtube');
  const [genre, setGenre] = useState<Genre | null>(null);
  const [vibes, setVibes] = useState<Vibe[]>(['Peak Time']);
  const [rows, setRows] = useState<SongRow[]>([emptyRow(), emptyRow()]);

  const [job, setJob] = useState<RenderProgress | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [finding, setFinding] = useState(false);
  const [dragging, setDragging] = useState(false);
  const unwatchRef = useRef<(() => void) | null>(null);

  const refreshLibrary = useCallback(() => {
    api
      .library()
      .then(setLibrary)
      .catch(() => undefined);
  }, []);

  const refreshTools = useCallback(() => {
    api
      .tools()
      .then(setTools)
      .catch(() => undefined);
  }, []);

  /**
   * Boot only waits for the API base, which is a single IPC round trip. Checking
   * the toolchain means probing yt-dlp, which can take seconds on a cold start,
   * so it runs in the background rather than holding the window on a splash.
   */
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        setApiBase(await resolveApiBase());
        if (cancelled) return;
        setReady(true);

        // Confirm the API is actually answering before trusting the UI.
        await api.health();
        if (cancelled) return;

        refreshLibrary();
        refreshTools();
      } catch (error) {
        if (!cancelled) setBootError(error instanceof Error ? error.message : String(error));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [refreshLibrary, refreshTools]);

  useEffect(() => {
    document.body.dataset.theme = isLight ? 'light' : 'dark';
  }, [isLight]);

  useEffect(() => () => unwatchRef.current?.(), []);

  const requests = useMemo(
    () => rows.map((row) => toRequest(row, provider)).filter((entry): entry is TrackRequest => entry !== null),
    [rows, provider],
  );

  const busy = job !== null && job.stage !== 'done' && job.stage !== 'error';
  const formLocked = busy || finding;
  // A null `tools` means the probe is still running, not that yt-dlp is missing,
  // so it must not block the button on a cold start.
  const downloadsUsable = tools === null || tools.ytdlp.ready || allLocal(requests);
  const canBuild = requests.length >= 1 && vibes.length > 0 && !formLocked && downloadsUsable;

  const pickFiles = async () => {
    const desktop = bridge();
    if (!desktop) {
      setFormError('Adding files from disk needs the desktop app.');
      return;
    }
    const files = await desktop.chooseAudioFiles();
    if (files.length === 0) return;
    addLocalFiles(files);
  };

  const addLocalFiles = (paths: string[]) => {
    const additions: SongRow[] = paths.map((filePath) => ({
      id: crypto.randomUUID(),
      text: '',
      localPath: filePath,
      localName: filePath.split('/').pop() ?? filePath,
    }));

    setRows((current) => {
      // Fill blank rows first so dropping files does not leave gaps.
      const blanks = current.filter((row) => !row.text.trim() && !row.localPath && !row.picked);
      const kept = current.filter((row) => row.text.trim() || row.localPath || row.picked);
      const filled = [...kept, ...additions];
      return blanks.length > additions.length ? [...filled, ...blanks.slice(additions.length)] : filled;
    });
  };

  const applyPlaylist = (listing: { title: string; truncated: boolean; limit: number; results: SearchResult[] }) => {
    const additions: SongRow[] = listing.results.map((result) => ({
      id: crypto.randomUUID(),
      text: result.title,
      picked: result,
    }));

    setRows((current) => {
      const kept = current.filter((row) => row.text.trim() || row.localPath || row.picked);
      return kept.length > 0 ? [...kept, ...additions] : additions;
    });
    setTitle((current) => (current.trim() ? current : listing.title));
    setFormError(
      listing.truncated
        ? `Loaded the first ${listing.results.length} tracks (playlists are capped at ${listing.limit}).`
        : null,
    );
  };

  const onDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setDragging(false);

    const desktop = bridge();
    const files = Array.from(event.dataTransfer.files);
    if (files.length > 0 && desktop) {
      const paths = files.map((file) => desktop.pathForFile(file)).filter(Boolean);
      if (paths.length > 0) {
        addLocalFiles(paths);
        return;
      }
    }

    const text = event.dataTransfer.getData('text/plain').trim();
    if (isProbablyUrl(text)) {
      setRows((current) => [...current.filter((row) => row.text.trim() || row.localPath || row.picked), { id: crypto.randomUUID(), text }]);
      return;
    }

    if (files.length > 0 && !desktop) setFormError('Dropping files needs the desktop app.');
  };

  const build = () => {
    setFormError(null);

    if (requests.length === 0) {
      setFormError('Add at least one song.');
      return;
    }
    if (vibes.length === 0) {
      setFormError('Choose at least one vibe.');
      return;
    }

    const minutes = Number(targetMinutes);
    const payload = {
      title: title.trim() || 'Untitled mix',
      vibes,
      targetMinutes: Number.isFinite(minutes) && minutes > 0 ? minutes : undefined,
      targetBpm: parseTargetBpm(targetBpm),
      tracks: requests,
    };

    api
      .createMix(payload)
      .then(({ jobId }) => {
        setJob({
          jobId,
          stage: 'queued',
          progress: 0,
          message: 'Getting ready',
          tracks: requests.map((request) => ({
            label: request.kind === 'query' ? request.query : request.kind === 'link' ? request.url : request.path,
            status: 'pending' as const,
          })),
        });

        unwatchRef.current?.();
        unwatchRef.current = watchJob(
          jobId,
          (state) => setJob(state),
          (state) => {
            setJob(state);
            if (state.stage === 'done') {
              refreshLibrary();
              refreshTools();
            }
          },
        );
      })
      .catch((error: unknown) => setFormError(error instanceof Error ? error.message : String(error)));
  };

  const findSongs = async () => {
    if (!genre && vibes.length === 0) {
      setFormError('Choose a genre first.');
      return;
    }
    if (tools && !tools.ytdlp.ready) {
      setFormError('Finish the one-time setup above to search for songs.');
      return;
    }

    const minutes = Number(targetMinutes);
    const bpm = parseTargetBpm(targetBpm);
    const filled = rows.filter((row) => row.text.trim() || row.localPath || row.picked);
    const want = suggestedTrackCount(Number.isFinite(minutes) && minutes > 0 ? minutes : undefined);
    const stillNeed = Math.max(0, want - filled.length);
    if (stillNeed === 0) {
      setFormError(`You already have ${filled.length} songs. Remove some if you want mixR to find replacements.`);
      return;
    }

    setFormError(null);
    setFinding(true);

    const seen = new Set<string>();
    for (const row of filled) {
      if (row.picked?.webpageUrl) seen.add(row.picked.webpageUrl);
      const label = (row.picked?.title ?? row.localName ?? row.text).trim().toLowerCase();
      if (label) seen.add(label);
    }

    const queries = suggestSearchQueries({
      genre: genre ?? undefined,
      vibes,
      title,
      existingTitles: filled.map((row) => row.picked?.title ?? row.localName ?? row.text.trim()).filter(Boolean),
      targetBpm: bpm,
    });

    try {
      const found: SearchResult[] = [];
      for (const query of queries) {
        if (found.length >= stillNeed) break;
        const results = await api.search(query, provider);
        for (const result of results) {
          if (found.length >= stillNeed) break;
          if (looksLikeFullMix(result.title, result.durationSeconds)) continue;
          const titleKey = result.title.trim().toLowerCase();
          if (seen.has(result.webpageUrl) || seen.has(titleKey)) continue;
          seen.add(result.webpageUrl);
          seen.add(titleKey);
          found.push(result);
        }
      }

      if (found.length === 0) {
        setFormError('Could not find songs for that genre. Try another one, or add a mix name or BPM.');
        return;
      }

      setRows((current) => {
        const kept = current.filter((row) => row.text.trim() || row.localPath || row.picked);
        const additions: SongRow[] = found.map((result) => ({
          id: crypto.randomUUID(),
          text: result.title,
          picked: result,
        }));
        return kept.length > 0 ? [...kept, ...additions] : additions;
      });
    } catch (error) {
      setFormError(error instanceof Error ? error.message : String(error));
    } finally {
      setFinding(false);
    }
  };

  const cancel = () => {
    if (job) void api.cancelJob(job.jobId).catch(() => undefined);
  };

  const startOver = () => {
    unwatchRef.current?.();
    unwatchRef.current = null;
    setJob(null);
    setRows([emptyRow(), emptyRow()]);
    setTitle('');
  };

  if (bootError) {
    return (
      <div className="app-shell">
        <main className="content">
          <section className="panel">
            <p className="eyebrow">Cannot reach the audio service</p>
            <h2>mixR could not start</h2>
            <p className="summary-note">{bootError}</p>
            <p className="summary-note">
              {isDesktop()
                ? 'Try quitting and reopening mixR.'
                : 'Start the API with npm run dev:api, or use the desktop app.'}
            </p>
          </section>
        </main>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="app-shell">
        <main className="content">
          <p className="summary-note loading-note">Starting mixR…</p>
        </main>
      </div>
    );
  }

  const finishedMix = job?.stage === 'done' ? job.mix : undefined;

  return (
    <div className={dragging ? 'app-shell dragging' : 'app-shell'}>
      <TitleBar view={view} onNavigate={setView} onToggleTheme={() => setIsLight((value) => !value)} isLight={isLight} />

      <main className="content">
        {view === 'library' ? (
          <LibraryView library={library} onRefresh={refreshLibrary} />
        ) : (
          <div
            className="stack"
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            <header className="hero">
              <h1>Make a real mix from songs you name.</h1>
              <p>
                Name the songs, paste a playlist, drop in links or files. mixR fetches the audio, measures tempo, key,
                and loudness, sequences the set, and renders one continuous crossfaded MP3.
              </p>
            </header>

            {tools ? <SetupBanner tools={tools} onInstalled={refreshTools} /> : null}

            {finishedMix ? (
              <>
                <MixPlayer mix={finishedMix} />
                <div className="center-row">
                  <button type="button" className="generate-button" onClick={startOver}>
                    Build another mix
                  </button>
                </div>
              </>
            ) : job ? (
              <>
                <JobProgress job={job} onCancel={cancel} />
                {job.stage === 'error' ? (
                  <div className="center-row">
                    <button type="button" className="generate-button" onClick={() => setJob(null)}>
                      Try again
                    </button>
                  </div>
                ) : null}
              </>
            ) : (
              <section className="panel builder-panel">
                <div className="form-grid">
                  <label className="field">
                    <span>Mix name</span>
                    <input
                      value={title}
                      onChange={(event) => setTitle(event.target.value)}
                      placeholder="Friday night set"
                    />
                  </label>

                  <label className="field">
                    <span>Target length (minutes, optional)</span>
                    <input
                      value={targetMinutes}
                      onChange={(event) => setTargetMinutes(event.target.value.replace(/[^\d.]/g, ''))}
                      inputMode="decimal"
                      placeholder="Leave blank to use full songs"
                    />
                  </label>

                  <label className="field">
                    <span>Target BPM (optional)</span>
                    <input
                      value={targetBpm}
                      onChange={(event) => setTargetBpm(event.target.value.replace(/[^\d.]/g, ''))}
                      inputMode="decimal"
                      placeholder="e.g. 128"
                    />
                  </label>

                  <div className="field">
                    <span>Search source</span>
                    <div className="segmented">
                      {(['youtube', 'soundcloud'] as const).map((option) => (
                        <button
                          key={option}
                          type="button"
                          className={provider === option ? 'segment active' : 'segment'}
                          onClick={() => setProvider(option)}
                        >
                          {option === 'youtube' ? 'YouTube' : 'SoundCloud'}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <GenrePicker
                  selected={genre}
                  onChange={(next) => {
                    const previous = genre ? vibeForGenre(genre) : undefined;
                    const mapped = next ? vibeForGenre(next) : undefined;
                    setGenre(next);
                    setVibes((current) => {
                      let nextVibes = previous && previous !== mapped ? current.filter((vibe) => vibe !== previous) : current;
                      if (mapped && !nextVibes.includes(mapped)) nextVibes = [...nextVibes, mapped];
                      return nextVibes.length > 0 ? nextVibes : ['Peak Time'];
                    });
                  }}
                  onFindSongs={() => void findSongs()}
                  finding={finding}
                  disabled={formLocked}
                />

                <SongRows
                  rows={rows}
                  provider={provider}
                  onChange={setRows}
                  onPickFiles={pickFiles}
                  onPlaylistLoaded={applyPlaylist}
                  disabled={formLocked}
                />

                <VibePicker selected={vibes} onChange={setVibes} disabled={formLocked} />

                {formError ? <p className="error-banner">{formError}</p> : null}

                <div className="center-row">
                  <button type="button" className="generate-button" onClick={build} disabled={!canBuild}>
                    Build the mix
                  </button>
                </div>

                {tools && !tools.ytdlp.ready && !allLocal(requests) ? (
                  <p className="summary-note center-text">
                    Finish the one-time setup above to search and download songs.
                  </p>
                ) : null}
              </section>
            )}

            {library.mixes.length > 0 && !job ? (
              <section className="panel">
                <div className="section-heading block-heading">
                  <div>
                    <p className="eyebrow">Recent</p>
                    <h2>Your mixes</h2>
                  </div>
                  <button type="button" className="ghost-button" onClick={() => setView('library')}>
                    Open library
                  </button>
                </div>
                <ul className="library-list">
                  {library.mixes.slice(0, 3).map((mix) => (
                    <li key={mix.id}>
                      <button type="button" className="library-row" onClick={() => setView('library')}>
                        <span className="library-body">
                          <span className="library-title">{mix.title}</span>
                          <span className="library-meta">
                            {mix.plan.tracks.length} tracks · {mix.vibes.join(', ')}
                          </span>
                        </span>
                        <span className="library-duration">{Math.round(mix.durationSeconds / 60)} min</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        )}
      </main>

      {dragging ? <div className="drop-overlay">Drop songs to add them</div> : null}
    </div>
  );
}

const allLocal = (requests: TrackRequest[]) => requests.length > 0 && requests.every((request) => request.kind === 'local');

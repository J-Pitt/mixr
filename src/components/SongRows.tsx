import { useEffect, useRef, useState } from 'react';
import { api, isProbablyUrl } from '../lib/api';
import { formatSeconds } from '../lib/mixEngine';
import type { SearchResult } from '../types';

export interface SongRow {
  id: string;
  text: string;
  picked?: SearchResult;
  localPath?: string;
  localName?: string;
}

export const emptyRow = (): SongRow => ({ id: crypto.randomUUID(), text: '' });

interface SongRowsProps {
  rows: SongRow[];
  provider: 'youtube' | 'soundcloud';
  onChange: (rows: SongRow[]) => void;
  onPickFiles: () => void;
  disabled: boolean;
}

const providerLabel: Record<string, string> = {
  youtube: 'YouTube',
  soundcloud: 'SoundCloud',
  spotify: 'Spotify',
  local: 'File',
  unknown: 'Link',
};

export function SongRows({ rows, provider, onChange, onPickFiles, disabled }: SongRowsProps) {
  const update = (id: string, patch: Partial<SongRow>) =>
    onChange(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));

  const remove = (id: string) => onChange(rows.length === 1 ? [emptyRow()] : rows.filter((row) => row.id !== id));

  const add = () => onChange([...rows, emptyRow()]);

  return (
    <div className="form-section">
      <div className="section-heading compact-row">
        <span>Add songs</span>
        <div className="row-actions">
          <button type="button" className="ghost-button" onClick={onPickFiles} disabled={disabled}>
            Add files
          </button>
          <button type="button" className="plus-button" onClick={add} disabled={disabled} aria-label="Add another song">
            +
          </button>
        </div>
      </div>

      <div className="song-list">
        {rows.map((row, index) => (
          <SongRowItem
            key={row.id}
            row={row}
            index={index}
            provider={provider}
            disabled={disabled}
            onUpdate={(patch) => update(row.id, patch)}
            onRemove={() => remove(row.id)}
          />
        ))}
      </div>

      <p className="summary-note">
        Type a song name and pick from the results, paste a YouTube, SoundCloud, or Spotify link, or add files from your
        Mac. Anything you leave as plain text is searched on {providerLabel[provider]} when the mix is built.
      </p>
    </div>
  );
}

interface SongRowItemProps {
  row: SongRow;
  index: number;
  provider: 'youtube' | 'soundcloud';
  disabled: boolean;
  onUpdate: (patch: Partial<SongRow>) => void;
  onRemove: () => void;
}

function SongRowItem({ row, index, provider, disabled, onUpdate, onRemove }: SongRowItemProps) {
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef<AbortController | null>(null);

  const query = row.text.trim();
  const isLink = isProbablyUrl(query);
  const settled = Boolean(row.picked || row.localPath);

  // Debounced search. Skipped for links and for rows that already have a choice.
  useEffect(() => {
    if (settled || isLink || query.length < 3) {
      setResults([]);
      setSearching(false);
      return;
    }

    const timer = window.setTimeout(() => {
      requestRef.current?.abort();
      const controller = new AbortController();
      requestRef.current = controller;

      setSearching(true);
      setError(null);
      api
        .search(query, provider, controller.signal)
        .then((found) => {
          if (controller.signal.aborted) return;
          setResults(found);
          setOpen(found.length > 0);
        })
        .catch((caught: unknown) => {
          if (controller.signal.aborted || (caught as Error).name === 'AbortError') return;
          setError(caught instanceof Error ? caught.message : 'Search failed');
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false);
        });
    }, 350);

    return () => window.clearTimeout(timer);
  }, [query, provider, settled, isLink]);

  useEffect(() => () => requestRef.current?.abort(), []);

  // Close the result list when focus moves elsewhere.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  const choose = (result: SearchResult) => {
    onUpdate({ picked: result, text: result.title, localPath: undefined, localName: undefined });
    setOpen(false);
    setResults([]);
  };

  const clear = () => {
    onUpdate({ picked: undefined, localPath: undefined, localName: undefined, text: '' });
    setResults([]);
  };

  if (row.localPath) {
    return (
      <div className="song-row settled">
        <div className="song-chip">
          <span className="provider-badge" data-provider="local">
            File
          </span>
          <span className="song-chip-title">{row.localName ?? row.localPath}</span>
        </div>
        <button type="button" className="row-remove" onClick={clear} disabled={disabled}>
          Clear
        </button>
        <button type="button" className="row-remove" onClick={onRemove} disabled={disabled}>
          Remove
        </button>
      </div>
    );
  }

  if (row.picked) {
    const picked = row.picked;
    return (
      <div className="song-row settled">
        <div className="song-chip">
          {picked.thumbnail ? <img className="song-thumb" src={picked.thumbnail} alt="" loading="lazy" /> : null}
          <span className="provider-badge" data-provider={picked.provider}>
            {providerLabel[picked.provider] ?? picked.provider}
          </span>
          <span className="song-chip-title">{picked.title}</span>
          <span className="song-chip-meta">
            {picked.artist ? `${picked.artist} · ` : ''}
            {picked.durationSeconds ? formatSeconds(picked.durationSeconds) : ''}
          </span>
        </div>
        <button type="button" className="row-remove" onClick={clear} disabled={disabled}>
          Change
        </button>
        <button type="button" className="row-remove" onClick={onRemove} disabled={disabled}>
          Remove
        </button>
      </div>
    );
  }

  return (
    <div className="song-row" ref={containerRef}>
      <div className="song-input-wrap">
        <input
          value={row.text}
          disabled={disabled}
          onChange={(event) => onUpdate({ text: event.target.value })}
          onFocus={() => setOpen(results.length > 0)}
          placeholder={`Song ${index + 1}: type a name or paste a link`}
          aria-label={`Song ${index + 1}`}
        />
        {isLink ? <span className="input-badge">link</span> : null}
        {searching ? <span className="input-spinner" aria-label="Searching" /> : null}

        {open && results.length > 0 ? (
          <ul className="search-results">
            {results.map((result) => (
              <li key={`${result.provider}-${result.sourceId}`}>
                <button type="button" className="search-result" onClick={() => choose(result)}>
                  {result.thumbnail ? (
                    <img className="search-thumb" src={result.thumbnail} alt="" loading="lazy" />
                  ) : (
                    <span className="search-thumb placeholder" />
                  )}
                  <span className="search-body">
                    <span className="search-title">{result.title}</span>
                    <span className="search-meta">
                      {result.artist ?? 'Unknown artist'}
                      {result.durationSeconds ? ` · ${formatSeconds(result.durationSeconds)}` : ''}
                    </span>
                  </span>
                  <span className="provider-badge" data-provider={result.provider}>
                    {providerLabel[result.provider] ?? result.provider}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <button type="button" className="row-remove" onClick={onRemove} disabled={disabled}>
        Remove
      </button>

      {error ? <p className="row-meta row-error">{error}</p> : null}
    </div>
  );
}

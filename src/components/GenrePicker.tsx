import { GENRES, type Genre } from '../lib/genres';

interface GenrePickerProps {
  selected: Genre | null;
  onChange: (genre: Genre | null) => void;
  onFindSongs: () => void;
  finding: boolean;
  disabled: boolean;
}

export function GenrePicker({ selected, onChange, onFindSongs, finding, disabled }: GenrePickerProps) {
  return (
    <div className="form-section">
      <div className="section-heading compact-row">
        <span>Genre</span>
        <div className="row-actions">
          <button
            type="button"
            className="ghost-button"
            onClick={onFindSongs}
            disabled={disabled || finding || !selected}
          >
            {finding ? 'Finding songs…' : 'Find songs'}
          </button>
          {selected ? (
            <button type="button" className="ghost-button" onClick={() => onChange(null)} disabled={disabled || finding}>
              Clear
            </button>
          ) : null}
        </div>
      </div>

      <div className="vibe-grid">
        {GENRES.map((genre) => (
          <button
            key={genre}
            type="button"
            className={selected === genre ? 'vibe-chip selected' : 'vibe-chip'}
            onClick={() => onChange(selected === genre ? null : genre)}
            disabled={disabled}
          >
            {genre}
          </button>
        ))}
      </div>

      <p className="summary-note">
        Pick a genre, then Find songs. Searches also use the mix name, BPM, vibe, and anything already in the list.
      </p>
    </div>
  );
}

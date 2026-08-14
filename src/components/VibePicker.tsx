import { allVibes, vibeProfiles } from '../lib/mixEngine';
import type { Vibe } from '../types';

const GROUPS: { label: string; vibes: Vibe[] }[] = [
  {
    label: 'Time of day',
    vibes: ['Warm Up', 'Sunrise', 'Morning Coffee', 'Midday Drive', 'Golden Hour', 'Sunset Cruise', 'Blue Hour', 'Peak Time', 'Late Night', 'After Hours', 'Deep Night'],
  },
  {
    label: 'Season & outdoors',
    vibes: ['Spring Bloom', 'Summer Heat', 'Festival', 'Beach Party', 'Poolside', 'Autumn Rain', 'Winter Chill', 'Cozy Cabin'],
  },
  {
    label: 'Genre & sound',
    vibes: ['House', 'Techno', 'Ambient', 'Hip-Hop', 'R&B', 'Afrobeats', 'Latin', 'Reggae', 'Jazz', 'Soul', 'Funk', 'Drum & Bass', 'Trance'],
  },
  {
    label: 'Mood & energy',
    vibes: ['Chill', 'Hype', 'Melancholy', 'Euphoric', 'Romantic', 'Introspective', 'Dark', 'Uplifting'],
  },
];

interface VibePickerProps {
  selected: Vibe[];
  onChange: (vibes: Vibe[]) => void;
  disabled: boolean;
}

export function VibePicker({ selected, onChange, disabled }: VibePickerProps) {
  const toggle = (vibe: Vibe) => {
    onChange(selected.includes(vibe) ? selected.filter((entry) => entry !== vibe) : [...selected, vibe]);
  };

  // Guard against a vibe being added to the profiles but missed in a group.
  const grouped = new Set(GROUPS.flatMap((group) => group.vibes));
  const ungrouped = allVibes.filter((vibe) => !grouped.has(vibe));
  const groups = ungrouped.length > 0 ? [...GROUPS, { label: 'More', vibes: ungrouped }] : GROUPS;

  return (
    <div className="form-section">
      <div className="section-heading compact-row">
        <span>Vibe</span>
        {selected.length > 0 ? (
          <button type="button" className="ghost-button" onClick={() => onChange([])} disabled={disabled}>
            Clear
          </button>
        ) : null}
      </div>

      {groups.map((group) => (
        <div key={group.label} className="vibe-group">
          <p className="vibe-group-label">{group.label}</p>
          <div className="vibe-grid">
            {group.vibes.map((vibe) => (
              <button
                key={vibe}
                type="button"
                className={selected.includes(vibe) ? 'vibe-chip selected' : 'vibe-chip'}
                onClick={() => toggle(vibe)}
                disabled={disabled}
                title={vibeProfiles[vibe].eq}
              >
                {vibe}
              </button>
            ))}
          </div>
        </div>
      ))}

      {selected.length > 0 ? (
        <p className="summary-note">
          {selected.length === 1
            ? vibeProfiles[selected[0]].eq
            : `Blending ${selected.length} vibes: transitions use a ${vibeProfiles[selected[0]].transitionStyle}, and EQ follows the strongest match.`}
        </p>
      ) : (
        <p className="summary-note">Pick at least one vibe. It drives the running order, blend lengths, and EQ.</p>
      )}
    </div>
  );
}

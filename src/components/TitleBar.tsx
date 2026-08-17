import { isDesktop } from '../lib/bridge';
import { InstallAppButton } from './InstallAppButton';
import { ShareEmailButton } from './ShareEmailButton';

interface TitleBarProps {
  view: 'home' | 'library';
  onNavigate: (view: 'home' | 'library') => void;
  onToggleTheme: () => void;
  isLight: boolean;
}

/**
 * Doubles as the window's drag region on macOS, where the traffic lights are
 * inset over the app rather than in a separate title bar.
 */
export function TitleBar({ view, onNavigate, onToggleTheme, isLight }: TitleBarProps) {
  return (
    <nav className={isDesktop() ? 'topnav topnav-desktop' : 'topnav'}>
      <div className="topnav-left">
        {view === 'library' && (
          <button type="button" className="topnav-btn" onClick={() => onNavigate('home')}>
            ← Home
          </button>
        )}
      </div>

      <button type="button" className="topnav-logo" onClick={() => onNavigate('home')}>
        mixR
      </button>

      <div className="topnav-right">
        <InstallAppButton />
        <ShareEmailButton />
        <button
          type="button"
          className={view === 'library' ? 'topnav-lib-btn active' : 'topnav-lib-btn'}
          onClick={() => onNavigate('library')}
        >
          Library
        </button>
        <button
          type="button"
          className="theme-toggle"
          onClick={onToggleTheme}
          aria-label={isLight ? 'Switch to dark mode' : 'Switch to light mode'}
          title={isLight ? 'Switch to dark mode' : 'Switch to light mode'}
        >
          {isLight ? '☾' : '☀'}
        </button>
      </div>
    </nav>
  );
}

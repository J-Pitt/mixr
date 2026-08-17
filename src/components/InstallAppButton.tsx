import { useEffect, useState } from 'react';
import { isDesktop } from '../lib/bridge';
import { isStandaloneApp } from '../lib/webApp';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function InstallAppButton() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  useEffect(() => {
    if (isDesktop() || isStandaloneApp()) return;

    const onPrompt = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  if (isDesktop() || isStandaloneApp()) return null;

  const install = async () => {
    if (installEvent) {
      await installEvent.prompt();
      const choice = await installEvent.userChoice;
      if (choice.outcome === 'accepted') setInstallEvent(null);
      return;
    }

    const iOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    setHint(
      iOS
        ? 'On iPhone: tap Share, then Add to Home Screen.'
        : 'In the browser menu, choose Install app or Add to Home Screen.',
    );
  };

  return (
    <span className="share-email">
      <button type="button" className="topnav-lib-btn" onClick={() => void install()}>
        Install app
      </button>
      {hint ? <span className="share-email-note">{hint}</span> : null}
    </span>
  );
}

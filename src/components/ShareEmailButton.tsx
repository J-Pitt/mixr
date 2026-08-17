import { useState } from 'react';
import { api } from '../lib/api';
import { emailShareHref, type ShareInfo } from '../lib/shareLink';

interface ShareEmailButtonProps {
  title?: string;
  path?: string;
  className?: string;
}

export function ShareEmailButton({ title = 'mixR', path = '', className = 'topnav-lib-btn' }: ShareEmailButtonProps) {
  const [note, setNote] = useState<string | null>(null);

  const share = async () => {
    setNote(null);
    try {
      const info = await api.share();
      const withPath: ShareInfo = {
        ...info,
        shareUrl: `${info.shareUrl.replace(/\/$/, '')}${path}`,
        lanUrls: info.lanUrls.map((url) => `${url.replace(/\/$/, '')}${path}`),
        localUrl: `${info.localUrl.replace(/\/$/, '')}${path}`,
      };
      window.location.href = emailShareHref(withPath, title);
      setNote(
        info.listeningOnLan
          ? `Opened Mail with ${withPath.shareUrl}`
          : 'Opened Mail. That link only works on this computer — run npm run web to share on Wi-Fi.',
      );
    } catch (error) {
      setNote(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <span className="share-email">
      <button type="button" className={className} onClick={() => void share()}>
        Email link
      </button>
      {note ? <span className="share-email-note">{note}</span> : null}
    </span>
  );
}

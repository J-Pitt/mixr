export interface ShareInfo {
  localUrl: string;
  lanUrls: string[];
  shareUrl: string;
  listeningOnLan: boolean;
}

export function emailShareHref(info: ShareInfo, title = 'mixR'): string {
  const extra =
    info.lanUrls.length > 1 ? `\n\nOther addresses on this machine:\n${info.lanUrls.slice(1).join('\n')}` : '';
  const note = info.listeningOnLan
    ? 'Open it on the same Wi-Fi. Leave mixR running on the computer that sent this.'
    : 'This link only works on the computer that is running mixR.';
  const body = `${title}\n\n${info.shareUrl}\n\n${note}${extra}`;
  return `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
}

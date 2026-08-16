/** True for YouTube playlists, SoundCloud sets, and Spotify playlists or albums. */
export function isPlaylistUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;

    const host = parsed.hostname.replace(/^(www|m)\./i, '').toLowerCase();
    const pathname = parsed.pathname;

    if (host === 'soundcloud.com' || host.endsWith('.soundcloud.com')) {
      return /\/sets\/[^/]+/.test(pathname);
    }

    if (host === 'open.spotify.com' || host === 'play.spotify.com' || host.endsWith('.spotify.com')) {
      return /\/(playlist|album)\//.test(pathname);
    }

    const youtube =
      host === 'youtube.com' ||
      host === 'youtu.be' ||
      host === 'music.youtube.com' ||
      host.endsWith('.youtube.com');
    if (!youtube) return false;

    if (pathname.includes('/playlist')) return true;
    const list = parsed.searchParams.get('list') ?? '';
    return /^(PL|OL|UU|FL)/i.test(list);
  } catch {
    return false;
  }
}

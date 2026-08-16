import { describe, expect, it } from 'vitest';
import { listingFromDump } from '../server/lib/ytdlp.js';
import { isPlaylistUrl } from '../src/lib/playlistUrl.js';

describe('isPlaylistUrl', () => {
  it.each([
    'https://www.youtube.com/playlist?list=PLrAXtmRdnEQy6nuLMOVlRhZVKCYxqLypQ',
    'https://youtube.com/playlist?list=PLtest',
    'https://music.youtube.com/playlist?list=OLAK5uy_example',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLrAXtmRdnEQy6nuLMOVlRhZVKCYxqLypQ',
    'https://m.youtube.com/playlist?list=PLtest',
    'https://soundcloud.com/artist/sets/late-night-drive',
    'https://m.soundcloud.com/artist/sets/late-night-drive/',
    'https://www.soundcloud.com/dj/sets/festival-warmup',
    'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M',
    'https://open.spotify.com/intl-de/playlist/37i9dQZF1DXcBWIGoYBM5M',
    'https://open.spotify.com/album/4m2880jivSbbyEGAKfITCa',
  ])('recognizes %s', (url) => {
    expect(isPlaylistUrl(url)).toBe(true);
  });

  it.each([
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://youtu.be/dQw4w9WgXcQ',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=RDxxxxxxxx',
    'https://soundcloud.com/artist/a-single-track',
    'https://open.spotify.com/track/5nTtCOCds6I0PHMNtqelas',
    'https://example.com/sets/not-soundcloud',
    'not a url',
    '',
  ])('rejects %s', (url) => {
    expect(isPlaylistUrl(url)).toBe(false);
  });
});

describe('listingFromDump', () => {
  it('keeps SoundCloud set entries that have a URL but no title', () => {
    const listing = listingFromDump(
      {
        _type: 'playlist',
        title: "People's Instinctive Travels",
        entries: [
          {
            _type: 'url_transparent',
            id: '253198726',
            title: null,
            url: 'https://soundcloud.com/a-tribe-called-quest-official/push-it-along',
            ie_key: 'Soundcloud',
          },
          {
            _type: 'url_transparent',
            id: '253200102',
            title: null,
            url: 'https://soundcloud.com/a-tribe-called-quest-official/luck-of-lucien',
            ie_key: 'Soundcloud',
          },
        ],
      },
      'https://soundcloud.com/a-tribe-called-quest-official/sets/peoples-instinctive-travels-2',
    );

    expect(listing.title).toBe("People's Instinctive Travels");
    expect(listing.tracks).toEqual([
      expect.objectContaining({
        title: 'push it along',
        webpageUrl: 'https://soundcloud.com/a-tribe-called-quest-official/push-it-along',
        provider: 'soundcloud',
      }),
      expect.objectContaining({
        title: 'luck of lucien',
        webpageUrl: 'https://soundcloud.com/a-tribe-called-quest-official/luck-of-lucien',
        provider: 'soundcloud',
      }),
    ]);
  });

  it('builds YouTube watch URLs from flat playlist ids', () => {
    const listing = listingFromDump(
      {
        _type: 'playlist',
        title: 'Hits',
        entries: [{ _type: 'url', id: 'ekr2nIex040', title: 'APT.', ie_key: 'Youtube', url: 'ekr2nIex040' }],
      },
      'https://www.youtube.com/playlist?list=PLtest',
    );

    expect(listing.tracks[0]).toEqual(
      expect.objectContaining({
        title: 'APT.',
        webpageUrl: 'https://www.youtube.com/watch?v=ekr2nIex040',
        provider: 'youtube',
      }),
    );
  });
});

import { describe, expect, it } from 'vitest';
import { parseTrackRequest } from '../server/index.js';

describe('parseTrackRequest — rejections', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a number', 42],
    ['zero', 0],
    ['a bare string', 'https://example.com/song'],
    ['an empty string', ''],
    ['a boolean', true],
    ['an empty array', []],
    ['an array of strings', ['https://example.com/song']],
    ['an empty object', {}],
  ])('rejects %s', (_label, input) => {
    expect(parseTrackRequest(input)).toBeNull();
  });

  it.each([
    ['empty', ''],
    ['whitespace-only', '   '],
    ['tab and newline only', '\t\n'],
  ])('rejects a %s value in every shape', (_label, value) => {
    expect(parseTrackRequest({ kind: 'local', path: value })).toBeNull();
    expect(parseTrackRequest({ kind: 'query', query: value })).toBeNull();
    expect(parseTrackRequest({ kind: 'link', url: value })).toBeNull();
    expect(parseTrackRequest({ value })).toBeNull();
  });

  it('rejects a shape whose payload is the wrong type', () => {
    expect(parseTrackRequest({ kind: 'local', path: 12 })).toBeNull();
    expect(parseTrackRequest({ kind: 'query', query: ['a'] })).toBeNull();
    expect(parseTrackRequest({ kind: 'link', url: { href: 'https://x.com' } })).toBeNull();
    expect(parseTrackRequest({ kind: 'local' })).toBeNull();
  });

  it('rejects an unknown kind with no fallback value', () => {
    expect(parseTrackRequest({ kind: 'magic', spell: 'abracadabra' })).toBeNull();
  });
});

describe('parseTrackRequest — explicit shapes', () => {
  it('recognizes a local file', () => {
    expect(parseTrackRequest({ kind: 'local', path: '/Users/me/Music/song.flac' })).toEqual({
      kind: 'local',
      path: '/Users/me/Music/song.flac',
    });
  });

  it('trims a local path', () => {
    expect(parseTrackRequest({ kind: 'local', path: '  /Users/me/a b.mp3  ' })).toEqual({
      kind: 'local',
      path: '/Users/me/a b.mp3',
    });
  });

  it.each([
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'http://soundcloud.com/artist/track',
    'https://open.spotify.com/track/abc123',
    'HTTPS://EXAMPLE.COM/Song.mp3',
  ])('recognizes %s as a link', (url) => {
    expect(parseTrackRequest({ kind: 'link', url })).toEqual({ kind: 'link', url });
  });

  it('trims a link before validating it', () => {
    expect(parseTrackRequest({ kind: 'link', url: '  https://example.com/a  ' })).toEqual({
      kind: 'link',
      url: 'https://example.com/a',
    });
  });

  it('recognizes a query and defaults the provider to youtube', () => {
    expect(parseTrackRequest({ kind: 'query', query: 'Aphex Twin Windowlicker' })).toEqual({
      kind: 'query',
      query: 'Aphex Twin Windowlicker',
      provider: 'youtube',
    });
  });

  it('trims a query', () => {
    expect(parseTrackRequest({ kind: 'query', query: '   song name  ' })).toEqual({
      kind: 'query',
      query: 'song name',
      provider: 'youtube',
    });
  });

  it('honors an explicit soundcloud provider', () => {
    expect(parseTrackRequest({ kind: 'query', query: 'dusty demo', provider: 'soundcloud' })).toEqual({
      kind: 'query',
      query: 'dusty demo',
      provider: 'soundcloud',
    });
  });

  it.each([
    ['spotify', 'spotify'],
    ['bandcamp', 'bandcamp'],
    ['SOUNDCLOUD (wrong case)', 'SOUNDCLOUD'],
    ['a number', 7],
    ['an object', { name: 'soundcloud' }],
    ['null', null],
  ])('ignores %s as a provider and falls back to youtube', (_label, provider) => {
    expect(parseTrackRequest({ kind: 'query', query: 'a song', provider })).toEqual({
      kind: 'query',
      query: 'a song',
      provider: 'youtube',
    });
  });
});

describe('parseTrackRequest — bare values', () => {
  it.each([
    'https://www.youtube.com/watch?v=abc',
    'http://example.com/track.mp3',
    'https://example.com',
  ])('treats %s as a link', (value) => {
    expect(parseTrackRequest({ value })).toEqual({ kind: 'link', url: value });
  });

  it('trims a bare value before classifying it', () => {
    expect(parseTrackRequest({ value: '  https://example.com/a  ' })).toEqual({
      kind: 'link',
      url: 'https://example.com/a',
    });
    expect(parseTrackRequest({ value: '  just a song  ' })).toEqual({
      kind: 'query',
      query: 'just a song',
      provider: 'youtube',
    });
  });

  it.each([
    'Fleetwood Mac Dreams',
    'example.com/not-a-url',
    'www.youtube.com/watch?v=abc',
    'song = with # symbols',
  ])('treats %s as a search query', (value) => {
    expect(parseTrackRequest({ value })).toEqual({ kind: 'query', query: value, provider: 'youtube' });
  });

  it('honors the provider on a bare value', () => {
    expect(parseTrackRequest({ value: 'obscure edit', provider: 'soundcloud' })).toEqual({
      kind: 'query',
      query: 'obscure edit',
      provider: 'soundcloud',
    });
  });

  it('prefers an explicit kind over a bare value', () => {
    expect(parseTrackRequest({ kind: 'local', path: '/a/b.flac', value: 'https://example.com/x' })).toEqual({
      kind: 'local',
      path: '/a/b.flac',
    });
  });

  it('falls through to the bare value when the explicit shape is unusable', () => {
    // An empty query with a usable fallback value must not be dropped.
    expect(parseTrackRequest({ kind: 'query', query: '   ', value: 'real search' })).toEqual({
      kind: 'query',
      query: 'real search',
      provider: 'youtube',
    });
  });
});

describe('parseTrackRequest — non-http schemes', () => {
  it.each([
    'javascript:alert(1)',
    'file:///etc/passwd',
    'data:audio/mp3;base64,AAAA',
    'ftp://example.com/song.mp3',
    'about:blank',
    'chrome://settings',
  ])('never turns %s into a link', (value) => {
    expect(parseTrackRequest({ kind: 'link', url: value })).toBeNull();

    const bare = parseTrackRequest({ value });
    expect(bare?.kind).not.toBe('link');
    expect(bare).toEqual({ kind: 'query', query: value, provider: 'youtube' });
  });

  it('rejects a scheme-relative url as a link', () => {
    expect(parseTrackRequest({ kind: 'link', url: '//example.com/song.mp3' })).toBeNull();
  });
});

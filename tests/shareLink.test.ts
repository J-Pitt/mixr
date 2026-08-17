import { describe, expect, it } from 'vitest';
import { isLanIPv4, shareUrls } from '../server/lib/share.js';
import { emailShareHref } from '../src/lib/shareLink.js';

describe('isLanIPv4', () => {
  it('keeps a private LAN address', () => {
    expect(isLanIPv4('192.168.1.20', false, 'IPv4')).toBe(true);
    expect(isLanIPv4('10.0.0.4', false, 4)).toBe(true);
  });

  it('drops loopback, link-local, and IPv6', () => {
    expect(isLanIPv4('127.0.0.1', true, 'IPv4')).toBe(false);
    expect(isLanIPv4('169.254.1.1', false, 'IPv4')).toBe(false);
    expect(isLanIPv4('fe80::1', false, 'IPv6')).toBe(false);
  });
});

describe('shareUrls', () => {
  it('falls back to loopback when there is no LAN address', () => {
    const info = shareUrls(8787, false);
    expect(info.localUrl).toBe('http://127.0.0.1:8787');
    expect(info.shareUrl.startsWith('http://')).toBe(true);
  });
});

describe('emailShareHref', () => {
  it('opens a mailto draft with the share URL', () => {
    const href = emailShareHref(
      {
        localUrl: 'http://127.0.0.1:8787',
        lanUrls: ['http://192.168.1.20:8787'],
        shareUrl: 'http://192.168.1.20:8787',
        listeningOnLan: true,
      },
      'Friday night set',
    );
    expect(href.startsWith('mailto:?subject=')).toBe(true);
    expect(decodeURIComponent(href)).toContain('http://192.168.1.20:8787');
    expect(decodeURIComponent(href)).toContain('Friday night set');
  });
});

import { describe, expect, it } from 'vitest';
import { canUseServiceWorker, isStandaloneApp } from '../src/lib/webApp.js';

describe('web app helpers', () => {
  it('does not treat a normal browser tab as an installed app', () => {
    expect(isStandaloneApp()).toBe(false);
  });

  it('does not register a service worker without a secure window', () => {
    expect(canUseServiceWorker()).toBe(false);
  });
});

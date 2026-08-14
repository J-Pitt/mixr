/**
 * Access to the Electron preload bridge, with graceful degradation so the app
 * still runs in a plain browser during `npm run dev:web`.
 */
export interface MixrBridge {
  isElectron: true;
  getApiBase: () => Promise<string>;
  chooseAudioFiles: () => Promise<string[]>;
  pathForFile: (file: File) => string;
  revealInFinder: (target: string) => Promise<boolean>;
  saveMix: (sourcePath: string, suggestedName: string) => Promise<{ saved: boolean; path?: string; error?: string }>;
  getPaths: () => Promise<{ data: string; renders: string; media: string }>;
}

declare global {
  interface Window {
    mixr?: MixrBridge;
  }
}

export const bridge = (): MixrBridge | undefined => window.mixr;

export const isDesktop = (): boolean => Boolean(window.mixr?.isElectron);

/**
 * In the desktop app the API lives on a loopback port; in the browser Vite
 * proxies the same paths, so a relative base works.
 */
export async function resolveApiBase(): Promise<string> {
  const desktop = bridge();
  if (!desktop) return '';
  try {
    // An IPC round trip that never settles would leave the window on its splash
    // forever, so fall back to the default port rather than waiting.
    return await Promise.race([
      desktop.getApiBase(),
      new Promise<string>((resolve) => setTimeout(() => resolve('http://127.0.0.1:8787'), 4000)),
    ]);
  } catch {
    return '';
  }
}

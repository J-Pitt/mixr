import { contextBridge, ipcRenderer, webUtils } from 'electron';

/**
 * The entire surface the renderer gets. Everything here is an explicit, narrow
 * capability: no filesystem, no shell, no Node.
 */
const api = {
  isElectron: true as const,

  /** Base URL of the local API. Resolved from the main process at startup. */
  getApiBase: async (): Promise<string> => {
    const port = (await ipcRenderer.invoke('mixr:api-port')) as number;
    return `http://127.0.0.1:${port}`;
  },

  /** Native file picker, returning absolute paths. */
  chooseAudioFiles: (): Promise<string[]> => ipcRenderer.invoke('mixr:choose-audio-files'),

  /** Absolute path for a dropped File, so large uploads are never copied. */
  pathForFile: (file: File): string => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return '';
    }
  },

  revealInFinder: (target: string): Promise<boolean> => ipcRenderer.invoke('mixr:reveal', target),

  saveMix: (sourcePath: string, suggestedName: string): Promise<{ saved: boolean; path?: string; error?: string }> =>
    ipcRenderer.invoke('mixr:save-mix', { sourcePath, suggestedName }),

  getPaths: (): Promise<{ data: string; renders: string; media: string }> => ipcRenderer.invoke('mixr:paths'),
};

contextBridge.exposeInMainWorld('mixr', api);

export type MixrBridge = typeof api;

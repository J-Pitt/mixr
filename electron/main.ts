import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));

// Pinned before any getPath call. Unpackaged builds would otherwise derive
// "mixr" from package.json while the packaged app uses productName "mixR",
// splitting the library in two on case-sensitive volumes.
app.setName('mixR');

/**
 * Dev mode is opt-in through the environment rather than inferred from
 * app.isPackaged, so `npm start` on a build loads the real bundled UI instead of
 * waiting for a dev server that is not running.
 */
const DEV_SERVER_URL = process.env.MIXR_DEV_SERVER_URL ?? '';
const isDev = DEV_SERVER_URL.length > 0;

let mainWindow: BrowserWindow | null = null;
let apiPort = 0;
let closeServer: (() => Promise<void>) | null = null;

/**
 * The server reads its data directory from the environment so it never has to
 * import electron. This must be set before the server module is loaded.
 */
function configureDataDir(): void {
  process.env.MIXR_DATA_DIR = app.getPath('userData');
}

async function startApi(): Promise<void> {
  configureDataDir();
  // Imported lazily so MIXR_DATA_DIR is already in place.
  const { startServer } = await import('../server/index.js');
  const started = await startServer(Number(process.env.MIXR_PORT ?? 8787));
  apiPort = started.port;
  closeServer = started.close;
}

/** Waits for the Vite dev server, which may still be booting. */
async function waitForDevServer(url: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { method: 'GET' });
      if (response.ok || response.status === 304) return;
    } catch {
      // Not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`Vite dev server did not come up at ${url}`);
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 900,
    minHeight: 640,
    show: false,
    backgroundColor: '#0b0b14',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 22 },
    webPreferences: {
      preload: path.join(dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  window.once('ready-to-show', () => window.show());

  // Anything that is not the app itself belongs in the user's browser.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  window.webContents.on('will-navigate', (event, url) => {
    const allowed = isDev ? DEV_SERVER_URL : 'file://';
    if (!url.startsWith(allowed)) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  window.on('closed', () => {
    mainWindow = null;
  });

  return window;
}

async function loadRenderer(window: BrowserWindow): Promise<void> {
  if (isDev) {
    console.log(`[mixr] development mode, loading ${DEV_SERVER_URL}`);
    await waitForDevServer(DEV_SERVER_URL);
    await window.loadURL(DEV_SERVER_URL);
    return;
  }

  const indexFile = path.join(dirname, '..', 'dist', 'index.html');
  console.log(`[mixr] production mode, loading ${indexFile}`);
  await window.loadFile(indexFile);
}

/** A minimal menu, mostly so copy, paste, and the standard shortcuts work. */
function buildMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          label: 'Open Data Folder',
          click: () => void shell.openPath(app.getPath('userData')),
        },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function registerIpc(): void {
  ipcMain.handle('mixr:api-port', () => apiPort);

  ipcMain.handle('mixr:choose-audio-files', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Add songs',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Audio', extensions: ['mp3', 'm4a', 'aac', 'wav', 'aiff', 'aif', 'flac', 'ogg', 'opus', 'wma'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    return result.canceled ? [] : result.filePaths;
  });

  ipcMain.handle('mixr:reveal', (_event, target: unknown) => {
    if (typeof target !== 'string' || !target) return false;
    if (!fs.existsSync(target)) return false;
    shell.showItemInFolder(target);
    return true;
  });

  ipcMain.handle('mixr:save-mix', async (_event, payload: unknown) => {
    const { sourcePath, suggestedName } = (payload ?? {}) as { sourcePath?: string; suggestedName?: string };
    if (typeof sourcePath !== 'string' || !fs.existsSync(sourcePath)) {
      return { saved: false, error: 'That mix file is no longer on disk.' };
    }

    const result = await dialog.showSaveDialog({
      title: 'Save mix',
      defaultPath: path.join(app.getPath('music'), suggestedName || path.basename(sourcePath)),
      filters: [{ name: 'MP3', extensions: ['mp3'] }],
    });
    if (result.canceled || !result.filePath) return { saved: false };

    try {
      await fs.promises.copyFile(sourcePath, result.filePath);
      return { saved: true, path: result.filePath };
    } catch (error) {
      return { saved: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  /** Absolute paths for renders and media, so the UI can reveal or save them. */
  ipcMain.handle('mixr:paths', () => {
    const dataDir = app.getPath('userData');
    return {
      data: dataDir,
      renders: path.join(dataDir, 'renders'),
      media: path.join(dataDir, 'media'),
    };
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  void app.whenReady().then(async () => {
    try {
      await startApi();
    } catch (error) {
      dialog.showErrorBox(
        'mixR could not start',
        `The local audio service failed to start.\n\n${error instanceof Error ? error.message : String(error)}`,
      );
      app.quit();
      return;
    }

    buildMenu();
    registerIpc();

    mainWindow = createWindow();
    try {
      await loadRenderer(mainWindow);
    } catch (error) {
      dialog.showErrorBox('mixR could not load', error instanceof Error ? error.message : String(error));
      app.quit();
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createWindow();
        void loadRenderer(mainWindow);
      }
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    void closeServer?.();
  });
}

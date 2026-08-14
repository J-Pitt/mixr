import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * The server never imports electron, so the host process communicates the data
 * directory through MIXR_DATA_DIR. That keeps the API runnable under plain tsx
 * for browser-only development.
 */
function resolveDataDir(): string {
  const fromHost = process.env.MIXR_DATA_DIR?.trim();
  if (fromHost) return fromHost;

  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'mixR');
  }
  return path.join(os.homedir(), '.mixr');
}

const dataDir = resolveDataDir();

export const paths = {
  data: dataDir,
  /** Self-contained yt-dlp binary lives here when it is not on PATH. */
  bin: path.join(dataDir, 'bin'),
  /** Canonical 44.1k stereo FLAC per ingested track. */
  media: path.join(dataDir, 'media'),
  /** Cached analysis JSON, keyed by media fingerprint. */
  analysis: path.join(dataDir, 'analysis'),
  /** Finished mixes. */
  renders: path.join(dataDir, 'renders'),
  /** Scratch space for downloads in flight. */
  tmp: path.join(dataDir, 'tmp'),
  library: path.join(dataDir, 'library.json'),
};

export function ensureDirs(): void {
  for (const dir of [paths.data, paths.bin, paths.media, paths.analysis, paths.renders, paths.tmp]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/** Removes leftovers from downloads that were interrupted by a crash or quit. */
export function cleanTmp(): void {
  try {
    for (const entry of fs.readdirSync(paths.tmp)) {
      fs.rmSync(path.join(paths.tmp, entry), { recursive: true, force: true });
    }
  } catch {
    // A dirty scratch directory is not worth failing startup over.
  }
}

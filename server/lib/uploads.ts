import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { AUDIO_EXTENSIONS } from './ingest.js';
import { paths } from './paths.js';

const MAX_UPLOAD_BYTES = 80 * 1024 * 1024;

/** Strips a client filename down to something safe to write under tmp. */
export function safeUploadFilename(raw: string): string {
  const decoded = (() => {
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  })();

  const base = path
    .basename(decoded)
    .replace(/[^\w.\- ()[\]]+/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 120)
    .trim();

  return base || 'upload';
}

export function assertAudioUpload(filename: string, size: number): void {
  if (size <= 0) throw new Error('That upload was empty.');
  if (size > MAX_UPLOAD_BYTES) throw new Error('That file is larger than 80 MB.');
  const ext = path.extname(filename).toLowerCase();
  if (!AUDIO_EXTENSIONS.has(ext)) {
    throw new Error(`${path.basename(filename)} does not look like an audio file.`);
  }
}

/** Writes a browser upload into scratch space and returns a local ingest path. */
export function saveUpload(filename: string, body: Buffer): { path: string; name: string } {
  const name = safeUploadFilename(filename);
  assertAudioUpload(name, body.length);

  const directory = path.join(paths.tmp, 'uploads');
  fs.mkdirSync(directory, { recursive: true });
  const dest = path.join(directory, `${randomUUID()}-${name}`);
  fs.writeFileSync(dest, body);
  return { path: dest, name };
}

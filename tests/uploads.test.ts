import { describe, expect, it } from 'vitest';
import { assertAudioUpload, safeUploadFilename } from '../server/lib/uploads.js';

describe('safeUploadFilename', () => {
  it('keeps a normal audio name', () => {
    expect(safeUploadFilename('Late Night.mp3')).toBe('Late Night.mp3');
  });

  it('strips path segments and encoded characters', () => {
    expect(safeUploadFilename(encodeURIComponent('../etc/passwd.mp3'))).toBe('passwd.mp3');
  });

  it('falls back when the name is empty', () => {
    expect(safeUploadFilename('...')).toBe('upload');
  });
});

describe('assertAudioUpload', () => {
  it('accepts a typical track', () => {
    expect(() => assertAudioUpload('song.flac', 4_000_000)).not.toThrow();
  });

  it('rejects a non-audio name', () => {
    expect(() => assertAudioUpload('notes.txt', 12)).toThrow(/audio file/);
  });

  it('rejects an empty or huge body', () => {
    expect(() => assertAudioUpload('song.mp3', 0)).toThrow(/empty/);
    expect(() => assertAudioUpload('song.mp3', 90 * 1024 * 1024)).toThrow(/80 MB/);
  });
});

/**
 * Draws the app icon and writes build/icon.png.
 *
 * Done in code rather than checked in as a binary so the artwork is reviewable
 * and reproducible. Rendered at 2x and averaged down for antialiasing.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

const SIZE = 1024;
const SCALE = 2;
const RENDER = SIZE * SCALE;

const hex = (value) => [
  parseInt(value.slice(1, 3), 16),
  parseInt(value.slice(3, 5), 16),
  parseInt(value.slice(5, 7), 16),
];

const LIGHT = hex('#a78bfa');
const VIOLET = hex('#7c3aed');
const PINK = hex('#e040a8');

const lerp = (a, b, t) => a + (b - a) * t;
const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const smoothstep = (t) => t * t * (3 - 2 * t);

/** Signed-distance style test for a rounded rectangle. */
function insideRoundedRect(x, y, left, top, right, bottom, radius) {
  const cx = Math.max(left + radius, Math.min(right - radius, x));
  const cy = Math.max(top + radius, Math.min(bottom - radius, y));
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= radius * radius;
}

// The bars read as a mix: quiet intro, two peaks, a dip for the blend, a tail.
const BARS = [0.34, 0.58, 0.86, 0.46, 1.0, 0.66, 0.3];

const buffer = new Float32Array(RENDER * RENDER * 4);

const inset = 0.085 * RENDER;
const radius = 0.2 * RENDER;
const left = inset;
const top = inset;
const right = RENDER - inset;
const bottom = RENDER - inset;

for (let y = 0; y < RENDER; y += 1) {
  for (let x = 0; x < RENDER; x += 1) {
    const index = (y * RENDER + x) * 4;
    if (!insideRoundedRect(x, y, left, top, right, bottom, radius)) continue;

    // Three-stop diagonal gradient. The stops have to meet exactly at the
    // midpoint or the seam shows as a crease across the icon.
    const diagonal = smoothstep((x / RENDER + y / RENDER) / 2);
    const base =
      diagonal < 0.5 ? mix(LIGHT, VIOLET, diagonal / 0.5) : mix(VIOLET, PINK, (diagonal - 0.5) / 0.5);

    buffer[index] = base[0];
    buffer[index + 1] = base[1];
    buffer[index + 2] = base[2];
    buffer[index + 3] = 255;
  }
}

// Waveform bars.
const barCount = BARS.length;
const fieldWidth = RENDER * 0.56;
const barWidth = (fieldWidth / barCount) * 0.56;
const gap = (fieldWidth - barWidth * barCount) / (barCount - 1);
const startX = (RENDER - fieldWidth) / 2;
const centerY = RENDER / 2;
const maxHeight = RENDER * 0.42;

for (let bar = 0; bar < barCount; bar += 1) {
  const barLeft = startX + bar * (barWidth + gap);
  const barRight = barLeft + barWidth;
  const height = BARS[bar] * maxHeight;
  const barTop = centerY - height / 2;
  const barBottom = centerY + height / 2;
  const barRadius = barWidth / 2;

  for (let y = Math.floor(barTop); y <= Math.ceil(barBottom); y += 1) {
    for (let x = Math.floor(barLeft); x <= Math.ceil(barRight); x += 1) {
      if (x < 0 || y < 0 || x >= RENDER || y >= RENDER) continue;
      if (!insideRoundedRect(x, y, barLeft, barTop, barRight, barBottom, barRadius)) continue;

      const index = (y * RENDER + x) * 4;
      buffer[index] = 255;
      buffer[index + 1] = 255;
      buffer[index + 2] = 255;
      buffer[index + 3] = 255;
    }
  }
}

// Downsample for antialiasing.
const pixels = Buffer.alloc(SIZE * SIZE * 4);
for (let y = 0; y < SIZE; y += 1) {
  for (let x = 0; x < SIZE; x += 1) {
    let r = 0;
    let g = 0;
    let b = 0;
    let a = 0;
    for (let dy = 0; dy < SCALE; dy += 1) {
      for (let dx = 0; dx < SCALE; dx += 1) {
        const source = ((y * SCALE + dy) * RENDER + (x * SCALE + dx)) * 4;
        const alpha = buffer[source + 3] / 255;
        r += buffer[source] * alpha;
        g += buffer[source + 1] * alpha;
        b += buffer[source + 2] * alpha;
        a += buffer[source + 3];
      }
    }
    const samples = SCALE * SCALE;
    const coverage = a / samples / 255;
    const target = (y * SIZE + x) * 4;
    // Un-premultiply so edges keep their colour instead of fading to black.
    pixels[target] = coverage > 0 ? Math.round(r / samples / coverage) : 0;
    pixels[target + 1] = coverage > 0 ? Math.round(g / samples / coverage) : 0;
    pixels[target + 2] = coverage > 0 ? Math.round(b / samples / coverage) : 0;
    pixels[target + 3] = Math.round(a / samples);
  }
}

// ── PNG encoding ────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
for (let y = 0; y < SIZE; y += 1) {
  const offset = y * (SIZE * 4 + 1);
  raw[offset] = 0; // no filter
  pixels.copy(raw, offset + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

mkdirSync('build', { recursive: true });
writeFileSync('build/icon.png', png);
console.log(`build/icon.png (${SIZE}x${SIZE}, ${(png.length / 1024).toFixed(0)} KB)`);

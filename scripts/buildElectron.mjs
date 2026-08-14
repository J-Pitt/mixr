/**
 * Bundles the Electron entry points.
 *
 * The main process is ESM (matching "type": "module") and keeps node_modules
 * external, because packages like ffmpeg-static resolve binaries relative to
 * their own location and would break if inlined. The preload is CommonJS, which
 * is what a sandboxed preload must be.
 */
import { build } from 'esbuild';
import { rmSync } from 'node:fs';

const outdir = 'dist-electron';
const watch = process.argv.includes('--watch');

rmSync(outdir, { recursive: true, force: true });

const shared = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  sourcemap: true,
  logLevel: 'info',
};

const configs = [
  {
    ...shared,
    entryPoints: { main: 'electron/main.ts' },
    outdir,
    outExtension: { '.js': '.mjs' },
    format: 'esm',
    packages: 'external',
  },
  {
    ...shared,
    entryPoints: { preload: 'electron/preload.ts' },
    outdir,
    outExtension: { '.js': '.cjs' },
    format: 'cjs',
    external: ['electron'],
  },
];

if (watch) {
  const { context } = await import('esbuild');
  const contexts = await Promise.all(configs.map((config) => context(config)));
  await Promise.all(contexts.map((instance) => instance.watch()));
  console.log('[buildElectron] watching');
} else {
  await Promise.all(configs.map((config) => build(config)));
}

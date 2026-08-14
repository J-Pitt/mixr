import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API_TARGET = `http://127.0.0.1:${process.env.MIXR_PORT ?? 8787}`;

export default defineConfig({
  plugins: [react()],
  // Relative asset paths are required because the packaged app loads the built
  // index.html over file://.
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    port: 5173,
    // Electron waits on this exact URL, so silently moving ports would break it.
    strictPort: true,
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
      '/media': { target: API_TARGET, changeOrigin: true },
      '/renders': { target: API_TARGET, changeOrigin: true },
    },
  },
});

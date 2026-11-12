import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Single source of truth for the UI version: the ROOT package.json
// (the one published to npm). Injected at build time as __APP_VERSION__,
// so every release shows the correct version without manual edits.
const uiRoot = dirname(fileURLToPath(import.meta.url));
const rootPkg = JSON.parse(readFileSync(resolve(uiRoot, '../../package.json'), 'utf8'));

// During dev, Vite serves the UI on :5173 and proxies /api to the Node
// server on :4040. In production the server itself serves dist/.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(rootPkg.version),
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4040',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});

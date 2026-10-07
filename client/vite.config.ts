import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const serverPort = Number(process.env.DECOY_SERVER_PORT ?? 8080);

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: './',
  publicDir: false,
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000,
  },
  server: {
    port: 5173,
    host: true,
    fs: { allow: [repoRoot] },
    proxy: {
      '/ws': { target: `ws://localhost:${serverPort}`, ws: true },
    },
  },
});

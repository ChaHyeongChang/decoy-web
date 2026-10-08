import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const serverPort = Number(process.env.DECOY_SERVER_PORT ?? 8080);

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: './',
  // public/의 sw.js · wake.html은 이름을 바꾸지 않고 dist 맨 위에 복사한다 (서비스 워커 범위가 사이트 전체가 되도록)
  publicDir: 'public',
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

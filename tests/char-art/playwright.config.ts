// 캐릭터 리디자인 1단계 비교 촬영 (artifacts/characters/compare/): npm run build 뒤
//   npx playwright test --config tests/char-art/playwright.config.ts
// 실제 게임을 Canvas 렌더러로 띄워 같은 장면을 지금 그림 → 새 그림(아틀라스 칸 덮어쓰기)으로 찍는다. 일반 E2E와 따로 돈다
import { defineConfig } from '@playwright/test';

const PORT = Number(process.env.DECOY_CHARS_PORT ?? 8197);

export default defineConfig({
  testDir: '.',
  outputDir: './.results',
  timeout: 300_000,
  expect: { timeout: 20_000 },
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    launchOptions: {
      args: [
        '--disable-gpu',
        '--disable-gpu-compositing',
        '--disable-accelerated-2d-canvas',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--disable-backgrounding-occluded-windows',
      ],
    },
  },
  webServer: {
    command: `node server/dist/index.js --port=${PORT} --test-hooks --seed=12345`,
    cwd: '../..',
    url: `http://localhost:${PORT}/healthz`,
    reuseExistingServer: false,
    timeout: 30_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});

// 입체감 시안 촬영 (VISUAL_SPEC 14장, docs/DECISIONS 17절): npx playwright test --config tests/depth/playwright.config.ts
// 실제 게임 화면을 WebGL(SwiftShader)로 찍어 artifacts/depth/에 둔다. 장면마다 사람 탭 하나 + 서버 봇 셋.
// 일반 E2E(tests/e2e)와 따로 돈다 — 그림을 바꿀 때만 사람이 돌리고 결과 PNG를 커밋한다
import { defineConfig } from '@playwright/test';

const PORT = Number(process.env.DECOY_DEPTH_PORT ?? 8199);

export default defineConfig({
  testDir: '.',
  outputDir: './.results',
  timeout: 600_000,
  expect: { timeout: 20_000 },
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    launchOptions: {
      args: [
        '--enable-unsafe-swiftshader',
        '--use-angle=swiftshader',
        '--disable-gpu-rasterization',
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

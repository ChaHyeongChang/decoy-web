// 카메라 촬영 (따라가는 카메라 1단계 · 최종 확인): npx playwright test --config tests/camera/playwright.config.ts
// 실제 게임 화면을 WebGL(SwiftShader)로 찍어 artifacts/camera/에 둔다. 장면마다 사람 탭 하나 + 서버 봇 셋.
// 일반 E2E(tests/e2e)와 따로 돈다 — 그림을 바꿀 때만 사람이 돌리고 결과 PNG를 커밋한다
import { defineConfig } from '@playwright/test';

const PORT = Number(process.env.DECOY_CAMERA_PORT ?? 8197);

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

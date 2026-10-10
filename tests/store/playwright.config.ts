// 스토어 그림 촬영 (M15, docs/MOBILE_PLAN.md M15 3번): npm run shots:store
// 실제 게임 화면을 WebGL(SwiftShader) · 품질 높음으로 찍어 artifacts/store/에 둔다. 장면마다 사람 탭 하나 + 서버 봇 셋이라 WebGL 탭이 하나뿐이다.
// 일반 E2E(tests/e2e)와 따로 돈다 — 그림을 바꿀 때만 사람이 돌리고 결과 PNG를 커밋한다
import { defineConfig } from '@playwright/test';

const PORT = Number(process.env.DECOY_STORE_PORT ?? 8196);

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

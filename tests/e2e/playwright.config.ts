import { defineConfig } from '@playwright/test';

const PORT = Number(process.env.DECOY_E2E_PORT ?? 8181);
/** 서버 정답 기록 (정보 차단 E2E가 대조한다) */
export const TRUTH_LOG = 'tests/e2e/.results/truth.jsonl';

export default defineConfig({
  testDir: '.',
  outputDir: './.results',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1280, height: 720 },
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
    command: `mkdir -p tests/e2e/.results && node server/dist/index.js --port=${PORT} --test-hooks --seed=12345 --truth-log=${TRUTH_LOG}`,
    cwd: '../..',
    url: `http://localhost:${PORT}/healthz`,
    reuseExistingServer: false,
    timeout: 30_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});

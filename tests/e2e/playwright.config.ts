import { defineConfig } from '@playwright/test';

const PORT = Number(process.env.DECOY_E2E_PORT ?? 8181);

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
    command: `node server/dist/index.js --port=${PORT} --test-hooks --seed=12345`,
    cwd: '../..',
    url: `http://localhost:${PORT}/healthz`,
    reuseExistingServer: false,
    timeout: 30_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});

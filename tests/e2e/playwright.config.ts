import { defineConfig } from '@playwright/test';

const PORT = Number(process.env.DECOY_E2E_PORT ?? 8181);
/** 서버 정답 기록 (정보 차단 E2E가 대조한다) */
export const TRUTH_LOG = 'tests/e2e/.results/truth.jsonl';

const COMMON_ARGS = [
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
];

export default defineConfig({
  testDir: '.',
  outputDir: './.results',
  timeout: 180_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1280, height: 720 },
  },
  projects: [
    {
      // WebGL 경로 확인 (탭 1개). 컨테이너에는 GPU가 없어 SwiftShader로 돈다
      name: 'webgl',
      testMatch: /smoke\.spec\.ts/,
      use: {
        launchOptions: { args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', ...COMMON_ARGS] },
      },
    },
    {
      // 여러 탭 E2E: GPU 프로세스(SwiftShader) 하나를 탭 4개가 나눠 쓰면 1~15FPS밖에 안 나와서
      // 소프트웨어 합성(CPU 래스터)으로 돌린다. 렌더러는 Canvas (helpers.ts BASE_QUERY)
      name: 'multi',
      testIgnore: /smoke\.spec\.ts/,
      use: {
        launchOptions: {
          args: [
            '--disable-gpu',
            '--disable-gpu-compositing',
            '--disable-accelerated-2d-canvas',
            ...COMMON_ARGS,
          ],
        },
      },
    },
  ],
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

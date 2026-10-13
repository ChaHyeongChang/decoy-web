// 프레임 성능 측정 (렌더링 최적화, docs/PERF.md): npm run perf:frame
// 봇과 연습 판(기기 안 서버 · 봇 셋)을 CPU를 느리게 만든 크롬에서 돌려 프레임 간격 · 작업 시간 · 그리기 호출을 잰다.
// 측정은 화면 코드가 아니라 브라우저 API에 끼운 훅(perfHooks.ts)으로 하므로, 최적화 전 빌드도 같은 방법으로 잰다:
//   DECOY_PERF_DIR=<빌드한 다른 checkout> DECOY_PERF_LABEL=before npx playwright test --config tests/perf/playwright.config.ts
// 결과는 artifacts/perf/<label>/frame-perf.json. 일반 E2E(tests/e2e)와 따로 돈다 — 수치는 기록용(러너마다 다르다)
import { resolve } from 'node:path';
import { defineConfig } from '@playwright/test';

const PORT = Number(process.env.DECOY_PERF_PORT ?? 8197);
/** 서버 · 화면 빌드가 있는 checkout (기본은 이 저장소) */
const DIR = resolve(process.env.DECOY_PERF_DIR ?? `${import.meta.dirname}/../..`);

const COMMON_ARGS = [
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
  // performance.memory를 100KB 단위로 뭉개지 않고 바로 읽는다 (할당량 어림)
  '--enable-precise-memory-info',
];

export default defineConfig({
  testDir: '.',
  outputDir: './.results',
  timeout: 600_000,
  expect: { timeout: 30_000 },
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  use: { baseURL: `http://localhost:${PORT}` },
  projects: [
    {
      // WebGL(컨테이너에는 GPU가 없어 SwiftShader). 휴대폰 · PC 품질 높음 · 중간 · 낮음
      name: 'webgl',
      grep: /\[webgl\]/,
      use: {
        launchOptions: {
          args: [
            '--enable-unsafe-swiftshader',
            '--use-angle=swiftshader',
            ...(process.env.DECOY_PERF_ACCEL2D === '1' ? [] : ['--disable-accelerated-2d-canvas']),
            ...COMMON_ARGS,
          ],
        },
      },
    },
    {
      // Canvas 렌더러 + 소프트웨어 합성 (E2E multi 프로젝트와 같은 조건, FPS 게이트와 같은 장면)
      name: 'canvas',
      grep: /\[canvas\]/,
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
    command: `node server/dist/index.js --port=${PORT}`,
    cwd: DIR,
    url: `http://localhost:${PORT}/healthz`,
    reuseExistingServer: false,
    timeout: 30_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});

// 프레임 성능 측정 장면 (playwright.config.ts 머리 주석). 장면마다 새 브라우저 컨텍스트에서 봇과 연습 판을 시작하고,
// 예열 뒤 CPU를 N배 느리게(CDP Emulation.setCPUThrottlingRate) 해 일정 시간 동안 프레임마다 잰다.
// 품질은 주소의 ?quality로 고정하고 판 중 자동 조정은 injectFps(60)으로 막는다(두 빌드 모두 있는 디버그 훅)
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { test, type Browser } from '@playwright/test';
import { installPerfHooks, summarize, type FrameStats } from './perfHooks';

const LABEL = process.env.DECOY_PERF_LABEL ?? 'current';
const OUT = resolve(import.meta.dirname, `../../artifacts/perf/${LABEL}/frame-perf.json`);
const WARMUP_MS = Number(process.env.DECOY_PERF_WARMUP_MS ?? 6000);
const MEASURE_MS = Number(process.env.DECOY_PERF_MEASURE_MS ?? 12000);
const SEED = 20261013;

interface Scenario {
  name: string;
  project: 'webgl' | 'canvas';
  viewport: { width: number; height: number };
  dpr: number;
  phone: boolean;
  quality: 'high' | 'medium' | 'low';
  role: 'runner' | 'monster';
  cpu: number;
  /** ?scale (백버퍼 배율). 컨테이너에는 GPU가 없어 WebGL을 SwiftShader가 CPU로 칠한다 — 백버퍼를 줄여 래스터가 프레임을
   * 막지 않게 하고 메인 스레드 작업 시간을 잰다(JS 경로는 배율과 상관없이 같다) */
  scale?: number;
}

const PC = { width: 1920, height: 1080 };
const PHONE = { width: 915, height: 412 };
export const SCENARIOS: Scenario[] = [
  {
    name: 'pc-high-runner',
    project: 'webgl',
    viewport: PC,
    dpr: 1,
    phone: false,
    quality: 'high',
    role: 'runner',
    cpu: 1,
  },
  {
    name: 'pc-high-runner-cpu4',
    project: 'webgl',
    viewport: PC,
    dpr: 1,
    phone: false,
    quality: 'high',
    role: 'runner',
    cpu: 4,
  },
  {
    name: 'pc-high-monster-cpu4',
    project: 'webgl',
    viewport: PC,
    dpr: 1,
    phone: false,
    quality: 'high',
    role: 'monster',
    cpu: 4,
  },
  {
    name: 'phone-medium-runner-cpu4',
    project: 'webgl',
    viewport: PHONE,
    dpr: 2.625,
    phone: true,
    quality: 'medium',
    role: 'runner',
    cpu: 4,
  },
  {
    name: 'phone-low-runner-cpu6',
    project: 'webgl',
    viewport: PHONE,
    dpr: 2.625,
    phone: true,
    quality: 'low',
    role: 'runner',
    cpu: 6,
  },
  {
    name: 'probe-pc-high-s25',
    project: 'webgl',
    viewport: PC,
    dpr: 1,
    phone: false,
    quality: 'high',
    role: 'runner',
    cpu: 1,
    scale: 0.25,
  },
  {
    name: 'probe-pc-high-s25-cpu4',
    project: 'webgl',
    viewport: PC,
    dpr: 1,
    phone: false,
    quality: 'high',
    role: 'runner',
    cpu: 4,
    scale: 0.25,
  },
  {
    name: 'canvas-low-960-runner',
    project: 'canvas',
    viewport: { width: 960, height: 540 },
    dpr: 1,
    phone: false,
    quality: 'low',
    role: 'runner',
    cpu: 1,
  },
  {
    name: 'canvas-low-1920-monster-cpu4',
    project: 'canvas',
    viewport: PC,
    dpr: 1,
    phone: false,
    quality: 'low',
    role: 'monster',
    cpu: 4,
  },
];

function record(name: string, stats: FrameStats & { scenario: Scenario }): void {
  mkdirSync(dirname(OUT), { recursive: true });
  const all = existsSync(OUT) ? (JSON.parse(readFileSync(OUT, 'utf8')) as Record<string, unknown>) : {};
  all[name] = stats;
  writeFileSync(OUT, `${JSON.stringify(all, null, 2)}\n`);
}

async function measure(browser: Browser, sc: Scenario): Promise<FrameStats> {
  const context = await browser.newContext({
    viewport: sc.viewport,
    deviceScaleFactor: sc.dpr,
    isMobile: sc.phone,
    hasTouch: sc.phone,
  });
  await context.addInitScript(installPerfHooks, SEED);
  // 터치 기기에서 탭이 부르는 전체 화면을 흉내만 낸다 (헤드리스에서 창 크기가 바뀌지 않게)
  await context.addInitScript(() => {
    Element.prototype.requestFullscreen = function () {
      return Promise.resolve();
    };
  });
  const page = await context.newPage();
  const renderer = sc.project === 'canvas' ? '&renderer=canvas' : '';
  const scale = sc.scale !== undefined ? `&scale=${sc.scale}` : '';
  await page.goto(`/?debug=hook&quality=${sc.quality}${renderer}${scale}`);
  await page.getByTestId('practice').click();
  await page.getByTestId(`practice-role-${sc.role}`).click();
  await page.waitForFunction(
    () => {
      const d = (window as unknown as { __DECOY__?: { getLastSnapshot(): unknown; getDrawn(): unknown[] } })
        .__DECOY__;
      return (d?.getLastSnapshot() ?? null) !== null && (d?.getDrawn().length ?? 0) > 0;
    },
    null,
    { timeout: 60_000, polling: 250 },
  );
  await page.evaluate(() =>
    (window as unknown as { __DECOY__?: { injectFps(f: number | null): void } }).__DECOY__?.injectFps(60),
  );
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: sc.cpu });
  await page.waitForTimeout(WARMUP_MS);
  await page.evaluate(() => (window as unknown as { __PERF__: { start(): void } }).__PERF__.start());
  await page.waitForTimeout(MEASURE_MS);
  const raw = await page.evaluate(() => {
    const p = (window as unknown as { __PERF__: { stop(): unknown[]; longTasks: number } }).__PERF__;
    return { frames: p.stop(), longTasks: p.longTasks };
  });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await context.close();
  return summarize(raw.frames as Parameters<typeof summarize>[0], raw.longTasks);
}

for (const sc of SCENARIOS) {
  test(`[${sc.project}] ${sc.name}`, async ({ browser }) => {
    const stats = await measure(browser, sc);
    console.log(`${LABEL} ${sc.name} ${JSON.stringify(stats)}`);
    record(sc.name, { ...stats, scenario: sc });
  });
}

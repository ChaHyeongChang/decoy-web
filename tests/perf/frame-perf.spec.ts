// 프레임 성능 측정 장면 (playwright.config.ts 머리 주석). 장면마다 새 브라우저 컨텍스트에서 봇과 연습 판을 시작하고,
// 예열 뒤 CPU를 N배 느리게(CDP Emulation.setCPUThrottlingRate) 해 일정 시간 동안 프레임마다 잰다.
// 품질은 주소의 ?quality로 고정하고 판 중 자동 조정은 injectFps(60)으로 막는다(두 빌드 모두 있는 디버그 훅)
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { test, type Browser, type CDPSession } from '@playwright/test';
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
  /** 게임을 이 주기로 돌린다 (perfHooks.ts 머리 주석). 없으면 브라우저의 rAF(헤드리스 60Hz) */
  hz?: number;
  /** ?scale (백버퍼 배율). 컨테이너에는 GPU가 없어 WebGL을 SwiftShader가 CPU로 칠한다 — 백버퍼를 줄여 래스터가 프레임을
   * 막지 않게 하고 메인 스레드 작업 시간을 잰다(JS 경로는 배율과 상관없이 같다) */
  scale?: number;
}

const PC = { width: 1920, height: 1080 };
const PHONE = { width: 915, height: 412 };
const pc = (o: Omit<Scenario, 'viewport' | 'dpr' | 'phone'>): Scenario => ({
  ...o,
  viewport: PC,
  dpr: 1,
  phone: false,
});
/** 휴대폰 가로 (픽셀 배율 2.625 · 터치). 백버퍼는 품질 상한(중간 1.5배 · 터치 낮음 1.25배)으로 정해진다 */
const phone = (o: Omit<Scenario, 'viewport' | 'dpr' | 'phone'>): Scenario => ({
  ...o,
  viewport: PHONE,
  dpr: 2.625,
  phone: true,
});

/**
 * 장면. WebGL은 GPU가 없는 컨테이너에서 SwiftShader가 칠하므로 ?scale로 백버퍼를 줄여 래스터가 프레임을 막지 않게 하고
 * 메인 스레드 작업 시간(JS + 그리기 명령 + CPU로 칠하는 2D 캔버스)을 본다. hz 120 = 120Hz 화면 흉내(헤드리스는 60Hz)
 */
export const SCENARIOS: Scenario[] = [
  // Canvas 렌더러 · 낮음: 메인 스레드가 화면까지 칠한다 — 전달 FPS가 뜻이 있다 (m3-info FPS 게이트와 같은 960×540)
  {
    ...pc({ name: 'canvas-low-960-runner', project: 'canvas', quality: 'low', role: 'runner', cpu: 1 }),
    viewport: { width: 960, height: 540 },
  },
  {
    ...pc({
      name: 'canvas-low-960-runner-120hz',
      project: 'canvas',
      quality: 'low',
      role: 'runner',
      cpu: 1,
      hz: 120,
    }),
    viewport: { width: 960, height: 540 },
  },
  pc({ name: 'canvas-low-1920-monster-cpu4', project: 'canvas', quality: 'low', role: 'monster', cpu: 4 }),
  // WebGL 높음 (PC). SwiftShader는 120Hz로 몰면 GL 호출이 막혀(뒤로 밀림) 작업 시간이 래스터 대기가 된다 → 브라우저 rAF 그대로.
  // 그래도 프레임이 느려 거의 모든 프레임에 안개 갱신이 들어가므로, 이 작업 시간 ≈ 120Hz에서 p95를 정하는 안개 프레임의 비용
  pc({
    name: 'webgl-high-runner',
    project: 'webgl',
    quality: 'high',
    role: 'runner',
    cpu: 1,
    hz: 120,
    scale: 0.25,
  }),
  pc({
    name: 'webgl-high-monster',
    project: 'webgl',
    quality: 'high',
    role: 'monster',
    cpu: 1,
    hz: 120,
    scale: 0.25,
  }),
  pc({
    name: 'webgl-high-runner-cpu4',
    project: 'webgl',
    quality: 'high',
    role: 'runner',
    cpu: 4,
    scale: 0.25,
  }),
  // WebGL 휴대폰: 중간(중급) CPU 4배 느리게, 낮음(저사양) CPU 6배 느리게
  phone({
    name: 'phone-medium-runner-cpu4',
    project: 'webgl',
    quality: 'medium',
    role: 'runner',
    cpu: 4,
    scale: 0.4,
  }),
  phone({
    name: 'phone-medium-monster-cpu4',
    project: 'webgl',
    quality: 'medium',
    role: 'monster',
    cpu: 4,
    scale: 0.4,
  }),
  phone({
    name: 'phone-low-runner-cpu6',
    project: 'webgl',
    quality: 'low',
    role: 'runner',
    cpu: 6,
    scale: 0.5,
  }),
];

type PerfResult = FrameStats & { mainBusyMsPerSec: number; scriptMsPerSec: number };

function record(name: string, stats: PerfResult & { scenario: Scenario }): void {
  mkdirSync(dirname(OUT), { recursive: true });
  const all = existsSync(OUT) ? (JSON.parse(readFileSync(OUT, 'utf8')) as Record<string, unknown>) : {};
  all[name] = stats;
  writeFileSync(OUT, `${JSON.stringify(all, null, 2)}\n`);
}

async function measure(browser: Browser, sc: Scenario): Promise<PerfResult> {
  const context = await browser.newContext({
    viewport: sc.viewport,
    deviceScaleFactor: sc.dpr,
    isMobile: sc.phone,
    hasTouch: sc.phone,
  });
  await context.addInitScript(installPerfHooks, { seed: SEED, hz: sc.hz ?? null });
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
  await cdp.send('Performance.enable');
  await page.waitForTimeout(WARMUP_MS);
  const before = await mainThread(cdp);
  await page.evaluate(() => (window as unknown as { __PERF__: { start(): void } }).__PERF__.start());
  await page.waitForTimeout(MEASURE_MS);
  const after = await mainThread(cdp);
  const raw = await page.evaluate(() => {
    const p = (window as unknown as { __PERF__: { stop(): unknown[]; longTasks: number } }).__PERF__;
    return { frames: p.stop(), longTasks: p.longTasks };
  });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await context.close();
  const stats = summarize(raw.frames as Parameters<typeof summarize>[0], raw.longTasks);
  // 메인 스레드 전체(rAF 밖의 입력 타이머 · 기기 안 서버 틱 · 메시지 · 스타일 포함)가 1초에 쓴 시간
  const secs = Math.max(0.001, after.at - before.at);
  return {
    ...stats,
    mainBusyMsPerSec: Math.round(((after.task - before.task) * 1000) / secs),
    scriptMsPerSec: Math.round(((after.script - before.script) * 1000) / secs),
  };
}

/** CDP Performance 누계 (초) */
async function mainThread(cdp: CDPSession): Promise<{ at: number; task: number; script: number }> {
  const { metrics } = (await cdp.send('Performance.getMetrics')) as {
    metrics: { name: string; value: number }[];
  };
  const get = (n: string): number => metrics.find((m) => m.name === n)?.value ?? 0;
  return { at: get('Timestamp'), task: get('TaskDuration'), script: get('ScriptDuration') };
}

for (const sc of SCENARIOS) {
  test(`[${sc.project}] ${sc.name}`, async ({ browser }) => {
    const stats = await measure(browser, sc);
    console.log(`${LABEL} ${sc.name} ${JSON.stringify(stats)}`);
    record(sc.name, { ...stats, scenario: sc });
  });
}

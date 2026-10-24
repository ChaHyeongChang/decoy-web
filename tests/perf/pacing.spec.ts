// 잔렉 측정 (docs/PERF.md 6절): 화면 주사율 60 · 75 · 100 · 120 · 144 · 165 · 240Hz와, 각 주사율에서 실제 그리기가 그보다 조금
// 모자란 상황(작업 시간 모형)을 가상 시계로 만들어 같은 경로를 걷고, 그린 프레임마다 ① 내 그린 자리 변화 ② 카메라 이동
// ③ 카메라 기준 화면 위 내 자리 ④ rAF 간격 · 화면 표시 간격 · 표시 지연 ⑤ 시야 빛(안개 눈)과 내 몸의 화면 위 어긋남을 적는다.
//   npm run build && npx playwright test --config tests/perf/playwright.config.ts tests/perf/pacing.spec.ts
//   DECOY_PERF_DIR=<빌드한 다른 checkout> DECOY_PERF_LABEL=before npx playwright test --config tests/perf/playwright.config.ts tests/perf/pacing.spec.ts
//   node scripts/pacing-table.mjs before after
// 결과는 artifacts/perf/pacing/<label>/<장면>.json. 가상 시계라 기계 · 부하와 상관없이 같은 빌드면 같은 수(작업 시간은 모형 값).
//  - 작업 시간 모형(tests/helpers/virtualClock.ts work): 이 컨테이너 크롬 실험과 같은 규칙 — 프레임이 vsync를 넘기면 다음 rAF는
//    같은 격자 시각으로 늦게 시작하고, 늦음이 한 주기를 넘으면 칸을 건너뛴다. 화면 표시 = 끝난 뒤 다음 vsync
//  - 부하: 고름(작업 0.35주기) · 꾸준히 모자람(0.95~1.25주기 — 예: 144Hz에서 약 130fps) · 안개 프레임만 넘침(안개를 다시 그린
//    프레임 1.4주기, 나머지 0.45) · 가끔 튐(25% 프레임 1.5주기)
//  - 적응형 목표 FPS가 스스로 정하게 둔다(injectFps 없음): 판 시작 뒤 16초 서 있다가(예열 5초 + 지속 10초) 걷는다
//  - 봇과 연습(기기 안 서버), 봇은 묶고 열린 바닥(y 16.5, x 28.5 → 오른쪽 1.8초). Canvas 렌더러 — 백버퍼 · 창 배율은 같은 품질의
//    WebGL과 같다(PC 자동값 높음, 휴대폰 자동값 중간). PC 창은 모니터 해상도 ÷ DPR(OS 배율)
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { installVirtualClock, type VirtualClockConfig, type VirtualWorkModel } from '../helpers/virtualClock';
import {
  dist,
  firstMoveLatency,
  walkSummary,
  type PacingFrame,
  type PacingKey,
  type PacingLog,
} from './pacingStats';

const LABEL = process.env.DECOY_PERF_LABEL ?? 'current';
/** 장면마다 파일 하나 (여러 일꾼이 동시에 써도 겹치지 않게): artifacts/perf/pacing/<label>/<장면>.json */
const OUT_DIR = resolve(import.meta.dirname, `../../artifacts/perf/pacing/${LABEL}`);
const SEED = 20_261_025;
const SETTLE_MS = 700;
const WALK_MS = 1800;
/** 판 시작 뒤 서 있는 시간 (ms): 적응형 목표 FPS가 정할 시간(예열 5초 + 지속 10초 + 여유) */
const STAND_MS = Number(process.env.DECOY_PACING_STAND_MS ?? 16_500);
const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';

type LoadName = 'steady' | 'sustained' | 'fog' | 'spiky';
const LOADS: Record<LoadName, VirtualWorkModel> = {
  steady: { frame: 0.35 },
  sustained: { frame: 0.95, jitter: 0.3 },
  fog: { frame: 0.45, fog: 1.4 },
  spiky: { frame: 0.5, spikeProb: 0.25, spike: 1.5 },
};

interface Size {
  name: string;
  /** CSS 창 크기 (PC는 모니터 해상도 ÷ DPR — OS 배율 125%면 1920×1080 모니터의 창은 1536×864) */
  w: number;
  h: number;
  dpr: number;
  phone?: boolean;
  /** 품질 (PC 하드웨어 WebGL 자동값 높음, 휴대폰 자동값 중간) */
  quality: 'high' | 'medium';
}
const pc = (W: number, H: number, dpr: number): Size => ({
  name: `pc${W}x${H}@${dpr}`,
  w: Math.round(W / dpr),
  h: Math.round(H / dpr),
  dpr,
  quality: 'high',
});
const PC1080 = pc(1920, 1080, 1);
const SIZES: Size[] = [
  PC1080,
  pc(1920, 1080, 1.25),
  pc(1920, 1080, 1.5),
  pc(2560, 1440, 1),
  pc(2560, 1440, 1.25),
  pc(2560, 1440, 1.5),
  { name: 'phone800x360@3', w: 800, h: 360, dpr: 3, phone: true, quality: 'medium' },
  { name: 'phone915x412@2.625', w: 915, h: 412, dpr: 2.625, phone: true, quality: 'medium' },
  { name: 'phone640x360@2', w: 640, h: 360, dpr: 2, phone: true, quality: 'medium' },
];

interface Scene {
  name: string;
  hz: number;
  load: LoadName;
  size: Size;
  role: 'runner' | 'monster';
  limit?: string;
  /** 렌더러 (기본 Canvas). WebGL은 GPU 안개 경로(빛 반경 따라가기)를 본다 — SwiftShader라 느려 서 있는 시간을 줄인다 */
  renderer?: 'canvas' | 'webgl';
  /** 판 시작 뒤 서 있는 시간 (ms, 기본 STAND_MS) */
  standMs?: number;
  /** false면 ?camSnap=0 (카메라 격자 맞춤 끄기 — 고치기 뒤 빌드의 진단 옵션, 격자 맞춤이 맵 스크롤에 남기는 걸음을 견준다) */
  camSnap?: boolean;
}

const scenes: Scene[] = [];
// 가. 주사율 × 부하 (PC 1920×1080@1)
for (const hz of [60, 75, 100, 120, 144, 165, 240])
  for (const load of ['steady', 'sustained', 'fog', 'spiky'] as const)
    scenes.push({ name: `${hz}-${load}`, hz, load, size: PC1080, role: 'runner' });
// 나. 창 크기 · DPR · 휴대폰 (PC 144Hz, 휴대폰 120Hz × 고름 · 꾸준히 모자람)
for (const size of SIZES.slice(1).concat(PC1080)) {
  const hz = size.phone ? 120 : 144;
  for (const load of ['steady', 'sustained'] as const)
    scenes.push({ name: `${size.name}-${hz}-${load}`, hz, load, size, role: 'runner' });
}
// 다. 괴물 · 고정 제한
scenes.push({ name: '144-steady-monster', hz: 144, load: 'steady', size: PC1080, role: 'monster' });
scenes.push({ name: '120-steady-monster', hz: 120, load: 'steady', size: PC1080, role: 'monster' });
for (const hz of [75, 100, 144, 165])
  scenes.push({
    name: `${hz}-steady-limit60`,
    hz,
    load: 'steady',
    size: PC1080,
    role: 'runner',
    limit: '60',
  });
for (const hz of [144, 165])
  scenes.push({
    name: `${hz}-steady-limit120`,
    hz,
    load: 'steady',
    size: PC1080,
    role: 'runner',
    limit: '120',
  });
// 마. 격자 맞춤 끄기 견주기 (진단 옵션, 고친 뒤 빌드만 뜻이 있다)
scenes.push({
  name: '144-steady-nosnap',
  hz: 144,
  load: 'steady',
  size: PC1080,
  role: 'runner',
  camSnap: false,
});
// 라. GPU 안개 경로 (WebGL · 품질 높음 PC, 중간 휴대폰): 시야 빛 반경 띠가 내 몸을 따라가는가 — 적응형은 보지 않는다(고른 부하)
const PHONE915 = SIZES.find((s) => s.name === 'phone915x412@2.625') ?? PC1080;
scenes.push({
  name: 'phone915x412@2.625-120-steady-nosnap',
  hz: 120,
  load: 'steady',
  size: PHONE915,
  role: 'runner',
  camSnap: false,
});
for (const [hz, size] of [
  [60, PC1080],
  [144, PC1080],
  [120, PHONE915],
] as const)
  scenes.push({
    name: `webgl-${size.name}-${hz}-steady`,
    hz,
    load: 'steady',
    size,
    role: 'runner',
    renderer: 'webgl',
    standMs: 2000,
  });
scenes.push({
  name: 'webgl-pc1920x1080@1-144-steady-monster',
  hz: 144,
  load: 'steady',
  size: PC1080,
  role: 'monster',
  renderer: 'webgl',
  standMs: 2000,
});

interface Store {
  on: boolean;
  frames: PacingFrame[];
  keys: PacingKey[];
}

/** 페이지 안: 판 장면이 그린 프레임마다 기록 (가상 시계 rAF를 감싼다) */
function installPacingTrace(): void {
  interface Hook {
    getRenderPos(): { x: number; y: number } | null;
    getDrawn(): { kind: string; x: number; y: number }[];
    getAnimState(): {
      frames: number;
      fogAt: number | null;
      fogEye?: { x: number; y: number } | null;
      fogShift?: { x: number; y: number };
      fogFollow?: string;
    } | null;
    tileToClient(x: number, y: number): { x: number; y: number } | null;
    readonly gfx: { targetHz: number; displayHz: number };
  }
  const store: Store = { on: false, frames: [], keys: [] };
  (window as unknown as { __PACE__: Store }).__PACE__ = store;
  for (const type of ['keydown', 'keyup'] as const)
    window.addEventListener(
      type,
      (e) => {
        const ke = e as KeyboardEvent;
        if (store.on && !ke.repeat)
          store.keys.push({ t: performance.now(), type: type === 'keydown' ? 'down' : 'up', code: ke.code });
      },
      true,
    );
  let last = -1;
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb: FrameRequestCallback): number =>
    raf((t: number) => {
      const start = performance.now();
      cb(t);
      if (!store.on) return;
      const d = (window as unknown as { __DECOY__?: Hook }).__DECOY__;
      const anim = d?.getAnimState();
      if (!d || !anim || anim.frames === last) return;
      last = anim.frames;
      const me = d.getRenderPos();
      if (!me) return;
      const self = d.getDrawn().find((e) => e.kind === 'self') ?? me;
      const p = d.tileToClient(self.x, self.y);
      const c0 = d.tileToClient(0, 0);
      const c1 = d.tileToClient(1, 0);
      if (!p || !c0 || !c1) return;
      const g = d.gfx;
      store.frames.push({
        t,
        start,
        n: anim.frames,
        mx: me.x,
        my: me.y,
        px: p.x,
        py: p.y,
        cx: c0.x,
        cy: c0.y,
        k: c1.x - c0.x,
        fogAt: anim.fogAt,
        ...(anim.fogEye !== undefined
          ? {
              fogEye: anim.fogEye ? { ...anim.fogEye } : null,
              fogShift: anim.fogShift ? { ...anim.fogShift } : { x: 0, y: 0 },
              fogFollow: anim.fogFollow ?? 'off',
            }
          : {}),
        targetHz: g.targetHz,
        displayHz: g.displayHz,
      });
    });
}

async function advance(page: Page, ms: number): Promise<void> {
  await page.evaluate((d) => window.__VCLOCK__?.advance(d), ms);
}

async function domClick(page: Page, testId: string): Promise<void> {
  await page.evaluate((id) => {
    const el = document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    if (!el) throw new Error(`없음: ${id}`);
    el.click();
  }, testId);
}

function save(name: string, data: unknown): void {
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(resolve(OUT_DIR, `${name}.json`), `${JSON.stringify(data, null, 1)}\n`);
}

async function measure(browser: Browser, sc: Scene): Promise<unknown> {
  const size = sc.size;
  const context = await browser.newContext({
    viewport: { width: size.w, height: size.h },
    deviceScaleFactor: size.dpr,
    isMobile: size.phone ?? false,
    hasTouch: size.phone ?? false,
    ...(size.phone ? { userAgent: ANDROID_UA } : {}),
  });
  const cfg: VirtualClockConfig = { seed: SEED, hz: sc.hz, work: LOADS[sc.load] };
  await context.addInitScript(installVirtualClock, cfg);
  await context.addInitScript(installPacingTrace);
  await context.addInitScript(() => {
    Element.prototype.requestFullscreen = function () {
      return Promise.resolve();
    };
  });
  const page = await context.newPage();
  await page.routeWebSocket(/\/ws$/, (ws) => ws.close({ code: 1011, reason: 'blocked' }));
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(String(e)));
  try {
    const q = [
      'debug=hook',
      sc.renderer === 'webgl' ? '' : 'renderer=canvas',
      `quality=${size.quality}`,
      sc.limit ? `fpsLimit=${sc.limit}` : '',
      sc.camSnap === false ? 'camSnap=0' : '',
    ];
    await page.goto(`/?${q.filter((s) => s !== '').join('&')}`);
    await expect(page.getByTestId('practice')).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.__DECOY__?.fonts.ready === true)).toBe(true);
    await context.setOffline(true);
    await page.waitForTimeout(300);
    await page.evaluate(() => window.__VCLOCK__?.pump(false));
    await domClick(page, 'practice');
    await advance(page, 500);
    await domClick(page, `practice-role-${sc.role}`);
    for (let i = 0; i < 150; i += 1) {
      await advance(page, 100);
      const n = await page.evaluate(() => window.__DECOY__?.getTruth()?.players.length ?? 0);
      if (n === 4 && (await page.evaluate(() => (window.__DECOY__?.getDrawn().length ?? 0) > 0))) break;
    }
    expect(await page.evaluate(() => window.__DECOY__?.transport)).toBe('local');
    const face = sc.role === 'monster' ? -Math.PI / 2 : 0;
    await page.evaluate((f) => {
      const d = window.__DECOY__;
      for (const p of d?.getTruth()?.players ?? [])
        if (p.id !== d?.you) d?.sendTest({ kind: 'freeze', target: p.id, frozen: true });
      if (d?.you) d.sendTest({ kind: 'teleport', target: d.you, x: 28.5, y: 16.5, face: f });
    }, face);
    // 적응형 목표 FPS가 정할 시간 (작업 시간 모형이 그동안 돈다)
    for (let left = sc.standMs ?? STAND_MS; left > 0; left -= 2000) await advance(page, Math.min(2000, left));
    await page.evaluate((f) => {
      const d = window.__DECOY__;
      if (d?.you) d.sendTest({ kind: 'teleport', target: d.you, x: 28.5, y: 16.5, face: f });
    }, face);
    await advance(page, 600);
    const gfxBefore = await page.evaluate(() => {
      const g = window.__DECOY__?.gfx;
      return g
        ? {
            targetHz: g.targetHz,
            displayHz: g.displayHz,
            frameLimit: g.frameLimit,
            quality: g.quality,
            zoom: g.zoom,
            backingW: g.backingW,
            cssW: g.cssW,
            downgrades: g.downgrades,
            upgrades: g.upgrades,
          }
        : null;
    });
    await page.evaluate(() => {
      window.__VCLOCK__?.clearLog();
      (window as unknown as { __PACE__: Store }).__PACE__.on = true;
    });
    await advance(page, 200);
    await page.keyboard.down('KeyD');
    await advance(page, WALK_MS);
    await page.keyboard.up('KeyD');
    await advance(page, 150);
    const walk = await page.evaluate(() => {
      const s = (window as unknown as { __PACE__: Store }).__PACE__;
      const out = { frames: s.frames, keys: s.keys, logs: window.__VCLOCK__?.frameLog.slice() ?? [] };
      s.frames = [];
      s.keys = [];
      window.__VCLOCK__?.clearLog();
      return out;
    });
    // 입력 지연: 짧게 누르고 떼기 12번 (기다림을 바꿔 입력 틱 위상을 섞는다)
    let seed = 99;
    for (let i = 0; i < 12; i += 1) {
      seed = (seed * 16807) % 2147483647;
      await advance(page, 150 + Math.round((seed / 2147483647) * 120));
      const key = i % 2 === 0 ? 'KeyD' : 'KeyA';
      await page.keyboard.down(key);
      await advance(page, 160);
      await page.keyboard.up(key);
      await advance(page, 120);
    }
    const taps = await page.evaluate(() => {
      const s = (window as unknown as { __PACE__: Store }).__PACE__;
      s.on = false;
      return { frames: s.frames, keys: s.keys, logs: window.__VCLOCK__?.frameLog.slice() ?? [] };
    });
    const devPerCss = await page.evaluate(() => {
      const c = document.querySelector('canvas');
      return c ? c.width / c.getBoundingClientRect().width : window.devicePixelRatio;
    });
    expect(problems, '페이지 에러').toEqual([]);
    const P = 1000 / sc.hz;
    const summary = walkSummary(walk.frames, walk.keys, walk.logs as PacingLog[], devPerCss, SETTLE_MS, P);
    const lat = firstMoveLatency(taps.frames, taps.keys, taps.logs as PacingLog[], P);
    return {
      scene: { ...sc, size: sc.size.name },
      gfx: gfxBefore,
      summary,
      latency: dist(lat),
      latencyN: lat.length,
      excerpt: walk.frames.slice(0, 400).map((f) => {
        const l = (walk.logs as PacingLog[]).find((x) => x.ts === f.t);
        return {
          t: f.t,
          start: f.start,
          mx: f.mx,
          px: f.px,
          cx: f.cx,
          fogAt: f.fogAt,
          disp: l?.disp ?? null,
          k: f.k,
        };
      }),
    };
  } finally {
    await context.close();
  }
}

const only = process.env.DECOY_PACING_ONLY ? new RegExp(process.env.DECOY_PACING_ONLY) : null;
for (const sc of scenes) {
  if (only && !only.test(sc.name)) continue;
  test(`[${sc.renderer ?? 'canvas'}] pacing ${sc.name}`, async ({ browser }) => {
    test.setTimeout(900_000);
    const data = await measure(browser, sc);
    save(sc.name, data);
    const s = (data as { summary: { fps: number; targetHz: number } }).summary;
    console.log(`${LABEL} ${sc.name} fps ${s.fps.toFixed(1)} 목표 ${s.targetHz}`);
  });
}

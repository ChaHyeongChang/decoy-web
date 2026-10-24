// 내 캐릭터 움직임 고르기 측정 (docs/PERF.md 5절): 같은 경로를 걷는 장면에서 프레임마다 ① 내 그린 자리 변화량 ② 카메라 이동량
// ③ 카메라 기준 내 화면 자리를 적고(motionHooks.ts), 키 눌림 → 첫 움직임 지연을 잰다. 고치기 전 빌드와 같은 방법으로:
//   npm run build && npx playwright test --config tests/perf/playwright.config.ts tests/perf/motion.spec.ts
//   DECOY_PERF_DIR=<빌드한 다른 checkout> DECOY_PERF_LABEL=before npx playwright test --config tests/perf/playwright.config.ts tests/perf/motion.spec.ts
// 결과는 artifacts/perf/motion/<label>/motion.json, 표는 node scripts/motion-table.mjs. 수치는 기록용(러너마다 다르다) —
// 자동 게이트는 tests/e2e/smooth-motion.spec.ts(가상 시계)와 단위 시험이 한다
//  - 봇과 연습(기기 안 서버): 봇을 묶고(freeze) 열린 바닥(y 16.5, x 28.5 ↔ 38) 위를 오른쪽 1.8초 · 왼쪽 1.8초씩 세 번
//  - 온라인 ?lag=100 · 200: 빠른 매칭(대기 1초 balance로 띄운 서버, 봇 셋)에 괴물로 들어가 같은 경로. 생존자 봇은 묶지 않는다
//    (괴물 화면은 명단이 없어 봇 id를 모른다) — 괴물은 위(북)를 보고 걸어 앞당김이 가로로 창을 밀지 않게 한다
//  - Canvas 낮음 960×540(메인 스레드가 화면까지 칠해 전달 FPS가 뜻이 있다, perf 'canvas' 프로젝트), 휴대폰 장면은 915×412@2.625
//  - 120Hz · 90fps(120Hz에서 30% 프레임이 9ms 더 걸림 — vsync를 놓쳐 8.3 · 16.7ms가 섞인다) · CPU 4 · 6배 느림(60Hz) · 프레임 제한 60
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test, type Browser, type Page } from '@playwright/test';
import { installMotionHooks, type MotionFrame, type MotionKey } from './motionHooks';
import { excerpt, latencyStats, walkStats } from './motionStats';

const LABEL = process.env.DECOY_PERF_LABEL ?? 'current';
const DIR = resolve(process.env.DECOY_PERF_DIR ?? `${import.meta.dirname}/../..`);
const OUT = resolve(import.meta.dirname, `../../artifacts/perf/motion/${LABEL}/motion.json`);
const SEED = 20261024;
/** 키를 누른 뒤 이만큼은 세지 않는다 (걷기 시작 · 카메라 따라가기 지연이 가라앉는 시간, τ 0.12초의 약 6배) */
const SETTLE_MS = 700;
const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';

interface Scene {
  name: string;
  project: 'canvas' | 'webgl';
  mode: 'practice' | 'online';
  role: 'runner' | 'monster';
  hz: number | null;
  heavy?: { prob: number; ms: number };
  cpu?: number;
  lag?: number;
  limit?: '60' | '120';
  phone?: boolean;
  quality?: 'low' | 'medium' | 'high';
  scale?: number;
  /** injectFps를 넣지 않는다 (적응형 목표 FPS가 스스로 정하게) */
  adaptive?: boolean;
}

const SCENES: Scene[] = [
  { name: 'p60-runner', project: 'canvas', mode: 'practice', role: 'runner', hz: null },
  { name: 'p120-runner', project: 'canvas', mode: 'practice', role: 'runner', hz: 120 },
  {
    name: 'p90-runner',
    project: 'canvas',
    mode: 'practice',
    role: 'runner',
    hz: 120,
    heavy: { prob: 0.3, ms: 9 },
  },
  { name: 'p120-limit60-runner', project: 'canvas', mode: 'practice', role: 'runner', hz: 120, limit: '60' },
  // 같은 무거운 프레임에서 프레임 제한 60 (고른 60과 고르지 않은 90~100 견주기, 적응형 목표 FPS 기준)
  {
    name: 'p90-limit60-runner',
    project: 'canvas',
    mode: 'practice',
    role: 'runner',
    hz: 120,
    heavy: { prob: 0.3, ms: 9 },
    limit: '60',
  },
  // CPU 느림은 브라우저 rAF(60Hz)로: 120Hz 펌프의 바쁜 기다림까지 느려져(CPU 배율이 그 기다림에도 걸린다) 장면이 10fps가 된다
  { name: 'p60-runner-cpu4', project: 'canvas', mode: 'practice', role: 'runner', hz: null, cpu: 4 },
  { name: 'p60-runner-cpu6', project: 'canvas', mode: 'practice', role: 'runner', hz: null, cpu: 6 },
  { name: 'p60-monster', project: 'canvas', mode: 'practice', role: 'monster', hz: null },
  { name: 'p120-monster', project: 'canvas', mode: 'practice', role: 'monster', hz: 120 },
  { name: 'p120-runner-phone', project: 'canvas', mode: 'practice', role: 'runner', hz: 120, phone: true },
  { name: 'o60-monster-lag100', project: 'canvas', mode: 'online', role: 'monster', hz: null, lag: 100 },
  { name: 'o60-monster-lag200', project: 'canvas', mode: 'online', role: 'monster', hz: null, lag: 200 },
  { name: 'o120-monster-lag100', project: 'canvas', mode: 'online', role: 'monster', hz: 120, lag: 100 },
  // 판 중 맵 조각 복사 · 텍스처 올리기 (GPU 경로): 휴대폰 중간 품질, 백버퍼 0.4배(SwiftShader). 작업 시간 최대 · p95를 본다
  {
    name: 'webgl-phone-medium-runner',
    project: 'webgl',
    mode: 'practice',
    role: 'runner',
    hz: null,
    phone: true,
    quality: 'medium',
    scale: 0.4,
  },
];

interface Saved {
  scene: Scene;
  walk: ReturnType<typeof walkStats>;
  latency: ReturnType<typeof latencyStats>;
  excerpt: ReturnType<typeof excerpt>;
  heavyFrames: number;
  gfx: unknown;
  /** DECOY_MOTION_DUMP=1이면 걷기 원자료 (분석용) */
  raw?: { frames: MotionFrame[]; keys: MotionKey[]; longTasks: { t: number; ms: number }[] };
}

function save(name: string, data: Saved): void {
  mkdirSync(dirname(OUT), { recursive: true });
  const all = existsSync(OUT) ? (JSON.parse(readFileSync(OUT, 'utf8')) as Record<string, unknown>) : {};
  all[name] = data;
  writeFileSync(OUT, `${JSON.stringify(all, null, 2)}\n`);
}

/** 빠른 매칭 대기 1초 · 테스트 훅 서버 (DIR의 빌드) */
async function startQuickServer(): Promise<{ base: string; proc: ChildProcess }> {
  const dir = mkdtempSync(join(tmpdir(), 'decoy-motion-'));
  const balance = JSON.parse(readFileSync(join(DIR, 'config/balance.json'), 'utf8')) as {
    matchmaking: { quickMatchWait: number };
  };
  balance.matchmaking.quickMatchWait = 1;
  const path = join(dir, 'balance.json');
  writeFileSync(path, JSON.stringify(balance));
  const proc = spawn(
    process.execPath,
    [
      'server/dist/index.js',
      '--port=0',
      '--host=127.0.0.1',
      `--balance=${path}`,
      '--test-hooks',
      '--seed=77',
    ],
    { cwd: DIR, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const port = await new Promise<number>((res, rej) => {
    const timer = setTimeout(() => rej(new Error('서버 시작 실패')), 20_000);
    proc.stdout?.on('data', (c: Buffer) => {
      const m = /localhost:(\d+)/.exec(c.toString());
      if (m) {
        clearTimeout(timer);
        res(Number(m[1]));
      }
    });
  });
  return { base: `http://127.0.0.1:${port}`, proc };
}

interface Hook {
  getLastSnapshot(): unknown;
  getDrawn(): unknown[];
  getTruth(): { players: { id: string }[] } | null;
  readonly you: string | null;
  readonly role: string | null;
  sendTest(cmd: unknown): void;
  injectFps(f: number | null): void;
  readonly gfx: unknown;
}

async function teleport(page: Page, x: number, y: number, face: number): Promise<void> {
  await page.evaluate(
    ([tx, ty, f]) => {
      const d = (window as unknown as { __DECOY__?: Hook }).__DECOY__;
      if (d?.you) d.sendTest({ kind: 'teleport', target: d.you, x: tx, y: ty, face: f });
    },
    [x, y, face] as const,
  );
}

/** 결정적 기다림 (지연 시험마다 다른 위상) */
const waits = (n: number): number[] => {
  let s = 12345;
  return Array.from({ length: n }, () => {
    s = (s * 16807) % 2147483647;
    return 150 + Math.round((s / 2147483647) * 270);
  });
};

async function measure(browser: Browser, sc: Scene): Promise<Saved> {
  const context = await browser.newContext({
    viewport: sc.phone ? { width: 915, height: 412 } : { width: 960, height: 540 },
    deviceScaleFactor: sc.phone ? 2.625 : 1,
    isMobile: sc.phone ?? false,
    hasTouch: sc.phone ?? false,
    ...(sc.phone ? { userAgent: ANDROID_UA } : {}),
  });
  await context.addInitScript(installMotionHooks, { seed: SEED, hz: sc.hz, heavy: sc.heavy ?? null });
  await context.addInitScript(() => {
    Element.prototype.requestFullscreen = function () {
      return Promise.resolve();
    };
  });
  const page = await context.newPage();
  let server: { base: string; proc: ChildProcess } | null = null;
  try {
    const q = [
      'debug=hook',
      `quality=${sc.quality ?? 'low'}`,
      sc.project === 'canvas' ? 'renderer=canvas' : '',
      sc.limit ? `fpsLimit=${sc.limit}` : '',
      sc.scale !== undefined ? `scale=${sc.scale}` : '',
      sc.lag ? `lag=${sc.lag}` : '',
    ]
      .filter((s) => s !== '')
      .join('&');
    if (sc.mode === 'practice') {
      await page.goto(`/?${q}`);
      await page.getByTestId('practice').click();
      await page.getByTestId(`practice-role-${sc.role}`).click();
    } else {
      server = await startQuickServer();
      await page.goto(`${server.base}/?${q}&name=${encodeURIComponent('측정')}`);
      await page.getByTestId('quick-match').click();
      await page.getByTestId(`role-${sc.role}`).click();
    }
    await page.waitForFunction(
      (role) => {
        const d = (window as unknown as { __DECOY__?: Hook }).__DECOY__;
        return (d?.getLastSnapshot() ?? null) !== null && (d?.getDrawn().length ?? 0) > 0 && d?.role === role;
      },
      sc.role,
      { timeout: 90_000, polling: 250 },
    );
    if (!sc.adaptive) {
      await page.evaluate(
        (f) => (window as unknown as { __DECOY__?: Hook }).__DECOY__?.injectFps(f),
        sc.limit ? Number(sc.limit) : (sc.hz ?? 60),
      );
    }
    if (sc.mode === 'practice') {
      await page.waitForFunction(
        () => ((window as unknown as { __DECOY__?: Hook }).__DECOY__?.getTruth()?.players.length ?? 0) === 4,
      );
      await page.evaluate(() => {
        const d = (window as unknown as { __DECOY__?: Hook }).__DECOY__;
        for (const p of d?.getTruth()?.players ?? [])
          if (p.id !== d?.you) d?.sendTest({ kind: 'freeze', target: p.id, frozen: true });
      }, null);
    }
    // 괴물은 위를 보고 걷는다 (앞당김이 위아래로만 — 맵 오른쪽 끝에 창이 막히지 않게)
    const face = sc.role === 'monster' ? -Math.PI / 2 : 0;
    const cdp = await context.newCDPSession(page);
    if (sc.cpu) await cdp.send('Emulation.setCPUThrottlingRate', { rate: sc.cpu });
    await page.waitForTimeout(Number(process.env.DECOY_MOTION_PREWAIT ?? 1500));
    // 걷기: 오른쪽 1.8초 · 왼쪽 1.8초 × 3
    await page.evaluate(
      () => (window as unknown as { __MOTION__: { start(): void } }).__MOTION__.start(),
      null,
    );
    for (let rep = 0; rep < 3; rep += 1) {
      await teleport(page, 28.5, 16.5, face);
      await page.waitForTimeout(900);
      await page.keyboard.down('KeyD');
      await page.waitForTimeout(1800);
      await page.keyboard.up('KeyD');
      await page.waitForTimeout(300);
      await page.keyboard.down('KeyA');
      await page.waitForTimeout(1800);
      await page.keyboard.up('KeyA');
      await page.waitForTimeout(300);
    }
    type Raw = {
      frames: MotionFrame[];
      keys: MotionKey[];
      heavyFrames: number;
      dpr: number;
      longTasks: { t: number; ms: number }[];
    };
    const walkRaw = await page.evaluate(
      () => (window as unknown as { __MOTION__: { stop(): Raw } }).__MOTION__.stop(),
      null,
    );
    // 지연: 짧게 누르고 떼기 32번 (오른쪽 · 왼쪽 번갈아, 누르기 전 기다림을 바꿔 입력 틱 위상을 섞는다)
    await teleport(page, 33, 16.5, face);
    await page.waitForTimeout(900);
    await page.evaluate(
      () => (window as unknown as { __MOTION__: { start(): void } }).__MOTION__.start(),
      null,
    );
    const ws = waits(32);
    for (let i = 0; i < ws.length; i += 1) {
      await page.waitForTimeout(ws[i] ?? 200);
      const key = i % 2 === 0 ? 'KeyD' : 'KeyA';
      await page.keyboard.down(key);
      await page.waitForTimeout(220);
      await page.keyboard.up(key);
      await page.waitForTimeout(380);
    }
    const latRaw = await page.evaluate(
      () => (window as unknown as { __MOTION__: { stop(): Raw } }).__MOTION__.stop(),
      null,
    );
    if (sc.cpu) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    const gfx = await page.evaluate(
      () => (window as unknown as { __DECOY__?: Hook }).__DECOY__?.gfx ?? null,
      null,
    );
    return {
      scene: sc,
      walk: walkStats(walkRaw.frames, walkRaw.keys, walkRaw.dpr, SETTLE_MS),
      latency: latencyStats(latRaw.frames, latRaw.keys, latRaw.dpr),
      excerpt: excerpt(walkRaw.frames, walkRaw.keys, walkRaw.dpr, SETTLE_MS, 24),
      heavyFrames: walkRaw.heavyFrames,
      gfx,
      ...(process.env.DECOY_MOTION_DUMP === '1'
        ? { raw: { frames: walkRaw.frames, keys: walkRaw.keys, longTasks: walkRaw.longTasks } }
        : {}),
    };
  } finally {
    await context.close();
    server?.proc.kill('SIGTERM');
  }
}

for (const sc of SCENES) {
  test(`[${sc.project}] motion ${sc.name}`, async ({ browser }) => {
    test.setTimeout(240_000);
    const data = await measure(browser, sc);
    console.log(`${LABEL} ${sc.name} ${JSON.stringify({ walk: data.walk, latency: data.latency })}`);
    save(sc.name, data);
  });
}

// 내 움직임 고르기 (2026-10-24, docs/PERF.md 5절 · DECISIONS 10절): 따라가는 카메라(확대 3)에서 내 캐릭터가 같은 빠르기로 걸을 때
// 프레임마다 ① 그린 자리가 프레임 간격 × 빠르기만큼 움직이고 ③ 화면 위 내 자리(카메라 기준)가 흔들리지 않는지 본다.
//  - 가상 시계(tests/helpers/virtualClock.ts) + 봇과 연습(Canvas · 품질 낮음, 확대 3): 60Hz · 120Hz, 그리고 바쁜 120Hz
//    (타이머가 0~6ms 늦게 깨고 vsync의 25%를 건너뜀 — 120Hz를 고르게 못 버티는 휴대폰)
//  - 봇을 묶고 열린 바닥(y 16.5, x 28.5 → 37.5)을 오른쪽으로 1.8초 걷는다. 누른 뒤 0.7초(따라가기 늦음이 가라앉는 시간)부터 뗄 때까지
//  - 고치기 전에는 입력 틱을 처리한 시각부터 보간하고(늦게 깬 타이머만큼 멈칫 → 튐), 서버가 마지막 입력까지 처리한 스냅샷마다
//    보간 구간이 사라져(prev = state) 한 틱만큼 튀었다 — 60Hz에서도 프레임의 약 19%가 멈칫 · 튐, 화면 위 자리 폭 6.6px
//  - 입력 지연: 키를 누른 뒤 첫 움직임이 다음 입력 틱 + 한 프레임 안에 그려진다 (보간 때문에 늘지 않는다)
import { expect, test, type Browser, type Page } from '@playwright/test';
import { installVirtualClock, type VirtualClockConfig } from '../helpers/virtualClock';
import { newPlayerPage } from './helpers';

const QUERY = '/?debug=hook&renderer=canvas&quality=low';
const SEED = 20_261_024;
const SETTLE_MS = 700;
const WALK_MS = 1800;

interface TraceFrame {
  t: number;
  drawn: number;
  mx: number;
  my: number;
  px: number;
  py: number;
  k: number;
}

interface TraceStore {
  on: boolean;
  frames: TraceFrame[];
  keys: { t: number; type: string }[];
}

/** 페이지 안: 판 장면이 그린 프레임마다 내 예측 자리 · 그린 내 엔티티의 화면 자리를 적는다 (가상 시계 rAF를 감싼다) */
function installSelfTrace(): void {
  interface Hook {
    getRenderPos(): { x: number; y: number } | null;
    getDrawn(): { kind: string; x: number; y: number }[];
    getAnimState(): { frames: number } | null;
    tileToClient(x: number, y: number): { x: number; y: number } | null;
  }
  const store: TraceStore = { on: false, frames: [], keys: [] };
  (window as unknown as { __TRACE__: TraceStore }).__TRACE__ = store;
  for (const type of ['keydown', 'keyup'])
    window.addEventListener(
      type,
      (e) => {
        if (store.on && !(e as KeyboardEvent).repeat) store.keys.push({ t: performance.now(), type });
      },
      true,
    );
  let last = -1;
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb: FrameRequestCallback): number =>
    raf((t: number) => {
      cb(t);
      if (!store.on) return;
      const d = (window as unknown as { __DECOY__?: Hook }).__DECOY__;
      const me = d?.getRenderPos();
      const drawn = d?.getAnimState()?.frames ?? -1;
      if (!d || !me || drawn === last) return;
      last = drawn;
      const self = d.getDrawn().find((e) => e.kind === 'self') ?? me;
      const p = d.tileToClient(self.x, self.y);
      const c0 = d.tileToClient(0, 0);
      const c1 = d.tileToClient(1, 0);
      if (!p || !c0 || !c1) return;
      store.frames.push({ t, drawn, mx: me.x, my: me.y, px: p.x, py: p.y, k: c1.x - c0.x });
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

interface Walk {
  /** 프레임 쌍마다 그린 자리 이동 ÷ (평균 빠르기 × 간격) */
  ratios: number[];
  /** 프레임 쌍마다 화면 위 내 자리 변화 (px) */
  screen: number[];
  intervals: number[];
  /** 누른 뒤 처음 움직인 프레임까지 (ms) */
  firstMove: number;
}

async function walk(browser: Browser, cfg: VirtualClockConfig): Promise<Walk> {
  const { context, page, problems } = await newPlayerPage(browser);
  await context.addInitScript(installVirtualClock, cfg);
  await context.addInitScript(installSelfTrace);
  await page.routeWebSocket(/\/ws$/, (ws) => ws.close({ code: 1011, reason: 'blocked' }));
  try {
    await page.goto(QUERY);
    await expect(page.getByTestId('practice')).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.__DECOY__?.fonts.ready === true)).toBe(true);
    await context.setOffline(true);
    await page.waitForTimeout(300);
    await page.evaluate(() => window.__VCLOCK__?.pump(false));
    await domClick(page, 'practice');
    await advance(page, 500);
    await domClick(page, 'practice-role-runner');
    // 판 시작: 기기 안 판의 네 명이 보일 때까지
    for (let i = 0; i < 100; i += 1) {
      await advance(page, 100);
      const n = await page.evaluate(() => window.__DECOY__?.getTruth()?.players.length ?? 0);
      if (n === 4 && (await page.evaluate(() => (window.__DECOY__?.getDrawn().length ?? 0) > 0))) break;
    }
    expect(await page.evaluate(() => window.__DECOY__?.transport)).toBe('local');
    await page.evaluate((hz) => {
      const d = window.__DECOY__;
      d?.injectFps(hz);
      for (const p of d?.getTruth()?.players ?? [])
        if (p.id !== d?.you) d?.sendTest({ kind: 'freeze', target: p.id, frozen: true });
      if (d?.you) d.sendTest({ kind: 'teleport', target: d.you, x: 28.5, y: 16.5, face: 0 });
    }, cfg.hz);
    await advance(page, 1200);
    await page.evaluate(() => {
      (window as unknown as { __TRACE__: TraceStore }).__TRACE__.on = true;
    });
    await advance(page, 200);
    await page.keyboard.down('KeyD');
    await advance(page, WALK_MS);
    await page.keyboard.up('KeyD');
    await advance(page, 100);
    const trace = await page.evaluate(() => {
      const s = (window as unknown as { __TRACE__: TraceStore }).__TRACE__;
      s.on = false;
      return { frames: s.frames, keys: s.keys };
    });
    expect(problems, '콘솔 에러 · 경고').toEqual([]);
    const down = trace.keys.find((k) => k.type === 'keydown')?.t;
    const up = trace.keys.find((k) => k.type === 'keyup')?.t;
    if (down === undefined || up === undefined) throw new Error('키 기록 없음');
    const rest = [...trace.frames].reverse().find((f) => f.t <= down);
    const moved = trace.frames.find(
      (f) => f.t > down && rest && Math.hypot(f.mx - rest.mx, f.my - rest.my) > 1e-3,
    );
    const fr = trace.frames.filter((f) => f.t >= down + SETTLE_MS && f.t <= up);
    expect(fr.length, '걷는 동안 그린 프레임').toBeGreaterThan((cfg.hz * (WALK_MS - SETTLE_MS)) / 1000 / 2);
    const first = fr[0];
    const last = fr[fr.length - 1];
    if (!first || !last || !moved) throw new Error('걷기 기록 없음');
    const v = Math.hypot(last.mx - first.mx, last.my - first.my) / (last.t - first.t);
    const out: Walk = { ratios: [], screen: [], intervals: [], firstMove: moved.t - down };
    for (let i = 1; i < fr.length; i += 1) {
      const a = fr[i - 1];
      const b = fr[i];
      if (!a || !b) continue;
      const dt = b.t - a.t;
      out.intervals.push(dt);
      out.ratios.push(Math.hypot(b.mx - a.mx, b.my - a.my) / (v * dt));
      out.screen.push(Math.hypot(b.px - a.px, b.py - a.py));
    }
    // 빠르기가 맞는지 (타일/초): 생존자 걷기 빠르기 × 러너 배율 그대로 — 잰 구간이 실제로 걷는 중이었다
    expect(v * 1000).toBeGreaterThan(3);
    return out;
  } finally {
    await context.close();
  }
}

const SCENES: { name: string; cfg: VirtualClockConfig }[] = [
  { name: '60Hz', cfg: { seed: SEED, hz: 60 } },
  { name: '120Hz', cfg: { seed: SEED, hz: 120 } },
  {
    name: '바쁜 120Hz (타이머 0~6ms 늦음 · vsync 25% 건너뜀)',
    cfg: { seed: SEED, hz: 120, timerLateMs: 6, dropFrames: 0.25 },
  },
];

for (const sc of SCENES) {
  test(
    `따라가는 카메라에서 내 캐릭터 화면 이동이 프레임마다 고르다 — ${sc.name}`,
    { tag: '@core' },
    async ({ browser }) => {
      test.setTimeout(150_000);
      const w = await walk(browser, sc.cfg);
      const lo = Math.min(...w.ratios);
      const hi = Math.max(...w.ratios);
      const shake = Math.max(...w.screen);
      console.log(
        `[smooth-motion] ${sc.name}: 프레임 ${w.ratios.length + 1}개 · 간격 ${Math.min(...w.intervals).toFixed(2)}~${Math.max(...w.intervals).toFixed(2)}ms · ` +
          `① 비율 ${lo.toFixed(4)}~${hi.toFixed(4)} · ③ 프레임당 변화 최대 ${shake.toFixed(4)}px · 첫 움직임 ${w.firstMove.toFixed(1)}ms`,
      );
      if (sc.cfg.dropFrames) expect(Math.max(...w.intervals), '건너뛴 vsync가 섞였다').toBeGreaterThan(15);
      // ① 그린 자리 이동 = 빠르기 × 프레임 간격 (멈칫 · 튐 없음)
      expect(lo, '① 가장 덜 움직인 프레임 (멈칫)').toBeGreaterThan(0.98);
      expect(hi, '① 가장 많이 움직인 프레임 (튐)').toBeLessThan(1.02);
      // ③ 카메라 기준 화면 위 내 자리: 같은 빠르기면 따라가기 늦음이 그대로라 움직이지 않는다 (격자 맞추기 반 픽셀도 없다)
      expect(shake, '③ 화면 위 내 자리 프레임당 변화 (px)').toBeLessThan(0.05);
      // 입력 지연: 다음 입력 틱(최대 1/30초) + 한 프레임 안 (vsync를 건너뛰는 장면은 건너뛴 두 칸까지)
      const frames = sc.cfg.dropFrames ? 3 : 1;
      expect(w.firstMove).toBeLessThanOrEqual(1000 / 30 + (frames * 1000) / sc.cfg.hz + 1);
    },
  );
}

// 내 빛 따라가기 (WebGL · SwiftShader · 봇과 연습 · 가상 시계 120Hz): 안개 주기(생존자 50ms · 괴물 1/30초) 사이에도 내 시야 빛이
// 지금 내 자리를 따라온다. 예전에는 빛 지도 · 틴트 · 테두리가 안개 주기에만 다시 그려져 그 사이 월드에 붙어 있었고, 카메라가 따라가는
// 내 몸과 빛이 화면에서 주기마다 톱니로 어긋났다(생존자 걷기 0.25타일 · 괴물 0.18타일).
//  - 걷는 중 안개를 다시 그린 프레임(A, Δ = 0)과 몇 프레임 뒤(B, 같은 안개 주기)를 찍어 같은 바닥 점(타일)의 밝기 비 B/A를 잰다.
//    바닥 무늬는 비에서 지워지고(창 자리는 기기 픽셀 격자에 맞춰 같은 텍셀이 정수 px만큼 옮겨진다) 빛 비만 남는다. 예전 동작이면 1
//  - 생존자(맵 전체 고정 화면 ?cam=1): 내 둘레 흐림 띠 위 점들의 비가 'Δ만큼 옮긴 빛'의 비(lightAt(지금 눈) / lightAt(주기 눈))와
//    맞는다 — 품질 중간(경계 노이즈 없음)은 식과 ±0.045, 높음(경계 노이즈)은 방향만(앞 밝아짐 · 뒤 어두워짐)
//  - 괴물(따라가는 카메라 확대): 빛 지도를 통째로 Δ만큼 옮겨 읽는다 — 근접 원 경계의 앞 띠는 밝아지고 뒤 띠는 어두워진다
//  - 콘솔 에러 · 경고 0
import { readFileSync } from 'node:fs';
import { expect, test, type Browser, type Page } from '@playwright/test';
import {
  monsterConePolygon,
  monsterNearPolygon,
  pointInPolygon,
  survivorVisionPolygon,
  survivorVisionRadius,
  validateBalance,
  type Vec2,
} from '@decoy/shared';
import { FOG } from '../../client/src/render/colors';
import { ambientRgb, lightAt } from '../../client/src/render/fogMath';
import { installVirtualClock } from '../helpers/virtualClock';
import { CAM1, newPlayerPage } from './helpers';

const balance = validateBalance(JSON.parse(readFileSync('config/balance.json', 'utf8')));
const HZ = 120;
const SEED = 20_261_101;
/** 걷기 시작 자리 (열린 바닥, 거점 · 탈출구 · 팀원 빛에서 먼 곳) */
const START = { x: 25.5, y: 16.5 };
/** 다른 플레이어(봇)를 둘 먼 자리 (역할별) */
const FAR: Record<string, Vec2> = {
  guard: { x: 7, y: 16 },
  scout: { x: 8, y: 17 },
  runner: { x: 7, y: 15 },
  monster: { x: 45, y: 28 },
};

/**
 * 빛 지도 바탕은 하한 × 청회색 틴트(채널마다 다르다)라 밝기(Rec.709 가중 합)로 본 하한은 FOG.ambient(0.45)가 아니라 채널 하한의
 * 가중 합이다 (회색 바닥으로 어림): 화면 밝기 비 = 이 하한으로 잰 빛의 비
 */
const LUMA_AMBIENT = ((): number => {
  const [r, g, b] = ambientRgb(FOG.ambient, FOG.tint);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
})();

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

interface FrameInfo {
  fogAt: number | null;
  fogEye: Vec2 | null;
  fogShift: Vec2;
  fogFollow: string;
  /** 타일 → 화면(CSS px): (0, 0)의 자리 · 타일당 px */
  c0: Vec2;
  k: number;
  /** 괴물 화면: 내 부채꼴 (정보 레이어) */
  cone: { dir: number; blend: number } | null;
}

async function frameInfo(page: Page): Promise<FrameInfo> {
  return page.evaluate(() => {
    const d = window.__DECOY__;
    const a = d?.getAnimState();
    if (!d || !a) throw new Error('연출 상태 없음');
    const c0 = d.tileToClient(0, 0);
    const c1 = d.tileToClient(1, 0);
    if (!c0 || !c1) throw new Error('tileToClient 없음');
    const cone = d.getInfoLayer().find((i) => i.kind === 'cone' && i.tag === 'self');
    return {
      fogAt: a.fogAt,
      fogEye: a.fogEye,
      fogShift: a.fogShift,
      fogFollow: a.fogFollow,
      c0: { x: c0.x, y: c0.y },
      k: c1.x - c0.x,
      cone: cone && cone.dir !== null ? { dir: cone.dir, blend: a.myBlend ?? 0 } : null,
    };
  });
}

/** 찍어 둔 스크린샷에서 타일 점마다 (2h + 1)² px 평균 밝기 (Rec.709 가중 합). 타일 → 화면은 찍을 때의 카메라(f) */
async function lumas(
  page: Page,
  shot: Buffer,
  f: FrameInfo,
  pts: readonly Vec2[],
  h: number,
): Promise<number[]> {
  return page.evaluate(
    async ({ b64, px, h }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('2D 컨텍스트 없음');
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, c.width, c.height).data;
      return px.map((p) => {
        const cx = Math.round(p.x * window.devicePixelRatio);
        const cy = Math.round(p.y * window.devicePixelRatio);
        let sum = 0;
        let n = 0;
        for (let y = cy - h; y <= cy + h; y += 1)
          for (let x = cx - h; x <= cx + h; x += 1) {
            const i = (y * c.width + x) * 4;
            sum += 0.2126 * (data[i] ?? 0) + 0.7152 * (data[i + 1] ?? 0) + 0.0722 * (data[i + 2] ?? 0);
            n += 1;
          }
        return sum / n;
      });
    },
    {
      b64: shot.toString('base64'),
      px: pts.map((p) => ({ x: f.c0.x + p.x * f.k, y: f.c0.y + p.y * f.k })),
      h,
    },
  );
}

interface Probe {
  p: Vec2;
  /** 'Δ만큼 옮긴 빛'의 밝기 비 (지금 / 안개 주기, 생존자만 — 괴물은 NaN) */
  expect: number;
  ahead: boolean;
}

/**
 * 생존자 잴 점: 지금 눈에서 흐림 띠 안(r − 0.95 · r − 0.6) 앞뒤 여러 방향. 두 프레임 모두 시야 다각형 안(벽 그림자 · 테두리 밖)이고
 * 몸 · 테두리에서 먼 점만
 */
function survivorProbes(fogEye: Vec2, now: Vec2): Probe[] {
  const r = survivorVisionRadius(balance, 'runner');
  const soft = balance.survivor.visionSoftEdge;
  const polyNow = survivorVisionPolygon(now, r - 0.3);
  const polyFog = survivorVisionPolygon(fogEye, r - 0.3);
  const out: Probe[] = [];
  const dir = Math.atan2(now.y - fogEye.y, now.x - fogEye.x);
  for (const d of [r - 0.95, r - 0.6])
    for (const deg of [-50, -25, 0, 25, 50, 130, 155, 180, 205, 230]) {
      const a = dir + (deg * Math.PI) / 180;
      const p = { x: now.x + Math.cos(a) * d, y: now.y + Math.sin(a) * d };
      if (!pointInPolygon(p, polyNow) || !pointInPolygon(p, polyFog)) continue;
      const lNow = lightAt(Math.hypot(p.x - now.x, p.y - now.y), r, soft, LUMA_AMBIENT);
      const lFog = lightAt(Math.hypot(p.x - fogEye.x, p.y - fogEye.y), r, soft, LUMA_AMBIENT);
      out.push({ p, expect: lNow / lFog, ahead: Math.abs(deg) < 90 });
    }
  return out;
}

/**
 * 괴물 잴 점: 근접 원 경계를 Δ만큼 옮겨 생긴 띠의 가운데 (앞: 주기 원 밖 · 옮긴 원 안 → 밝아짐, 뒤: 반대). 부채꼴(주기 · 옮긴 것)
 * 안 · 경계 근처는 뺀다
 */
function monsterProbes(fogEye: Vec2, shift: Vec2, cone: { dir: number; blend: number }): Probe[] {
  const nr = balance.monster.nearVisionRadius;
  const len = Math.hypot(shift.x, shift.y);
  const dir = Math.atan2(shift.y, shift.x);
  const coneFog = monsterConePolygon(balance, fogEye, cone.dir, cone.blend);
  const near = monsterNearPolygon(balance, fogEye);
  const out: Probe[] = [];
  // 부채꼴(위쪽 110°)과 겹치지 않는 앞뒤 방향만
  for (const deg of [-20, -10, 0, 10, 20, 160, 170, 180, 190, 200]) {
    const a = dir + (deg * Math.PI) / 180;
    const ahead = Math.abs(deg) < 90;
    // 주기 원 경계에서 Δ 방향 성분의 절반만큼 바깥(앞) · 안(뒤)
    const along = Math.abs(Math.cos(a - dir)) * len;
    const d = nr + (ahead ? along / 2 : -along / 2);
    const p = { x: fogEye.x + Math.cos(a) * d, y: fogEye.y + Math.sin(a) * d };
    const q = { x: p.x - shift.x, y: p.y - shift.y };
    // 벽에 잘린 근접 원 · 부채꼴에 걸리는 점은 뺀다 (판정 다각형 그대로)
    const inFog = pointInPolygon(p, near) || pointInPolygon(p, coneFog);
    const inNow = pointInPolygon(q, near) || pointInPolygon(q, coneFog);
    if (ahead ? inFog || !inNow : !inFog || inNow) continue;
    out.push({ p, expect: Number.NaN, ahead });
  }
  return out;
}

async function startPractice(
  browser: Browser,
  role: 'runner' | 'monster',
  query: string,
): Promise<{ page: Page; problems: string[]; close: () => Promise<void> }> {
  // 괴물은 따라가는 카메라(확대)라 넓은 창으로 띠(Δ ≈ 0.14타일)를 화면 px로 넓힌다
  const { context, page, problems } = await newPlayerPage(
    browser,
    role === 'monster' ? { viewport: { width: 1600, height: 900 } } : undefined,
  );
  await context.addInitScript(installVirtualClock, { seed: SEED, hz: HZ });
  await page.routeWebSocket(/\/ws$/, (ws) => ws.close({ code: 1011, reason: 'blocked' }));
  await page.goto(`/?debug=hook&renderer=webgl${query}`);
  await expect(page.getByTestId('practice')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__DECOY__?.fonts.ready === true)).toBe(true);
  await context.setOffline(true);
  await page.waitForTimeout(300);
  await page.evaluate(async () => {
    await window.__VCLOCK__?.pump(false);
  });
  await domClick(page, 'practice');
  await advance(page, 500);
  await domClick(page, `practice-role-${role}`);
  for (let i = 0; i < 150; i += 1) {
    await advance(page, 100);
    const n = await page.evaluate(() => window.__DECOY__?.getTruth()?.players.length ?? 0);
    if (n === 4 && (await page.evaluate(() => (window.__DECOY__?.getDrawn().length ?? 0) > 0))) break;
  }
  // 품질 자동 하향을 막고(SwiftShader), 장식 시계를 멈춘다(경계 노이즈 · 먼지가 두 프레임 사이 흐르지 않게).
  // 다른 플레이어는 멀리 묶고 나는 열린 바닥에 선다 (괴물은 위를 보게: 오른쪽으로 걸을 때 부채꼴이 앞뒤 근접 원 경계를 덮지 않게)
  const face = role === 'monster' ? -Math.PI / 2 : 0;
  await page.evaluate(
    ({ start, far, hz, face }) => {
      const d = window.__DECOY__;
      if (!d) throw new Error('디버그 훅 없음');
      d.injectFps(hz);
      d.freezeClock(1000);
      for (const p of d.getTruth()?.players ?? []) {
        if (p.id === d.you) continue;
        const at = far[p.role];
        if (at) d.sendTest({ kind: 'teleport', target: p.id, x: at.x, y: at.y, face: 0 });
        d.sendTest({ kind: 'freeze', target: p.id, frozen: true });
      }
      if (d.you) {
        d.sendTest({ kind: 'teleport', target: d.you, x: start.x, y: start.y, face });
        // 괴물 대기 시간(판 시작 5초)을 건너뛴다 (SwiftShader가 그 동안을 그리지 않게)
        d.sendTest({ kind: 'freeze', target: d.you, frozen: false });
      }
    },
    { start: START, far: FAR, hz: HZ, face },
  );
  await advance(page, 1500);
  return { page, problems, close: () => context.close() };
}

/** 걷는 중 안개를 다시 그린 프레임(A)과 n프레임 뒤(B, 같은 안개 주기)를 찍는다 */
async function walkPair(
  page: Page,
  n: number,
): Promise<{ a: FrameInfo; b: FrameInfo; shotA: Buffer; shotB: Buffer }> {
  await page.keyboard.down('KeyD');
  await advance(page, 450);
  let a = await frameInfo(page);
  for (let i = 0; i < 12; i += 1) {
    await advance(page, 1000 / HZ);
    const next = await frameInfo(page);
    const fresh = next.fogAt !== a.fogAt;
    a = next;
    if (fresh) break;
  }
  const shotA = await page.screenshot();
  await advance(page, (n * 1000) / HZ);
  const b = await frameInfo(page);
  const shotB = await page.screenshot();
  await page.keyboard.up('KeyD');
  return { a, b, shotA, shotB };
}

async function measureSurvivor(
  browser: Browser,
  quality: 'medium' | 'high',
): Promise<{ probes: (Probe & { got: number })[]; a: FrameInfo; b: FrameInfo; problems: string[] }> {
  const s = await startPractice(browser, 'runner', `&quality=${quality}${CAM1}`);
  try {
    const { a, b, shotA, shotB } = await walkPair(s.page, 5);
    expect(a.fogShift, '안개를 다시 그린 프레임은 Δ = 0').toEqual({ x: 0, y: 0 });
    expect(a.fogFollow).toBe('gpu');
    expect(b.fogAt, '같은 안개 주기 (생존자 50ms = 120Hz 6프레임)').toBe(a.fogAt);
    const fogEye = a.fogEye;
    if (!fogEye) throw new Error('안개 주기에 내 눈이 없다');
    const eyeNow = { x: fogEye.x + b.fogShift.x, y: fogEye.y + b.fogShift.y };
    const list = survivorProbes(fogEye, eyeNow);
    const pts = list.map((x) => x.p);
    const la = await lumas(s.page, shotA, a, pts, 2);
    const lb = await lumas(s.page, shotB, b, pts, 2);
    return {
      probes: list.map((x, i) => ({ ...x, got: (lb[i] ?? 0) / Math.max(1e-6, la[i] ?? 0) })),
      a,
      b,
      problems: s.problems,
    };
  } finally {
    await s.close();
  }
}

for (const quality of ['medium', 'high'] as const) {
  test(`생존자 · 품질 ${quality}(WebGL): 안개 주기 사이에도 내 시야 빛이 지금 자리를 따라온다`, async ({
    browser,
  }) => {
    test.setTimeout(300_000);
    const m = await measureSurvivor(browser, quality);
    console.log(
      `[fog-follow] 생존자 ${quality} Δ ${JSON.stringify(m.b.fogShift)} 눈 ${JSON.stringify(m.a.fogEye)}: ${m.probes
        .map((x) => `${x.ahead ? '앞' : '뒤'} 기대 ${x.expect.toFixed(3)} 잰 ${x.got.toFixed(3)}`)
        .join(' · ')}`,
    );
    expect(m.problems).toEqual([]);
    expect(Math.hypot(m.b.fogShift.x, m.b.fogShift.y), 'Δ (5프레임 걷기)').toBeGreaterThan(0.12);
    expect(m.probes.length).toBeGreaterThanOrEqual(10);
    for (const x of m.probes) {
      // 앞은 밝아지고 뒤는 어두워진다 (예전에는 빛이 그대로라 비 1)
      if (x.ahead) expect(x.got, `앞 ${JSON.stringify(x.p)}`).toBeGreaterThan(1.03);
      else expect(x.got, `뒤 ${JSON.stringify(x.p)}`).toBeLessThan(0.97);
      // 중간: 경계 노이즈가 없어 비가 식과 바로 맞는다 (예전 동작 비 1은 식에서 0.077 이상 멀다)
      if (quality === 'medium')
        expect(Math.abs(x.got - x.expect), `점 ${JSON.stringify(x.p)}`).toBeLessThan(0.045);
    }
  });
}

test('괴물 · 품질 중간(WebGL, 따라가는 카메라): 안개 주기 사이에도 자기 시야 빛을 통째로 지금 자리로 옮겨 그린다', async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const s = await startPractice(browser, 'monster', '&quality=medium');
  try {
    // 괴물 안개 주기 1/30초 = 120Hz 4프레임 → 3프레임 뒤
    const { a, b, shotA, shotB } = await walkPair(s.page, 3);
    expect(a.fogShift).toEqual({ x: 0, y: 0 });
    expect(a.fogFollow).toBe('gpu');
    expect(b.fogAt, '같은 안개 주기').toBe(a.fogAt);
    const fogEye = a.fogEye;
    if (!fogEye || !a.cone) throw new Error('안개 주기에 내 눈 · 부채꼴이 없다');
    const list = monsterProbes(fogEye, b.fogShift, a.cone);
    const pts = list.map((x) => x.p);
    const la = await lumas(s.page, shotA, a, pts, 1);
    const lb = await lumas(s.page, shotB, b, pts, 1);
    const got = list.map((x, i) => ({ ...x, got: (lb[i] ?? 0) / Math.max(1e-6, la[i] ?? 0) }));
    console.log(
      `[fog-follow] 괴물 Δ ${JSON.stringify(b.fogShift)} 눈 ${JSON.stringify(fogEye)} 카메라 ${a.k.toFixed(2)}px/타일: ${got
        .map((x) => `${x.ahead ? '앞' : '뒤'} ${x.got.toFixed(3)}`)
        .join(' · ')}`,
    );
    expect(s.problems).toEqual([]);
    expect(Math.hypot(b.fogShift.x, b.fogShift.y) * a.k, 'Δ (화면 px)').toBeGreaterThan(6);
    expect(got.length).toBeGreaterThanOrEqual(4);
    for (const x of got) {
      if (x.ahead) expect(x.got, `앞 ${JSON.stringify(x.p)}`).toBeGreaterThan(1.25);
      else expect(x.got, `뒤 ${JSON.stringify(x.p)}`).toBeLessThan(0.8);
    }
  } finally {
    await s.close();
  }
});

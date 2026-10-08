// M10b 맵 · 오브젝트 E2E 공용 (m10-map.spec.ts = Canvas 낮음, m10-map.webgl.spec.ts = WebGL 높음).
// 봇 방 탭 하나로 장면을 놓고 스크린샷 픽셀을 잰다. 대비는 WCAG 상대휘도, 색 차이는 CIE76 ΔE(Lab).
import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import type { InfoItem, TestCommand } from '@decoy/shared';
import { watchConsole } from './helpers';

export type Rgb = [number, number, number];

export interface Session {
  context: BrowserContext;
  page: Page;
  problems: string[];
  /** 테스트 명령 (teleport 뒤에는 그 대상을 다시 멈춘다: teleport가 멈춤을 푼다) */
  send(cmd: TestCommand): Promise<void>;
  id(role: string): string;
}

/** 봇 방을 열어 role로 시작하고 봇은 모두 멈춘다 (FPS는 60으로 덮어써 판 중 자동 하향을 막는다) */
export async function startBotRoom(browser: Browser, query: string, role = 'runner'): Promise<Session> {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const problems: string[] = [];
  watchConsole(page, problems);
  await page.goto(`/?bots=1&debug=hook${query}`);
  await page.waitForFunction(() => window.__DECOY__ !== undefined);
  await page.evaluate(() => window.__DECOY__?.injectFps(60));
  await page.getByTestId('create-room').click();
  await page.getByTestId(`role-${role}`).click();
  await page.getByTestId('ready-button').click();
  await page.getByTestId('start-button').click();
  await page.waitForFunction(() => (window.__DECOY__?.snapCount ?? 0) > 5, null, { timeout: 30_000 });
  const room = await page.evaluate(() => window.__DECOY__?.room ?? '');
  const truth = (await (await page.request.get(`/test/state?room=${room}`)).json()) as {
    players: { id: string; role: string }[];
  };
  const id = (r: string): string => truth.players.find((p) => p.role === r)?.id ?? '';
  const raw = (cmd: TestCommand): Promise<void> => page.evaluate((c) => window.__DECOY__?.sendTest(c), cmd);
  const send = async (cmd: TestCommand): Promise<void> => {
    await raw(cmd);
    if (cmd.kind === 'teleport') await raw({ kind: 'freeze', target: cmd.target, frozen: true });
  };
  for (const r of ['monster', 'runner', 'guard', 'scout'])
    await raw({ kind: 'freeze', target: id(r), frozen: true });
  return { context, page, problems, send, id };
}

/** 조작 안내 · 시작 문구를 닫고 장식 시계를 멈춘다 */
export async function settle(page: Page): Promise<void> {
  await page.mouse.move(10, 10);
  await page.keyboard.press('KeyX');
  await page.waitForFunction(() => (window.__DECOY__?.getBanners() ?? []).length === 0, null, {
    timeout: 15_000,
  });
  await page.evaluate(() => window.__DECOY__?.freezeClock(1000));
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 타일 사각형 → 클라이언트 px 사각형 (정수로 내림 · 올림) */
export async function tileRect(page: Page, x0: number, y0: number, x1: number, y1: number): Promise<Rect> {
  const [a, b] = await page.evaluate(
    ([p, q, r, s]) => [window.__DECOY__?.tileToClient(p!, q!), window.__DECOY__?.tileToClient(r!, s!)],
    [x0, y0, x1, y1],
  );
  if (!a || !b) throw new Error('tileToClient 없음');
  const x = Math.floor(a.x);
  const y = Math.floor(a.y);
  return { x, y, w: Math.max(1, Math.ceil(b.x) - x), h: Math.max(1, Math.ceil(b.y) - y) };
}

/** 스크린샷 한 장에서 사각형마다 픽셀 RGB 목록 */
export async function grab(page: Page, rects: Record<string, Rect>): Promise<Record<string, Rgb[]>> {
  const shot = await page.screenshot();
  return page.evaluate(
    async ({ b64, rects }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('2D 컨텍스트 없음');
      ctx.drawImage(img, 0, 0);
      const out: Record<string, [number, number, number][]> = {};
      for (const [name, r] of Object.entries(rects)) {
        const d = ctx.getImageData(r.x, r.y, r.w, r.h).data;
        const px: [number, number, number][] = [];
        for (let i = 0; i < d.length; i += 4) px.push([d[i] ?? 0, d[i + 1] ?? 0, d[i + 2] ?? 0]);
        out[name] = px;
      }
      return out;
    },
    { b64: shot.toString('base64'), rects },
  );
}

function lin(c: number): number {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

export function relLum([r, g, b]: Rgb): number {
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrastL(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

export function meanRgb(px: readonly Rgb[]): Rgb {
  const s = [0, 0, 0];
  for (const p of px) for (let k = 0; k < 3; k += 1) s[k]! += p[k]!;
  const n = Math.max(1, px.length);
  return [s[0]! / n, s[1]! / n, s[2]! / n];
}

/** 픽셀들의 평균 상대휘도 */
export function meanLum(px: readonly Rgb[]): number {
  return px.reduce((a, p) => a + relLum(p), 0) / Math.max(1, px.length);
}

export function maxLum(px: readonly Rgb[]): number {
  return px.reduce((a, p) => Math.max(a, relLum(p)), 0);
}

function lab([r, g, b]: Rgb): Rgb {
  const R = lin(r);
  const G = lin(g);
  const B = lin(b);
  const f = (t: number): number => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  const x = f((0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047);
  const y = f(0.2126 * R + 0.7152 * G + 0.0722 * B);
  const z = f((0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

export function deltaE(a: Rgb, b: Rgb): number {
  const p = lab(a);
  const q = lab(b);
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

export function hexRgb(n: number): Rgb {
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** 원판(중심 · 반지름 px) 안 픽셀 */
export function disc(px: readonly Rgb[], r: Rect, cx: number, cy: number, rad: number): Rgb[] {
  const out: Rgb[] = [];
  for (let j = 0; j < r.h; j += 1)
    for (let i = 0; i < r.w; i += 1) {
      const x = r.x + i + 0.5;
      const y = r.y + j + 0.5;
      const p = px[j * r.w + i];
      if (p && Math.hypot(x - cx, y - cy) <= rad) out.push(p);
    }
  return out;
}

// ───────────── 장면 (두 렌더러가 같은 검사를 한다) ─────────────

/** 장면 1 측정값 */
export interface DarkLitResult {
  wallRim: number;
  pillarRim: number;
  /** 시야 안 바닥과 가드색(역할색 중 가장 어두움)의 대비 */
  litFloorVsGuard: number;
  litFloorLum: number;
  darkFloorLum: number;
  litFloorLumMax: number;
  timeStableMaxDiff: number;
  bakeMs: number;
  glowBakeMs: number;
  textureBytes: number;
  glowLayer: string;
}

const GUARD = 0xa855f7;
// 탐침 자리 (shared/src/map.ts MAP_ROWS): 아래 가운데 벽 덩어리(16~19 × 26~28) 북쪽 테두리, 기둥(23~24 × 24~25) 윗테두리
const WALL_RIM: [number, number, number, number] = [16.6, 25.9, 19.4, 26.25];
const WALL_FLOOR: [number, number, number, number] = [16.8, 25.25, 19.2, 25.6];
const PILLAR_RIM: [number, number, number, number] = [23.65, 23.98, 24.35, 24.3];
const PILLAR_FLOOR: [number, number, number, number] = [23.4, 23.3, 24.6, 23.7];
/** 시야 밖에서 시간이 흘러도 그대로여야 하는 구역 (거점 · 탈출구 · 시야 경계에서 먼 곳) */
const STILL: [number, number, number, number] = [15.5, 21.5, 26.5, 28.8];
const LIT_FLOORS: [number, number][] = [
  [21.5, 27.5],
  [20.5, 23.5],
  [24.5, 27.5],
];

/**
 * 시야 밖 구조 대비 · 시간 불변 · 시야 안 바닥 밝기. 러너 화면: 팀 전원이 탐침 구역에서 멀리 있다가(시야 밖)
 * 러너가 탐침 구역 가운데로 온다(시야 안)
 */
export async function darkAndLit(s: Session): Promise<DarkLitResult> {
  const { page, send, id } = s;
  await send({ kind: 'teleport', target: id('monster'), x: 44.5, y: 12.5, face: 0 });
  await send({ kind: 'teleport', target: id('scout'), x: 45, y: 2 });
  await send({ kind: 'teleport', target: id('guard'), x: 3, y: 2 });
  await send({ kind: 'teleport', target: id('runner'), x: 5, y: 30 });
  await settle(page);
  await page.waitForTimeout(800);
  const rects = {
    wallRim: await tileRect(page, ...WALL_RIM),
    wallFloor: await tileRect(page, ...WALL_FLOOR),
    pillarRim: await tileRect(page, ...PILLAR_RIM),
    pillarFloor: await tileRect(page, ...PILLAR_FLOOR),
    still: await tileRect(page, ...STILL),
  };
  const dark = await grab(page, rects);
  const wallRim = contrastL(maxLum(dark.wallRim!), meanLum(dark.wallFloor!));
  const pillarRim = contrastL(maxLum(dark.pillarRim!), meanLum(dark.pillarFloor!));
  // 시계를 풀어 시간이 흐르게 한 뒤 같은 구역 비교 (어둠 속에서 움직이는 것은 정보 마커뿐: 구조 · 발광은 정적)
  await page.evaluate(() => window.__DECOY__?.freezeClock(null));
  const t0 = await grab(page, { still: rects.still });
  await page.waitForTimeout(1500);
  const t1 = await grab(page, { still: rects.still });
  let timeStableMaxDiff = 0;
  const a = t0.still!;
  const b = t1.still!;
  for (let i = 0; i < a.length; i += 1)
    for (let k = 0; k < 3; k += 1)
      timeStableMaxDiff = Math.max(timeStableMaxDiff, Math.abs(a[i]![k]! - b[i]![k]!));
  await page.evaluate(() => window.__DECOY__?.freezeClock(1000));
  // 시야 안: 러너가 탐침 구역 가운데로
  await send({ kind: 'teleport', target: id('runner'), x: 22.5, y: 25.5 });
  await page.waitForTimeout(800);
  const litRects: Record<string, Rect> = {};
  for (const [n, [x, y]] of LIT_FLOORS.entries())
    litRects[`f${n}`] = await tileRect(page, x - 0.3, y - 0.3, x + 0.3, y + 0.3);
  const lit = await grab(page, litRects);
  const litLums = Object.values(lit).map((px) => meanLum(px));
  const litFloorLum = Math.max(...litLums);
  const litFloorLumMax = Math.max(...Object.values(lit).map((px) => maxLum(px)));
  const g = await page.evaluate(() => window.__DECOY__!.gfx);
  return {
    wallRim,
    pillarRim,
    litFloorVsGuard: contrastL(relLum(hexRgb(GUARD)), litFloorLum),
    litFloorLum,
    darkFloorLum: meanLum(dark.wallFloor!),
    litFloorLumMax,
    timeStableMaxDiff,
    bakeMs: Number(g.features.mapBakeMs ?? -1),
    glowBakeMs: Number(g.features.glowBakeMs ?? -1),
    textureBytes: Number(g.features.textureBytes ?? 0),
    glowLayer: String(g.features.glowLayer ?? ''),
  };
}

/** 장면 1 판정 (두 렌더러 공통) */
export function expectDarkAndLit(r: DarkLitResult): void {
  // 시야 밖에서도 구조 테두리가 인접 바닥과 2.5:1 이상
  expect(r.wallRim).toBeGreaterThanOrEqual(2.5);
  expect(r.pillarRim).toBeGreaterThanOrEqual(2.5);
  // 시야 안 바닥이 역할색 몸과 3:1 이상 (가장 어두운 역할색 가드 기준) — 빛 속 바닥 상대휘도 상한
  expect(r.litFloorVsGuard).toBeGreaterThanOrEqual(3);
  // 빈 통과가 아님: 시야 안이 실제로 밝아졌다
  expect(r.litFloorLum).toBeGreaterThan(r.darkFloorLum * 2);
  // 시야 밖은 시간이 흘러도 그대로 (발광 · 구조가 정적)
  expect(r.timeStableMaxDiff).toBeLessThanOrEqual(1);
  // 굽는 시간 (텍스처 생성 1초 이하)
  expect(r.bakeMs).toBeGreaterThan(0);
  expect(r.bakeMs).toBeLessThan(1000);
}

/** 장면 2: 배지가 캐릭터를 덮지 않음 (러너 거점 A 중심, 가드 감옥 중심 수감) — 몸 원판 평균색 ΔE */
export async function bodiesOverBadges(s: Session): Promise<{ runner: number; guard: number }> {
  const { page, send, id } = s;
  await send({ kind: 'teleport', target: id('monster'), x: 44.5, y: 12.5, face: 0 });
  await send({ kind: 'teleport', target: id('scout'), x: 40, y: 16 });
  await send({ kind: 'setSurvivor', target: id('guard'), status: 'imprisoned', imprisonCount: 1 });
  await send({ kind: 'teleport', target: id('guard'), x: 24, y: 16 });
  await send({ kind: 'teleport', target: id('runner'), x: 8, y: 16 });
  await page.waitForTimeout(900);
  const drawn = await page.evaluate(() => window.__DECOY__?.getDrawn() ?? []);
  const me = drawn.find((d) => d.kind === 'self');
  const guard = drawn.find((d) => d.kind === 'survivor' && Math.hypot(d.x - 24, d.y - 16) < 0.2);
  expect(me, '러너(나)').toBeTruthy();
  expect(guard, '감옥 안 가드').toBeTruthy();
  const out = { runner: 99, guard: 99 };
  for (const [name, d, color] of [
    ['runner', me!, 0x3b82f6],
    ['guard', guard!, GUARD],
  ] as const) {
    const c = await page.evaluate(([x, y]) => window.__DECOY__?.tileToClient(x!, y!), [d.x, d.y]);
    const rad = 0.45 * 0.3 * 32 * 0.9297;
    const r: Rect = {
      x: Math.floor(c!.x - rad - 1),
      y: Math.floor(c!.y - rad - 1),
      w: Math.ceil(2 * rad + 3),
      h: Math.ceil(2 * rad + 3),
    };
    const px = (await grab(page, { r })).r!;
    out[name] = deltaE(meanRgb(disc(px, r, c!.x, c!.y, rad)), hexRgb(color));
  }
  return out;
}

/** 장면 3: 거점 정지 (러너와 괴물이 함께 A 안) — 정보 레이어 + 주황 아이콘 픽셀 */
export async function blockedPoint(s: Session): Promise<{ badge: InfoItem | undefined; orange: number }> {
  const { page, send, id } = s;
  await send({ kind: 'teleport', target: id('scout'), x: 40, y: 16 });
  await send({ kind: 'teleport', target: id('runner'), x: 7, y: 15 });
  await send({ kind: 'teleport', target: id('monster'), x: 9.2, y: 17.4, face: Math.PI });
  // 괴물 정지 유예(monsterBlockGrace) 전에 잰다
  await page.waitForFunction(
    () =>
      (window.__DECOY__?.getInfoLayer() ?? []).some(
        (i) => i.kind === 'badge' && i.tag === 'point-A' && i.value === 'blocked',
      ),
    null,
    { timeout: 4000 },
  );
  await page.waitForTimeout(150);
  const badge = (await page.evaluate(() => window.__DECOY__?.getInfoLayer() ?? [])).find(
    (i) => i.kind === 'badge' && i.tag === 'point-A',
  );
  // 상태 칩 (A 글자 배지 오른쪽, mapArtBadges BADGE: 중심 + (0.78, −1.62))
  const chip = await tileRect(page, 8 + 0.78 - 0.26, 16 - 1.62 - 0.26, 8 + 0.78 + 0.26, 16 - 1.62 + 0.26);
  const px = (await grab(page, { chip })).chip!;
  const orange = px.filter(([r, g, b]) => r > 190 && g > 100 && g < 200 && b < 90 && r - g > 40).length;
  return { badge, orange };
}

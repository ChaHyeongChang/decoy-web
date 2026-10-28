// M10b 맵 · 오브젝트 E2E 공용 (m10-map.spec.ts = Canvas 낮음, m10-map.webgl.spec.ts = WebGL 높음).
// 봇 방 탭 하나로 장면을 놓고 스크린샷 픽셀을 잰다. 대비는 WCAG 상대휘도, 색 차이는 CIE76 ΔE(Lab).
import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import {
  CAPTURE_POINTS,
  MAP_H,
  MAP_W,
  tileAt,
  type InfoItem,
  type TestCommand,
  type Vec2,
} from '@decoy/shared';
import { BADGE, PRISON_LOCK } from '../../client/src/art/mapArtBadges';
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
export async function startBotRoom(
  browser: Browser,
  query: string,
  role = 'runner',
  /** 시작 단추를 누르기 직전 (로비에서 기다릴 것 — 나눠 받는 조각 미리 받기 등) */
  beforeStart?: (page: Page) => Promise<void>,
): Promise<Session> {
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
  await beforeStart?.(page);
  await page.getByTestId('start-button').click();
  await page.waitForFunction(() => (window.__DECOY__?.snapCount ?? 0) > 5, null, { timeout: 30_000 });
  const room = await page.evaluate(() => window.__DECOY__?.room ?? '');
  const truth = (await (await page.request.get(`/test/state?room=${room}`)).json()) as {
    players: { id: string; role: string }[];
  };
  const id = (r: string): string => truth.players.find((p) => p.role === r)?.id ?? '';
  const raw = (cmd: TestCommand): Promise<void> => page.evaluate((c) => window.__DECOY__?.sendTest(c), cmd);
  /** 서버 정답의 그 플레이어 자리 */
  const posOf = async (target: string): Promise<{ x: number; y: number } | null> => {
    const t = (await (await page.request.get(`/test/state?room=${room}`)).json()) as {
      players: { id: string; x: number; y: number }[];
    };
    return t.players.find((p) => p.id === target) ?? null;
  };
  // teleport는 멈춤을 푼다: 다시 멈추는 명령을 같은 평가에서 잇달아 보낸다. 그래도 두 메시지 사이에 서버 틱이 끼면
  // (느린 러너 · 부하) 봇이 한 틱 움직인 채 멈춰 장면이 달라진다(M11 전체 검사: 가드가 4px 비켜 손전등 빛까지 다름).
  // 서버 정답에서 정확히 그 자리에 섰는지 확인하고, 아니면 다시 놓는다
  const send = async (cmd: TestCommand): Promise<void> => {
    if (cmd.kind !== 'teleport') return raw(cmd);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await page.evaluate((c) => {
        window.__DECOY__?.sendTest(c);
        window.__DECOY__?.sendTest({ kind: 'freeze', target: c.target, frozen: true });
      }, cmd);
      // 명령(WebSocket)이 처리될 때까지: 목표 근처(한 틱 이동 안쪽)에 오면 처리된 것이다
      let p = await posOf(cmd.target);
      for (let i = 0; i < 40 && (!p || Math.hypot(p.x - cmd.x, p.y - cmd.y) > 0.5); i += 1) {
        await page.waitForTimeout(50);
        p = await posOf(cmd.target);
      }
      if (p && p.x === cmd.x && p.y === cmd.y) return;
    }
    throw new Error(`teleport ${cmd.target} (${cmd.x}, ${cmd.y}): 5번 놓아도 정확한 자리에 서지 않았다`);
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

/** 맵 쪽 레이어(안개 루트: 정적 · 동적, 배지)의 프레임당 Graphics 명령 수 */
export async function mapGfxCounts(
  page: Page,
): Promise<{ map: number; badges: number; objects: number; cacheBytes: number }> {
  const f = (await page.evaluate(() => window.__DECOY__!.gfx)).features;
  return {
    map: Number(f.mapGfxCmds ?? -1),
    badges: Number(f.badgeGfxCmds ?? -1),
    objects: Number(f.mapLayerObjects ?? -1),
    cacheBytes: Number(f.mapCacheBytes ?? -1),
  };
}

/**
 * 맵 쪽 레이어는 프레임마다 다시 테셀레이션하는 Graphics를 쓰지 않는다 (정적 = 구운 텍스처, 동적 = 안개 주기에만 캔버스에
 * 다시 그려 올린 텍스처, 배지 = 상태가 바뀔 때만 구운 텍스처). 빈 통과가 아님: 세는 대상(안개 루트 안 객체)이 실제로 있다
 */
export function expectNoMapGraphics(c: Awaited<ReturnType<typeof mapGfxCounts>>, minObjects: number): void {
  expect(c.map).toBe(0);
  expect(c.badges).toBe(0);
  expect(c.objects).toBeGreaterThanOrEqual(minObjects);
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

/** 배지 자리 (mapArtBadges BADGE 상수로 계산, 타일): 거점 A 글자(마름모 가운데) · 마름모 오른쪽 꼭짓점 · 상태 칩 · 감옥 자물쇠 */
export function badgeSpots(): Record<'letter' | 'diamond' | 'chip' | 'lock', Vec2> {
  const a = CAPTURE_POINTS.A;
  const y = a.y + BADGE.pointDy;
  return {
    letter: { x: a.x, y },
    diamond: { x: a.x + BADGE.pointHalf, y },
    chip: { x: a.x + BADGE.chipDx, y },
    lock: { x: PRISON_LOCK.x, y: PRISON_LOCK.y },
  };
}

/** 몸 원판(0.9r)이 바닥 칸에만 걸리는 기준 자리: 배지 자리에서 정수 기기 픽셀만큼(4 · 8타일 = 119 · 238px) 옮긴 곳 */
function cleanSpot(p: Vec2, r: number): Vec2 {
  const floorAround = (q: Vec2): boolean => {
    for (let j = Math.floor(q.y - r - 0.1); j <= Math.floor(q.y + r + 0.1); j += 1)
      for (let i = Math.floor(q.x - r - 0.1); i <= Math.floor(q.x + r + 0.1); i += 1)
        if (tileAt(i, j) !== 'floor') return false;
    return true;
  };
  for (const [dx, dy] of [
    [-4, 0],
    [4, 0],
    [0, 4],
    [0, -4],
    [-8, 0],
    [8, 0],
  ] as const) {
    const q = { x: p.x + dx, y: p.y + dy };
    if (floorAround(q)) return q;
  }
  throw new Error(`배지 없는 기준 자리를 못 찾음: ${JSON.stringify(p)}`);
}

export interface BodyOverBadge {
  /** 몸 원판 픽셀마다 ΔE(배지 위, 배지 없는 기준) 평균 · 10 넘는 픽셀 비율 */
  meanDE: number;
  overFrac: number;
  /** 빈 통과가 아님: 같은 자리에 캐릭터가 없을 때 배지가 원판 안에서 바닥과 다른 픽셀 비율 */
  badgeFrac: number;
  px: number;
}

/** 원판 픽셀 (중심 · 반지름 px, 정수 오프셋 dx · dy만큼 옮긴 같은 원판) */
async function discAt(page: Page, c: Vec2, rad: number): Promise<{ px: Rgb[]; rect: Rect }> {
  const rect: Rect = {
    x: Math.floor(c.x - rad - 1),
    y: Math.floor(c.y - rad - 1),
    w: Math.ceil(2 * rad + 3),
    h: Math.ceil(2 * rad + 3),
  };
  return { px: (await grab(page, { rect })).rect!, rect };
}

/**
 * 장면 2 (T2): 배지가 캐릭터를 덮지 않음. 러너(나)를 실제 배지 자리(BADGE로 계산한 글자 · 마름모 · 칩 · 자물쇠)에 세워 몸 원판
 * (0.9r, 반지름은 balance · tileToClient)을, 같은 몸을 배지 없는 바닥(정수 기기 픽셀만큼 옮긴 곳)에 세운 것과 픽셀마다 비교한다.
 * 몸 위에 아무것도 없으면 두 원판은 같다. 빈 통과가 아님: 몸이 없을 때 그 원판 안에 배지 픽셀이 실제로 있다
 */
export async function bodiesOverBadges(
  s: Session,
  survivorR: number,
): Promise<Record<string, BodyOverBadge>> {
  const { page, send, id } = s;
  await send({ kind: 'teleport', target: id('monster'), x: 44.5, y: 12.5, face: 0 });
  // 스카우트(봇)가 거점 A 안에 서 있어 A가 점령 중: 상태 칩(▶)이 그려진다
  await send({ kind: 'teleport', target: id('scout'), x: 7, y: 17.2, face: 0 });
  await send({ kind: 'teleport', target: id('guard'), x: 40, y: 28, face: 0 });
  const toClient = async (p: Vec2): Promise<Vec2> => {
    const c = await page.evaluate(([x, y]) => window.__DECOY__?.tileToClient(x!, y!), [p.x, p.y]);
    if (!c) throw new Error('tileToClient 없음');
    return c;
  };
  const out: Record<string, BodyOverBadge> = {};
  for (const [name, spot] of Object.entries(badgeSpots())) {
    const ref = cleanSpot(spot, survivorR);
    const c = await toClient(spot);
    const edge = await toClient({ x: spot.x + survivorR * 0.9, y: spot.y });
    const rad = edge.x - c.x;
    const cr = await toClient(ref);
    // 기준 자리는 정수 픽셀만큼 옮긴 곳 (같은 부분 픽셀 위상 → 같은 몸 그림)
    expect(Math.abs(cr.x - c.x - Math.round(cr.x - c.x))).toBeLessThan(0.01);
    expect(Math.abs(cr.y - c.y - Math.round(cr.y - c.y))).toBeLessThan(0.01);
    // 몸 없는 배지 자리 (러너를 멀리). 점령이 끝나 완료(✓)로 바뀌지 않게 찍을 때마다 진행을 조금으로 되돌린다.
    // 완료는 되돌릴 수 없고(setPoint는 진행만 바꾼다), 느린 러너에서는 한 자리에 40초 넘게 걸려 점령이 끝난 적이 있다
    const keepCapturing = (): Promise<void> => send({ kind: 'setPoint', point: 'A', progress: 0.05 });
    await keepCapturing();
    await send({ kind: 'teleport', target: id('runner'), x: 40, y: 20, face: 0 });
    await page.waitForTimeout(500);
    const bare = await discAt(page, c, rad);
    await keepCapturing();
    const bareRef = await discAt(page, cr, rad);
    await keepCapturing();
    await send({ kind: 'teleport', target: id('runner'), x: spot.x, y: spot.y, face: 0 });
    await page.waitForTimeout(600);
    const on = await discAt(page, c, rad);
    await keepCapturing();
    await send({ kind: 'teleport', target: id('runner'), x: ref.x, y: ref.y, face: 0 });
    await page.waitForTimeout(600);
    const off = await discAt(page, cr, rad);
    await keepCapturing();
    const a = disc(on.px, on.rect, c.x, c.y, rad);
    const b = disc(off.px, off.rect, cr.x, cr.y, rad);
    const ba = disc(bare.px, bare.rect, c.x, c.y, rad);
    const bb = disc(bareRef.px, bareRef.rect, cr.x, cr.y, rad);
    expect(a.length).toBe(b.length);
    let sum = 0;
    let over = 0;
    let badge = 0;
    for (let i = 0; i < a.length; i += 1) {
      const d = deltaE(a[i]!, b[i]!);
      sum += d;
      if (d > 10) over += 1;
      if (deltaE(ba[i]!, bb[i]!) > 10) badge += 1;
    }
    out[name] = {
      meanDE: sum / Math.max(1, a.length),
      overFrac: over / Math.max(1, a.length),
      badgeFrac: badge / Math.max(1, a.length),
      px: a.length,
    };
  }
  await send({ kind: 'teleport', target: id('scout'), x: 40, y: 3, face: 0 });
  await send({ kind: 'setPoint', point: 'A', progress: 0 });
  return out;
}

/** 장면 2 판정: 몸이 배지 위에 그대로 (배지 없는 바닥에 선 같은 몸과 같다). 빈 통과가 아님: 배지가 원판 안에 실제로 있다 */
export function expectBodiesOverBadges(r: Record<string, BodyOverBadge>): void {
  for (const [name, v] of Object.entries(r)) {
    expect(v.px, name).toBeGreaterThan(60);
    expect(v.badgeFrac, `${name}: 몸 원판 안에 배지 픽셀`).toBeGreaterThan(0.05);
    expect(v.meanDE, `${name}: 몸 원판 평균 ΔE`).toBeLessThanOrEqual(2);
    expect(v.overFrac, `${name}: ΔE 10 넘는 픽셀 비율`).toBeLessThanOrEqual(0.02);
  }
}

/**
 * R6: 장식 시계가 멈춘 채(freezeClock) 탈출구가 열려도 미닫이가 다 열린 그림이 된다 (닫힌 = 활성처럼 남지 않음).
 * 두 거점 완료 → 탈출구 활성 → 가드(봇)가 북문 판정 원 안에서 개방 → 열림. 문 칸 가운데 픽셀이 열린 틈(초록) 색인지 본다
 */
export async function exitOpensWhileFrozen(
  s: Session,
): Promise<{ before: Rgb; after: Rgb; state: string | number | null }> {
  const { page, send, id } = s;
  await page.evaluate(() => window.__DECOY__?.freezeClock(4321));
  await send({ kind: 'teleport', target: id('monster'), x: 44.5, y: 12.5, face: 0 });
  await send({ kind: 'teleport', target: id('runner'), x: 21, y: 3.5, face: 0 });
  await send({ kind: 'teleport', target: id('guard'), x: 3, y: 28, face: 0 });
  const badge = (tag: string): Promise<string | number | null> =>
    page.evaluate(
      (t) =>
        (window.__DECOY__?.getInfoLayer() ?? []).find((i) => i.kind === 'badge' && i.tag === t)?.value ??
        null,
      tag,
    );
  // 두 거점 완료 (완료는 안에서 점령 중인 생존자가 게이지를 채울 때): 스카우트(봇)가 거의 찬 거점에 차례로 선다
  for (const [point, x] of [
    ['A', 8],
    ['B', 40],
  ] as const) {
    await send({ kind: 'setPoint', point, progress: 0.99 });
    await send({ kind: 'teleport', target: id('scout'), x, y: 16, face: 0 });
    await expect.poll(() => badge(`point-${point}`), { timeout: 8000 }).toBe('done');
  }
  await send({ kind: 'teleport', target: id('scout'), x: 45, y: 28, face: 0 });
  await expect.poll(() => badge('exit-N'), { timeout: 8000 }).toBe('active');
  const door = await tileRect(page, 23.8, 0.3, 24.2, 0.5);
  const mean = async (): Promise<Rgb> => meanRgb((await grab(page, { door })).door!);
  const noBanner = (): Promise<number> => page.evaluate(() => window.__DECOY__?.getBanners().length ?? 0);
  await expect.poll(noBanner, { timeout: 15_000 }).toBe(0);
  const before = await mean();
  // 개방은 두 사람이 판정 원 안에 있을 때 (가드 · 스카우트 봇)
  await send({ kind: 'teleport', target: id('guard'), x: 23.5, y: 1.7, face: 0 });
  await send({ kind: 'teleport', target: id('scout'), x: 24.5, y: 1.7, face: 0 });
  await expect.poll(() => badge('exit-N'), { timeout: 10_000 }).toBe('open');
  // 실제 시간이 미닫이(0.6초)보다 흐른 뒤 (장식 시계는 그대로 멈춰 있다)
  await page.waitForTimeout(1200);
  await expect.poll(noBanner, { timeout: 15_000 }).toBe(0);
  const after = await mean();
  return { before, after, state: await badge('exit-N') };
}

export interface MapScene {
  /** 맵 사각형만 찍은 PNG */
  png: Buffer;
  rect: Rect;
  /** 그린 캐릭터 자리 (클라이언트 px): 캐릭터 자세는 맵 그림이 아니라 비교에서 뺀다 */
  bodies: Vec2[];
  problems: string[];
}

/**
 * T7: 같은 장면을 페이지를 새로 열어 찍은 맵 사각형 (정적 맵 · 발광 굽기가 시드 고정이면 두 번 열어도 같다).
 * 봇 · 나를 같은 자리 · 같은 방향에 세우고 장식 시계를 멈춘다
 */
export async function mapSceneShot(browser: Browser, query: string): Promise<MapScene> {
  const s = await startBotRoom(browser, query);
  const { page, send, id } = s;
  await send({ kind: 'teleport', target: id('monster'), x: 44.5, y: 12.5, face: 0 });
  await send({ kind: 'teleport', target: id('scout'), x: 45, y: 2, face: Math.PI });
  await send({ kind: 'teleport', target: id('guard'), x: 3, y: 2, face: 0 });
  await send({ kind: 'teleport', target: id('runner'), x: 22.5, y: 25.5, face: 0 });
  await settle(page);
  // 장식 시계를 먼 미래의 같은 값에: 판 시작 직후 봇이 남긴 입자(발먼지 등)는 모두 수명이 끝나 있고,
  // 시계로 움직이는 장식(빛 속 먼지 · 경계 노이즈)은 두 번 모두 같은 시각이다
  await page.evaluate(() => window.__DECOY__?.freezeClock(1e7));
  await page.waitForTimeout(1000);
  const rect = await tileRect(page, 0, 0, MAP_W, MAP_H);
  const png = await page.screenshot({ clip: { x: rect.x, y: rect.y, width: rect.w, height: rect.h } });
  const bodies = await page.evaluate(() =>
    (window.__DECOY__?.getDrawn() ?? []).map((d) => window.__DECOY__!.tileToClient(d.x, d.y)!),
  );
  await s.context.close();
  return { png, rect, bodies, problems: s.problems };
}

/** 두 맵 PNG에서 채널 차가 2를 넘는 픽셀 수 (캐릭터 자리 반지름 rad px 안은 뺀다) · 최대 차 */
export async function diffMapScenes(
  page: Page,
  a: MapScene,
  b: MapScene,
  rad: number,
): Promise<{ diff: number; max: number; px: number }> {
  const mask = [...a.bodies, ...b.bodies].map((p) => ({ x: p.x - a.rect.x, y: p.y - a.rect.y }));
  return page.evaluate(
    async ({ a64, b64, mask, rad }) => {
      const load = async (s: string): Promise<ImageData> => {
        const img = new Image();
        img.src = `data:image/png;base64,${s}`;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        const x = c.getContext('2d', { willReadFrequently: true });
        if (!x) throw new Error('2D 컨텍스트 없음');
        x.drawImage(img, 0, 0);
        return x.getImageData(0, 0, c.width, c.height);
      };
      const da = await load(a64);
      const db = await load(b64);
      let diff = 0;
      let max = 0;
      for (let i = 0; i < da.data.length; i += 4) {
        const p = i / 4;
        const x = p % da.width;
        const y = Math.floor(p / da.width);
        if (mask.some((m) => Math.hypot(x - m.x, y - m.y) <= rad)) continue;
        let d = 0;
        for (let k = 0; k < 3; k += 1)
          d = Math.max(d, Math.abs((da.data[i + k] ?? 0) - (db.data[i + k] ?? 0)));
        if (d > 2) diff += 1;
        max = Math.max(max, d);
      }
      return { diff, max, px: da.width * da.height };
    },
    { a64: a.png.toString('base64'), b64: b.png.toString('base64'), mask, rad },
  );
}

/** 장면 3: 거점 정지 (러너와 괴물이 함께 A 안) — 정보 레이어 + 주황 아이콘 픽셀 */
export async function blockedPoint(s: Session): Promise<{ badge: InfoItem | undefined; orange: number }> {
  const { page, send, id } = s;
  const blockedNow = (): Promise<boolean> =>
    page.evaluate(() =>
      (window.__DECOY__?.getInfoLayer() ?? []).some(
        (i) => i.kind === 'badge' && i.tag === 'point-A' && i.value === 'blocked',
      ),
    );
  // 앞 장면에서 스카우트가 A 안에 서 있었다: 느린 러너(SwiftShader)에서 그동안 점령이 끝나(완료) 정지가 나올 수 없던 적이 있다
  await send({ kind: 'teleport', target: id('scout'), x: 40, y: 16 });
  const pointA = (await page.evaluate(() => window.__DECOY__?.getLastSnapshot()?.world.points ?? [])).find(
    (p) => p.id === 'A',
  );
  if (pointA?.state === 'done')
    throw new Error('거점 A가 이미 완료라 정지를 볼 수 없다 (앞 장면에서 점령이 끝남)');
  for (let attempt = 1; ; attempt++) {
    // 괴물을 A 밖에 두었다가 넣어 정지 유예(monsterBlockGrace, 연속으로 머문 시간) 시계를 새로 시작한다
    await send({ kind: 'teleport', target: id('monster'), x: 44.5, y: 12.5, face: 0 });
    await page.waitForTimeout(300);
    await send({ kind: 'setPoint', point: 'A', progress: 0.3 });
    await send({ kind: 'teleport', target: id('runner'), x: 7, y: 15 });
    await send({ kind: 'teleport', target: id('monster'), x: 9.2, y: 17.4, face: Math.PI });
    // 유예 전에 잰다. 프레임이 느려도 놓치지 않게 시간 간격으로 확인한다
    await page.waitForFunction(
      () =>
        (window.__DECOY__?.getInfoLayer() ?? []).some(
          (i) => i.kind === 'badge' && i.tag === 'point-A' && i.value === 'blocked',
        ),
      null,
      { timeout: 4000, polling: 100 },
    );
    await page.waitForTimeout(150);
    const badge = (await page.evaluate(() => window.__DECOY__?.getInfoLayer() ?? [])).find(
      (i) => i.kind === 'badge' && i.tag === 'point-A',
    );
    // 상태 칩 (A 글자 배지 오른쪽, mapArtBadges BADGE: 중심 + (0.78, −1.62))
    const chip = await tileRect(page, 8 + 0.78 - 0.26, 16 - 1.62 - 0.26, 8 + 0.78 + 0.26, 16 - 1.62 + 0.26);
    const px = (await grab(page, { chip })).chip!;
    const orange = px.filter(([r, g, b]) => r > 190 && g > 100 && g < 200 && b < 90 && r - g > 40).length;
    // 찍은 뒤에도 정지면 찍은 화면도 정지 중의 프레임이다. 느린 러너에서 찍는 사이 유예가 끝났으면 다시 (최대 3번)
    if ((await blockedNow()) || attempt === 3) return { badge, orange };
  }
}

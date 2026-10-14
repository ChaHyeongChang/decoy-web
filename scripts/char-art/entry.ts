// 캐릭터 리디자인 시안 그림 (브라우저 쪽). scripts/char-art.mjs가 esbuild로 묶어 Chromium에 싣고 window.CHAR_ART를 부른다.
// 새 캐릭터 그림(client/src/art/chars)과 지금 그림(client/src/art/atlas.ts bakeAtlas · ui/uiArt.ts roleFigureSvg)을
// 같은 캔버스에 그려 PNG(data URL)로 돌려준다. 게임 코드는 바꾸지 않는다.
import { bakeAtlas, type AtlasBuild } from '../../client/src/art/atlas';
import { drawToCanvas, toSvg, type CanvasSink, type Drawing } from '../../client/src/art/chars/kit';
import { MONSTER_ART, SURVIVOR_ART } from '../../client/src/art/chars/index';
import {
  FRONT_REST,
  MONSTER_REST,
  SURVIVOR_REST,
  type CharId,
  type FrontPose,
  type MonsterPose,
  type SurvivorPose,
} from '../../client/src/art/chars/types';
import { ROLE, ROLE_TEXT, OUTLINE, CONE } from '../../client/src/art/palette';
import { roleFigureSvg } from '../../client/src/ui/uiArt';

type Ctx = CanvasRenderingContext2D;

const TILE = 32;
const MAP_SCALE = 952 / 1024;
/** 판정 반지름 (타일, balance.json) */
const R_TILES = { survivor: 0.3, monster: 0.35 } as const;
const FONT = "'Noto Sans KR', sans-serif";
const BG = '#0b1622';
const FLOOR = '#17212b';
const FLOOR_HI = '#1f2b38';
const SEAM = '#0e151c';

/** 외곽선 두께 (월드 px, 옛 그림과 같은 값) → 그림 단위 */
const OUTLINE_WORLD = 1.8;
function wUnits(id: CharId): number {
  const r = id === 'monster' ? R_TILES.monster : R_TILES.survivor;
  return OUTLINE_WORLD / (r * TILE);
}

/** 기기 크기: 판정 반지름이 기기 px로 몇인가 (터치 넓은 배치는 논리 높이 = 맵 높이 952) */
export interface Device {
  name: string;
  /** 논리 1px = CSS px */
  cssPerLogical: number;
  dpr: number;
}

export const DEVICES: Record<string, Device> = {
  phone3: { name: '휴대폰 가로 390pt · 배율 3', cssPerLogical: 390 / 952, dpr: 3 },
  phone2: { name: '보급형 휴대폰 360pt · 배율 2', cssPerLogical: 360 / 952, dpr: 2 },
  pc1080: { name: 'PC 1920×1080 · 배율 1', cssPerLogical: 1, dpr: 1 },
  pc768: { name: '노트북 1366×768 · 배율 1', cssPerLogical: 768 / 1080, dpr: 1 },
};

/** 판정 반지름 (기기 px) */
export function radiusPx(kind: 'survivor' | 'monster', d: Device): number {
  return R_TILES[kind] * TILE * MAP_SCALE * d.cssPerLogical * d.dpr;
}

// ───────────────────────── 그리기 도우미 ─────────────────────────

function canvas(w: number, h: number): { c: HTMLCanvasElement; ctx: Ctx } {
  const c = document.createElement('canvas');
  c.width = Math.round(w);
  c.height = Math.round(h);
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2d');
  return { c, ctx };
}

function text(
  ctx: Ctx,
  s: string,
  x: number,
  y: number,
  size = 16,
  color = '#e2e8f0',
  weight = 500,
  align: CanvasTextAlign = 'left',
): void {
  ctx.save();
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(s, x, y);
  ctx.restore();
}

/** 게임 바닥 비슷한 강판 (빛 속): 1타일 = tilePx */
function floor(ctx: Ctx, x: number, y: number, w: number, h: number, tilePx: number): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = FLOOR;
  ctx.fillRect(x, y, w, h);
  if (tilePx >= 6) {
    for (let ty = y; ty < y + h; ty += tilePx)
      for (let tx = x; tx < x + w; tx += tilePx) {
        ctx.fillStyle = FLOOR_HI;
        ctx.fillRect(tx + 1, ty + 1, tilePx - 2, Math.max(1, tilePx * 0.04));
        ctx.fillStyle = SEAM;
        ctx.fillRect(tx, ty, tilePx, 1);
        ctx.fillRect(tx, ty, 1, tilePx);
      }
  }
  ctx.restore();
}

/** 접지 그림자 (옛 그림과 같은 모양: 2.15r · 1.82r, 가운데 알파 0.82) */
function shadow(ctx: Ctx, x: number, y: number, rPx: number, kind: 'survivor' | 'monster', alpha = 1): void {
  const reach = (kind === 'monster' ? 1.82 : 2.15) * rPx;
  const g = ctx.createRadialGradient(x, y + 0.1 * rPx, 0, x, y + 0.1 * rPx, reach);
  const a = 0.82 * alpha;
  g.addColorStop(0, `rgba(5,8,12,${a})`);
  g.addColorStop(0.55, `rgba(5,8,12,${a * 0.96})`);
  g.addColorStop(0.8, `rgba(5,8,12,${a * 0.6})`);
  g.addColorStop(1, 'rgba(5,8,12,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y + 0.1 * rPx, reach, 0, Math.PI * 2);
  ctx.fill();
}

function paint(ctx: Ctx, d: Drawing, x: number, y: number, k: number, rot = 0, alpha = 1, sx = 1, sy = 1): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.scale(sx, sy);
  ctx.globalAlpha = alpha;
  // drawToCanvas가 명령마다 globalAlpha를 다시 정하므로 알파는 레이어로 감싼다
  if (alpha < 1) {
    const r = Math.ceil(k * 2.2);
    const tmp = canvas(r * 2, r * 2);
    tmp.ctx.translate(r, r);
    drawToCanvas(tmp.ctx as unknown as CanvasSink, d, k);
    ctx.drawImage(tmp.c, -r, -r);
  } else drawToCanvas(ctx as unknown as CanvasSink, d, k);
  ctx.restore();
}

/** 새 그림: 위에서 본 생존자 · 괴물 (그림자 포함). rPx = 판정 반지름 (px) */
export function newTop(
  ctx: Ctx,
  id: CharId,
  pose: Partial<SurvivorPose> & Partial<MonsterPose>,
  x: number,
  y: number,
  rPx: number,
  rot: number,
  opts: { shadow?: boolean; alpha?: number } = {},
): void {
  const kind = id === 'monster' ? 'monster' : 'survivor';
  if (opts.shadow !== false) shadow(ctx, x, y, rPx, kind, opts.alpha ?? 1);
  const w = wUnits(id);
  const d =
    id === 'monster'
      ? MONSTER_ART.top({ ...MONSTER_REST, ...pose }, { w })
      : SURVIVOR_ART[id].top({ ...SURVIVOR_REST, ...pose }, { w });
  paint(ctx, d, x, y, rPx, rot, opts.alpha ?? 1);
}

/** 새 그림: 정면 (상자 [−1, 1]² → 한 변 size px) */
export function newFront(ctx: Ctx, id: CharId, pose: Partial<FrontPose>, x: number, y: number, size: number, wPx = 3): void {
  const k = size / 2;
  const w = wPx / k;
  const p = { ...FRONT_REST, ...pose };
  const d = id === 'monster' ? MONSTER_ART.front(p, { w }) : SURVIVOR_ART[id].front(p, { w });
  paint(ctx, d, x, y, k);
}

export function frontSvg(id: CharId, pose: Partial<FrontPose>, size: number, wPx = 3): string {
  const k = size / 2;
  const p = { ...FRONT_REST, ...pose };
  const d = id === 'monster' ? MONSTER_ART.front(p, { w: wPx / k }) : SURVIVOR_ART[id].front(p, { w: wPx / k });
  return toSvg(d, { viewBox: [-1.05, -1.05, 2.1, 2.1], width: size, height: size, idPrefix: `${id}f` });
}

// ───────────────────────── 지금 그림 (옛 아틀라스) ─────────────────────────

let oldAtlas: AtlasBuild | null = null;
/** 옛 그림 아틀라스 (크게 구워 두고 줄여 찍는다) */
function old(): AtlasBuild {
  if (!oldAtlas) oldAtlas = bakeAtlas({ zoom: 7, survivorR: R_TILES.survivor, monsterR: R_TILES.monster });
  return oldAtlas;
}

function oldFrame(ctx: Ctx, name: string, x: number, y: number, kWorld: number, rot: number, sx = 1, sy = 1): void {
  const a = old();
  const f = a.frames.get(name);
  if (!f) throw new Error(`옛 프레임 없음: ${name}`);
  const s = kWorld / a.texPerWorld;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.scale(s * sx, s * sy);
  ctx.drawImage(a.canvas, f.x, f.y, f.w, f.h, -f.w / 2, -f.h / 2, f.w, f.h);
  ctx.restore();
}

/** 옛 그림 생존자 (그림자 · 발 · 몸 · 윤기, 서 있는 자세). role = 'hidden'이면 괴물 화면 공통 */
export function oldSurvivor(ctx: Ctx, role: 'runner' | 'guard' | 'scout' | 'hidden', x: number, y: number, rPx: number, rot: number): void {
  const kWorld = rPx / (R_TILES.survivor * TILE);
  oldFrame(ctx, 'shadow-survivor', x, y, kWorld, 0);
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  for (const fy of [-0.5, 0.5]) oldFrame(ctx, `foot-${role}`, x - fy * s * rPx, y + fy * c * rPx, kWorld, rot);
  oldFrame(ctx, `survivor-${role}`, x, y, kWorld, rot);
  oldFrame(ctx, 'gloss', x, y, kWorld, 0);
}

/** 옛 그림 괴물 (그림자 · 망토 · 발톱 2 · 눈) */
export function oldMonster(ctx: Ctx, x: number, y: number, rPx: number, rot: number, frame = 'monster-idle-0', raise = 0): void {
  const kWorld = rPx / (R_TILES.monster * TILE);
  oldFrame(ctx, 'shadow-monster', x, y, kWorld, 0);
  oldFrame(ctx, frame, x, y, kWorld, rot);
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const lx = 0.64 + 0.14 * raise;
  for (const side of [1, -1]) {
    const ly = (0.44 + 0.06 * raise) * side;
    oldFrame(ctx, 'claw', x + (lx * c - ly * s) * rPx, y + (lx * s + ly * c) * rPx, kWorld, rot + side * (0.38 + 0.3 * raise), 1, side);
  }
  oldFrame(ctx, 'eyes-open', x + 0.6 * c * rPx, y + 0.6 * s * rPx, kWorld, rot);
}

/** 옛 로비 역할 그림 (SVG → 이미지) */
async function svgImage(svg: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  return img;
}

export async function oldLobbyFigure(ctx: Ctx, role: 'runner' | 'guard' | 'scout' | 'monster', x: number, y: number, size: number): Promise<void> {
  const svg = roleFigureSvg(role, true).replace('<svg ', `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" `);
  const img = await svgImage(svg);
  ctx.drawImage(img, x - size / 2, y - size / 2, size, size);
}

// ───────────────────────── 확대 · 흑백 ─────────────────────────

/** 캔버스 영역을 최근접 확대해 붙인다 */
function zoomCopy(ctx: Ctx, src: HTMLCanvasElement, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, k: number): void {
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(src, sx, sy, sw, sh, dx, dy, sw * k, sh * k);
  ctx.restore();
}

function grayscale(ctx: Ctx, x: number, y: number, w: number, h: number): void {
  const img = ctx.getImageData(x, y, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const v = 0.2126 * (d[i] ?? 0) + 0.7152 * (d[i + 1] ?? 0) + 0.0722 * (d[i + 2] ?? 0);
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, x, y);
}

// ───────────────────────── 보드: 디자인 미리보기 (캐릭터 하나) ─────────────────────────

const SURVIVOR_POSES: { label: string; pose: Partial<SurvivorPose> }[] = [
  { label: '서기', pose: {} },
  { label: '걷기 ¼', pose: { walk: Math.PI / 2, stride: 1 } },
  { label: '걷기 ¾', pose: { walk: (Math.PI * 3) / 2, stride: 1 } },
  { label: '능력 0.5', pose: { action: 0.5 } },
  { label: '능력 1', pose: { action: 1 } },
  { label: '피격', pose: { hit: 1 } },
  { label: '수감', pose: { mode: 'captive' } },
  { label: '구조 중', pose: { mode: 'reach' } },
  { label: '사망 회색', pose: { tone: 'gray' } },
  { label: '번쩍', pose: { tone: 'flash' } },
];

const MONSTER_POSES: { label: string; pose: Partial<MonsterPose> }[] = [
  { label: '서기', pose: {} },
  { label: '걷기 ¼', pose: { walk: Math.PI / 2, stride: 1, cloak: 1 } },
  { label: '걷기 ¾', pose: { walk: (Math.PI * 3) / 2, stride: 1, cloak: 4 } },
  { label: '준비 0.5', pose: { windup: 0.5 } },
  { label: '준비 1', pose: { windup: 1 } },
  { label: '타격', pose: { strike: 1 } },
  { label: '돌진', pose: { dash: 1 } },
  { label: '포효', pose: { roar: 1 } },
  { label: '기절', pose: { stun: 1, eyes: 'stun' } },
  { label: '번쩍', pose: { tone: 'flash' } },
];

const ROLE_COLOR: Record<CharId, number> = {
  runner: ROLE.runner,
  guard: ROLE.guard,
  scout: ROLE.scout,
  common: 0xf8fafc,
  monster: ROLE.monster,
};

const NAMES: Record<CharId, string> = { runner: '러너', guard: '가드', scout: '스카우트', common: '공통 생존자', monster: '괴물' };

function hexCss(c: number): string {
  return `#${c.toString(16).padStart(6, '0')}`;
}

/** 실제 크기 줄: 8방향, 바닥 위. 돌려준 값 = 그린 영역 */
function actualRow(
  ctx: Ctx,
  draw: (x: number, y: number, r: number, rot: number) => void,
  x0: number,
  y0: number,
  r: number,
  n = 8,
): { x: number; y: number; w: number; h: number } {
  const cell = Math.ceil(r * 4.2);
  const w = cell * n;
  const h = cell;
  floor(ctx, x0, y0, w, h, (r / R_TILES.survivor) * 1);
  for (let i = 0; i < n; i += 1) draw(x0 + cell * (i + 0.5), y0 + h / 2, r, (i * Math.PI * 2) / n - Math.PI / 2);
  return { x: x0, y: y0, w, h };
}

export async function previewBoard(id: CharId): Promise<string> {
  const W = 1900;
  const H = 2060;
  const { c, ctx } = canvas(W, H);
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);
  const col = hexCss(id === 'common' ? 0xe2e8f0 : ROLE_TEXT[id === 'monster' ? 'monster' : id]);
  text(ctx, `${NAMES[id]} — 디자인 미리보기`, 24, 40, 26, col, 700);
  // A. 큰 위에서 본 그림
  text(ctx, '위에서 본 게임 그림 (크게, 오른쪽 = 바라보는 방향)', 24, 82, 16, '#94a3b8');
  const poses = id === 'monster' ? MONSTER_POSES : SURVIVOR_POSES;
  const cell = 180;
  poses.forEach((p, i) => {
    const x = 24 + i * (cell + 6);
    const y = 96;
    floor(ctx, x, y, cell, cell, 60);
    newTop(ctx, id, p.pose, x + cell / 2, y + cell / 2, id === 'monster' ? 50 : 52, 0);
    text(ctx, p.label, x + 6, y + cell - 8, 13, '#e2e8f0', 500);
  });
  // A2. 여러 방향
  text(ctx, '여러 방향 (서기 · 걷기 ¼ 번갈아)', 24, 316, 16, '#94a3b8');
  for (let i = 0; i < 8; i += 1) {
    const x = 24 + i * 120;
    floor(ctx, x, 326, 114, 114, 40);
    newTop(ctx, id, i % 2 ? { walk: Math.PI / 2, stride: 1 } : {}, x + 57, 383, 30, (i * Math.PI) / 4 - Math.PI / 2);
  }
  // B. 정면
  text(ctx, '정면 그림 (로비 카드 · 결과 · 아이콘)', 1000, 316, 16, '#94a3b8');
  ctx.fillStyle = '#0f1b27';
  ctx.fillRect(1000, 326, 880, 330);
  newFront(ctx, id, {}, 1150, 486, 290, 4);
  newFront(ctx, id, { bust: true }, 1400, 486, 160, 3);
  newFront(ctx, id, { bust: true }, 1545, 486, 64, 2);
  newFront(ctx, id, { bust: true }, 1610, 486, 32, 1.4);
  newFront(ctx, id, { t: 0.65 }, 1770, 486, 150, 2.5);
  text(ctx, '전신 290', 1120, 648, 12, '#94a3b8');
  text(ctx, '상반신 160 · 64 · 32', 1360, 648, 12, '#94a3b8');
  text(ctx, '숨쉬기 0.65초', 1730, 648, 12, '#94a3b8');
  // C. 실제 크기 — 지금 vs 새
  text(ctx, '게임 속 실제 크기 (기기 px 그대로) — 위 줄: 지금 그림, 아래 줄: 새 그림. 오른쪽은 3배 최근접 확대', 24, 690, 16, '#94a3b8');
  const oldDraw = (x: number, y: number, r: number, rot: number): void => {
    if (id === 'monster') oldMonster(ctx, x, y, r, rot);
    else oldSurvivor(ctx, id === 'common' ? 'hidden' : id, x, y, r, rot);
  };
  const newDraw = (x: number, y: number, r: number, rot: number): void => newTop(ctx, id, {}, x, y, r, rot);
  let y = 704;
  for (const key of ['phone3', 'phone2', 'pc768'] as const) {
    const dev = DEVICES[key];
    if (!dev) continue;
    const r = radiusPx(id === 'monster' ? 'monster' : 'survivor', dev);
    text(ctx, `${dev.name} (반지름 ${r.toFixed(1)}px)`, 24, y + 14, 13, '#cbd5e1');
    const a = actualRow(ctx, oldDraw, 24, y + 22, r);
    const b = actualRow(ctx, newDraw, 24, y + 22 + a.h + 4, r);
    const z = 3;
    zoomCopy(ctx, c, a.x, a.y, a.w, a.h + b.h + 4, 24 + Math.max(a.w, 380) + 20, y + 22, z);
    y += 22 + (a.h + b.h + 4) * z + 22;
  }
  // D. 다섯 캐릭터 나란히 (휴대폰 실제 크기 + 흑백 + 부채꼴)
  const lx = 24;
  const ly = y + 10;
  text(ctx, '다섯 캐릭터 나란히 (휴대폰 배율 3 실제 크기 → 3배 확대 · 흑백 · 부채꼴 노랑 0.20 / 빨강 0.28 위)', lx, ly, 16, '#94a3b8');
  const ids: CharId[] = ['runner', 'guard', 'scout', 'common', 'monster'];
  const dev = DEVICES.phone3;
  if (dev) {
    const lineW = 5 * 60;
    const tile = radiusPx('survivor', dev) / R_TILES.survivor;
    const rows: { y: number; tint: [number, number] | null; walk: boolean }[] = [
      { y: ly + 14, tint: null, walk: false },
      { y: ly + 14 + 64, tint: [CONE.idle, 0.2], walk: true },
      { y: ly + 14 + 128, tint: [CONE.seen, 0.28], walk: true },
    ];
    for (const row of rows) {
      floor(ctx, lx, row.y, lineW, 60, tile);
      if (row.tint) {
        const [color, a] = row.tint;
        ctx.fillStyle = `rgba(${(color >> 16) & 255},${(color >> 8) & 255},${color & 255},${a})`;
        ctx.fillRect(lx, row.y, lineW, 60);
      }
      ids.forEach((cid, i) => {
        const r = radiusPx(cid === 'monster' ? 'monster' : 'survivor', dev);
        newTop(ctx, cid, row.walk ? { walk: Math.PI / 2, stride: 1 } : {}, lx + 30 + i * 60, row.y + 30, r, row.walk ? (i * Math.PI) / 3 : -Math.PI / 2);
      });
    }
    zoomCopy(ctx, c, lx, ly + 14, lineW, 188, lx + lineW + 20, ly + 14, 3);
    const gx = lx + lineW + 20 + lineW * 3 + 20;
    zoomCopy(ctx, c, lx, ly + 14, lineW, 60, gx, ly + 14, 1.6);
    grayscale(ctx, gx, ly + 14, Math.ceil(lineW * 1.6), Math.ceil(60 * 1.6));
    text(ctx, '흑백', gx, ly + 14 + 60 * 1.6 + 18, 13, '#cbd5e1');
  }
  void OUTLINE;
  return c.toDataURL('image/png');
}

/** 다섯 캐릭터 정면 + 위 (한 장) */
export async function lineupBoard(): Promise<string> {
  const W = 1900;
  const H = 820;
  const { c, ctx } = canvas(W, H);
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);
  const ids: CharId[] = ['runner', 'guard', 'scout', 'common', 'monster'];
  ids.forEach((id, i) => {
    const x = 40 + i * 370;
    ctx.fillStyle = '#0f1b27';
    ctx.fillRect(x, 30, 340, 760);
    text(ctx, NAMES[id], x + 170, 70, 24, hexCss(id === 'common' ? 0xe2e8f0 : ROLE_TEXT[id === 'monster' ? 'monster' : id]), 700, 'center');
    newFront(ctx, id, {}, x + 170, 260, 300, 4);
    floor(ctx, x + 20, 430, 300, 300, 100);
    newTop(ctx, id, {}, x + 170, 580, id === 'monster' ? 84 : 84, -Math.PI / 2);
    void ROLE_COLOR;
  });
  return c.toDataURL('image/png');
}

// ───────────────────────── 측정 (디자인 규칙 자체 확인) ─────────────────────────

function lab(r: number, g: number, b: number): [number, number, number] {
  const lin = (v: number): number => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const R = lin(r);
  const G = lin(g);
  const B = lin(b);
  const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047;
  const Y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  const Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const f = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}

function deltaE(a: [number, number, number], c: number): number {
  const b = lab((c >> 16) & 255, (c >> 8) & 255, c & 255);
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** 한 자세를 투명 캔버스에 그린 화소 (그림자 없음, 정사각형 한 변 size, 가운데 = 몸 중심) */
function renderPose(id: CharId, pose: Partial<SurvivorPose> & Partial<MonsterPose>, rPx: number, size: number): ImageData {
  const { ctx } = canvas(size, size);
  newTop(ctx, id, pose, size / 2, size / 2, rPx, 0, { shadow: false });
  return ctx.getImageData(0, 0, size, size);
}

function masks(img: ImageData): { sil: Uint8Array; fill: Uint8Array } {
  const n = img.width * img.height;
  const sil = new Uint8Array(n);
  const fill = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) {
    const a = img.data[i * 4 + 3] ?? 0;
    if (a < 128) continue;
    sil[i] = 1;
    const r = img.data[i * 4] ?? 0;
    const g = img.data[i * 4 + 1] ?? 0;
    const b = img.data[i * 4 + 2] ?? 0;
    if (Math.max(r, g, b) > 70) fill[i] = 1;
  }
  return { sil, fill };
}

function iou(a: Uint8Array, b: Uint8Array): number {
  let i = 0;
  let u = 0;
  for (let k = 0; k < a.length; k += 1) {
    if (a[k] && b[k]) i += 1;
    if (a[k] || b[k]) u += 1;
  }
  return u ? Math.round((i / u) * 1000) / 1000 : 1;
}

/** 실루엣 범위 (몸 반지름 배수, 외곽선 두께 뺌): 앞 · 뒤 · 옆 */
function extents(img: ImageData, rPx: number, wPx: number): { front: number; back: number; side: number } {
  const c = img.width / 2;
  let front = 0;
  let back = 0;
  let side = 0;
  for (let y = 0; y < img.height; y += 1)
    for (let x = 0; x < img.width; x += 1) {
      if ((img.data[(y * img.width + x) * 4 + 3] ?? 0) < 128) continue;
      const dx = x + 0.5 - c;
      const dy = y + 0.5 - c;
      front = Math.max(front, dx);
      back = Math.max(back, -dx);
      side = Math.max(side, Math.abs(dy));
    }
  const k = (v: number): number => Math.round(((v - wPx) / rPx) * 100) / 100;
  return { front: k(front), back: k(back), side: k(side) };
}

const METRIC_POSES: Record<'survivor' | 'monster', { label: string; pose: Partial<SurvivorPose> & Partial<MonsterPose> }[]> = {
  survivor: SURVIVOR_POSES.filter((p) => p.pose.tone !== 'flash'),
  monster: MONSTER_POSES.filter((p) => p.pose.tone !== 'flash'),
};

/** 디자인 규칙 측정: 실루엣 겹침(IoU), 자세별 범위, 몸 가운데 0.45r 원판 색 */
export function metrics(): unknown {
  const ids: CharId[] = ['runner', 'guard', 'scout', 'common', 'monster'];
  const out: Record<string, unknown> = {};
  // 1) IoU (서 있는 자세, 오른쪽을 봄) — 생존자 몸 지름 12.7 · 18 · 36px (괴물은 반지름 비율대로 크게)
  const iouTable: Record<string, Record<string, { sil: number; fill: number }>> = {};
  for (const d of [12.7, 18, 36]) {
    const size = Math.ceil(d * 2.6);
    const m: Partial<Record<CharId, { sil: Uint8Array; fill: Uint8Array }>> = {};
    for (const id of ids) {
      const r = (d / 2) * (id === 'monster' ? R_TILES.monster / R_TILES.survivor : 1);
      m[id] = masks(renderPose(id, {}, r, size));
    }
    const row: Record<string, { sil: number; fill: number }> = {};
    for (let i = 0; i < ids.length; i += 1)
      for (let j = i + 1; j < ids.length; j += 1) {
        const a = m[ids[i] as CharId];
        const b = m[ids[j] as CharId];
        if (a && b) row[`${ids[i]}-${ids[j]}`] = { sil: iou(a.sil, b.sil), fill: iou(a.fill, b.fill) };
      }
    iouTable[`${d}px`] = row;
  }
  out.iou = iouTable;
  // 2) 자세별 범위 (반지름 100px로 그려 잼)
  const ext: Record<string, Record<string, { front: number; back: number; side: number }>> = {};
  for (const id of ids) {
    const kind = id === 'monster' ? 'monster' : 'survivor';
    const r = 100;
    const wPx = wUnits(id) * r;
    const row: Record<string, { front: number; back: number; side: number }> = {};
    for (const p of METRIC_POSES[kind]) row[p.label] = extents(renderPose(id, p.pose, r, 420), r, wPx);
    ext[id] = row;
  }
  out.extents = ext;
  // 3) 몸 가운데 0.45r 원판: 역할색과의 ΔE (평균 · ΔE 15 이하 비율). 공통 생존자는 무채색 · 밝음 비율과 역할 4색 최소 ΔE
  const disc: Record<string, unknown> = {};
  for (const id of ids) {
    const r = 60;
    const size = 200;
    const img = renderPose(id, {}, r, size);
    const c = size / 2;
    let n = 0;
    let near = 0;
    let sumL = [0, 0, 0];
    let achroBright = 0;
    let minRoleDE = Infinity;
    for (let y = 0; y < size; y += 1)
      for (let x = 0; x < size; x += 1) {
        if (Math.hypot(x + 0.5 - c, y + 0.5 - c) > 0.45 * r) continue;
        const k = (y * size + x) * 4;
        const L = lab(img.data[k] ?? 0, img.data[k + 1] ?? 0, img.data[k + 2] ?? 0);
        n += 1;
        sumL = [sumL[0]! + L[0], sumL[1]! + L[1], sumL[2]! + L[2]];
        if (id === 'common') {
          if (Math.hypot(L[1], L[2]) < 8 && L[0] > 70) achroBright += 1;
          for (const rc of [ROLE.runner, ROLE.guard, ROLE.scout, ROLE.monster]) minRoleDE = Math.min(minRoleDE, deltaE(L, rc));
        } else if (deltaE(L, ROLE_COLOR[id]) <= 15) near += 1;
      }
    const mean: [number, number, number] = [sumL[0]! / n, sumL[1]! / n, sumL[2]! / n];
    disc[id] =
      id === 'common'
        ? { achromaticBright: Math.round((achroBright / n) * 1000) / 1000, minDeltaEToRoles: Math.round(minRoleDE * 10) / 10 }
        : { meanDeltaE: Math.round(deltaE(mean, ROLE_COLOR[id]) * 10) / 10, within15: Math.round((near / n) * 1000) / 1000 };
  }
  out.centerDisc = disc;
  out.rules = {
    iou: '역할끼리(러너 · 가드 · 스카우트) fill IoU ≤ 0.8, 공통과 각 역할 ≤ 0.85 (옛 기준)',
    extents: '생존자 front ≤ 1.55 (모든 자세), 옆 · 뒤 ≤ ~1.1. 괴물: 서기 · 걷기 ≤ 1.2, 준비 · 타격 ≤ 1.45, 돌진 ≤ 1.4',
    centerDisc: '역할: meanDeltaE ≤ 15, within15 ≥ 0.85. 공통: achromaticBright ≥ 0.9, minDeltaEToRoles ≥ 40',
  };
  return out;
}

/** 폰트 준비 (Noto Sans KR, data URL로 넘겨받음) */
export async function loadFont(dataUrl: string): Promise<void> {
  for (const weight of ['400', '500', '700']) {
    const f = new FontFace('Noto Sans KR', `url(${dataUrl})`, { weight });
    await f.load();
    document.fonts.add(f);
  }
}

declare global {
  interface Window {
    CHAR_ART: unknown;
  }
}

window.CHAR_ART = { previewBoard, lineupBoard, loadFont, frontSvg, oldLobbyFigure, metrics };

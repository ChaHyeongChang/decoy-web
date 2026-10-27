// 캐릭터 리디자인 시안 그림의 공통 그리기 도우미 (브라우저 쪽, scripts/char-art/*에서 쓴다). 게임 코드는 바꾸지 않는다.
// 새 캐릭터(client/src/art/chars) · 옛 캐릭터(art/atlas.ts bakeAtlas)를 그리고, 게임 연출(베기 호 · 불꽃 · 흩어짐 · 충격파 ·
// 기절 별 · 보호 거품 · 구조 링 · 속도선 · 노출 링 · 탐지 표시 · 공격 범위 · 감옥 철창)을 VISUAL_SPEC 값으로 흉내 낸다.
import {
  MAP_H,
  MONSTER_COSTUMES,
  SURVIVOR_COSTUMES,
  TILE_PX,
  validateBalance,
  type MonsterCostumeId,
  type SurvivorCostumeId,
} from '@decoy/shared';
import balanceJson from '../../config/balance.json';
import { ANIM } from '../../client/src/art/anim';
import { ART, bakeAtlas, type AtlasBuild } from '../../client/src/art/atlas';
import { drawToCanvas, type Drawing } from '../../client/src/art/chars/kit';
import { COMMON_ART, MONSTER_ART, SURVIVOR_ART } from '../../client/src/art/chars/index';
import {
  FRONT_REST,
  HIDDEN_REST,
  MONSTER_REST,
  SURVIVOR_REST,
  type CharId,
  type FrontPose,
  type MonsterPose,
  type SurvivorPose,
} from '../../client/src/art/chars/types';
import { CONE, ROLE, ROLE_TEXT, hexCss } from '../../client/src/art/palette';
import { MAP_SCALE as layoutMapScale } from '../../client/src/ui/layout';

export type Ctx = CanvasRenderingContext2D;

/** 규칙 수치 (config/balance.json 원본 그대로) */
export const BALANCE = validateBalance(balanceJson);
export const TILE = TILE_PX;
export const MAP_SCALE = layoutMapScale;
/** 맵 높이 (논리 px): 터치 넓은 배치는 이 높이가 화면 높이를 채운다 */
const MAP_DRAW_H = MAP_H * TILE_PX * MAP_SCALE;
/** 판정 반지름 (타일, balance.json) */
export const R_TILES = { survivor: BALANCE.survivor.radius, monster: BALANCE.monster.radius } as const;
export const FONT = "'Noto Sans KR', sans-serif";
export const BG = '#0b1622';
const FLOOR = '#17212b';
const FLOOR_HI = '#1f2b38';
const SEAM = '#0e151c';
/** 외곽선 두께 (월드 px, 옛 그림과 같은 값) */
export const OUTLINE_WORLD = ART.outlineWorldPx;

export const NAMES: Record<CharId, string> = {
  runner: '러너',
  guard: '가드',
  scout: '스카우트',
  common: '공통 생존자',
  monster: '괴물',
};
export const TEXT_COLOR: Record<CharId, string> = {
  runner: hexCss(ROLE_TEXT.runner),
  guard: hexCss(ROLE_TEXT.guard),
  scout: hexCss(ROLE_TEXT.scout),
  common: '#e2e8f0',
  monster: hexCss(ROLE_TEXT.monster),
};

export function kindOf(id: CharId): 'survivor' | 'monster' {
  return id === 'monster' ? 'monster' : 'survivor';
}

export function wUnits(id: CharId): number {
  return OUTLINE_WORLD / (R_TILES[kindOf(id)] * TILE);
}

/** 기기: 논리 1px = CSS px · 기기 배율 */
export interface Device {
  name: string;
  cssPerLogical: number;
  dpr: number;
  backing: number;
}

/**
 * 기기 (터치 넓은 배치는 맵 높이가 화면 높이를 채운다). dpr = 화면 배율, backing = 실제로 그리는 배율:
 * 품질 '높음'은 배율을 2로 묶어(client/src/gfx/presets.ts dprCap) 그린 뒤 화면 배율로 늘린다
 */
export const DEVICES = {
  phone3: { name: '휴대폰 가로 390pt · 배율 3', cssPerLogical: 390 / MAP_DRAW_H, dpr: 3, backing: 2 },
  phone2: { name: '보급형 휴대폰 360pt · 배율 2', cssPerLogical: 360 / MAP_DRAW_H, dpr: 2, backing: 2 },
  pc1080: { name: 'PC 1920×1080 · 배율 1', cssPerLogical: 1, dpr: 1, backing: 1 },
  pc768: { name: '노트북 1366×768 · 배율 1', cssPerLogical: 768 / 1080, dpr: 1, backing: 1 },
} as const satisfies Record<string, Device>;

/** 판정 반지름 (기기 px, 화면 배율 그대로 선명하게 그렸을 때) */
export function radiusPx(kind: 'survivor' | 'monster', d: Device): number {
  return R_TILES[kind] * TILE * MAP_SCALE * d.cssPerLogical * d.dpr;
}

/** 판정 반지름 (실제로 그리는 px: 품질 '높음'의 배율 상한 적용) */
export function backingRadiusPx(kind: 'survivor' | 'monster', d: Device): number {
  return R_TILES[kind] * TILE * MAP_SCALE * d.cssPerLogical * d.backing;
}

export function canvas(w: number, h: number): { c: HTMLCanvasElement; ctx: Ctx } {
  const c = document.createElement('canvas');
  c.width = Math.round(w);
  c.height = Math.round(h);
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2d');
  return { c, ctx };
}

export function text(
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
export function floor(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  tilePx: number,
  ox = 0,
  oy = 0,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = FLOOR;
  ctx.fillRect(x, y, w, h);
  if (tilePx >= 6) {
    const sx = x - (((ox % tilePx) + tilePx) % tilePx || 0);
    const sy = y - (((oy % tilePx) + tilePx) % tilePx || 0);
    for (let ty = sy; ty < y + h; ty += tilePx)
      for (let tx = sx; tx < x + w; tx += tilePx) {
        ctx.fillStyle = FLOOR_HI;
        ctx.fillRect(tx + 1, ty + 1, tilePx - 2, Math.max(1, tilePx * 0.04));
        ctx.fillStyle = SEAM;
        ctx.fillRect(tx, ty, tilePx, Math.max(1, tilePx * 0.03));
        ctx.fillRect(tx, ty, Math.max(1, tilePx * 0.03), tilePx);
      }
  }
  ctx.restore();
}

/** 시야 밝기 원 (빛 속 바닥 느낌: 가운데 밝고 바깥 어둡게) */
export function vignette(ctx: Ctx, w: number, h: number): void {
  const g = ctx.createRadialGradient(
    w / 2,
    h / 2,
    Math.min(w, h) * 0.25,
    w / 2,
    h / 2,
    Math.max(w, h) * 0.75,
  );
  g.addColorStop(0, 'rgba(5,8,12,0)');
  g.addColorStop(1, 'rgba(5,8,12,0.55)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

/** 접지 그림자 (옛 그림과 같은 모양: 2.15r · 1.82r, 가운데 알파 0.82) */
export function shadow(
  ctx: Ctx,
  x: number,
  y: number,
  rPx: number,
  kind: 'survivor' | 'monster',
  alpha = 1,
): void {
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

/** 그림 한 장 (알파 < 1이면 임시 캔버스에 그려 한 번에 섞는다 — 겹친 부품이 비치지 않게) */
export function paint(
  ctx: Ctx,
  d: Drawing,
  x: number,
  y: number,
  k: number,
  rot = 0,
  alpha = 1,
  sx = 1,
  sy = 1,
): void {
  if (alpha <= 0.001) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.scale(sx, sy);
  if (alpha < 1) {
    const r = Math.ceil(k * 2.4);
    const tmp = canvas(r * 2, r * 2);
    tmp.ctx.translate(r, r);
    drawToCanvas(tmp.ctx, d, k);
    ctx.globalAlpha = alpha;
    ctx.drawImage(tmp.c, -r, -r);
  } else drawToCanvas(ctx, d, k);
  ctx.restore();
}

/** 자세 + 의상 (메타 c 시안: 생존자 · 괴물 의상 id, 없으면 기본) */
export type AnyPose = Partial<SurvivorPose> & Partial<MonsterPose> & { costume?: string };

function survivorCostume(c: string | undefined): SurvivorCostumeId | undefined {
  return SURVIVOR_COSTUMES.find((k) => k === c);
}

function monsterCostume(c: string | undefined): MonsterCostumeId | undefined {
  return MONSTER_COSTUMES.find((k) => k === c);
}

export function topDrawing(id: CharId, pose: AnyPose): Drawing {
  const w = wUnits(id);
  if (id === 'monster')
    return MONSTER_ART.top({ ...MONSTER_REST, ...pose }, { w, costume: monsterCostume(pose.costume) });
  if (id === 'common')
    // 공통 생존자는 괴물 화면이 받는 값(걷기 · 수감 · 톤)만 쓴다: 능력 · 피격 · 구조 값은 건네지 않는다
    return COMMON_ART.top(
      {
        ...HIDDEN_REST,
        walk: pose.walk ?? 0,
        stride: pose.stride ?? 0,
        captive: pose.mode === 'captive',
        tone: pose.tone ?? 'normal',
      },
      { w },
    );
  return SURVIVOR_ART[id].top({ ...SURVIVOR_REST, ...pose }, { w, costume: survivorCostume(pose.costume) });
}

/** 새 그림: 위에서 본 캐릭터 (그림자 포함). rPx = 판정 반지름 (px). scale = 숨쉬기 · 찌그러짐 (x, y 따로) */
export function newTop(
  ctx: Ctx,
  id: CharId,
  pose: AnyPose,
  x: number,
  y: number,
  rPx: number,
  rot: number,
  opts: { shadow?: boolean; alpha?: number; sx?: number; sy?: number } = {},
): void {
  if (opts.shadow !== false) shadow(ctx, x, y, rPx, kindOf(id), opts.alpha ?? 1);
  paint(ctx, topDrawing(id, pose), x, y, rPx, rot, opts.alpha ?? 1, opts.sx ?? 1, opts.sy ?? 1);
}

/** 새 그림: 정면 (상자 [−1, 1]² → 한 변 size px) */
export function newFront(
  ctx: Ctx,
  id: CharId,
  pose: Partial<FrontPose> & { costume?: string },
  x: number,
  y: number,
  size: number,
  wPx = 3,
): void {
  const k = size / 2;
  const w = wPx / k;
  const p = { ...FRONT_REST, ...pose };
  const d =
    id === 'monster'
      ? MONSTER_ART.front(p, { w, costume: monsterCostume(pose.costume) })
      : id === 'common'
        ? COMMON_ART.front(p, { w })
        : SURVIVOR_ART[id].front(p, { w, costume: survivorCostume(pose.costume) });
  paint(ctx, d, x, y, k);
}

// ───────────────────────── 옛 그림 ─────────────────────────

let oldAtlas: AtlasBuild | null = null;
function old(): AtlasBuild {
  if (!oldAtlas) oldAtlas = bakeAtlas({ zoom: 7, survivorR: R_TILES.survivor, monsterR: R_TILES.monster });
  return oldAtlas;
}

function oldFrame(
  ctx: Ctx,
  name: string,
  x: number,
  y: number,
  kWorld: number,
  rot: number,
  sx = 1,
  sy = 1,
): void {
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

export function oldSurvivor(
  ctx: Ctx,
  role: 'runner' | 'guard' | 'scout' | 'hidden',
  x: number,
  y: number,
  rPx: number,
  rot: number,
  withShadow = true,
  walk = 0,
  stride = 0,
): void {
  const kWorld = rPx / (R_TILES.survivor * TILE);
  if (withShadow) oldFrame(ctx, 'shadow-survivor', x, y, kWorld, 0);
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  // 지금 게임의 걷기 자세(art/anim.ts walkPose): 두 발이 앞뒤로 엇갈린다 (몸 반지름 배수)
  const reach = ANIM.footReach * Math.sin(walk) * stride;
  for (const [fx, fy] of [
    [reach, -ANIM.footSide],
    [-reach, ANIM.footSide],
  ] as const)
    oldFrame(ctx, `foot-${role}`, x + (fx * c - fy * s) * rPx, y + (fx * s + fy * c) * rPx, kWorld, rot);
  oldFrame(ctx, `survivor-${role}`, x, y, kWorld, rot);
  oldFrame(ctx, 'gloss', x, y, kWorld, 0);
}

export function oldMonster(
  ctx: Ctx,
  x: number,
  y: number,
  rPx: number,
  rot: number,
  withShadow = true,
  cloak = 0,
  moving = false,
): void {
  const kWorld = rPx / (R_TILES.monster * TILE);
  if (withShadow) oldFrame(ctx, 'shadow-monster', x, y, kWorld, 0);
  const n = ANIM.cloakFrames;
  const frame = ((Math.floor((cloak / (Math.PI * 2)) * n) % n) + n) % n;
  oldFrame(ctx, `monster-${moving ? 'move' : 'idle'}-${frame}`, x, y, kWorld, rot);
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  for (const side of [1, -1]) {
    const ly = 0.44 * side;
    oldFrame(
      ctx,
      'claw',
      x + (0.64 * c - ly * s) * rPx,
      y + (0.64 * s + ly * c) * rPx,
      kWorld,
      rot + side * 0.38,
      1,
      side,
    );
  }
  oldFrame(ctx, 'eyes-open', x + 0.6 * c * rPx, y + 0.6 * s * rPx, kWorld, rot);
}

export function oldTop(
  ctx: Ctx,
  id: CharId,
  x: number,
  y: number,
  rPx: number,
  rot: number,
  opts: { shadow?: boolean; pose?: AnyPose } = {},
): void {
  const sh = opts.shadow !== false;
  const p = opts.pose ?? {};
  if (id === 'monster') oldMonster(ctx, x, y, rPx, rot, sh, p.cloak ?? 0, (p.stride ?? 0) > 0);
  else oldSurvivor(ctx, id === 'common' ? 'hidden' : id, x, y, rPx, rot, sh, p.walk ?? 0, p.stride ?? 0);
}

// ───────────────────────── 확대 · 흑백 ─────────────────────────

export function zoomCopy(
  ctx: Ctx,
  src: HTMLCanvasElement,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  dx: number,
  dy: number,
  k: number,
): void {
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(src, sx, sy, sw, sh, dx, dy, sw * k, sh * k);
  ctx.restore();
}

/**
 * 게임 화면 조건으로 그려 붙이기: 품질 '높음'은 화면 배율(dpr)보다 낮은 배율(backing)로 그린 뒤 합성기가 부드럽게
 * 늘린다. 그래서 작은 캔버스(그리는 px)에 그리고 기기 px 크기로 부드럽게 늘려 (x, y)에 붙인다.
 * draw(c, k): k = 그리는 px / 기기 px. 부르는 쪽은 기기 px 좌표 · 크기에 k를 곱해 그린다
 */
export function onDevice(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  d: Device,
  draw: (c: Ctx, k: number) => void,
): void {
  const k = d.backing / d.dpr;
  const src = canvas(Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k)));
  draw(src.ctx, k);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(src.c, 0, 0, src.c.width, src.c.height, x, y, w, h);
  ctx.restore();
}

/**
 * 게임 화면 조건 한 줄: 기기 d의 '높음' 품질처럼 그리는 배율로 그려 화면 배율로 늘린다. 칸마다 바닥 위 캐릭터 하나.
 * rots = 칸마다 바라보는 방향, pose = 칸마다 자세. 돌려준 값 = 그린 영역 (기기 px)
 */
export function deviceRow(
  ctx: Ctx,
  x0: number,
  y0: number,
  d: Device,
  cells: { id: CharId; rot: number; pose?: AnyPose; old?: boolean; tint?: [number, number] }[],
): { x: number; y: number; w: number; h: number } {
  const rS = radiusPx('survivor', d);
  const cell = Math.ceil(rS * 4.6);
  const w = cell * cells.length;
  const h = cell;
  onDevice(ctx, x0, y0, w, h, d, (c, k) => {
    floor(c, 0, 0, w * k, h * k, (rS / R_TILES.survivor) * k);
    cells.forEach((it, i) => {
      if (it.tint) {
        const [color, a] = it.tint;
        c.fillStyle = `rgba(${(color >> 16) & 255},${(color >> 8) & 255},${color & 255},${a})`;
        c.fillRect(cell * i * k, 0, cell * k, h * k);
      }
      const r = backingRadiusPx(kindOf(it.id), d);
      const x = cell * (i + 0.5) * k;
      const y = (h / 2) * k;
      if (it.old) oldTop(c, it.id, x, y, r, it.rot, { pose: it.pose ?? {} });
      else newTop(c, it.id, it.pose ?? {}, x, y, r, it.rot);
    });
  });
  return { x: x0, y: y0, w, h };
}

/** 영역을 흑백으로 (작업 캔버스에 옮겨 읽는다: 큰 그림 캔버스를 여러 번 읽지 않게) */
export function grayscale(ctx: Ctx, x: number, y: number, w: number, h: number): void {
  const tmp = document.createElement('canvas');
  tmp.width = Math.max(1, Math.round(w));
  tmp.height = Math.max(1, Math.round(h));
  const t = tmp.getContext('2d', { willReadFrequently: true });
  if (!t) throw new Error('2d');
  t.drawImage(ctx.canvas, x, y, tmp.width, tmp.height, 0, 0, tmp.width, tmp.height);
  const img = t.getImageData(0, 0, tmp.width, tmp.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const v = 0.2126 * (d[i] ?? 0) + 0.7152 * (d[i + 1] ?? 0) + 0.0722 * (d[i + 2] ?? 0);
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, x, y);
}

// ───────────────────────── 연출 흉내 (VISUAL_SPEC 6 · 7장 값) ─────────────────────────

function rgba(c: number, a: number): string {
  return `rgba(${(c >> 16) & 255},${(c >> 8) & 255},${c & 255},${a})`;
}

function rand(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/** 괴물 베기 호 (흰 초승달, 120ms). t01 = 진행 */
export function slashArc(ctx: Ctx, x: number, y: number, dir: number, reachPx: number, t01: number): void {
  if (t01 < 0 || t01 > 1) return;
  const a = 1 - t01;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(dir);
  const sweep = Math.PI / 2;
  const a0 = -sweep / 2 + sweep * Math.max(0, t01 - 0.35);
  const a1 = -sweep / 2 + sweep * Math.min(1, t01 * 1.6);
  ctx.lineCap = 'round';
  ctx.strokeStyle = `rgba(5,8,12,${0.6 * a})`;
  ctx.lineWidth = reachPx * 0.14;
  ctx.beginPath();
  ctx.arc(0, 0, reachPx * 0.82, a0, a1);
  ctx.stroke();
  ctx.strokeStyle = `rgba(255,255,255,${0.95 * a})`;
  ctx.lineWidth = reachPx * 0.08;
  ctx.beginPath();
  ctx.arc(0, 0, reachPx * 0.82, a0, a1);
  ctx.stroke();
  ctx.restore();
}

/** 피격 불꽃 6개 (0.2초, 따뜻한 흰색 → 주황) */
export function sparks(ctx: Ctx, x: number, y: number, rPx: number, tS: number, seed = 1): void {
  if (tS < 0 || tS > 0.2) return;
  const k = tS / 0.2;
  for (let i = 0; i < 6; i += 1) {
    const ang = (i / 6) * Math.PI * 2 + rand(seed + i) * 0.8;
    const d = rPx * (1.05 + 1.1 * k);
    const c = k < 0.5 ? 0xfff7ed : 0xf59e0b;
    ctx.fillStyle = rgba(c, 1 - k);
    ctx.beginPath();
    ctx.arc(
      x + Math.cos(ang) * d,
      y + Math.sin(ang) * d,
      Math.max(1.5, rPx * 0.09 * (1 - k * 0.5)),
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
}

/** 수감 흩어짐 14개 (0.3초, 빨강) */
export function dissolve(ctx: Ctx, x: number, y: number, rPx: number, tS: number): void {
  if (tS < 0 || tS > 0.3) return;
  const k = tS / 0.3;
  for (let i = 0; i < 14; i += 1) {
    const ang = rand(i * 3.1) * Math.PI * 2;
    const d = rPx * (0.3 + rand(i * 7.7) * 0.7 + 1.4 * k);
    ctx.fillStyle = rgba(0xef4444, 0.9 * (1 - k));
    ctx.beginPath();
    ctx.arc(x + Math.cos(ang) * d, y + Math.sin(ang) * d, Math.max(1.5, rPx * 0.1 * (1 - k)), 0, Math.PI * 2);
    ctx.fill();
  }
}

/** 충격파 고리 (밀치기 0.35초 · 기절 0.3초 · 포효 0.6초) */
export function shockwave(
  ctx: Ctx,
  x: number,
  y: number,
  r0: number,
  r1: number,
  t01: number,
  color: number,
  alpha = 0.75,
): void {
  if (t01 < 0 || t01 > 1) return;
  const r = r0 + (r1 - r0) * (1 - (1 - t01) ** 2);
  ctx.save();
  ctx.strokeStyle = `rgba(5,8,12,${0.5 * (1 - t01)})`;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = rgba(color, alpha * (1 - t01));
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/** 기절 별 셋 (노랑, 머리 위 궤도) */
export function stunStars(ctx: Ctx, x: number, y: number, rPx: number, tS: number): void {
  const cx = x;
  const cy = y - rPx * 1.85;
  for (let k = 0; k < 3; k += 1) {
    const a = tS * 3.85 + (k * Math.PI * 2) / 3;
    const sx = cx + Math.cos(a) * rPx * 0.95;
    const sy = cy + Math.sin(a) * rPx * 0.36;
    star(ctx, sx, sy, rPx * 0.36, rPx * 0.15);
  }
}

function star(ctx: Ctx, x: number, y: number, outer: number, inner: number): void {
  ctx.beginPath();
  for (let i = 0; i < 10; i += 1) {
    const r = i % 2 === 0 ? outer : inner;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    if (i === 0) ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    else ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(2, outer * 0.3);
  ctx.strokeStyle = 'rgba(5,8,12,0.85)';
  ctx.stroke();
  ctx.fillStyle = rgba(CONE.idle, 1);
  ctx.fill();
}

/** 보호 거품 (1.62r) */
export function bubble(ctx: Ctx, x: number, y: number, rPx: number, strong: boolean): void {
  const r = rPx * 1.62;
  const g = ctx.createRadialGradient(x - 0.35 * r, y - 0.4 * r, 0, x, y, r);
  g.addColorStop(0, 'rgba(255,255,255,0.16)');
  g.addColorStop(0.75, 'rgba(224,242,254,0.06)');
  g.addColorStop(1, 'rgba(224,242,254,0.22)');
  ctx.save();
  ctx.globalAlpha = strong ? 1 : 0.7;
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = Math.max(1.2, rPx * 0.07);
  ctx.strokeStyle = 'rgba(240,249,255,0.7)';
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y, r * 0.8, -2.5, -1.7);
  ctx.lineWidth = Math.max(1.2, rPx * 0.09);
  ctx.strokeStyle = 'rgba(255,255,255,0.8)';
  ctx.stroke();
  ctx.restore();
}

/** 구조 진행 링 (청록, 반지름 0.62타일) */
export function rescueRing(ctx: Ctx, x: number, y: number, tilePx: number, progress: number): void {
  const r = 0.62 * tilePx;
  ctx.save();
  ctx.lineWidth = tilePx * 0.19;
  ctx.strokeStyle = 'rgba(5,8,12,0.6)';
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = tilePx * 0.09;
  ctx.strokeStyle = 'rgba(226,232,240,0.3)';
  ctx.stroke();
  ctx.lineWidth = tilePx * 0.11;
  ctx.strokeStyle = '#22d3ee';
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, progress));
  ctx.stroke();
  ctx.restore();
}

/** 질주 속도선 (몸 뒤로 흐르는 흰 선 셋) */
export function speedLines(ctx: Ctx, x: number, y: number, face: number, rPx: number, tS: number): void {
  const c = Math.cos(face);
  const s = Math.sin(face);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(2, rPx * 0.09);
  for (let i = -1; i <= 1; i += 1) {
    const flow = (((tS * 4 + i * 0.37) % 1) + 1) % 1;
    const lx0 = -1.25 - flow * 0.6;
    const len = 0.9 - Math.abs(i) * 0.25;
    const ly = i * 0.55;
    ctx.strokeStyle = `rgba(255,255,255,${0.45 * (1 - flow)})`;
    ctx.beginPath();
    ctx.moveTo(x + (lx0 * c - ly * s) * rPx, y + (lx0 * s + ly * c) * rPx);
    ctx.lineTo(x + ((lx0 - len) * c - ly * s) * rPx, y + ((lx0 - len) * s + ly * c) * rPx);
    ctx.stroke();
  }
  ctx.restore();
}

/** 부상 긁힘 (몸 뒤쪽 붉은 세 줄, 생존자 화면만) */
export function injury(ctx: Ctx, x: number, y: number, face: number, rPx: number): void {
  const c = Math.cos(face);
  const s = Math.sin(face);
  const at = (lx: number, ly: number): [number, number] => [
    x + (lx * c - ly * s) * rPx,
    y + (lx * s + ly * c) * rPx,
  ];
  ctx.save();
  ctx.lineCap = 'round';
  for (let i = -1; i <= 1; i += 1) {
    const [ax, ay] = at(-0.95, i * 0.26 - 0.12);
    const [bx, by] = at(-0.62, i * 0.26 + 0.12);
    ctx.lineWidth = Math.max(2.5, rPx * 0.16);
    ctx.strokeStyle = 'rgba(5,8,12,0.8)';
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
    ctx.lineWidth = Math.max(1.4, rPx * 0.08);
    ctx.strokeStyle = '#ef4444';
    ctx.stroke();
  }
  ctx.restore();
}

/** 지금 그림의 능력 노출 표시: 역할색 링 + 머리 위 문양 (아틀라스 'ring-reveal-*' · 'glyph-*', 문양 거리 2.35r) */
export function oldRevealMark(
  ctx: Ctx,
  x: number,
  y: number,
  rPx: number,
  role: 'runner' | 'guard' | 'scout',
): void {
  const kWorld = rPx / (R_TILES.survivor * TILE);
  oldFrame(ctx, `ring-reveal-${role}`, x, y, kWorld, 0);
  oldFrame(ctx, `glyph-${role}`, x, y - 2.35 * rPx, kWorld, 0);
}

/** 스카우트 탐지 표시: 초록 마름모 + 조준선 + 펄스 (VISUAL_SPEC) */
export function trackMark(ctx: Ctx, x: number, y: number, s: number, tS: number): void {
  const pulse = (tS % 0.8) / 0.8;
  ctx.save();
  ctx.lineWidth = 2;
  ctx.strokeStyle = rgba(ROLE.scout, 0.7 * (1 - pulse));
  ctx.beginPath();
  ctx.arc(x, y, s * (1.15 + pulse * 1.3), 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x, y - s);
  ctx.lineTo(x + s, y);
  ctx.lineTo(x, y + s);
  ctx.lineTo(x - s, y);
  ctx.closePath();
  ctx.fillStyle = rgba(ROLE.scout, 0.22);
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = 'rgba(5,8,12,0.85)';
  ctx.stroke();
  ctx.lineWidth = 3;
  ctx.strokeStyle = rgba(ROLE.scout, 1);
  ctx.stroke();
  for (const [dx, dy] of [
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0],
  ] as const) {
    ctx.lineWidth = 4.5;
    ctx.strokeStyle = 'rgba(5,8,12,0.8)';
    ctx.beginPath();
    ctx.moveTo(x + dx * (s + 3), y + dy * (s + 3));
    ctx.lineTo(x + dx * (s + 9), y + dy * (s + 9));
    ctx.stroke();
    ctx.lineWidth = 2;
    ctx.strokeStyle = rgba(ROLE.scout, 1);
    ctx.stroke();
  }
  ctx.restore();
}

/** 괴물 공격 준비 범위 (흰 부채꼴 90° · 반지름 = attack.range, 채움이 0 → 100% 차오름) */
export function attackFan(
  ctx: Ctx,
  x: number,
  y: number,
  dir: number,
  rangePx: number,
  fill01: number,
): void {
  const half = Math.PI / 4;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(dir);
  ctx.fillStyle = 'rgba(255,255,255,0.2)';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.arc(0, 0, rangePx * Math.max(0.02, fill01), -half, half);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.arc(0, 0, rangePx, -half, half);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

/** 감옥 철창 칸 (붉은 철창 + 바닥 격자). (x, y) = 왼쪽 위, 크기 w × h px */
export function prisonCell(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  tilePx: number,
  doorOpen = 0,
): void {
  ctx.save();
  ctx.fillStyle = '#0d141b';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = 'rgba(30,45,58,0.9)';
  ctx.lineWidth = 1;
  for (let gx = x; gx <= x + w; gx += tilePx / 4) {
    ctx.beginPath();
    ctx.moveTo(gx, y);
    ctx.lineTo(gx, y + h);
    ctx.stroke();
  }
  for (let gy = y; gy <= y + h; gy += tilePx / 4) {
    ctx.beginPath();
    ctx.moveTo(x, gy);
    ctx.lineTo(x + w, gy);
    ctx.stroke();
  }
  const bar = (x0: number, y0: number, x1: number, y1: number): void => {
    ctx.lineCap = 'round';
    ctx.lineWidth = tilePx * 0.16;
    ctx.strokeStyle = '#dc2626';
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.lineWidth = tilePx * 0.05;
    ctx.strokeStyle = '#fca5a5';
    ctx.stroke();
  };
  bar(x, y, x + w, y);
  bar(x, y, x, y + h);
  bar(x + w, y, x + w, y + h);
  const door = w * 0.4 * (1 - doorOpen);
  bar(x, y + h, x + w * 0.3, y + h);
  bar(x + w * 0.7, y + h, x + w, y + h);
  if (door > 1) bar(x + w * 0.3, y + h, x + w * 0.3 + door, y + h);
  ctx.restore();
}

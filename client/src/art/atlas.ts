// 캐릭터 그림 굽기 (M10b): 몸 · 발 · 그림자 · 망토 자락 프레임 · 발톱 · 얼굴 · 링 · 문양 아이콘을 Canvas2D로 한 장에 그려
// 텍스처 하나로 올린다. 매 프레임에는 이 그림을 이미지로만 찍는다(품질 낮음 · Canvas 비용이 늘지 않게).
//
// 해상도: 화면에서 1텍셀 ≈ 기기 1px (zoom × MAP_SCALE × TILE_PX × 크기). zoom이 바뀌면(onGfxChange) 다시 굽는다.
// 입체감: 가장자리 어두운 외곽선(OUTLINE), 몸은 위에서 비춘 돔 음영(가운데 원판은 역할색 그대로 — 생존자 화면
// 역할색 유지), 회전하지 않는 반사광(spec), 부드러운 바닥 그림자 + 접지 그림자(바깥 링 대비 3:1).
// 괴물 화면의 생존자 그림은 기존 스타일에서 'survivor-hidden' 하나 · 'foot-hidden' 하나 · 공통 그림자뿐이다(역할 · 체력과 무관).
// 새 스타일은 공통 생존자의 쉬기 · 걷기 8장 · 흰 번쩍('survivor-hidden', '~w0..7', '-flash')이고 걷기 위상 · 세기만으로 고른다
// (charFrames.ts hiddenFrameNew). 'foot-hidden'은 빈 칸 별칭이다.
import Phaser from 'phaser';
import { TILE_PX } from '@decoy/shared';
import { currentCharStyle, type CharStyle } from '../gfx/charStyle';
import { currentPreset, gfxState } from '../gfx/state';
import { createCanvasTexture, removeCanvasTexture } from '../render/fogPaint';
import { WORLD_SCALE } from '../ui/layout';
import { cloakPoseFor, ANIM } from './anim';
import { DrawingMemo, EMPTY_ALIASES, SHARED_FRAMES, newStyleFrameSpecs, type FrameBox } from './charFrames';
import { clearPathCache, drawToCanvas } from './chars/kit';
import { HIDDEN_SURVIVOR, OUTLINE, ROLE } from './palette';
import {
  GLYPHS,
  MONSTER_FACE,
  SURVIVOR_SHAPES,
  circlePoly,
  CLOAK_TAIL_START,
  clawPoly,
  cloakOutline,
  tracePolys,
  type GlyphId,
  type Poly,
  type Shape,
  type SurvivorShapeId,
} from './shapes';

/** 그림 상수 (그래픽 값) */
export const ART = {
  /** 외곽선 두께 (월드 px, 화면에서 약 1.7 논리 px) */
  outlineWorldPx: 1.8,
  /** 얼굴 · 문양 색 */
  faceDark: 0x1a0b0e,
  eye: 0xfff1f2,
  eyeGlow: 0xfb7185,
  claw: 0xf1e6e8,
  /** 숨은 생존자 음영 (무채색) */
  hiddenRim: 0xc5cad1,
  hiddenFoot: 0x8b939c,
  /** 사망 회색 */
  deadGray: 0x6b7280,
  /** 그림자: 바깥 반지름 (몸 반지름 배수) · 가운데 알파 */
  shadowR: 2.15,
  shadowAlpha: 0.82,
  /** 반사광 위치 · 크기 · 알파 (회전하지 않음) */
  specX: -0.42,
  specY: -0.46,
  specR: 0.36,
  specAlpha: 0.3,
  /** 나 표시 링 반지름 (몸 반지름 배수) */
  selfRingR: 1.36,
  /** 보호 거품 반지름 */
  bubbleR: 1.62,
  /** 노출 링 반지름 */
  revealRingR: 1.34,
} as const;

export const MONSTER_FRAME_KINDS = ['idle', 'move'] as const;

/** 빛 속 먼지 점 ('mote' 프레임) 반지름 (생존자 반지름 배수). 매 프레임 원을 다시 펴지 않고 이 그림을 이미지로 찍는다 */
export const MOTE_R = 0.25;
/** 먼지 색 (무채색, art/fx.ts FX_COLOR.dust와 같은 값) */
const MOTE_COLOR = 0xd6dde6;

export interface AtlasParams {
  zoom: number;
  /**
   * 텍셀 / 월드 px 상한 (품질 charTexelCap). 따라가는 카메라는 캐릭터를 크게 그려 기기 픽셀 1:1이면 텍스처가 커진다 —
   * 넘으면 조금 늘려 그린다. 없으면 상한 없음
   */
  texCap?: number;
  /** 월드 그림 배율 (논리 px / 월드 px, 확대 수준). 없으면 지금 값 */
  worldScale?: number;
  /** 생존자 · 괴물 판정 반지름 (타일, balance) */
  survivorR: number;
  monsterR: number;
  /** 캐릭터 스타일 (캐릭터 리디자인 2단계). 없으면 기존 — 고른 스타일 하나만 굽는다(텍스처 예산) */
  style?: CharStyle;
}

export interface AtlasFrame {
  x: number;
  y: number;
  w: number;
  h: number;
  /**
   * 그림 중심의 칸 안 자리 (0~1, Phaser frame pivot). 새 스타일만 쓴다: 앞이 긴 그림을 직사각 칸에 굽기 때문이다.
   * 새 스타일 텍스처는 모든 프레임에 pivot을 둔다(없는 프레임으로 바꾸면 Phaser가 앞 프레임의 origin을 그대로 둔다)
   */
  pivotX?: number;
  pivotY?: number;
}

export interface AtlasBuild {
  canvas: HTMLCanvasElement;
  frames: Map<string, AtlasFrame>;
  params: AtlasParams;
  /** 굽는 데 걸린 시간 (ms) */
  ms: number;
  /** 텍셀 / 월드 px */
  texPerWorld: number;
}

type Ctx = CanvasRenderingContext2D;

function css(c: number, a = 1): string {
  return `rgba(${(c >> 16) & 255}, ${(c >> 8) & 255}, ${c & 255}, ${a})`;
}

/** 두 색 섞기 */
export function mixRgb(a: number, b: number, k: number): number {
  let out = 0;
  for (const s of [16, 8, 0]) {
    const v = Math.round(((a >> s) & 255) * (1 - k) + ((b >> s) & 255) * k);
    out |= Math.max(0, Math.min(255, v)) << s;
  }
  return out;
}

const shade = (c: number, k: number): number => mixRgb(c, 0x000000, k);
const tint = (c: number, k: number): number => mixRgb(c, 0xffffff, k);

function path(ctx: Ctx, polys: readonly Poly[], k: number): void {
  ctx.beginPath();
  tracePolys(ctx, polys, k);
}

/** 실루엣: 바깥 외곽선(두께 w) + 채움 */
function silhouette(
  ctx: Ctx,
  polys: readonly Poly[],
  k: number,
  fill: string | CanvasGradient,
  w: number,
): void {
  path(ctx, polys, k);
  ctx.lineJoin = 'round';
  ctx.lineWidth = w * 2;
  ctx.strokeStyle = css(OUTLINE);
  ctx.stroke();
  ctx.fillStyle = fill;
  ctx.fill('nonzero');
}

function fillMarks(ctx: Ctx, s: Shape, k: number, color: string): void {
  if (s.marks.length === 0) return;
  for (const m of s.marks) {
    path(ctx, [m], k);
    ctx.fillStyle = color;
    ctx.fill('evenodd');
  }
}

/** 돔 음영 (위에서 비춘 빛): 가운데 원판은 원래 색, 가장자리로 갈수록 어둡다. 회전과 무관 */
function dome(ctx: Ctx, k: number, base: number, rim: number, reach = 1.6): CanvasGradient {
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, reach * k);
  g.addColorStop(0, css(tint(base, 0.06)));
  g.addColorStop(0.5 / reach, css(base));
  g.addColorStop(0.97 / reach, css(rim));
  g.addColorStop(1, css(shade(rim, 0.25)));
  return g;
}

// ───────────────────────── 생존자 ─────────────────────────

const SURVIVOR_BASE: Record<SurvivorShapeId, number> = {
  runner: ROLE.runner,
  guard: ROLE.guard,
  scout: ROLE.scout,
  hidden: HIDDEN_SURVIVOR,
};

function drawSurvivorBody(ctx: Ctx, id: SurvivorShapeId, k: number, w: number, gray = false): void {
  const s = SURVIVOR_SHAPES[id];
  const base = gray ? ART.deadGray : SURVIVOR_BASE[id];
  const rim = id === 'hidden' ? ART.hiddenRim : shade(base, 0.3);
  const mark = id === 'hidden' ? css(OUTLINE) : css(shade(base, 0.82));
  // 1) 바깥 외곽선 (실루엣 전체)
  path(ctx, s.outline, k);
  ctx.lineJoin = 'round';
  ctx.lineWidth = w * 2;
  ctx.strokeStyle = css(OUTLINE);
  ctx.stroke();
  // 2) 소품 (몸 원 밖 부분): 역할마다 재질
  if (id === 'guard') {
    const shield = s.outline[1];
    if (shield) {
      const g = ctx.createRadialGradient(0, 0, 1.1 * k, 0, 0, 1.52 * k);
      g.addColorStop(0, css(shade(base, 0.35)));
      g.addColorStop(0.55, css(tint(base, 0.18)));
      g.addColorStop(1, css(tint(base, 0.32)));
      path(ctx, [shield], k);
      ctx.fillStyle = g;
      ctx.fill();
    }
  } else if (id === 'scout') {
    const box = s.outline[1];
    if (box) {
      const g = ctx.createLinearGradient(0, -0.42 * k, 0, 0.42 * k);
      g.addColorStop(0, css(tint(base, 0.15)));
      g.addColorStop(1, css(shade(base, 0.35)));
      path(ctx, [box], k);
      ctx.fillStyle = g;
      ctx.fill();
    }
  } else if (id === 'hidden') {
    const notch = s.outline[1];
    if (notch) {
      path(ctx, [notch], k);
      ctx.fillStyle = css(mixRgb(HIDDEN_SURVIVOR, ART.hiddenRim, 0.5));
      ctx.fill();
    }
  }
  // 3) 몸 (러너는 물방울 전체가 몸)
  const bodyPolys = id === 'runner' ? s.outline : [circlePoly(0, 0, 1, 64)];
  path(ctx, bodyPolys, k);
  ctx.fillStyle = dome(ctx, k, base, rim, id === 'runner' ? 1.7 : 1.05);
  ctx.fill();
  // 4) 몸 원 위쪽 테두리의 얇은 밝은 테 (윗면 하이라이트, 회전과 무관한 고리)
  ctx.beginPath();
  ctx.arc(0, 0, 0.86 * k, 0, Math.PI * 2);
  ctx.lineWidth = Math.max(0.8, 0.07 * k);
  ctx.strokeStyle = css(0xffffff, id === 'hidden' ? 0.35 : 0.14);
  ctx.stroke();
  // 5) 문양
  fillMarks(ctx, s, k, mark);
  if (id === 'scout') {
    // 렌즈 유리 반짝임 (앞쪽 렌즈 안, 몸 원판 밖)
    ctx.beginPath();
    ctx.arc(1.04 * k, -0.07 * k, 0.07 * k, 0, Math.PI * 2);
    ctx.fillStyle = css(0xffffff, 0.75);
    ctx.fill();
  }
  if (id === 'guard') {
    // 방패 바깥 가장자리 하이라이트
    ctx.beginPath();
    ctx.arc(0, 0, 1.43 * k, -0.9, 0.9);
    ctx.lineWidth = Math.max(0.8, 0.08 * k);
    ctx.strokeStyle = css(0xffffff, 0.3);
    ctx.stroke();
  }
}

/** 흰 실루엣 (피격 번쩍) */
function drawFlash(ctx: Ctx, s: Shape, k: number, w: number): void {
  path(ctx, s.outline, k);
  ctx.lineJoin = 'round';
  ctx.lineWidth = w;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.fill();
}

function drawFoot(ctx: Ctx, color: number, k: number, w: number): void {
  ctx.beginPath();
  ctx.ellipse(0, 0, 0.3 * k, 0.21 * k, 0, 0, Math.PI * 2);
  ctx.lineWidth = w * 1.6;
  ctx.strokeStyle = css(OUTLINE);
  ctx.stroke();
  ctx.fillStyle = css(color);
  ctx.fill();
}

/** 바닥 그림자 + 접지 그림자: 몸 둘레를 어둡게 해 어떤 바닥 · 범위 위에서도 몸이 떠 보인다 */
function drawShadow(ctx: Ctx, k: number, reach: number, alpha: number): void {
  const g = ctx.createRadialGradient(0, 0.1 * k, 0, 0, 0.1 * k, reach * k);
  g.addColorStop(0, css(OUTLINE, alpha));
  g.addColorStop(0.55, css(OUTLINE, alpha * 0.96));
  g.addColorStop(0.8, css(OUTLINE, alpha * 0.6));
  g.addColorStop(1, css(OUTLINE, 0));
  ctx.beginPath();
  ctx.arc(0, 0.1 * k, reach * k, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
}

/**
 * 윤기 (회전하지 않는 몸 원 위 빛, 빛은 화면 왼쪽 위): 왼쪽 위 반사 점 + 윗가장자리 밝은 호 + 오른쪽 아래 가장자리 그늘.
 * 몸 원(반지름 1) 안에만 그려 소품(방패 · 렌즈 · 물방울 끝)에 걸치지 않고, 가운데 0.45 원판은 거의 건드리지 않는다
 */
function drawGloss(ctx: Ctx, k: number): void {
  const sx = ART.specX * k;
  const sy = ART.specY * k;
  const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, ART.specR * k);
  g.addColorStop(0, css(0xffffff, ART.specAlpha));
  g.addColorStop(1, css(0xffffff, 0));
  ctx.beginPath();
  ctx.arc(sx, sy, ART.specR * k, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(0, 0, 0.8 * k, Math.PI * 1.08, Math.PI * 1.55);
  ctx.lineWidth = Math.max(1, 0.1 * k);
  ctx.strokeStyle = css(0xffffff, 0.42);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, 0.84 * k, Math.PI * 0.05, Math.PI * 0.62);
  ctx.lineWidth = Math.max(1, 0.2 * k);
  ctx.strokeStyle = css(OUTLINE, 0.2);
  ctx.stroke();
}

function drawRing(ctx: Ctx, k: number, r: number, color: number, width: number, outline: boolean): void {
  if (outline) {
    ctx.beginPath();
    ctx.arc(0, 0, r * k, 0, Math.PI * 2);
    ctx.lineWidth = width + 2.4;
    ctx.strokeStyle = css(OUTLINE, 0.9);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(0, 0, r * k, 0, Math.PI * 2);
  ctx.lineWidth = width;
  ctx.strokeStyle = css(color);
  ctx.stroke();
}

function drawBubble(ctx: Ctx, k: number): void {
  const r = ART.bubbleR * k;
  const g = ctx.createRadialGradient(-0.35 * r, -0.4 * r, 0, 0, 0, r);
  g.addColorStop(0, css(0xffffff, 0.16));
  g.addColorStop(0.75, css(0xe0f2fe, 0.06));
  g.addColorStop(1, css(0xe0f2fe, 0.22));
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = Math.max(1.2, 0.07 * k);
  ctx.strokeStyle = css(0xf0f9ff, 0.7);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.8, -2.5, -1.7);
  ctx.lineWidth = Math.max(1.2, 0.09 * k);
  ctx.strokeStyle = css(0xffffff, 0.8);
  ctx.stroke();
}

/** 먼지 점: 가운데는 불투명, 가장자리 1텍셀 남짓만 부드럽게 (알파 · 크기는 이미지에서) */
function drawMote(ctx: Ctx, k: number): void {
  const r = MOTE_R * k;
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
  g.addColorStop(0, css(MOTE_COLOR));
  g.addColorStop(Math.max(0, 1 - 1.2 / Math.max(1, r)), css(MOTE_COLOR));
  g.addColorStop(1, css(MOTE_COLOR, 0));
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
}

/** 머리 위 역할 문양 배지 (괴물 화면 능력 노출 · HUD): 어두운 원판 + 역할색 문양(모양이 역할마다 다르다) */
function drawGlyphBadge(ctx: Ctx, id: GlyphId, k: number, w: number): void {
  const color = ROLE[id];
  ctx.beginPath();
  ctx.arc(0, 0, k, 0, Math.PI * 2);
  ctx.fillStyle = css(0x0b1622, 0.92);
  ctx.fill();
  ctx.lineWidth = Math.max(1.2, w);
  ctx.strokeStyle = css(color);
  ctx.stroke();
  const g = GLYPHS[id];
  const gk = k * 0.62;
  path(ctx, g.outline, gk);
  ctx.fillStyle = css(color);
  ctx.fill('evenodd');
  for (const m of g.marks) {
    path(ctx, [m], gk);
    ctx.fillStyle = css(0x0b1622);
    ctx.fill('evenodd');
  }
}

// ───────────────────────── 괴물 ─────────────────────────

function drawCloak(
  ctx: Ctx,
  kind: 'idle' | 'move' | 'dash' | 'stun',
  i: number,
  frames: number,
  k: number,
  w: number,
): void {
  const pose = cloakPoseFor(kind, i, frames);
  const outline = cloakOutline(pose);
  const base = ROLE.monster;
  // 1) 망토: 어깨는 원색, 자락 끝으로 갈수록 어둡다
  const g = ctx.createRadialGradient(0.3 * k, 0, 0.1 * k, 0.15 * k, 0, 1.25 * k);
  g.addColorStop(0, css(base));
  g.addColorStop(0.5, css(shade(base, 0.1)));
  g.addColorStop(0.8, css(shade(base, 0.34)));
  g.addColorStop(1, css(shade(base, 0.52)));
  silhouette(ctx, [outline], k, g, w);
  // 2) 자락 주름: 골은 어둡게, 마루는 밝게 (후드 가장자리 → 자락 끝)
  const tail = outline.slice(CLOAK_TAIL_START);
  ctx.lineCap = 'round';
  tail.forEach((p, idx) => {
    if (idx === 0 || idx === tail.length - 1) return;
    const ridge = idx % 2 === 1;
    const from = { x: 0.05 + p.x * 0.18, y: p.y * 0.42 };
    const to = { x: p.x * (ridge ? 0.9 : 0.97), y: p.y * (ridge ? 0.9 : 0.97) };
    ctx.beginPath();
    ctx.moveTo(from.x * k, from.y * k);
    ctx.quadraticCurveTo(((from.x + to.x) / 2) * k, ((from.y + to.y) / 2) * k * 1.12, to.x * k, to.y * k);
    ctx.lineWidth = Math.max(1, (ridge ? 0.07 : 0.1) * k);
    ctx.strokeStyle = ridge ? css(tint(base, 0.3), 0.35) : css(shade(base, 0.62), 0.6);
    ctx.stroke();
  });
  // 3) 후드 (머리 꼭대기): 밝은 돔 + 어두운 이음선
  const hx = 0.3 * k;
  const hr = 0.52 * k;
  ctx.beginPath();
  ctx.arc(hx, 0, hr, 0, Math.PI * 2);
  const hg = ctx.createRadialGradient(hx - 0.18 * k, -0.2 * k, 0.05 * k, hx, 0, hr);
  hg.addColorStop(0, css(tint(base, 0.32)));
  hg.addColorStop(0.55, css(tint(base, 0.06)));
  hg.addColorStop(1, css(shade(base, 0.12)));
  ctx.fillStyle = hg;
  ctx.fill();
  ctx.lineWidth = Math.max(1, 0.08 * k);
  ctx.strokeStyle = css(shade(base, 0.55), 0.9);
  ctx.beginPath();
  ctx.arc(hx, 0, hr, Math.PI * 0.42, Math.PI * 1.58);
  ctx.stroke();
  // 후드 꼭대기의 뾰족한 솔기 (뒤로 뻗은 선)
  ctx.beginPath();
  ctx.moveTo(hx - 0.05 * k, 0);
  ctx.lineTo(hx - hr * 1.05, 0);
  ctx.lineWidth = Math.max(1, 0.06 * k);
  ctx.strokeStyle = css(shade(base, 0.45), 0.7);
  ctx.stroke();
  // 4) 얼굴 (후드 앞 구멍, 어두운 타원) — 눈은 따로 그린다
  const f = MONSTER_FACE;
  ctx.beginPath();
  ctx.ellipse(f.cx * k, f.cy * k, f.rx * k, f.ry * k, 0, 0, Math.PI * 2);
  const fg = ctx.createRadialGradient(f.cx * k, 0, 0, f.cx * k, 0, f.ry * k);
  fg.addColorStop(0, css(ART.faceDark));
  fg.addColorStop(0.7, css(ART.faceDark));
  fg.addColorStop(1, css(shade(base, 0.68)));
  ctx.fillStyle = fg;
  ctx.fill();
}

/** 눈: open = 흰 분홍 점 둘, blink = 가는 선, stun = × */
function drawEyes(ctx: Ctx, mode: 'open' | 'blink' | 'stun', k: number): void {
  const f = MONSTER_FACE;
  for (const s of [-1, 1]) {
    const x = (f.eyeX - f.cx) * k;
    const y = f.eyeY * s * k;
    ctx.fillStyle = css(ART.eye);
    ctx.strokeStyle = css(ART.eye);
    ctx.lineCap = 'round';
    if (mode === 'open') {
      // 얼굴 안의 붉은 눈빛 (구운 것, 모든 품질) + 비스듬한 아몬드 눈
      const g = ctx.createRadialGradient(x, y, 0, x, y, f.eyeR * k * 2.6);
      g.addColorStop(0, css(ART.eyeGlow, 0.55));
      g.addColorStop(1, css(ART.eyeGlow, 0));
      ctx.beginPath();
      ctx.arc(x, y, f.eyeR * k * 2.6, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(x, y, f.eyeR * k * 0.72, f.eyeR * k * 1.45, s * 0.42, 0, Math.PI * 2);
      ctx.fillStyle = css(ART.eye);
      ctx.fill();
    } else if (mode === 'blink') {
      ctx.beginPath();
      ctx.moveTo(x, y - f.eyeR * k);
      ctx.lineTo(x, y + f.eyeR * k);
      ctx.lineWidth = Math.max(1, 0.05 * k);
      ctx.stroke();
    } else {
      const e = f.eyeR * k * 1.15;
      ctx.beginPath();
      ctx.moveTo(x - e, y - e);
      ctx.lineTo(x + e, y + e);
      ctx.moveTo(x + e, y - e);
      ctx.lineTo(x - e, y + e);
      ctx.lineWidth = Math.max(1.1, 0.07 * k);
      ctx.stroke();
    }
  }
}

function drawEyeGlow(ctx: Ctx, k: number): void {
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, k);
  g.addColorStop(0, css(ART.eyeGlow, 0.55));
  g.addColorStop(0.4, css(ART.eyeGlow, 0.18));
  g.addColorStop(1, css(ART.eyeGlow, 0));
  ctx.beginPath();
  ctx.arc(0, 0, k, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
}

function drawClaw(ctx: Ctx, k: number, w: number): void {
  // 발톱 하나 (아래쪽, side = 1). 그림 중심 = 발톱 뿌리. 뿌리는 망토 소매(어두운 빨강), 끝은 뼈 색
  ctx.beginPath();
  ctx.arc(0, 0, 0.12 * k, 0, Math.PI * 2);
  ctx.fillStyle = css(shade(ROLE.monster, 0.45));
  ctx.lineWidth = w * 1.2;
  ctx.strokeStyle = css(OUTLINE);
  ctx.stroke();
  ctx.fill();
  const g = ctx.createLinearGradient(0, 0, 0.43 * k, 0);
  g.addColorStop(0, css(shade(ART.claw, 0.3)));
  g.addColorStop(0.5, css(ART.claw));
  g.addColorStop(1, css(0xffffff));
  silhouette(ctx, [clawPoly()], k, g, w * 0.75);
}

// ───────────────────────── 굽기 ─────────────────────────

interface FrameDef {
  name: string;
  /** 반쪽 크기 (단위 배수) */
  ext: number;
  unit: 's' | 'm';
  draw: (ctx: Ctx, k: number, w: number) => void;
  /** 직사각 칸 (새 스타일 캐릭터 그림). 있으면 ext 대신 이 상자로 칸을 잡고 중심을 pivot으로 적는다 */
  box?: FrameBox;
}

/** 빈 칸 이름 (EMPTY_ALIASES가 모두 이 칸을 가리킨다) */
const EMPTY_FRAME = '~empty';

/** 망토 프레임 이름 */
export function cloakFrameName(kind: 'idle' | 'move', i: number): string {
  return `monster-${kind}-${i}`;
}

/**
 * 새 스타일 프레임: 옛 그림 중 공용 프레임 + 새 캐릭터 그림(자세마다 한 칸) + 빈 칸 하나.
 * 새 그림의 외곽선 두께는 옛 그림과 같은 월드 px(ART.outlineWorldPx)를 그 단위의 그림 단위로 바꾼 값이다
 */
/** 새 스타일 그림 명령 기억 (판 중 배율이 바뀌어 다시 구울 때 래스터만). 기존 스타일을 구우면 비운다 */
const drawMemo = new DrawingMemo();

function newFrameDefs(survivorR: number, monsterR: number): FrameDef[] {
  const defs = classicFrameDefs().filter((d) => SHARED_FRAMES.includes(d.name));
  const ws = ART.outlineWorldPx / (survivorR * TILE_PX);
  const wm = ART.outlineWorldPx / (monsterR * TILE_PX);
  for (const spec of newStyleFrameSpecs()) {
    const ow = spec.unit === 's' ? ws : wm;
    defs.push({
      name: spec.name,
      ext: 0,
      unit: spec.unit,
      box: spec.box,
      draw: (c, k) => drawToCanvas(c, drawMemo.get(spec, ow), k),
    });
  }
  defs.push({ name: EMPTY_FRAME, ext: 0, unit: 's', draw: () => undefined });
  return defs;
}

function frameDefs(params: AtlasParams): FrameDef[] {
  return params.style === 'new' ? newFrameDefs(params.survivorR, params.monsterR) : classicFrameDefs();
}

function classicFrameDefs(): FrameDef[] {
  const defs: FrameDef[] = [];
  const ids: SurvivorShapeId[] = ['runner', 'guard', 'scout', 'hidden'];
  for (const id of ids) {
    defs.push({
      name: `survivor-${id}`,
      ext: 1.62,
      unit: 's',
      draw: (c, k, w) => drawSurvivorBody(c, id, k, w),
    });
    defs.push({
      name: `survivor-${id}-flash`,
      ext: 1.62,
      unit: 's',
      draw: (c, k, w) => drawFlash(c, SURVIVOR_SHAPES[id], k, w),
    });
    if (id !== 'hidden')
      defs.push({
        name: `survivor-${id}-gray`,
        ext: 1.62,
        unit: 's',
        draw: (c, k, w) => drawSurvivorBody(c, id, k, w, true),
      });
    const foot = id === 'hidden' ? ART.hiddenFoot : shade(SURVIVOR_BASE[id], 0.45);
    defs.push({ name: `foot-${id}`, ext: 0.42, unit: 's', draw: (c, k, w) => drawFoot(c, foot, k, w) });
  }
  defs.push({
    name: 'shadow-survivor',
    ext: ART.shadowR + 0.12,
    unit: 's',
    draw: (c, k) => drawShadow(c, k, ART.shadowR, ART.shadowAlpha),
  });
  defs.push({
    name: 'shadow-monster',
    ext: 1.95,
    unit: 'm',
    draw: (c, k) => drawShadow(c, k, 1.82, ART.shadowAlpha),
  });
  defs.push({ name: 'gloss', ext: 1.02, unit: 's', draw: (c, k) => drawGloss(c, k) });
  defs.push({
    name: 'ring-self',
    ext: ART.selfRingR + 0.2,
    unit: 's',
    draw: (c, k) => drawRing(c, k, ART.selfRingR, 0xffffff, Math.max(1.5, 0.12 * k), true),
  });
  for (const role of ['runner', 'guard', 'scout'] as const) {
    defs.push({
      name: `ring-reveal-${role}`,
      ext: ART.revealRingR + 0.3,
      unit: 's',
      draw: (c, k) => drawRing(c, k, ART.revealRingR, ROLE[role], Math.max(2.5, 0.22 * k), true),
    });
    defs.push({
      name: `glyph-${role}`,
      ext: 0.95,
      unit: 's',
      draw: (c, k, w) => drawGlyphBadge(c, role, k * 0.86, w),
    });
  }
  defs.push({ name: 'bubble', ext: ART.bubbleR + 0.12, unit: 's', draw: (c, k) => drawBubble(c, k) });
  defs.push({ name: 'mote', ext: MOTE_R + 0.04, unit: 's', draw: (c, k) => drawMote(c, k) });
  const frames = ANIM.cloakFrames;
  for (const kind of MONSTER_FRAME_KINDS)
    for (let i = 0; i < frames; i += 1)
      defs.push({
        name: cloakFrameName(kind, i),
        ext: 1.42,
        unit: 'm',
        draw: (c, k, w) => drawCloak(c, kind, i, frames, k, w),
      });
  defs.push({
    name: 'monster-dash',
    ext: 1.6,
    unit: 'm',
    draw: (c, k, w) => drawCloak(c, 'dash', 0, 1, k, w),
  });
  defs.push({
    name: 'monster-stun',
    ext: 1.42,
    unit: 'm',
    draw: (c, k, w) => drawCloak(c, 'stun', 0, 1, k, w),
  });
  for (const mode of ['open', 'blink', 'stun'] as const)
    defs.push({ name: `eyes-${mode}`, ext: 0.32, unit: 'm', draw: (c, k) => drawEyes(c, mode, k) });
  defs.push({ name: 'eye-glow', ext: 0.36, unit: 'm', draw: (c, k) => drawEyeGlow(c, k * 0.34) });
  defs.push({ name: 'claw', ext: 0.5, unit: 'm', draw: (c, k, w) => drawClaw(c, k, w) });
  return defs;
}

/** 지금 그래픽 상태의 굽기 값 (캐릭터 스타일 포함) */
export function atlasParamsFor(survivorR: number, monsterR: number): AtlasParams {
  return {
    zoom: gfxState.zoom,
    texCap: currentPreset().charTexelCap,
    worldScale: WORLD_SCALE,
    survivorR,
    monsterR,
    style: currentCharStyle(),
  };
}

/** 텍셀 / 월드 px (= 화면 기기 px / 월드 px, 확대 수준 반영), 상한 cap */
export function texelsPerWorldPx(zoom: number, cap = Infinity, worldScale = WORLD_SCALE): number {
  return Math.min(Math.max(0.25, zoom) * worldScale, cap > 0 ? cap : Infinity);
}

/** 굽기 값의 텍셀 / 월드 px */
export function paramsTexels(p: AtlasParams): number {
  return texelsPerWorldPx(p.zoom, p.texCap, p.worldScale);
}

/** 칸 크기 · 그림 중심 (텍셀). 정사각 칸은 가운데, 직사각 칸은 상자 원점 자리 */
interface Cell {
  d: FrameDef;
  w: number;
  h: number;
  /** 그림 중심의 칸 안 자리 (텍셀) */
  ox: number;
  oy: number;
}

function cellOf(d: FrameDef, unitPx: { s: number; m: number }, w: number): Cell {
  const u = unitPx[d.unit];
  const pad = w + 2;
  if (d.name === EMPTY_FRAME) return { d, w: 4, h: 4, ox: 2, oy: 2 };
  if (d.box) {
    const b = d.box;
    return {
      d,
      w: Math.ceil((b.x1 - b.x0) * u + 2 * pad),
      h: Math.ceil((b.y1 - b.y0) * u + 2 * pad),
      ox: pad - b.x0 * u,
      oy: pad - b.y0 * u,
    };
  }
  const size = Math.ceil(2 * d.ext * u + 2 * w + 4);
  return { d, w: size, h: size, ox: size / 2, oy: size / 2 };
}

/** 모든 프레임을 한 캔버스에 그린다 (선반 채우기, 프레임 사이 2px 틈). 고른 스타일 하나만 굽는다 */
export function bakeAtlas(params: AtlasParams): AtlasBuild {
  const t0 = performance.now();
  const tpw = paramsTexels(params);
  const unitPx = { s: params.survivorR * TILE_PX * tpw, m: params.monsterR * TILE_PX * tpw };
  const w = ART.outlineWorldPx * tpw;
  const isNew = params.style === 'new';
  const cells = frameDefs(params).map((d) => cellOf(d, unitPx, w));
  cells.sort((a, b) => b.h - a.h || b.w - a.w);
  const width = unitPx.s > 14 ? 1024 : 512;
  const frames = new Map<string, AtlasFrame>();
  let x = 0;
  let y = 0;
  let rowH = 0;
  for (const c of cells) {
    if (x + c.w > width) {
      x = 0;
      y += rowH + 2;
      rowH = 0;
    }
    const f: AtlasFrame = { x, y, w: c.w, h: c.h };
    if (isNew) {
      f.pivotX = c.ox / c.w;
      f.pivotY = c.oy / c.h;
    }
    frames.set(c.d.name, f);
    x += c.w + 2;
    rowH = Math.max(rowH, c.h);
  }
  // 새 스타일: 쓰지 않는 옛 부품 이름은 빈 칸 하나를 같이 가리킨다
  const empty = frames.get(EMPTY_FRAME);
  if (isNew && empty) for (const name of EMPTY_ALIASES) frames.set(name, empty);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = Math.max(4, y + rowH);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('캐릭터 그림 캔버스를 만들 수 없습니다');
  for (const c of cells) {
    const f = frames.get(c.d.name);
    if (!f) continue;
    ctx.save();
    ctx.beginPath();
    ctx.rect(f.x, f.y, f.w, f.h);
    ctx.clip();
    ctx.translate(f.x + c.ox, f.y + c.oy);
    c.d.draw(ctx, unitPx[c.d.unit], w);
    ctx.restore();
  }
  // Path2D는 굽기 한 번 안에서만 다시 쓴다(경로 글자가 커서 들고 있지 않는다). 그림 명령은 다음 굽기를 위해 둔다
  if (isNew) clearPathCache();
  else drawMemo.clear();
  return { canvas, frames, params, ms: performance.now() - t0, texPerWorld: tpw };
}

// ───────────────────────── 텍스처 (게임 전체에 하나) ─────────────────────────

let current: { key: string; build: AtlasBuild } | null = null;
/** 장면 없이 미리 구운 결과 (판 장면이 올리기만 한다) */
let pending: AtlasBuild | null = null;
let keySeq = 0;

function sameParams(a: AtlasParams, b: AtlasParams): boolean {
  return (
    Math.abs(paramsTexels(a) - paramsTexels(b)) < 1e-6 &&
    a.survivorR === b.survivorR &&
    a.monsterR === b.monsterR &&
    (a.style ?? 'classic') === (b.style ?? 'classic')
  );
}

/** 텍스처 관리자 (Phaser TextureManager 중 쓰는 부분) */
type TextureHost = Phaser.Textures.TextureManager;

/**
 * 지금 zoom · 반지름에 맞는 그림 텍스처 (없거나 다르면 굽고 올린다). 키가 바뀌면 이전 텍스처는 지운다:
 * 부르는 쪽은 키가 바뀌었으면 이미지를 다시 만든다
 */
export function ensureAtlas(textures: TextureHost, params: AtlasParams): { key: string; build: AtlasBuild } {
  if (current && sameParams(current.build.params, params) && textures.exists(current.key)) return current;
  const build = pending && sameParams(pending.params, params) ? pending : bakeAtlas(params);
  pending = null;
  if (current) removeCanvasTexture(textures, current.key);
  keySeq += 1;
  const key = `decoy-chars-${keySeq}`;
  const tex = createCanvasTexture(textures, key, build.canvas);
  for (const [name, f] of build.frames) {
    const frame = tex.add(name, 0, f.x, f.y, f.w, f.h);
    if (frame && f.pivotX !== undefined && f.pivotY !== undefined) {
      frame.customPivot = true;
      frame.pivotX = f.pivotX;
      frame.pivotY = f.pivotY;
    }
  }
  // 회전 · 크기 변화가 있는 그림이라 선형 보간 (게임 설정이 pixelArt로 잡혀도 계단이 생기지 않게)
  tex.setFilter(Phaser.Textures.FilterMode.LINEAR);
  current = { key, build };
  gfxState.features.atlasBakeMs = Math.round(build.ms * 10) / 10;
  gfxState.features.atlasBytes = build.canvas.width * build.canvas.height * 4;
  // 지금 올린(그리는) 아틀라스의 캐릭터 스타일 · 배율, 새 스타일 그림 명령을 새로 만든 누적 횟수
  // (시험: 스타일을 바꾼 뒤 실제로 다시 구웠는지, 배율만 바뀐 다시 굽기가 그림 명령을 다시 만들지 않는지)
  gfxState.features.atlasStyle = build.params.style ?? 'classic';
  gfxState.features.atlasZoom = build.params.zoom;
  gfxState.features.atlasDrawingsMade = drawMemo.made;
  return current;
}

/**
 * 로비 대기 중에 미리 굽는다 (판 시작 때 끊기지 않게). scene이 있으면 텍스처까지 올린다.
 * 반지름은 balance(survivor.radius · monster.radius). 메인이 로비에서 부른다
 */
export function prebakeAtlas(scene: Phaser.Scene | null, survivorR: number, monsterR: number): number {
  const params = atlasParamsFor(survivorR, monsterR);
  if (scene) return ensureAtlas(scene.textures, params).build.ms;
  if (current && sameParams(current.build.params, params)) return 0;
  pending = bakeAtlas(params);
  gfxState.features.atlasBakeMs = Math.round(pending.ms * 10) / 10;
  return pending.ms;
}

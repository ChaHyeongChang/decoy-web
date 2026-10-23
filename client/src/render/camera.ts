// 따라가는 카메라 (순수, Phaser를 import하지 않는다). 단위는 타일.
// - 보이는 창 크기(viewW × viewH 타일)는 확대 수준만으로 정해진다(ui/layout.ts setCamZoom): 기기와 상관없이 같은 타일 수
// - 플레이어를 부드럽게 따라간다(시간 상수 τ의 지수 감쇠 — 프레임 수와 무관). 맵 밖은 보이지 않게 창을 맵 안으로 자른다
// - 괴물은 조준 방향으로 화면을 앞당긴다: 지금 시야 부채꼴 ∪ 근접 원의 외접 사각형이 창 안에 들어오게 가운데를 옮기되,
//   괴물 몸은 가장자리에서 lookMargin 안쪽에 남긴다. 앞당김은 따로 천천히(lookTauS) 따라가 조준을 빨리 돌려도 화면이
//   휘둘리지 않는다
// - 목표가 창 폭의 cutFraction보다 크게 튀면(수감 순간이동 · 먼 동료로 시점 돌리기 · 탈출 뒤 관전) 가로질러 미끄러지지 않고
//   잘라 옮긴다(dip: 짧게 어두워졌다 밝아짐 — GameScene이 그린다)
// - 화면 흔들림은 ScreenShake 한 곳에서만 만든다(세기 배율 하나로 '흔들림 줄이기'를 붙일 수 있게)
// 판정 · 정보와 무관한 그림 값이라 balance.json이 아니라 여기 둔다(VISUAL_SPEC 12장)
import { MAP_H, MAP_W, type Vec2 } from '@decoy/shared';

/** 확대 수준 후보 (맵 전체가 보이던 배율 대비). 보이는 범위 = 맵 가로 · 세로의 1/확대 */
export const CAM_LEVELS = { near: 4, mid: 3, wide: 2 } as const;
export type CamLevel = keyof typeof CAM_LEVELS;

export const CAMERA = {
  /** 내 캐릭터 따라가기 시간 상수 (초) */
  followTauS: 0.12,
  /** 괴물 앞당김 시간 상수 (초) */
  lookTauS: 0.32,
  /** 관전 시점 따라가기 시간 상수 (초, 가까운 동료로 옮길 때 미끄러지는 빠르기) */
  spectateTauS: 0.2,
  /** 내 캐릭터가 화면 가장자리에서 떨어지는 최소 거리 (타일, 따라가기가 늦어도) */
  edgeMargin: 1.4,
  /** 괴물 앞당김: 괴물 몸이 가장자리에서 떨어지는 최소 거리 (타일) */
  lookMargin: 1.6,
  /** 목표가 창 폭의 이 비율보다 크게 튀면 잘라 옮긴다 */
  cutFraction: 0.6,
  /** 잘라 옮길 때 어두워지는 · 밝아지는 시간 (ms), 가장 어두울 때 알파 */
  dipOutMs: 90,
  dipInMs: 220,
  dipAlpha: 0.55,
} as const;

export interface ViewRect {
  /** 왼쪽 위 (타일) */
  x: number;
  y: number;
  w: number;
  h: number;
}

const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));

/** 확대 수준의 보이는 범위 (타일) */
export function viewTiles(zoom: number): { w: number; h: number } {
  const z = Number.isFinite(zoom) && zoom >= 1 ? zoom : 1;
  return { w: MAP_W / z, h: MAP_H / z };
}

/** 가운데를 맵 안으로 자른다 (창이 맵보다 크면 맵 가운데) */
export function clampCenter(c: Vec2, w: number, h: number): Vec2 {
  const hx = w / 2;
  const hy = h / 2;
  return {
    x: w >= MAP_W ? MAP_W / 2 : clamp(c.x, hx, MAP_W - hx),
    y: h >= MAP_H ? MAP_H / 2 : clamp(c.y, hy, MAP_H - hy),
  };
}

/** 각도를 [-π, π)로 */
function wrap(a: number): number {
  const t = (a + Math.PI) % (Math.PI * 2);
  return (t < 0 ? t + Math.PI * 2 : t) - Math.PI;
}

/**
 * 시야 부채꼴(꼭짓점 = 괴물, 조준 aim, 전체 각 arc 라디안, 길이 range) ∪ 근접 원(반지름 near)의 외접 사각형 (괴물 기준 타일).
 * 벽은 보지 않는다(벽에 잘린 부채꼴보다 크거나 같다)
 */
export interface Box4 {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function coneBox(
  aim: number,
  arc: number,
  range: number,
  near: number,
  out: Box4 = { x0: 0, y0: 0, x1: 0, y1: 0 },
): Box4 {
  out.x0 = -near;
  out.y0 = -near;
  out.x1 = near;
  out.y1 = near;
  const half = arc / 2;
  boxAdd(out, aim - half, range);
  boxAdd(out, aim + half, range);
  // 호 안에 든 축 방향 (0 · 90 · 180 · 270°)
  for (let k = 0; k < 4; k += 1) {
    const a = (k * Math.PI) / 2;
    if (Math.abs(wrap(a - aim)) <= half) boxAdd(out, a, range);
  }
  return out;
}

function boxAdd(b: Box4, a: number, range: number): void {
  const x = Math.cos(a) * range;
  const y = Math.sin(a) * range;
  b.x0 = Math.min(b.x0, x);
  b.y0 = Math.min(b.y0, y);
  b.x1 = Math.max(b.x1, x);
  b.y1 = Math.max(b.y1, y);
}

/**
 * 앞당김 (괴물 기준 가운데 이동량, 타일): 외접 사각형 가운데로 옮기되, 괴물 몸이 창 가장자리에서 margin 안쪽에 남게 자른다.
 * 사각형이 창보다 크면 괴물 쪽을 남기고 먼 쪽이 잘린다
 */
export function lookAhead(
  box: { x0: number; y0: number; x1: number; y1: number },
  w: number,
  h: number,
  margin: number,
): Vec2 {
  const mx = Math.max(0, w / 2 - margin);
  const my = Math.max(0, h / 2 - margin);
  return { x: clamp((box.x0 + box.x1) / 2, -mx, mx), y: clamp((box.y0 + box.y1) / 2, -my, my) };
}

/**
 * 조준 방향으로만 앞당긴다 (괴물 화면, 실제로 쓰는 것): 앞당김 = α × 조준 단위 벡터. α는 시야 외접 사각형 가운데를 조준 방향에
 * 투영한 길이이고(0 이상), 괴물 몸이 창 가장자리에서 margin 안쪽에 남도록 자른다. 앞당김이 늘 조준과 평행이라, 카메라가 앞당기며
 * 움직여도 괴물은 화면에서 조준선을 따라서만 미끄러진다 → 화면의 커서가 조준선 위에 그대로 남고 조준이 흔들리지 않는다
 * (사각형 가운데로 옮기는 lookAhead는 조준과 비스듬해 커서 기준 조준을 끌고 다닌다). out에 써서 돌려준다
 */
export function lookAlong(
  aim: number,
  box: { x0: number; y0: number; x1: number; y1: number },
  w: number,
  h: number,
  margin: number,
  out: Vec2,
): Vec2 {
  const ux = Math.cos(aim);
  const uy = Math.sin(aim);
  const proj = ((box.x0 + box.x1) / 2) * ux + ((box.y0 + box.y1) / 2) * uy;
  const mx = Math.max(0, w / 2 - margin);
  const my = Math.max(0, h / 2 - margin);
  let max = Infinity;
  if (Math.abs(ux) > 1e-9) max = Math.min(max, mx / Math.abs(ux));
  if (Math.abs(uy) > 1e-9) max = Math.min(max, my / Math.abs(uy));
  const a = Math.max(0, Math.min(proj, max));
  out.x = a * ux;
  out.y = a * uy;
  return out;
}

/** 지수 감쇠 한 걸음 비율 (dt ms, τ 초): 프레임 수와 무관 */
export function follow(dtMs: number, tauS: number): number {
  if (!(dtMs > 0)) return 0;
  if (!(tauS > 0)) return 1;
  return 1 - Math.exp(-dtMs / 1000 / tauS);
}

export interface CameraTarget {
  /** 따라갈 자리 (타일) */
  x: number;
  y: number;
  /** 앞당김 목표 (괴물, 타일). 없으면 0 */
  look: Vec2 | null;
  /** 따라가기 시간 상수 (초) */
  tauS: number;
  /** 이 자리는 화면 가장자리에서 edgeMargin 안쪽에 둔다 (내 캐릭터 · 관전 대상) */
  keepInside: boolean;
}

export interface CameraFrame {
  /** 보이는 창 (타일, 맵 안) */
  view: ViewRect;
  /** 이번 프레임에 잘라 옮겼다 (화면이 짧게 어두워진다) */
  cut: boolean;
}

/**
 * 카메라 상태. 따라가는 자리(pos)와 앞당김(look)을 따로 감쇠한다. 가운데 = pos + look, 그다음 대상을 가장자리 안쪽에 두고
 * 맵 안으로 자른다. 맵 가장자리에서는 대상이 가운데가 아니다
 */
export class CameraRig {
  /** 따라가는 자리 · 앞당김 (감쇠한 값). hasPos가 거짓이면 다음 프레임에 목표로 바로 옮긴다 */
  private readonly pos: Vec2 = { x: 0, y: 0 };
  private hasPos = false;
  private readonly look: Vec2 = { x: 0, y: 0 };
  /** 마지막 가운데 (타일) */
  readonly center: Vec2 = { x: MAP_W / 2, y: MAP_H / 2 };
  /** 돌려주는 프레임 (그릇 하나를 다시 쓴다) */
  private readonly frame: CameraFrame = { view: { x: 0, y: 0, w: 0, h: 0 }, cut: false };

  constructor(
    public w: number,
    public h: number,
  ) {}

  /** 다음 프레임에 목표 자리로 바로 옮긴다 (판 시작) */
  reset(): void {
    this.hasPos = false;
  }

  /**
   * 잘라 옮길 만큼 튀었는가: 창 폭의 cutFraction보다 멀거나, 가장자리 안쪽에 둘 대상이 한 번에 가장자리 띠(축마다 창 절반 −
   * edgeMargin) 밖으로 나갔다. 띠 밖으로 튄 것을 미끄러지게 두면 keepInside가 그 프레임에 가운데를 순간이동시킨 뒤 따라가기가
   * 따라올 때까지 멈칫한다. 연속 이동의 따라가기 늦음(빠르기 × τ, 괴물 돌진 16 × 0.12 ≈ 1.9타일)은 가장 좁은 띠(확대 4 세로 2.6)보다
   * 작아 걸리지 않는다. 앞당김(look)이 아니라 따라가는 자리(pos)로 잰다
   */
  private shouldCut(t: CameraTarget): boolean {
    if (!this.hasPos) return false;
    const dx = Math.abs(t.x - this.pos.x);
    const dy = Math.abs(t.y - this.pos.y);
    if (Math.hypot(dx, dy) > this.w * CAMERA.cutFraction) return true;
    if (!t.keepInside) return false;
    return (
      dx > Math.max(0, this.w / 2 - CAMERA.edgeMargin) || dy > Math.max(0, this.h / 2 - CAMERA.edgeMargin)
    );
  }

  update(dtMs: number, t: CameraTarget): CameraFrame {
    const lx = t.look ? t.look.x : 0;
    const ly = t.look ? t.look.y : 0;
    let cut = false;
    const jump = !this.hasPos || this.shouldCut(t);
    if (jump) {
      cut = this.hasPos;
      this.hasPos = true;
      this.pos.x = t.x;
      this.pos.y = t.y;
      this.look.x = lx;
      this.look.y = ly;
    } else {
      const a = follow(dtMs, t.tauS);
      this.pos.x += (t.x - this.pos.x) * a;
      this.pos.y += (t.y - this.pos.y) * a;
      const b = follow(dtMs, CAMERA.lookTauS);
      this.look.x += (lx - this.look.x) * b;
      this.look.y += (ly - this.look.y) * b;
    }
    let cx = this.pos.x + this.look.x;
    let cy = this.pos.y + this.look.y;
    if (t.keepInside) {
      const mx = Math.max(0, this.w / 2 - CAMERA.edgeMargin);
      const my = Math.max(0, this.h / 2 - CAMERA.edgeMargin);
      cx = clamp(cx, t.x - mx, t.x + mx);
      cy = clamp(cy, t.y - my, t.y + my);
    }
    // 맵 안으로 (clampCenter와 같은 식, 객체를 만들지 않는다)
    const hx = this.w / 2;
    const hy = this.h / 2;
    this.center.x = this.w >= MAP_W ? MAP_W / 2 : clamp(cx, hx, MAP_W - hx);
    this.center.y = this.h >= MAP_H ? MAP_H / 2 : clamp(cy, hy, MAP_H - hy);
    const f = this.frame;
    f.view.x = this.center.x - hx;
    f.view.y = this.center.y - hy;
    f.view.w = this.w;
    f.view.h = this.h;
    f.cut = cut;
    return f;
  }
}

/**
 * 창 왼쪽 위(타일)를 기기 픽셀 격자에 맞춘다: 월드가 화면에서 기기 픽셀 정수만큼만 움직이면 1텍셀 = 1기기 px로 구운
 * 그림(맵 조각 · 배지)이 흐려지지 않는다. k = 기기 px / 타일
 */
export function snapView(x: number, k: number): number {
  return k > 0 ? Math.round(x * k) / k : x;
}

/** 잘라 옮김 어두워짐 알파 (dip 시작 시각부터 경과 ms) */
export function dipAlpha(elapsedMs: number): number {
  if (!(elapsedMs >= 0)) return 0;
  const { dipOutMs, dipInMs, dipAlpha: a } = CAMERA;
  if (elapsedMs < dipOutMs) return (a * elapsedMs) / dipOutMs;
  const t = elapsedMs - dipOutMs;
  return t < dipInMs ? a * (1 - t / dipInMs) : 0;
}

// ───────────────────────── 화면 흔들림 (한 곳에서) ─────────────────────────

/** 흔들림 종류: 세기(타일) · 길이(ms). 판정과 무관한 장식이다 */
export const SHAKE = {
  /** 생존자: 내가 맞음 */
  hitMe: { amp: 0.1, ms: 220 },
  /** 괴물: 내 공격이 맞음 */
  strike: { amp: 0.05, ms: 140 },
  /** 괴물: 내가 기절 */
  stunMe: { amp: 0.09, ms: 260 },
  /** 괴물: 내 포효 */
  roar: { amp: 0.06, ms: 320 },
} as const;
export type ShakeKind = keyof typeof SHAKE;

/** 동시에 남기는 흔들림 수 (오래된 것부터 버린다) */
const SHAKE_MAX = 4;

/**
 * 화면 흔들림. 모든 흔들림은 여기서만 생기고, offset의 세기는 scale(0 = 끔, 1 = 보통 — '흔들림 줄이기' 설정 · 동작 줄이기가
 * 넣는다)을 곱한다. 흔들림은 시각만의 함수(결정적, 난수 없음)이고 월드에만 걸린다(HUD는 흔들지 않는다)
 */
export class ScreenShake {
  private readonly items: { kind: ShakeKind; t0: number }[] = [];
  scale = 1;

  add(kind: ShakeKind, nowMs: number): void {
    this.items.push({ kind, t0: nowMs });
    while (this.items.length > SHAKE_MAX) this.items.shift();
  }

  clear(): void {
    this.items.length = 0;
  }

  /** 지금 흔들림 (타일). 끝난 흔들림은 지운다 */
  offset(nowMs: number, out: Vec2): Vec2 {
    out.x = 0;
    out.y = 0;
    if (this.scale <= 0) {
      this.items.length = 0;
      return out;
    }
    for (let i = this.items.length - 1; i >= 0; i -= 1) {
      const it = this.items[i];
      if (!it) continue;
      const s = SHAKE[it.kind];
      const e = nowMs - it.t0;
      if (e >= s.ms || e < 0) {
        if (e >= s.ms) this.items.splice(i, 1);
        continue;
      }
      // 빠르게 줄어드는 세기 × 서로 다른 두 진동 (결정적)
      const env = (1 - e / s.ms) ** 2;
      const a = s.amp * env * this.scale;
      out.x += a * Math.sin(e * 0.071 + 1.3) * Math.cos(e * 0.023);
      out.y += a * Math.cos(e * 0.067 + 0.4) * Math.sin(e * 0.031 + 2.1);
    }
    return out;
  }

  get active(): number {
    return this.items.length;
  }
}

/**
 * 창 밖 컬링 (따라가는 카메라, 성능): 이 사각형(논리 px)의 그림이 화면에 한 화소도 안 보이는가. 보이는 곳 = 맵 창(map ± pad)과,
 * 캔버스가 논리 크기(viewW × viewH)보다 반올림으로 조금 클 때 창 밖 가리개(가장자리 0.5px 겹침)가 덮지 못하는 오른쪽 · 아래 띠
 * (viewW + 0.5 ~ canvasW, viewH + 0.5 ~ canvasH). 둘 다와 겹치지 않으면 참 — 가리개는 불투명이라 그 밑 그림은 화소를 바꾸지 않는다.
 * pad는 안티에일리어싱 여유(기기 1px 이상)
 */
export function cullable(
  b: { x: number; y: number; width: number; height: number },
  map: { x: number; y: number; w: number; h: number },
  pad: number,
  view: { viewW: number; viewH: number; canvasW: number; canvasH: number },
): boolean {
  if (![b.x, b.y, b.width, b.height].every(Number.isFinite)) return false;
  const x1 = b.x + b.width;
  const y1 = b.y + b.height;
  const hits = (ax: number, ay: number, bx: number, by: number): boolean =>
    x1 > ax && b.x < bx && y1 > ay && b.y < by;
  if (hits(map.x - pad, map.y - pad, map.x + map.w + pad, map.y + map.h + pad)) return false;
  if (view.canvasW > view.viewW + 0.5 && hits(view.viewW + 0.5, -Infinity, view.canvasW, Infinity))
    return false;
  if (view.canvasH > view.viewH + 0.5 && hits(-Infinity, view.viewH + 0.5, Infinity, view.canvasH))
    return false;
  return true;
}

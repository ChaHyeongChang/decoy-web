// 안개 아래 그리는 공개 동적 레이어(거점 · 탈출구 영역 · 진행 링 · 시야 원 채움)와 빛 지도.
// 같은 그림을 Canvas2D(한 장 합성 · 미니맵)와 Phaser Graphics(GPU 합성)로 똑같이 그리려고 펜을 둘 둔다.
import type Phaser from 'phaser';
import {
  CAPTURE_POINTS,
  EXITS,
  MAP_H,
  MAP_W,
  type Balance,
  type ExitView,
  type PointView,
  type Vec2,
} from '@decoy/shared';
import { gfxState } from '../gfx/state';
import { COLOR } from './colors';
import { softLightGeometry } from './fogMath';

/** 좌표는 타일, 선 두께는 논리 px(맵 0.93배를 적용한 화면 px) */
export interface FogPen {
  fillCircle(x: number, y: number, r: number, color: number, alpha: number): void;
  strokeCircle(x: number, y: number, r: number, width: number, color: number, alpha: number): void;
  /** 원호 선. inset은 반지름에서 안쪽으로 뺄 논리 px */
  strokeArc(
    x: number,
    y: number,
    r: number,
    inset: number,
    from: number,
    to: number,
    width: number,
    color: number,
    alpha: number,
  ): void;
  fillPoly(poly: readonly Vec2[], color: number, alpha: number): void;
}

let keySeq = 0;

/** 다시 만들 때 겹치지 않는 텍스처 키 (같은 키를 다시 쓰면 Phaser가 콘솔 에러를 낸다) */
export function nextFogKey(prefix: string): string {
  keySeq += 1;
  return `${prefix}-${keySeq}`;
}

export function rgba(color: number, alpha: number): string {
  return `rgba(${(color >> 16) & 255}, ${(color >> 8) & 255}, ${color & 255}, ${alpha})`;
}

/** 경로를 만드는 2D 컨텍스트 부분 */
export type PathCtx = Pick<CanvasRenderingContext2D, 'beginPath' | 'moveTo' | 'lineTo' | 'closePath'>;

export function polyPath(c: PathCtx, poly: readonly Vec2[], k: number): void {
  c.beginPath();
  const first = poly[0];
  if (!first) return;
  c.moveTo(first.x * k, first.y * k);
  for (let i = 1; i < poly.length; i += 1) {
    const p = poly[i];
    if (p) c.lineTo(p.x * k, p.y * k);
  }
  c.closePath();
}

/** Canvas2D 펜. k = px / 타일, px = 캔버스 px / 논리 px */
export class CanvasPen implements FogPen {
  constructor(
    private readonly c: CanvasRenderingContext2D,
    private readonly k: number,
    private readonly px: number,
  ) {}

  fillCircle(x: number, y: number, r: number, color: number, alpha: number): void {
    const c = this.c;
    c.beginPath();
    c.arc(x * this.k, y * this.k, r * this.k, 0, Math.PI * 2);
    c.fillStyle = rgba(color, alpha);
    c.fill();
  }

  strokeCircle(x: number, y: number, r: number, width: number, color: number, alpha: number): void {
    const c = this.c;
    c.beginPath();
    c.arc(x * this.k, y * this.k, r * this.k, 0, Math.PI * 2);
    c.lineWidth = width * this.px;
    c.strokeStyle = rgba(color, alpha);
    c.stroke();
  }

  strokeArc(
    x: number,
    y: number,
    r: number,
    inset: number,
    from: number,
    to: number,
    width: number,
    color: number,
    alpha: number,
  ): void {
    const c = this.c;
    c.beginPath();
    c.arc(x * this.k, y * this.k, Math.max(0, r * this.k - inset * this.px), from, to);
    c.lineWidth = width * this.px;
    c.strokeStyle = rgba(color, alpha);
    c.stroke();
  }

  fillPoly(poly: readonly Vec2[], color: number, alpha: number): void {
    if (poly.length < 3) return;
    polyPath(this.c, poly, this.k);
    this.c.fillStyle = rgba(color, alpha);
    this.c.fill();
  }
}

/** Phaser Graphics 펜 (GPU 합성의 공개 동적 레이어). k = 논리 px / 타일 */
export class GraphicsPen implements FogPen {
  constructor(
    private readonly g: Phaser.GameObjects.Graphics,
    private readonly k: number,
  ) {}

  fillCircle(x: number, y: number, r: number, color: number, alpha: number): void {
    this.g.fillStyle(color, alpha);
    this.g.fillCircle(x * this.k, y * this.k, r * this.k);
  }

  strokeCircle(x: number, y: number, r: number, width: number, color: number, alpha: number): void {
    this.g.lineStyle(width, color, alpha);
    this.g.strokeCircle(x * this.k, y * this.k, r * this.k);
  }

  strokeArc(
    x: number,
    y: number,
    r: number,
    inset: number,
    from: number,
    to: number,
    width: number,
    color: number,
    alpha: number,
  ): void {
    const g = this.g;
    g.lineStyle(width, color, alpha);
    g.beginPath();
    g.arc(x * this.k, y * this.k, Math.max(0, r * this.k - inset), from, to, false);
    g.strokePath();
  }

  fillPoly(poly: readonly Vec2[], color: number, alpha: number): void {
    if (poly.length < 3) return;
    const g = this.g;
    const first = poly[0];
    if (!first) return;
    g.fillStyle(color, alpha);
    g.beginPath();
    g.moveTo(first.x * this.k, first.y * this.k);
    for (let i = 1; i < poly.length; i += 1) {
      const p = poly[i];
      if (p) g.lineTo(p.x * this.k, p.y * this.k);
    }
    g.closePath();
    g.fillPath();
  }
}

const TOP = -Math.PI / 2;

/** 거점 영역 + 점령 진행 링 (공개 정보: 양쪽 화면) */
export function paintPoints(pen: FogPen, points: readonly PointView[], balance: Balance): void {
  const r = balance.capturePoint.radius;
  for (const p of points) {
    const pos = CAPTURE_POINTS[p.id];
    pen.fillCircle(pos.x, pos.y, r, COLOR.pointRing, p.state === 'done' ? 0.12 : 0.05);
    pen.strokeCircle(pos.x, pos.y, r, 2, COLOR.pointLine, 0.55);
    if (p.progress > 0)
      pen.strokeArc(
        pos.x,
        pos.y,
        r,
        4,
        TOP,
        TOP + Math.PI * 2 * Math.min(1, p.progress),
        5,
        COLOR.pointRing,
        0.95,
      );
  }
}

/** 탈출구 영역 (+ 생존자에게는 개방 진행 링. 괴물 화면은 progress가 null이라 그리지 않는다) */
export function paintExits(pen: FogPen, exits: readonly ExitView[], balance: Balance): void {
  const r = balance.exit.radius;
  for (const e of exits) {
    const def = EXITS[e.id];
    const color = e.state === 'inactive' ? COLOR.exitInactive : COLOR.exitActive;
    pen.fillCircle(def.center.x, def.center.y, r, color, e.state === 'inactive' ? 0.06 : 0.14);
    pen.strokeCircle(def.center.x, def.center.y, r, 2, color, 0.5);
    if (e.progress !== null && e.progress > 0)
      pen.strokeArc(
        def.center.x,
        def.center.y,
        r,
        3,
        TOP,
        TOP + Math.PI * 2 * e.progress,
        4,
        COLOR.exitActive,
        1,
      );
  }
}

export interface SoftLight {
  poly: readonly Vec2[];
  center: Vec2;
  radius: number;
  soft: number;
}

/** 빛 지도를 칠하는 2D 컨텍스트 중 쓰는 부분 (단위 테스트는 기록용 가짜 컨텍스트를 넣는다) */
export type LightCtx = PathCtx &
  Pick<
    CanvasRenderingContext2D,
    | 'globalCompositeOperation'
    | 'fillStyle'
    | 'fillRect'
    | 'createRadialGradient'
    | 'save'
    | 'restore'
    | 'fill'
  >;

/** 빛 지도 캔버스와 그 2D 컨텍스트 */
export interface LightSurface<C> {
  readonly canvas: C;
  readonly ctx: LightCtx;
}

/** 폭 · 높이(px)를 받아 빛 지도 표면을 만든다 */
export type LightSurfaceFactory<C> = (width: number, height: number) => LightSurface<C>;

/** 브라우저: DOM 캔버스 */
export function domLightSurface(width: number, height: number): LightSurface<HTMLCanvasElement> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('빛 지도 캔버스를 만들 수 없습니다');
  return { canvas, ctx };
}

/**
 * 빛 지도: 바탕 = 하한 × 틴트, 시야 다각형을 'lighten'(채널별 최댓값)으로 그린다. 바닥에 곱하면
 * 시야 밖은 어두운 구조, 시야 안은 원래 색이 된다. 여러 시야가 겹쳐도 더 밝아지지 않는다.
 * 칠하는 경로는 판정 다각형 × k 그대로다(밝게 그린 곳 ⊆ 판정 영역). 표면은 주입받는다(DOM 캔버스 / 테스트용 기록기).
 */
export class LightMap<C extends { readonly width: number; readonly height: number } = HTMLCanvasElement> {
  readonly canvas: C;
  private readonly ctx: LightCtx;

  constructor(
    /** 타일당 px */
    readonly k: number,
    private readonly ambientCss: string,
    surface: LightSurfaceFactory<C>,
  ) {
    const s = surface(Math.max(1, Math.round(MAP_W * k)), Math.max(1, Math.round(MAP_H * k)));
    this.canvas = s.canvas;
    this.ctx = s.ctx;
    this.clear();
  }

  clear(): void {
    const l = this.ctx;
    l.globalCompositeOperation = 'source-over';
    l.fillStyle = this.ambientCss;
    l.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  /** 경계가 부드러운 원형 시야: 판정 반경 안쪽 soft 타일에서 흰색 → 하한 (반경 밖은 하한 그대로) */
  addSoft(light: SoftLight): void {
    if (light.poly.length < 3) return;
    const l = this.ctx;
    const k = this.k;
    const geo = softLightGeometry(light.radius, light.soft);
    let fill: CanvasGradient | string = '#ffffff';
    // 흐림 띠가 없으면(soft ≤ 0) 딱 자른다. 같은 원 두 개로 만든 그라디언트는 캔버스 규칙상 아무것도 칠하지 않는다
    if (geo.outer > geo.inner) {
      const cx = light.center.x * k;
      const cy = light.center.y * k;
      const grad = l.createRadialGradient(cx, cy, geo.inner * k, cx, cy, geo.outer * k);
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(1, this.ambientCss);
      fill = grad;
    }
    l.save();
    l.globalCompositeOperation = 'lighten';
    polyPath(l, light.poly, k);
    l.fillStyle = fill;
    l.fill();
    l.restore();
  }

  /** 경계가 딱 잘린 시야 (괴물 부채꼴 · 근접 원) */
  addHard(poly: readonly Vec2[]): void {
    if (poly.length < 3) return;
    const l = this.ctx;
    l.save();
    l.globalCompositeOperation = 'lighten';
    polyPath(l, poly, this.k);
    l.fillStyle = '#ffffff';
    l.fill();
    l.restore();
  }
}

// ───────────── 캔버스 텍스처 (getImageData 사본 없이) ─────────────
// Phaser addCanvas는 CanvasTexture를 만들고, 그 생성자가 getImageData로 캔버스 전체를 읽어 텍스처가 사는 동안 들고 있다
// (4K 높음 정적 맵 2856×1904이면 21.7MB, 가속 캔버스면 동기 GPU → CPU 읽기). 이 코드는 그 사본을 쓰지 않으므로 일반
// Texture로 만들고 기본 프레임만 붙인다. 갱신은 source[0].update(): WebGL은 캔버스를 다시 올리고, Canvas 렌더러는
// 아무 일도 하지 않고 캔버스를 바로 그린다(CanvasTexture.refresh와 같은 동작).

/** 텍스처 관리자 중 여기서 쓰는 부분 (Phaser TextureManager, 단위 테스트는 가짜) */
export interface CanvasTextureHost<C, T> {
  exists(key: string): boolean;
  create(key: string, source: C, width: number, height: number): T | null;
  remove(key: string): unknown;
}

/** 텍스처 중 여기서 쓰는 부분 (Phaser Texture) */
export interface CanvasTextureLike {
  add(name: string, sourceIndex: number, x: number, y: number, width: number, height: number): unknown;
  get(name?: string): { setSize(width: number, height: number, x?: number, y?: number): unknown };
  readonly source: readonly { width: number; height: number; isPowerOf2: boolean; update(): void }[];
}

/** 안개 · 미니맵 텍스처의 source 바이트 (키 → 폭 × 높이 × 4). 합계를 gfxState.features.textureBytes에 기록한다 */
const textureBytes = new Map<string, number>();

function recordTextureBytes(): void {
  let sum = 0;
  for (const v of textureBytes.values()) sum += v;
  gfxState.features.textureBytes = sum;
}

function trackTexture(key: string, width: number, height: number): void {
  textureBytes.set(key, width * height * 4);
  recordTextureBytes();
}

/** 캔버스를 사본 없이 텍스처로 올린다 (같은 키가 있으면 먼저 지운다) */
export function createCanvasTexture<C extends { width: number; height: number }, T extends CanvasTextureLike>(
  host: CanvasTextureHost<NoInfer<C>, T>,
  key: string,
  canvas: C,
): T {
  if (host.exists(key)) removeCanvasTexture(host, key);
  const tex = host.create(key, canvas, canvas.width, canvas.height);
  if (!tex) throw new Error(`텍스처를 만들 수 없습니다: ${key}`);
  // 기본 프레임. 빠뜨리면 이미지가 'has no frame' 경고를 내고 깨진다 (addCanvas는 CanvasTexture 생성자가 붙인다)
  tex.add('__BASE', 0, 0, 0, canvas.width, canvas.height);
  trackTexture(key, canvas.width, canvas.height);
  return tex;
}

/** 캔버스를 다시 그린 뒤 텍스처에 반영한다 */
export function uploadCanvasTexture(tex: CanvasTextureLike): void {
  tex.source[0]?.update();
}

/** 캔버스 크기를 바꾸고 텍스처 · 기본 프레임을 맞춘다 (CanvasTexture.setSize와 같은 순서. 캔버스 내용은 지워진다) */
export function resizeCanvasTexture<C extends { width: number; height: number }>(
  key: string,
  tex: CanvasTextureLike,
  canvas: C,
  width: number,
  height: number,
): void {
  canvas.width = width;
  canvas.height = height;
  const src = tex.source[0];
  if (src) {
    src.width = width;
    src.height = height;
    src.isPowerOf2 = isPow2(width) && isPow2(height);
  }
  tex.get('__BASE').setSize(width, height, 0, 0);
  uploadCanvasTexture(tex);
  trackTexture(key, width, height);
}

export function removeCanvasTexture<C, T>(host: CanvasTextureHost<C, T>, key: string): void {
  if (host.exists(key)) host.remove(key);
  textureBytes.delete(key);
  recordTextureBytes();
}

function isPow2(n: number): boolean {
  return n > 0 && (n & (n - 1)) === 0;
}

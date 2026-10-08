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
import { COLOR } from './colors';

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

export function polyPath(c: CanvasRenderingContext2D, poly: readonly Vec2[], k: number): void {
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

/**
 * 빛 지도: 바탕 = 하한 × 틴트, 시야 다각형을 'lighten'(채널별 최댓값)으로 그린다. 바닥에 곱하면
 * 시야 밖은 어두운 구조, 시야 안은 원래 색이 된다. 여러 시야가 겹쳐도 더 밝아지지 않는다.
 */
export class LightMap {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;

  constructor(
    /** 타일당 px */
    readonly k: number,
    private readonly ambientCss: string,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.max(1, Math.round(MAP_W * k));
    this.canvas.height = Math.max(1, Math.round(MAP_H * k));
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('빛 지도 캔버스를 만들 수 없습니다');
    this.ctx = ctx;
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
    const inner = Math.max(0, light.radius - light.soft) * k;
    const outer = light.radius * k;
    const grad = l.createRadialGradient(
      light.center.x * k,
      light.center.y * k,
      inner,
      light.center.x * k,
      light.center.y * k,
      outer,
    );
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(1, this.ambientCss);
    l.save();
    l.globalCompositeOperation = 'lighten';
    polyPath(l, light.poly, k);
    l.fillStyle = grad;
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

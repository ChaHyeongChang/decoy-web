// 안개 아래 그리는 공개 동적 레이어(거점 패드 · 눈금 · 스캔, 탈출구 상태 · 개방 게이지 · 미닫이, 시야 원 채움)와 빛 지도.
// 같은 그림을 Canvas2D(한 장 합성 · 미니맵)와 Phaser Graphics(GPU 합성)로 똑같이 그리려고 펜을 둘 둔다.
// 거점 · 탈출구의 판정 반경(원 · 눈금 위치)은 balance 값 그대로 그린다(범위 표시 = 실제 판정값). 장식 시간(스캔 회전 ·
// 맥동 · 미닫이)은 그래픽 상수이고 시계는 gfxNow(디버그 훅으로 멈춤)다.
import type Phaser from 'phaser';
import {
  CAPTURE_POINTS,
  EXITS,
  MAP_H,
  MAP_W,
  type Balance,
  type ExitId,
  type ExitState,
  type ExitView,
  type PointView,
  type Vec2,
} from '@decoy/shared';
import {
  MAP_COLOR,
  OBJ,
  OBJ_COLOR,
  doorLamps,
  exitChevrons,
  rimLiftPolys,
  rimLiftRects,
} from '../art/mapArtGeom';
import { gfxNow, gfxState } from '../gfx/state';
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
  /** 선분 (두께는 논리 px) */
  line(x0: number, y0: number, x1: number, y1: number, width: number, color: number, alpha: number): void;
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
    c.lineCap = 'butt';
    c.strokeStyle = rgba(color, alpha);
    c.stroke();
  }

  fillPoly(poly: readonly Vec2[], color: number, alpha: number): void {
    if (poly.length < 3) return;
    polyPath(this.c, poly, this.k);
    this.c.fillStyle = rgba(color, alpha);
    this.c.fill();
  }

  line(x0: number, y0: number, x1: number, y1: number, width: number, color: number, alpha: number): void {
    const c = this.c;
    c.beginPath();
    c.moveTo(x0 * this.k, y0 * this.k);
    c.lineTo(x1 * this.k, y1 * this.k);
    c.lineWidth = width * this.px;
    c.lineCap = 'butt';
    c.strokeStyle = rgba(color, alpha);
    c.stroke();
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

  line(x0: number, y0: number, x1: number, y1: number, width: number, color: number, alpha: number): void {
    this.g.lineStyle(width, color, alpha);
    this.g.lineBetween(x0 * this.k, y0 * this.k, x1 * this.k, y1 * this.k);
  }
}

const TOP = -Math.PI / 2;
const TAU = Math.PI * 2;

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/**
 * 마지막으로 바닥에 그린 판정 반경 (타일). 배지 정보(objects.ts Badges.info)가 '실제로 그린 반경'을 그대로 쓴다.
 * 그리기 전이면 null
 */
export const paintedRadii: { point: number | null; exit: number | null } = { point: null, exit: null };

/** 원호 위 두 각 사이를 두 반지름으로 자른 사각형 띠 (눈금 · 스캔 조각) */
function arcQuad(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number): Vec2[] {
  return [
    { x: cx + Math.cos(a0) * r0, y: cy + Math.sin(a0) * r0 },
    { x: cx + Math.cos(a0) * r1, y: cy + Math.sin(a0) * r1 },
    { x: cx + Math.cos(a1) * r1, y: cy + Math.sin(a1) * r1 },
    { x: cx + Math.cos(a1) * r0, y: cy + Math.sin(a1) * r0 },
  ];
}

/** 진행에 맞춰 켜진 눈금 수 (소수 = 지금 차오르는 눈금의 밝기). 완료면 전부 */
export function litTicks(progress: number, done: boolean, ticks = OBJ.ticks): number {
  return done ? ticks : clamp01(progress) * ticks;
}

/**
 * 거점 (공개 정보: 양쪽 화면). 판정 반경 원형 패드 + 바깥 24칸 눈금 링.
 * 진행 = 눈금이 위에서부터 시계 방향으로 청록 점등, 점령 중 = 회전 스캔선, 정지 = 주황 눈금(배지에 일시정지 아이콘),
 * 완료 = 전체 점등 + 패드 밝아짐(배지에 체크). 상태마다 색 말고 모양도 다르다 (스캔 · 아이콘)
 */
export function paintPoints(
  pen: FogPen,
  points: readonly PointView[],
  balance: Balance,
  now = gfxNow(),
): void {
  const r = balance.capturePoint.radius;
  paintedRadii.point = r;
  const C = OBJ_COLOR;
  for (const p of points) {
    const { x: cx, y: cy } = CAPTURE_POINTS[p.id];
    const st = p.state;
    const done = st === 'done';
    const accent = st === 'blocked' ? C.warn : C.neon;
    // 패드: 반투명 판 (아래 정적 무늬가 비친다) + 안쪽 고리
    pen.fillCircle(cx, cy, r, C.pad, done ? 0.2 : 0.11);
    // 가운데로 갈수록 조금 밝은 판 (방사 그라디언트 대신 동심원 두 겹: 두 펜이 같은 그림)
    pen.fillCircle(cx, cy, r * 0.74, C.pad, 0.06);
    pen.fillCircle(cx, cy, r * 0.46, C.pad, 0.06);
    pen.strokeCircle(cx, cy, r - OBJ.tickIn - 0.12, 1, C.neonDim, 0.55);
    // 판정 경계 (바깥 원): 번짐 + 선
    pen.strokeCircle(cx, cy, r, 6, C.neon, 0.07);
    pen.strokeCircle(cx, cy, r, 2, done ? C.neon : C.ring, 0.95);
    // 눈금 24칸
    const lit = litTicks(p.progress, done);
    const slot = TAU / OBJ.ticks;
    for (let i = 0; i < OBJ.ticks; i += 1) {
      const a0 = TOP + slot * (i + (1 - OBJ.tickArc) / 2);
      const a1 = a0 + slot * OBJ.tickArc;
      const q = arcQuad(cx, cy, r - OBJ.tickIn, r - OBJ.tickOut, a0, a1);
      pen.fillPoly(q, C.tickOff, 1);
      const on = clamp01(lit - i);
      if (on > 0) pen.fillPoly(q, accent, on);
    }
    // 점령 중: 회전 스캔선 (꼬리가 옅어지는 부채꼴 조각들)
    if (st === 'capturing') {
      const a = TOP + TAU * ((((now % OBJ.scanMs) + OBJ.scanMs) % OBJ.scanMs) / OBJ.scanMs);
      const rr = r - OBJ.tickIn - 0.05;
      const step = 0.075;
      OBJ.scanTrail.forEach((alpha, n) => {
        const a1 = a - n * step;
        const a0 = a1 - step;
        pen.fillPoly([{ x: cx, y: cy }, ...arcQuad(cx, cy, rr, rr, a0, a1).slice(1, 3)], C.neon, alpha);
      });
      pen.line(cx, cy, cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, 2, C.neon, 0.75);
    }
  }
}

/** 탈출구별로 마지막으로 본 상태와 열린 시각 (미닫이 연출용, 장식 시간) */
const exitSeen = new Map<ExitId, { state: ExitState; openedAt: number }>();

/** 새 안개 레이어(판 시작 · 품질 변경): 처음 보는 열린 문은 연출 없이 다 열린 상태로 */
export function resetExitTracking(): void {
  exitSeen.clear();
}

/** 상태가 open이 된 순간을 기록한다. 처음 본 것이 이미 open이면(재접속 등) 연출 없이 다 열린 상태 */
export function trackExit(id: ExitId, state: ExitState, now: number): number {
  const prev = exitSeen.get(id);
  if (!prev) {
    const rec = { state, openedAt: state === 'open' ? now - OBJ.doorSlideMs : now };
    exitSeen.set(id, rec);
    return rec.openedAt;
  }
  if (prev.state !== 'open' && state === 'open') prev.openedAt = now;
  prev.state = state;
  return prev.openedAt;
}

/** 미닫이 진행 0~1 (열린 뒤 doorSlideMs 동안 감속 곡선) */
export function doorSlide(openedAt: number, now: number): number {
  const t = clamp01((now - openedAt) / OBJ.doorSlideMs);
  return 1 - (1 - t) ** 3;
}

/** 탈출구 판정 원 중 바닥 쪽 원호의 각 범위 (외벽 칸 위는 그리지 않는다) */
export function exitArcRange(id: ExitId, r: number): [number, number] {
  const e = EXITS[id];
  const north = e.door.y0 === 0;
  const lim = north ? e.door.y1 : e.door.y0;
  const s = Math.max(-1, Math.min(1, (lim - e.center.y) / r));
  const a = Math.asin(s);
  return north ? [a, Math.PI - a] : [Math.PI - a, TAU + a];
}

/**
 * 탈출구: 비활성 = 회색 소등, 활성 = 문에 초록 띠 맥동 + 셰브론이 문 쪽으로 차례로 점등,
 * 개방 진행(생존자에게만 오는 값, null이면 그리지 않음) = 문 칸 분할 게이지 + 판정 원 진행 호,
 * 열림 = 0.6초 미닫이 + 바닥으로 초록 빛 번짐
 */
export function paintExits(pen: FogPen, exits: readonly ExitView[], balance: Balance, now = gfxNow()): void {
  const r = balance.exit.radius;
  paintedRadii.exit = r;
  const C = OBJ_COLOR;
  for (const e of exits) {
    const def = EXITS[e.id];
    const D = def.door;
    const north = D.y0 === 0;
    const cx = (D.x0 + D.x1) / 2;
    const on = e.state !== 'inactive';
    const openedAt = trackExit(e.id, e.state, now);
    const color = on ? C.go : C.off;
    // 판정 원 (바닥 쪽만)
    const [a0, a1] = exitArcRange(e.id, r);
    pen.strokeArc(def.center.x, def.center.y, r, 0, a0, a1, 2, color, on ? 0.75 : 0.45);
    // 셰브론
    const chev = exitChevrons(e.id);
    if (on) {
      chev.forEach((poly, n) => {
        const phase =
          e.state === 'open' ? 0 : (((now / OBJ.chaseMs - (chev.length - 1 - n) / chev.length) % 1) + 1) % 1;
        pen.fillPoly(poly, C.go, e.state === 'open' ? 0.9 : 0.35 + 0.6 * (1 - phase));
      });
    }
    // 문 위 상태
    const edge = north ? D.y1 : D.y0;
    const inward = north ? 1 : -1;
    const lx0 = D.x0 + 0.14;
    const lx1 = D.x1 - 0.14;
    const bandA = edge - inward * 0.3;
    const bandB = edge - inward * 0.18;
    const band = (x0: number, x1: number, col: number, alpha: number): void =>
      pen.fillPoly(
        [
          { x: x0, y: bandA },
          { x: x1, y: bandA },
          { x: x1, y: bandB },
          { x: x0, y: bandB },
        ],
        col,
        alpha,
      );
    const lampA =
      e.state === 'active' ? 0.45 + 0.55 * (0.5 + 0.5 * Math.sin((TAU * now) / OBJ.exitPulseMs)) : 1;
    for (const l of doorLamps(e.id))
      pen.fillPoly(
        [
          { x: l.x0, y: l.y0 },
          { x: l.x1, y: l.y0 },
          { x: l.x1, y: l.y1 },
          { x: l.x0, y: l.y1 },
        ],
        color,
        on ? lampA : 0.6,
      );
    if (e.state === 'inactive') {
      band(lx0, lx1, C.off, 0.55);
    } else if (e.state === 'active') {
      const pulse = 0.5 + 0.5 * Math.sin((TAU * now) / OBJ.exitPulseMs);
      band(lx0, lx1, C.go, 0.35 + 0.5 * pulse);
      pen.line(cx, D.y0 + 0.16, cx, D.y1 - 0.16, 2, C.go, 0.5 + 0.4 * pulse);
      // 개방 진행: 문 칸 분할 게이지 + 판정 원 진행 호 (생존자 화면만: 괴물에게는 null이 온다)
      if (e.progress !== null) {
        const segs = OBJ.doorSegments;
        const lit = clamp01(e.progress) * segs;
        const w = (lx1 - lx0) / segs;
        for (let s = 0; s < segs; s += 1) {
          const x0 = lx0 + s * w + 0.02;
          const x1 = lx0 + (s + 1) * w - 0.02;
          band(x0, x1, C.gaugeOff, 1);
          const f = clamp01(lit - s);
          if (f > 0) band(x0, x1, C.gauge, f);
        }
        if (e.progress > 0)
          pen.strokeArc(
            def.center.x,
            def.center.y,
            r,
            3,
            TOP,
            TOP + TAU * clamp01(e.progress),
            4,
            C.gauge,
            1,
          );
      }
    } else {
      // 열림: 가운데부터 갈라지는 미닫이 + 문틈 빛 + 바닥 번짐 (반원: 바닥 쪽만)
      const t = doorSlide(openedAt, now);
      const half = ((lx1 - lx0) / 2) * t;
      const ly0 = D.y0 + 0.16;
      const ly1 = D.y1 - 0.16;
      if (half > 0.001) {
        pen.fillPoly(
          [
            { x: cx - half, y: ly0 },
            { x: cx + half, y: ly0 },
            { x: cx + half, y: ly1 },
            { x: cx - half, y: ly1 },
          ],
          C.openVoid,
          1,
        );
        pen.fillPoly(
          [
            { x: cx - half, y: ly0 },
            { x: cx + half, y: ly0 },
            { x: cx + half, y: ly1 },
            { x: cx - half, y: ly1 },
          ],
          C.go,
          0.55 * t,
        );
        for (const x of [cx - half, cx + half]) pen.line(x, ly0, x, ly1, 2, MAP_COLOR.doorLeafHi, 1);
      }
      band(lx0, lx1, C.go, 0.85);
      const spill: Vec2[] = [];
      const sr = 1.35;
      for (let q = 0; q <= 16; q += 1) {
        const a = (Math.PI * q) / 16;
        spill.push({ x: cx + Math.cos(a) * sr, y: edge + inward * Math.sin(a) * sr });
      }
      pen.fillPoly(spill, C.go, 0.13 * t);
      pen.fillPoly(
        spill.map((p) => ({ x: cx + (p.x - cx) * 0.6, y: edge + (p.y - edge) * 0.6 })),
        C.go,
        0.12 * t,
      );
    }
  }
}

// ───────────── 테두리 리프트 (곱하기 뒤에 더하는 정적 구조 색) ─────────────
// 시야 밖 = 정적 맵 × 하한이라 어두운 바닥에서 테두리 대비가 모자라다(곱하면 대비가 '+0.05' 쪽으로 무너진다).
// 벽 윗면 테두리 · 기둥 윗테두리 · 탈출구 문틀에만 작은 색(MAP_COLOR.rimLift)을 곱하기 뒤에 더해 시야 밖에서도 2.5:1 이상을
// 지킨다. 시야 · 시간 · 상대 위치와 무관한 정적 구조 색이고(빛이 아니다), 바닥 픽셀에는 닿지 않는다.

/** 리프트 도형을 배율 k(px / 타일)의 Path2D로. 사각형은 정적 맵과 같은 반올림으로 기기 픽셀에 맞춘다 */
export function rimLiftPath(k: number): Path2D {
  const path = new Path2D();
  for (const r of rimLiftRects()) {
    const x0 = Math.round(r.x0 * k);
    const y0 = Math.round(r.y0 * k);
    path.rect(x0, y0, Math.round(r.x1 * k) - x0, Math.round(r.y1 * k) - y0);
  }
  for (const q of rimLiftPolys()) {
    q.forEach((p, i) => {
      if (i === 0) path.moveTo(p.x * k, p.y * k);
      else path.lineTo(p.x * k, p.y * k);
    });
    path.closePath();
  }
  return path;
}

/** Canvas2D 합성에 테두리 리프트를 더한다 ('lighter' = 더하기) */
export function addRimLift(c: CanvasRenderingContext2D, path: Path2D): void {
  c.save();
  c.globalCompositeOperation = 'lighter';
  c.fillStyle = rgba(MAP_COLOR.rimLift, 1);
  c.fill(path);
  c.restore();
}

/**
 * Phaser Graphics에 테두리 리프트를 그린다 (GPU 합성: ADD 블렌드로 빛 지도 위에 둔다).
 * 좌표는 정적 맵 텍스처(배율 s, 위치 ox · oy)의 텍셀 경계와 같게 맞춘다
 */
export function drawRimLift(
  g: Phaser.GameObjects.Graphics,
  s: number,
  ox: number,
  oy: number,
  kLogical: number,
): void {
  const k = kLogical * s;
  g.fillStyle(MAP_COLOR.rimLift, 1);
  for (const r of rimLiftRects()) {
    const x0 = Math.round(r.x0 * k) / s;
    const y0 = Math.round(r.y0 * k) / s;
    g.fillRect(ox + x0, oy + y0, Math.round(r.x1 * k) / s - x0, Math.round(r.y1 * k) / s - y0);
  }
  for (const q of rimLiftPolys()) {
    g.beginPath();
    q.forEach((p, i) => {
      if (i === 0) g.moveTo(ox + p.x * kLogical, oy + p.y * kLogical);
      else g.lineTo(ox + p.x * kLogical, oy + p.y * kLogical);
    });
    g.closePath();
    g.fillPath();
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

/** 측정: 안개 합성 1회(begin~commit) 시간의 지수평균 (ms, gfx.features.fogCommitMs) */
export function recordFogCommit(ms: number): void {
  const prev = Number(gfxState.features.fogCommitMs ?? ms);
  gfxState.features.fogCommitMs = Math.round((prev * 0.9 + ms * 0.1) * 100) / 100;
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

// 안개 아래 그리는 공개 동적 레이어(거점 패드 · 눈금 · 스캔, 탈출구 상태 · 개방 게이지 · 미닫이, 시야 원 채움)와 빛 지도.
// 그림은 펜(FogPen) 하나로 그린다: Canvas2D 펜(한 장 합성 · 미니맵 · GPU 합성의 조각 캔버스)과 기록 펜(PenRecord: GPU 합성이
// 안개 주기마다 기록해 바뀐 조각만 캔버스에 다시 그려 올린다). 프레임마다 다시 테셀레이션하는 Phaser Graphics는 쓰지 않는다.
// 거점 · 탈출구의 판정 반경(원 · 눈금 위치)은 balance 값 그대로 그린다(범위 표시 = 실제 판정값). 장식 시간(스캔 회전 ·
// 맥동 · 미닫이)은 그래픽 상수이고 시계는 gfxNow(디버그 훅으로 멈춤)다.
import {
  CAPTURE_POINTS,
  EXITS,
  MAP_H,
  MAP_W,
  type Balance,
  type ExitId,
  type ExitState,
  type ExitView,
  type PointId,
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
  type TileRect,
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
  /**
   * 다각형 채우기 (꼭짓점 n개가 평평한 배열 xy[start..start + 2n) = x0, y0, x1, y1, …). 같은 수의 fillPoly와 같은 그림이다.
   * 기록 펜을 재생할 때 꼭짓점 객체를 다시 만들지 않으려고 쓴다 (렌더링 최적화 2)
   */
  fillPolyFlat(xy: readonly number[], start: number, n: number, color: number, alpha: number): void;
  /** 선분 (두께는 논리 px) */
  line(x0: number, y0: number, x1: number, y1: number, width: number, color: number, alpha: number): void;
}

let keySeq = 0;

/** 다시 만들 때 겹치지 않는 텍스처 키 (같은 키를 다시 쓰면 Phaser가 콘솔 에러를 낸다) */
export function nextFogKey(prefix: string): string {
  keySeq += 1;
  return `${prefix}-${keySeq}`;
}

/** rgba 문자열 캐시 칸 수 (2의 거듭제곱) */
const RGBA_SLOTS = 256;
const rgbaColor = new Float64Array(RGBA_SLOTS).fill(NaN);
const rgbaAlpha = new Float64Array(RGBA_SLOTS).fill(NaN);
const rgbaText: string[] = new Array<string>(RGBA_SLOTS).fill('');

/**
 * CSS 색 문자열. 안개 주기마다 같은 (색, 알파)로 수백 번 불리므로(눈금 · 패드 · 시야 채움) 최근 값을 칸 하나짜리 해시 캐시에
 * 둔다(렌더링 최적화 2: 부를 때마다 새 문자열). 캐시에 없으면 예전과 같은 식으로 만든다 — 돌려주는 문자열은 늘 같다
 */
export function rgba(color: number, alpha: number): string {
  const h = (color ^ (color >>> 11) ^ Math.floor(alpha * 4093)) & (RGBA_SLOTS - 1);
  if (rgbaColor[h] === color && rgbaAlpha[h] === alpha) return rgbaText[h] ?? '';
  const s = `rgba(${(color >> 16) & 255}, ${(color >> 8) & 255}, ${color & 255}, ${alpha})`;
  rgbaColor[h] = color;
  rgbaAlpha[h] = alpha;
  rgbaText[h] = s;
  return s;
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

  fillPolyFlat(xy: readonly number[], start: number, n: number, color: number, alpha: number): void {
    if (n < 3) return;
    // polyPath와 같은 호출 (같은 수 × k)
    const c = this.c;
    const k = this.k;
    c.beginPath();
    c.moveTo((xy[start] ?? 0) * k, (xy[start + 1] ?? 0) * k);
    for (let i = 1; i < n; i += 1) c.lineTo((xy[start + i * 2] ?? 0) * k, (xy[start + i * 2 + 1] ?? 0) * k);
    c.closePath();
    c.fillStyle = rgba(color, alpha);
    c.fill();
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

/** 기록 펜의 명령 번호 */
const OP_FILL_CIRCLE = 0;
const OP_STROKE_CIRCLE = 1;
const OP_STROKE_ARC = 2;
const OP_FILL_POLY = 3;
const OP_LINE = 4;

/** 타일 좌표 사각형 (PenRecord.replay 자르기) */
export interface TileClip {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * 기록 명령 하나(o[i]부터)가 자르기 사각형 밖이면 그 명령 길이(건너뛸 칸 수), 걸치거나 안이면 0. 원 · 호는 가운데 ± 반지름
 * (호의 inset은 반지름을 줄이기만 한다), 다각형은 꼭짓점 상자, 선은 두 끝점 상자. 선 굵기 · 안티에일리어싱 여유는 부르는 쪽이
 * 사각형을 넓혀 둔다. NaN 좌표는 어느 비교도 참이 아니라 건너뛰지 않는다(예전처럼 그린다)
 */
function skipOutside(o: readonly number[], i: number, clip: TileClip): number {
  const op = o[i] ?? 0;
  let x0: number;
  let y0: number;
  let x1: number;
  let y1: number;
  let step: number;
  if (op === OP_FILL_CIRCLE || op === OP_STROKE_CIRCLE || op === OP_STROKE_ARC) {
    const x = o[i + 1] ?? 0;
    const y = o[i + 2] ?? 0;
    const r = Math.abs(o[i + 3] ?? 0);
    x0 = x - r;
    x1 = x + r;
    y0 = y - r;
    y1 = y + r;
    step = op === OP_FILL_CIRCLE ? 6 : op === OP_STROKE_CIRCLE ? 7 : 10;
  } else if (op === OP_FILL_POLY) {
    const n = o[i + 1] ?? 0;
    x0 = Infinity;
    y0 = Infinity;
    x1 = -Infinity;
    y1 = -Infinity;
    for (let j = i + 2; j < i + 2 + n * 2; j += 2) {
      const x = o[j] ?? 0;
      const y = o[j + 1] ?? 0;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    step = 4 + n * 2;
  } else {
    const ax = o[i + 1] ?? 0;
    const ay = o[i + 2] ?? 0;
    const bx = o[i + 3] ?? 0;
    const by = o[i + 4] ?? 0;
    x0 = Math.min(ax, bx);
    x1 = Math.max(ax, bx);
    y0 = Math.min(ay, by);
    y1 = Math.max(ay, by);
    step = 8;
  }
  return x1 < clip.x0 || x0 > clip.x1 || y1 < clip.y0 || y0 > clip.y1 ? step : 0;
}

/**
 * 그리기 명령을 숫자 배열로 기록하는 펜 (GPU 합성의 공개 동적 레이어). 안개 주기마다 기록해 지난번과 같으면 캔버스를
 * 다시 그리지도 올리지도 않고, 다르면 replay로 캔버스 펜(조각 · 미니맵)에 그대로 다시 그린다
 */
export class PenRecord implements FogPen {
  /**
   * 기록 버퍼 (앞의 n개가 이번 기록). 비울 때 길이를 0으로 줄이지 않는다: V8은 length = 0이면 버퍼를 놓아 주고 다음 주기에
   * push로 다시 키우므로(늘릴 때마다 새 버퍼) 안개 주기마다 기록 크기의 몇 배를 새로 할당했다 (렌더링 최적화 2)
   */
  private readonly buf: number[] = [];
  private n = 0;

  /** 기록한 수의 사본 (시험 · 디버그용: 할당한다) */
  get ops(): number[] {
    return this.buf.slice(0, this.n);
  }

  /** 기록한 수의 개수 */
  get size(): number {
    return this.n;
  }

  reset(): void {
    this.n = 0;
  }

  fillCircle(x: number, y: number, r: number, color: number, alpha: number): void {
    const o = this.buf;
    let n = this.n;
    o[n++] = OP_FILL_CIRCLE;
    o[n++] = x;
    o[n++] = y;
    o[n++] = r;
    o[n++] = color;
    o[n++] = alpha;
    this.n = n;
  }

  strokeCircle(x: number, y: number, r: number, width: number, color: number, alpha: number): void {
    const o = this.buf;
    let n = this.n;
    o[n++] = OP_STROKE_CIRCLE;
    o[n++] = x;
    o[n++] = y;
    o[n++] = r;
    o[n++] = width;
    o[n++] = color;
    o[n++] = alpha;
    this.n = n;
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
    const o = this.buf;
    let n = this.n;
    o[n++] = OP_STROKE_ARC;
    o[n++] = x;
    o[n++] = y;
    o[n++] = r;
    o[n++] = inset;
    o[n++] = from;
    o[n++] = to;
    o[n++] = width;
    o[n++] = color;
    o[n++] = alpha;
    this.n = n;
  }

  fillPoly(poly: readonly Vec2[], color: number, alpha: number): void {
    if (poly.length < 3) return;
    const o = this.buf;
    let n = this.n;
    o[n++] = OP_FILL_POLY;
    o[n++] = poly.length;
    for (let i = 0; i < poly.length; i += 1) {
      const p = poly[i];
      o[n++] = p ? p.x : 0;
      o[n++] = p ? p.y : 0;
    }
    o[n++] = color;
    o[n++] = alpha;
    this.n = n;
  }

  fillPolyFlat(xy: readonly number[], start: number, count: number, color: number, alpha: number): void {
    if (count < 3) return;
    const o = this.buf;
    let n = this.n;
    o[n++] = OP_FILL_POLY;
    o[n++] = count;
    for (let i = start; i < start + count * 2; i += 1) o[n++] = xy[i] ?? 0;
    o[n++] = color;
    o[n++] = alpha;
    this.n = n;
  }

  line(x0: number, y0: number, x1: number, y1: number, width: number, color: number, alpha: number): void {
    const o = this.buf;
    let n = this.n;
    o[n++] = OP_LINE;
    o[n++] = x0;
    o[n++] = y0;
    o[n++] = x1;
    o[n++] = y1;
    o[n++] = width;
    o[n++] = color;
    o[n++] = alpha;
    this.n = n;
  }

  /** 기록이 ops와 같은가 (같으면 다시 그릴 필요가 없다) */
  sameAs(ops: readonly number[]): boolean {
    if (this.n !== ops.length) return false;
    const a = this.buf;
    for (let i = 0; i < this.n; i += 1) if (a[i] !== ops[i]) return false;
    return true;
  }

  /** 다른 기록과 같은 수인가 (sameAs와 같은 판단, 사본을 만들지 않는다) */
  same(rec: PenRecord): boolean {
    if (this.n !== rec.n) return false;
    const a = this.buf;
    const b = rec.buf;
    for (let i = 0; i < this.n; i += 1) if (a[i] !== b[i]) return false;
    return true;
  }

  /** 기록 rec의 명령을 그대로 이 기록에 덧붙인다 (재생해 기록한 것과 같은 수) */
  append(rec: PenRecord): void {
    const src = rec.buf;
    const len = rec.n;
    const o = this.buf;
    let n = this.n;
    for (let i = 0; i < len; i += 1) o[n++] = src[i] ?? 0;
    this.n = n;
  }

  /**
   * 기록한 명령을 다른 펜에 같은 순서로 그린다. 다각형은 기록한 평평한 배열 그대로 넘긴다(fillPolyFlat):
   * 안개 주기마다 꼭짓점 객체 · 배열 · 접근 함수를 새로 만들지 않는다 (렌더링 최적화 2).
   * clip(타일)이 있으면 그 밖에 통째로 있는 명령은 건너뛴다: 따라가는 카메라의 Canvas 합성은 창 둘레 영역 캔버스에만 칠하므로
   * 영역 밖 명령은 화소를 하나도 바꾸지 않는다(같은 화소, 명령 수만 준다). 기록 펜에 옮길 때는 자르지 않는다
   */
  replay(pen: FogPen, clip: TileClip | null = null): void {
    if (pen instanceof PenRecord) {
      pen.append(this);
      return;
    }
    const o = this.buf;
    const len = this.n;
    let i = 0;
    while (i < len) {
      if (clip) {
        const skip = skipOutside(o, i, clip);
        if (skip > 0) {
          i += skip;
          continue;
        }
      }
      const op = o[i] ?? 0;
      if (op === OP_FILL_CIRCLE) {
        pen.fillCircle(o[i + 1] ?? 0, o[i + 2] ?? 0, o[i + 3] ?? 0, o[i + 4] ?? 0, o[i + 5] ?? 0);
        i += 6;
      } else if (op === OP_STROKE_CIRCLE) {
        pen.strokeCircle(
          o[i + 1] ?? 0,
          o[i + 2] ?? 0,
          o[i + 3] ?? 0,
          o[i + 4] ?? 0,
          o[i + 5] ?? 0,
          o[i + 6] ?? 0,
        );
        i += 7;
      } else if (op === OP_STROKE_ARC) {
        pen.strokeArc(
          o[i + 1] ?? 0,
          o[i + 2] ?? 0,
          o[i + 3] ?? 0,
          o[i + 4] ?? 0,
          o[i + 5] ?? 0,
          o[i + 6] ?? 0,
          o[i + 7] ?? 0,
          o[i + 8] ?? 0,
          o[i + 9] ?? 0,
        );
        i += 10;
      } else if (op === OP_FILL_POLY) {
        const n = o[i + 1] ?? 0;
        pen.fillPolyFlat(o, i + 2, n, o[i + 2 + n * 2] ?? 0, o[i + 3 + n * 2] ?? 0);
        i += 4 + n * 2;
      } else {
        pen.line(
          o[i + 1] ?? 0,
          o[i + 2] ?? 0,
          o[i + 3] ?? 0,
          o[i + 4] ?? 0,
          o[i + 5] ?? 0,
          o[i + 6] ?? 0,
          o[i + 7] ?? 0,
        );
        i += 8;
      }
    }
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

/** 거점 하나의 고정 도형: 판정 반경 r에서의 눈금 24칸 사각형 띠 (자리 · 반경이 같으면 같은 수) */
interface PointGeom {
  readonly r: number;
  readonly ticks: readonly (readonly Vec2[])[];
}

const pointGeoms = new Map<PointId, PointGeom>();

/**
 * 눈금 띠는 거점 자리와 판정 반경만의 함수라 (거점, 반경)마다 한 번만 계산한다 (렌더링 최적화 2: 안개 주기마다
 * 눈금 24칸 × 꼭짓점 4개를 새로 만들던 것). 계산식은 그대로라 같은 수다
 */
function pointGeom(id: PointId, r: number): PointGeom {
  const had = pointGeoms.get(id);
  if (had && had.r === r) return had;
  const { x: cx, y: cy } = CAPTURE_POINTS[id];
  const slot = TAU / OBJ.ticks;
  const ticks: Vec2[][] = [];
  for (let i = 0; i < OBJ.ticks; i += 1) {
    const a0 = TOP + slot * (i + (1 - OBJ.tickArc) / 2);
    const a1 = a0 + slot * OBJ.tickArc;
    ticks.push(arcQuad(cx, cy, r - OBJ.tickIn, r - OBJ.tickOut, a0, a1));
  }
  const g = { r, ticks };
  pointGeoms.set(id, g);
  return g;
}

/** 스캔선 꼬리 조각 (중심 + 원호 두 점). 펜은 받은 다각형을 바로 그리거나 수로 기록하고 붙잡지 않으므로 하나를 고쳐 쓴다 */
const SCAN_TRI: [Vec2, Vec2, Vec2] = [
  { x: 0, y: 0 },
  { x: 0, y: 0 },
  { x: 0, y: 0 },
];

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
    // 눈금 24칸 (띠 도형은 거점 · 반경마다 한 번 계산해 둔 것)
    const lit = litTicks(p.progress, done);
    const ticks = pointGeom(p.id, r).ticks;
    for (let i = 0; i < ticks.length; i += 1) {
      const q = ticks[i];
      if (!q) continue;
      pen.fillPoly(q, C.tickOff, 1);
      const on = clamp01(lit - i);
      if (on > 0) pen.fillPoly(q, accent, on);
    }
    // 점령 중: 회전 스캔선 (꼬리가 옅어지는 부채꼴 조각들)
    if (st === 'capturing') {
      const a = TOP + TAU * ((((now % OBJ.scanMs) + OBJ.scanMs) % OBJ.scanMs) / OBJ.scanMs);
      const rr = r - OBJ.tickIn - 0.05;
      const step = 0.075;
      // 조각 = 중심 + arcQuad(rr, rr, a0, a1)의 두 번째 · 세 번째 꼭짓점 (같은 식)
      const [c0, c1, c2] = SCAN_TRI;
      c0.x = cx;
      c0.y = cy;
      let n = 0;
      for (const alpha of OBJ.scanTrail) {
        const a1 = a - n * step;
        const a0 = a1 - step;
        c1.x = cx + Math.cos(a0) * rr;
        c1.y = cy + Math.sin(a0) * rr;
        c2.x = cx + Math.cos(a1) * rr;
        c2.y = cy + Math.sin(a1) * rr;
        pen.fillPoly(SCAN_TRI, C.neon, alpha);
        n += 1;
      }
      pen.line(cx, cy, cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, 2, C.neon, 0.75);
    }
  }
}

/**
 * 탈출구별로 마지막으로 본 상태와 열린 시각 (미닫이 연출용). openedAt은 장식 시계(gfxNow), openedReal은 실제 시계다.
 * 실제 시계는 '장식 시계가 멈췄는가'를 알아내는 데만 쓴다 (연출 자체는 장식 시계로 움직인다)
 */
const exitSeen = new Map<ExitId, { state: ExitState; openedAt: number; openedReal: number }>();

/** 새 안개 레이어(판 시작 · 품질 변경): 처음 보는 열린 문은 연출 없이 다 열린 상태로 */
export function resetExitTracking(): void {
  exitSeen.clear();
}

/** 상태가 open이 된 순간을 기록한다. 처음 본 것이 이미 open이면(재접속 등) 연출 없이 다 열린 상태 */
export function trackExit(id: ExitId, state: ExitState, now: number, real = performance.now()): number {
  const prev = exitSeen.get(id);
  if (!prev) {
    const done = state === 'open' ? OBJ.doorSlideMs : 0;
    const rec = { state, openedAt: now - done, openedReal: real - done };
    exitSeen.set(id, rec);
    return rec.openedAt;
  }
  if (prev.state !== 'open' && state === 'open') {
    prev.openedAt = now;
    prev.openedReal = real;
  }
  prev.state = state;
  return prev.openedAt;
}

/** 미닫이 진행 0~1 (열린 뒤 doorSlideMs 동안 감속 곡선) */
export function doorSlide(openedAt: number, now: number): number {
  const t = clamp01((now - openedAt) / OBJ.doorSlideMs);
  return 1 - (1 - t) ** 3;
}

/**
 * 지금 그릴 미닫이 진행. 보통은 장식 시계(doorSlide)이고, 장식 시계가 멈춘 채(디버그 freezeClock) 실제로 미닫이 시간
 * 이상 흘렀으면 다 열린 그림이다. 멈춘 시계에서 열린 문이 영원히 닫힌(= 활성처럼 보이는) 그림으로 남지 않게 한다
 */
export function exitSlide(id: ExitId, now: number, real = performance.now()): number {
  const rec = exitSeen.get(id);
  if (!rec) return 1;
  const t = doorSlide(rec.openedAt, now);
  const stalled = real - rec.openedReal - (now - rec.openedAt);
  return stalled >= OBJ.doorSlideMs ? 1 : t;
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

/** 사각형 하나를 네 꼭짓점 다각형으로 (왼위 → 오른위 → 오른아래 → 왼아래) */
function rectPoly(x0: number, y0: number, x1: number, y1: number): Vec2[] {
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
}

/**
 * 탈출구 하나의 고정 도형 (판정 반경 r에서): 판정 원호 각 범위 · 셰브론 · 상태등 · 문 띠 · 게이지 칸 · 열린 문 빛 번짐.
 * 모두 문 자리(EXITS)와 반경만의 함수라 (탈출구, 반경)마다 한 번만 계산한다 (렌더링 최적화 2: 안개 주기마다 새로 만들던 것).
 * 계산식은 그대로라 같은 수다. 시간에 따라 움직이는 것(미닫이 폭)만 그릴 때 계산한다
 */
interface ExitGeom {
  readonly r: number;
  readonly arc: readonly [number, number];
  readonly chev: readonly (readonly Vec2[])[];
  readonly lamps: readonly (readonly Vec2[])[];
  /** 문 위 상태 띠 (lx0 ~ lx1) */
  readonly band: readonly Vec2[];
  /** 개방 게이지 칸 띠 (OBJ.doorSegments개) */
  readonly segs: readonly (readonly Vec2[])[];
  /** 열린 문 바닥 빛 번짐 반원과 그 0.6배 */
  readonly spill: readonly Vec2[];
  readonly spillIn: readonly Vec2[];
}

const exitGeoms = new Map<ExitId, ExitGeom>();

function exitGeom(id: ExitId, r: number): ExitGeom {
  const had = exitGeoms.get(id);
  if (had && had.r === r) return had;
  const D = EXITS[id].door;
  const north = D.y0 === 0;
  const cx = (D.x0 + D.x1) / 2;
  const edge = north ? D.y1 : D.y0;
  const inward = north ? 1 : -1;
  const lx0 = D.x0 + 0.14;
  const lx1 = D.x1 - 0.14;
  const bandA = edge - inward * 0.3;
  const bandB = edge - inward * 0.18;
  const segN = OBJ.doorSegments;
  const w = (lx1 - lx0) / segN;
  const segs: Vec2[][] = [];
  for (let s = 0; s < segN; s += 1) {
    const x0 = lx0 + s * w + 0.02;
    const x1 = lx0 + (s + 1) * w - 0.02;
    segs.push(rectPoly(x0, bandA, x1, bandB));
  }
  const spill: Vec2[] = [];
  const sr = EXIT_SPILL_R;
  for (let q = 0; q <= 16; q += 1) {
    const a = (Math.PI * q) / 16;
    spill.push({ x: cx + Math.cos(a) * sr, y: edge + inward * Math.sin(a) * sr });
  }
  const g: ExitGeom = {
    r,
    arc: exitArcRange(id, r),
    chev: exitChevrons(id),
    lamps: doorLamps(id).map((l) => rectPoly(l.x0, l.y0, l.x1, l.y1)),
    band: rectPoly(lx0, bandA, lx1, bandB),
    segs,
    spill,
    spillIn: spill.map((p) => ({ x: cx + (p.x - cx) * 0.6, y: edge + (p.y - edge) * 0.6 })),
  };
  exitGeoms.set(id, g);
  return g;
}

/** 미닫이 틈 사각형 (폭이 시간에 따라 바뀐다). 펜은 다각형을 붙잡지 않으므로 하나를 고쳐 쓴다 */
const SLIDE_QUAD: [Vec2, Vec2, Vec2, Vec2] = [
  { x: 0, y: 0 },
  { x: 0, y: 0 },
  { x: 0, y: 0 },
  { x: 0, y: 0 },
];

/**
 * 탈출구: 비활성 = 회색 소등, 활성 = 문에 초록 띠 맥동 + 셰브론이 문 쪽으로 차례로 점등,
 * 개방 진행(생존자에게만 오는 값, null이면 그리지 않음) = 문 칸 분할 게이지 + 판정 원 진행 호,
 * 열림 = 0.6초 미닫이 + 바닥으로 초록 빛 번짐
 */
export function paintExits(
  pen: FogPen,
  exits: readonly ExitView[],
  balance: Balance,
  now = gfxNow(),
  real = performance.now(),
): void {
  const r = balance.exit.radius;
  paintedRadii.exit = r;
  const C = OBJ_COLOR;
  for (const e of exits) {
    const def = EXITS[e.id];
    const D = def.door;
    const cx = (D.x0 + D.x1) / 2;
    const on = e.state !== 'inactive';
    trackExit(e.id, e.state, now, real);
    const color = on ? C.go : C.off;
    const g = exitGeom(e.id, r);
    // 판정 원 (바닥 쪽만)
    pen.strokeArc(def.center.x, def.center.y, r, 0, g.arc[0], g.arc[1], 2, color, on ? 0.75 : 0.45);
    // 셰브론
    if (on) {
      const chev = g.chev;
      for (let n = 0; n < chev.length; n += 1) {
        const poly = chev[n];
        if (!poly) continue;
        const phase =
          e.state === 'open' ? 0 : (((now / OBJ.chaseMs - (chev.length - 1 - n) / chev.length) % 1) + 1) % 1;
        pen.fillPoly(poly, C.go, e.state === 'open' ? 0.9 : 0.35 + 0.6 * (1 - phase));
      }
    }
    // 문 위 상태
    const lampA =
      e.state === 'active' ? 0.45 + 0.55 * (0.5 + 0.5 * Math.sin((TAU * now) / OBJ.exitPulseMs)) : 1;
    for (const l of g.lamps) pen.fillPoly(l, color, on ? lampA : 0.6);
    if (e.state === 'inactive') {
      pen.fillPoly(g.band, C.off, 0.55);
    } else if (e.state === 'active') {
      const pulse = 0.5 + 0.5 * Math.sin((TAU * now) / OBJ.exitPulseMs);
      pen.fillPoly(g.band, C.go, 0.35 + 0.5 * pulse);
      pen.line(cx, D.y0 + 0.16, cx, D.y1 - 0.16, 2, C.go, 0.5 + 0.4 * pulse);
      // 개방 진행: 문 칸 분할 게이지 + 판정 원 진행 호 (생존자 화면만: 괴물에게는 null이 온다)
      if (e.progress !== null) {
        const lit = clamp01(e.progress) * g.segs.length;
        for (let s = 0; s < g.segs.length; s += 1) {
          const seg = g.segs[s];
          if (!seg) continue;
          pen.fillPoly(seg, C.gaugeOff, 1);
          const f = clamp01(lit - s);
          if (f > 0) pen.fillPoly(seg, C.gauge, f);
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
      const t = exitSlide(e.id, now, real);
      const lx0 = D.x0 + 0.14;
      const lx1 = D.x1 - 0.14;
      const half = ((lx1 - lx0) / 2) * t;
      const ly0 = D.y0 + 0.16;
      const ly1 = D.y1 - 0.16;
      if (half > 0.001) {
        const [q0, q1, q2, q3] = SLIDE_QUAD;
        q0.x = cx - half;
        q0.y = ly0;
        q1.x = cx + half;
        q1.y = ly0;
        q2.x = cx + half;
        q2.y = ly1;
        q3.x = cx - half;
        q3.y = ly1;
        pen.fillPoly(SLIDE_QUAD, C.openVoid, 1);
        pen.fillPoly(SLIDE_QUAD, C.go, 0.55 * t);
        pen.line(cx - half, ly0, cx - half, ly1, 2, MAP_COLOR.doorLeafHi, 1);
        pen.line(cx + half, ly0, cx + half, ly1, 2, MAP_COLOR.doorLeafHi, 1);
      }
      pen.fillPoly(g.band, C.go, 0.85);
      pen.fillPoly(g.spill, C.go, 0.13 * t);
      pen.fillPoly(g.spillIn, C.go, 0.12 * t);
    }
  }
}

/** 열린 문에서 바닥으로 번지는 초록 빛 반원 반지름 (타일) */
const EXIT_SPILL_R = 1.35;
/** 그림 범위 여유 (타일): 가장 굵은 선(거점 바깥 번짐 6px)의 반 + 안티에일리어싱 */
const PAINT_PAD = 0.2;

function padRect(xs: readonly number[], ys: readonly number[]): TileRect {
  return {
    x0: Math.min(...xs) - PAINT_PAD,
    y0: Math.min(...ys) - PAINT_PAD,
    x1: Math.max(...xs) + PAINT_PAD,
    y1: Math.max(...ys) + PAINT_PAD,
  };
}

/** 범위 계산 결과 (반경마다 하나: 거점 · 탈출구 자리는 고정이라 같은 반경이면 같은 사각형) */
interface BoundsMemo {
  readonly r: number;
  readonly rect: TileRect;
}

const pointBounds = new Map<PointId, BoundsMemo>();
const exitBounds = new Map<ExitId, BoundsMemo>();

/**
 * 거점 하나(paintPoints)가 어떤 상태에서든 그리는 범위 (타일): 판정 원 + 바깥 번짐 선.
 * (거점, 반경)마다 한 번 계산해 같은 객체를 돌려준다 (안개 주기마다 다시 계산하지 않는다)
 */
export function pointPaintBounds(id: PointId, r: number): TileRect {
  const had = pointBounds.get(id);
  if (had && had.r === r) return had.rect;
  const c = CAPTURE_POINTS[id];
  const rect = padRect([c.x - r, c.x + r], [c.y - r, c.y + r]);
  pointBounds.set(id, { r, rect });
  return rect;
}

/**
 * 탈출구 하나(paintExits)가 어떤 상태에서든 그리는 범위 (타일): 판정 원 · 문 · 상태등 · 셰브론 · 열린 문 빛 번짐.
 * (탈출구, 반경)마다 한 번 계산해 같은 객체를 돌려준다
 */
export function exitPaintBounds(id: ExitId, r: number): TileRect {
  const had = exitBounds.get(id);
  if (had && had.r === r) return had.rect;
  const e = EXITS[id];
  const D = e.door;
  const north = D.y0 === 0;
  const edge = north ? D.y1 : D.y0;
  const cx = (D.x0 + D.x1) / 2;
  const xs = [e.center.x - r, e.center.x + r, D.x0, D.x1, cx - EXIT_SPILL_R, cx + EXIT_SPILL_R];
  const ys = [e.center.y - r, e.center.y + r, D.y0, D.y1, edge + (north ? 1 : -1) * EXIT_SPILL_R];
  for (const l of doorLamps(id)) {
    xs.push(l.x0, l.x1);
    ys.push(l.y0, l.y1);
  }
  for (const p of exitChevrons(id).flat()) {
    xs.push(p.x);
    ys.push(p.y);
  }
  const rect = padRect(xs, ys);
  exitBounds.set(id, { r, rect });
  return rect;
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

/** 리프트 아틀라스 프레임: 아틀라스 안 자리(ax, ay) · 크기, 다각형이면 합성 px 원점(ox, oy)과 꼭짓점 (사각형은 null = 단색) */
export interface LiftFrame {
  readonly name: string;
  ax: number;
  ay: number;
  readonly w: number;
  readonly h: number;
  readonly ox: number;
  readonly oy: number;
  readonly poly: readonly Vec2[] | null;
}

/** 리프트 한 조각을 찍는 자리 (합성 배율 px, 정적 맵 텍셀 경계) */
export interface LiftBob {
  readonly x: number;
  readonly y: number;
  readonly frame: string;
}

/** 아틀라스 사각형 (px) */
export interface PxRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface LiftAtlas {
  readonly width: number;
  readonly height: number;
  /** 리프트 색으로 꽉 채운 막대 (세로 · 가로). 사각형 조각 프레임은 모두 이 막대의 부분이다 */
  readonly solid: readonly PxRect[];
  readonly frames: readonly LiftFrame[];
  readonly bobs: readonly LiftBob[];
}

/** 긴 테두리 띠를 이 길이(px) 이하로 잘라 찍는다 (단색 막대 길이) */
export const LIFT_SEG = 256;

/**
 * GPU 합성의 테두리 리프트: 맵 전체 크기 텍스처(배율 2에서 20.7MiB) 대신 작은 아틀라스와 찍을 자리.
 * 사각형(벽 · 문 테두리 띠)은 정적 맵과 같은 반올림(기기 픽셀 경계)이고 단색이라, 프레임이 모두 세로 · 가로 단색 막대
 * 두 개의 부분 사각형이다(긴 띠는 LIFT_SEG로 자른다). 기둥 테두리 사다리꼴은 조각마다 안티에일리어싱해 굽고, 선반 쌓기로
 * 막대 옆에 둔다(투명 테 1px: 선형 보간이 이웃을 끌어오지 않게). 조각끼리 겹치지 않아(rimLiftRects가 서로소) 더하기가
 * 두 번 겹치지 않는다. k = 합성 px / 타일
 */
export function layoutRimLift(k: number): LiftAtlas {
  const pieces: PxRect[] = [];
  for (const r of rimLiftRects()) {
    const x0 = Math.round(r.x0 * k);
    const y0 = Math.round(r.y0 * k);
    const x1 = Math.round(r.x1 * k);
    const y1 = Math.round(r.y1 * k);
    for (let x = x0; x < x1; x += LIFT_SEG)
      for (let y = y0; y < y1; y += LIFT_SEG)
        pieces.push({ x, y, w: Math.min(LIFT_SEG, x1 - x), h: Math.min(LIFT_SEG, y1 - y) });
  }
  // 막대 두께 = 가장 두꺼운 띠 (세로 막대는 왼쪽 위, 가로 막대는 그 오른쪽)
  const t = Math.max(1, ...pieces.map((p) => Math.min(p.w, p.h)));
  const vert: PxRect = { x: 1, y: 1, w: t, h: LIFT_SEG };
  const horz: PxRect = { x: t + 3, y: 1, w: LIFT_SEG, h: t };
  const frames = new Map<string, LiftFrame>();
  const bobs: LiftBob[] = [];
  for (const p of pieces) {
    const v = p.h > p.w;
    const name = `${v ? 'v' : 'h'}${p.w}x${p.h}`;
    const bar = v ? vert : horz;
    if (!frames.has(name))
      frames.set(name, { name, ax: bar.x, ay: bar.y, w: p.w, h: p.h, ox: 0, oy: 0, poly: null });
    bobs.push({ x: p.x, y: p.y, frame: name });
  }
  const quads: LiftFrame[] = rimLiftPolys().map((q, n) => {
    const poly = q.map((p) => ({ x: p.x * k, y: p.y * k }));
    const ox = Math.floor(Math.min(...poly.map((p) => p.x)));
    const oy = Math.floor(Math.min(...poly.map((p) => p.y)));
    const w = Math.ceil(Math.max(...poly.map((p) => p.x))) - ox;
    const h = Math.ceil(Math.max(...poly.map((p) => p.y))) - oy;
    bobs.push({ x: ox, y: oy, frame: `q${n}` });
    return { name: `q${n}`, ax: 0, ay: 0, w, h, ox, oy, poly };
  });
  // 사다리꼴: 가로 막대 아래 · 세로 막대 오른쪽에 선반 쌓기 (높은 것부터 한 줄씩, 프레임마다 투명 테 1px)
  const left = horz.x - 1;
  const right = horz.x + horz.w + 1;
  let x = left;
  let y = t + 2;
  let rowH = 0;
  for (const f of [...quads].sort((a, b) => b.h - a.h || b.w - a.w)) {
    if (x > left && x + f.w + 2 > right) {
      y += rowH;
      x = left;
      rowH = 0;
    }
    f.ax = x + 1;
    f.ay = y + 1;
    x += f.w + 2;
    rowH = Math.max(rowH, f.h + 2);
  }
  return {
    width: Math.max(right, ...quads.map((f) => f.ax + f.w + 1)),
    height: Math.max(vert.y + vert.h + 1, y + rowH),
    solid: [vert, horz],
    frames: [...frames.values(), ...quads],
    bobs,
  };
}

/** 리프트 아틀라스를 칠하는 2D 컨텍스트 부분 */
export type LiftAtlasCtx = PathCtx & Pick<CanvasRenderingContext2D, 'fillStyle' | 'fillRect' | 'fill'>;

/** 아틀라스에 리프트 조각을 칠한다 (투명 바탕 위 리프트 색) */
export function paintRimLiftAtlas(c: LiftAtlasCtx, atlas: LiftAtlas): void {
  c.fillStyle = rgba(MAP_COLOR.rimLift, 1);
  for (const r of atlas.solid) c.fillRect(r.x, r.y, r.w, r.h);
  for (const f of atlas.frames) {
    if (!f.poly) continue;
    polyPath(
      c,
      f.poly.map((p) => ({ x: p.x - f.ox + f.ax, y: p.y - f.oy + f.ay })),
      1,
    );
    c.fill();
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

/** DOM 캔버스와 2D 컨텍스트 (폭 · 높이 px) */
export function makeCanvas(
  width: number,
  height: number,
): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('캔버스를 만들 수 없습니다');
  return { canvas, ctx };
}

/** 브라우저: DOM 캔버스 */
export function domLightSurface(width: number, height: number): LightSurface<HTMLCanvasElement> {
  return makeCanvas(width, height);
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
    this.addSoftAt(light.poly, light.center.x, light.center.y, light.radius, light.soft);
  }

  /** addSoft와 같은 그림 (중심을 수로 받는다: 기록 재생이 객체를 만들지 않게) */
  addSoftAt(poly: readonly Vec2[], centerX: number, centerY: number, radius: number, soft: number): void {
    if (poly.length < 3) return;
    const l = this.ctx;
    const k = this.k;
    const geo = softLightGeometry(radius, soft);
    let fill: CanvasGradient | string = '#ffffff';
    // 흐림 띠가 없으면(soft ≤ 0) 딱 자른다. 같은 원 두 개로 만든 그라디언트는 캔버스 규칙상 아무것도 칠하지 않는다
    if (geo.outer > geo.inner) {
      const cx = centerX * k;
      const cy = centerY * k;
      const grad = l.createRadialGradient(cx, cy, geo.inner * k, cx, cy, geo.outer * k);
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(1, this.ambientCss);
      fill = grad;
    }
    l.save();
    l.globalCompositeOperation = 'lighten';
    polyPath(l, poly, k);
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

// ───────────── 빛 지도 기록 (M12 휴대폰 성능) ─────────────

/** 빛 명령 하나: 부드러운 원형 시야(soft) 또는 딱 잘린 시야(hard). 다각형은 참조로, 나머지는 값으로 담는다 */
interface LightOp {
  poly: readonly Vec2[];
  /** 부드러운 시야만: 중심 · 판정 반경 · 흐림 띠 (딱 잘린 시야는 NaN) */
  cx: number;
  cy: number;
  radius: number;
  soft: number;
}

/** 두 다각형이 같은 꼭짓점인가 (같은 참조면 바로 참: 시야 다각형은 만든 뒤 바꾸지 않는다) */
export function samePoly(a: readonly Vec2[], b: readonly Vec2[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const p = a[i];
    const q = b[i];
    if (!p || !q || p.x !== q.x || p.y !== q.y) return false;
  }
  return true;
}

function sameNum(a: number, b: number): boolean {
  return a === b || (Number.isNaN(a) && Number.isNaN(b));
}

function sameLightOp(p: LightOp, q: LightOp): boolean {
  return (
    sameNum(p.cx, q.cx) &&
    sameNum(p.cy, q.cy) &&
    sameNum(p.radius, q.radius) &&
    sameNum(p.soft, q.soft) &&
    samePoly(p.poly, q.poly)
  );
}

/**
 * 빛 지도 명령 기록. 안개 주기마다 기록해 지난번과 같으면(모두 가만히 서 있고 괴물 조준도 그대로) 빛 지도를 다시 칠하지도
 * GPU에 다시 올리지도 않는다. 다르면 지운 뒤 같은 순서로 칠한다(LightMap에 바로 칠하던 것과 같은 그림)
 */
export class LightRecord {
  /** 이번 주기 기록 (앞의 n개). 명령 객체는 주기마다 고쳐 쓴다 (렌더링 최적화 2: 주기마다 배열 · 객체를 새로 만들던 것) */
  private cur: LightOp[] = [];
  private n = 0;
  /** 마지막으로 빛 지도에 칠한 기록 (앞의 paintedN개. 아직 없으면 null — 첫 주기는 늘 칠한다) */
  private painted: LightOp[] | null = null;
  private paintedN = 0;
  /** 이번 주기 기록을 칠했는가 (칠했으면 이번 기록이 곧 마지막으로 칠한 기록이다) */
  private curPainted = false;

  /** 안개 주기 시작. 칠한 기록은 남기고, 다른 묶음의 명령 객체를 고쳐 쓴다 */
  reset(): void {
    if (this.curPainted) {
      const spare = this.painted ?? [];
      this.painted = this.cur;
      this.paintedN = this.n;
      this.cur = spare;
      this.curPainted = false;
    }
    this.n = 0;
  }

  private next(): LightOp {
    let op = this.cur[this.n];
    if (!op) {
      op = { poly: [], cx: NaN, cy: NaN, radius: NaN, soft: NaN };
      this.cur.push(op);
    }
    this.n += 1;
    return op;
  }

  addSoft(light: SoftLight): void {
    if (light.poly.length < 3) return;
    const op = this.next();
    op.poly = light.poly;
    op.cx = light.center.x;
    op.cy = light.center.y;
    op.radius = light.radius;
    op.soft = light.soft;
  }

  addHard(poly: readonly Vec2[]): void {
    if (poly.length < 3) return;
    const op = this.next();
    op.poly = poly;
    op.cx = NaN;
    op.cy = NaN;
    op.radius = NaN;
    op.soft = NaN;
  }

  /** 지난번에 칠한 기록과 같은가 */
  get unchanged(): boolean {
    if (this.curPainted) return true;
    const b = this.painted;
    if (!b || this.n !== this.paintedN) return false;
    for (let i = 0; i < this.n; i += 1) {
      const p = this.cur[i];
      const q = b[i];
      if (!p || !q || !sameLightOp(p, q)) return false;
    }
    return true;
  }

  /** 바뀌었으면 빛 지도를 지우고 기록대로 칠한다. 칠했으면 true (텍스처를 다시 올려야 한다) */
  paint<C extends { readonly width: number; readonly height: number }>(light: LightMap<C>): boolean {
    if (this.unchanged) return false;
    light.clear();
    for (let i = 0; i < this.n; i += 1) {
      const op = this.cur[i];
      if (!op) continue;
      if (Number.isNaN(op.radius)) light.addHard(op.poly);
      else light.addSoftAt(op.poly, op.cx, op.cy, op.radius, op.soft);
    }
    this.curPainted = true;
    return true;
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

/** 표시 목록 중 세는 데 쓰는 부분 (Phaser Container.list · Graphics.commandBuffer) */
interface CountNode {
  readonly list?: readonly unknown[];
  readonly commandBuffer?: readonly unknown[];
}

function asNode(v: unknown): CountNode | null {
  return typeof v === 'object' && v !== null ? (v as CountNode) : null;
}

/**
 * 표시 목록(컨테이너는 안까지)에서 Graphics 명령 버퍼 길이 합. Phaser WebGL Graphics는 이 버퍼를 프레임마다 다시
 * 풀어 테셀레이션하므로(원호 100분할 · fillPath Earcut) 맵 레이어의 프레임당 비용 지표로 쓴다 (gfx.features.mapGfxCmds)
 */
export function countGraphicsCmds(list: readonly unknown[]): { objects: number; cmds: number } {
  const out = { objects: 0, cmds: 0 };
  addGraphicsCmds(list, out);
  return out;
}

/** countGraphicsCmds의 안쪽: 컨테이너마다 결과 객체를 만들지 않고 한 곳에 더한다 */
function addGraphicsCmds(list: readonly unknown[], out: { objects: number; cmds: number }): void {
  for (let i = 0; i < list.length; i += 1) {
    const n = asNode(list[i]);
    if (!n) continue;
    out.objects += 1;
    if (Array.isArray(n.commandBuffer)) out.cmds += n.commandBuffer.length;
    if (Array.isArray(n.list)) addGraphicsCmds(n.list, out);
  }
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

/** 텍스처 일부 올리기에 쓰는 WebGL 컨텍스트 부분 */
export type SubUploadGl = Pick<
  WebGLRenderingContext,
  | 'TEXTURE0'
  | 'TEXTURE_2D'
  | 'TEXTURE_BINDING_2D'
  | 'UNPACK_PREMULTIPLY_ALPHA_WEBGL'
  | 'UNPACK_FLIP_Y_WEBGL'
  | 'RGBA'
  | 'UNSIGNED_BYTE'
  | 'activeTexture'
  | 'getParameter'
  | 'bindTexture'
  | 'pixelStorei'
  | 'texSubImage2D'
  | 'isContextLost'
>;

/** 렌더러 중 여기서 쓰는 부분 (Phaser WebGLRenderer.gl. Canvas 렌더러에는 없다) */
export interface SubUploadHost {
  readonly gl?: SubUploadGl;
}

/** 텍스처 source 중 여기서 쓰는 부분 (Phaser TextureSource.glTexture: WebGLTextureWrapper) */
export interface SubUploadSource {
  readonly glTexture?: {
    readonly webGLTexture: WebGLTexture | null;
    readonly pma: boolean;
    readonly flipY: boolean;
  } | null;
}

/**
 * 캔버스 src를 WebGL 텍스처의 (x, y) 자리에 그 크기만큼만 올린다 (texSubImage2D). Phaser가 캔버스 텍스처를 올릴 때
 * (WebGLTextureWrapper._processTexture)와 같은 순서로 GL 상태를 다룬다: 0번 단위에서 묶인 텍스처를 기억 → 이 텍스처를 묶고
 * 프리멀티플라이 · 뒤집기를 텍스처 설정대로 → 올림 → 묶음 되돌림. 그래서 Phaser가 기억하는 묶음 상태가 그대로 맞다.
 * WebGL이 아니거나(Canvas 렌더러는 캔버스를 바로 그린다) 컨텍스트를 잃었거나 GL 텍스처가 없으면 false (호출한 쪽이 통째로 올린다)
 */
export function uploadCanvasSubTexture(
  host: object,
  source: SubUploadSource | undefined,
  src: TexImageSource,
  x: number,
  y: number,
): boolean {
  const gl = (host as SubUploadHost).gl;
  const wrap = source?.glTexture;
  const tex = wrap?.webGLTexture;
  if (!gl || !wrap || !tex || gl.isContextLost()) return false;
  gl.activeTexture(gl.TEXTURE0);
  const current = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, wrap.pma);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, wrap.flipY);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, gl.RGBA, gl.UNSIGNED_BYTE, src);
  gl.bindTexture(gl.TEXTURE_2D, current);
  return true;
}

/** 캔버스 크기를 바꾸고 텍스처 · 기본 프레임을 맞춘다 (CanvasTexture.setSize와 같은 순서. 캔버스 내용은 지워진다) */
export function resizeCanvasTexture<C extends { width: number; height: number }>(
  key: string,
  tex: CanvasTextureLike,
  canvas: C,
  width: number,
  height: number,
  /** false = 곧 다시 그려 올릴 것이라 빈 캔버스는 올리지 않는다 (배지 아틀라스) */
  upload = true,
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
  if (upload) uploadCanvasTexture(tex);
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

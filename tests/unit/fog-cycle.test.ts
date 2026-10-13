// 렌더링 최적화 2 (G2, 안개 주기): 안개 주기마다 돌던 그림 함수를 할당 없이 다시 쓴 것이 예전 함수와 같은 그림인지 본다.
// 예전 함수는 이 파일에 그대로 베껴 두고(오라클) 여러 입력에서 펜 호출 · 기록 · 범위가 같은지 견준다.
//  - paintPoints: 눈금 24칸 띠를 (거점, 반경)마다 한 번 계산, 스캔선 조각은 하나를 고쳐 쓴다
//  - paintExits: 셰브론 · 상태등 · 띠 · 게이지 칸 · 빛 번짐을 (탈출구, 반경)마다 한 번 계산, 미닫이 틈은 고쳐 쓴다
//  - pointPaintBounds · exitPaintBounds: (자리, 반경)마다 한 번 계산해 같은 객체
//  - PenRecord.replay: 다각형을 꼭짓점 객체로 되살리지 않고 평평한 배열로 넘긴다(fillPolyFlat)
//  - LightRecord: 명령 객체를 주기마다 고쳐 쓴다 (두 묶음 맞바꾸기)
//  - countGraphicsCmds: 컨테이너마다 결과 객체를 만들지 않는다
import { describe, expect, it } from 'vitest';
import {
  CAPTURE_POINTS,
  EXITS,
  type Balance,
  type ExitId,
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
  type TileRect,
} from '../../client/src/art/mapArtGeom';
import {
  CanvasPen,
  LightMap,
  LightRecord,
  PenRecord,
  countGraphicsCmds,
  exitArcRange,
  exitPaintBounds,
  exitSlide,
  litTicks,
  paintExits,
  paintPoints,
  pointPaintBounds,
  resetExitTracking,
  rgba,
  trackExit,
  type FogPen,
  type LightCtx,
  type SoftLight,
} from '../../client/src/render/fogPaint';
import { loadTestBalance } from '../helpers/fixtures';

const b = loadTestBalance();

/** 시드 난수 (mulberry32) */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let x = s;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function withRadii(point: number, exit: number): Balance {
  return {
    ...b,
    capturePoint: { ...b.capturePoint, radius: point },
    exit: { ...b.exit, radius: exit },
  };
}

// ───────────── 오라클: 렌더링 최적화 2 전의 fogPaint.ts 그대로 ─────────────

const TOP = -Math.PI / 2;
const TAU = Math.PI * 2;

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function arcQuad(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number): Vec2[] {
  return [
    { x: cx + Math.cos(a0) * r0, y: cy + Math.sin(a0) * r0 },
    { x: cx + Math.cos(a0) * r1, y: cy + Math.sin(a0) * r1 },
    { x: cx + Math.cos(a1) * r1, y: cy + Math.sin(a1) * r1 },
    { x: cx + Math.cos(a1) * r0, y: cy + Math.sin(a1) * r0 },
  ];
}

function oldPaintPoints(pen: FogPen, points: readonly PointView[], balance: Balance, now: number): void {
  const r = balance.capturePoint.radius;
  const C = OBJ_COLOR;
  for (const p of points) {
    const { x: cx, y: cy } = CAPTURE_POINTS[p.id];
    const st = p.state;
    const done = st === 'done';
    const accent = st === 'blocked' ? C.warn : C.neon;
    pen.fillCircle(cx, cy, r, C.pad, done ? 0.2 : 0.11);
    pen.fillCircle(cx, cy, r * 0.74, C.pad, 0.06);
    pen.fillCircle(cx, cy, r * 0.46, C.pad, 0.06);
    pen.strokeCircle(cx, cy, r - OBJ.tickIn - 0.12, 1, C.neonDim, 0.55);
    pen.strokeCircle(cx, cy, r, 6, C.neon, 0.07);
    pen.strokeCircle(cx, cy, r, 2, done ? C.neon : C.ring, 0.95);
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

const EXIT_SPILL_R = 1.35;
const PAINT_PAD = 0.2;

function oldPaintExits(
  pen: FogPen,
  exits: readonly ExitView[],
  balance: Balance,
  now: number,
  real: number,
): void {
  const r = balance.exit.radius;
  const C = OBJ_COLOR;
  for (const e of exits) {
    const def = EXITS[e.id];
    const D = def.door;
    const north = D.y0 === 0;
    const cx = (D.x0 + D.x1) / 2;
    const on = e.state !== 'inactive';
    trackExit(e.id, e.state, now, real);
    const color = on ? C.go : C.off;
    const [a0, a1] = exitArcRange(e.id, r);
    pen.strokeArc(def.center.x, def.center.y, r, 0, a0, a1, 2, color, on ? 0.75 : 0.45);
    const chev = exitChevrons(e.id);
    if (on) {
      chev.forEach((poly, n) => {
        const phase =
          e.state === 'open' ? 0 : (((now / OBJ.chaseMs - (chev.length - 1 - n) / chev.length) % 1) + 1) % 1;
        pen.fillPoly(poly, C.go, e.state === 'open' ? 0.9 : 0.35 + 0.6 * (1 - phase));
      });
    }
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
      const t = exitSlide(e.id, now, real);
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
      const sr = EXIT_SPILL_R;
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

function padRect(xs: readonly number[], ys: readonly number[]): TileRect {
  return {
    x0: Math.min(...xs) - PAINT_PAD,
    y0: Math.min(...ys) - PAINT_PAD,
    x1: Math.max(...xs) + PAINT_PAD,
    y1: Math.max(...ys) + PAINT_PAD,
  };
}

function oldPointPaintBounds(id: PointId, r: number): TileRect {
  const c = CAPTURE_POINTS[id];
  return padRect([c.x - r, c.x + r], [c.y - r, c.y + r]);
}

function oldExitPaintBounds(id: ExitId, r: number): TileRect {
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
  return padRect(xs, ys);
}

/** 예전 PenRecord.replay: 다각형마다 꼭짓점 객체 배열을 만들어 fillPoly로 넘겼다 */
function oldReplay(ops: readonly number[], pen: FogPen): void {
  const o = ops;
  const at = (i: number): number => o[i] ?? 0;
  let i = 0;
  while (i < o.length) {
    const op = at(i);
    if (op === 0) {
      pen.fillCircle(at(i + 1), at(i + 2), at(i + 3), at(i + 4), at(i + 5));
      i += 6;
    } else if (op === 1) {
      pen.strokeCircle(at(i + 1), at(i + 2), at(i + 3), at(i + 4), at(i + 5), at(i + 6));
      i += 7;
    } else if (op === 2) {
      pen.strokeArc(
        at(i + 1),
        at(i + 2),
        at(i + 3),
        at(i + 4),
        at(i + 5),
        at(i + 6),
        at(i + 7),
        at(i + 8),
        at(i + 9),
      );
      i += 10;
    } else if (op === 3) {
      const n = at(i + 1);
      const poly: Vec2[] = [];
      for (let k = 0; k < n; k += 1) poly.push({ x: at(i + 2 + k * 2), y: at(i + 3 + k * 2) });
      pen.fillPoly(poly, at(i + 2 + n * 2), at(i + 3 + n * 2));
      i += 4 + n * 2;
    } else {
      pen.line(at(i + 1), at(i + 2), at(i + 3), at(i + 4), at(i + 5), at(i + 6), at(i + 7));
      i += 8;
    }
  }
}

interface OldLightOp {
  poly: readonly Vec2[];
  cx: number;
  cy: number;
  radius: number;
  soft: number;
}

function oldSamePoly(a: readonly Vec2[], c: readonly Vec2[]): boolean {
  if (a === c) return true;
  if (a.length !== c.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const p = a[i];
    const q = c[i];
    if (!p || !q || p.x !== q.x || p.y !== q.y) return false;
  }
  return true;
}

function oldSameNum(a: number, c: number): boolean {
  return a === c || (Number.isNaN(a) && Number.isNaN(c));
}

/** 예전 LightRecord: 주기마다 새 배열 · 새 명령 객체 */
class OldLightRecord {
  private ops: OldLightOp[] = [];
  private painted: OldLightOp[] | null = null;
  reset(): void {
    this.ops = [];
  }
  addSoft(light: SoftLight): void {
    if (light.poly.length < 3) return;
    this.ops.push({
      poly: light.poly,
      cx: light.center.x,
      cy: light.center.y,
      radius: light.radius,
      soft: light.soft,
    });
  }
  addHard(poly: readonly Vec2[]): void {
    if (poly.length < 3) return;
    this.ops.push({ poly, cx: NaN, cy: NaN, radius: NaN, soft: NaN });
  }
  get unchanged(): boolean {
    const a = this.ops;
    const c = this.painted;
    if (!c || a.length !== c.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      const p = a[i];
      const q = c[i];
      if (!p || !q) return false;
      if (
        !oldSameNum(p.cx, q.cx) ||
        !oldSameNum(p.cy, q.cy) ||
        !oldSameNum(p.radius, q.radius) ||
        !oldSameNum(p.soft, q.soft)
      )
        return false;
      if (!oldSamePoly(p.poly, q.poly)) return false;
    }
    return true;
  }
  paint<C extends { readonly width: number; readonly height: number }>(light: LightMap<C>): boolean {
    if (this.unchanged) return false;
    light.clear();
    for (const op of this.ops) {
      if (Number.isNaN(op.radius)) light.addHard(op.poly);
      else light.addSoft({ poly: op.poly, center: { x: op.cx, y: op.cy }, radius: op.radius, soft: op.soft });
    }
    this.painted = this.ops;
    return true;
  }
}

function oldCountGraphicsCmds(list: readonly unknown[]): { objects: number; cmds: number } {
  let objects = 0;
  let cmds = 0;
  for (const o of list) {
    const n = typeof o === 'object' && o !== null ? (o as { list?: unknown; commandBuffer?: unknown }) : null;
    if (!n) continue;
    objects += 1;
    if (Array.isArray(n.commandBuffer)) cmds += n.commandBuffer.length;
    if (Array.isArray(n.list)) {
      const sub = oldCountGraphicsCmds(n.list);
      objects += sub.objects;
      cmds += sub.cmds;
    }
  }
  return { objects, cmds };
}

// ───────────── 시험 도구 ─────────────

/** 호출을 그대로 받아 적는 펜 (평평한 다각형도 fillPoly와 같은 기록) */
class LogPen implements FogPen {
  readonly calls: unknown[][] = [];
  fillCircle(...a: number[]): void {
    this.calls.push(['fillCircle', ...a]);
  }
  strokeCircle(...a: number[]): void {
    this.calls.push(['strokeCircle', ...a]);
  }
  strokeArc(...a: number[]): void {
    this.calls.push(['strokeArc', ...a]);
  }
  fillPoly(poly: readonly Vec2[], color: number, alpha: number): void {
    this.calls.push(['fillPoly', poly.map((p) => [p.x, p.y]), color, alpha]);
  }
  fillPolyFlat(xy: readonly number[], start: number, n: number, color: number, alpha: number): void {
    const pts: number[][] = [];
    for (let i = 0; i < n; i += 1) pts.push([xy[start + i * 2] ?? NaN, xy[start + i * 2 + 1] ?? NaN]);
    this.calls.push(['fillPoly', pts, color, alpha]);
  }
  line(...a: number[]): void {
    this.calls.push(['line', ...a]);
  }
}

/** 2D 컨텍스트 호출 기록기 (경로 · 채우기 · 합성 방식 · 그라디언트) */
class CtxLog {
  readonly calls: unknown[][] = [];
  private state: Record<string, unknown> = {};
  readonly ctx: CanvasRenderingContext2D & LightCtx;

  constructor() {
    const calls = this.calls;
    const state = this.state;
    this.ctx = new Proxy(state, {
      get: (t, k) => {
        if (typeof k !== 'string') return undefined;
        if (k in t) return t[k];
        return (...args: unknown[]) => {
          calls.push([k, ...args]);
          if (k === 'createRadialGradient') {
            const id = calls.length;
            return {
              addColorStop: (o: number, c: string) => calls.push(['addColorStop', id, o, c]),
              toString: () => `gradient#${id}`,
            };
          }
          return undefined;
        };
      },
      set: (t, k, v) => {
        // 설정값은 문자열로 남긴다 (그라디언트는 만든 순서 번호)
        calls.push([`set:${String(k)}`, String(v)]);
        t[String(k)] = v;
        return true;
      },
    }) as unknown as CanvasRenderingContext2D & LightCtx;
  }
}

function makeLight(log: CtxLog): LightMap<{ width: number; height: number }> {
  return new LightMap(16, '#101418', (width, height) => ({ canvas: { width, height }, ctx: log.ctx }));
}

const STATES: PointView['state'][] = ['idle', 'capturing', 'blocked', 'done'];
const EXIT_STATES: ExitView['state'][] = ['inactive', 'active', 'open'];

// ───────────── 시험 ─────────────

describe('paintPoints: 미리 계산한 눈금 띠 · 고쳐 쓰는 스캔 조각이 예전과 같은 펜 호출', () => {
  it('거점 A · B × 상태 넷 × 진행(범위 밖 포함) × 시각(음수 포함) × 반경 여러 개 (반경을 오가며 캐시가 바뀌는 경우 포함)', () => {
    const rand = rng(7);
    const radii = [b.capturePoint.radius, 2, 3.25, b.capturePoint.radius, 1.5];
    let cases = 0;
    for (const radius of radii) {
      const bal = withRadii(radius, b.exit.radius);
      for (let k = 0; k < 120; k += 1) {
        const points: PointView[] = (['A', 'B'] as const).map((id) => ({
          id,
          state: STATES[Math.floor(rand() * STATES.length)] ?? 'idle',
          progress: k % 10 === 0 ? ([0, 1, -0.2, 1.3, 0.5][k % 5] ?? 0) : rand(),
        }));
        const now = k % 7 === 0 ? -rand() * 5000 : rand() * 100000;
        const a = new LogPen();
        const c = new LogPen();
        oldPaintPoints(a, points, bal, now);
        paintPoints(c, points, bal, now);
        expect(c.calls).toEqual(a.calls);
        // 한 개짜리 목록으로 나눠 그려도 같다 (GPU 합성은 조각마다 하나씩 그린다)
        const d = new LogPen();
        for (const p of points) paintPoints(d, [p], bal, now);
        expect(d.calls).toEqual(a.calls);
        cases += 1;
      }
    }
    expect(cases).toBe(600);
  });

  it('기록 펜에 그린 수가 예전과 비트까지 같다 (Object.is: −0 · NaN 포함)', () => {
    const rand = rng(11);
    for (let k = 0; k < 200; k += 1) {
      const points: PointView[] = [
        { id: k % 2 === 0 ? 'A' : 'B', state: STATES[k % 4] ?? 'idle', progress: rand() * 1.2 - 0.1 },
      ];
      const now = rand() * 50000 - 1000;
      const a = new PenRecord();
      const c = new PenRecord();
      oldPaintPoints(a, points, b, now);
      paintPoints(c, points, b, now);
      expect(c.ops.length).toBe(a.ops.length);
      for (let i = 0; i < a.ops.length; i += 1) expect(Object.is(c.ops[i], a.ops[i])).toBe(true);
    }
  });
});

describe('paintExits: 미리 계산한 문 도형 · 고쳐 쓰는 미닫이 틈이 예전과 같은 펜 호출', () => {
  /** 같은 상태 변화 순서를 두 함수에 따로 돌린다 (미닫이 기록은 모듈 상태라 처음부터 다시) */
  function run(
    paint: typeof oldPaintExits,
    seq: { exits: ExitView[]; now: number; real: number; bal: Balance }[],
  ) {
    resetExitTracking();
    const pen = new LogPen();
    for (const s of seq) paint(pen, s.exits, s.bal, s.now, s.real);
    resetExitTracking();
    return pen.calls;
  }

  it('N · S × 비활성 · 활성(진행 null · 0 · 소수 · 1 · 범위 밖) · 열림(처음 본 열림 · 미닫이 중 · 멈춘 시계) × 반경 여러 개', () => {
    const rand = rng(23);
    const seq: { exits: ExitView[]; now: number; real: number; bal: Balance }[] = [];
    let now = 1000;
    let real = 1000;
    const radii = [b.exit.radius, 1.5, 2.75, b.exit.radius];
    for (let k = 0; k < 400; k += 1) {
      const bal = withRadii(b.capturePoint.radius, radii[Math.floor(k / 100)] ?? b.exit.radius);
      // 상태는 대체로 이어지게(열리는 순간 · 미닫이 중 포함), 가끔 무작위로
      const st = (i: number): ExitView['state'] =>
        k < 60 ? 'inactive' : k < 160 ? 'active' : k < 300 ? 'open' : (EXIT_STATES[(k + i) % 3] ?? 'open');
      const progress = (): number | null => {
        const v = rand();
        return v < 0.2 ? null : v < 0.3 ? 0 : v < 0.35 ? 1 : v < 0.4 ? 1.4 : v < 0.45 ? -0.1 : rand();
      };
      const exits: ExitView[] = (['N', 'S'] as const).map((id, i) => ({
        id,
        state: st(i),
        progress: progress(),
      }));
      // 장식 시계가 멈춘 구간(디버그 freezeClock)도 섞는다
      const frozen = k >= 220 && k < 250;
      now += frozen ? 0 : 16 + rand() * 40;
      real += 16 + rand() * 40;
      seq.push({ exits: k % 3 === 0 ? exits : exits.slice(0, 1), now, real, bal });
    }
    const a = run(oldPaintExits, seq);
    const c = run(paintExits, seq);
    expect(a.length).toBeGreaterThan(5000);
    expect(c).toEqual(a);
  });

  it('기록 펜에 그린 수가 예전과 비트까지 같다', () => {
    const rand = rng(5);
    for (const state of EXIT_STATES)
      for (let k = 0; k < 60; k += 1) {
        const exits: ExitView[] = [
          { id: k % 2 === 0 ? 'N' : 'S', state, progress: state === 'active' ? rand() : null },
        ];
        const now = 5000 + k * 37;
        resetExitTracking();
        trackExit(exits[0]!.id, 'active', now - 200, now - 200);
        const a = new PenRecord();
        oldPaintExits(a, exits, b, now, now);
        resetExitTracking();
        trackExit(exits[0]!.id, 'active', now - 200, now - 200);
        const c = new PenRecord();
        paintExits(c, exits, b, now, now);
        expect(c.ops.length).toBe(a.ops.length);
        for (let i = 0; i < a.ops.length; i += 1) expect(Object.is(c.ops[i], a.ops[i])).toBe(true);
      }
    resetExitTracking();
  });
});

describe('조각 범위: (자리, 반경)마다 한 번 계산해 같은 객체를 돌려준다', () => {
  it('거점 · 탈출구 범위가 예전 계산과 같고, 같은 반경이면 같은 객체, 반경이 바뀌면 새 값', () => {
    const rand = rng(3);
    const radii = [b.capturePoint.radius, b.exit.radius, 1, 2.5, 3.75];
    for (let k = 0; k < 50; k += 1) radii.push(0.5 + rand() * 4);
    for (const r of radii) {
      for (const id of ['A', 'B'] as const) {
        const box = pointPaintBounds(id, r);
        expect(box).toEqual(oldPointPaintBounds(id, r));
        expect(pointPaintBounds(id, r)).toBe(box);
      }
      for (const id of ['N', 'S'] as const) {
        const box = exitPaintBounds(id, r);
        expect(box).toEqual(oldExitPaintBounds(id, r));
        expect(exitPaintBounds(id, r)).toBe(box);
      }
    }
  });
});

describe('PenRecord.replay: 평평한 다각형 (꼭짓점 객체를 다시 만들지 않는다)', () => {
  /** 무작위 기록 (다섯 명령 모두, 다각형 꼭짓점 3~20개) */
  function randomRecord(rand: () => number, n: number): PenRecord {
    const rec = new PenRecord();
    for (let k = 0; k < n; k += 1) {
      const v = (): number => (rand() - 0.5) * 100;
      const op = Math.floor(rand() * 5);
      if (op === 0) rec.fillCircle(v(), v(), rand() * 5, Math.floor(rand() * 0xffffff), rand());
      else if (op === 1)
        rec.strokeCircle(v(), v(), rand() * 5, rand() * 6, Math.floor(rand() * 0xffffff), rand());
      else if (op === 2)
        rec.strokeArc(v(), v(), rand() * 5, rand() * 3, v(), v(), rand() * 4, 0x22c55e, rand());
      else if (op === 3) {
        const poly: Vec2[] = [];
        const m = 3 + Math.floor(rand() * 18);
        for (let i = 0; i < m; i += 1) poly.push({ x: v(), y: v() });
        rec.fillPoly(poly, Math.floor(rand() * 0xffffff), rand());
      } else rec.line(v(), v(), v(), v(), rand() * 4, 0xffffff, rand());
    }
    return rec;
  }

  it('다른 펜에 재생: 예전 재생(꼭짓점 객체 → fillPoly)과 같은 호출 · 같은 순서', () => {
    const rand = rng(99);
    for (let k = 0; k < 100; k += 1) {
      const rec = randomRecord(rand, 1 + Math.floor(rand() * 40));
      const a = new LogPen();
      const c = new LogPen();
      oldReplay(rec.ops, a);
      rec.replay(c);
      expect(c.calls).toEqual(a.calls);
    }
  });

  it('기록 펜에 재생 · 덧붙이기: 예전 재생과 같은 수 (기존 기록 뒤에 이어 붙는다)', () => {
    const rand = rng(17);
    for (let k = 0; k < 60; k += 1) {
      const rec = randomRecord(rand, 1 + Math.floor(rand() * 30));
      const head = randomRecord(rand, 3);
      const a = new PenRecord();
      oldReplay(head.ops, a);
      oldReplay(rec.ops, a);
      const c = new PenRecord();
      head.replay(c);
      rec.replay(c);
      expect(c.ops).toEqual(a.ops);
      const d = new PenRecord();
      d.append(head);
      d.append(rec);
      expect(d.ops).toEqual(a.ops);
    }
  });

  it('캔버스 펜 fillPolyFlat = fillPoly (같은 2D 호출: 경로 × k, 색)', () => {
    const rand = rng(41);
    for (let k = 0; k < 50; k += 1) {
      const poly: Vec2[] = [];
      const m = 3 + Math.floor(rand() * 30);
      for (let i = 0; i < m; i += 1) poly.push({ x: rand() * 48, y: rand() * 32 });
      const color = Math.floor(rand() * 0xffffff);
      const alpha = rand();
      const scale = 1 + rand() * 60;
      const a = new CtxLog();
      new CanvasPen(a.ctx, scale, 1.5).fillPoly(poly, color, alpha);
      const flat = [7, 7, ...poly.flatMap((p) => [p.x, p.y]), 9];
      const c = new CtxLog();
      new CanvasPen(c.ctx, scale, 1.5).fillPolyFlat(flat, 2, m, color, alpha);
      expect(c.calls).toEqual(a.calls);
    }
    // 꼭짓점 2개 이하는 그리지 않는다 (fillPoly와 같다)
    const e = new CtxLog();
    new CanvasPen(e.ctx, 10, 1).fillPolyFlat([1, 2, 3, 4], 0, 2, 0, 1);
    expect(e.calls).toEqual([]);
  });
});

describe('PenRecord 버퍼: 비울 때 버퍼를 놓지 않아도(길이 대신 개수) 예전 기록과 같은 수 · 같은 판단', () => {
  /** 예전 PenRecord: push로 쌓고 비울 때 길이를 0으로 (V8이 버퍼를 놓는다) */
  class OldPenRecord {
    readonly ops: number[] = [];
    reset(): void {
      this.ops.length = 0;
    }
    fillCircle(x: number, y: number, r: number, color: number, alpha: number): void {
      this.ops.push(0, x, y, r, color, alpha);
    }
    strokeCircle(x: number, y: number, r: number, width: number, color: number, alpha: number): void {
      this.ops.push(1, x, y, r, width, color, alpha);
    }
    strokeArc(
      x: number,
      y: number,
      r: number,
      i: number,
      f: number,
      t: number,
      w: number,
      c: number,
      a: number,
    ): void {
      this.ops.push(2, x, y, r, i, f, t, w, c, a);
    }
    fillPoly(poly: readonly Vec2[], color: number, alpha: number): void {
      if (poly.length < 3) return;
      this.ops.push(3, poly.length);
      for (const p of poly) this.ops.push(p.x, p.y);
      this.ops.push(color, alpha);
    }
    line(x0: number, y0: number, x1: number, y1: number, width: number, color: number, alpha: number): void {
      this.ops.push(4, x0, y0, x1, y1, width, color, alpha);
    }
    sameAs(ops: readonly number[]): boolean {
      const a = this.ops;
      if (a.length !== ops.length) return false;
      for (let i = 0; i < a.length; i += 1) if (a[i] !== ops[i]) return false;
      return true;
    }
  }

  it('주기마다 길이가 오르내리는 기록 (긴 기록 뒤 짧은 기록 · 빈 기록 · 같은 기록): 수 · sameAs · same · 덧붙이기가 예전과 같다', () => {
    const rand = rng(77);
    const nu = new PenRecord();
    const old = new OldPenRecord();
    const prevNu = new PenRecord();
    let prevOld: number[] = [];
    const mini = new PenRecord();
    const miniOld: number[] = [];
    for (let cycle = 0; cycle < 300; cycle += 1) {
      nu.reset();
      old.reset();
      const same = cycle > 0 && rand() < 0.3;
      const count = same ? -1 : Math.floor(rand() * 40);
      if (same) {
        // 지난 기록을 그대로 다시 (새 기록 = 재생, 예전 기록 = 같은 수를 다시 쌓기)
        prevNu.replay(nu);
        old.ops.push(...prevOld);
      } else {
        for (let k = 0; k < count; k += 1) {
          const v = (): number => Math.round((rand() - 0.5) * 1000) / 10;
          const op = Math.floor(rand() * 5);
          if (op === 0) {
            const a = [v(), v(), v(), 0xff, rand()] as const;
            nu.fillCircle(...a);
            old.fillCircle(...a);
          } else if (op === 1) {
            const a = [v(), v(), v(), 2, 0xff, rand()] as const;
            nu.strokeCircle(...a);
            old.strokeCircle(...a);
          } else if (op === 2) {
            const a = [v(), v(), v(), 1, v(), v(), 3, 0xff, rand()] as const;
            nu.strokeArc(...a);
            old.strokeArc(...a);
          } else if (op === 3) {
            const poly: Vec2[] = [];
            const m = Math.floor(rand() * 30);
            for (let i = 0; i < m; i += 1) poly.push({ x: v(), y: v() });
            const alpha = rand();
            nu.fillPoly(poly, 0xaa, alpha);
            old.fillPoly(poly, 0xaa, alpha);
          } else {
            const a = [v(), v(), v(), v(), 2, 0xff, rand()] as const;
            nu.line(...a);
            old.line(...a);
          }
        }
      }
      expect(nu.ops).toEqual(old.ops);
      expect(nu.size).toBe(old.ops.length);
      expect(nu.sameAs(prevOld)).toBe(old.sameAs(prevOld));
      expect(nu.same(prevNu)).toBe(old.sameAs(prevOld));
      // 미니맵 기록처럼 여러 기록을 이어 붙인다 (가끔 비운다)
      if (cycle % 5 === 0) {
        mini.reset();
        miniOld.length = 0;
      }
      mini.append(nu);
      miniOld.push(...old.ops);
      expect(mini.ops).toEqual(miniOld);
      prevNu.reset();
      prevNu.append(nu);
      prevOld = old.ops.slice();
    }
  });
});

describe('LightRecord: 명령 객체를 고쳐 쓰는 기록이 예전과 같은 판단 · 같은 칠하기', () => {
  it('무작위 주기 (가만히 · 움직임 · 같은 값 다른 참조 · 개수 변화 · 부드러운/딱 잘린 시야): 바뀜 판단과 빛 지도 호출이 같다', () => {
    const rand = rng(2026);
    const polys: Vec2[][] = [];
    for (let i = 0; i < 6; i += 1) {
      const p: Vec2[] = [];
      for (let k = 0; k < 8; k += 1) p.push({ x: 10 + i * 3 + Math.cos(k) * 2, y: 10 + Math.sin(k) * 2 });
      polys.push(p);
    }
    const copy = (p: Vec2[]): Vec2[] => p.map((q) => ({ ...q }));
    const la = new CtxLog();
    const lc = new CtxLog();
    const ma = makeLight(la);
    const mc = makeLight(lc);
    const ra = new OldLightRecord();
    const rc = new LightRecord();
    let last: { kind: 'soft' | 'hard'; poly: Vec2[]; cx: number; cy: number; r: number; soft: number }[] = [];
    let changes = 0;
    for (let cycle = 0; cycle < 400; cycle += 1) {
      const v = rand();
      let ops = last;
      if (cycle === 0 || v < 0.25) {
        // 새로 만든 명령 (개수 1~4)
        const n = 1 + Math.floor(rand() * 4);
        ops = [];
        for (let i = 0; i < n; i += 1) {
          const poly = polys[Math.floor(rand() * polys.length)] ?? [];
          ops.push({
            kind: rand() < 0.6 ? 'soft' : 'hard',
            poly,
            cx: Math.floor(rand() * 4),
            cy: 3,
            r: 6.5,
            soft: rand() < 0.5 ? 1.2 : 0,
          });
        }
      } else if (v < 0.4) {
        // 같은 값, 다른 참조 (바뀌지 않은 것으로 본다)
        ops = last.map((o) => ({ ...o, poly: copy(o.poly) }));
      } else if (v < 0.5 && last.length > 0) {
        // 한 개만 움직임
        ops = last.map((o, i) => (i === 0 ? { ...o, cx: o.cx + 0.25 } : o));
      }
      last = ops;
      ra.reset();
      rc.reset();
      for (const o of ops) {
        if (o.kind === 'soft') {
          const light = { poly: o.poly, center: { x: o.cx, y: o.cy }, radius: o.r, soft: o.soft };
          ra.addSoft(light);
          rc.addSoft(light);
        } else {
          ra.addHard(o.poly);
          rc.addHard(o.poly);
        }
      }
      // 꼭짓점 2개 이하는 넣지 않는다
      if (cycle % 37 === 0) {
        ra.addHard([{ x: 0, y: 0 }]);
        rc.addHard([{ x: 0, y: 0 }]);
      }
      expect(rc.unchanged).toBe(ra.unchanged);
      const pa = ra.paint(ma);
      const pc = rc.paint(mc);
      expect(pc).toBe(pa);
      if (pa) changes += 1;
      // 칠한 직후에는 바뀌지 않은 것으로 본다 (예전: 칠한 기록 = 이번 기록)
      expect(rc.unchanged).toBe(ra.unchanged);
      expect(rc.paint(mc)).toBe(ra.paint(ma));
    }
    expect(lc.calls).toEqual(la.calls);
    expect(changes).toBeGreaterThan(50);
    expect(changes).toBeLessThan(400);
  });
});

describe('rgba: 최근 값 캐시가 있어도 예전 식과 같은 문자열', () => {
  const oldRgba = (color: number, alpha: number): string =>
    `rgba(${(color >> 16) & 255}, ${(color >> 8) & 255}, ${color & 255}, ${alpha})`;

  it('무작위 · 되풀이 · 해시 충돌 · −0 · NaN · 아주 작은 알파 · 1 넘는 알파', () => {
    const rand = rng(31);
    const colors = [0, 0xffffff, 0x22d3ee, 0x1b3240, 0xf59e0b, 0x0b4a5a];
    for (let k = 0; k < 20; k += 1) colors.push(Math.floor(rand() * 0x1000000));
    const alphas = [0, -0, 1, 0.11, 0.06, 0.55, 0.95, 1e-7, 1.5, NaN, 0.1 + 0.2];
    for (let k = 0; k < 40; k += 1) alphas.push(rand());
    for (let round = 0; round < 3; round += 1)
      for (let i = 0; i < 4000; i += 1) {
        const c = colors[Math.floor(rand() * colors.length)] ?? 0;
        const a = alphas[Math.floor(rand() * alphas.length)] ?? 0;
        expect(rgba(c, a)).toBe(oldRgba(c, a));
      }
    // 같은 칸에 번갈아 들어오는 값 (캐시가 덮어써져도 틀리지 않는다)
    for (let i = 0; i < 1000; i += 1) {
      const a = (i % 7) / 7;
      expect(rgba(0x22d3ee, a)).toBe(oldRgba(0x22d3ee, a));
      expect(rgba(0x22d3ee ^ (i * 2048), a)).toBe(oldRgba(0x22d3ee ^ (i * 2048), a));
    }
  });
});

describe('countGraphicsCmds: 결과 객체를 한 번만 만들어도 같은 수', () => {
  it('중첩 컨테이너 · Graphics · 그 밖의 값이 섞인 목록', () => {
    const rand = rng(8);
    const make = (depth: number): unknown[] => {
      const list: unknown[] = [];
      const n = Math.floor(rand() * 6);
      for (let i = 0; i < n; i += 1) {
        const v = rand();
        if (v < 0.2 && depth < 4) list.push({ list: make(depth + 1) });
        else if (v < 0.5) list.push({ commandBuffer: new Array(Math.floor(rand() * 30)).fill(0) });
        else if (v < 0.6) list.push(null);
        else if (v < 0.7) list.push(42);
        else list.push({ name: 'img' });
      }
      return list;
    };
    for (let k = 0; k < 200; k += 1) {
      const list = make(0);
      expect(countGraphicsCmds(list)).toEqual(oldCountGraphicsCmds(list));
    }
  });
});

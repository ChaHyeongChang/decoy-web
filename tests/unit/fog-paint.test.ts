// 빛 지도가 실제로 칠하는 값 (fogPaint.ts LightMap): 기록용 가짜 2D 컨텍스트를 주입해 경로 · 그라디언트 반지름 ·
// 색 정지점 · 합성 모드를 그대로 받아 적고, 그 기록을 다시 계산(재생)해 '밝게 그린 곳 ⊆ 판정 영역'을 확인한다.
// fog-math.test.ts가 수식(모델)을 본다면 여기는 렌더러가 쓰는 코드 자체를 본다.
// 아래쪽은 캔버스 텍스처를 getImageData 사본 없이 올리는 도우미와 텍스처 바이트 기록.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MAP_H,
  MAP_W,
  blocksVision,
  inCircleVision,
  monsterConePolygon,
  monsterNearPolygon,
  monsterSees,
  pointInPolygon,
  survivorVisionPolygon,
  survivorVisionRadius,
  type RoleId,
  type Vec2,
} from '@decoy/shared';
import { gfxState } from '../../client/src/gfx/state';
import { FOG } from '../../client/src/render/colors';
import { ambientRgb, rgbCss, survivorLight } from '../../client/src/render/fogMath';
import {
  LightMap,
  createCanvasTexture,
  removeCanvasTexture,
  resizeCanvasTexture,
  uploadCanvasTexture,
  type CanvasTextureHost,
  type CanvasTextureLike,
  type LightCtx,
  type LightSurface,
} from '../../client/src/render/fogPaint';
import { loadTestBalance } from '../helpers/fixtures';

const b = loadTestBalance();
const AMB = FOG.ambient;
const AMB_CSS = rgbCss(ambientRgb(FOG.ambient, FOG.tint));
const WHITE = '#ffffff';

// ───────────── 기록용 가짜 컨텍스트 ─────────────

interface RadialRec {
  kind: 'radial';
  x0: number;
  y0: number;
  r0: number;
  x1: number;
  y1: number;
  r1: number;
  stops: [offset: number, color: string][];
}
type StyleRec = { kind: 'color'; css: string } | RadialRec;
interface FillRec {
  op: GlobalCompositeOperation;
  style: StyleRec;
  /** 칠한 경로 (캔버스 px) */
  path: Vec2[];
}
interface RectRec {
  op: GlobalCompositeOperation;
  css: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

class RecordingCtx implements LightCtx {
  globalCompositeOperation: GlobalCompositeOperation = 'source-over';
  fillStyle: string | CanvasGradient | CanvasPattern = '#000000';
  readonly fills: FillRec[] = [];
  readonly rects: RectRec[] = [];
  private path: Vec2[] = [];
  private readonly stack: { op: GlobalCompositeOperation; style: string | CanvasGradient | CanvasPattern }[] =
    [];
  private readonly gradients = new Map<CanvasGradient, RadialRec>();

  save(): void {
    this.stack.push({ op: this.globalCompositeOperation, style: this.fillStyle });
  }
  restore(): void {
    const s = this.stack.pop();
    if (!s) return;
    this.globalCompositeOperation = s.op;
    this.fillStyle = s.style;
  }
  beginPath(): void {
    this.path = [];
  }
  moveTo(x: number, y: number): void {
    this.path.push({ x, y });
  }
  lineTo(x: number, y: number): void {
    this.path.push({ x, y });
  }
  closePath(): void {}
  fill(): void {
    this.fills.push({ op: this.globalCompositeOperation, style: this.style(), path: [...this.path] });
  }
  fillRect(x: number, y: number, w: number, h: number): void {
    const s = this.style();
    if (s.kind !== 'color') throw new Error('fillRect는 단색만 기록한다');
    this.rects.push({ op: this.globalCompositeOperation, css: s.css, x, y, w, h });
  }
  createRadialGradient(
    x0: number,
    y0: number,
    r0: number,
    x1: number,
    y1: number,
    r1: number,
  ): CanvasGradient {
    const rec: RadialRec = { kind: 'radial', x0, y0, r0, x1, y1, r1, stops: [] };
    const g: CanvasGradient = {
      addColorStop: (offset: number, color: string) => {
        rec.stops.push([offset, color]);
      },
    };
    this.gradients.set(g, rec);
    return g;
  }
  private style(): StyleRec {
    const f = this.fillStyle;
    if (typeof f === 'string') return { kind: 'color', css: f };
    const g = this.gradients.get(f as CanvasGradient);
    if (!g) throw new Error('기록하지 않은 채우기');
    return g;
  }
}

function recordingMap(k: number): { map: LightMap<{ width: number; height: number }>; ctx: RecordingCtx } {
  const ctx = new RecordingCtx();
  const surface = (width: number, height: number): LightSurface<{ width: number; height: number }> => ({
    canvas: { width, height },
    ctx,
  });
  return { map: new LightMap(k, AMB_CSS, surface), ctx };
}

/** 색 문자열 → 밝기 (흰색 1, 하한색 = 하한). 다른 색이 나오면 테스트가 실패한다 */
function cssLight(css: string): number {
  if (css === WHITE) return 1;
  if (css === AMB_CSS) return AMB;
  throw new Error(`예상하지 않은 색 ${css}`);
}

/** 기록을 다시 계산: 캔버스 px 점 q의 빛 값 (마지막 clear 바탕 + 'lighten' 채우기들의 최댓값) */
function replay(ctx: RecordingCtx, q: Vec2): number {
  const base = ctx.rects[ctx.rects.length - 1];
  if (!base) throw new Error('바탕을 칠하지 않았다');
  let v = cssLight(base.css);
  for (const f of ctx.fills) {
    if (f.op !== 'lighten') throw new Error(`합성 모드 ${f.op}`);
    if (!pointInPolygon(q, f.path)) continue;
    let x: number;
    if (f.style.kind === 'color') x = cssLight(f.style.css);
    else {
      const g = f.style;
      // 같은 중심의 두 원 (캔버스 규칙: 안쪽 원 안은 첫 정지점, 바깥 원 밖은 마지막 정지점)
      if (g.x0 !== g.x1 || g.y0 !== g.y1) throw new Error('중심이 다른 그라디언트');
      const d = Math.hypot(q.x - g.x0, q.y - g.y0);
      const t = Math.max(0, Math.min(1, (d - g.r0) / (g.r1 - g.r0)));
      const stops = [...g.stops].sort((a, c) => a[0] - c[0]);
      x = cssLight(stops[stops.length - 1]![1]);
      for (let i = 0; i < stops.length; i += 1) {
        const [o, c] = stops[i]!;
        if (t <= o) {
          if (i === 0) x = cssLight(c);
          else {
            const [o0, c0] = stops[i - 1]!;
            const u = o === o0 ? 1 : (t - o0) / (o - o0);
            x = cssLight(c0) + (cssLight(c) - cssLight(c0)) * u;
          }
          break;
        }
      }
    }
    if (x > v) v = x;
  }
  return v;
}

const scaled = (poly: readonly Vec2[], k: number): Vec2[] => poly.map((p) => ({ x: p.x * k, y: p.y * k }));

/** 재현 가능한 의사 난수 */
function rng(seed: number): () => number {
  let s = seed;
  return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
}

function openPoint(rnd: () => number): Vec2 {
  for (;;) {
    const p = { x: 1 + rnd() * (MAP_W - 2), y: 1 + rnd() * (MAP_H - 2) };
    if (!blocksVision(Math.floor(p.x), Math.floor(p.y))) return p;
  }
}

const ROLES: RoleId[] = ['runner', 'guard', 'scout'];

describe('빛 지도가 칠하는 값 (기록용 컨텍스트)', () => {
  it('캔버스 크기 = 맵 × 타일당 px, 바탕 = 하한색 전체 (source-over)', () => {
    for (const k of [8, 12, 16]) {
      const { map, ctx } = recordingMap(k);
      expect(map.canvas).toEqual({ width: MAP_W * k, height: MAP_H * k });
      expect(ctx.rects).toEqual([
        { op: 'source-over', css: AMB_CSS, x: 0, y: 0, w: MAP_W * k, h: MAP_H * k },
      ]);
      expect(ctx.fills).toEqual([]);
    }
  });

  it('부드러운 시야: 바깥 반지름 = r·k, 안쪽 = (r − soft)·k, 흰색 → 하한색, lighten, 경로 = 판정 다각형 × k', () => {
    const soft = b.survivor.visionSoftEdge;
    for (const k of [8, 12, 16]) {
      for (const role of ROLES) {
        const { map, ctx } = recordingMap(k);
        const eye = { x: 21.5, y: 25 };
        const r = survivorVisionRadius(b, role);
        const poly = survivorVisionPolygon(eye, r);
        map.addSoft({ poly, center: eye, radius: r, soft });
        expect(ctx.fills).toHaveLength(1);
        const f = ctx.fills[0]!;
        expect(f.op).toBe('lighten');
        expect(f.path).toEqual(scaled(poly, k));
        expect(f.style.kind).toBe('radial');
        const g = f.style as RadialRec;
        expect([g.x0, g.y0, g.x1, g.y1]).toEqual([eye.x * k, eye.y * k, eye.x * k, eye.y * k]);
        // 밝게 칠하는 띠의 바깥 끝은 판정 반경 그대로 (판정 반경 밖으로 흐림을 늘리면 여기서 걸린다)
        expect(g.r1).toBeCloseTo(r * k, 9);
        expect(g.r0).toBeCloseTo((r - soft) * k, 9);
        expect(g.stops[0]).toEqual([0, WHITE]);
        expect(g.stops[g.stops.length - 1]).toEqual([1, AMB_CSS]);
        // 칠한 뒤 합성 모드를 되돌린다 (다음 clear · 다른 그림에 번지지 않게)
        expect(ctx.globalCompositeOperation).toBe('source-over');
      }
    }
  });

  it('흐림 띠가 없으면(soft 0) 흰색 단색으로 딱 자른다 (같은 원 두 개 그라디언트는 아무것도 안 칠한다)', () => {
    const { map, ctx } = recordingMap(8);
    const eye = { x: 21.5, y: 25 };
    const poly = survivorVisionPolygon(eye, 6);
    map.addSoft({ poly, center: eye, radius: 6, soft: 0 });
    expect(ctx.fills).toEqual([
      { op: 'lighten', style: { kind: 'color', css: WHITE }, path: scaled(poly, 8) },
    ]);
  });

  it('딱 잘린 시야(괴물 부채꼴 · 근접 원): 흰색, lighten, 경로 = 판정 다각형 × k', () => {
    for (const k of [8, 16]) {
      const { map, ctx } = recordingMap(k);
      const eye = { x: 24, y: 20.5 };
      const cone = monsterConePolygon(b, eye, -Math.PI / 2, 0.5);
      const near = monsterNearPolygon(b, eye);
      map.addHard(near);
      map.addHard(cone);
      expect(ctx.fills).toEqual([
        { op: 'lighten', style: { kind: 'color', css: WHITE }, path: scaled(near, k) },
        { op: 'lighten', style: { kind: 'color', css: WHITE }, path: scaled(cone, k) },
      ]);
    }
  });

  it('다시 그리면 바탕부터 (clear 뒤 이전 채우기는 남지 않는 순서)', () => {
    const { map, ctx } = recordingMap(8);
    map.addHard(monsterNearPolygon(b, { x: 24, y: 20.5 }));
    map.clear();
    expect(ctx.rects).toHaveLength(2);
    expect(ctx.rects[1]).toEqual(ctx.rects[0]);
  });
});

describe('실제로 칠한 값으로: 밝게 그린 곳 ⊆ 판정 영역 (무작위 점 1만 개)', () => {
  it('생존자: 재생한 밝기가 하한보다 높으면 inCircleVision이 참이고, 수식(lightAt)과 같다', () => {
    const rnd = rng(20261008);
    const soft = b.survivor.visionSoftEdge;
    let checked = 0;
    let lit = 0;
    let violations = 0;
    for (let e = 0; e < 200; e += 1) {
      const k = [8, 12, 16][e % 3]!;
      const { map, ctx } = recordingMap(k);
      const eye = openPoint(rnd);
      const role = ROLES[e % 3]!;
      const r = survivorVisionRadius(b, role);
      const poly = survivorVisionPolygon(eye, r);
      map.addSoft({ poly, center: eye, radius: r, soft });
      for (let i = 0; i < 50; i += 1) {
        const p = { x: eye.x + (rnd() * 2 - 1) * (r + 1), y: eye.y + (rnd() * 2 - 1) * (r + 1) };
        checked += 1;
        const v = replay(ctx, { x: p.x * k, y: p.y * k });
        // 렌더러가 칠한 값 = 단위 테스트한 수식
        expect(v).toBeCloseTo(survivorLight(eye, r, soft, AMB, poly, p), 9);
        if (v > AMB + 1e-9) {
          lit += 1;
          if (!inCircleVision(eye, r, p)) violations += 1;
        }
      }
    }
    expect(checked).toBe(10_000);
    expect(lit).toBeGreaterThan(2_000);
    expect(violations).toBe(0);
  });

  it('괴물: 부채꼴 ∪ 근접 원을 칠한 곳이면 monsterSees가 참 (탐색 · 추적 · 전환 중)', () => {
    const rnd = rng(77);
    let checked = 0;
    let lit = 0;
    let violations = 0;
    for (let e = 0; e < 200; e += 1) {
      const k = [8, 12, 16][e % 3]!;
      const { map, ctx } = recordingMap(k);
      const eye = openPoint(rnd);
      const aim = (rnd() * 2 - 1) * Math.PI;
      const blend = [0, 1, 0.5, rnd()][e % 4] ?? 0;
      map.addHard(monsterNearPolygon(b, eye));
      map.addHard(monsterConePolygon(b, eye, aim, blend));
      for (let i = 0; i < 50; i += 1) {
        const p = { x: eye.x + (rnd() * 2 - 1) * 10, y: eye.y + (rnd() * 2 - 1) * 10 };
        checked += 1;
        const v = replay(ctx, { x: p.x * k, y: p.y * k });
        if (v > AMB) {
          lit += 1;
          if (!monsterSees(b, eye, aim, blend, p)) violations += 1;
        } else expect(v).toBe(AMB);
      }
    }
    expect(checked).toBe(10_000);
    expect(lit).toBeGreaterThan(300);
    expect(violations).toBe(0);
  });
});

// ───────────── 캔버스 텍스처 도우미 ─────────────

interface FakeCanvas {
  width: number;
  height: number;
}

class FakeTexture implements CanvasTextureLike {
  readonly frames = new Map<string, { x: number; y: number; w: number; h: number }>();
  readonly source: { width: number; height: number; isPowerOf2: boolean; update(): void; updates: number }[];
  constructor(w: number, h: number) {
    const src = {
      width: w,
      height: h,
      isPowerOf2: false,
      updates: 0,
      update(): void {
        src.updates += 1;
      },
    };
    this.source = [src];
  }
  add(name: string, _sourceIndex: number, x: number, y: number, width: number, height: number): unknown {
    this.frames.set(name, { x, y, w: width, h: height });
    return null;
  }
  get(name?: string): { setSize(width: number, height: number, x?: number, y?: number): unknown } {
    const f = this.frames.get(name ?? '__BASE');
    if (!f) throw new Error(`프레임 없음 ${name ?? ''}`);
    return {
      setSize: (width: number, height: number, x = 0, y = 0) => {
        Object.assign(f, { x, y, w: width, h: height });
      },
    };
  }
}

class FakeHost implements CanvasTextureHost<FakeCanvas, FakeTexture> {
  readonly list = new Map<string, FakeTexture>();
  readonly created: [key: string, w: number, h: number][] = [];
  exists(key: string): boolean {
    return this.list.has(key);
  }
  create(key: string, source: FakeCanvas, width: number, height: number): FakeTexture | null {
    if (this.list.has(key)) return null;
    this.created.push([key, width, height]);
    const t = new FakeTexture(source.width, source.height);
    this.list.set(key, t);
    return t;
  }
  remove(key: string): unknown {
    return this.list.delete(key);
  }
}

const bytes = (): number => Number(gfxState.features.textureBytes ?? 0);

describe('캔버스 텍스처를 사본 없이 올린다', () => {
  it('일반 텍스처 + 기본 프레임(__BASE), 바이트 = 폭 × 높이 × 4를 기록하고 지우면 뺀다', () => {
    const host = new FakeHost();
    const before = bytes();
    const canvas = { width: 300, height: 200 };
    const tex = createCanvasTexture(host, 'unit-a', canvas);
    expect(host.created).toEqual([['unit-a', 300, 200]]);
    expect(tex.frames.get('__BASE')).toEqual({ x: 0, y: 0, w: 300, h: 200 });
    expect(bytes() - before).toBe(300 * 200 * 4);
    const tex2 = createCanvasTexture(host, 'unit-b', { width: 10, height: 10 });
    expect(bytes() - before).toBe(300 * 200 * 4 + 400);
    uploadCanvasTexture(tex2);
    expect(tex2.source[0]!.updates).toBe(1);
    removeCanvasTexture(host, 'unit-a');
    expect(host.exists('unit-a')).toBe(false);
    expect(bytes() - before).toBe(400);
    removeCanvasTexture(host, 'unit-b');
    expect(bytes()).toBe(before);
  });

  it('같은 키로 다시 만들면 먼저 지운다 (Phaser가 키 중복 에러를 내지 않게, 바이트는 한 번만)', () => {
    const host = new FakeHost();
    const before = bytes();
    createCanvasTexture(host, 'unit-same', { width: 4, height: 4 });
    createCanvasTexture(host, 'unit-same', { width: 8, height: 8 });
    expect(host.created).toEqual([
      ['unit-same', 4, 4],
      ['unit-same', 8, 8],
    ]);
    expect(bytes() - before).toBe(8 * 8 * 4);
    removeCanvasTexture(host, 'unit-same');
    expect(bytes()).toBe(before);
  });

  it('크기 변경: 캔버스 · 텍스처 source · 기본 프레임을 맞추고 다시 올린다', () => {
    const host = new FakeHost();
    const before = bytes();
    const canvas = { width: 222, height: 148 };
    const tex = createCanvasTexture(host, 'unit-mini', canvas);
    resizeCanvasTexture('unit-mini', tex, canvas, 444, 296);
    expect(canvas).toEqual({ width: 444, height: 296 });
    expect(tex.source[0]).toMatchObject({ width: 444, height: 296, isPowerOf2: false, updates: 1 });
    expect(tex.frames.get('__BASE')).toEqual({ x: 0, y: 0, w: 444, h: 296 });
    expect(bytes() - before).toBe(444 * 296 * 4);
    resizeCanvasTexture('unit-mini', tex, canvas, 256, 128);
    expect(tex.source[0]!.isPowerOf2).toBe(true);
    removeCanvasTexture(host, 'unit-mini');
    expect(bytes()).toBe(before);
  });

  it('client/src에 addCanvas( 가 없다 (CanvasTexture는 생성자에서 getImageData 사본을 만든다)', () => {
    const root = 'client/src';
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith('.ts')) files.push(p);
      }
    };
    walk(root);
    expect(files.length).toBeGreaterThan(10);
    const offenders = files
      .filter((f) => /\.addCanvas\s*\(/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(root, f));
    expect(offenders).toEqual([]);
  });
});

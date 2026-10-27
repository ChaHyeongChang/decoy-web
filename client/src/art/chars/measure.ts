// 새 캐릭터 그림 재기 (캐릭터 리디자인): 그림 명령의 경로 d를 읽어 곡선 위 점을 샘플하고, 크기 기준을 확인한다.
// Canvas · Path2D 없이 돈다 (단위 테스트 · 시안 도구가 같이 쓴다). 단위 = 판정 반지름, 선 두께는 넣지 않는다.
import type { Drawing, Paint, Stop } from './kit';

/** d 문자열의 곡선 위 점들 (M · L · C · Z, 3차 곡선은 24조각) */
export function samplePath(d: string): [number, number][] {
  const out: [number, number][] = [];
  const tokens = d.match(/[MLCZ]|-?\d*\.?\d+(?:e[-+]?\d+)?|NaN|-?Infinity/g) ?? [];
  let i = 0;
  let cur: [number, number] = [0, 0];
  let start: [number, number] = [0, 0];
  const num = (): number => Number(tokens[i++]);
  while (i < tokens.length) {
    const t = tokens[i++];
    if (t === 'M' || t === 'L') {
      cur = [num(), num()];
      if (t === 'M') start = cur;
      out.push(cur);
    } else if (t === 'C') {
      const p1: [number, number] = [num(), num()];
      const p2: [number, number] = [num(), num()];
      const p3: [number, number] = [num(), num()];
      for (let k = 1; k <= 24; k += 1) {
        const u = k / 24;
        const a = (1 - u) ** 3;
        const b = 3 * (1 - u) ** 2 * u;
        const c = 3 * (1 - u) * u * u;
        const e = u ** 3;
        out.push([
          a * cur[0] + b * p1[0] + c * p2[0] + e * p3[0],
          a * cur[1] + b * p1[1] + c * p2[1] + e * p3[1],
        ]);
      }
      cur = p3;
    } else if (t === 'Z') cur = start;
    else throw new Error(`모르는 경로 토큰: ${t}`);
  }
  return out;
}

/** 그림의 모든 경로 위 점 */
export function drawingPoints(dr: Drawing): [number, number][] {
  return dr.ops.flatMap((op) => samplePath(op.d));
}

/**
 * 크기 기준 (사용자 결정: 그림이 판정보다 크면 맞았는지 헷갈린다). 따라가는 카메라 3단계에서 확대 화면 기준으로 줄였다:
 * 그림이 실제 판정 범위보다 눈에 띄게 커 보이지 않게 최대 1.15배 (index.ts TOP_SQUEEZE가 맞춘다)
 *  - 생존자: 앞 ±60° 안은 1.15r까지(이전 1.55r), 앞쪽 반의 그 밖(옆)은 1.05r, 뒤쪽 반은 1.0r
 *    (옛 shapes.test.ts '옆 · 뒤로는 몸 원 밖으로 나가지 않는다'와 같은 뜻, 옆은 손 둥근 끝 몫 0.05r)
 *  - 괴물: 모든 자세 1.12r(VISUAL_SPEC 4.1 '자락 끝 1.12 이내'를 발톱 · 팔까지), 돌진도 1.15r(이전 1.35r)
 * 기존 스타일 도형(art/shapes.ts)은 이 기준과 따로 그대로 둔다
 */
export const SIZE_RULE = {
  survivor: { sector: Math.PI / 3, front: 1.15, side: 1.05, back: 1.0 },
  monster: { all: 1.12, dash: 1.15 },
} as const;

/** 반올림 몫 */
export const SIZE_EPS = 0.005;

export interface SizeOver {
  zone: '앞' | '옆' | '뒤' | '전체';
  r: number;
  limit: number;
  x: number;
  y: number;
}

/** 생존자 크기 기준을 가장 많이 넘는 점 (없으면 null) */
export function survivorOver(dr: Drawing): SizeOver | null {
  const R = SIZE_RULE.survivor;
  let worst: SizeOver | null = null;
  for (const [x, y] of drawingPoints(dr)) {
    const r = Math.hypot(x, y);
    const a = Math.abs(Math.atan2(y, x));
    const [limit, zone]: [number, SizeOver['zone']] =
      a <= R.sector ? [R.front, '앞'] : x >= 0 ? [R.side, '옆'] : [R.back, '뒤'];
    if (r - limit > SIZE_EPS && (!worst || r - limit > worst.r - worst.limit))
      worst = { zone, r, limit, x, y };
  }
  return worst;
}

/** 괴물 크기 기준을 가장 많이 넘는 점 (없으면 null). dashing = 돌진 자세 */
export function monsterOver(dr: Drawing, dashing: boolean): SizeOver | null {
  const limit = dashing ? SIZE_RULE.monster.dash : SIZE_RULE.monster.all;
  let worst: SizeOver | null = null;
  for (const [x, y] of drawingPoints(dr)) {
    const r = Math.hypot(x, y);
    if (r - limit > SIZE_EPS && (!worst || r > worst.r)) worst = { zone: '전체', r, limit, x, y };
  }
  return worst;
}

/** d 문자열 → 닫힌 다각형들 (M마다 새 조각, 3차 곡선은 16조각) */
function pathPolys(d: string): [number, number][][] {
  const tokens = d.match(/[MLCZ]|-?\d*\.?\d+(?:e[-+]?\d+)?|NaN|-?Infinity/g) ?? [];
  const out: [number, number][][] = [];
  let poly: [number, number][] = [];
  let cur: [number, number] = [0, 0];
  let i = 0;
  const num = (): number => Number(tokens[i++]);
  while (i < tokens.length) {
    const t = tokens[i++];
    if (t === 'M') {
      if (poly.length > 0) out.push(poly);
      cur = [num(), num()];
      poly = [cur];
    } else if (t === 'L') {
      cur = [num(), num()];
      poly.push(cur);
    } else if (t === 'C') {
      const p1: [number, number] = [num(), num()];
      const p2: [number, number] = [num(), num()];
      const p3: [number, number] = [num(), num()];
      for (let k = 1; k <= 16; k += 1) {
        const u = k / 16;
        const a = (1 - u) ** 3;
        const b = 3 * (1 - u) ** 2 * u;
        const c = 3 * (1 - u) * u * u;
        const e = u ** 3;
        poly.push([
          a * cur[0] + b * p1[0] + c * p2[0] + e * p3[0],
          a * cur[1] + b * p1[1] + c * p2[1] + e * p3[1],
        ]);
      }
      cur = p3;
    } else if (t === 'Z') {
      if (poly.length > 0) out.push(poly);
      poly = [];
    } else throw new Error(`모르는 경로 토큰: ${t}`);
  }
  if (poly.length > 0) out.push(poly);
  return out;
}

/** 점 (x, y)의 감김 수 · 가로선 교차 수 (nonzero · evenodd 규칙) */
function windingAt(polys: [number, number][][], x: number, y: number): { wn: number; cross: number } {
  let wn = 0;
  let cross = 0;
  for (const p of polys)
    for (let i = 0; i < p.length; i += 1) {
      const a = p[i];
      const b = p[(i + 1) % p.length];
      if (!a || !b) continue;
      const side = (b[0] - a[0]) * (y - a[1]) - (x - a[0]) * (b[1] - a[1]);
      if (a[1] <= y) {
        if (b[1] > y && side > 0) {
          wn += 1;
          cross += 1;
        }
      } else if (b[1] <= y && side < 0) {
        wn -= 1;
        cross += 1;
      }
    }
  return { wn, cross };
}

/**
 * 실루엣 마스크 (VISUAL_SPEC 0장 ④ 시험): 몸 지름 dpx px 크기로 rot만큼 돌려, 불투명한 칠(알파 0.5 이상 — 은은한 빛 · 네온 번짐 제외)이
 * 칸의 반 이상을 덮는 칸을 1로. 3×3 표본, 범위 ±1.7r. 선(외곽선)은 넣지 않는다
 */
export function drawingMask(dr: Drawing, dpx: number, rot = 0): Uint8Array {
  const opaque = (o: Drawing['ops'][number]): boolean => {
    const f = o.fill;
    if (!f) return false;
    // 단색은 칠 알파까지, 그라디언트는 가장 진한 마디 알파로 본다
    const pa = f.kind === 'solid' ? (f.alpha ?? 1) : Math.max(...f.stops.map((st) => st[2] ?? 1));
    return (o.alpha ?? 1) * pa >= 0.5;
  };
  const ops = dr.ops.filter(opaque).map((o) => ({ polys: pathPolys(o.d), evenodd: o.rule === 'evenodd' }));
  const ext = 1.7;
  const n = Math.ceil(dpx * ext);
  const step = (2 * ext) / n;
  const c = Math.cos(-rot);
  const s = Math.sin(-rot);
  const SS = 3;
  const m = new Uint8Array(n * n);
  for (let j = 0; j < n; j += 1)
    for (let i = 0; i < n; i += 1) {
      let hit = 0;
      for (let sj = 0; sj < SS; sj += 1)
        for (let si = 0; si < SS; si += 1) {
          const X = -ext + (i + (si + 0.5) / SS) * step;
          const Y = -ext + (j + (sj + 0.5) / SS) * step;
          const x = X * c - Y * s;
          const y = X * s + Y * c;
          for (const o of ops) {
            const w = windingAt(o.polys, x, y);
            if (o.evenodd ? w.cross % 2 === 1 : w.wn !== 0) {
              hit += 1;
              break;
            }
          }
        }
      m[j * n + i] = hit * 2 >= SS * SS ? 1 : 0;
    }
  return m;
}

// ───────────────────────── 보이는 정도 (의상 유불리 점검, 판 밖 메타 c) ─────────────────────────
// 의상은 꾸미기뿐이라 유불리가 없어야 한다(사용자 결정). 괴물 의상은 생존자 화면에도 그대로 보이므로, 의상 때문에 괴물이
// 안개 · 어둠 속에서 덜(또는 더) 보이면 안 된다. 그래서 그림을 Node에서 직접 칠해(Canvas · Path2D 없이, 결정적) 보이는 면적 ·
// 밝기 · 외곽 대비를 기본 그림과 견준다 (tests/unit/costume-parity.test.ts).

type P2 = [number, number];

/** 하위 경로: 점 목록(3차 곡선은 16조각) · 닫힘(Z) — 선 긋기는 닫힌 경로만 끝 → 처음 변을 긋는다 */
interface SubPath {
  readonly pts: P2[];
  readonly closed: boolean;
}

function pathSubpaths(d: string): SubPath[] {
  const tokens = d.match(/[MLCZ]|-?\d*\.?\d+(?:e[-+]?\d+)?|NaN|-?Infinity/g) ?? [];
  const out: SubPath[] = [];
  let pts: P2[] = [];
  let cur: P2 = [0, 0];
  let start: P2 = [0, 0];
  let i = 0;
  const num = (): number => Number(tokens[i++]);
  const flush = (closed: boolean): void => {
    if (pts.length > 0) out.push({ pts, closed });
    pts = [];
  };
  while (i < tokens.length) {
    const t = tokens[i++];
    if (t === 'M') {
      flush(false);
      cur = [num(), num()];
      start = cur;
      pts = [cur];
    } else if (t === 'L' || t === 'C') {
      // Z 뒤에 M 없이 이어 그리면 하위 경로 시작점에서 새로 시작한다 (SVG와 같다)
      if (pts.length === 0) pts = [cur];
      if (t === 'L') {
        cur = [num(), num()];
        pts.push(cur);
      } else {
        const p1: P2 = [num(), num()];
        const p2: P2 = [num(), num()];
        const p3: P2 = [num(), num()];
        for (let k = 1; k <= 16; k += 1) {
          const u = k / 16;
          const a = (1 - u) ** 3;
          const b = 3 * (1 - u) ** 2 * u;
          const c = 3 * (1 - u) * u * u;
          const e = u ** 3;
          pts.push([
            a * cur[0] + b * p1[0] + c * p2[0] + e * p3[0],
            a * cur[1] + b * p1[1] + c * p2[1] + e * p3[1],
          ]);
        }
        cur = p3;
      }
    } else if (t === 'Z') {
      flush(true);
      cur = start;
    } else throw new Error(`모르는 경로 토큰: ${t}`);
  }
  flush(false);
  return out;
}

/** 경로 d → 하위 경로 (그림 좌표). 같은 그림을 여러 크기 · 방향으로 칠할 때 다시 읽지 않는다 (많아지면 비운다) */
const SUBPATH_CACHE = new Map<string, SubPath[]>();
function cachedSubpaths(d: string): SubPath[] {
  let v = SUBPATH_CACHE.get(d);
  if (!v) {
    if (SUBPATH_CACHE.size >= 20000) SUBPATH_CACHE.clear();
    SUBPATH_CACHE.set(d, (v = pathSubpaths(d)));
  }
  return v;
}

/** sRGB 채널 0~1 → 선형 (WCAG 상대 휘도 식) */
function toLinear(v: number): number {
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/** sRGB 0~1 세 채널의 상대 휘도 (WCAG 2.x) */
export function luminance01(r: number, g: number, b: number): number {
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/** 칠 표본기: 화면 좌표 (x, y) → 알파 곱한 [r, g, b, a] (sRGB 0~1)를 out에 쓴다 */
type Sampler = (x: number, y: number, out: Float64Array) => void;

/** 그라디언트 정지점 → 0~1 위치 256칸 표 (알파 곱한 값으로 보간 — CSS · Canvas 그라디언트처럼 투명 끝이 검게 번지지 않는다) */
function stopLut(stops: readonly Stop[]): Float64Array {
  const lut = new Float64Array(256 * 4);
  const s = [...stops]
    .map(([o, c, a]) => ({ o: Math.max(0, Math.min(1, o)), c, a: a ?? 1 }))
    .sort((p, q) => p.o - q.o);
  const pm = (k: number): [number, number, number, number] => {
    const st = s[k];
    if (!st) return [0, 0, 0, 0];
    return [
      (((st.c >> 16) & 255) / 255) * st.a,
      (((st.c >> 8) & 255) / 255) * st.a,
      ((st.c & 255) / 255) * st.a,
      st.a,
    ];
  };
  for (let i = 0; i < 256; i += 1) {
    const t = i / 255;
    let k = 0;
    while (k + 1 < s.length && (s[k + 1]?.o ?? 1) < t) k += 1;
    const a = s[k];
    const b = s[k + 1];
    let v: [number, number, number, number];
    if (!a) v = [0, 0, 0, 0];
    else if (t <= a.o || !b) v = pm(k);
    else {
      const u = b.o > a.o ? Math.min(1, (t - a.o) / (b.o - a.o)) : 1;
      const p = pm(k);
      const q = pm(k + 1);
      v = [
        p[0] + (q[0] - p[0]) * u,
        p[1] + (q[1] - p[1]) * u,
        p[2] + (q[2] - p[2]) * u,
        p[3] + (q[3] - p[3]) * u,
      ];
    }
    lut.set(v, i * 4);
  }
  return lut;
}

/** 정지점 배열 → 표 (같은 그림을 여러 크기로 칠할 때 다시 만들지 않는다) */
const LUT_CACHE = new WeakMap<readonly Stop[], Float64Array>();

/** 칠 → 표본기. 그림 좌표의 칠을 rot만큼 돌려 화면 좌표에서 읽는다. alpha = 명령 알파 */
function sampler(p: Paint, rot: number, alpha: number): Sampler {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const R = (x: number, y: number): P2 => [x * c - y * s, x * s + y * c];
  if (p.kind === 'solid') {
    const a = (p.alpha ?? 1) * alpha;
    const r = (((p.color >> 16) & 255) / 255) * a;
    const g = (((p.color >> 8) & 255) / 255) * a;
    const b = ((p.color & 255) / 255) * a;
    return (_x, _y, out) => {
      out[0] = r;
      out[1] = g;
      out[2] = b;
      out[3] = a;
    };
  }
  let lut = LUT_CACHE.get(p.stops);
  if (!lut) LUT_CACHE.set(p.stops, (lut = stopLut(p.stops)));
  const put = (t: number, out: Float64Array): void => {
    const k = Math.round(Math.max(0, Math.min(1, t)) * 255) * 4;
    out[0] = (lut[k] ?? 0) * alpha;
    out[1] = (lut[k + 1] ?? 0) * alpha;
    out[2] = (lut[k + 2] ?? 0) * alpha;
    out[3] = (lut[k + 3] ?? 0) * alpha;
  };
  if (p.kind === 'linear') {
    const [x0, y0] = R(p.x0, p.y0);
    const [x1, y1] = R(p.x1, p.y1);
    const dx = x1 - x0;
    const dy = y1 - y0;
    const L2 = dx * dx + dy * dy || 1e-12;
    return (x, y, out) => put(((x - x0) * dx + (y - y0) * dy) / L2, out);
  }
  const [cx, cy] = R(p.cx, p.cy);
  const r = p.r || 1e-12;
  return (x, y, out) => put(Math.hypot(x - cx, y - cy) / r, out);
}

/**
 * 칠한 그림: 칸마다 알파 곱한 [r, g, b, a] (sRGB 0~1). 격자는 n × n (n = ⌈1.7 × dpx⌉, 범위 ±1.7r 이상), 칸 하나 = 1 텍셀,
 * 그림 단위 1 = dpx / 2 텍셀 (게임 아틀라스와 같은 배율). 그림 원점(몸 중심)은 칸 좌표 (cx, cy) — 칸 i는 x ∈ [i, i + 1)
 */
export interface DrawingRaster {
  readonly n: number;
  readonly rgba: Float32Array;
  /** 그림 원점의 칸 좌표 (없으면 n / 2) */
  readonly cx?: number;
  readonly cy?: number;
}

export interface RasterOptions {
  /**
   * 칸마다 가로 표본 줄 수 (기본 4 — Skia 분석 안티에일리어싱이 꼭짓점 y를 1/4 화소에 맞추는 것과 같은 세로 분해능: 칸 안에서
   * 맞닿은 두 도형의 이음매 몫이 Chromium과 같다). 줄 위 덮임은 구간 길이로 정확히 잰다
   */
  readonly ss?: number;
  /** 그림 원점의 어긋남 (텍셀, 격자 가운데 n / 2에서) — 화소 격자에 대한 위상 */
  readonly dx?: number;
  readonly dy?: number;
}

/** 덮임 누적기: 명령 하나가 칸마다 덮는 몫 (0~1)과 건드린 칸 목록 */
class Coverage {
  readonly cov: Float64Array;
  readonly seen: Uint8Array;
  readonly touched: number[] = [];
  constructor(readonly n: number) {
    this.cov = new Float64Array(n * n);
    this.seen = new Uint8Array(n * n);
  }

  /** 칸 줄 j에 가로 구간 [xa, xb) (텍셀)를 무게 wt로 더한다 — 칸마다 겹친 길이만큼 */
  span(j: number, xa: number, xb: number, wt: number): void {
    const n = this.n;
    const a = Math.max(0, xa);
    const b = Math.min(n, xb);
    if (!(b > a)) return;
    const i0 = Math.floor(a);
    const i1 = Math.min(n - 1, Math.ceil(b) - 1);
    const row = j * n;
    for (let i = i0; i <= i1; i += 1) {
      const o = Math.min(b, i + 1) - Math.max(a, i);
      if (o <= 0) continue;
      const p = row + i;
      if (!this.seen[p]) {
        this.seen[p] = 1;
        this.touched.push(p);
      }
      this.cov[p] = (this.cov[p] ?? 0) + o * wt;
    }
  }

  /** 칸 (i, j)에 덮임 v를 더한다 (격자 밖은 버린다) */
  add(i: number, j: number, v: number): void {
    const n = this.n;
    if (v <= 0 || i < 0 || j < 0 || i >= n || j >= n) return;
    const p = j * n + i;
    if (!this.seen[p]) {
      this.seen[p] = 1;
      this.touched.push(p);
    }
    this.cov[p] = (this.cov[p] ?? 0) + v;
  }

  /**
   * 가는 선(머리카락 선) 한 마디: Skia 안티에일리어싱 머리카락 선과 같게 긴 축 칸마다 덮임 1을 짧은 축 두 칸에 나눈다 (칸 가운데에서
   * 선의 자리 − 0.5의 소수부로). 첫 · 끝 칸은 마디가 걸친 몫만. 선 전체 덮임 합 = 긴 축 길이 × k (비스듬한 선은 길이보다 적다)
   */
  hairline(x0: number, y0: number, x1: number, y1: number, k: number): void {
    const steep = Math.abs(y1 - y0) >= Math.abs(x1 - x0);
    // 긴 축을 a, 짧은 축을 b로
    let a0 = steep ? y0 : x0;
    let b0 = steep ? x0 : y0;
    let a1 = steep ? y1 : x1;
    let b1 = steep ? x1 : y1;
    if (a1 === a0) return;
    if (a1 < a0) {
      [a0, a1] = [a1, a0];
      [b0, b1] = [b1, b0];
    }
    const slope = (b1 - b0) / (a1 - a0);
    for (let i = Math.floor(a0); i < Math.ceil(a1); i += 1) {
      const f = Math.min(a1, i + 1) - Math.max(a0, i);
      if (f <= 0) continue;
      const bb = b0 + slope * (i + 0.5 - a0) - 0.5;
      const r = Math.floor(bb);
      const fr = bb - r;
      if (steep) {
        this.add(r, i, f * (1 - fr) * k);
        this.add(r + 1, i, f * fr * k);
      } else {
        this.add(i, r, f * (1 - fr) * k);
        this.add(i, r + 1, f * fr * k);
      }
    }
  }

  reset(): void {
    for (const p of this.touched) {
      this.cov[p] = 0;
      this.seen[p] = 0;
    }
    this.touched.length = 0;
  }
}

/** [키, 값, 키, 값 …] 짝을 키 순서로 (줄마다 짝이 몇 개뿐이라 끼워 넣기 정렬) */
function sortPairs(a: number[]): void {
  for (let i = 2; i < a.length; i += 2) {
    const k = a[i] ?? 0;
    const v = a[i + 1] ?? 0;
    let j = i - 2;
    while (j >= 0 && (a[j] ?? 0) > k) {
      a[j + 2] = a[j] ?? 0;
      a[j + 3] = a[j + 1] ?? 0;
      j -= 2;
    }
    a[j + 2] = k;
    a[j + 3] = v;
  }
}

/** 표본 줄 하나의 구간들을 합쳐(겹치면 한 번) 덮임에 더한다. xs = [시작, 끝, 시작, 끝 …] (정렬한다) */
function mergeSpans(cv: Coverage, j: number, xs: number[], wt: number): void {
  if (xs.length > 2) sortPairs(xs);
  let a = xs[0] ?? 0;
  let b = xs[1] ?? 0;
  for (let q = 2; q < xs.length; q += 2) {
    const s = xs[q] ?? 0;
    const e = xs[q + 1] ?? 0;
    if (s <= b) b = Math.max(b, e);
    else {
      cv.span(j, a, b, wt);
      a = s;
      b = e;
    }
  }
  if (xs.length > 0) cv.span(j, a, b, wt);
}

/**
 * 그림을 Node에서 칠한다 (Canvas 없이, 결정적). Canvas2D처럼 명령(칠 · 선)마다 따로 칸 단위로 겹친다:
 * 명령 하나가 칸을 덮는 몫(안티에일리어싱 덮임 0~1)을 먼저 재고, 칸 가운데의 칠 색 × 덮임을 source-over로 얹는다 (sRGB 공간,
 * 알파 곱한 값). 그래서 두 도형이 맞닿은 이음매(예: 깃대를 따라 나뉜 두 광택 반쪽)는 Canvas와 같이 두 도형이 각자 반쯤 덮은
 * 칸에서 밑 색이 비친다 — 표본을 다 칠한 뒤 평균하면(1판 방식) 이음매가 감쪽같이 메워져 실제 화면보다 밝게 나온다.
 *  - 덮임: 칸마다 가로 표본 줄 ss개(기본 4), 줄 위에서는 도형과 겹친 구간 길이를 정확히 잰다 (Skia 분석 안티에일리어싱에 가깝다)
 *  - 칠: 단색 · 선형 · 원형(정지점 알파 — 알파 곱한 값으로 보간), 명령 알파, nonzero · evenodd 규칙. 칠 색은 칸 가운데에서 읽는다
 *  - 선: 경로 꺾은선 마디마다 둥근 캡슐(반폭 = 두께 / 2, 둥근 이음), 열린 끝의 butt 끝은 자른다. 한 명령 안에서 겹친 곳은
 *    한 번만 덮는다 (Canvas 선과 같다 — 줄마다 캡슐 구간을 합친다). 화면에서 1px 이하인 선은 Skia처럼 머리카락 선 × 두께
 *  - Chromium과 견준 값 · 남은 차이: scripts/char-art/raster-calibrate.ts (tests/unit/costume-parity.test.ts 'Chromium 기준 값')
 * rot = 화면에서 돌린 각 (drawingMask와 같은 방향), opts.dx · dy = 원점의 텍셀 어긋남(위상)
 */
export function drawingRaster(dr: Drawing, dpx: number, rot = 0, opts: RasterOptions = {}): DrawingRaster {
  const ext = 1.7;
  const ss = Math.max(1, Math.round(opts.ss ?? 4));
  const n = Math.ceil(dpx * ext);
  const u = dpx / 2;
  const cx = n / 2 + (opts.dx ?? 0);
  const cy = n / 2 + (opts.dy ?? 0);
  const M = n * ss;
  const buf = new Float64Array(n * n * 4);
  const cv = new Coverage(n);
  const rows: number[][] = Array.from({ length: M }, () => []);
  const used: number[] = [];
  const col = new Float64Array(4);
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  /** 표본 줄 m의 텍셀 y */
  const rowY = (m: number): number => (m + 0.5) / ss;
  /** 텍셀 y 이상인 첫 표본 줄 */
  const rowAt = (y: number): number => Math.ceil(y * ss - 0.5);
  const push = (m: number, a: number, b: number): void => {
    const r = rows[m];
    if (!r) return;
    if (r.length === 0) used.push(m);
    r.push(a, b);
  };
  /** 선 구간 넣기: 줄의 마지막 구간과 겹치면 늘린다 (꺾은선의 이웃 마디는 거의 늘 겹친다) */
  const pushSpan = (m: number, a: number, b: number): void => {
    const r = rows[m];
    if (!r) return;
    const L = r.length;
    if (L === 0) used.push(m);
    else if (a <= (r[L - 1] ?? 0) && b >= (r[L - 2] ?? 0)) {
      r[L - 2] = Math.min(r[L - 2] ?? 0, a);
      r[L - 1] = Math.max(r[L - 1] ?? 0, b);
      return;
    }
    r.push(a, b);
  };
  /** 명령 하나의 덮임을 칠 색으로 얹는다 */
  const composite = (smp: Sampler): void => {
    for (const p of cv.touched) {
      const k = Math.min(1, cv.cov[p] ?? 0);
      if (k <= 0) continue;
      const i = p % n;
      const j = (p - i) / n;
      smp((i + 0.5 - cx) / u, (j + 0.5 - cy) / u, col);
      const sa = (col[3] ?? 0) * k;
      if (sa <= 0) continue;
      const o = p * 4;
      for (let q = 0; q < 4; q += 1) buf[o + q] = (col[q] ?? 0) * k + (buf[o + q] ?? 0) * (1 - sa);
    }
    cv.reset();
  };
  const toTexel = (x: number, y: number): P2 => [cx + u * (x * c - y * s), cy + u * (x * s + y * c)];
  for (const op of dr.ops) {
    const alpha = op.alpha ?? 1;
    if (alpha <= 0 || (!op.fill && !op.stroke)) continue;
    // 텍셀 좌표로 옮긴 하위 경로
    const subs = cachedSubpaths(op.d).map((sp) => ({
      closed: sp.closed,
      pts: sp.pts.map(([x, y]) => toTexel(x, y)),
    }));
    if (op.fill) {
      // 칠: 표본 줄마다 변과의 교차점(감김 방향)을 모아 nonzero · evenodd로 안쪽 구간을 덮는다 (열린 하위 경로도 닫아 칠한다)
      for (const sp of subs)
        for (let e = 0; e < sp.pts.length; e += 1) {
          const a = sp.pts[e];
          const b = sp.pts[(e + 1) % sp.pts.length];
          if (!a || !b || a[1] === b[1]) continue;
          const up = a[1] < b[1];
          const y0 = up ? a[1] : b[1];
          const y1 = up ? b[1] : a[1];
          const m0 = Math.max(0, rowAt(y0));
          const m1 = Math.min(M - 1, rowAt(y1) - 1);
          for (let m = m0; m <= m1; m += 1) {
            const x = a[0] + ((rowY(m) - a[1]) * (b[0] - a[0])) / (b[1] - a[1]);
            push(m, x, up ? 1 : -1);
          }
        }
      const evenodd = op.rule === 'evenodd';
      for (const m of used) {
        const row = rows[m] ?? [];
        sortPairs(row);
        let wn = 0;
        let cross = 0;
        const j = Math.floor(m / ss);
        for (let q = 0; q + 2 < row.length; q += 2) {
          wn += row[q + 1] ?? 0;
          cross += 1;
          if (evenodd ? cross % 2 === 0 : wn === 0) continue;
          cv.span(j, row[q] ?? 0, row[q + 2] ?? 0, 1 / ss);
        }
        row.length = 0;
      }
      used.length = 0;
      composite(sampler(op.fill, rot, alpha));
    }
    if (op.stroke) {
      const hw = (op.stroke.width / 2) * u;
      const butt = op.stroke.cap === 'butt';
      // 화면에서 1px 이하인 선은 Skia처럼 머리카락 선으로 긋고 덮임을 두께만큼 줄인다 (SkDrawTreatAAStrokeAsHairline:
      // 두께 벡터 둘의 빠른 길이(긴 축 + 짧은 축 / 2)가 모두 1 이하면 그 평균이 덮임). 둥근 · 네모 끝은 열린 끝을 π/8 · 0.5px 늘인다
      const fast = (x: number, y: number): number =>
        Math.abs(x) > Math.abs(y) ? Math.abs(x) + Math.abs(y) / 2 : Math.abs(y) + Math.abs(x) / 2;
      const l0 = fast(2 * hw * c, 2 * hw * s);
      const l1 = fast(-2 * hw * s, 2 * hw * c);
      if (l0 <= 1 && l1 <= 1) {
        const k = (l0 + l1) / 2;
        const out = butt ? 0 : Math.PI / 8;
        for (const sp of subs) {
          const P = sp.pts.map((p): P2 => [p[0], p[1]]);
          const segs = sp.closed ? P.length : P.length - 1;
          if (segs <= 0) continue;
          if (!sp.closed && out > 0 && P.length >= 2) {
            const ext = (p: P2 | undefined, q: P2 | undefined): void => {
              if (!p || !q) return;
              const L = Math.hypot(p[0] - q[0], p[1] - q[1]);
              if (L <= 0) return;
              p[0] += ((p[0] - q[0]) / L) * out;
              p[1] += ((p[1] - q[1]) / L) * out;
            };
            ext(P[0], P[1]);
            ext(P[P.length - 1], P[P.length - 2]);
          }
          for (let e = 0; e < segs; e += 1) {
            const a = P[e];
            const b = P[(e + 1) % P.length];
            if (a && b) cv.hairline(a[0], a[1], b[0], b[1], k);
          }
        }
        composite(sampler(op.stroke.paint, rot, alpha));
        continue;
      }
      // 선: 마디(선분)마다 둥근 캡슐이 표본 줄과 겹치는 구간(볼록이라 한 구간)을 모아, 줄마다 합쳐 덮는다
      for (const sp of subs) {
        const P = sp.pts;
        const segs = sp.closed ? P.length : P.length - 1;
        if (segs <= 0) continue;
        for (let e = 0; e < segs; e += 1) {
          const a = P[e];
          const b = P[(e + 1) % P.length];
          if (!a || !b) continue;
          // 열린 끝의 butt 끝: 그 끝의 반원을 빼고 선분 끝에서 자른다
          const capA = !(butt && !sp.closed && e === 0);
          const capB = !(butt && !sp.closed && e === segs - 1);
          const dx = b[0] - a[0];
          const dy = b[1] - a[1];
          const L = Math.hypot(dx, dy);
          const tx = L > 0 ? dx / L : 1;
          const ty = L > 0 ? dy / L : 0;
          const m0 = Math.max(0, rowAt(Math.min(a[1], b[1]) - hw));
          const m1 = Math.min(M - 1, rowAt(Math.max(a[1], b[1]) + hw) - 1);
          for (let m = m0; m <= m1; m += 1) {
            const Y = rowY(m);
            let lo = Infinity;
            let hi = -Infinity;
            // 두 끝의 둥근 끝 (원판)
            const da = Y - a[1];
            if (capA && Math.abs(da) <= hw) {
              const hx = Math.sqrt(hw * hw - da * da);
              lo = Math.min(lo, a[0] - hx);
              hi = Math.max(hi, a[0] + hx);
            }
            const db = Y - b[1];
            if (capB && Math.abs(db) <= hw) {
              const hx = Math.sqrt(hw * hw - db * db);
              lo = Math.min(lo, b[0] - hx);
              hi = Math.max(hi, b[0] + hx);
            }
            if (L > 0) {
              // 띠: |(X − A)·법선| ≤ hw, 0 ≤ (X − A)·방향 ≤ L — 줄 위에서 x의 구간 둘을 겹친다
              const ry = Y - a[1];
              let ra = -Infinity;
              let rb = Infinity;
              // 법선 (−ty, tx): f(x) = −(x − ax)·ty + ry·tx
              if (Math.abs(ty) > 1e-12) {
                const p = a[0] + (ry * tx - hw) / ty;
                const q = a[0] + (ry * tx + hw) / ty;
                ra = Math.max(ra, Math.min(p, q));
                rb = Math.min(rb, Math.max(p, q));
              } else if (Math.abs(ry * tx) > hw) rb = -Infinity;
              // 방향: g(x) = (x − ax)·tx + ry·ty ∈ [0, L]
              if (Math.abs(tx) > 1e-12) {
                const p = a[0] + (0 - ry * ty) / tx;
                const q = a[0] + (L - ry * ty) / tx;
                ra = Math.max(ra, Math.min(p, q));
                rb = Math.min(rb, Math.max(p, q));
              } else if (ry * ty < 0 || ry * ty > L) rb = -Infinity;
              if (rb > ra) {
                lo = Math.min(lo, ra);
                hi = Math.max(hi, rb);
              }
            }
            if (hi > lo) pushSpan(m, lo, hi);
          }
        }
      }
      for (const m of used) {
        const row = rows[m] ?? [];
        mergeSpans(cv, Math.floor(m / ss), row, 1 / ss);
        row.length = 0;
      }
      used.length = 0;
      composite(sampler(op.stroke.paint, rot, alpha));
    }
  }
  const rgba = new Float32Array(n * n * 4);
  rgba.set(buf);
  return { n, rgba, cx, cy };
}

/**
 * 화면에 찍기 (게임과 같은 다시 샘플): 아틀라스에 돌리지 않고 구운 그림(src)을 화면에서 rot만큼 돌려, 원점을 텍셀 격자에서
 * (dx, dy) 어긋난 자리에 1:1로 찍는다. WebGL 선형 보간(텍셀 가운데 기준 쌍선형, 알파 곱한 값 — Phaser는 텍스처를 알파 곱해
 * 올린다)과 같다. 격자 크기는 src와 같고 원점은 n / 2 + (dx, dy)
 */
export function resampleRaster(src: DrawingRaster, rot: number, dx = 0, dy = 0): DrawingRaster {
  const n = src.n;
  const sx0 = src.cx ?? n / 2;
  const sy0 = src.cy ?? n / 2;
  const cx = n / 2 + dx;
  const cy = n / 2 + dy;
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const S = src.rgba;
  const out = new Float32Array(n * n * 4);
  const tap = (i: number, j: number, w: number, o: number): void => {
    if (w <= 0 || i < 0 || j < 0 || i >= n || j >= n) return;
    const k = (j * n + i) * 4;
    for (let q = 0; q < 4; q += 1) out[o + q] = (out[o + q] ?? 0) + (S[k + q] ?? 0) * w;
  };
  for (let J = 0; J < n; J += 1)
    for (let I = 0; I < n; I += 1) {
      const px = I + 0.5 - cx;
      const py = J + 0.5 - cy;
      // 화면 → 그림(텍스처): −rot만큼 되돌린다
      const tx = px * c + py * s + sx0 - 0.5;
      const ty = -px * s + py * c + sy0 - 0.5;
      const i0 = Math.floor(tx);
      const j0 = Math.floor(ty);
      const fx = tx - i0;
      const fy = ty - j0;
      const o = (J * n + I) * 4;
      tap(i0, j0, (1 - fx) * (1 - fy), o);
      tap(i0 + 1, j0, fx * (1 - fy), o);
      tap(i0, j0 + 1, (1 - fx) * fy, o);
      tap(i0 + 1, j0 + 1, fx * fy, o);
    }
  return { n, rgba: out, cx, cy };
}

/** 보이는 정도 (칠한 그림 하나). 바닥 = 그림 밑 바닥색 (칸 색은 바닥 위에 얹은 색으로 잰다) */
export interface Visibility {
  /** 보이는 면적: 알파 0.5 이상인 칸 수 (외곽선 포함 — 바닥과 갈리는 실루엣 크기) */
  readonly area: number;
  /** 밝기: 보이는 칸들의 평균 상대 휘도 (바닥 위에 얹은 색, WCAG 식) */
  readonly luma: number;
  /** 외곽 대비: 테두리 띠(외곽선 바로 안쪽 띠)의 평균 상대 휘도 — 어두운 바닥 · 안개에서 실루엣을 바닥과 가르는 곳 */
  readonly rim: number;
  /** 테두리 띠 칸 수 (0이면 rim은 0) */
  readonly rimCells: number;
  /** 테두리 띠 대 바닥 WCAG 대비 ((L1 + 0.05) / (L2 + 0.05)) */
  readonly rimContrast: number;
}

/**
 * 보이는 정도 재기.
 *  - 보이는 면적 = 알파 0.5 이상 칸 수
 *  - 밝기 = 그 칸들을 바닥색 위에 얹은 색의 평균 상대 휘도 (sRGB → 선형, WCAG 2.x 식)
 *  - 외곽 대비 = 테두리 띠의 평균 상대 휘도: 보이는 칸 중 바깥(안 보이는 칸)까지 거리가 inPx 초과 inPx + bandPx 이하인 칸.
 *    짙은 외곽선(#05080C)은 바닥과 거의 같은 어둠이라 실루엣을 가르지 못하고 모든 의상이 같다 — 그래서 외곽선 두께(inPx)
 *    만큼 안쪽부터 잰다. 의상이 어둡게 만들 수 있는 곳이 이 띠다
 * 거리는 칸 가운데끼리 잰 거리에서 반 칸을 뺀 값(경계까지 거리)이다
 */
export function visibility(r: DrawingRaster, floor: number, inPx: number, bandPx: number): Visibility {
  const { n, rgba } = r;
  const fr = ((floor >> 16) & 255) / 255;
  const fg = ((floor >> 8) & 255) / 255;
  const fb = (floor & 255) / 255;
  const lf = luminance01(fr, fg, fb);
  const on = new Uint8Array(n * n);
  const lum = new Float64Array(n * n);
  let area = 0;
  let sum = 0;
  for (let k = 0; k < n * n; k += 1) {
    const a = rgba[k * 4 + 3] ?? 0;
    if (a < 0.5) continue;
    on[k] = 1;
    area += 1;
    const L = luminance01(
      (rgba[k * 4] ?? 0) + fr * (1 - a),
      (rgba[k * 4 + 1] ?? 0) + fg * (1 - a),
      (rgba[k * 4 + 2] ?? 0) + fb * (1 - a),
    );
    lum[k] = L;
    sum += L;
  }
  const reach = Math.ceil(inPx + bandPx + 1.5);
  let rim = 0;
  let rimCells = 0;
  for (let j = 0; j < n; j += 1)
    for (let i = 0; i < n; i += 1) {
      const k = j * n + i;
      if (!on[k]) continue;
      // 가장 가까운 바깥 칸까지 거리 (격자 밖도 바깥)
      let best = Math.min(i + 1, j + 1, n - i, n - j);
      for (let dj = -reach; dj <= reach; dj += 1)
        for (let di = -reach; di <= reach; di += 1) {
          const d = Math.hypot(di, dj);
          if (d >= best) continue;
          const ii = i + di;
          const jj = j + dj;
          if (ii < 0 || jj < 0 || ii >= n || jj >= n || !on[jj * n + ii]) best = d;
        }
      const edge = best - 0.5;
      if (edge > inPx && edge <= inPx + bandPx) {
        rim += lum[k] ?? 0;
        rimCells += 1;
      }
    }
  const rimL = rimCells > 0 ? rim / rimCells : 0;
  return {
    area,
    luma: area > 0 ? sum / area : 0,
    rim: rimL,
    rimCells,
    rimContrast: (Math.max(rimL, lf) + 0.05) / (Math.min(rimL, lf) + 0.05),
  };
}

// ───────────── 조각별 외곽 대비 · 바닥 대비 면적 (의상 유불리 점검 2판, tests/unit/costume-parity.test.ts) ─────────────
// 평균만 보면 한쪽을 어둡게(바닥색으로) 하고 다른 쪽을 밝게 해 평균을 맞추는 의상이 빠져나간다. 그래서 테두리 띠를 몸 둘레
// 조각으로 나눠 조각마다 보고(가장 많이 잃은 조각), 바닥과 실제로 갈리는 칸 수(바닥 대비 면적)를 따로 센다 — 바닥색으로
// 칠한 칸은 알파가 1이어도 바닥과 갈리지 않으므로 세지 않는다.

/** 두 상대 휘도의 WCAG 2.x 대비 ((밝은 쪽 + 0.05) / (어두운 쪽 + 0.05), 1 이상) */
export function wcagContrast(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/**
 * 1차원 제곱 거리 변환 (Felzenszwalb · Huttenlocher 하한 포물선): d[q] = min_p (q − p)² + f[p].
 * f는 첫 패스에서 0(바깥) · Infinity(안), 두 번째 패스에서 첫 패스의 제곱 거리다. Infinity 칸은 포물선을 두지 않는다
 */
function edt1(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array): void {
  let k = -1;
  for (let q = 0; q < n; q += 1) {
    const fq = f[q] ?? Infinity;
    if (fq === Infinity) continue;
    if (k < 0) {
      k = 0;
      v[0] = q;
      z[0] = -Infinity;
      z[1] = Infinity;
      continue;
    }
    let s = 0;
    for (;;) {
      const p = v[k] ?? 0;
      s = (fq + q * q - ((f[p] ?? 0) + p * p)) / (2 * q - 2 * p);
      // 새 포물선이 앞 포물선을 완전히 덮으면 뺀다 (z[0] = -∞라 첫 포물선에서 멈춘다)
      if (k > 0 && s <= (z[k] ?? -Infinity)) k -= 1;
      else break;
    }
    k += 1;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  if (k < 0) {
    d.fill(Infinity, 0, n);
    return;
  }
  k = 0;
  for (let q = 0; q < n; q += 1) {
    while ((z[k + 1] ?? Infinity) < q) k += 1;
    const p = v[k] ?? 0;
    d[q] = (q - p) * (q - p) + (f[p] ?? 0);
  }
}

/**
 * 칸마다 가장 가까운 바깥 칸(on이 0인 칸 · 격자 밖)까지의 거리 (칸 가운데끼리, 칸 단위). 정확한 유클리드 거리 변환이라
 * visibility의 주변 칸 찾기와 같은 값을 내고 큰 크기(몸 지름 90px)에서도 빠르다. 격자 밖은 한 칸 둘레로 덧대어 바깥으로 본다
 */
export function outsideDistance(on: Uint8Array, n: number): Float64Array {
  const m = n + 2;
  const g = new Float64Array(m * m);
  for (let j = 0; j < m; j += 1)
    for (let i = 0; i < m; i += 1) {
      const inside = i > 0 && j > 0 && i <= n && j <= n && on[(j - 1) * n + (i - 1)] === 1;
      g[j * m + i] = inside ? Infinity : 0;
    }
  const f = new Float64Array(m);
  const d = new Float64Array(m);
  const v = new Int32Array(m);
  const z = new Float64Array(m + 1);
  for (let i = 0; i < m; i += 1) {
    for (let j = 0; j < m; j += 1) f[j] = g[j * m + i] ?? 0;
    edt1(f, m, d, v, z);
    for (let j = 0; j < m; j += 1) g[j * m + i] = d[j] ?? 0;
  }
  for (let j = 0; j < m; j += 1) {
    for (let i = 0; i < m; i += 1) f[i] = g[j * m + i] ?? 0;
    edt1(f, m, d, v, z);
    for (let i = 0; i < m; i += 1) g[j * m + i] = d[i] ?? 0;
  }
  const out = new Float64Array(n * n);
  for (let j = 0; j < n; j += 1)
    for (let i = 0; i < n; i += 1) out[j * n + i] = Math.sqrt(g[(j + 1) * m + (i + 1)] ?? 0);
  return out;
}

/** 보이는 정도 자세히: visibility 값 + 조각별 테두리 띠 · 바닥 대비 면적 */
export interface VisibilityDetail extends Visibility {
  /**
   * 테두리 띠를 몸 중심(그림 원점) 둘레 같은 각 조각으로 나눈 조각별 평균 상대 휘도. 몸 방향 기준: 0 = 앞(+x) 가운데,
   * 번호가 늘수록 화면 시계 방향(y 아래) — 8조각이면 2 = 오른쪽, 4 = 뒤, 6 = 왼쪽. 칸이 없는 조각은 NaN
   */
  readonly rimSectors: readonly number[];
  /** 조각별 칸 수 */
  readonly rimSectorCells: readonly number[];
  /** 바닥 대비 면적: 바닥 위에 얹은 색이 바닥과 WCAG 대비 minContrast 이상인 칸 수 (알파와 상관없이 — 바닥색 칠은 세지 않는다) */
  readonly contrastArea: number;
  /** 칸마다 바닥 위에 얹은 색의 상대 휘도 (n × n) */
  readonly pixelLuma: Float64Array;
  /** 테두리 띠 칸 번호 (k = j × n + i) · 그 칸의 몸 방향 기준 각 (라디안, 0 = 앞, 화면 시계 방향 +, −π ~ π) */
  readonly rimIndex: Int32Array;
  readonly rimAngle: Float64Array;
}

export interface VisibilityDetailOptions {
  /** 테두리 띠 조각 수 (기본 8) */
  readonly sectors?: number;
  /** 그림을 돌려 칠한 각 (drawingRaster의 rot). 조각을 몸 방향 기준으로 맞춘다 (기본 0) */
  readonly rot?: number;
  /** 바닥 대비 면적의 대비 하한 (기본 1.5) */
  readonly minContrast?: number;
}

/**
 * 테두리 띠 칸 값을 조각마다 평균한다 (값 = 칸 번호 k → 값). offset = 조각 배치를 돌리는 몫 (조각 하나 = 1, 0.5면 반 조각
 * 어긋난 배치 — 조각 0이 앞 가운데가 아니라 앞에서 시계 방향 반 조각 자리에서 시작한다). 칸이 없는 조각은 NaN
 */
export function sectorMeans(
  d: VisibilityDetail,
  value: (k: number) => number,
  sectors: number,
  offset = 0,
): { mean: number[]; cells: number[] } {
  const step = (2 * Math.PI) / sectors;
  const sum = new Float64Array(sectors);
  const cells = new Float64Array(sectors);
  for (let q = 0; q < d.rimIndex.length; q += 1) {
    const a = d.rimAngle[q] ?? 0;
    const s = ((Math.round(a / step - offset) % sectors) + sectors) % sectors;
    sum[s] = (sum[s] ?? 0) + value(d.rimIndex[q] ?? 0);
    cells[s] = (cells[s] ?? 0) + 1;
  }
  return {
    mean: [...sum].map((v, q) => ((cells[q] ?? 0) > 0 ? v / (cells[q] ?? 1) : Number.NaN)),
    cells: [...cells],
  };
}

/**
 * 보이는 정도 자세히 재기. 면적 · 밝기 · 외곽 대비(area · luma · rim · rimCells · rimContrast)는 visibility와 같은 값이다
 * (테두리 띠 거리만 정확한 거리 변환으로 빨리 구한다). 더해서
 *  - 조각별 테두리 띠: 띠 칸을 몸 중심(r.cx, r.cy)에서 본 각으로 sectors 조각에 나눠 조각마다 평균 상대 휘도
 *    (다른 배치 · 다른 값은 rimIndex · rimAngle로 sectorMeans를 부른다)
 *  - 바닥 대비 면적: 바닥과 대비 minContrast 이상인 칸 수
 */
export function visibilityDetail(
  r: DrawingRaster,
  floor: number,
  inPx: number,
  bandPx: number,
  opts: VisibilityDetailOptions = {},
): VisibilityDetail {
  const sectors = Math.max(1, Math.round(opts.sectors ?? 8));
  const rot = opts.rot ?? 0;
  const minContrast = opts.minContrast ?? 1.5;
  const { n, rgba } = r;
  const fr = ((floor >> 16) & 255) / 255;
  const fg = ((floor >> 8) & 255) / 255;
  const fb = (floor & 255) / 255;
  const lf = luminance01(fr, fg, fb);
  const on = new Uint8Array(n * n);
  const lum = new Float64Array(n * n);
  let area = 0;
  let sum = 0;
  let contrastArea = 0;
  for (let k = 0; k < n * n; k += 1) {
    const a = rgba[k * 4 + 3] ?? 0;
    const L =
      a <= 0
        ? lf
        : luminance01(
            (rgba[k * 4] ?? 0) + fr * (1 - a),
            (rgba[k * 4 + 1] ?? 0) + fg * (1 - a),
            (rgba[k * 4 + 2] ?? 0) + fb * (1 - a),
          );
    lum[k] = L;
    if (wcagContrast(L, lf) >= minContrast) contrastArea += 1;
    if (a < 0.5) continue;
    on[k] = 1;
    area += 1;
    sum += L;
  }
  const dist = outsideDistance(on, n);
  const cx = r.cx ?? n / 2;
  const cy = r.cy ?? n / 2;
  const idx: number[] = [];
  const ang: number[] = [];
  let rim = 0;
  for (let j = 0; j < n; j += 1)
    for (let i = 0; i < n; i += 1) {
      const k = j * n + i;
      if (!on[k]) continue;
      const edge = (dist[k] ?? 0) - 0.5;
      if (!(edge > inPx && edge <= inPx + bandPx)) continue;
      rim += lum[k] ?? 0;
      idx.push(k);
      let a = Math.atan2(j + 0.5 - cy, i + 0.5 - cx) - rot;
      a -= 2 * Math.PI * Math.round(a / (2 * Math.PI));
      ang.push(a);
    }
  const rimCells = idx.length;
  const rimL = rimCells > 0 ? rim / rimCells : 0;
  const base = {
    area,
    luma: area > 0 ? sum / area : 0,
    rim: rimL,
    rimCells,
    rimContrast: wcagContrast(rimL, lf),
    contrastArea,
    pixelLuma: lum,
    rimIndex: Int32Array.from(idx),
    rimAngle: Float64Array.from(ang),
  };
  const sec = sectorMeans({ ...base, rimSectors: [], rimSectorCells: [] }, (k) => lum[k] ?? 0, sectors);
  return { ...base, rimSectors: sec.mean, rimSectorCells: sec.cells };
}

// ───────────── 색 차이 (CIELAB ΔE76 — 바닥 색조 위장 · 몸 가운데 역할색 점검) ─────────────

/** sRGB 0~1 → CIELAB (D65, L 0~100) */
export function labOf(r: number, g: number, b: number): [number, number, number] {
  const R = toLinear(r);
  const G = toLinear(g);
  const B = toLinear(b);
  const x = (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047;
  const y = 0.2126729 * R + 0.7151522 * G + 0.072175 * B;
  const z = (0.0193339 * R + 0.119192 * G + 0.9503041 * B) / 1.08883;
  const f = (t: number): number => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 / 116) * t + 16 / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** 0xRRGGBB → CIELAB */
export function labHex(c: number): [number, number, number] {
  return labOf(((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255);
}

/** CIELAB 두 색의 ΔE76 (유클리드 거리) */
export function deltaE76(p: readonly number[], q: readonly number[]): number {
  return Math.hypot((p[0] ?? 0) - (q[0] ?? 0), (p[1] ?? 0) - (q[1] ?? 0), (p[2] ?? 0) - (q[2] ?? 0));
}

/** 칸 k를 바닥색(0xRRGGBB) 위에 얹은 색의 CIELAB */
export function pixelLab(r: DrawingRaster, k: number, floor: number): [number, number, number] {
  const a = r.rgba[k * 4 + 3] ?? 0;
  const t = 1 - a;
  return labOf(
    (r.rgba[k * 4] ?? 0) + (((floor >> 16) & 255) / 255) * t,
    (r.rgba[k * 4 + 1] ?? 0) + (((floor >> 8) & 255) / 255) * t,
    (r.rgba[k * 4 + 2] ?? 0) + ((floor & 255) / 255) * t,
  );
}

/**
 * 몸 가운데 원판(원점 둘레 반지름 radiusPx 텍셀, 칸 가운데가 안에 든 칸)에서 두 그림의 색이 ΔE76 > limit만큼 다른 칸의 몫.
 * 두 그림은 같은 격자 · 같은 원점이어야 한다. 색은 바닥 위에 얹어 견준다
 */
export function discDiffShare(
  a: DrawingRaster,
  b: DrawingRaster,
  radiusPx: number,
  floor: number,
  limit: number,
): { share: number; cells: number } {
  if (a.n !== b.n) throw new Error('discDiffShare: 격자 크기가 다르다');
  const n = a.n;
  const cx = a.cx ?? n / 2;
  const cy = a.cy ?? n / 2;
  let cells = 0;
  let diff = 0;
  for (let j = 0; j < n; j += 1)
    for (let i = 0; i < n; i += 1) {
      if (Math.hypot(i + 0.5 - cx, j + 0.5 - cy) > radiusPx) continue;
      const k = j * n + i;
      cells += 1;
      if (deltaE76(pixelLab(a, k, floor), pixelLab(b, k, floor)) > limit) diff += 1;
    }
  return { share: cells > 0 ? diff / cells : 0, cells };
}

// ───────────── 같은 칸 견주기 (의상 유불리 점검 3판) ─────────────
// 조각 대비 · 색조는 기본 그림의 테두리 띠 칸에서 두 그림을 견준다(같은 칸). 그림마다 제 띠를 쓰면 의상이 실루엣을 1px만
// 키워도 띠가 바깥으로 밀려 칸 하나가 조각 평균을 몇 %씩 흔든다(24px에서 조각 하나 = 띠 15칸 안팎) — Canvas에서도 같은
// 그림이 위상에 따라 그렇게 흔들린다. 같은 칸에서 보면 '기본 괴물이 바닥과 갈리던 자리가 의상을 입어도 그만큼 갈리는가'를 잰다.
// 그 자리 밖으로 나온 짙은 깃 끝 같은 테두리는 바닥과 거의 같아 보이는 크기를 키우지 않는다(바닥 대비 면적이 따로 막는다).

/** 조각 하나의 가장 나쁜 비율과 그 자리 (layout = 배치 어긋남, 조각 몫) */
export interface PairedWorst {
  readonly ratio: number;
  readonly at: number;
  readonly layout: number;
}

/**
 * 조각별 바닥 대비: 기본(b) 띠 칸의 조각마다 평균 상대 휘도의 WCAG 대비(바닥 휘도 floorL과)를 의상(x) · 기본에서 구해
 * 의상 / 기본 중 가장 작은 값. layouts = 조각 배치 어긋남들 (0 = 앞 가운데에서 시작, 0.5 = 반 조각)
 */
export function pairedSectorContrast(
  x: VisibilityDetail,
  b: VisibilityDetail,
  floorL: number,
  sectors: number,
  layouts: readonly number[],
): PairedWorst {
  let worst: PairedWorst = { ratio: Infinity, at: -1, layout: 0 };
  for (const layout of layouts) {
    const xs = sectorMeans(b, (k) => x.pixelLuma[k] ?? 0, sectors, layout).mean;
    const bs = sectorMeans(b, (k) => b.pixelLuma[k] ?? 0, sectors, layout).mean;
    for (let q = 0; q < sectors; q += 1) {
      const bl = bs[q] ?? Number.NaN;
      if (Number.isNaN(bl)) continue;
      const ratio = wcagContrast(xs[q] ?? 0, floorL) / wcagContrast(bl, floorL);
      if (ratio < worst.ratio) worst = { ratio, at: q, layout };
    }
  }
  return worst;
}

/**
 * 조각별 바닥 색 차이 (색조 위장): 기본 띠 칸마다 칸 색(바닥 톤 위에 얹은 색)과 바닥 톤의 ΔE76을 조각마다 평균해 의상 / 기본 중
 * 가장 작은 값 · 그 바닥 톤. 띠 칸은 거의 다 불투명이라 바닥 톤과 상관없이 CIELAB을 한 번만 구한다
 */
export function pairedSectorHue(
  x: DrawingRaster,
  b: DrawingRaster,
  bd: VisibilityDetail,
  floors: readonly number[],
  sectors: number,
  layouts: readonly number[],
): PairedWorst & { readonly floor: number } {
  const band = bd.rimIndex;
  const pos = new Map<number, number>();
  band.forEach((k, q) => pos.set(k, q));
  const labs = floors.map((f) => labHex(f));
  const dist = (r: DrawingRaster): Float64Array[] => {
    const out = floors.map(() => new Float64Array(band.length));
    for (let q = 0; q < band.length; q += 1) {
      const k = band[q] ?? 0;
      const own = (r.rgba[k * 4 + 3] ?? 0) >= 0.999 ? pixelLab(r, k, floors[0] ?? 0) : null;
      floors.forEach((f, t) => {
        const arr = out[t];
        if (arr) arr[q] = deltaE76(own ?? pixelLab(r, k, f), labs[t] ?? [0, 0, 0]);
      });
    }
    return out;
  };
  const dx = dist(x);
  const db = dist(b);
  let worst: PairedWorst & { floor: number } = { ratio: Infinity, at: -1, layout: 0, floor: floors[0] ?? 0 };
  floors.forEach((f, t) => {
    const ax = dx[t];
    const ab = db[t];
    if (!ax || !ab) return;
    for (const layout of layouts) {
      const xs = sectorMeans(bd, (k) => ax[pos.get(k) ?? 0] ?? 0, sectors, layout).mean;
      const bs = sectorMeans(bd, (k) => ab[pos.get(k) ?? 0] ?? 0, sectors, layout).mean;
      for (let q = 0; q < sectors; q += 1) {
        const bl = bs[q] ?? Number.NaN;
        if (Number.isNaN(bl) || bl <= 0) continue;
        const ratio = (xs[q] ?? 0) / bl;
        if (ratio < worst.ratio) worst = { ratio, at: q, layout, floor: f };
      }
    }
  });
  return worst;
}

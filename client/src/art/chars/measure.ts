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
  const lut = stopLut(p.stops);
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

/** 칠한 그림: 칸마다 알파 곱한 [r, g, b, a] (sRGB 0~1). 격자는 drawingMask와 같다 (n × n, 범위 ±1.7r, 몸 지름 dpx 칸) */
export interface DrawingRaster {
  readonly n: number;
  readonly rgba: Float32Array;
}

/**
 * 그림을 Node에서 칠한다 (Canvas 없이, 결정적): 명령을 앞에서부터 겹쳐 칠하고(source-over, sRGB 공간 — Canvas2D와 같다)
 * 단색 · 선형 · 원형 칠(정지점 알파), 명령 알파, nonzero · evenodd 규칙, 선(경로 꺾은선까지 거리 ≤ 두께/2 — 둥근 이음,
 * 열린 끝의 butt 끝은 자른다)을 넣는다. 칸마다 ss × ss 표본을 칠해 평균한다(안티에일리어싱). rot = 화면에서 돌린 각
 * (drawingMask와 같은 방향). 명령마다 경계 상자 밖 표본은 건너뛴다
 */
export function drawingRaster(dr: Drawing, dpx: number, rot = 0, ss = 3): DrawingRaster {
  const ext = 1.7;
  const n = Math.ceil(dpx * ext);
  const N = n * ss;
  const h = (2 * ext) / N;
  const buf = new Float64Array(N * N * 4);
  const stamp = new Int32Array(N * N);
  const hits: number[] = [];
  const col = new Float64Array(4);
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  let mark = 0;
  /** 화면 좌표 → 표본 번호 (가운데가 그 좌표보다 크거나 같은 첫 표본) */
  const idx = (v: number): number => Math.ceil((v + ext) / h - 0.5);
  const cover = (k: number): void => {
    if (stamp[k] !== mark) {
      stamp[k] = mark;
      hits.push(k);
    }
  };
  const paint = (smp: Sampler): void => {
    for (const k of hits) {
      const i = k % N;
      const j = (k - i) / N;
      smp(-ext + (i + 0.5) * h, -ext + (j + 0.5) * h, col);
      const sa = col[3] ?? 0;
      if (sa <= 0) continue;
      const o = k * 4;
      for (let q = 0; q < 4; q += 1) buf[o + q] = (col[q] ?? 0) + (buf[o + q] ?? 0) * (1 - sa);
    }
  };
  for (const op of dr.ops) {
    const alpha = op.alpha ?? 1;
    if (alpha <= 0 || (!op.fill && !op.stroke)) continue;
    const subs = pathSubpaths(op.d).map((sp) => ({
      closed: sp.closed,
      pts: sp.pts.map(([x, y]): P2 => [x * c - y * s, x * s + y * c]),
    }));
    if (op.fill) {
      // 칠: 표본 줄마다 변과의 교차점(감김 방향)을 모아 nonzero · evenodd로 구간을 채운다
      mark += 1;
      hits.length = 0;
      const rows = new Map<number, number[]>();
      for (const sp of subs)
        for (let e = 0; e < sp.pts.length; e += 1) {
          const a = sp.pts[e];
          const b = sp.pts[(e + 1) % sp.pts.length];
          if (!a || !b || a[1] === b[1]) continue;
          const up = a[1] < b[1];
          const y0 = up ? a[1] : b[1];
          const y1 = up ? b[1] : a[1];
          // 가운데 y가 [y0, y1)인 표본 줄
          const j0 = Math.max(0, idx(y0));
          const j1 = Math.min(N - 1, idx(y1) - 1);
          for (let j = j0; j <= j1; j += 1) {
            const Y = -ext + (j + 0.5) * h;
            const x = a[0] + ((Y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]);
            let row = rows.get(j);
            if (!row) rows.set(j, (row = []));
            row.push(x, up ? 1 : -1);
          }
        }
      const evenodd = op.rule === 'evenodd';
      for (const [j, row] of rows) {
        const xs: [number, number][] = [];
        for (let q = 0; q < row.length; q += 2) xs.push([row[q] ?? 0, row[q + 1] ?? 0]);
        xs.sort((p, q) => p[0] - q[0]);
        let wn = 0;
        let cross = 0;
        for (let q = 0; q + 1 < xs.length; q += 1) {
          const cur = xs[q];
          const next = xs[q + 1];
          if (!cur || !next) continue;
          wn += cur[1];
          cross += 1;
          if (evenodd ? cross % 2 === 0 : wn === 0) continue;
          const i0 = Math.max(0, idx(cur[0]));
          const i1 = Math.min(N - 1, idx(next[0]) - 1);
          for (let i = i0; i <= i1; i += 1) cover(j * N + i);
        }
      }
      paint(sampler(op.fill, rot, alpha));
    }
    if (op.stroke) {
      // 선: 마디(선분)마다 둥근 캡슐(반폭 hw) 안 표본. 한 명령 안에서 겹친 곳은 한 번만 칠한다 (Canvas 선과 같다)
      mark += 1;
      hits.length = 0;
      const hw = op.stroke.width / 2;
      const butt = op.stroke.cap === 'butt';
      for (const sp of subs) {
        const P = sp.pts;
        const segs = sp.closed ? P.length : P.length - 1;
        if (segs <= 0) continue;
        for (let e = 0; e < segs; e += 1) {
          const a = P[e];
          const b = P[(e + 1) % P.length];
          if (!a || !b) continue;
          const dx = b[0] - a[0];
          const dy = b[1] - a[1];
          const L2 = dx * dx + dy * dy;
          // 열린 끝의 butt 끝: 선분 끝 너머는 칠하지 않는다
          const cutStart = butt && !sp.closed && e === 0;
          const cutEnd = butt && !sp.closed && e === segs - 1;
          const i0 = Math.max(0, idx(Math.min(a[0], b[0]) - hw));
          const i1 = Math.min(N - 1, idx(Math.max(a[0], b[0]) + hw) - 1);
          const j0 = Math.max(0, idx(Math.min(a[1], b[1]) - hw));
          const j1 = Math.min(N - 1, idx(Math.max(a[1], b[1]) + hw) - 1);
          for (let j = j0; j <= j1; j += 1) {
            const Y = -ext + (j + 0.5) * h;
            for (let i = i0; i <= i1; i += 1) {
              const X = -ext + (i + 0.5) * h;
              let t = L2 > 0 ? ((X - a[0]) * dx + (Y - a[1]) * dy) / L2 : 0;
              if ((cutStart && t < 0) || (cutEnd && t > 1)) continue;
              t = Math.max(0, Math.min(1, t));
              if (Math.hypot(X - a[0] - dx * t, Y - a[1] - dy * t) <= hw) cover(j * N + i);
            }
          }
        }
      }
      paint(sampler(op.stroke.paint, rot, alpha));
    }
  }
  // 칸마다 ss × ss 표본 평균
  const rgba = new Float32Array(n * n * 4);
  const k2 = 1 / (ss * ss);
  for (let j = 0; j < N; j += 1)
    for (let i = 0; i < N; i += 1) {
      const o = (j * N + i) * 4;
      const t = (Math.floor(j / ss) * n + Math.floor(i / ss)) * 4;
      for (let q = 0; q < 4; q += 1) rgba[t + q] = (rgba[t + q] ?? 0) + (buf[o + q] ?? 0) * k2;
    }
  return { n, rgba };
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
 * 보이는 정도 자세히 재기. 면적 · 밝기 · 외곽 대비(area · luma · rim · rimCells · rimContrast)는 visibility와 같은 값이다
 * (테두리 띠 거리만 정확한 거리 변환으로 빨리 구한다). 더해서
 *  - 조각별 테두리 띠: 띠 칸을 몸 중심에서 본 각으로 sectors 조각에 나눠 조각마다 평균 상대 휘도
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
    const L = luminance01(
      (rgba[k * 4] ?? 0) + fr * (1 - a),
      (rgba[k * 4 + 1] ?? 0) + fg * (1 - a),
      (rgba[k * 4 + 2] ?? 0) + fb * (1 - a),
    );
    if (wcagContrast(L, lf) >= minContrast) contrastArea += 1;
    if (a < 0.5) continue;
    on[k] = 1;
    area += 1;
    lum[k] = L;
    sum += L;
  }
  const dist = outsideDistance(on, n);
  const secSum = new Float64Array(sectors);
  const secCells = new Float64Array(sectors);
  const step = (2 * Math.PI) / sectors;
  const c = n / 2;
  let rim = 0;
  let rimCells = 0;
  for (let j = 0; j < n; j += 1)
    for (let i = 0; i < n; i += 1) {
      const k = j * n + i;
      if (!on[k]) continue;
      const edge = (dist[k] ?? 0) - 0.5;
      if (!(edge > inPx && edge <= inPx + bandPx)) continue;
      const L = lum[k] ?? 0;
      rim += L;
      rimCells += 1;
      const s =
        ((Math.round((Math.atan2(j + 0.5 - c, i + 0.5 - c) - rot) / step) % sectors) + sectors) % sectors;
      secSum[s] = (secSum[s] ?? 0) + L;
      secCells[s] = (secCells[s] ?? 0) + 1;
    }
  const rimL = rimCells > 0 ? rim / rimCells : 0;
  return {
    area,
    luma: area > 0 ? sum / area : 0,
    rim: rimL,
    rimCells,
    rimContrast: wcagContrast(rimL, lf),
    rimSectors: [...secSum].map((v, q) => ((secCells[q] ?? 0) > 0 ? v / (secCells[q] ?? 1) : Number.NaN)),
    rimSectorCells: [...secCells],
    contrastArea,
  };
}

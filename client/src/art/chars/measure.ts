// 새 캐릭터 그림 재기 (캐릭터 리디자인): 그림 명령의 경로 d를 읽어 곡선 위 점을 샘플하고, 크기 기준을 확인한다.
// Canvas · Path2D 없이 돈다 (단위 테스트 · 시안 도구가 같이 쓴다). 단위 = 판정 반지름, 선 두께는 넣지 않는다.
import type { Drawing } from './kit';

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

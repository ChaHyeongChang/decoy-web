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
 * 크기 기준 (사용자 결정: 기존 시각 명세를 지킨다 — 그림이 판정보다 크면 맞았는지 헷갈린다).
 *  - 생존자: 앞 ±60° 안은 1.55r까지(VISUAL_SPEC 4.1 앞 돌출 한도), 앞쪽 반의 그 밖(옆)은 1.05r, 뒤쪽 반은 1.0r
 *    (옛 shapes.test.ts '옆 · 뒤로는 몸 원 밖으로 나가지 않는다'와 같은 뜻, 옆은 손 둥근 끝 몫 0.05r)
 *  - 괴물: 모든 자세 1.12r(VISUAL_SPEC 4.1 '자락 끝 1.12 이내'를 발톱 · 팔까지), 돌진만 1.35r
 */
export const SIZE_RULE = {
  survivor: { sector: Math.PI / 3, front: 1.55, side: 1.05, back: 1.0 },
  monster: { all: 1.12, dash: 1.35 },
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

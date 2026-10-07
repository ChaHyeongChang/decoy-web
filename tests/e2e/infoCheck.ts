// 정보 차단 검사용 독립 판정기. 서버의 shared/visibility.ts와 다른 방법(작은 간격 표본)으로
// 시선을 계산해서, 같은 함수로 같은 답을 확인하는 순환 검증을 피한다. 경계 근처는 "애매"로 뺀다.
import { MAP_ROWS, type Balance } from '@decoy/shared';

const BLOCK = new Set(['#', 'o', 'N', 'S']);

function blockedAt(x: number, y: number): boolean {
  const row = MAP_ROWS[Math.floor(y)];
  if (!row) return true;
  const ch = row[Math.floor(x)];
  return ch === undefined || BLOCK.has(ch);
}

/** 선분을 0.01타일 간격으로 따라가며 벽을 만나는지 */
function losSampled(ax: number, ay: number, bx: number, by: number): boolean {
  const d = Math.hypot(bx - ax, by - ay);
  const n = Math.max(1, Math.ceil(d / 0.01));
  for (let i = 1; i < n; i += 1) {
    const t = i / n;
    if (blockedAt(ax + (bx - ax) * t, ay + (by - ay) * t)) return false;
  }
  return true;
}

export type Verdict = 'visible' | 'hidden' | 'ambiguous';

/** 시선: 약간씩 흔든 선분들의 결과가 갈리면 애매 */
function los(ax: number, ay: number, bx: number, by: number): Verdict {
  const base = losSampled(ax, ay, bx, by);
  for (const [dx, dy] of [
    [0.04, 0],
    [-0.04, 0],
    [0, 0.04],
    [0, -0.04],
  ] as const) {
    if (losSampled(ax, ay, bx + dx, by + dy) !== base) return 'ambiguous';
  }
  return base ? 'visible' : 'hidden';
}

function angleDiff(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d);
}

/** 괴물이 (tx, ty)를 보는가 */
export function monsterVerdict(
  b: Balance,
  mx: number,
  my: number,
  aim: number,
  blend: number,
  tx: number,
  ty: number,
): Verdict {
  const k = Math.max(0, Math.min(1, blend));
  const s = b.monster.visionModes.search;
  const h = b.monster.visionModes.hunt;
  const half = ((s.angle + (h.angle - s.angle) * k) * Math.PI) / 360;
  const range = s.range + (h.range - s.range) * k;
  const d = Math.hypot(tx - mx, ty - my);
  const near = b.monster.nearVisionRadius;
  const ang = angleDiff(aim, Math.atan2(ty - my, tx - mx));
  const inNear = d <= near;
  const inCone = d <= range && ang <= half;
  const nearEdge =
    Math.abs(d - near) < 0.05 || Math.abs(d - range) < 0.05 || (d > 0.3 && Math.abs(ang - half) < 0.01);
  if (!inNear && !inCone) return nearEdge ? 'ambiguous' : 'hidden';
  const l = los(mx, my, tx, ty);
  if (l === 'ambiguous') return 'ambiguous';
  if (l === 'hidden') return 'hidden';
  return nearEdge ? 'ambiguous' : 'visible';
}

/** 생존자(원형 시야)가 (tx, ty)를 보는가 */
export function circleVerdict(ex: number, ey: number, radius: number, tx: number, ty: number): Verdict {
  const d = Math.hypot(tx - ex, ty - ey);
  const nearEdge = Math.abs(d - radius) < 0.05;
  if (d > radius) return nearEdge ? 'ambiguous' : 'hidden';
  const l = los(ex, ey, tx, ty);
  if (l !== 'visible') return l;
  return nearEdge ? 'ambiguous' : 'visible';
}

/** 여러 판정의 합집합 */
export function anyVisible(verdicts: Verdict[]): Verdict {
  if (verdicts.includes('visible')) return 'visible';
  if (verdicts.includes('ambiguous')) return 'ambiguous';
  return 'hidden';
}

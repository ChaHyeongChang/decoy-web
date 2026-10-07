// 기하 계산: 벡터, 각도, 원-타일 충돌, 타일 레이캐스트, 시야 다각형, 부채꼴 판정.
// 모든 거리는 타일 단위다. 서버 판정과 클라이언트 그리기가 같은 함수를 쓴다.

export interface Vec2 {
  x: number;
  y: number;
}

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export function vec(x: number, y: number): Vec2 {
  return { x, y };
}

export function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function dist2(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

/** 각도를 (-π, π] 범위로 */
export function normalizeAngle(a: number): number {
  let r = a % TAU;
  if (r <= -Math.PI) r += TAU;
  else if (r > Math.PI) r -= TAU;
  return r;
}

/** from에서 to로 가는 가장 짧은 회전량 (-π, π] */
export function angleDiff(from: number, to: number): number {
  return normalizeAngle(to - from);
}

/** current를 target 쪽으로 최대 maxStep만큼 짧은 방향으로 돌린다 */
export function turnToward(current: number, target: number, maxStep: number): number {
  const d = angleDiff(current, target);
  if (Math.abs(d) <= maxStep) return normalizeAngle(target);
  return normalizeAngle(current + Math.sign(d) * maxStep);
}

/** 두 단위 방향 벡터 사이 각도 (라디안, 0~π) */
export function angleBetweenDirs(ax: number, ay: number, bx: number, by: number): number {
  const dot = Math.max(-1, Math.min(1, ax * bx + ay * by));
  return Math.acos(dot);
}

/** 그리드 질의 인터페이스: 타일 (i, j)가 막혀 있는가 */
export type BlockFn = (i: number, j: number) => boolean;

/**
 * 원(center, r)을 막힌 타일들 밖으로 밀어낸다. 반환값은 밀린 뒤 위치.
 * 여러 번 반복해 모서리에서도 안정적으로 빠져나오게 한다.
 */
export function resolveCircleVsTiles(p: Vec2, r: number, blocked: BlockFn): Vec2 {
  let x = p.x;
  let y = p.y;
  for (let iter = 0; iter < 4; iter += 1) {
    let moved = false;
    const i0 = Math.floor(x - r);
    const i1 = Math.floor(x + r);
    const j0 = Math.floor(y - r);
    const j1 = Math.floor(y + r);
    for (let j = j0; j <= j1; j += 1) {
      for (let i = i0; i <= i1; i += 1) {
        if (!blocked(i, j)) continue;
        const cx = Math.max(i, Math.min(x, i + 1));
        const cy = Math.max(j, Math.min(y, j + 1));
        const dx = x - cx;
        const dy = y - cy;
        const d2 = dx * dx + dy * dy;
        if (d2 >= r * r) continue;
        if (d2 > 1e-12) {
          const d = Math.sqrt(d2);
          const push = r - d + 1e-7;
          x += (dx / d) * push;
          y += (dy / d) * push;
        } else {
          // 중심이 타일 안에 들어간 경우: 가장 가까운 면으로 밀어낸다
          const left = x - i;
          const right = i + 1 - x;
          const top = y - j;
          const bottom = j + 1 - y;
          const m = Math.min(left, right, top, bottom);
          if (m === left) x = i - r - 1e-7;
          else if (m === right) x = i + 1 + r + 1e-7;
          else if (m === top) y = j - r - 1e-7;
          else y = j + 1 + r + 1e-7;
        }
        moved = true;
      }
    }
    if (!moved) break;
  }
  return { x, y };
}

/** 원(p, r)을 정지한 원들(obstacles)과 겹치지 않게 밀어낸다 */
export function resolveCircleVsCircles(p: Vec2, r: number, obstacles: readonly Circle[]): Vec2 {
  let x = p.x;
  let y = p.y;
  for (const o of obstacles) {
    const dx = x - o.x;
    const dy = y - o.y;
    const minD = r + o.r;
    const d2 = dx * dx + dy * dy;
    if (d2 >= minD * minD) continue;
    const d = Math.sqrt(d2);
    if (d > 1e-9) {
      const push = minD - d + 1e-7;
      x += (dx / d) * push;
      y += (dy / d) * push;
    } else {
      x += minD;
    }
  }
  return { x, y };
}

/** 원이 막힌 타일에 파고든 최대 깊이 (겹치지 않으면 0) */
export function tilePenetration(p: Vec2, r: number, blocked: BlockFn): number {
  let worst = 0;
  const i0 = Math.floor(p.x - r);
  const i1 = Math.floor(p.x + r);
  const j0 = Math.floor(p.y - r);
  const j1 = Math.floor(p.y + r);
  for (let j = j0; j <= j1; j += 1) {
    for (let i = i0; i <= i1; i += 1) {
      if (!blocked(i, j)) continue;
      const cx = Math.max(i, Math.min(p.x, i + 1));
      const cy = Math.max(j, Math.min(p.y, j + 1));
      const d = Math.hypot(p.x - cx, p.y - cy);
      const inside = p.x > i && p.x < i + 1 && p.y > j && p.y < j + 1;
      const depth = inside ? r + Math.min(p.x - i, i + 1 - p.x, p.y - j, j + 1 - p.y) : r - d;
      if (depth > worst) worst = depth;
    }
  }
  return worst;
}

/** 원이 다른 원들과 겹친 최대 깊이 */
export function circlesPenetration(p: Vec2, r: number, obstacles: readonly Circle[]): number {
  let worst = 0;
  for (const o of obstacles) {
    const depth = r + o.r - Math.hypot(p.x - o.x, p.y - o.y);
    if (depth > worst) worst = depth;
  }
  return worst;
}

export interface Circle {
  x: number;
  y: number;
  r: number;
}

export function circlesOverlap(a: Circle, b: Circle): boolean {
  const rr = a.r + b.r;
  return dist2(a, b) < rr * rr;
}

/**
 * 타일 격자를 따라 광선을 쏴서 처음 막힌 타일까지의 거리를 돌려준다 (최대 maxDist).
 * Amanatides–Woo DDA. 시작 타일이 막혀 있으면 0.
 */
export function raycast(
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  maxDist: number,
  blocked: BlockFn,
): number {
  let i = Math.floor(ox);
  let j = Math.floor(oy);
  if (blocked(i, j)) return 0;
  const stepI = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepJ = dy > 0 ? 1 : dy < 0 ? -1 : 0;
  const tDeltaX = stepI !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDeltaY = stepJ !== 0 ? Math.abs(1 / dy) : Infinity;
  let tMaxX = stepI > 0 ? (i + 1 - ox) * tDeltaX : stepI < 0 ? (ox - i) * tDeltaX : Infinity;
  let tMaxY = stepJ > 0 ? (j + 1 - oy) * tDeltaY : stepJ < 0 ? (oy - j) * tDeltaY : Infinity;
  for (let guard = 0; guard < 4096; guard += 1) {
    let t: number;
    if (tMaxX < tMaxY) {
      t = tMaxX;
      tMaxX += tDeltaX;
      i += stepI;
    } else {
      t = tMaxY;
      tMaxY += tDeltaY;
      j += stepJ;
    }
    if (t >= maxDist) return maxDist;
    if (blocked(i, j)) return t;
  }
  return maxDist;
}

/** a에서 b까지의 선분이 막힌 타일을 지나는가 */
export function segmentBlocked(a: Vec2, b: Vec2, blocked: BlockFn): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return blocked(Math.floor(a.x), Math.floor(a.y));
  const hit = raycast(a.x, a.y, dx / len, dy / len, len, blocked);
  return hit < len - 1e-9;
}

/** 부채꼴 모양: 중심 방향(dir), 전체 각도(arc), 반지름 */
export interface SectorShape {
  dir: number;
  arc: number;
  range: number;
}

/** 점 p가 원점 o의 부채꼴(벽 무시) 안에 있는가 */
export function pointInSector(o: Vec2, s: SectorShape, p: Vec2): boolean {
  const dx = p.x - o.x;
  const dy = p.y - o.y;
  const d2 = dx * dx + dy * dy;
  if (d2 > s.range * s.range) return false;
  if (d2 < 1e-12) return true;
  if (s.arc >= TAU - 1e-9) return true;
  return Math.abs(angleDiff(s.dir, Math.atan2(dy, dx))) <= s.arc / 2 + 1e-9;
}

/** 점에서 선분까지 거리 */
export function pointSegmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len2 = abx * abx + aby * aby;
  let t = len2 > 0 ? ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t));
}

/** 원(c, r)이 부채꼴(o, s)과 겹치는가 (벽 무시) */
export function circleIntersectsSector(o: Vec2, s: SectorShape, c: Vec2, r: number): boolean {
  const d = dist(o, c);
  if (d > s.range + r) return false;
  if (pointInSector(o, s, c)) return true;
  // 부채꼴의 두 직선 변과의 거리
  const half = s.arc / 2;
  for (const side of [-1, 1]) {
    const a = s.dir + side * half;
    const end = { x: o.x + Math.cos(a) * s.range, y: o.y + Math.sin(a) * s.range };
    if (pointSegmentDistance(c, o, end) <= r) return true;
  }
  // 호 부분: 중심 방향이 각도 안이면 d <= range + r 로 이미 겹침
  const ang = Math.atan2(c.y - o.y, c.x - o.x);
  if (Math.abs(angleDiff(s.dir, ang)) <= half && d <= s.range + r) return true;
  return false;
}

/**
 * 시야 다각형: 중심에서 벽 모서리 방향과 일정 간격 방향으로 광선을 쏴서 만든다.
 * sector가 없으면 원형. 반환 점들은 각도 순서(원형) 또는 [중심, 호 점들…](부채꼴).
 */
export function visibilityPolygon(
  center: Vec2,
  radius: number,
  blocked: BlockFn,
  corners: readonly Vec2[],
  sector: SectorShape | null,
  arcStepRad = 4 * DEG,
): Vec2[] {
  const angles: number[] = [];
  const full = sector === null || sector.arc >= TAU - 1e-6;
  const start = full ? -Math.PI : sector.dir - sector.arc / 2;
  const span = full ? TAU : sector.arc;
  const inSpan = (a: number): boolean => {
    if (full) return true;
    const rel = normalizeAngle(a - start);
    const r = rel < 0 ? rel + TAU : rel;
    return r <= span;
  };
  const steps = Math.max(2, Math.ceil(span / arcStepRad));
  for (let k = 0; k <= steps; k += 1) angles.push(start + (span * k) / steps);
  const r2 = (radius + 1.5) * (radius + 1.5);
  for (const c of corners) {
    const dx = c.x - center.x;
    const dy = c.y - center.y;
    if (dx * dx + dy * dy > r2) continue;
    const a = Math.atan2(dy, dx);
    for (const eps of [-1e-4, 0, 1e-4]) {
      const aa = a + eps;
      if (inSpan(aa)) angles.push(aa);
    }
  }
  const rel = (a: number): number => {
    const v = normalizeAngle(a - start);
    return full ? v : v < 0 ? v + TAU : v;
  };
  angles.sort((p, q) => rel(p) - rel(q));
  const pts: Vec2[] = [];
  if (!full) pts.push({ x: center.x, y: center.y });
  let prevA = Number.NaN;
  for (const a of angles) {
    if (Math.abs(a - prevA) < 1e-7) continue;
    prevA = a;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    const d = raycast(center.x, center.y, dx, dy, radius, blocked);
    pts.push({ x: center.x + dx * d, y: center.y + dy * d });
  }
  return pts;
}

/** 점이 다각형 안에 있는가 (짝홀 규칙) */
export function pointInPolygon(p: Vec2, poly: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const a = poly[i];
    const b = poly[j];
    if (!a || !b) continue;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

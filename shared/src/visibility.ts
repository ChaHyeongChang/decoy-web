// "누가 무엇을 볼 수 있는가" 판정. 서버(정보 차단)와 클라이언트(안개 그리기)가 같이 쓴다.
// 판정 기준: 대상 중심점이 시야 영역(반경 · 각도 · 벽 차단) 안에 있는가. 반경은 하드 컷.
import type { Balance, RoleId } from './balance';
import {
  DEG,
  TAU,
  pointInSector,
  segmentBlocked,
  visibilityPolygon,
  type SectorShape,
  type Vec2,
} from './geometry';
import { VISION_CORNERS, blocksVision } from './map';

/** 괴물 부채꼴 모양: 탐색(0) ↔ 추적(1) 사이를 선형 보간 */
export function monsterConeShape(balance: Balance, blend: number): { arc: number; range: number } {
  const k = Math.max(0, Math.min(1, blend));
  const s = balance.monster.visionModes.search;
  const h = balance.monster.visionModes.hunt;
  return {
    arc: (s.angle + (h.angle - s.angle) * k) * DEG,
    range: s.range + (h.range - s.range) * k,
  };
}

export function monsterCone(balance: Balance, aim: number, blend: number): SectorShape {
  const shape = monsterConeShape(balance, blend);
  return { dir: aim, arc: shape.arc, range: shape.range };
}

/** 생존자 시야 반지름 (스카우트는 넓다) */
export function survivorVisionRadius(balance: Balance, role: RoleId): number {
  return role === 'scout' ? balance.roles.scout.visionRadius : balance.survivor.visionRadius;
}

/** 두 점 사이 시선이 벽에 막히지 않는가 (철창 · 감옥 문은 시선을 통과시킨다) */
export function lineOfSight(a: Vec2, b: Vec2): boolean {
  return !segmentBlocked(a, b, blocksVision);
}

/** 원형 시야 안인가 */
export function inCircleVision(eye: Vec2, radius: number, target: Vec2): boolean {
  const dx = target.x - eye.x;
  const dy = target.y - eye.y;
  if (dx * dx + dy * dy > radius * radius) return false;
  return lineOfSight(eye, target);
}

/** 괴물이 대상 지점을 보는가: 부채꼴 ∪ 근접 원, 벽 차단 */
export function monsterSees(balance: Balance, eye: Vec2, aim: number, blend: number, target: Vec2): boolean {
  const cone = monsterCone(balance, aim, blend);
  const near = balance.monster.nearVisionRadius;
  const dx = target.x - eye.x;
  const dy = target.y - eye.y;
  const d2 = dx * dx + dy * dy;
  const inNear = d2 <= near * near;
  if (!inNear && !pointInSector(eye, cone, target)) return false;
  return lineOfSight(eye, target);
}

/** 생존자 한 명의 시야 다각형 (원형) */
export function survivorVisionPolygon(center: Vec2, radius: number): Vec2[] {
  return visibilityPolygon(center, radius, blocksVision, VISION_CORNERS, null);
}

/** 괴물 부채꼴 다각형 (벽에 잘림) */
export function monsterConePolygon(balance: Balance, eye: Vec2, aim: number, blend: number): Vec2[] {
  const cone = monsterCone(balance, aim, blend);
  return visibilityPolygon(eye, cone.range, blocksVision, VISION_CORNERS, cone, 2 * DEG);
}

/** 괴물 근접 원 다각형 (벽에 잘림) */
export function monsterNearPolygon(balance: Balance, eye: Vec2): Vec2[] {
  return visibilityPolygon(
    eye,
    balance.monster.nearVisionRadius,
    blocksVision,
    VISION_CORNERS,
    null,
    12 * DEG,
  );
}

export const FULL_CIRCLE = TAU;

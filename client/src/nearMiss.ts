// 아슬아슬 회피 (플레이테스트 반영 c 손맛, docs/playtest/c-juice.md 5절 (나)): 생존자 화면이 자기 스냅샷만으로 판단한다.
// 서버 · 공유 코드 · 프로토콜은 그대로다 — 쓰는 값은 같은 스냅샷의 attackHit{x, y, dir}(서버가 괴물이 팀 시야 안일 때만 보낸다) ·
// 내 서버 자리(you.move — 예측 자리 아님) · 내 상태 · 보호 · hit{you:true} 유무 · balance · 맵(blocksStrike)뿐이라 새 정보가 0이다.
// 괴물 화면에는 어떤 형태로도 없다(역할이 괴물이면 늘 거짓 — 띠 안 자리의 13~41%가 괴물 시야 밖이라 알리면 시야 밖 존재가 샌다).
// 띠 폭 δ는 판정 · 정보와 무관한 그림 값이라 balance.json이 아니라 여기 둔다(선례 camera.SHAKE · charFrames.NEW_POSE_MS)
import {
  blocksStrike,
  circleIntersectsSector,
  segmentBlocked,
  type GameEvent,
  type Vec2,
} from '@decoy/shared';
import type { Role, SurvivorStatus } from '@decoy/shared';

/**
 * 아슬아슬 표시 값: 띠 폭 δ(타일, 몸 가장자리와 판정 부채꼴 사이 — 걸어서 약 60ms), 글자 표시 시간(ms) · 떠오르는 높이(논리 px),
 * 글자를 몸 중심에서 띄우는 거리 · 글자가 차지하는 원(몸 반지름 배수 — 이웃 몸을 비킬 때 쓴다)
 */
export const NEAR_MISS = { delta: 0.3, labelMs: 500, risePx: 6, labelDist: 2.6, labelR: 1.3 } as const;

/** 판단에 쓰는 값 (모두 받는 사람이 이미 가진 것) */
export interface NearMissInput {
  role: Role;
  /** 내 상태 · 보호 남은 시간 (스냅샷 you.surv) */
  status: SurvivorStatus | null;
  protectLeft: number;
  /**
   * 지난 스냅샷의 보호 남은 시간. 서버 한 틱은 타격 판정(보호 > 0이면 무효) 뒤에 보호를 깎으므로, 보호가 (0, dt] 남은 틱에 막힌 타격은
   * protectLeft 0인 스냅샷에 실려 온다(그 틱에 스냅샷이 없으면 다음 틱 — 두 틱까지). 지난 스냅샷이 보호 중이었으면 회피로 보지 않는다
   */
  prevProtectLeft: number;
  /** 그 스냅샷의 내 서버 자리 (you.move) */
  me: Vec2;
  /** 같은 스냅샷의 이벤트 (hit{you:true}가 있으면 회피가 아니다) */
  events: readonly GameEvent[];
  /** balance: 공격 사거리(타일) · 각도(도) · 생존자 몸 반지름 */
  range: number;
  arcDeg: number;
  bodyR: number;
}

/**
 * 이 스냅샷의 타격(attackHit) 가운데 나를 아슬아슬하게 비껴간 것 (없으면 null). 조건: 내가 생존자 · 자유 · 보호 중 아님(이번 · 지난 스냅샷 모두 —
 * 보호가 막아 준 것은 회피가 아니다. 보호가 막 끝난 직후의 진짜 회피도 드물게 놓치지만 판정과 어긋난 표시보다 안전하다) ·
 * 같은 스냅샷에 내 피격 없음 · 타격 자리와 내 자리 사이가 벽 · 철창(blocksStrike)에 막히지 않음 · 몸 원(반지름 + δ)이 판정
 * 부채꼴과 겹침. 판정 부채꼴 안인데 안 맞은 경우(타격 직후 한 틱 사이에 들어온 가장 가까운 회피)도 참이다
 */
export function nearMissStrike(p: NearMissInput): Extract<GameEvent, { k: 'attackHit' }> | null {
  if (p.role === 'monster' || p.status !== 'free' || p.protectLeft > 0 || p.prevProtectLeft > 0) return null;
  let strike: Extract<GameEvent, { k: 'attackHit' }> | null = null;
  for (const ev of p.events) {
    if (ev.k === 'hit' && ev.you) return null;
    if (ev.k === 'attackHit' && !strike) strike = ev;
  }
  if (!strike) return null;
  const sector = { dir: strike.dir, arc: (p.arcDeg * Math.PI) / 180, range: p.range };
  if (!circleIntersectsSector(strike, sector, p.me, p.bodyR + NEAR_MISS.delta)) return null;
  return segmentBlocked(strike, p.me, blocksStrike) ? null : strike;
}

/** 이웃 몸 원 (타일) */
export interface Body {
  x: number;
  y: number;
  r: number;
}

/** 글자 자리 후보 방향 (위 → 비스듬히 위 → 아래 → 옆) */
const LABEL_DIRS: readonly number[] = [-90, -55, -125, 90, 55, 125, 0, 180].map((d) => (d * Math.PI) / 180);

/**
 * "아슬아슬" 글자를 둘 방향 (라디안): 몸 중심에서 labelDist × 몸 반지름 떨어진 원(labelR × 몸 반지름)이 이웃 몸(특히 바로 옆 괴물)과
 * 겹치지 않는 첫 후보. 지난 방향이 아직 비어 있으면 그대로(글자가 깜빡이며 옮겨 다니지 않게), 다 막히면 위
 */
export function labelSlot(self: Vec2, bodyR: number, others: readonly Body[], prev: number | null): number {
  const d = NEAR_MISS.labelDist * bodyR;
  const r = NEAR_MISS.labelR * bodyR;
  const free = (a: number): boolean => {
    const x = self.x + Math.cos(a) * d;
    const y = self.y + Math.sin(a) * d;
    for (const o of others) if (Math.hypot(x - o.x, y - o.y) < r + o.r) return false;
    return true;
  };
  if (prev !== null && free(prev)) return prev;
  for (const a of LABEL_DIRS) if (free(a)) return a;
  return LABEL_DIRS[0] ?? -Math.PI / 2;
}

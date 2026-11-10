// 탭 공격 조준 보정 (플레이테스트 반영 a-2, 터치 괴물). 순수 함수 — DOM · Phaser · 앱 상태를 import하지 않는다(@decoy/shared만).
// 짧은 탭 · '누르면 바로' 공격은 방향을 고를 수 없다(이동 방향 그대로). 화면에 보이는 자유 생존자가 그 방향 가까이, 공격이 닿는
// 거리 안에 있으면 그쪽으로 조금만 돌린 각도를 돌려준다. 끌어 놓기 · 돌진 · PC 클릭에는 쓰지 않는다(touchInput.ts ctx.assist).
// 서버로 가는 것은 aim 숫자뿐이다: 보정한 aim을 한 프레임 먼저 보내고 공격한다 — 회전 상한(540°/초) · 공격 판정은 서버가 PC와
// 똑같이 한다. PC가 마우스를 그 각도에 두고 한 프레임 뒤 클릭한 것과 전송 원문이 같다.
// 정보 숨김: 입력은 괴물 스냅샷에 온 생존자의 자리 · 상태 · 보호뿐이다(AssistTarget — ID · 역할 · 체력이 타입에 없다). 스냅샷에
// 없는 생존자(부채꼴 밖 · 벽 뒤)는 클라이언트 메모리에 없어 반응할 수 없고, 포효로 드러난 자리(이벤트로 따로 온 좌표)도 받지 않는다.
// PC보다 유리하지 않게 고정한 관계(tests/unit/aim-assist.test.ts가 balance에서 읽어 본다):
//  maxTurnDeg < 한 입력 프레임 회전량(aimTurnRateDeg / serverTickHz = 18°) < 공격 호의 반(45°), coneDeg ≤ 호의 반,
//  보정은 지금 방향과 대상 사이에서 멈추고(gain < 1 — 어긋남의 절반은 남는다), 공격을 앞당기지 않는다(같거나 한 프레임 늦다)
import {
  DEG,
  angleDiff,
  blocksStrike,
  normalizeAngle,
  segmentBlocked,
  type Balance,
  type SurvivorStatus,
  type Vec2,
} from '@decoy/shared';

/** 보정 수치 (입력 해석 값 — 판정 수치가 아니라 balance.json이 아닌 여기 둔다. 거리만 balance의 공격 사거리에서 만든다) */
export const ASSIST = {
  /** 대상이 지금 방향에서 이 각도 안일 때만 (도). 공격 호의 반(45°)보다 작다: 탭한 순간 이미 호 안에 있는 대상만 */
  coneDeg: 30,
  /** 어긋난 각도 중 돌려 주는 비율. 다 맞추지 않는다 — 마우스를 대상 위에 둔 PC(어긋남 0)보다 늘 덜 맞는다 */
  gain: 0.5,
  /** 보정 폭 상한 (도). 한 입력 프레임 회전량(18°)보다 작다: 한 프레임에 다 돌고 공격은 한 프레임(33ms)만 늦는다 */
  maxTurnDeg: 12,
  /** 이보다 작게 어긋나면 보정하지 않고 바로 낸다 (도): 돌릴 폭이 4° 미만이면 33ms를 쓸 값어치가 없다 */
  minDeg: 8,
  /** 닿는 거리(사거리 + 생존자 반지름)에 더하는 여유 (타일): 준비 0.4초 동안 좁혀지는 만큼 */
  extraRange: 0.2,
} as const;

/** 보정 대상 하나: 괴물 스냅샷의 생존자에서 자리 · 상태 · 보호만 (ID · 역할 · 체력은 받지 않는다) */
export interface AssistTarget {
  readonly x: number;
  readonly y: number;
  readonly status: SurvivorStatus;
  readonly protected: boolean;
}

/** 보정 대상 거리 상한 (타일): 공격이 닿는 거리 + 여유 */
export function assistRange(balance: Balance): number {
  return balance.monster.attack.range + balance.survivor.radius + ASSIST.extraRange;
}

/**
 * 탭 공격 방향 보정. base = 지금 방향(예측 face), me = 내 자리, targets = 화면에 보이는 생존자(assistTargets), range = assistRange.
 * 대상 가운데 base와 각도 차가 가장 작은 것(같으면 가까운 것)을 골라 어긋남의 gain만큼, 최대 maxTurnDeg 돌린 각도를 돌려준다.
 * 대상이 없거나 어긋남이 minDeg보다 작으면 base 그대로(같은 값)다. 배열 순서 · 누구인지와 무관하다
 */
export function assistAim(base: number, me: Vec2, targets: readonly AssistTarget[], range: number): number {
  let best = 0;
  let bestAbs = Infinity;
  let bestDist = Infinity;
  for (const t of targets) {
    // 맞을 수 있는 대상만: 자유 상태 · 구조 직후 보호가 아님 (둘 다 괴물 화면에 그대로 보이는 값)
    if (t.status !== 'free' || t.protected) continue;
    const dx = t.x - me.x;
    const dy = t.y - me.y;
    const d = Math.hypot(dx, dy);
    if (d > range || d < 1e-6) continue;
    const delta = angleDiff(base, Math.atan2(dy, dx));
    const abs = Math.abs(delta);
    if (abs > ASSIST.coneDeg * DEG) continue;
    // 공격 판정선(서버 strike와 같은 타일 규칙)이 막히면 대상이 아니다: 벽 · 기둥 · 철창 너머
    if (segmentBlocked(me, t, blocksStrike)) continue;
    if (abs < bestAbs - 1e-9 || (Math.abs(abs - bestAbs) <= 1e-9 && d < bestDist)) {
      best = delta;
      bestAbs = abs;
      bestDist = d;
    }
  }
  if (bestAbs < ASSIST.minDeg * DEG || bestAbs === Infinity) return base;
  const turn = Math.min(bestAbs * ASSIST.gain, ASSIST.maxTurnDeg * DEG);
  return normalizeAngle(base + Math.sign(best) * turn);
}

/**
 * 보정 대상 = 마지막 스냅샷의 생존자 ∩ 이번 프레임에 그린 생존자. 자리는 그린 자리(100ms 늦은 보간 — 화면에 보이는 그대로)다.
 * 스냅샷에만 있으면(아직 그리지 않음) 화면보다 앞선 정보이고, 그린 것에만 있으면(스냅샷에서 빠짐) 서버가 이미 안 보인다고 한
 * 생존자라 둘 다 뺀다. 상태 · 보호도 둘 중 맞을 수 없는 쪽을 따른다. 결과에는 자리 · 상태 · 보호만 담는다(ID · 역할을 넘기지 않는다)
 */
export function assistTargets(
  snap: readonly (AssistTarget & { readonly id: string })[],
  drawn: ReadonlyMap<string, AssistTarget>,
): AssistTarget[] {
  const out: AssistTarget[] = [];
  for (const s of snap) {
    const d = drawn.get(s.id);
    if (!d) continue;
    out.push({
      x: d.x,
      y: d.y,
      status: d.status === 'free' ? s.status : d.status,
      protected: s.protected || d.protected,
    });
  }
  return out;
}

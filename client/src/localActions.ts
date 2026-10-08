// 괴물 행동의 즉시 피드백 (M8): 공격 준비 · 돌진을 서버 확인 전에 내 화면에 먼저 보여 준다.
// 판정은 서버가 한다. 여기서는 "서버가 받아들일 것 같은가"만 마지막 스냅샷으로 어림하고,
// 틀리면 서버 상태로 보정된다 (공격 준비 표시는 서버가 그 입력을 처리한 뒤 서버 값을 따른다).
import { BTN, type Balance, type MonsterSelf, type MoveState } from '@decoy/shared';

export interface LocalWindup {
  seq: number;
  /** 준비가 끝나는 시각 (performance.now) */
  until: number;
  dir: number;
}

export interface MonsterPressInput {
  pressed: number;
  move: MoveState;
  mon: MonsterSelf;
  balance: Balance;
  /** 마지막 스냅샷 이후 지난 시간 + 서버까지 가는 시간 (초): 쿨타임이 그만큼 더 줄어 있을 것 */
  ageSec: number;
  /** 이미 예측한 공격 준비가 진행 중인가 */
  localWindupActive: boolean;
}

export interface MonsterPressResult {
  attack: boolean;
  dash: boolean;
}

/** 서버 규칙(공격 · 돌진 가능 조건)을 그대로 따라 어림한다: 대기 · 기절 · 돌진 · 준비 중이면 불가, 쿨타임이 남으면 불가 */
export function predictMonsterPress(i: MonsterPressInput): MonsterPressResult {
  const canAct =
    i.move.frozen <= 0 && i.move.stun <= 0 && i.move.dash <= 0 && i.mon.windup <= 0 && !i.localWindupActive;
  const attack = canAct && (i.pressed & BTN.ATTACK) !== 0 && i.mon.attackCd - i.ageSec <= 0;
  // 같은 입력에서 공격이 먼저 처리되면 준비 중이라 돌진은 거절된다 (서버 처리 순서와 같게)
  const dash = canAct && !attack && (i.pressed & BTN.DASH) !== 0 && i.mon.dashCd - i.ageSec <= 0;
  return { attack, dash };
}

/** 공격 준비: 조준 고정 */
export function applyWindupLock(balance: Balance): (s: MoveState) => void {
  const windup = balance.monster.attack.windup;
  return (s) => {
    s.aimLock = Math.max(s.aimLock, windup);
  };
}

/** 돌진 시작: 발동 순간의 조준 방향으로 */
export function applyDashStart(balance: Balance): (s: MoveState) => void {
  const d = balance.monster.dash;
  return (s) => {
    s.dash = d.duration;
    s.dashLeft = d.distance;
    s.dashDx = Math.cos(s.face);
    s.dashDy = Math.sin(s.face);
  };
}

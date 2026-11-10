// 괴물 행동의 즉시 피드백 (M8): 공격 준비 · 돌진을 서버 확인 전에 내 화면에 먼저 보여 준다.
// 판정은 서버가 한다. 여기서는 "서버가 받아들일 것 같은가"만 마지막 스냅샷으로 어림하고,
// 틀리면 서버 상태로 보정된다 (공격 준비 표시는 서버가 그 입력을 처리한 뒤 서버 값을 따른다).
import { BTN, type Balance, type MonsterSelf, type MoveState } from '@decoy/shared';

export interface MonsterPressInput {
  pressed: number;
  move: MoveState;
  mon: MonsterSelf;
  balance: Balance;
  /**
   * 마지막 스냅샷의 서버 틱 뒤, 이 입력을 서버가 처리할 때까지 흐를 시간 (초, cooldownAheadSec): 쿨타임이 그만큼 더 줄어 있을 것.
   * 스냅샷이 오는 데 걸린 편도 시간까지 들어 있어야 한다 — 예전 식(받은 뒤 흐른 시간 + 왕복 / 2)은 그만큼 모자라 쿨타임이 끝나는
   * 무렵 약 왕복 / 2 동안 서버는 받아들이는데 예측은 꺼져 있었다 (플레이테스트 반영 a-4)
   */
  ageSec: number;
  /** 이미 보여 주는 공격 준비가 있는가 (WindupShow.active — 예측 · 서버 확인 · 끝에서 대기 중) */
  localWindupActive: boolean;
}

export interface MonsterPressResult {
  attack: boolean;
  dash: boolean;
}

/**
 * 마지막 스냅샷(ack까지 처리한 틱의 값) 뒤, 새 입력 seq를 서버가 처리할 때까지 흐를 시간 (초). 서버는 틱마다 내 입력 하나를
 * 처리하므로 입력 줄로 센다: ack + 1은 다음 틱(쿨타임은 스냅샷 값 그대로), ack + k는 k − 1틱 뒤다. 시계 · 왕복 어림이 필요 없다
 * (예측기가 이동을 맞추는 방식과 같다)
 */
export function inputAheadSec(seq: number, ack: number, dt: number): number {
  return Math.max(0, seq - ack - 1) * dt;
}

/**
 * 쿨타임 어림에 쓰는 '흐를 시간' (초): 입력 줄로 센 값(inputAheadSec). 다만 예전 시계 어림(스냅샷을 받은 뒤 흐른 시간 sinceSnapMs
 * + 왕복 rttMs / 2 — 스냅샷이 오는 편도 시간이 빠져 늘 실제보다 짧다)보다 작게 보지는 않는다: 탭이 잠깐 멈췄다 깨어 입력 틱을
 * 건너뛰면(한 번에 따라잡는 틱 수에 상한이 있다) 그 왕복 동안 입력 줄이 실제 시간보다 짧아져 예전 식보다도 모자란다
 */
export function cooldownAheadSec(
  seq: number,
  ack: number,
  dt: number,
  sinceSnapMs: number,
  rttMs: number,
): number {
  return Math.max(inputAheadSec(seq, ack, dt), (Math.max(0, sinceSnapMs) + Math.max(0, rttMs) / 2) / 1000);
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

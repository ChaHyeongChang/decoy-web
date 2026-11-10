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

/** 입력 줄 어림의 끊김 보정 (판정 수치가 아니라 내 화면 예측의 어림 값이라 balance.json이 아니라 여기 둔다 — WINDUP_SHOW와 같다) */
export const INPUT_LAG = {
  /** 기준선(스냅샷의 서버 틱 − ack 가운데 가장 작은 값)을 볼 최근 스냅샷 수 (20Hz면 2초) */
  window: 40,
  /** 기준선보다 이만큼(틱)까지 뒤처진 것은 지터로 보고 입력 줄을 그대로 센다 */
  slackTicks: 1,
} as const;

/**
 * 서버가 내 입력을 평소 몇 틱 늦게 처리하는가: 스냅샷의 '서버 틱 − ack'의 최근 최솟값 (플레이테스트 반영 a-4 검토).
 * 입력 줄(inputAheadSec)은 '서버가 틱마다 내 입력을 하나씩 처리한다'를 전제로 한다. 올라가는 길이 잠깐 끊기면(와이파이 ·
 * 이동통신의 재전송) 서버는 내 입력 없이 틱을 넘기고(ack가 멈춘다) 밀린 입력이 한꺼번에 오면 한 틱에 여럿을 처리한다(크레딧 ·
 * 빚 · 큐 상한 — shared/src/sim/game.ts). 그 사이 스냅샷으로 센 입력 줄은 굶은 틱만큼 길어, 쿨타임 끝 무렵 누름을 서버가
 * 버리는데 예측했다(헛 준비 범위 + 소리). 기준선보다 slackTicks 넘게 뒤처진 틱 수(excess)만큼은 입력 줄에서 뺀다.
 * ack가 0인 스냅샷(내 입력을 아직 하나도 처리하지 않은 판 초반)은 서버 틱만 커 기준선을 낮추므로 세지 않는다
 */
export class InputLagBase {
  private readonly ring: number[] = [];
  private next = 0;
  private min = Number.POSITIVE_INFINITY;

  /** 스냅샷마다 (오래된 스냅샷도): tick = 서버 틱, ack = 서버가 처리한 내 마지막 입력 */
  note(tick: number, ack: number): void {
    if (ack <= 0) return;
    const lag = tick - ack;
    if (this.ring.length < INPUT_LAG.window) this.ring.push(lag);
    else this.ring[this.next] = lag;
    this.next = (this.next + 1) % INPUT_LAG.window;
    let m = Number.POSITIVE_INFINITY;
    for (const v of this.ring) if (v < m) m = v;
    this.min = m;
  }

  /** 이 스냅샷(tick, ack)의 입력 줄이 평소보다 길게 센 틱 수 (0 이상) */
  excess(tick: number, ack: number): number {
    if (ack <= 0 || !Number.isFinite(this.min)) return 0;
    return Math.max(0, tick - ack - this.min - INPUT_LAG.slackTicks);
  }
}

/**
 * 쿨타임 어림에 쓰는 '흐를 시간' (초): 입력 줄로 센 값(inputAheadSec)에서, 올라가는 길이 끊겨 서버가 평소보다 뒤처진 틱 수
 * excessTicks(InputLagBase.excess)를 뺀다. 다만 예전 시계 어림(스냅샷을 받은 뒤 흐른 시간 sinceSnapMs + 왕복 rttMs / 2 — 스냅샷이
 * 오는 편도 시간이 빠져 늘 실제보다 짧다)보다 작게 보지는 않는다: 탭이 잠깐 멈췄다 깨어 입력 틱을 건너뛰면(한 번에 따라잡는 틱
 * 수에 상한이 있다) 그 왕복 동안 입력 줄이 실제 시간보다 짧아져 예전 식보다도 모자란다
 */
export function cooldownAheadSec(
  seq: number,
  ack: number,
  dt: number,
  sinceSnapMs: number,
  rttMs: number,
  excessTicks = 0,
): number {
  const line = inputAheadSec(seq, ack + Math.max(0, excessTicks), dt);
  return Math.max(line, (Math.max(0, sinceSnapMs) + Math.max(0, rttMs) / 2) / 1000);
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

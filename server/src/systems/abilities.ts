// 능력 (GAME_DESIGN 5.2 · 5.3 · 6.3)
//   괴물 돌진(Shift): 조준 방향으로 0.25초에 4타일, 벽 · 몸에 닿으면 멈춤, 쿨 12초
//   괴물 포효(Q): 반경 10 안 생존자 위치를 괴물에게 1.5초 표시(벽 무시) / 대가로 괴물 위치가 생존자에게 1초, 쿨 30초
//   러너 질주: 3초간 ×1.45 / 가드 밀치기: 2타일 안(벽 없이) 괴물 1.5초 기절 / 스카우트 탐지: 4초간 괴물 위치 공유
//   능력을 쓰면 괴물 화면에서 그 생존자에게 역할 색이 1초 보인다 (괴물 시야 안일 때만)
import {
  BTN,
  blocksStrike,
  countdown,
  monsterSees,
  segmentBlocked,
  type GameEvent,
  type InputFrame,
} from '@decoy/shared';
import type { Game } from '../game';
import type { MonsterState, SurvivorState } from '../state';
import { cancelWindup, emitIfMonsterVisible, monsterCanAct } from './combat';

/** 괴물 능력 입력 (돌진 · 포효) */
export function monsterAbilityInput(game: Game, m: MonsterState, input: InputFrame): void {
  const b = game.balance.monster;
  if ((input.pressed & BTN.DASH) !== 0 && monsterCanAct(m) && m.dashCd <= 0) {
    m.move.dash = b.dash.duration;
    m.move.dashLeft = b.dash.distance;
    m.move.dashDx = Math.cos(m.move.face);
    m.move.dashDy = Math.sin(m.move.face);
    m.dashCd = b.dash.cooldown;
    const ev: GameEvent = { k: 'dash', x: m.move.x, y: m.move.y, dir: m.move.face };
    game.emitTo(m, ev);
    emitIfMonsterVisible(game, ev);
  }
  if ((input.pressed & BTN.ROAR) !== 0 && monsterCanAct(m) && m.roarCd <= 0) {
    m.roarCd = b.roar.cooldown;
    // 발동 순간 한 번: 반경 안 생존자(자유 · 수감) 좌표만, ID · 역할 없이
    const pts = game.survivors
      .filter(
        (s) =>
          (s.status === 'free' || s.status === 'imprisoned') &&
          Math.hypot(s.move.x - m.move.x, s.move.y - m.move.y) <= b.roar.radius,
      )
      .map((s) => ({ x: Math.round(s.move.x * 1000) / 1000, y: Math.round(s.move.y * 1000) / 1000 }));
    game.emitTo(m, { k: 'roarPings', pts });
    // 대가: 생존자 화면에 괴물 위치(발동 순간)를 1초 고정 마커로
    m.roarRevealLeft = b.roar.selfRevealDuration;
    m.roarX = m.move.x;
    m.roarY = m.move.y;
    for (const s of game.survivors) {
      game.emitTo(s, { k: 'roar', x: m.roarX, y: m.roarY });
      game.emitTo(s, { k: 'text', id: 'ALERT_ROAR' });
    }
  }
}

/** 기절: 공격 준비 취소, 돌진 즉시 정지, 이동 · 조준 · 공격 · 능력 · 모드 전환 불가 */
export function stunMonster(game: Game, m: MonsterState, seconds: number): void {
  m.move.stun = Math.max(m.move.stun, seconds);
  cancelWindup(m);
  m.move.dash = 0;
  m.move.dashLeft = 0;
  const ev: GameEvent = { k: 'stunned' };
  game.emitTo(m, ev);
  emitIfMonsterVisible(game, ev);
}

/** 생존자 고유 능력 입력 (Space) */
export function survivorAbilityInput(game: Game, s: SurvivorState, input: InputFrame): void {
  if ((input.pressed & BTN.ABILITY) === 0) return;
  if (s.status !== 'free' || s.abilityCd > 0) return;
  const r = game.balance.roles;
  const m = game.monster;
  switch (s.role) {
    case 'runner':
      s.move.sprint = r.runner.sprintDuration;
      s.abilityActive = r.runner.sprintDuration;
      s.abilityCd = r.runner.cooldown;
      break;
    case 'guard': {
      const d = Math.hypot(m.move.x - s.move.x, m.move.y - s.move.y);
      if (d > r.guard.shoveRange || segmentBlocked(s.move, m.move, blocksStrike)) {
        // 대상이 없으면 발동하지 않는다 (쿨 · 정체 노출 없음)
        game.emitTo(s, { k: 'shoveMiss' });
        return;
      }
      stunMonster(game, m, r.guard.stunDuration);
      s.abilityCd = r.guard.cooldown;
      break;
    }
    case 'scout':
      m.trackedLeft = r.scout.trackDuration;
      s.abilityActive = r.scout.trackDuration;
      s.abilityCd = r.scout.cooldown;
      break;
    default:
      return;
  }
  // 정체 노출: 1초 동안 괴물 시야 안에 있으면 괴물 스냅샷에 역할이 붙는다
  s.revealLeft = game.balance.survivor.abilityRevealDuration;
  for (const t of game.survivors)
    game.emitTo(t, { k: 'ability', role: s.role, you: t === s, x: s.move.x, y: s.move.y });
  if (monsterSees(game.balance, m.move, m.move.face, m.blend, s.move)) {
    game.emitTo(m, { k: 'ability', role: s.role, you: false, x: s.move.x, y: s.move.y });
  }
}

/** 틱마다: 쿨타임 · 효과 시간 감소 */
export function abilitiesTick(game: Game): void {
  const dt = game.dt;
  const m = game.monster;
  m.dashCd = countdown(m.dashCd, dt);
  m.roarCd = countdown(m.roarCd, dt);
  m.roarRevealLeft = countdown(m.roarRevealLeft, dt);
  m.trackedLeft = countdown(m.trackedLeft, dt);
  for (const s of game.survivors) {
    s.abilityCd = countdown(s.abilityCd, dt);
    s.abilityActive = countdown(s.abilityActive, dt);
    s.revealLeft = countdown(s.revealLeft, dt);
  }
}

// 감옥 구조 (GAME_DESIGN 6.2): 문 앞에서 E를 3초 누르고 있으면 감옥 안 전원이 풀려나고 4초 보호
import { BTN, RELEASE_SLOTS, RESCUE_POINT } from '@decoy/shared';
import type { Game } from '../game';
import type { SurvivorState } from '../state';

/** 구조 구역 안인가 (문 바깥 중심에서 rescueRadius) */
export function inRescueZone(game: Game, s: SurvivorState): boolean {
  return Math.hypot(s.move.x - RESCUE_POINT.x, s.move.y - RESCUE_POINT.y) <= game.balance.prison.rescueRadius;
}

/** 틱마다: 보호 시간 감소, 구조 진행 (구조자마다 따로, 합산하지 않음) */
export function prisonTick(game: Game): void {
  const b = game.balance;
  for (const s of game.survivors) s.protectLeft = Math.max(0, s.protectLeft - game.dt);
  const prisoners = game.survivors.filter((s) => s.status === 'imprisoned');
  let rescuer: SurvivorState | null = null;
  for (const s of game.survivors) {
    const holding = (s.held & BTN.RESCUE) !== 0;
    if (s.status === 'free' && prisoners.length > 0 && holding && inRescueZone(game, s)) {
      s.rescueProgress += game.dt;
      if (s.rescueProgress >= b.prison.rescueTime - 1e-9 && !rescuer) rescuer = s;
    } else {
      s.rescueProgress = 0;
    }
  }
  if (rescuer) releaseAll(game, rescuer);
}

/** 감옥 안 전원 해방: 체력 회복 + 보호, 문 바로 바깥으로 */
export function releaseAll(game: Game, rescuer: SurvivorState): void {
  const b = game.balance;
  let i = 0;
  for (const s of game.survivors) {
    if (s.status !== 'imprisoned') continue;
    const slot = RELEASE_SLOTS[i % RELEASE_SLOTS.length] ?? RELEASE_SLOTS[0];
    i += 1;
    s.status = 'free';
    s.hp = b.survivor.maxHp;
    s.protectLeft = b.survivor.rescueProtection;
    if (slot) {
      s.move.x = slot.x;
      s.move.y = slot.y;
    }
  }
  rescuer.stats.rescues += 1;
  for (const s of game.survivors) {
    s.rescueProgress = 0;
    game.emitTo(s, { k: 'rescued', you: s === rescuer });
    game.emitTo(s, { k: 'text', id: 'ALERT_RESCUED' });
  }
  game.emitTo(game.monster, { k: 'rescued', you: false });
  game.emitTo(game.monster, { k: 'text', id: 'ALERT_RESCUED' });
}

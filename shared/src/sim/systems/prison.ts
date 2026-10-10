// 감옥 구조 (GAME_DESIGN 6.2): 문 앞에서 E를 3초 누르고 있으면 감옥 안 전원이 풀려나고 4초 보호
import { BTN, RELEASE_SLOTS, RELEASE_SPARES, RESCUE_POINT, countdown, type Vec2 } from '../../index';
import type { Game } from '../game';
import type { SurvivorState } from '../state';

/** 구조 구역 안인가 (문 바깥 중심에서 rescueRadius) */
export function inRescueZone(game: Game, s: SurvivorState): boolean {
  return Math.hypot(s.move.x - RESCUE_POINT.x, s.move.y - RESCUE_POINT.y) <= game.balance.prison.rescueRadius;
}

/** 틱마다: 보호 시간 감소, 구조 진행 (구조자마다 따로, 합산하지 않음) */
export function prisonTick(game: Game): void {
  const b = game.balance;
  for (const s of game.survivors) s.protectLeft = countdown(s.protectLeft, game.dt);
  const prisoners = game.survivors.filter((s) => s.status === 'imprisoned');
  let rescuer: SurvivorState | null = null;
  for (const s of game.survivors) {
    const holding = (s.held & BTN.RESCUE) !== 0;
    const hitNow = s.hitTick === game.tick;
    if (s.status === 'free' && prisoners.length > 0 && holding && !hitNow && inRescueZone(game, s)) {
      s.rescueProgress += game.dt;
      if (s.rescueProgress >= b.prison.rescueTime - 1e-9 && !rescuer) rescuer = s;
    } else {
      s.rescueProgress = 0;
    }
  }
  if (rescuer) releaseAll(game, rescuer);
}

/** 풀려날 자리: 기본 자리부터, 괴물 몸과 겹치면 예비 자리 (서로 통과하지 않는 규칙을 순간이동으로 깨지 않게) */
function releaseSpot(game: Game, index: number, used: Vec2[]): Vec2 | undefined {
  const m = game.monster.move;
  const gap = game.balance.survivor.radius + game.balance.monster.radius + 0.02;
  const first = RELEASE_SLOTS[index % RELEASE_SLOTS.length];
  const candidates = [...(first ? [first] : []), ...RELEASE_SLOTS, ...RELEASE_SPARES];
  return (
    candidates.find((p) => !used.includes(p) && Math.hypot(p.x - m.x, p.y - m.y) >= gap) ??
    first ??
    RELEASE_SLOTS[0]
  );
}

/** 감옥 안 전원 해방: 체력 회복 + 보호, 문 바로 바깥으로 */
export function releaseAll(game: Game, rescuer: SurvivorState): void {
  const b = game.balance;
  let i = 0;
  const used: Vec2[] = [];
  // 풀려나는 자리는 감옥 안 위치 순(서쪽부터)으로 준다. 자리(입장) 순서로 주면 괴물이 정체를 좁힐 수 있다
  const prisoners = game.survivors
    .filter((s) => s.status === 'imprisoned')
    .sort((a, b) => a.move.x - b.move.x || a.move.y - b.move.y);
  for (const s of prisoners) {
    const slot = releaseSpot(game, i, used);
    if (slot) used.push(slot);
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

// 괴물 공격 (GAME_DESIGN 5.1): 좌클릭 → 준비 0.4초(조준 고정, 이동 가능) → 전방 90° · 1.2타일 타격 → 쿨 1.5초
// 체력과 수감 (6.1): 두 번 맞으면 감옥으로, 수감 2회 뒤 세 번째로 잡히면 사망
import {
  BTN,
  PRISON_SLOTS,
  blocksStrike,
  circleIntersectsSector,
  countdown,
  inCircleVision,
  segmentBlocked,
  survivorVisionRadius,
  type GameEvent,
  type InputFrame,
} from '@decoy/shared';
import type { Game } from '../game';
import type { MonsterState, SurvivorState } from '../state';

/** 지금 괴물이 생존자 시야 합집합 안에 있는가 (생존자에게 보낼 이벤트 거르기) */
export function survivorsSeeMonster(game: Game): boolean {
  const m = game.monster;
  for (const s of game.survivors) {
    if (s.status !== 'free' && s.status !== 'imprisoned') continue;
    if (inCircleVision(s.move, survivorVisionRadius(game.balance, s.role), m.move)) return true;
  }
  return false;
}

/** 괴물이 보일 때만 생존자 전원에게 보낸다 */
export function emitIfMonsterVisible(game: Game, event: GameEvent): void {
  if (!survivorsSeeMonster(game)) return;
  for (const s of game.survivors) game.emitTo(s, event);
}

/** 괴물이 행동할 수 있는가 (시작 대기 · 기절 · 돌진 · 공격 준비 중이 아님) */
export function monsterCanAct(m: MonsterState): boolean {
  return m.move.frozen <= 0 && m.move.stun <= 0 && m.move.dash <= 0 && m.windupLeft <= 0;
}

/** 좌클릭: 공격 준비 시작 */
export function monsterAttackInput(game: Game, m: MonsterState, input: InputFrame): void {
  if ((input.pressed & BTN.ATTACK) === 0) return;
  if (!monsterCanAct(m) || m.attackCd > 0) return;
  const a = game.balance.monster.attack;
  m.windupLeft = a.windup;
  m.windupDir = m.move.face;
  // 준비 중에는 조준(= 공격 방향 · 시야 부채꼴)을 고정한다
  m.move.aimLock = a.windup;
  const ev: GameEvent = { k: 'attackStart', x: m.move.x, y: m.move.y, dir: m.windupDir };
  game.emitTo(m, ev);
  emitIfMonsterVisible(game, ev);
}

/** 공격 준비를 취소한다 (기절) */
export function cancelWindup(m: MonsterState): void {
  m.windupLeft = 0;
  m.move.aimLock = 0;
}

/** 틱마다: 준비가 끝나는 틱에 한 번 타격 판정 */
export function combatTick(game: Game): void {
  const m = game.monster;
  m.attackCd = countdown(m.attackCd, game.dt);
  if (m.windupLeft <= 0) return;
  m.windupLeft = countdown(m.windupLeft, game.dt);
  if (m.windupLeft > 0) return;
  // 타격 틱: 조준 고정도 여기서 함께 끝난다 (입력이 밀려 처리된 경우에도 준비 시간과 어긋나지 않게)
  m.move.aimLock = 0;
  strike(game, m);
}

/** 생존자 몸 원이 부채꼴(1.2타일, 90°)과 겹치고 시선이 이동 차단 타일에 막히지 않으면 맞는다. 범위 안 전원 */
export function strike(game: Game, m: MonsterState): void {
  const a = game.balance.monster.attack;
  const sector = { dir: m.windupDir, arc: (a.arc * Math.PI) / 180, range: a.range };
  const r = game.balance.survivor.radius;
  let hits = 0;
  for (const s of game.survivors) {
    if (s.status !== 'free') continue;
    if (!circleIntersectsSector(m.move, sector, s.move, r)) continue;
    if (segmentBlocked(m.move, s.move, blocksStrike)) continue;
    if (hitSurvivor(game, s)) hits += 1;
  }
  m.attackCd = a.cooldown;
  m.stats.hitsLanded += hits;
  const ev: GameEvent = { k: 'attackHit', x: m.move.x, y: m.move.y, dir: m.windupDir, hits };
  game.emitTo(m, ev);
  emitIfMonsterVisible(game, ev);
}

/** 피격 처리. 실제로 체력이 깎였으면 true (보호 중이면 무효) */
export function hitSurvivor(game: Game, s: SurvivorState): boolean {
  if (s.status !== 'free' || s.protectLeft > 0) return false;
  s.hp -= 1;
  s.stats.hitsTaken += 1;
  // 구조 중 공격받으면 중단 (이 틱의 누름도 진행으로 치지 않는다)
  s.rescueProgress = 0;
  s.hitTick = game.tick;
  for (const t of game.survivors) game.emitTo(t, { k: 'hit', you: t === s, x: s.move.x, y: s.move.y });
  if (s.hp <= 0) captureSurvivor(game, s);
  return true;
}

/** 두 번 맞은 생존자: 수감 (2회까지), 세 번째면 사망 */
export function captureSurvivor(game: Game, s: SurvivorState): void {
  const b = game.balance.survivor;
  s.rescueProgress = 0;
  s.move.sprint = 0;
  s.abilityActive = 0;
  if (s.imprisonCount >= b.maxImprisonments) {
    s.status = 'dead';
    s.hp = 0;
    for (const t of game.survivors) game.emitTo(t, { k: 'died', you: t === s });
    game.emitTo(game.monster, { k: 'died', you: false });
    return;
  }
  s.imprisonCount += 1;
  s.status = 'imprisoned';
  s.hp = 0;
  // 감옥 안 빈 자리로 즉시 이동
  const taken = game.survivors.filter((o) => o !== s && o.status === 'imprisoned').map((o) => o.move);
  const slot = PRISON_SLOTS.find((p) => taken.every((t) => Math.hypot(t.x - p.x, t.y - p.y) > 0.3)) ??
    PRISON_SLOTS[0] ?? { x: 24, y: 16 };
  s.move.x = slot.x;
  s.move.y = slot.y;
  for (const t of game.survivors) game.emitTo(t, { k: 'imprisoned', you: t === s });
  game.emitTo(game.monster, { k: 'imprisoned', you: false });
}

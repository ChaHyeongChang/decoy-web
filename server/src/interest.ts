// 플레이어별 스냅샷 생성. 받는 사람이 볼 수 있는 것만 담는다.
import type {
  ExitView,
  MonsterSelf,
  MonsterView,
  PointView,
  SelfView,
  Snapshot,
  SurvivorSelf,
  SurvivorView,
  WorldView,
} from '@decoy/shared';
import type { Game } from './game';
import type { GamePlayer, MonsterState, SurvivorState } from './state';

function round(v: number, digits = 3): number {
  const k = 10 ** digits;
  return Math.round(v * k) / k;
}

function survivorSelf(s: SurvivorState): SurvivorSelf {
  return {
    status: s.status,
    hp: s.hp,
    imprisonCount: s.imprisonCount,
    protectLeft: round(s.protectLeft),
    abilityCd: round(s.abilityCd),
    abilityActive: round(s.abilityActive),
    rescue: round(s.rescueProgress),
    spotted: s.spotted,
  };
}

function monsterSelf(game: Game, m: MonsterState): MonsterSelf {
  const b = game.balance;
  const campActive = game.survivors.some((s) => s.status === 'imprisoned');
  let camp: 0 | 1 | 2 = 0;
  if (campActive && m.move.camp > b.prison.campGrace) camp = 2;
  else if (campActive && m.move.camp >= b.prison.campWarnAt) camp = 1;
  let blockWarn: MonsterSelf['blockWarn'] = null;
  for (const p of game.points) {
    if (!p.done && m.pointCamp[p.id] >= b.prison.campWarnAt) blockWarn = p.id;
  }
  return {
    attackCd: round(m.attackCd),
    windup: round(m.windupLeft),
    dashCd: round(m.dashCd),
    roarCd: round(m.roarCd),
    mode: m.mode,
    blend: round(m.blend),
    camp,
    blockWarn,
  };
}

function selfView(game: Game, p: GamePlayer): SelfView {
  return {
    id: p.id,
    role: p.role,
    move: { ...p.move, dirHist: p.move.dirHist.slice() },
    surv: p.kind === 'survivor' ? survivorSelf(p) : null,
    mon: p.kind === 'monster' ? monsterSelf(game, p) : null,
  };
}

/** 생존자 팀이 보는 팀원 정보 */
function teammateView(s: SurvivorState): SurvivorView {
  return {
    id: s.id,
    x: round(s.move.x),
    y: round(s.move.y),
    face: round(s.move.face),
    role: s.role,
    status: s.status,
    protected: s.protectLeft > 0,
    hp: s.hp,
    imprisonCount: s.imprisonCount,
    abilityCd: round(s.abilityCd),
    rescue: round(s.rescueProgress),
    spotted: s.spotted,
    connected: s.connected,
  };
}

export function monsterView(game: Game, m: MonsterState, seesSomeone: boolean): MonsterView {
  return {
    x: round(m.move.x),
    y: round(m.move.y),
    aim: round(m.move.face),
    mode: m.mode,
    blend: round(m.blend),
    windup: round(m.windupLeft),
    stunned: m.move.stun > 0,
    dashing: m.move.dash > 0,
    seesSomeone,
  };
}

function worldView(game: Game, forMonster: boolean): WorldView {
  const points: PointView[] = game.points.map((p) => ({
    id: p.id,
    progress: round(p.progress / game.balance.capturePoint.captureTime, 4),
    state: p.done ? 'done' : p.blocked ? 'blocked' : p.capturing ? 'capturing' : 'idle',
  }));
  const exits: ExitView[] = game.exits.map((e) => ({
    id: e.id,
    state: e.state,
    progress: forMonster ? null : round(e.progress / Math.max(1e-6, game.balance.exit.openTime), 4),
  }));
  return {
    timeLeft: round(game.timeLeft, 2),
    grace: game.grace === null ? null : round(game.grace, 2),
    monsterWait: round(game.monster.move.frozen, 2),
    paused: game.paused === null ? null : round(game.paused, 2),
    points,
    exits,
    imprisoned: game.survivors.filter((s) => s.status === 'imprisoned').length,
    statusList: null,
  };
}

/**
 * 받는 사람용 스냅샷. M1 단계에서는 정보 차단 없이 전원을 담는다 (M3에서 시야 필터 추가).
 */
export function buildSnapshot(game: Game, recipientId: string, st: number): Snapshot | null {
  const me = game.players.get(recipientId);
  if (!me) return null;
  const forMonster = me.kind === 'monster';
  const survivors: SurvivorView[] = [];
  for (const s of game.survivors) {
    if (s.id === me.id) continue;
    if (s.status === 'dead' || s.status === 'escaped') {
      if (!forMonster) survivors.push(teammateView(s));
      continue;
    }
    survivors.push(teammateView(s));
  }
  return {
    tick: game.tick,
    st: Math.round(st),
    ack: me.ack,
    you: selfView(game, me),
    survivors,
    monster: forMonster ? null : monsterView(game, game.monster, false),
    marks: [],
    world: worldView(game, forMonster),
    events: game.drainOutbox(me.id),
  };
}

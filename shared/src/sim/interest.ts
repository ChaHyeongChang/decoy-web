// 플레이어별 스냅샷 생성 (TECH_SPEC 3.3). 받는 사람이 볼 수 있는 것만 담는다.
//
// 생존자에게: 팀원 전원(항상), 시야 합집합 안일 때만 괴물과 부채꼴, 탐지 · 포효 경고 중의 괴물 위치(마커)
// 괴물에게:  자기 상태, 부채꼴 · 근접 원 안 생존자만 — 임시 ID, 역할 없이(능력 노출 1초만 예외),
//            익명 상태 목록. 생존자 실제 ID · 역할 · 부상 여부 · 탈출구 개방 진행도는 보내지 않는다
import {
  exceeds,
  inCircleVision,
  monsterSees,
  reached,
  survivorVisionRadius,
  type AnonStatus,
  type ExitView,
  type Mark,
  type MonsterSelf,
  type MonsterView,
  type PointView,
  type SelfView,
  type Snapshot,
  type SurvivorSelf,
  type SurvivorView,
  type WorldView,
} from '../index';
import type { Game } from './game';
import { newAliasId } from './random';
import type { GamePlayer, MonsterState, SurvivorState } from './state';

function round(v: number, digits = 3): number {
  const k = 10 ** digits;
  return Math.round(v * k) / k;
}

/** 이번 틱의 시야 사실 (스냅샷을 만들기 전에 한 번 계산) */
export interface VisibilityFacts {
  tick: number;
  /** 괴물이 보는 생존자 ID (자유 · 수감) */
  monsterSees: Set<string>;
  /** 생존자 시야 합집합 안에 괴물이 있는가 */
  survivorsSeeMonster: boolean;
}

/** 시야 안에 있는 생존자 (사망 · 탈출 제외) */
function present(s: SurvivorState): boolean {
  return s.status === 'free' || s.status === 'imprisoned';
}

export function computeVisibility(game: Game): VisibilityFacts {
  const m = game.monster;
  const b = game.balance;
  const sees = new Set<string>();
  for (const s of game.survivors) {
    if (!present(s)) {
      s.spotted = false;
      continue;
    }
    const seen = monsterSees(b, m.move, m.move.face, m.blend, s.move);
    if (seen) sees.add(s.id);
    // 발각: 자유 상태 생존자가 괴물에게 보이는 중 (포효 · 능력 노출은 제외)
    s.spotted = seen && s.status === 'free';
  }
  let seeMonster = false;
  for (const s of game.survivors) {
    if (!present(s)) continue;
    if (inCircleVision(s.move, survivorVisionRadius(b, s.role), m.move)) {
      seeMonster = true;
      break;
    }
  }
  return { tick: game.tick, monsterSees: sees, survivorsSeeMonster: seeMonster };
}

/** 괴물에게 보낼 임시 ID: 시야에 새로 들어올 때마다 새로 발급, 계속 보이는 동안 유지 */
export class AliasBook {
  private readonly aliases = new Map<string, string>();

  update(visible: Set<string>): void {
    for (const id of [...this.aliases.keys()]) if (!visible.has(id)) this.aliases.delete(id);
    for (const id of visible) if (!this.aliases.has(id)) this.aliases.set(id, newAliasId());
  }

  get(id: string): string | undefined {
    return this.aliases.get(id);
  }
}

function survivorSelf(s: SurvivorState, rescueTime: number): SurvivorSelf {
  return {
    status: s.status,
    hp: s.hp,
    imprisonCount: s.imprisonCount,
    protectLeft: round(s.protectLeft),
    abilityCd: round(s.abilityCd),
    abilityActive: round(s.abilityActive),
    rescue: round(Math.min(1, s.rescueProgress / rescueTime)),
    spotted: s.spotted,
  };
}

function monsterSelf(game: Game, m: MonsterState): MonsterSelf {
  const b = game.balance;
  const campActive = game.survivors.some((s) => s.status === 'imprisoned');
  let camp: 0 | 1 | 2 = 0;
  if (campActive && exceeds(m.move.camp, b.prison.campGrace)) camp = 2;
  else if (campActive && reached(m.move.camp, b.prison.campWarnAt)) camp = 1;
  let blockWarn: MonsterSelf['blockWarn'] = null;
  for (const p of game.points) {
    if (!p.done && reached(m.pointCamp[p.id], b.prison.campWarnAt)) blockWarn = p.id;
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
    surv: p.kind === 'survivor' ? survivorSelf(p, game.balance.prison.rescueTime) : null,
    mon: p.kind === 'monster' ? monsterSelf(game, p) : null,
  };
}

/** 생존자 팀이 보는 팀원 정보 (전부) */
function teammateView(s: SurvivorState, rescueTime: number): SurvivorView {
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
    rescue: round(Math.min(1, s.rescueProgress / rescueTime)),
    // 발각 여부는 본인 것만 (팀원 것은 괴물이 안 보일 때 괴물 조준 정보가 된다)
    spotted: null,
    connected: s.connected,
  };
}

/** 괴물이 보는 생존자 (임시 ID, 역할은 노출 창에만, 부상 · 팀 정보 없음) */
function hiddenSurvivorView(s: SurvivorState, alias: string): SurvivorView {
  return {
    id: alias,
    x: round(s.move.x),
    y: round(s.move.y),
    face: round(s.move.face),
    role: s.revealLeft > 0 ? s.role : null,
    status: s.status,
    protected: s.protectLeft > 0,
    hp: null,
    imprisonCount: null,
    abilityCd: null,
    rescue: null,
    spotted: null,
    connected: null,
  };
}

export function monsterView(m: MonsterState, seesSomeone: boolean): MonsterView {
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

/** 괴물에게 보이는 익명 상태 목록: 심각도 순 정렬, 이름 · 역할 · ID 없음 */
export function anonStatusList(game: Game): AnonStatus[] {
  const order: Record<AnonStatus['state'], number> = {
    dead: 0,
    imprisoned: 1,
    injured: 2,
    normal: 3,
    escaped: 4,
  };
  const list: AnonStatus[] = game.survivors.map((s) => ({
    state:
      s.status === 'dead'
        ? 'dead'
        : s.status === 'escaped'
          ? 'escaped'
          : s.status === 'imprisoned'
            ? 'imprisoned'
            : s.hp < game.balance.survivor.maxHp
              ? 'injured'
              : 'normal',
    imprisonCount: s.imprisonCount,
  }));
  list.sort((a, b) => order[a.state] - order[b.state] || b.imprisonCount - a.imprisonCount);
  return list;
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
    // 2인 개방 진행도는 생존자에게만 (괴물이 시야 없이 "두 명이 북문에 있다"를 알 수 없게)
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
    statusList: forMonster ? anonStatusList(game) : null,
  };
}

/** 생존자 화면 마커: 스카우트 탐지(실시간), 포효한 괴물 위치(고정) */
function survivorMarks(game: Game): Mark[] {
  const m = game.monster;
  const marks: Mark[] = [];
  if (m.trackedLeft > 0) marks.push({ kind: 'track', x: round(m.move.x), y: round(m.move.y) });
  if (m.roarRevealLeft > 0) marks.push({ kind: 'roarSelf', x: round(m.roarX), y: round(m.roarY) });
  return marks;
}

/** 받는 사람용 스냅샷 */
export function buildSnapshot(
  game: Game,
  recipientId: string,
  st: number,
  facts: VisibilityFacts,
  aliases: AliasBook,
): Snapshot | null {
  const me = game.players.get(recipientId);
  if (!me) return null;
  if (me.kind === 'monster') {
    const survivors: SurvivorView[] = [];
    for (const s of game.survivors) {
      if (!facts.monsterSees.has(s.id)) continue;
      const alias = aliases.get(s.id);
      if (alias) survivors.push(hiddenSurvivorView(s, alias));
    }
    // 배열 순서가 자리(입장) 순서를 따르면 로비에서 본 역할과 이어진다: 임시 ID(난수) 순으로 정렬
    survivors.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return {
      tick: game.tick,
      st: Math.round(st),
      ack: me.ack,
      you: selfView(game, me),
      survivors,
      monster: null,
      marks: [],
      world: worldView(game, true),
      events: game.drainOutbox(me.id),
    };
  }
  const seesSomeone = game.survivors.some((s) => s.spotted);
  return {
    tick: game.tick,
    st: Math.round(st),
    ack: me.ack,
    you: selfView(game, me),
    survivors: game.survivors
      .filter((s) => s.id !== me.id)
      .map((s) => teammateView(s, game.balance.prison.rescueTime)),
    monster: facts.survivorsSeeMonster ? monsterView(game.monster, seesSomeone) : null,
    marks: survivorMarks(game),
    world: worldView(game, false),
    events: game.drainOutbox(me.id),
  };
}

// 판 기록 (GAME_DESIGN 12장 '판 평가'): 판정 상태를 틱마다 지켜보며 평가에 쓸 수치를 센다.
// 판정에 끼어들지 않는다 — 게임 상태를 읽기만 하고(쓰지 않는다), 난수를 쓰지 않는다. 그래서 규칙 골든 해시 · 봇 판이 그대로다.
// 시야가 필요한 수치(발각 · 발견 · 따돌림)는 방이 스냅샷 틱에 이미 계산한 시야 사실(VisibilityFacts)로만 센다(시야 계산을 더 하지 않는다).
// 서버(방)와 기기 안 연습이 같은 코드를 쓴다. 수치 정의는 shared/src/types.ts RatingStatId
import {
  CAPTURE_POINTS,
  EXITS,
  monsterSees,
  type RatingStatId,
  type RatingStats,
  type Role,
  type SurvivorStatus,
} from '../index';
import type { Game } from './game';
import type { VisibilityFacts } from './interest';
import { survivorsSeeMonster } from './systems/combat';

/** 따돌림: 이만큼(초) 넘게 발각되어 쫓긴 추격이 */
export const CHASE_MIN_SEC = 2;
/** 이만큼(초) 발각 없이 지나면 추격이 끝난 것으로 본다 (맞지 않고 자유로 끝나면 따돌림) */
export const CHASE_END_SEC = 3;
/** 괴물 '새로 찾기': 이만큼(초) 넘게 시야 밖에 있던 생존자가 시야에 들어오면 한 번 */
export const FIND_GAP_SEC = 3;
/** 점령 · 탈출구 열기를 괴물이 끊은 것으로 치는 괴물 거리 (타일) */
export const PRESSURE_TILES = 8;
/** 점령이 이만큼(초) 넘게 이어지다 끊겨야 한 번 (경계에서 들락날락하는 것을 여러 번 세지 않게) */
export const POINT_STOP_MIN_SEC = 1;
/** 러너 질주가 쓸모 있던 것으로 치는 최근 발각 (초) */
export const SPRINT_SPOTTED_SEC = 1.5;

export interface PlayerMatchRecord {
  id: string;
  role: Role;
  bot: boolean;
  stats: RatingStats;
}

/** 판 하나의 기록 (서버 메모리에만, 결과를 보낸 뒤 버린다) */
export interface MatchRecord {
  matchId: string;
  winner: 'survivors' | 'monster' | 'void';
  durationSec: number;
  players: PlayerMatchRecord[];
}

interface Chase {
  spottedSec: number;
  hit: boolean;
}

interface SurvivorTrack {
  id: string;
  status: SurvivorStatus;
  hitsTaken: number;
  rescues: number;
  rescueProgress: number;
  abilityCd: number;
  freeSec: number;
  escapedAt: number | null;
  rescueSec: number;
  freed: number;
  exitSec: number;
  chaseSec: number;
  evades: number;
  abilityUses: number;
  abilityGood: number;
  /** 마지막으로 발각된 판 시각 (없으면 null) */
  lastSpotted: number | null;
  /** 괴물 시야에 마지막으로 있던 판 시각 */
  lastSeen: number | null;
  chase: Chase | null;
}

interface MonsterTrack {
  roarCd: number;
  stun: number;
  jails: number;
  kills: number;
  seeSec: number;
  finds: number;
  roarFinds: number;
  blockSec: number;
  pointStops: number;
  zoneHits: number;
  exitStops: number;
  exitHoldSec: number;
}

const r1 = (v: number): number => Math.round(v * 10) / 10;

export class MatchRecorder {
  private readonly surv = new Map<string, SurvivorTrack>();
  private readonly mon: MonsterTrack;
  private lastTime: number;
  private lastSightTime: number;
  private readonly exitProgress = new Map<string, number>();
  /** 거점별 이번 점령이 이어진 시간 (점령 중이 아니면 0) */
  private readonly capturingFor = new Map<string, number>();

  constructor(game: Game) {
    this.lastTime = game.time;
    this.lastSightTime = game.time;
    for (const s of game.survivors) {
      this.surv.set(s.id, {
        id: s.id,
        status: s.status,
        hitsTaken: s.stats.hitsTaken,
        rescues: s.stats.rescues,
        rescueProgress: s.rescueProgress,
        abilityCd: s.abilityCd,
        freeSec: 0,
        escapedAt: null,
        rescueSec: 0,
        freed: 0,
        exitSec: 0,
        chaseSec: 0,
        evades: 0,
        abilityUses: 0,
        abilityGood: 0,
        lastSpotted: null,
        lastSeen: null,
        chase: null,
      });
    }
    this.mon = {
      roarCd: game.monster.roarCd,
      stun: game.monster.move.stun,
      jails: 0,
      kills: 0,
      seeSec: 0,
      finds: 0,
      roarFinds: 0,
      blockSec: 0,
      pointStops: 0,
      zoneHits: 0,
      exitStops: 0,
      exitHoldSec: 0,
    };
    for (const e of game.exits) this.exitProgress.set(e.id, e.progress);
  }

  /**
   * game.step() 뒤 틱마다 한 번. facts는 이번 틱에 방이 스냅샷용으로 계산한 시야 사실(스냅샷 틱이 아니면 null) —
   * 시야 수치는 그 사이 흐른 판 시간만큼 센다
   */
  observe(game: Game, facts: VisibilityFacts | null): void {
    const dt = Math.max(0, game.time - this.lastTime);
    this.lastTime = game.time;
    const b = game.balance;
    const m = game.monster;
    const mon = this.mon;

    // 괴물: 포효로 찾은 생존자 (발동 순간 반경 안 자유 · 수감 생존자, 판정과 같은 조건)
    if (m.roarCd > mon.roarCd + 1e-9) {
      mon.roarFinds += game.survivors.filter(
        (s) =>
          (s.status === 'free' || s.status === 'imprisoned') &&
          Math.hypot(s.move.x - m.move.x, s.move.y - m.move.y) <= b.monster.roar.radius,
      ).length;
    }
    mon.roarCd = m.roarCd;
    const stunnedNow = m.move.stun > mon.stun + 1e-9;
    mon.stun = m.move.stun;

    // 거점: 진행을 멈춘 시간, 괴물이 가까이 와 끊긴 점령 (괴물이 들어와 멈춤 · 생존자가 쫓겨남)
    for (const p of game.points) {
      if (p.blocked) mon.blockSec += dt;
      const ran = this.capturingFor.get(p.id) ?? 0;
      if (p.capturing) {
        this.capturingFor.set(p.id, ran + dt);
        continue;
      }
      this.capturingFor.set(p.id, 0);
      const c = CAPTURE_POINTS[p.id];
      if (
        !p.done &&
        ran >= POINT_STOP_MIN_SEC &&
        Math.hypot(m.move.x - c.x, m.move.y - c.y) <= PRESSURE_TILES
      ) {
        mon.pointStops += 1;
      }
    }

    // 탈출구: 열기 진행이 오른 만큼 근처 생존자 기여, 괴물이 가까이 있을 때 0으로 끊기면 괴물이 끊은 것
    const exitGain = new Map<string, number>();
    for (const e of game.exits) {
      const prev = this.exitProgress.get(e.id) ?? 0;
      const def = EXITS[e.id];
      if (e.state === 'active' && e.progress > prev) exitGain.set(e.id, e.progress - prev);
      if (e.state === 'active' && prev > 0 && e.progress === 0) {
        if (Math.hypot(m.move.x - def.center.x, m.move.y - def.center.y) <= PRESSURE_TILES) {
          mon.exitStops += 1;
        }
      }
      this.exitProgress.set(e.id, e.progress);
    }
    const exitsActive = game.exits.some((e) => e.state !== 'inactive');
    const anyEscaped = game.survivors.some((s) => s.status === 'escaped');
    if (exitsActive && !anyEscaped) mon.exitHoldSec += dt;

    // 생존자별
    let rescuedThisTick = 0;
    let rescuer: SurvivorTrack | null = null;
    for (const s of game.survivors) {
      const t = this.surv.get(s.id);
      if (!t) continue;
      const prevStatus = t.status;
      // 상태 바뀜: 수감 · 사망(괴물이 잡아서 = 자유에서 바로 사망하고 체력 0) · 탈출 · 풀려남
      if (prevStatus !== s.status) {
        if (prevStatus === 'free' && s.status === 'imprisoned') mon.jails += 1;
        if (prevStatus === 'free' && s.status === 'dead' && s.hp <= 0) mon.kills += 1;
        if (prevStatus === 'imprisoned' && s.status === 'free') rescuedThisTick += 1;
        if (s.status === 'escaped') {
          t.escapedAt = game.time;
          // 쫓기다 탈출했으면 따돌린 것으로
          if (t.chase && t.chase.spottedSec >= CHASE_MIN_SEC && !t.chase.hit) t.evades += 1;
          t.chase = null;
        }
        if (s.status === 'imprisoned' || s.status === 'dead') t.chase = null;
        t.status = s.status;
      }
      if (s.status === 'free') t.freeSec += dt;
      // 맞음: 거점 · 켜진 탈출구 안에서 맞았으면 괴물의 저지 타격
      const hitNow = s.stats.hitsTaken - t.hitsTaken;
      if (hitNow > 0) {
        if (t.chase) t.chase.hit = true;
        if (inObjectiveZone(game, s.move)) mon.zoneHits += hitNow;
      }
      t.hitsTaken = s.stats.hitsTaken;
      // 구조: 버틴 시간, 완료한 사람
      if (s.rescueProgress > t.rescueProgress) t.rescueSec += s.rescueProgress - t.rescueProgress;
      t.rescueProgress = s.rescueProgress;
      if (s.stats.rescues > t.rescues) rescuer = t;
      t.rescues = s.stats.rescues;
      // 탈출구 열기 기여
      for (const [id, gain] of exitGain) {
        const def = EXITS[id as keyof typeof EXITS];
        if (
          s.status === 'free' &&
          Math.hypot(s.move.x - def.center.x, s.move.y - def.center.y) <= b.exit.radius
        ) {
          t.exitSec += gain;
        }
      }
      // 능력: 쿨타임이 새로 걸리면 한 번 사용
      if (s.abilityCd > t.abilityCd + 1e-9) {
        t.abilityUses += 1;
        if (abilityWasGood(game, s.role, t, stunnedNow)) t.abilityGood += 1;
      }
      t.abilityCd = s.abilityCd;
    }
    if (rescuer) rescuer.freed += rescuedThisTick;

    if (facts) this.observeSight(game, facts);
  }

  /** 스냅샷 틱: 발각 · 괴물 시야 · 새로 찾기 · 따돌림 (방이 계산한 시야 사실만) */
  private observeSight(game: Game, facts: VisibilityFacts): void {
    const sdt = Math.max(0, game.time - this.lastSightTime);
    this.lastSightTime = game.time;
    let seesFree = false;
    for (const s of game.survivors) {
      const t = this.surv.get(s.id);
      if (!t) continue;
      const inSight = facts.monsterSees.has(s.id);
      if (inSight && s.status === 'free') {
        if (t.lastSeen === null || game.time - t.lastSeen > FIND_GAP_SEC) this.mon.finds += 1;
      }
      if (inSight) t.lastSeen = game.time;
      const spotted = inSight && s.status === 'free';
      if (spotted) {
        seesFree = true;
        t.chaseSec += sdt;
        t.lastSpotted = game.time;
        t.chase ??= { spottedSec: 0, hit: false };
        t.chase.spottedSec += sdt;
      } else if (t.chase && t.lastSpotted !== null && game.time - t.lastSpotted >= CHASE_END_SEC) {
        if (s.status === 'free' && t.chase.spottedSec >= CHASE_MIN_SEC && !t.chase.hit) t.evades += 1;
        t.chase = null;
      }
    }
    if (seesFree) this.mon.seeSec += sdt;
  }

  /** 판이 끝났을 때 (game.end가 정해진 틱): 판 기록 */
  finish(game: Game, matchId: string): MatchRecord {
    const duration = Math.max(game.time, 1e-6);
    const players: PlayerMatchRecord[] = [];
    const escaped = game.survivors.filter((s) => s.status === 'escaped').length;
    for (const s of game.survivors) {
      const t = this.surv.get(s.id);
      if (!t) continue;
      const afterEscape = t.escapedAt === null ? 0 : Math.max(0, game.time - t.escapedAt);
      const stats: Partial<Record<RatingStatId, number>> = {
        captureSec: r1(s.stats.captureSeconds),
        exitSec: r1(t.exitSec),
        rescues: s.stats.rescues,
        freed: t.freed,
        rescueSec: r1(t.rescueSec),
        escaped: s.status === 'escaped' ? 1 : 0,
        surviveRatio: Math.round(Math.min(1, (t.freeSec + afterEscape) / duration) * 1000) / 1000,
        cleanEscape: s.status === 'escaped' && s.imprisonCount === 0 ? 1 : 0,
        imprisons: s.imprisonCount,
        died: s.status === 'dead' ? 1 : 0,
        hitsTaken: s.stats.hitsTaken,
        chaseSec: r1(t.chaseSec),
        evades: t.evades,
        abilityUses: t.abilityUses,
        abilityGood: t.abilityGood,
      };
      players.push({ id: s.id, role: s.role, bot: s.bot, stats });
    }
    const m = game.monster;
    const mon = this.mon;
    players.push({
      id: m.id,
      role: 'monster',
      bot: m.bot,
      stats: {
        hits: m.stats.hitsLanded,
        jails: mon.jails,
        kills: mon.kills,
        seeSec: r1(mon.seeSec),
        finds: mon.finds,
        roarFinds: mon.roarFinds,
        blockSec: r1(mon.blockSec),
        pointStops: mon.pointStops,
        pointsLeft: game.points.filter((p) => !p.done).length,
        zoneHits: mon.zoneHits,
        kept: game.survivors.length - escaped,
        exitStops: mon.exitStops,
        exitHoldSec: r1(mon.exitHoldSec),
      },
    });
    return {
      matchId,
      winner: game.end?.winner ?? 'void',
      durationSec: Math.round(game.time),
      players,
    };
  }
}

/** 거점 안 · 켜진 탈출구 근처인가 (괴물의 '저지' 타격) */
function inObjectiveZone(game: Game, pos: { x: number; y: number }): boolean {
  const b = game.balance;
  for (const p of game.points) {
    if (p.done) continue;
    const c = CAPTURE_POINTS[p.id];
    if (Math.hypot(pos.x - c.x, pos.y - c.y) <= b.capturePoint.radius) return true;
  }
  for (const e of game.exits) {
    if (e.state !== 'active') continue;
    const c = EXITS[e.id].center;
    if (Math.hypot(pos.x - c.x, pos.y - c.y) <= b.exit.radius * 2) return true;
  }
  return false;
}

/**
 * 쓸모 있게 쓴 능력: 가드 밀치기는 기절을 걸었을 때(빗나가면 쿨이 안 걸려 사용으로 치지 않는다) · 러너 질주는 발각된 채
 * (최근 1.5초) · 스카우트 탐지는 팀 시야 밖의 괴물을 드러냈을 때
 */
function abilityWasGood(game: Game, role: Role, t: SurvivorTrack, stunnedNow: boolean): boolean {
  if (role === 'guard') return stunnedNow;
  if (role === 'runner') {
    const m = game.monster;
    const s = game.survivorById(t.id);
    const seenNow = s ? monsterSees(game.balance, m.move, m.move.face, m.blend, s.move) : false;
    return seenNow || (t.lastSpotted !== null && game.time - t.lastSpotted <= SPRINT_SPOTTED_SEC);
  }
  if (role === 'scout') return !survivorsSeeMonster(game);
  return false;
}

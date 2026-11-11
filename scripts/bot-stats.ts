// 봇끼리 판 통계 (마일스톤 b · c 공통 준비). 실전 봇 4명(괴물 · 러너 · 가드 · 스카우트)으로 판을 끝까지 돌려 수치를 모은다.
//
// 실행 (리포 루트에서 — npx 가 리포의 tsx 를 찾는다):
//   npx tsx scripts/bot-stats.ts --matches 100 --seed 1 --out <결과.json> [--md <표.md>]
//   npx tsx scripts/bot-stats.ts --compare <전.json> <후.json> [--md <비교표.md>]
// 옵션
//   --matches N     판 수 (기본 60). seed, seed+1, … 를 쓴다
//   --seed S        첫 seed (기본 1)
//   --seeds 3,17,42 seed 를 직접 고른다 (--matches · --seed 대신)
//   --flow room|sim 판을 돌리는 방법 (기본 room)
//                   room = 실제 방(Room.tick) + 실제 BotDriver(자기 스냅샷 + predictSelf) — 기기 안 연습 · 빠른 매칭과 같은 코드 경로
//                   sim  = SimMatch(tests/bots/practice.test.ts · scripts/meta-calibrate.ts 와 같은 방법, predictSelf 없음)
//   --repo DIR      읽을 리포 (기본 이 파일이 든 리포). 규칙 변경 전 커밋의 git worktree 를 주면 같은 도구로 전후를 잰다
//   --balance FILE  수치 파일 (기본 <repo>/config/balance.json)
//   --out FILE      판별 수치 + 요약 JSON
//   --md FILE       요약 마크다운 표
//   --quiet         판마다 한 줄 출력을 끈다
//
// 이 도구는 판정에 끼어들지 않는다: 게임 상태를 읽기만 하고(관찰자), 봇에게는 실제 방과 똑같이 자기 스냅샷만 간다.
// 거점 · 탈출구 수와 이름은 하드코딩하지 않고 game.points · game.exits 에서 읽는다(거점 3개 · 새 탈출구 상태가 생겨도 그대로 돈다).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type * as SharedNs from '../shared/src/index';
import type * as SimNs from '../shared/src/sim/index';

type Shared = typeof SharedNs;
type Sim = typeof SimNs;
type Game = SimNs.Game;
type Balance = SharedNs.Balance;
type InputFrame = SharedNs.InputFrame;
type Vec2 = SharedNs.Vec2;

// ───────────────────────── 정의 (보고서와 같다) ─────────────────────────
/** '쫓김': 괴물에게 보이는 중이거나 괴물이 이 거리(타일) 안 */
const CHASE_DIST = 6;
/** '서 있음': 한 틱에 이만큼(타일)도 안 움직임 (= 0.03타일/초 미만) */
const MOVE_EPS = 1e-3;
/** 괴물이 거점 '근처'에 있다고 치는 거리 (타일, 거점 중심에서). 반경 안(capturePoint.radius)과 따로 센다 */
const NEAR_POINT = 6;
/** 서 있던 구간을 따로 적는 최소 길이 (초)와 판마다 적는 개수 */
const EPISODE_MIN_SEC = 3;
const EPISODES_KEPT = 8;

// ───────────────────────── 인자 ─────────────────────────
interface Args {
  matches: number;
  seed: number;
  seeds: number[] | null;
  flow: 'room' | 'sim';
  repo: string;
  balance: string | null;
  out: string | null;
  md: string | null;
  quiet: boolean;
  compare: [string, string] | null;
}

function parseArgs(argv: string[]): Args {
  const a: Args = {
    matches: 60,
    seed: 1,
    seeds: null,
    flow: 'room',
    repo: process.env.DECOY_REPO ?? resolve(dirname(fileURLToPath(import.meta.url)), '..'),
    balance: null,
    out: null,
    md: null,
    quiet: false,
    compare: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i];
    const v = (): string => {
      const x = argv[i + 1];
      if (x === undefined) throw new Error(`${k} 값이 없습니다`);
      i += 1;
      return x;
    };
    if (k === '--matches') a.matches = Number(v());
    else if (k === '--seed') a.seed = Number(v());
    else if (k === '--seeds') a.seeds = v().split(',').map(Number);
    else if (k === '--flow') {
      const f = v();
      if (f !== 'room' && f !== 'sim') throw new Error('--flow 는 room 또는 sim');
      a.flow = f;
    } else if (k === '--repo') a.repo = resolve(v());
    else if (k === '--balance') a.balance = resolve(v());
    else if (k === '--out') a.out = resolve(v());
    else if (k === '--md') a.md = resolve(v());
    else if (k === '--quiet') a.quiet = true;
    else if (k === '--compare') a.compare = [resolve(v()), resolve(v())];
    else throw new Error(`모르는 인자: ${k}`);
  }
  return a;
}

// ───────────────────────── 판별 수치 ─────────────────────────
interface IdleEpisode {
  id: string;
  role: string;
  /** 시작 판 시각 (초)과 길이 (초) */
  t0: number;
  dur: number;
  /** 그중 쫓기던 초 */
  chasedSec: number;
  x: number;
  y: number;
  /** 시작 때 판 단계 · 갇힌 동료 수 · 가장 가까운 지점 */
  phase: string;
  jailed: number;
  near: string;
  /** 두뇌가 이동 입력 0을 낸 틱 비율 (1이면 스스로 선 것, 0이면 가려는데 막힌 것) */
  noInputShare: number;
  /** 시작 때 두뇌가 '위험한 목표 근처에서 기다리기(lurk)' 중이었으면 그 목표 (아니면 null) */
  lurk: string | null;
}

interface SurvivorStats {
  id: string;
  role: string;
  finalStatus: string;
  imprisonments: number;
  hitsTaken: number;
  rescuesDone: number;
  abilityUses: number;
  escapedAt: number | null;
  diedAt: number | null;
  /** 자유 상태로 지낸 초와 그 안의 내역 */
  freeSec: number;
  jailedSec: number;
  movingSec: number;
  /** 안 끝난 거점 원 안에 있던 초 (움직였든 섰든) · 켜진 탈출구 원 안 · 구조 진행 중 */
  inPointSec: number;
  inExitSec: number;
  rescuingSec: number;
  /** 쫓긴 초 (자유 상태에서) */
  chasedSec: number;
  /** 서 있던 시간 (정의는 파일 머리): 쫓기지 않을 때 · 쫓길 때 */
  idleSec: number;
  idleChasedSec: number;
  /** 쫓기지 않을 때 서 있던 시간 내역: 두뇌가 이동 입력 0 · 이동 입력이 있는데 못 움직임 */
  idleNoInputSec: number;
  idleBlockedSec: number;
  /** 쫓기지 않을 때 서 있던 시간, 판 단계별 */
  idleByPhase: Record<string, number>;
  /** 쫓기지 않을 때 서 있던 시간 중 동료가 갇혀 있던 초 */
  idleWhileMateJailedSec: number;
  /**
   * 쫓기지 않을 때 서 있던 시간 중 두뇌가 '위험한 목표 근처에서 기다리기(practiceBrains.ts lurkSpot)' 중이던 초, 목표별.
   * 진단용으로만 두뇌의 비공개 필드(lurk)를 읽는다 — 필드가 없으면 0으로 남는다
   */
  idleLurkSec: number;
  idleLurkBy: Record<string, number>;
}

interface PointStats {
  id: string;
  done: boolean;
  /** 완료 시각 (초) · 완료 순서 (1부터) */
  doneAt: number | null;
  order: number | null;
  firstCaptureAt: number | null;
  capturingSec: number;
  blockedSec: number;
  /** 판이 끝났을 때 진행도 (0~1) */
  progressEnd: number;
  /** 괴물이 반경 안 · 근처(NEAR_POINT)에 머문 초 */
  monsterInRadiusSec: number;
  monsterNearSec: number;
}

interface PhaseStats {
  /** 단계 길이 (초) */
  sec: number;
  /** 괴물이 안 끝난 거점 가운데 하나의 근처(NEAR_POINT) · 반경 안에 있던 초 */
  monsterNearUndoneSec: number;
  monsterInUndoneRadiusSec: number;
  /** 거점이 하나라도 점령되던 초 · 막혀 있던 초 */
  capturingSec: number;
  blockedSec: number;
  imprisonments: number;
  hits: number;
  /** 생존자 봇의 자유 시간 합 · 쫓기지 않고 서 있던 시간 합 (봇·초) */
  freeBotSec: number;
  idleBotSec: number;
}

interface MatchStats {
  seed: number;
  flow: string;
  winner: string;
  reason: string;
  /** 사람이 읽는 끝난 이유 */
  endLabel: string;
  durationSec: number;
  ticks: number;
  escaped: number;
  /** 괴물에게 잡혀 죽은 수 (시간 초과 사망 처리는 빼고) · 판이 끝났을 때 사망 상태 수 */
  killed: number;
  deadAtEnd: number;
  imprisonments: number;
  rescues: number;
  attack: { starts: number; strikes: number; strikesHit: number; hitsLanded: number };
  points: PointStats[];
  pointsDone: number;
  /** 탈출구가 켜진 시각 (모든 거점 완료) · 처음 열린 시각 · 탈출구별 상태가 바뀐 시각 */
  exitsOnAt: number | null;
  exitOpenAt: number | null;
  exitStates: Record<string, Record<string, number>>;
  firstEscapeAt: number | null;
  survivors: SurvivorStats[];
  monster: {
    /** 시작 정지(monsterStartDelay) 뒤 서 있던 초: 전체 · 기절로 선 것 · 스스로(기절 아님) */
    standSec: number;
    standStunSec: number;
    standFreeSec: number;
    /** 스스로 서 있던 초의 자리: 감옥 둘레 · 거점 둘레 · 탈출구 둘레 · 그 밖 */
    standWhere: Record<string, number>;
    /** 감옥 반경(prison.campRadius) 안: 전체 · 누가 갇혀 있을 때 */
    prisonRadiusSec: number;
    prisonRadiusJailedSec: number;
    dashes: number;
    roars: number;
    stuns: number;
    /** 자유 생존자를 보고 있던 초 */
    seeSec: number;
  };
  /**
   * 마지막 점령 구간: 탈출구를 켜는 데 점령이 한 곳만 더 필요하던 구간 (필요한 수 − 1곳 완료 ~ 필요한 수 완료 또는 판 끝).
   * 거점이 둘이면 남은 한 곳, 세 곳 중 두 곳이면 남은 두 곳 중 아무 데나 (id = 남은 거점 id를 이은 것, 거리는 가까운 쪽)
   */
  lastPoint: {
    id: string;
    startAt: number;
    endAt: number;
    sec: number;
    finished: boolean;
    monsterInRadiusSec: number;
    monsterNearSec: number;
    /** 그 구간에 그 거점이 점령되던 초 · 막혀 있던 초 · 구간 시작 때 진행도 · 그 구간의 수감 횟수 */
    capturingSec: number;
    blockedSec: number;
    progressAtStart: number;
    imprisonments: number;
    /** 그 구간에 괴물이 그 거점 둘레(반경 + 2타일)에 스스로 서 있던 초 (매복) */
    monsterAmbushSec: number;
  } | null;
  /** 판 단계별 (거점 k/n → 탈출구 켜짐 → 탈출구 열림) */
  phases: Record<string, PhaseStats>;
  /** 첫 명중 · 첫 수감 시각 (초, 없으면 null) */
  firstHitAt: number | null;
  firstImprisonAt: number | null;
  idleEpisodes: IdleEpisode[];
  /** 판의 큰 일 [초, 종류, 대상] */
  events: [number, string, string][];
  /** shared/src/sim/record.ts MatchRecorder 의 판 기록 (평가용 수치) */
  record: unknown;
  /** 결정성 비교용 (같은 seed · 같은 코드면 같다). wallMs 는 빼고 만든다 */
  fingerprint: string;
  wallMs: number;
}

interface Episode {
  t0: number;
  ticks: number;
  chased: number;
  noInput: number;
  x: number;
  y: number;
  phase: string;
  jailed: number;
  lurk: string | null;
}

/** 두뇌가 지금 기다리기(lurk) 중이면 그 목표 좌표 (진단용, 없으면 null) */
type LurkPeek = (id: string, tick: number) => Vec2 | null;

const r1 = (v: number): number => Math.round(v * 10) / 10;
const r2 = (v: number): number => Math.round(v * 100) / 100;
const r3 = (v: number): number => Math.round(v * 1000) / 1000;

/** 판을 지켜보는 관찰자: 틱마다 game.step 뒤에 부른다. 게임 상태를 읽기만 한다 */
class Probe {
  private readonly dt: number;
  private readonly surv = new Map<
    string,
    {
      s: SurvivorStats;
      prevX: number;
      prevY: number;
      prevStatus: string;
      prevAbilityCd: number;
      prevRescues: number;
      ep: Episode | null;
    }
  >();
  private readonly points = new Map<string, PointStats>();
  private readonly exitPrev = new Map<string, string>();
  private readonly exitStates: Record<string, Record<string, number>> = {};
  private readonly events: [number, string, string][] = [];
  private readonly episodes: IdleEpisode[] = [];
  private readonly attack = { starts: 0, strikes: 0, strikesHit: 0, hitsLanded: 0 };
  private readonly mon = {
    standSec: 0,
    standStunSec: 0,
    standFreeSec: 0,
    standWhere: {} as Record<string, number>,
    prisonRadiusSec: 0,
    prisonRadiusJailedSec: 0,
    dashes: 0,
    roars: 0,
    stuns: 0,
    seeSec: 0,
  };
  private mPrev: {
    x: number;
    y: number;
    attackCd: number;
    windup: number;
    dashCd: number;
    roarCd: number;
    stun: number;
    hits: number;
  };
  private doneOrder = 0;
  private exitsOnAt: number | null = null;
  private exitOpenAt: number | null = null;
  private firstEscapeAt: number | null = null;
  private imprisonments = 0;
  private killed = 0;
  private readonly phases: Record<string, PhaseStats> = {};
  private firstHitAt: number | null = null;
  private firstImprisonAt: number | null = null;
  private lastPoint: MatchStats['lastPoint'] = null;

  constructor(
    private readonly game: Game,
    private readonly sh: Shared,
    private readonly peekLurk: LurkPeek,
  ) {
    this.dt = game.dt;
    for (const s of game.survivors) {
      this.surv.set(s.id, {
        s: {
          id: s.id,
          role: s.role,
          finalStatus: s.status,
          imprisonments: 0,
          hitsTaken: 0,
          rescuesDone: 0,
          abilityUses: 0,
          escapedAt: null,
          diedAt: null,
          freeSec: 0,
          jailedSec: 0,
          movingSec: 0,
          inPointSec: 0,
          inExitSec: 0,
          rescuingSec: 0,
          chasedSec: 0,
          idleSec: 0,
          idleChasedSec: 0,
          idleNoInputSec: 0,
          idleBlockedSec: 0,
          idleByPhase: {},
          idleWhileMateJailedSec: 0,
          idleLurkSec: 0,
          idleLurkBy: {},
        },
        prevX: s.move.x,
        prevY: s.move.y,
        prevStatus: s.status,
        prevAbilityCd: s.abilityCd,
        prevRescues: s.stats.rescues,
        ep: null,
      });
    }
    for (const p of game.points) {
      this.points.set(p.id, {
        id: p.id,
        done: false,
        doneAt: null,
        order: null,
        firstCaptureAt: null,
        capturingSec: 0,
        blockedSec: 0,
        progressEnd: 0,
        monsterInRadiusSec: 0,
        monsterNearSec: 0,
      });
    }
    for (const e of game.exits) {
      this.exitPrev.set(e.id, e.state);
      this.exitStates[e.id] = {};
    }
    const m = game.monster;
    this.mPrev = {
      x: m.move.x,
      y: m.move.y,
      attackCd: m.attackCd,
      windup: m.windupLeft,
      dashCd: m.dashCd,
      roarCd: m.roarCd,
      stun: m.move.stun,
      hits: m.stats.hitsLanded,
    };
  }

  private pointCenter(id: string): Vec2 {
    const c = (this.sh.CAPTURE_POINTS as Record<string, Vec2>)[id];
    if (!c) throw new Error(`거점 ${id} 좌표를 모릅니다 (CAPTURE_POINTS)`);
    return c;
  }

  private exitCenter(id: string): Vec2 {
    const e = (this.sh.EXITS as Record<string, { center: Vec2 }>)[id];
    if (!e) throw new Error(`탈출구 ${id} 좌표를 모릅니다 (EXITS)`);
    return e.center;
  }

  /** 탈출구를 켜는 데 필요한 점령 수 (capturePoint.required — 키가 없던 규칙(거점 둘 모두)이면 거점 수) */
  private required(): number {
    const r = (this.game.balance.capturePoint as { required?: number }).required;
    return typeof r === 'number' ? r : this.game.points.length;
  }

  /** 판 단계: 필요한 점령이 남았으면 "거점 k/필요한 수", 다 끝났으면 탈출구 상태 */
  private phase(): string {
    const g = this.game;
    const done = g.points.filter((p) => p.done).length;
    const need = this.required();
    if (done < need) return `거점 ${done}/${need}`;
    if (g.exits.some((e) => e.state === 'open')) return '탈출구 열림';
    return '탈출구 켜짐';
  }

  private nearest(p: Vec2): string {
    const g = this.game;
    let best = '';
    let bestD = Infinity;
    const see = (label: string, c: Vec2): void => {
      const d = Math.hypot(p.x - c.x, p.y - c.y);
      if (d < bestD) {
        bestD = d;
        best = label;
      }
    };
    for (const q of g.points) see(`거점 ${q.id}${q.done ? '(완료)' : ''}`, this.pointCenter(q.id));
    for (const e of g.exits) see(`탈출구 ${e.id}`, this.exitCenter(e.id));
    see('구조 지점', this.sh.RESCUE_POINT);
    return `${best} ${r1(bestD)}타일`;
  }

  /** 좌표가 가리키는 지점 이름 (거점 · 탈출구 · 구조 지점) */
  private landmark(p: Vec2): string {
    const g = this.game;
    const at = (c: Vec2): boolean => Math.hypot(p.x - c.x, p.y - c.y) < 1e-6;
    for (const q of g.points) if (at(this.pointCenter(q.id))) return `거점 ${q.id}`;
    for (const e of g.exits) if (at(this.exitCenter(e.id))) return `탈출구 ${e.id}`;
    if (at(this.sh.RESCUE_POINT)) return '구조 지점';
    return `(${r1(p.x)}, ${r1(p.y)})`;
  }

  private ev(kind: string, who = ''): void {
    this.events.push([r1(this.game.time), kind, who]);
  }

  /** inputs: 이번 틱에 각 두뇌가 낸 입력 (서 있던 까닭을 가르는 데만 쓴다) */
  observe(inputs: ReadonlyMap<string, InputFrame | null>): void {
    const g = this.game;
    const b = g.balance;
    const dt = this.dt;
    const m = g.monster;
    const t = g.time;
    const phase = this.phase();
    const jailedNow = g.survivors.filter((s) => s.status === 'imprisoned').length;
    // 아직 점령할 수 있는 거점 (끝났거나 꺼진(off) 곳은 뺀다 — 꺼짐은 세 곳 중 두 곳 규칙에서 생긴다)
    const undone = g.points.filter((p) => !p.done && !(p as { off?: boolean }).off);
    const ph = (this.phases[phase] ??= {
      sec: 0,
      monsterNearUndoneSec: 0,
      monsterInUndoneRadiusSec: 0,
      capturingSec: 0,
      blockedSec: 0,
      imprisonments: 0,
      hits: 0,
      freeBotSec: 0,
      idleBotSec: 0,
    });
    ph.sec += dt;
    let nearUndone = false;
    let inUndone = false;
    for (const p of undone) {
      const c = this.pointCenter(p.id);
      const d = Math.hypot(m.move.x - c.x, m.move.y - c.y);
      if (d <= NEAR_POINT) nearUndone = true;
      if (d <= b.capturePoint.radius) inUndone = true;
    }
    if (nearUndone) ph.monsterNearUndoneSec += dt;
    if (inUndone) ph.monsterInUndoneRadiusSec += dt;
    if (g.points.some((p) => p.capturing)) ph.capturingSec += dt;
    if (g.points.some((p) => p.blocked)) ph.blockedSec += dt;

    // ── 괴물 ──
    const mp = this.mPrev;
    if (m.windupLeft > 0 && mp.windup <= 0) this.attack.starts += 1;
    if (m.attackCd > mp.attackCd + 1e-9) {
      this.attack.strikes += 1;
      const hits = m.stats.hitsLanded - mp.hits;
      this.attack.hitsLanded += hits;
      ph.hits += hits;
      if (hits > 0) {
        this.attack.strikesHit += 1;
        this.firstHitAt ??= r1(t);
      }
    }
    if (m.dashCd > mp.dashCd + 1e-9) {
      this.mon.dashes += 1;
      this.ev('돌진');
    }
    if (m.roarCd > mp.roarCd + 1e-9) {
      this.mon.roars += 1;
      this.ev('포효');
    }
    if (m.move.stun > mp.stun + 1e-9) {
      this.mon.stuns += 1;
      this.ev('기절');
    }
    const mMoved = Math.hypot(m.move.x - mp.x, m.move.y - mp.y) > MOVE_EPS;
    const mStoodFree = !mMoved && !(m.move.stun > 0 || mp.stun > 0);
    // frozen 은 이동 뒤에 줄어든다: 이번 틱에 0이 됐어도 이번 틱까지는 시작 정지였다 → 시작 정지 5초는 판 시각으로 뺀다
    const started = t > b.match.monsterStartDelay + 1e-9;
    if (started && !mMoved) {
      this.mon.standSec += dt;
      if (m.move.stun > 0 || mp.stun > 0) this.mon.standStunSec += dt;
      else {
        this.mon.standFreeSec += dt;
        let where = '그 밖';
        if (this.sh.distToRect(m.move, this.sh.PRISON_RECT) <= b.prison.campRadius + 2.5) where = '감옥 둘레';
        for (const p of g.points) {
          const c = this.pointCenter(p.id);
          if (Math.hypot(m.move.x - c.x, m.move.y - c.y) <= b.capturePoint.radius + 2)
            where = `거점 ${p.id} 둘레`;
        }
        for (const e of g.exits) {
          const c = this.exitCenter(e.id);
          if (Math.hypot(m.move.x - c.x, m.move.y - c.y) <= 4) where = `탈출구 ${e.id} 둘레`;
        }
        this.mon.standWhere[where] = (this.mon.standWhere[where] ?? 0) + dt;
      }
    }
    if (this.sh.distToRect(m.move, this.sh.PRISON_RECT) <= b.prison.campRadius) {
      this.mon.prisonRadiusSec += dt;
      if (jailedNow > 0) this.mon.prisonRadiusJailedSec += dt;
    }
    this.mPrev = {
      x: m.move.x,
      y: m.move.y,
      attackCd: m.attackCd,
      windup: m.windupLeft,
      dashCd: m.dashCd,
      roarCd: m.roarCd,
      stun: m.move.stun,
      hits: m.stats.hitsLanded,
    };

    // ── 거점 ──
    for (const p of g.points) {
      const ps = this.points.get(p.id);
      if (!ps) continue;
      const c = this.pointCenter(p.id);
      const dm = Math.hypot(m.move.x - c.x, m.move.y - c.y);
      if (dm <= b.capturePoint.radius) ps.monsterInRadiusSec += dt;
      if (dm <= NEAR_POINT) ps.monsterNearSec += dt;
      if (p.capturing) {
        ps.capturingSec += dt;
        if (ps.firstCaptureAt === null) {
          ps.firstCaptureAt = r1(t);
          this.ev('점령 시작', p.id);
        }
      }
      if (p.blocked) ps.blockedSec += dt;
      if (p.done && !ps.done) {
        ps.done = true;
        ps.doneAt = r1(t);
        this.doneOrder += 1;
        ps.order = this.doneOrder;
        this.ev('거점 완료', p.id);
      }
      ps.progressEnd = r3(p.progress / b.capturePoint.captureTime);
    }
    // 마지막 점령 구간: 필요한 점령이 한 곳만 남은 동안 (남은 거점은 하나 또는 그 이상)
    const doneNow = g.points.filter((p) => p.done).length;
    if (g.points.length >= 2) {
      const lastStage = doneNow === this.required() - 1 && undone.length > 0;
      // 남은 곳 중 괴물에게 가장 가까운 거점을 대표로 (거점 둘이면 남은 한 곳 그대로)
      let only: (typeof undone)[number] | undefined;
      let onlyD = Infinity;
      if (lastStage) {
        for (const p of undone) {
          const c = this.pointCenter(p.id);
          const d = Math.hypot(m.move.x - c.x, m.move.y - c.y);
          if (d < onlyD) {
            onlyD = d;
            only = p;
          }
        }
      }
      if (only && !this.lastPoint) {
        this.lastPoint = {
          id: undone.map((p) => p.id).join(''),
          startAt: r1(t),
          endAt: r1(t),
          sec: 0,
          finished: false,
          monsterInRadiusSec: 0,
          monsterNearSec: 0,
          capturingSec: 0,
          blockedSec: 0,
          progressAtStart: r3(Math.max(...undone.map((p) => p.progress)) / b.capturePoint.captureTime),
          imprisonments: 0,
          monsterAmbushSec: 0,
        };
      } else if (only && this.lastPoint) {
        const lp = this.lastPoint;
        const dm = onlyD;
        lp.sec += dt;
        lp.endAt = r1(t);
        if (dm <= b.capturePoint.radius) lp.monsterInRadiusSec += dt;
        if (dm <= NEAR_POINT) lp.monsterNearSec += dt;
        if (undone.some((p) => p.capturing)) lp.capturingSec += dt;
        if (undone.some((p) => p.blocked)) lp.blockedSec += dt;
        if (mStoodFree && dm <= b.capturePoint.radius + 2) lp.monsterAmbushSec += dt;
      } else if (!only && this.lastPoint && !this.lastPoint.finished && doneNow >= this.required()) {
        this.lastPoint.finished = true;
        this.lastPoint.endAt = r1(t);
      }
    }

    // ── 탈출구 ──
    for (const e of g.exits) {
      const prev = this.exitPrev.get(e.id);
      if (prev !== e.state) {
        this.exitPrev.set(e.id, e.state);
        const rec = (this.exitStates[e.id] ??= {});
        rec[e.state] ??= r1(t);
        this.ev(`탈출구 ${e.state}`, e.id);
        if (e.state === 'open' && this.exitOpenAt === null) this.exitOpenAt = r1(t);
      }
    }
    if (this.exitsOnAt === null && g.exits.some((e) => e.state !== 'inactive')) this.exitsOnAt = r1(t);

    // ── 생존자 ──
    let seesFree = false;
    for (const s of g.survivors) {
      const tr = this.surv.get(s.id);
      if (!tr) continue;
      const st = tr.s;
      const prevStatus = tr.prevStatus;
      if (prevStatus !== s.status) {
        if (prevStatus === 'free' && s.status === 'imprisoned') {
          st.imprisonments += 1;
          this.imprisonments += 1;
          ph.imprisonments += 1;
          this.firstImprisonAt ??= r1(t);
          if (this.lastPoint && !this.lastPoint.finished) this.lastPoint.imprisonments += 1;
          this.ev('수감', s.role);
        } else if (prevStatus === 'imprisoned' && s.status === 'free') {
          this.ev('풀려남', s.role);
        } else if (s.status === 'dead') {
          st.diedAt = r1(t);
          // 괴물에게 잡혀 죽음: 자유에서 바로 사망하고 판이 시간 초과로 끝난 틱이 아니다
          if (prevStatus === 'free' && g.end?.reason !== 'timeout') {
            this.killed += 1;
            this.ev('사망', s.role);
          } else this.ev('사망 처리', s.role);
        } else if (s.status === 'escaped') {
          st.escapedAt = r1(t);
          if (this.firstEscapeAt === null) this.firstEscapeAt = r1(t);
          this.ev('탈출', s.role);
        }
      }
      if (s.stats.rescues > tr.prevRescues) {
        st.rescuesDone += s.stats.rescues - tr.prevRescues;
        this.ev('구조', s.role);
      }
      tr.prevRescues = s.stats.rescues;
      if (s.abilityCd > tr.prevAbilityCd + 1e-9) {
        st.abilityUses += 1;
        this.ev('능력', s.role);
      }
      tr.prevAbilityCd = s.abilityCd;
      st.hitsTaken = s.stats.hitsTaken;
      st.finalStatus = s.status;

      let idleNow = false;
      let chased = false;
      let lurk: string | null = null;
      const input = inputs.get(s.id) ?? null;
      const noInput = !input || Math.hypot(input.mx, input.my) < 1e-6;
      if (s.status === 'imprisoned' && prevStatus === 'imprisoned') st.jailedSec += dt;
      // 자유로 지낸 틱만 (이번 틱에 풀려나거나 잡힌 틱은 순간이동이 섞여 뺀다)
      if (s.status === 'free' && prevStatus === 'free') {
        st.freeSec += dt;
        ph.freeBotSec += dt;
        const moved = Math.hypot(s.move.x - tr.prevX, s.move.y - tr.prevY) > MOVE_EPS;
        const dMon = Math.hypot(s.move.x - m.move.x, s.move.y - m.move.y);
        const seen = this.sh.monsterSees(b, m.move, m.move.face, m.blend, s.move);
        if (seen) seesFree = true;
        chased = seen || dMon <= CHASE_DIST;
        if (chased) st.chasedSec += dt;
        let inPoint = false;
        for (const p of undone) {
          const c = this.pointCenter(p.id);
          if (Math.hypot(s.move.x - c.x, s.move.y - c.y) <= b.capturePoint.radius) inPoint = true;
        }
        let inExit = false;
        for (const e of g.exits) {
          if (e.state !== 'active') continue;
          const c = this.exitCenter(e.id);
          if (Math.hypot(s.move.x - c.x, s.move.y - c.y) <= b.exit.radius) inExit = true;
        }
        const rescuing = s.rescueProgress > 0;
        if (inPoint) st.inPointSec += dt;
        if (inExit) st.inExitSec += dt;
        if (rescuing) st.rescuingSec += dt;
        if (moved) st.movingSec += dt;
        idleNow = !moved && !inPoint && !inExit && !rescuing;
        if (idleNow) {
          const anchor = this.peekLurk(s.id, g.tick);
          lurk = anchor ? this.landmark(anchor) : null;
          if (chased) st.idleChasedSec += dt;
          else {
            st.idleSec += dt;
            ph.idleBotSec += dt;
            if (noInput) st.idleNoInputSec += dt;
            else st.idleBlockedSec += dt;
            st.idleByPhase[phase] = (st.idleByPhase[phase] ?? 0) + dt;
            if (jailedNow > 0) st.idleWhileMateJailedSec += dt;
            if (lurk) {
              st.idleLurkSec += dt;
              st.idleLurkBy[lurk] = (st.idleLurkBy[lurk] ?? 0) + dt;
            }
          }
        }
      }
      // 서 있던 구간 (쫓김과 무관하게 이어진 구간, 길이 EPISODE_MIN_SEC 이상만 적는다)
      if (idleNow) {
        tr.ep ??= {
          t0: t - dt,
          ticks: 0,
          chased: 0,
          noInput: 0,
          x: s.move.x,
          y: s.move.y,
          phase,
          jailed: jailedNow,
          lurk,
        };
        tr.ep.ticks += 1;
        if (chased) tr.ep.chased += 1;
        if (noInput) tr.ep.noInput += 1;
      } else if (tr.ep) {
        this.closeEpisode(st, tr.ep);
        tr.ep = null;
      }
      tr.prevX = s.move.x;
      tr.prevY = s.move.y;
      tr.prevStatus = s.status;
    }
    if (seesFree) this.mon.seeSec += dt;
  }

  private closeEpisode(st: SurvivorStats, ep: Episode): void {
    const dur = ep.ticks * this.dt;
    if (dur < EPISODE_MIN_SEC) return;
    this.episodes.push({
      id: st.id,
      role: st.role,
      t0: r1(ep.t0),
      dur: r1(dur),
      chasedSec: r1(ep.chased * this.dt),
      x: r1(ep.x),
      y: r1(ep.y),
      phase: ep.phase,
      jailed: ep.jailed,
      near: this.nearest({ x: ep.x, y: ep.y }),
      noInputShare: r2(ep.noInput / Math.max(1, ep.ticks)),
      lurk: ep.lurk,
    });
  }

  finish(seed: number, flow: string, ticks: number, record: unknown, wallMs: number): MatchStats {
    const g = this.game;
    for (const tr of this.surv.values()) {
      if (tr.ep) this.closeEpisode(tr.s, tr.ep);
      tr.ep = null;
    }
    const round = (o: Record<string, number>): Record<string, number> =>
      Object.fromEntries(
        Object.entries(o)
          .map(([k, v]): [string, number] => [k, r1(v)])
          .filter(([, v]) => v > 0),
      );
    const survivors = [...this.surv.values()].map(({ s }) => ({
      ...s,
      freeSec: r1(s.freeSec),
      jailedSec: r1(s.jailedSec),
      movingSec: r1(s.movingSec),
      inPointSec: r1(s.inPointSec),
      inExitSec: r1(s.inExitSec),
      rescuingSec: r1(s.rescuingSec),
      chasedSec: r1(s.chasedSec),
      idleSec: r1(s.idleSec),
      idleChasedSec: r1(s.idleChasedSec),
      idleNoInputSec: r1(s.idleNoInputSec),
      idleBlockedSec: r1(s.idleBlockedSec),
      idleByPhase: round(s.idleByPhase),
      idleWhileMateJailedSec: r1(s.idleWhileMateJailedSec),
      idleLurkSec: r1(s.idleLurkSec),
      idleLurkBy: round(s.idleLurkBy),
    }));
    const points = [...this.points.values()].map((p) => ({
      ...p,
      capturingSec: r1(p.capturingSec),
      blockedSec: r1(p.blockedSec),
      monsterInRadiusSec: r1(p.monsterInRadiusSec),
      monsterNearSec: r1(p.monsterNearSec),
    }));
    const escaped = g.survivors.filter((s) => s.status === 'escaped').length;
    const deadAtEnd = g.survivors.filter((s) => s.status === 'dead').length;
    const winner = g.end?.winner ?? 'none';
    const reason = g.end?.reason ?? 'none';
    const lp = this.lastPoint;
    const fingerprint = createHash('sha1')
      .update(
        JSON.stringify({
          tick: g.tick,
          end: g.end,
          pos: [...g.players.values()].map((p) => [Math.round(p.move.x * 1000), Math.round(p.move.y * 1000)]),
          surv: g.survivors.map((s) => [s.status, s.hp, s.imprisonCount, s.stats.hitsTaken, s.stats.rescues]),
          hits: g.monster.stats.hitsLanded,
          points: g.points.map((p) => [p.id, p.done, Math.round(p.progress * 1000)]),
          exits: g.exits.map((e) => [e.id, e.state]),
          events: this.events,
        }),
      )
      .digest('hex')
      .slice(0, 16);
    return {
      seed,
      flow,
      winner,
      reason,
      endLabel: endLabel(winner, reason, escaped),
      durationSec: r1(g.time),
      ticks,
      escaped,
      killed: this.killed,
      deadAtEnd,
      imprisonments: this.imprisonments,
      rescues: g.survivors.reduce((a, s) => a + s.stats.rescues, 0),
      attack: { ...this.attack },
      points,
      pointsDone: points.filter((p) => p.done).length,
      exitsOnAt: this.exitsOnAt,
      exitOpenAt: this.exitOpenAt,
      exitStates: this.exitStates,
      firstEscapeAt: this.firstEscapeAt,
      survivors,
      monster: {
        ...this.mon,
        standSec: r1(this.mon.standSec),
        standStunSec: r1(this.mon.standStunSec),
        standFreeSec: r1(this.mon.standFreeSec),
        standWhere: round(this.mon.standWhere),
        prisonRadiusSec: r1(this.mon.prisonRadiusSec),
        prisonRadiusJailedSec: r1(this.mon.prisonRadiusJailedSec),
        seeSec: r1(this.mon.seeSec),
      },
      lastPoint: lp
        ? {
            ...lp,
            sec: r1(lp.sec),
            monsterInRadiusSec: r1(lp.monsterInRadiusSec),
            monsterNearSec: r1(lp.monsterNearSec),
            capturingSec: r1(lp.capturingSec),
            blockedSec: r1(lp.blockedSec),
            monsterAmbushSec: r1(lp.monsterAmbushSec),
          }
        : null,
      phases: Object.fromEntries(
        Object.entries(this.phases).map(([k, v]) => [
          k,
          {
            sec: r1(v.sec),
            monsterNearUndoneSec: r1(v.monsterNearUndoneSec),
            monsterInUndoneRadiusSec: r1(v.monsterInUndoneRadiusSec),
            capturingSec: r1(v.capturingSec),
            blockedSec: r1(v.blockedSec),
            imprisonments: v.imprisonments,
            hits: v.hits,
            freeBotSec: r1(v.freeBotSec),
            idleBotSec: r1(v.idleBotSec),
          },
        ]),
      ),
      firstHitAt: this.firstHitAt,
      firstImprisonAt: this.firstImprisonAt,
      idleEpisodes: this.episodes.sort((a, b) => b.dur - a.dur).slice(0, EPISODES_KEPT),
      events: this.events,
      record,
      fingerprint,
      wallMs: Math.round(wallMs),
    };
  }
}

function endLabel(winner: string, reason: string, escaped: number): string {
  if (winner === 'survivors') return `생존자 승: 탈출 ${escaped}명`;
  if (winner === 'monster') {
    if (reason === 'deaths') return '괴물 승: 사망 2명';
    if (reason === 'allImprisoned') return '괴물 승: 3명 동시 수감';
    if (reason === 'noFreeSurvivors') return '괴물 승: 자유 생존자 0명(수감 + 사망 · 탈출)';
    if (reason === 'timeout') return '괴물 승: 시간 초과';
    return `괴물 승: ${reason}`;
  }
  return `${winner}: ${reason}`;
}

// ───────────────────────── 판 돌리기 ─────────────────────────
interface Ctx {
  sh: Shared;
  sim: Sim;
  balance: Balance;
}

/** 감싼 두뇌의 원본 (진단용 lurk 엿보기) */
const INNER = new Map<string, SimNs.BotBrain>();

const peekLurk: LurkPeek = (id, tick) => {
  const brain = INNER.get(id) as unknown as
    { lurk?: { ax?: unknown; ay?: unknown; until?: unknown } | null } | undefined;
  const l = brain?.lurk;
  if (!l || typeof l.ax !== 'number' || typeof l.ay !== 'number' || typeof l.until !== 'number') return null;
  // 기다리는 동안 until(다시 고를 틱)은 늘 두뇌의 지금(= 마지막 스냅샷 틱, 판 틱보다 1~2 작다)보다 크다
  return l.until >= tick - 2 ? { x: l.ax, y: l.ay } : null;
};

/** 두뇌를 감싸 이번 틱에 낸 입력을 적어 둔다 (결정은 그대로) */
function tap(inner: SimNs.BotBrain, id: string, inputs: Map<string, InputFrame | null>): SimNs.BotBrain {
  INNER.set(id, inner);
  return {
    decide: (snap, info, b, seq) => {
      const out = inner.decide(snap, info, b, seq);
      inputs.set(id, out);
      return out;
    },
  };
}

/**
 * 실제 방 흐름: Room(연습 방 종류) + BotDriver. 빈 방에서 startMatch()를 부르면 네 역할이 모두 봇 자리로 채워진다
 * (p1 괴물 · p2 러너 · p3 가드 · p4 스카우트). 틱마다 Room.tick → BotDriver.beforeStep(자기 스냅샷 + predictSelf) → game.step →
 * 스냅샷 틱에 받는 사람별 스냅샷. 방 seed 와 두뇌 seed 는 기기 안 연습(client/src/localServer.ts)처럼 같은 값
 */
function runRoom(ctx: Ctx, seed: number): MatchStats {
  const { sh, sim, balance } = ctx;
  const t0 = performance.now();
  const inputs = new Map<string, InputFrame | null>();
  INNER.clear();
  const driver = new sim.BotDriver(
    (info) => tap(sim.practiceBrain(info.role, seed), info.you, inputs),
    balance,
  );
  const room = new sim.Room(
    `${sh.PRACTICE_ROOM_PREFIX}STAT`,
    { balance, seed, testHooks: false, practice: true },
    true,
    driver.hooks(),
    'practice',
  );
  room.startMatch();
  const game = room.game;
  if (!game) throw new Error('판이 시작되지 않았습니다');
  const bots = driver.botsOf(room);
  if (bots.length !== balance.match.players)
    throw new Error(`봇 자리 ${bots.length}개 (기대 ${balance.match.players})`);
  const recorder = new sim.MatchRecorder(game);
  const probe = new Probe(game, sh, peekLurk);
  const tickMs = 1000 / balance.network.serverTickHz;
  const limit = Math.ceil((balance.match.timeLimit + balance.match.lastSurvivorGrace + 5) / game.dt);
  let now = 0;
  let ticks = 0;
  /** 판 시작 카운트다운 동안의 틱 (봇은 입력을 보내지 않는다 — BotDriver, 플레이테스트 a-8) */
  let countdownTicks = 0;
  while (room.phase === 'playing' && ticks < limit) {
    now += tickMs;
    inputs.clear();
    const counting = game.countdownLeft;
    room.tick(now);
    ticks += 1;
    if (counting > 0) countdownTicks += 1;
    // 방이 이번 틱에 스냅샷용으로 계산한 것과 같은 시야 사실 (상태가 그대로라 값이 같다)
    const facts = sim.isSnapshotTick(balance, game.tick) || game.end ? sim.computeVisibility(game) : null;
    recorder.observe(game, facts);
    probe.observe(inputs);
  }
  if (!game.end) throw new Error(`seed ${seed}: 판이 끝나지 않았습니다 (${ticks}틱)`);
  for (const b of bots)
    if (b.inputs !== ticks - countdownTicks)
      throw new Error(`seed ${seed}: 봇 입력 ${b.inputs}개 (틱 ${ticks}, 카운트다운 ${countdownTicks})`);
  return probe.finish(seed, 'room', ticks, recorder.finish(game, `stat-${seed}`), performance.now() - t0);
}

/** SimMatch 흐름 (tests/bots/practice.test.ts playMatch · scripts/meta-calibrate.ts 와 같다) */
function runSim(ctx: Ctx, seed: number): MatchStats {
  const { sh, sim, balance } = ctx;
  const t0 = performance.now();
  const inputs = new Map<string, InputFrame | null>();
  INNER.clear();
  const setup = sim.SimMatch.roles();
  const brains = new Map<string, SimNs.BotBrain>(
    setup.map((p) => [p.id, tap(sim.practiceBrain(p.role, seed), p.id, inputs)]),
  );
  const match = new sim.SimMatch(setup, balance, brains, seed);
  const game = match.game;
  match.recorder = new sim.MatchRecorder(game);
  const probe = new Probe(game, sh, peekLurk);
  const limit = Math.ceil((balance.match.timeLimit + balance.match.lastSurvivorGrace + 5) / game.dt);
  let ticks = 0;
  while (!game.end && ticks < limit) {
    inputs.clear();
    match.step();
    ticks += 1;
    probe.observe(inputs);
  }
  if (!game.end) throw new Error(`seed ${seed}: 판이 끝나지 않았습니다 (${ticks}틱)`);
  return probe.finish(
    seed,
    'sim',
    ticks,
    match.recorder.finish(game, `stat-${seed}`),
    performance.now() - t0,
  );
}

// ───────────────────────── 요약 ─────────────────────────
function quantile(values: number[], q: number): number {
  if (values.length === 0) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const a = s[lo] ?? 0;
  const b = s[hi] ?? a;
  return a + (b - a) * (pos - lo);
}
const mean = (v: number[]): number => (v.length === 0 ? NaN : v.reduce((a, x) => a + x, 0) / v.length);
const sum = (v: number[]): number => v.reduce((a, x) => a + x, 0);
const pct = (num: number, den: number): number => (den === 0 ? NaN : Math.round((num / den) * 1000) / 10);
const fmt = (v: number, d = 1): string => (Number.isFinite(v) ? v.toFixed(d) : '–');
const mmss = (sec: number): string => {
  if (!Number.isFinite(sec)) return '–';
  const t = Math.round(sec);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

interface Dist {
  n: number;
  mean: number;
  median: number;
  p10: number;
  p90: number;
  min: number;
  max: number;
}
function distOf(v: number[]): Dist {
  return {
    n: v.length,
    mean: r1(mean(v)),
    median: r1(quantile(v, 0.5)),
    p10: r1(quantile(v, 0.1)),
    p90: r1(quantile(v, 0.9)),
    min: r1(Math.min(...v)),
    max: r1(Math.max(...v)),
  };
}

interface Summary {
  matches: number;
  seeds: string;
  flow: string;
  survivorWins: number;
  monsterWins: number;
  otherEnds: number;
  monsterWinRatePct: number;
  duration: Dist;
  durationSurvivorWin: Dist | null;
  durationMonsterWin: Dist | null;
  /** 판 길이가 7~10분(420~600초)인 판 수 */
  in7to10min: number;
  endReasons: Record<string, number>;
  timeouts: number;
  escapedAvg: number;
  killedAvg: number;
  imprisonmentsAvg: number;
  imprisonmentsByRole: Record<string, number>;
  rescuesAvg: number;
  attack: {
    starts: number;
    strikes: number;
    strikesHit: number;
    hitsLanded: number;
    hitRatePct: number;
    perMatchStrikes: number;
  };
  points: Record<
    string,
    {
      doneCount: number;
      donePct: number;
      firstCount: number;
      doneAtMean: number;
      doneAtMedian: number;
      monsterInRadiusAvg: number;
      monsterNearAvg: number;
      blockedAvg: number;
    }
  >;
  pointsDoneHist: Record<string, number>;
  exitsOn: { count: number; atMean: number; atMedian: number };
  exitOpen: { count: number; atMean: number; atMedian: number; byExit: Record<string, number> };
  idle: {
    /** 생존자 봇 1명당 판 평균 (초): 쫓기지 않을 때 · 쫓길 때 · 자유 시간 · 자유 시간 대비 % */
    perBotSec: number;
    perBotChasedSec: number;
    perBotFreeSec: number;
    perBotPctOfFree: number;
    perBotMedianSec: number;
    perBotP90Sec: number;
    noInputPct: number;
    whileMateJailedPct: number;
    /** 서 있던 시간 중 '위험한 목표 근처에서 기다리기(lurk)' 비율 (%)과 목표별 봇 1명 · 판당 초 */
    lurkPct: number;
    lurkBy: Record<string, number>;
    byRole: Record<string, { idleSec: number; idleChasedSec: number; freeSec: number; pctOfFree: number }>;
    byPhase: Record<string, number>;
  };
  monster: {
    standFreeAvg: number;
    standStunAvg: number;
    standPctOfMatch: number;
    standWhere: Record<string, number>;
    prisonRadiusAvg: number;
    prisonRadiusJailedAvg: number;
    prisonRadiusPctOfMatch: number;
    dashesAvg: number;
    roarsAvg: number;
    stunsAvg: number;
    seeSecAvg: number;
  };
  abilityAvg: Record<string, number>;
  lastPoint: {
    /** 남은 거점이 하나뿐인 구간에 들어간 판 · 그중 끝내 못 끝낸 판 · 못 끝낸 판의 끝난 이유 */
    reached: number;
    notFinished: number;
    notFinishedReasons: Record<string, number>;
    notFinishedSeeds: number[];
    /** 그 구간 길이 (초): 끝낸 판 · 못 끝낸 판 */
    secFinished: Dist | null;
    secNotFinished: Dist | null;
    /** 그 구간에서 괴물이 그 거점 반경 안 · 근처에 있던 비율 (%) · 그 거점이 실제로 점령되던 비율 (%) */
    monsterInRadiusPct: number;
    monsterNearPct: number;
    capturingPct: number;
    imprisonmentsAvg: number;
    /** 그 구간에서 괴물이 그 거점 둘레에 스스로 서 있던(매복) 비율 (%) */
    monsterAmbushPct: number;
    /** 첫 거점까지 걸린 시간 (초, 평균) — 마지막 거점 구간과 견준다 */
    firstPointAtMean: number;
  };
  /** 판 단계별: 그 단계가 있던 판 수 · 길이 · 괴물이 안 끝난 거점 근처에 있던 비율 · 점령되던 비율 · 분당 수감 · 생존자 봇이 서 있던 비율 */
  phases: Record<
    string,
    {
      matches: number;
      secMean: number;
      secMedian: number;
      monsterNearUndonePct: number;
      capturingPct: number;
      imprisonmentsPerMin: number;
      idlePctOfFree: number;
    }
  >;
  /** 생존자 봇 1명 · 판당 시간 내역 (초) */
  timeBudget: {
    free: number;
    jailed: number;
    moving: number;
    inPoint: number;
    inExit: number;
    rescuing: number;
    chased: number;
    idle: number;
  };
  firstHitAtMean: number;
  firstImprisonAtMean: number;
  /** 서 있던 시간이 큰 판 (봇 1명당 평균 초, 큰 순서) */
  idleTopSeeds: { seed: number; perBotSec: number; longestSec: number; end: string; durationSec: number }[];
  perf: { wallMsMean: number; wallMsMax: number; msPerTick: number; totalSec: number };
}

function summarize(ms: MatchStats[]): Summary {
  const n = ms.length;
  const surv = ms.filter((m) => m.winner === 'survivors');
  const monW = ms.filter((m) => m.winner === 'monster');
  const durations = ms.map((m) => m.durationSec);
  const endReasons: Record<string, number> = {};
  for (const m of ms) endReasons[m.endLabel] = (endReasons[m.endLabel] ?? 0) + 1;
  const roles = [...new Set(ms.flatMap((m) => m.survivors.map((s) => s.role)))];
  const pointIds = [...new Set(ms.flatMap((m) => m.points.map((p) => p.id)))];
  const allSurv = ms.flatMap((m) => m.survivors);
  const attack = {
    starts: sum(ms.map((m) => m.attack.starts)),
    strikes: sum(ms.map((m) => m.attack.strikes)),
    strikesHit: sum(ms.map((m) => m.attack.strikesHit)),
    hitsLanded: sum(ms.map((m) => m.attack.hitsLanded)),
    hitRatePct: 0,
    perMatchStrikes: 0,
  };
  attack.hitRatePct = pct(attack.strikesHit, attack.strikes);
  attack.perMatchStrikes = r1(attack.strikes / Math.max(1, n));
  const points: Summary['points'] = {};
  for (const id of pointIds) {
    const ps = ms.flatMap((m) => m.points.filter((p) => p.id === id));
    const done = ps.filter((p) => p.done);
    const at = done.map((p) => p.doneAt ?? 0);
    points[id] = {
      doneCount: done.length,
      donePct: pct(done.length, n),
      firstCount: ps.filter((p) => p.order === 1).length,
      doneAtMean: r1(mean(at)),
      doneAtMedian: r1(quantile(at, 0.5)),
      monsterInRadiusAvg: r1(mean(ps.map((p) => p.monsterInRadiusSec))),
      monsterNearAvg: r1(mean(ps.map((p) => p.monsterNearSec))),
      blockedAvg: r1(mean(ps.map((p) => p.blockedSec))),
    };
  }
  const pointsDoneHist: Record<string, number> = {};
  for (const m of ms) pointsDoneHist[String(m.pointsDone)] = (pointsDoneHist[String(m.pointsDone)] ?? 0) + 1;
  const on = ms.filter((m) => m.exitsOnAt !== null).map((m) => m.exitsOnAt ?? 0);
  const open = ms.filter((m) => m.exitOpenAt !== null).map((m) => m.exitOpenAt ?? 0);
  const openByExit: Record<string, number> = {};
  for (const m of ms)
    for (const [id, st] of Object.entries(m.exitStates))
      if (st.open !== undefined) openByExit[id] = (openByExit[id] ?? 0) + 1;
  const idleByRole: Summary['idle']['byRole'] = {};
  for (const role of roles) {
    const rs = allSurv.filter((s) => s.role === role);
    idleByRole[role] = {
      idleSec: r1(mean(rs.map((s) => s.idleSec))),
      idleChasedSec: r1(mean(rs.map((s) => s.idleChasedSec))),
      freeSec: r1(mean(rs.map((s) => s.freeSec))),
      pctOfFree: pct(sum(rs.map((s) => s.idleSec)), sum(rs.map((s) => s.freeSec))),
    };
  }
  const idleByPhase: Record<string, number> = {};
  for (const s of allSurv)
    for (const [k, v] of Object.entries(s.idleByPhase)) idleByPhase[k] = (idleByPhase[k] ?? 0) + v;
  for (const k of Object.keys(idleByPhase))
    idleByPhase[k] = r1((idleByPhase[k] ?? 0) / Math.max(1, allSurv.length));
  const idleTotal = sum(allSurv.map((s) => s.idleSec));
  const lurkBy: Record<string, number> = {};
  for (const s of allSurv)
    for (const [k, v] of Object.entries(s.idleLurkBy ?? {})) lurkBy[k] = (lurkBy[k] ?? 0) + v;
  for (const k of Object.keys(lurkBy)) lurkBy[k] = r1((lurkBy[k] ?? 0) / Math.max(1, allSurv.length));
  const standWhere: Record<string, number> = {};
  for (const m of ms)
    for (const [k, v] of Object.entries(m.monster.standWhere)) standWhere[k] = (standWhere[k] ?? 0) + v;
  for (const k of Object.keys(standWhere)) standWhere[k] = r1((standWhere[k] ?? 0) / Math.max(1, n));
  const abilityAvg: Record<string, number> = {};
  for (const role of roles)
    abilityAvg[role] = r2(
      mean(ms.map((m) => sum(m.survivors.filter((s) => s.role === role).map((s) => s.abilityUses)))),
    );
  const imprisonmentsByRole: Record<string, number> = {};
  for (const role of roles)
    imprisonmentsByRole[role] = r2(
      mean(ms.map((m) => sum(m.survivors.filter((s) => s.role === role).map((s) => s.imprisonments)))),
    );
  const lps = ms.filter((m) => m.lastPoint !== null);
  const lpNot = lps.filter((m) => !m.lastPoint?.finished);
  const lpFin = lps.filter((m) => m.lastPoint?.finished);
  const lpReasons: Record<string, number> = {};
  for (const m of lpNot) lpReasons[m.endLabel] = (lpReasons[m.endLabel] ?? 0) + 1;
  const lpSec = sum(lps.map((m) => m.lastPoint?.sec ?? 0));
  const firstAt = ms
    .map((m) => m.points.find((p) => p.order === 1)?.doneAt)
    .filter((v): v is number => typeof v === 'number');
  const totalDur = sum(durations);
  const phaseIds = [...new Set(ms.flatMap((m) => Object.keys(m.phases ?? {})))].sort(phaseOrder);
  const phases: Summary['phases'] = {};
  for (const id of phaseIds) {
    const ps = ms.map((m) => m.phases?.[id]).filter((p): p is PhaseStats => p !== undefined && p.sec >= 0.05);
    if (ps.length === 0) continue;
    const sec = sum(ps.map((p) => p.sec));
    phases[id] = {
      matches: ps.length,
      secMean: r1(mean(ps.map((p) => p.sec))),
      secMedian: r1(
        quantile(
          ps.map((p) => p.sec),
          0.5,
        ),
      ),
      monsterNearUndonePct: pct(sum(ps.map((p) => p.monsterNearUndoneSec)), sec),
      capturingPct: pct(sum(ps.map((p) => p.capturingSec)), sec),
      imprisonmentsPerMin: r2((sum(ps.map((p) => p.imprisonments)) / Math.max(1e-9, sec)) * 60),
      idlePctOfFree: pct(sum(ps.map((p) => p.idleBotSec)), sum(ps.map((p) => p.freeBotSec))),
    };
  }
  const budget = (f: (s: SurvivorStats) => number): number => r1(mean(allSurv.map(f)));
  const idleTopSeeds = ms
    .map((m) => ({
      seed: m.seed,
      perBotSec: r1(mean(m.survivors.map((s) => s.idleSec))),
      longestSec: Math.max(0, ...m.idleEpisodes.map((e) => e.dur)),
      end: m.endLabel,
      durationSec: m.durationSec,
    }))
    .sort((a, b) => b.perBotSec - a.perBotSec)
    .slice(0, 15);
  const hitAt = ms.map((m) => m.firstHitAt).filter((v): v is number => typeof v === 'number');
  const jailAt = ms.map((m) => m.firstImprisonAt).filter((v): v is number => typeof v === 'number');
  return {
    matches: n,
    seeds: seedsLabel(ms.map((m) => m.seed)),
    flow: [...new Set(ms.map((m) => m.flow))].join('+'),
    survivorWins: surv.length,
    monsterWins: monW.length,
    otherEnds: n - surv.length - monW.length,
    monsterWinRatePct: pct(monW.length, n),
    duration: distOf(durations),
    durationSurvivorWin: surv.length > 0 ? distOf(surv.map((m) => m.durationSec)) : null,
    durationMonsterWin: monW.length > 0 ? distOf(monW.map((m) => m.durationSec)) : null,
    in7to10min: ms.filter((m) => m.durationSec >= 420 && m.durationSec <= 600).length,
    endReasons,
    timeouts: ms.filter((m) => m.reason === 'timeout').length,
    escapedAvg: r2(mean(ms.map((m) => m.escaped))),
    killedAvg: r2(mean(ms.map((m) => m.killed))),
    imprisonmentsAvg: r2(mean(ms.map((m) => m.imprisonments))),
    imprisonmentsByRole,
    rescuesAvg: r2(mean(ms.map((m) => m.rescues))),
    attack,
    points,
    pointsDoneHist,
    exitsOn: { count: on.length, atMean: r1(mean(on)), atMedian: r1(quantile(on, 0.5)) },
    exitOpen: {
      count: open.length,
      atMean: r1(mean(open)),
      atMedian: r1(quantile(open, 0.5)),
      byExit: openByExit,
    },
    idle: {
      perBotSec: r1(mean(allSurv.map((s) => s.idleSec))),
      perBotChasedSec: r1(mean(allSurv.map((s) => s.idleChasedSec))),
      perBotFreeSec: r1(mean(allSurv.map((s) => s.freeSec))),
      perBotPctOfFree: pct(idleTotal, sum(allSurv.map((s) => s.freeSec))),
      perBotMedianSec: r1(
        quantile(
          allSurv.map((s) => s.idleSec),
          0.5,
        ),
      ),
      perBotP90Sec: r1(
        quantile(
          allSurv.map((s) => s.idleSec),
          0.9,
        ),
      ),
      noInputPct: pct(sum(allSurv.map((s) => s.idleNoInputSec)), idleTotal),
      whileMateJailedPct: pct(sum(allSurv.map((s) => s.idleWhileMateJailedSec)), idleTotal),
      lurkPct: pct(sum(allSurv.map((s) => s.idleLurkSec ?? 0)), idleTotal),
      lurkBy,
      byRole: idleByRole,
      byPhase: idleByPhase,
    },
    monster: {
      standFreeAvg: r1(mean(ms.map((m) => m.monster.standFreeSec))),
      standStunAvg: r1(mean(ms.map((m) => m.monster.standStunSec))),
      standPctOfMatch: pct(sum(ms.map((m) => m.monster.standFreeSec)), totalDur),
      standWhere,
      prisonRadiusAvg: r1(mean(ms.map((m) => m.monster.prisonRadiusSec))),
      prisonRadiusJailedAvg: r1(mean(ms.map((m) => m.monster.prisonRadiusJailedSec))),
      prisonRadiusPctOfMatch: pct(sum(ms.map((m) => m.monster.prisonRadiusSec)), totalDur),
      dashesAvg: r2(mean(ms.map((m) => m.monster.dashes))),
      roarsAvg: r2(mean(ms.map((m) => m.monster.roars))),
      stunsAvg: r2(mean(ms.map((m) => m.monster.stuns))),
      seeSecAvg: r1(mean(ms.map((m) => m.monster.seeSec))),
    },
    abilityAvg,
    lastPoint: {
      reached: lps.length,
      notFinished: lpNot.length,
      notFinishedReasons: lpReasons,
      notFinishedSeeds: lpNot.map((m) => m.seed),
      secFinished: lpFin.length > 0 ? distOf(lpFin.map((m) => m.lastPoint?.sec ?? 0)) : null,
      secNotFinished: lpNot.length > 0 ? distOf(lpNot.map((m) => m.lastPoint?.sec ?? 0)) : null,
      monsterInRadiusPct: pct(sum(lps.map((m) => m.lastPoint?.monsterInRadiusSec ?? 0)), lpSec),
      monsterNearPct: pct(sum(lps.map((m) => m.lastPoint?.monsterNearSec ?? 0)), lpSec),
      capturingPct: pct(sum(lps.map((m) => m.lastPoint?.capturingSec ?? 0)), lpSec),
      imprisonmentsAvg: r2(mean(lps.map((m) => m.lastPoint?.imprisonments ?? 0))),
      monsterAmbushPct: pct(sum(lps.map((m) => m.lastPoint?.monsterAmbushSec ?? 0)), lpSec),
      firstPointAtMean: r1(mean(firstAt)),
    },
    phases,
    timeBudget: {
      free: budget((s) => s.freeSec),
      jailed: budget((s) => s.jailedSec),
      moving: budget((s) => s.movingSec),
      inPoint: budget((s) => s.inPointSec),
      inExit: budget((s) => s.inExitSec),
      rescuing: budget((s) => s.rescuingSec),
      chased: budget((s) => s.chasedSec),
      idle: budget((s) => s.idleSec),
    },
    firstHitAtMean: r1(mean(hitAt)),
    firstImprisonAtMean: r1(mean(jailAt)),
    idleTopSeeds,
    perf: {
      wallMsMean: Math.round(mean(ms.map((m) => m.wallMs))),
      wallMsMax: Math.max(...ms.map((m) => m.wallMs)),
      msPerTick: r3(sum(ms.map((m) => m.wallMs)) / Math.max(1, sum(ms.map((m) => m.ticks)))),
      totalSec: r1(sum(ms.map((m) => m.wallMs)) / 1000),
    },
  };
}

/** 단계 순서: 거점 0/n → … → 탈출구 켜짐 → 탈출구 열림 */
function phaseOrder(a: string, b: string): number {
  const rank = (k: string): number => (k.startsWith('거점') ? 0 : k === '탈출구 켜짐' ? 1 : 2);
  return rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0);
}

function seedsLabel(seeds: number[]): string {
  if (seeds.length === 0) return '';
  const lo = Math.min(...seeds);
  const hi = Math.max(...seeds);
  return hi - lo + 1 === seeds.length ? `${lo}~${hi}` : seeds.join(',');
}

const ROLE_KO: Record<string, string> = { runner: '러너', guard: '가드', scout: '스카우트', monster: '괴물' };

function summaryMarkdown(s: Summary, title: string): string {
  const L: string[] = [];
  L.push(`### ${title}`);
  L.push('');
  L.push(`판 ${s.matches} (seed ${s.seeds}, 흐름 ${s.flow})`);
  L.push('');
  L.push('| 항목 | 값 |');
  L.push('|---|---|');
  L.push(
    `| 괴물 승률 | **${fmt(s.monsterWinRatePct)}%** (괴물 ${s.monsterWins} · 생존자 ${s.survivorWins}${s.otherEnds ? ` · 그 밖 ${s.otherEnds}` : ''}) |`,
  );
  L.push(
    `| 판 길이 중앙값 · 평균 | **${mmss(s.duration.median)}** (${fmt(s.duration.median)}초) · ${mmss(s.duration.mean)} (${fmt(s.duration.mean)}초) |`,
  );
  L.push(
    `| 판 길이 p10 · p90 · 최소 · 최대 | ${mmss(s.duration.p10)} · ${mmss(s.duration.p90)} · ${mmss(s.duration.min)} · ${mmss(s.duration.max)} |`,
  );
  if (s.durationSurvivorWin)
    L.push(
      `| 생존자 승 판 길이 중앙값 · 평균 | ${mmss(s.durationSurvivorWin.median)} · ${mmss(s.durationSurvivorWin.mean)} |`,
    );
  if (s.durationMonsterWin)
    L.push(
      `| 괴물 승 판 길이 중앙값 · 평균 | ${mmss(s.durationMonsterWin.median)} · ${mmss(s.durationMonsterWin.mean)} |`,
    );
  L.push(`| 판 길이 7~10분인 판 | ${s.in7to10min} / ${s.matches} (${fmt(pct(s.in7to10min, s.matches))}%) |`);
  L.push(`| 시간 초과로 끝난 판 | ${s.timeouts} / ${s.matches} (${fmt(pct(s.timeouts, s.matches))}%) |`);
  L.push(`| 판당 탈출 · 사망(잡혀서) | ${fmt(s.escapedAvg, 2)} · ${fmt(s.killedAvg, 2)} |`);
  L.push(
    `| 판당 수감 횟수 | **${fmt(s.imprisonmentsAvg, 2)}** (${Object.entries(s.imprisonmentsByRole)
      .map(([k, v]) => `${ROLE_KO[k] ?? k} ${fmt(v, 2)}`)
      .join(' · ')}) |`,
  );
  L.push(`| 판당 구조 횟수 | ${fmt(s.rescuesAvg, 2)} |`);
  L.push(
    `| 괴물 공격: 시도 · 휘두름 · 명중 · 명중률 | ${s.attack.starts} · ${s.attack.strikes} · ${s.attack.strikesHit} · **${fmt(s.attack.hitRatePct)}%** (판당 휘두름 ${fmt(s.attack.perMatchStrikes)}, 맞은 사람 수 ${s.attack.hitsLanded}) |`,
  );
  L.push(
    `| 판당 돌진 · 포효 · 기절당함 | ${fmt(s.monster.dashesAvg, 2)} · ${fmt(s.monster.roarsAvg, 2)} · ${fmt(s.monster.stunsAvg, 2)} |`,
  );
  L.push(
    `| 판당 생존자 능력 사용 | ${Object.entries(s.abilityAvg)
      .map(([k, v]) => `${ROLE_KO[k] ?? k} ${fmt(v, 2)}`)
      .join(' · ')} |`,
  );
  L.push(
    `| 탈출구가 켜진 판 · 켜진 시각(평균 · 중앙값) | ${s.exitsOn.count} / ${s.matches} · ${mmss(s.exitsOn.atMean)} · ${mmss(s.exitsOn.atMedian)} |`,
  );
  L.push(
    `| 탈출구가 열린 판 · 열린 시각(평균 · 중앙값) | ${s.exitOpen.count} / ${s.matches} · ${mmss(s.exitOpen.atMean)} · ${mmss(s.exitOpen.atMedian)} (${
      Object.entries(s.exitOpen.byExit)
        .map(([k, v]) => `${k} ${v}`)
        .join(' · ') || '–'
    }) |`,
  );
  L.push(
    `| 생존자 봇 1명당 서 있던 시간(쫓기지 않을 때) | **${fmt(s.idle.perBotSec)}초** (자유 시간 ${fmt(s.idle.perBotFreeSec)}초의 ${fmt(s.idle.perBotPctOfFree)}%, 중앙값 ${fmt(s.idle.perBotMedianSec)}초 · p90 ${fmt(s.idle.perBotP90Sec)}초) |`,
  );
  L.push(`| 〃 쫓길 때 | ${fmt(s.idle.perBotChasedSec)}초 |`);
  L.push(
    `| 괴물 봇 서 있던 시간(시작 5초 · 기절 제외) | ${fmt(s.monster.standFreeAvg)}초 (판 길이의 ${fmt(s.monster.standPctOfMatch)}%), 기절로 선 ${fmt(s.monster.standStunAvg)}초 |`,
  );
  L.push(
    `| 괴물이 감옥 반경 안에 머문 시간 | ${fmt(s.monster.prisonRadiusAvg)}초 (판 길이의 ${fmt(s.monster.prisonRadiusPctOfMatch)}%), 그중 누가 갇혀 있을 때 ${fmt(s.monster.prisonRadiusJailedAvg)}초 |`,
  );
  L.push(
    `| 한 판 계산 시간 | 평균 ${(s.perf.wallMsMean / 1000).toFixed(2)}초 · 최대 ${(s.perf.wallMsMax / 1000).toFixed(2)}초 (${s.perf.msPerTick}ms/틱, 모두 ${s.perf.totalSec}초) |`,
  );
  L.push('');
  L.push('끝난 이유');
  L.push('');
  L.push('| 끝난 이유 | 판 | 비율 |');
  L.push('|---|---|---|');
  for (const [k, v] of Object.entries(s.endReasons).sort((a, b) => b[1] - a[1]))
    L.push(`| ${k} | ${v} | ${fmt(pct(v, s.matches))}% |`);
  L.push('');
  L.push('거점');
  L.push('');
  L.push(
    '| 거점 | 점령 완료 판 | 먼저 끝난 판 | 완료 시각 평균 · 중앙값 | 괴물이 반경 안 (판당 초) | 괴물이 6타일 안 (판당 초) | 막힘 (판당 초) |',
  );
  L.push('|---|---|---|---|---|---|---|');
  for (const [id, p] of Object.entries(s.points))
    L.push(
      `| ${id} | ${p.doneCount} (${fmt(p.donePct)}%) | ${p.firstCount} | ${mmss(p.doneAtMean)} · ${mmss(p.doneAtMedian)} | ${fmt(p.monsterInRadiusAvg)} | ${fmt(p.monsterNearAvg)} | ${fmt(p.blockedAvg)} |`,
    );
  L.push('');
  L.push(
    `판이 끝났을 때 완료한 거점 수: ${Object.entries(s.pointsDoneHist)
      .sort()
      .map(([k, v]) => `${k}개 ${v}판`)
      .join(' · ')}`,
  );
  L.push('');
  L.push('마지막 점령 (탈출구를 켜는 데 한 곳만 더 필요하던 구간 — 거점이 둘이면 남은 한 곳, 세 곳 중 두 곳이면 남은 두 곳 중 아무 데나)');
  L.push('');
  L.push('| 항목 | 값 |');
  L.push('|---|---|');
  const lp = s.lastPoint;
  L.push(`| 그 구간에 들어간 판 | ${lp.reached} / ${s.matches} |`);
  L.push(
    `| 그중 마지막 점령을 끝내 못 끝낸 판 | **${lp.notFinished}** (${fmt(pct(lp.notFinished, lp.reached))}%) — ${
      Object.entries(lp.notFinishedReasons)
        .map(([k, v]) => `${k} ${v}`)
        .join(' · ') || '–'
    } |`,
  );
  L.push(`| 첫 거점 완료 시각 (평균) | ${mmss(lp.firstPointAtMean)} |`);
  if (lp.secFinished)
    L.push(
      `| 구간 길이, 끝낸 판 (중앙값 · 평균 · p90) | ${mmss(lp.secFinished.median)} · ${mmss(lp.secFinished.mean)} · ${mmss(lp.secFinished.p90)} |`,
    );
  if (lp.secNotFinished)
    L.push(
      `| 구간 길이, 못 끝낸 판 (중앙값 · 평균 · p90) | ${mmss(lp.secNotFinished.median)} · ${mmss(lp.secNotFinished.mean)} · ${mmss(lp.secNotFinished.p90)} |`,
    );
  L.push(
    `| 그 구간에서 괴물이 그 거점 반경 안 · 6타일 안에 있던 비율 | ${fmt(lp.monsterInRadiusPct)}% · **${fmt(lp.monsterNearPct)}%** |`,
  );
  L.push(`| 그 구간에서 그 거점이 실제로 점령되던 비율 | ${fmt(lp.capturingPct)}% |`);
  L.push(
    `| 그 구간에서 괴물이 그 거점 둘레(반경 + 2타일)에 서 있던(매복) 비율 | ${fmt(lp.monsterAmbushPct)}% |`,
  );
  L.push(`| 그 구간의 수감 횟수 (판당) | ${fmt(lp.imprisonmentsAvg, 2)} |`);
  L.push('');
  L.push('판 단계별');
  L.push('');
  L.push(
    '| 단계 | 있던 판 | 길이 평균 · 중앙값 | 괴물이 안 끝난 거점 6타일 안 | 거점이 점령되던 비율 | 분당 수감 | 생존자 봇이 서 있던 비율 |',
  );
  L.push('|---|---|---|---|---|---|---|');
  for (const [id, p] of Object.entries(s.phases))
    L.push(
      `| ${id} | ${p.matches} | ${mmss(p.secMean)} · ${mmss(p.secMedian)} | ${fmt(p.monsterNearUndonePct)}% | ${fmt(p.capturingPct)}% | ${fmt(p.imprisonmentsPerMin, 2)} | ${fmt(p.idlePctOfFree)}% |`,
    );
  L.push('');
  const tb = s.timeBudget;
  L.push(
    `생존자 봇 1명 · 판당 시간 내역 (초): 자유 ${fmt(tb.free)} (이동 ${fmt(tb.moving)} · 안 끝난 거점 원 안 ${fmt(tb.inPoint)} · 켜진 탈출구 원 안 ${fmt(tb.inExit)} · 구조 중 ${fmt(tb.rescuing)} · 서 있음 ${fmt(tb.idle)} / 쫓김 ${fmt(tb.chased)}) · 수감 ${fmt(tb.jailed)}`,
  );
  L.push('');
  L.push(`첫 명중 시각 평균 ${mmss(s.firstHitAtMean)} · 첫 수감 시각 평균 ${mmss(s.firstImprisonAtMean)}`);
  L.push('');
  L.push('생존자 봇이 서 있던 시간 (쫓기지 않을 때, 봇 1명 · 판당 초)');
  L.push('');
  L.push('| 역할 | 서 있던 시간 | 자유 시간 | 비율 | 쫓길 때 서 있던 시간 |');
  L.push('|---|---|---|---|---|');
  for (const [k, v] of Object.entries(s.idle.byRole))
    L.push(
      `| ${ROLE_KO[k] ?? k} | ${fmt(v.idleSec)} | ${fmt(v.freeSec)} | ${fmt(v.pctOfFree)}% | ${fmt(v.idleChasedSec)} |`,
    );
  L.push('');
  L.push(
    `판 단계별 (봇 1명 · 판당 초): ${
      Object.entries(s.idle.byPhase)
        .sort((a, b) => phaseOrder(a[0], b[0]))
        .map(([k, v]) => `${k} ${fmt(v)}`)
        .join(' · ') || '–'
    }`,
  );
  L.push('');
  L.push(
    `서 있던 시간 중 두뇌가 스스로 선(이동 입력 0) 비율 ${fmt(s.idle.noInputPct)}% · 동료가 갇혀 있던 때의 비율 ${fmt(s.idle.whileMateJailedPct)}%`,
  );
  L.push('');
  L.push(
    `서 있던 시간 중 '위험한 목표 근처에서 기다리기(lurk)' 비율 ${fmt(s.idle.lurkPct)}% — 목표별 (봇 1명 · 판당 초): ${
      Object.entries(s.idle.lurkBy)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k} ${fmt(v)}`)
        .join(' · ') || '–'
    }`,
  );
  L.push('');
  L.push(
    `괴물 봇이 스스로 서 있던 자리 (판당 초): ${
      Object.entries(s.monster.standWhere)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k} ${fmt(v)}`)
        .join(' · ') || '–'
    }`,
  );
  L.push('');
  L.push('생존자 봇이 서 있던 시간이 큰 판');
  L.push('');
  L.push('| seed | 봇 1명당 서 있던 시간 (초) | 가장 긴 구간 (초) | 판 길이 | 끝난 이유 |');
  L.push('|---|---|---|---|---|');
  for (const t of s.idleTopSeeds)
    L.push(`| ${t.seed} | ${fmt(t.perBotSec)} | ${fmt(t.longestSec)} | ${mmss(t.durationSec)} | ${t.end} |`);
  L.push('');
  return L.join('\n');
}

/** 전후 비교표 (같은 seed · 같은 판 수로 잰 두 결과) */
function compareMarkdown(a: Summary, b: Summary, nameA: string, nameB: string): string {
  const L: string[] = [];
  const row = (label: string, x: string, y: string): void => {
    L.push(`| ${label} | ${x} | ${y} |`);
  };
  L.push(`| 항목 | 전 (${nameA}) | 후 (${nameB}) |`);
  L.push('|---|---|---|');
  row(
    '판 수 (seed · 흐름)',
    `${a.matches} (${a.seeds} · ${a.flow})`,
    `${b.matches} (${b.seeds} · ${b.flow})`,
  );
  row(
    '괴물 승률',
    `${fmt(a.monsterWinRatePct)}% (${a.monsterWins}:${a.survivorWins})`,
    `${fmt(b.monsterWinRatePct)}% (${b.monsterWins}:${b.survivorWins})`,
  );
  row('판 길이 중앙값', mmss(a.duration.median), mmss(b.duration.median));
  row('판 길이 평균', mmss(a.duration.mean), mmss(b.duration.mean));
  row(
    '판 길이 p10 · p90',
    `${mmss(a.duration.p10)} · ${mmss(a.duration.p90)}`,
    `${mmss(b.duration.p10)} · ${mmss(b.duration.p90)}`,
  );
  row('판 길이 7~10분인 판', `${a.in7to10min}`, `${b.in7to10min}`);
  row('시간 초과', `${a.timeouts}`, `${b.timeouts}`);
  row('판당 수감', fmt(a.imprisonmentsAvg, 2), fmt(b.imprisonmentsAvg, 2));
  row('판당 구조', fmt(a.rescuesAvg, 2), fmt(b.rescuesAvg, 2));
  row('명중률', `${fmt(a.attack.hitRatePct)}%`, `${fmt(b.attack.hitRatePct)}%`);
  const ids = [...new Set([...Object.keys(a.points), ...Object.keys(b.points)])].sort();
  for (const id of ids) {
    const pa = a.points[id];
    const pb = b.points[id];
    row(
      `거점 ${id} 점령 완료 (먼저 끝난 판)`,
      pa ? `${pa.doneCount} (${pa.firstCount})` : '–',
      pb ? `${pb.doneCount} (${pb.firstCount})` : '–',
    );
  }
  const hist = (s: Summary): string =>
    Object.entries(s.pointsDoneHist)
      .sort()
      .map(([k, v]) => `${k}개 ${v}`)
      .join(' · ');
  row('끝났을 때 완료 거점 수', hist(a), hist(b));
  row(
    '마지막 점령을 못 끝낸 판',
    `${a.lastPoint.notFinished} / ${a.lastPoint.reached}`,
    `${b.lastPoint.notFinished} / ${b.lastPoint.reached}`,
  );
  row(
    '마지막 점령 구간에서 괴물이 남은 거점 6타일 안',
    `${fmt(a.lastPoint.monsterNearPct)}%`,
    `${fmt(b.lastPoint.monsterNearPct)}%`,
  );
  for (const id of [...new Set([...Object.keys(a.phases ?? {}), ...Object.keys(b.phases ?? {})])].sort(
    phaseOrder,
  )) {
    const pa = a.phases?.[id];
    const pb = b.phases?.[id];
    const cell = (p: Summary['phases'][string] | undefined): string =>
      p ? `${mmss(p.secMean)} (${p.matches}판, 괴물 근처 ${fmt(p.monsterNearUndonePct)}%)` : '–';
    row(`단계 '${id}' 길이 평균`, cell(pa), cell(pb));
  }
  row(
    '탈출구가 켜진 판 · 열린 판',
    `${a.exitsOn.count} · ${a.exitOpen.count}`,
    `${b.exitsOn.count} · ${b.exitOpen.count}`,
  );
  row(
    '생존자 봇 1명당 서 있던 시간 (쫓기지 않을 때)',
    `${fmt(a.idle.perBotSec)}초 (${fmt(a.idle.perBotPctOfFree)}%)`,
    `${fmt(b.idle.perBotSec)}초 (${fmt(b.idle.perBotPctOfFree)}%)`,
  );
  row('괴물 봇 서 있던 시간', `${fmt(a.monster.standFreeAvg)}초`, `${fmt(b.monster.standFreeAvg)}초`);
  row('괴물이 감옥 반경 안', `${fmt(a.monster.prisonRadiusAvg)}초`, `${fmt(b.monster.prisonRadiusAvg)}초`);
  L.push('');
  const reasons = [...new Set([...Object.keys(a.endReasons), ...Object.keys(b.endReasons)])].sort();
  L.push(`| 끝난 이유 | 전 | 후 |`);
  L.push('|---|---|---|');
  for (const k of reasons) L.push(`| ${k} | ${a.endReasons[k] ?? 0} | ${b.endReasons[k] ?? 0} |`);
  L.push('');
  return L.join('\n');
}

function gitInfo(repo: string): { head: string; dirty: number } {
  try {
    const quiet = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] } as const;
    const head = execFileSync('git', ['-C', repo, 'rev-parse', '--short', 'HEAD'], quiet).trim();
    const status = execFileSync('git', ['-C', repo, 'status', '--porcelain'], quiet);
    return { head, dirty: status.split('\n').filter((l) => l.trim() !== '').length };
  } catch {
    return { head: '?', dirty: -1 };
  }
}

function writeText(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.compare) {
    const [fa, fb] = args.compare;
    const a = JSON.parse(readFileSync(fa, 'utf8')) as { summary: Summary; meta: { gitHead: string } };
    const b = JSON.parse(readFileSync(fb, 'utf8')) as { summary: Summary; meta: { gitHead: string } };
    const md = compareMarkdown(a.summary, b.summary, a.meta.gitHead, b.meta.gitHead);
    console.log(md);
    if (args.md) writeText(args.md, md);
    return;
  }
  const sh = (await import(pathToFileURL(join(args.repo, 'shared/src/index.ts')).href)) as Shared;
  const sim = (await import(pathToFileURL(join(args.repo, 'shared/src/sim/index.ts')).href)) as Sim;
  const balancePath = args.balance ?? join(args.repo, 'config/balance.json');
  const balance = sh.validateBalance(JSON.parse(readFileSync(balancePath, 'utf8')));
  const ctx: Ctx = { sh, sim, balance };
  const seeds = args.seeds ?? Array.from({ length: args.matches }, (_, i) => args.seed + i);
  const prep0 = performance.now();
  sim.preparePracticeMap();
  const prepMs = performance.now() - prep0;
  const started = performance.now();
  const matches: MatchStats[] = [];
  for (const seed of seeds) {
    const m = args.flow === 'room' ? runRoom(ctx, seed) : runSim(ctx, seed);
    matches.push(m);
    if (!args.quiet) {
      const idle = r1(mean(m.survivors.map((s) => s.idleSec)));
      console.log(
        `seed ${String(seed).padStart(3)}: ${m.endLabel.padEnd(22)} ${mmss(m.durationSec).padStart(5)} 수감 ${m.imprisonments} 구조 ${m.rescues} ` +
          `거점 ${m.pointsDone}/${m.points.length} 휘두름 ${m.attack.strikes}(명중 ${m.attack.strikesHit}) 서있음 ${idle}초/봇 ${(m.wallMs / 1000).toFixed(1)}s`,
      );
    }
  }
  const summary = summarize(matches);
  const git = gitInfo(args.repo);
  const meta = {
    tool: 'bot-stats.ts',
    date: new Date().toISOString(),
    repo: args.repo,
    gitHead: git.head,
    gitDirtyFiles: git.dirty,
    flow: args.flow,
    seeds,
    balancePath,
    balanceHash: sh.balanceHash(balance),
    definitions: {
      chased: `괴물에게 보이는 중(monsterSees) 이거나 괴물과 직선 거리 ${CHASE_DIST}타일 안`,
      idle: `자유 상태 · 안 끝난 거점 원 밖 · 켜진(active) 탈출구 원 밖 · 구조 진행 0 인데 한 틱 이동 ${MOVE_EPS}타일 미만`,
      monsterStand: `판 시각 monsterStartDelay(${balance.match.monsterStartDelay}초) 뒤 한 틱 이동 ${MOVE_EPS}타일 미만 (기절은 따로)`,
      nearPoint: `거점 중심에서 ${NEAR_POINT}타일 안`,
      hitRate: '명중한 휘두름 / 끝까지 간 휘두름 (준비 중 기절로 끊긴 시도는 뺀다)',
    },
    prepMs: Math.round(prepMs),
    wallSec: r1((performance.now() - started) / 1000),
  };
  const md = summaryMarkdown(
    summary,
    `봇끼리 판 통계 (${git.head}${git.dirty > 0 ? ` + 고친 파일 ${git.dirty}` : ''})`,
  );
  console.log('');
  console.log(md);
  if (args.out) writeText(args.out, JSON.stringify({ meta, summary, matches }, null, 1));
  if (args.md) writeText(args.md, md);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});

// 판정 불변 골든 테스트 (MOBILE_PLAN 제안 15, M10a)
//
// 고정 시드 · 고정 역할 배치에서 스크립트 입력으로 한 판을 끝까지 돌리고, 60틱마다 게임 상태를 직렬화해 해시한다.
// 그래픽 · UI · 모바일 작업(M10~)은 규칙 · 판정 · 정보 차단을 바꾸지 않으므로 이 해시가 그대로여야 한다.
// 해시가 바뀌었다면 규칙이나 판정이 바뀐 것이다. 의도한 변경이면 docs/GAME_DESIGN.md 변경 이력에 적고
// 아래 GOLDEN_HASH를 새 값으로 갱신한다(실패 메시지에 새 값이 나온다).
//
// 스크립트는 상태를 보고 입력을 정하는 결정적 함수다(난수 · 실제 시간 없음). 이동 · 조준 · 공격 · 돌진 · 포효 ·
// 생존자 능력 3종 · 구조 · 시야 전환이 섞이고, 생존자 피격 · 수감 · 구조 · 점령 진행이 실제로 일어나는지도 확인한다.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  BTN,
  RESCUE_POINT,
  blocksStrike,
  segmentBlocked,
  type GameEvent,
  type InputFrame,
  type Vec2,
} from '@decoy/shared';
import type { Game } from '../../server/src/game';
import { computeVisibility } from '../../server/src/interest';
import type { MonsterState, SurvivorState } from '../../server/src/state';
import { buildResult } from '../../server/src/systems/match';
import { newGame } from '../helpers/fixtures';

/** 기대 해시. 규칙 · 판정을 일부러 바꿨을 때만 GAME_DESIGN 변경 이력과 함께 갱신한다 */
const GOLDEN_HASH = '619cc26cda1cbd6b7a1ceb767fe5461d477052aaa52bf274f9eaf47fe04c8178';
const SEED = 20261008;
/** 총 틱 수 (30Hz, 32초). 판은 913틱쯤 괴물 승리(3명 동시 수감)로 끝난다 */
const TOTAL_TICKS = 960;
/** 상태를 찍는 간격 (틱) */
const SAMPLE_EVERY = 60;

const CHANGED_MESSAGE =
  '규칙 · 판정이 바뀌었다 — 의도했다면 GAME_DESIGN 변경 이력과 함께 tests/unit/rules-golden.test.ts의 GOLDEN_HASH를 갱신';

interface Act {
  mx: number;
  my: number;
  aim?: number;
  held?: number;
  pressed?: number;
}

const IDLE: Act = { mx: 0, my: 0 };

/** 경유점을 차례로 따라간다. 다 왔으면 멈춘다 */
class Route {
  private i = 0;
  constructor(private readonly pts: readonly Vec2[]) {}

  get done(): boolean {
    return this.i >= this.pts.length;
  }

  steer(pos: Vec2): Act {
    while (this.i < this.pts.length) {
      const p = this.pts[this.i];
      if (!p) break;
      const dx = p.x - pos.x;
      const dy = p.y - pos.y;
      const d = Math.hypot(dx, dy);
      if (d > 0.2) return { mx: dx / d, my: dy / d, aim: Math.atan2(dy, dx) };
      this.i += 1;
    }
    return IDLE;
  }
}

/** 목표 쪽으로 걷고 조준하는 입력 (가까우면 멈추고 조준만) */
function toward(from: Vec2, to: Vec2, stopAt: number): Act {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const d = Math.hypot(dx, dy);
  const aim = Math.atan2(dy, dx);
  if (d <= stopAt) return { mx: 0, my: 0, aim };
  return { mx: dx / d, my: dy / d, aim };
}

function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** 괴물이 붙어서 칠 수 있으면 공격 버튼 */
function attackIfClose(m: MonsterState, target: SurvivorState): number {
  const ready = m.attackCd <= 0 && m.windupLeft <= 0;
  return target.status === 'free' && ready && dist(m.move, target.move) <= 1.05 ? BTN.ATTACK : 0;
}

/**
 * 한 판의 스크립트. 역할: p1 괴물 · p2 러너 · p3 가드 · p4 스카우트 (fixtures.setup4)
 *  1. 생존자 셋은 감옥 안 시작 자리에서 문으로 나온다. 러너는 질주로 거점 A에 가서 점령, 스카우트는 감옥 동남쪽,
 *     가드는 감옥 서남쪽에서 기다린다. 괴물은 시작 대기 중 시야 모드를 두 번 바꾼다(탐색 → 추적 → 탐색)
 *  2. 대기가 끝나면 괴물은 남쪽 복도를 따라오며 서쪽으로 돌진, 추적 모드로 바꿔 스카우트를 두 번 쳐서 수감한다
 *  3. 괴물은 포효하고 거점 A로 간다. 가드는 괴물을 밀쳐 기절시키고 감옥 문 앞에서 E를 3초 눌러 구조한다
 *  4. 풀려난 스카우트는 탐지를 쓰고 거점 B로, 가드도 B로 가서 함께 점령한다. 괴물은 A에 들어가(점령 정지)
 *     러너를 두 번 쳐서 수감한다
 *  5. 괴물은 감옥 문 앞으로 돌아와 지키고(캠핑, 탐색 모드), 구하러 온 가드를 구조 도중에 쳐서 수감,
 *     마지막으로 온 스카우트까지 수감해 3명 동시 수감으로 괴물이 이긴다
 */
class Script {
  private readonly runnerRoute = new Route([
    { x: 24.5, y: 18.6 },
    { x: 17.5, y: 18.6 },
    { x: 17.5, y: 16.5 },
    { x: 8, y: 16.5 },
  ]);
  private readonly scoutRoute = new Route([
    { x: 24, y: 18.6 },
    { x: 26.5, y: 20.5 },
  ]);
  private readonly guardRoute = new Route([
    { x: 23.5, y: 18.6 },
    { x: 21.6, y: 19.6 },
  ]);
  private readonly monsterIn = new Route([
    { x: 45, y: 25.5 },
    { x: 25.8, y: 25.5 },
    { x: 25.8, y: 21.6 },
  ]);
  private readonly monsterToA = new Route([
    { x: 26.6, y: 19.5 },
    { x: 17.5, y: 19.5 },
    { x: 17.5, y: 16.5 },
    { x: 10, y: 16.5 },
  ]);
  private readonly monsterToCamp = new Route([
    { x: 11, y: 16.5 },
    { x: 17.5, y: 16.5 },
    { x: 17.5, y: 19.5 },
    { x: 22.6, y: 20.2 },
  ]);
  private readonly scoutToB = new Route([
    { x: 26.5, y: 19.0 },
    { x: 33, y: 18.5 },
    { x: 39.5, y: 16.6 },
  ]);
  private readonly guardToB = new Route([
    { x: 27, y: 18.5 },
    { x: 33, y: 18.5 },
    { x: 40.5, y: 15.6 },
  ]);
  private readonly guardBack = new Route([
    { x: 33, y: 18.5 },
    { x: 27, y: 18.5 },
    { x: 24, y: 18.4 },
  ]);
  private readonly scoutBack = new Route([
    { x: 33, y: 18.5 },
    { x: 27, y: 18.5 },
    { x: 24.6, y: 18.4 },
  ]);
  private dashed = false;
  private roared = false;
  private shoved = false;
  private tracked = false;
  private released = false;
  private campSwitched = false;

  constructor(private readonly game: Game) {}

  private s(id: string): SurvivorState {
    const s = this.game.survivorById(id);
    if (!s) throw new Error(`생존자 없음 ${id}`);
    return s;
  }

  monster(tick: number): Act {
    const m = this.game.monster;
    const scout = this.s('p4');
    const runner = this.s('p2');
    // 시작 대기 중: 이동은 안 되고 조준 · 시야 모드 전환만 된다
    if (tick === 3 || tick === 40) return { mx: 0, my: 0, aim: -Math.PI / 2, pressed: BTN.MODE };
    if (m.move.frozen > 0) return { mx: 0, my: 0, aim: -Math.PI / 2 };
    // 2) 스카우트를 잡을 때까지
    if (scout.imprisonCount === 0) {
      if (!this.monsterIn.done) {
        const a = this.monsterIn.steer(m.move);
        if (!this.dashed && m.move.x < 40 && m.move.y > 25) {
          this.dashed = true;
          return { ...a, pressed: BTN.DASH };
        }
        return a;
      }
      const a = toward(m.move, scout.move, 0.8);
      const mode = m.mode === 'search' ? BTN.MODE : 0;
      return { ...a, pressed: mode | attackIfClose(m, scout) };
    }
    // 3) 수감 직후 포효 한 번
    if (!this.roared) {
      this.roared = true;
      return { mx: 0, my: 0, aim: m.move.face, pressed: BTN.ROAR };
    }
    // 5) 러너도 수감되면 감옥 문 앞으로 돌아와 지킨다. 도착하면 탐색 모드로, 구조 구역에 들어온 생존자를 친다
    if (runner.status === 'imprisoned') {
      if (!this.monsterToCamp.done) return this.monsterToCamp.steer(m.move);
      if (!this.campSwitched) {
        this.campSwitched = true;
        return { mx: 0, my: 0, aim: m.move.face, pressed: BTN.MODE };
      }
      const target = this.game.survivors.find((s) => s.status === 'free' && dist(s.move, RESCUE_POINT) <= 2);
      if (!target) return { mx: 0, my: 0, aim: -Math.PI / 2 };
      return { ...toward(m.move, target.move, 0.8), pressed: attackIfClose(m, target) };
    }
    // 4) 거점 A의 러너에게
    if (!this.monsterToA.done) return this.monsterToA.steer(m.move);
    return { ...toward(m.move, runner.move, 0.8), pressed: attackIfClose(m, runner) };
  }

  runner(tick: number): Act {
    const r = this.s('p2');
    const a = this.runnerRoute.steer(r.move);
    // 감옥 문을 나서자마자 질주
    if (tick === 20) return { ...a, pressed: BTN.ABILITY };
    // 한 번 맞으면 거점 안에서 북쪽으로 비켜 선다 (점령은 계속)
    if (this.runnerRoute.done && r.hp === 1 && r.move.y > 15.2) return { mx: 0, my: -1 };
    return a;
  }

  guard(): Act {
    const g = this.s('p3');
    const scout = this.s('p4');
    const runner = this.s('p2');
    const m = this.game.monster;
    if (g.status !== 'free') return IDLE;
    if (runner.status === 'imprisoned') {
      // 5) 러너를 구하러 B에서 돌아와 E를 누른다 (지키는 괴물에게 맞으면 구조가 끊긴다)
      if (!this.guardBack.done) return this.guardBack.steer(g.move);
      return { mx: 0, my: 0, held: BTN.RESCUE };
    }
    if (!this.released && scout.status === 'imprisoned') {
      // 3) 괴물을 밀쳐 기절시킨 뒤 문 앞에서 구조 (E를 누르고 있기)
      if (!this.shoved) {
        if (dist(g.move, m.move) <= 1.8 && !segmentBlocked(g.move, m.move, blocksStrike)) {
          this.shoved = true;
          return { mx: 0, my: 0, pressed: BTN.ABILITY };
        }
        return toward(g.move, m.move, 1.2);
      }
      const spot = { x: 24, y: 18.4 };
      if (dist(g.move, spot) > 0.15) return toward(g.move, spot, 0.1);
      return { mx: 0, my: 0, held: BTN.RESCUE };
    }
    if (scout.imprisonCount > 0 && scout.status === 'free') {
      // 4) 구조를 마치면 거점 B로
      this.released = true;
      return this.guardToB.steer(g.move);
    }
    return this.guardRoute.steer(g.move);
  }

  scout(): Act {
    const sc = this.s('p4');
    if (sc.status !== 'free') return IDLE;
    if (this.s('p2').status === 'imprisoned' && this.s('p3').status === 'imprisoned') {
      // 5) 둘 다 갇히면 B를 두고 구하러 간다. 구조 구역에 들어서면 E
      if (dist(sc.move, RESCUE_POINT) <= 1) return { mx: 0, my: 0, held: BTN.RESCUE };
      return this.scoutBack.steer(sc.move);
    }
    if (sc.imprisonCount > 0) {
      // 4) 풀려나면 탐지(괴물 위치 공유)를 쓰고 거점 B로
      if (!this.tracked) {
        this.tracked = true;
        return { mx: 0, my: 0, pressed: BTN.ABILITY };
      }
      return this.scoutToB.steer(sc.move);
    }
    // 1~2) 감옥 동남쪽에서 기다린다 (괴물이 와도 그 자리에)
    return this.scoutRoute.steer(sc.move);
  }

  inputs(tick: number): Record<string, Act> {
    return { p1: this.monster(tick), p2: this.runner(tick), p3: this.guard(), p4: this.scout() };
  }
}

function r6(v: number): number {
  const r = Math.round(v * 1e6) / 1e6;
  // -0을 0으로 (JSON에서는 같지만 의도를 분명히)
  return r === 0 ? 0 : r;
}

/** 판정에 쓰이는 상태 전부 (위치 · 시간은 1e-6 반올림) */
function serialize(game: Game): string {
  const players = [...game.players.values()]
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((p) => {
      const mv = p.move;
      const base = {
        id: p.id,
        role: p.role,
        x: r6(mv.x),
        y: r6(mv.y),
        face: r6(mv.face),
        frozen: r6(mv.frozen),
        stun: r6(mv.stun),
        dash: r6(mv.dash),
        dashLeft: r6(mv.dashLeft),
        aimLock: r6(mv.aimLock),
        sprint: r6(mv.sprint),
        turnSlow: r6(mv.turnSlow),
        camp: r6(mv.camp),
        ack: p.ack,
        stats: {
          hitsTaken: p.stats.hitsTaken,
          hitsLanded: p.stats.hitsLanded,
          rescues: p.stats.rescues,
          captureSeconds: r6(p.stats.captureSeconds),
        },
      };
      if (p.kind === 'monster') {
        return {
          ...base,
          attackCd: r6(p.attackCd),
          windupLeft: r6(p.windupLeft),
          windupDir: r6(p.windupDir),
          dashCd: r6(p.dashCd),
          roarCd: r6(p.roarCd),
          mode: p.mode,
          blend: r6(p.blend),
          roarRevealLeft: r6(p.roarRevealLeft),
          roar: [r6(p.roarX), r6(p.roarY)],
          trackedLeft: r6(p.trackedLeft),
          pointCamp: [r6(p.pointCamp.A), r6(p.pointCamp.B)],
        };
      }
      return {
        ...base,
        status: p.status,
        hp: p.hp,
        imprisonCount: p.imprisonCount,
        protectLeft: r6(p.protectLeft),
        abilityCd: r6(p.abilityCd),
        abilityActive: r6(p.abilityActive),
        revealLeft: r6(p.revealLeft),
        rescueProgress: r6(p.rescueProgress),
      };
    });
  // 정보 차단 판정: 괴물이 보는 생존자, 생존자 시야 합집합 안의 괴물
  const vis = computeVisibility(game);
  return JSON.stringify({
    tick: game.tick,
    time: r6(game.time),
    timeLeft: r6(game.timeLeft),
    grace: game.grace === null ? null : r6(game.grace),
    paused: game.paused,
    end: game.end,
    codes: game.codes,
    capturedCount: game.capturedCount,
    points: game.points.map((p) => ({
      id: p.id,
      progress: r6(p.progress),
      done: p.done,
      capturing: p.capturing,
      blocked: p.blocked,
    })),
    exits: game.exits.map((e) => ({ id: e.id, state: e.state, progress: r6(e.progress) })),
    prison: game.survivors.filter((s) => s.status === 'imprisoned').map((s) => s.id),
    players,
    monsterSees: [...vis.monsterSees].sort(),
    survivorsSeeMonster: vis.survivorsSeeMonster,
    // 판이 끝났으면 결과 판정 (승리 팀 · 등급 · 결말 · 기록)
    result: game.end ? buildResult(game) : null,
  });
}

interface RunResult {
  hash: string;
  samples: string[];
  /** 받는 사람별 이벤트를 모두 더한 수 (종류별) */
  events: Map<string, number>;
  /** 한 번이라도 관찰된 상황 */
  seen: Set<string>;
  game: Game;
}

function frameOf(seq: number, a: Act): InputFrame {
  return { seq, mx: a.mx, my: a.my, aim: a.aim ?? Number.NaN, held: a.held ?? 0, pressed: a.pressed ?? 0 };
}

function countEvent(events: Map<string, number>, ev: GameEvent): void {
  const key = ev.k === 'text' ? `text:${ev.id}` : ev.k;
  events.set(key, (events.get(key) ?? 0) + 1);
}

function observe(game: Game, seen: Set<string>, prevRescue: Map<string, number>): void {
  const m = game.monster;
  if (m.mode === 'hunt') seen.add('hunt');
  if (m.move.dash > 0) seen.add('dash');
  if (m.move.stun > 0) seen.add('stun');
  if (m.move.camp > 0) seen.add('camp');
  if (m.windupLeft > 0) seen.add('windup');
  if (m.trackedLeft > 0) seen.add('tracked');
  if (m.roarRevealLeft > 0) seen.add('roarReveal');
  for (const s of game.survivors) {
    if (s.move.sprint > 0) seen.add('sprint');
    if (s.rescueProgress > 0) seen.add('rescuing');
    if (s.protectLeft > 0) seen.add('protected');
    if (s.status === 'imprisoned') seen.add(`imprisoned:${s.role}`);
    // 구조 중에 맞아서 진행이 끊김
    if ((prevRescue.get(s.id) ?? 0) > 0 && s.rescueProgress === 0 && s.hitTick === game.tick) {
      seen.add('rescueInterrupted');
    }
    prevRescue.set(s.id, s.rescueProgress);
  }
  for (const p of game.points) {
    if (p.capturing) seen.add(`capturing:${p.id}`);
    if (p.blocked) seen.add(`blocked:${p.id}`);
  }
}

function runScenario(): RunResult {
  const game = newGame(SEED);
  const script = new Script(game);
  const seqs = new Map<string, number>();
  const events = new Map<string, number>();
  const seen = new Set<string>();
  const prevRescue = new Map<string, number>();
  const samples: string[] = [];
  const hash = createHash('sha256');
  const record = (): void => {
    const line = serialize(game);
    samples.push(line);
    hash.update(line);
    hash.update('\n');
  };
  // 수치(balance.json)도 판정의 일부다: 시나리오에 드러나지 않는 값(예: 공격 사거리)을 바꿔도 해시가 바뀌게
  hash.update(JSON.stringify(game.balance));
  hash.update('\n');
  record();
  for (let t = 0; t < TOTAL_TICKS; t += 1) {
    // 판이 끝나면 step()은 아무것도 하지 않는다 (같은 상태가 찍힌다)
    for (const [id, act] of Object.entries(script.inputs(game.tick))) {
      const seq = (seqs.get(id) ?? 0) + 1;
      seqs.set(id, seq);
      game.queueInput(id, [frameOf(seq, act)]);
    }
    game.step();
    for (const id of game.players.keys()) {
      for (const ev of game.drainOutbox(id)) countEvent(events, ev);
    }
    observe(game, seen, prevRescue);
    if ((t + 1) % SAMPLE_EVERY === 0) record();
  }
  return { hash: hash.digest('hex'), samples, events, seen, game };
}

describe('판정 불변 골든 (M10~ 작업 중 규칙 · 판정 · 정보 차단이 그대로인지)', () => {
  const first = runScenario();

  it('시나리오가 피격 · 수감 · 구조 · 점령 진행 · 능력 · 시야 전환을 실제로 거친다 (빈 시나리오 방지)', () => {
    const { game, events, seen } = first;
    expect(TOTAL_TICKS).toBeGreaterThanOrEqual(600);
    const runner = game.survivorById('p2');
    const guard = game.survivorById('p3');
    const scout = game.survivorById('p4');
    // 피격 · 수감: 셋 다 두 번씩 맞아 수감, 스카우트는 두 번 수감
    expect(game.monster.stats.hitsLanded).toBeGreaterThanOrEqual(6);
    expect(runner?.stats.hitsTaken).toBeGreaterThanOrEqual(2);
    expect(seen.has('imprisoned:runner')).toBe(true);
    expect(seen.has('imprisoned:guard')).toBe(true);
    expect(scout?.imprisonCount).toBe(2);
    // 구조: 한 번 성공(보호 시간), 한 번은 구조 도중 맞아 끊김
    expect(seen.has('rescuing')).toBe(true);
    expect(guard?.stats.rescues).toBe(1);
    expect(seen.has('protected')).toBe(true);
    expect(seen.has('rescueInterrupted')).toBe(true);
    // 점령 진행 (A는 러너, B는 가드 + 스카우트), 괴물이 A에 들어와 정지
    expect(seen.has('capturing:A')).toBe(true);
    expect(seen.has('capturing:B')).toBe(true);
    expect(seen.has('blocked:A')).toBe(true);
    expect(game.points.find((p) => p.id === 'A')?.progress ?? 0).toBeGreaterThan(5);
    expect(game.points.find((p) => p.id === 'B')?.progress ?? 0).toBeGreaterThan(1);
    // 괴물: 공격 준비 · 돌진 · 포효 · 시야 전환 · 캠핑, 가드 밀치기로 기절
    expect(seen.has('windup')).toBe(true);
    expect(seen.has('dash')).toBe(true);
    expect(events.get('roarPings') ?? 0).toBe(1);
    expect(seen.has('roarReveal')).toBe(true);
    expect(seen.has('hunt')).toBe(true);
    expect(events.get('modeSwitch') ?? 0).toBeGreaterThanOrEqual(4);
    expect(seen.has('camp')).toBe(true);
    expect(seen.has('stun')).toBe(true);
    // 생존자 능력 3종 (질주 · 밀치기 · 탐지)
    expect(seen.has('sprint')).toBe(true);
    expect(seen.has('tracked')).toBe(true);
    // 승패: 3명 동시 수감으로 괴물 승리
    expect(game.end?.winner).toBe('monster');
    expect(game.end?.reason).toBe('allImprisoned');
    expect(game.end?.tick ?? 0).toBeLessThan(TOTAL_TICKS);
  });

  it('같은 입력을 다시 돌리면 같은 상태 · 같은 해시 (결정성)', () => {
    const second = runScenario();
    expect(second.samples).toEqual(first.samples);
    expect(second.hash).toBe(first.hash);
  });

  it('게임 상태 해시가 기대값과 같다', () => {
    expect(first.samples.length).toBe(TOTAL_TICKS / SAMPLE_EVERY + 1);
    expect(first.hash, `${CHANGED_MESSAGE} (새 해시 ${first.hash})`).toBe(GOLDEN_HASH);
  });
});

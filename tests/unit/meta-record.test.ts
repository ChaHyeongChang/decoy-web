// 판 기록 (GAME_DESIGN 12장 '판 평가'): 판정 상태를 읽기만 하고 평가 수치를 바르게 센다
import { describe, expect, it } from 'vitest';
import { BTN, CAPTURE_POINTS, EXITS, RESCUE_POINT, type InputFrame } from '@decoy/shared';
import {
  MatchRecorder,
  SimMatch,
  computeVisibility,
  practiceBrain,
  preparePracticeMap,
  type BotBrain,
  type Game,
} from '@decoy/shared/sim';
import { Driver, loadTestBalance, place, readyGame } from '../helpers/fixtures';

const balance = loadTestBalance();

/** 입력을 넣고 n틱 진행하며 틱마다 기록기에 보인다 (시야 사실은 매 틱 — 방은 스냅샷 틱에만 준다) */
function drive(
  game: Game,
  d: Driver,
  rec: MatchRecorder,
  ticks: number,
  inputs: Record<string, [number, number, Partial<InputFrame>?]> = {},
  everyTick = true,
): void {
  for (let t = 0; t < ticks; t += 1) {
    for (const p of game.players.values()) {
      const i = inputs[p.id];
      d.input(p.id, i?.[0] ?? 0, i?.[1] ?? 0, i?.[2] ?? {});
    }
    game.step();
    rec.observe(game, everyTick || t % 2 === 0 ? computeVisibility(game) : null);
  }
}

function statsOf(rec: MatchRecorder, game: Game, id: string): Record<string, number> {
  const p = rec.finish(game, 'T.1.x').players.find((q) => q.id === id);
  if (!p) throw new Error(`기록 없음 ${id}`);
  return p.stats as Record<string, number>;
}

describe('판 기록: 판정 상태를 바꾸지 않는다', () => {
  it('실전 봇 판을 기록기를 켜고 · 끄고 돌린 상태가 같다 (위치 · 체력 · 상태 · 시간 · 거점 · 탈출구 · 결과)', () => {
    preparePracticeMap();
    const fingerprint = (withRecorder: boolean): string => {
      const setup = SimMatch.roles();
      const brains = new Map<string, BotBrain>(setup.map((p) => [p.id, practiceBrain(p.role, 4)]));
      const sim = new SimMatch(setup, balance, brains, 4);
      if (withRecorder) sim.recorder = new MatchRecorder(sim.game);
      const g = sim.game;
      for (let i = 0; i < 30 * 240 && !g.end; i += 1) sim.step();
      return JSON.stringify({
        tick: g.tick,
        time: g.time,
        end: g.end,
        points: g.points,
        exits: g.exits,
        players: [...g.players.values()].map((p) => ({
          id: p.id,
          move: p.move,
          stats: p.stats,
          ...(p.kind === 'survivor'
            ? { status: p.status, hp: p.hp, imprisonCount: p.imprisonCount, cd: p.abilityCd }
            : { cd: [p.attackCd, p.dashCd, p.roarCd] }),
        })),
      });
    };
    const off = fingerprint(false);
    expect(fingerprint(true)).toBe(off);
    // 빈 비교가 아니다: 판이 진행됐다
    expect(off).toContain('"hitsLanded"');
  });
});

describe('판 기록: 괴물 수치', () => {
  it('타격 · 수감 · 사망: 거점 안 타격은 저지로, 자유에서 잡혀 죽으면 사망시킨 수', () => {
    const game = readyGame();
    const d = new Driver(game);
    const rec = new MatchRecorder(game);
    // 거점 B(40,16) 안: 괴물 (38,16) 동쪽, 러너 바로 앞
    place(game, 'p1', 38, 16, 0);
    place(game, 'p2', 39, 16);
    place(game, 'p3', 8, 10);
    place(game, 'p4', 8, 22);
    drive(game, d, rec, d.seconds(4), { p1: [0, 0, { pressed: BTN.ATTACK, aim: 0 }] });
    const runner = game.survivorById('p2')!;
    expect(runner.status).toBe('imprisoned');
    let m = statsOf(rec, game, 'p1');
    expect(m.hits).toBe(2);
    expect(m.jails).toBe(1);
    expect(m.kills).toBe(0);
    expect(m.zoneHits).toBeGreaterThanOrEqual(1);
    // 수감 2회를 채운 생존자가 자유 상태에서 다시 잡히면 사망
    runner.status = 'free';
    runner.hp = 2;
    runner.imprisonCount = 2;
    place(game, 'p2', 39, 16);
    drive(game, d, rec, d.seconds(4), { p1: [0, 0, { pressed: BTN.ATTACK, aim: 0 }] });
    expect(runner.status).toBe('dead');
    m = statsOf(rec, game, 'p1');
    expect(m.kills).toBe(1);
    expect(m.jails).toBe(1);
    const r = statsOf(rec, game, 'p2');
    expect(r.died).toBe(1);
    expect(r.imprisons).toBe(2);
  });

  it('끊긴 점령: 1초 넘게 이어지던 점령이 괴물 8타일 안에서 멈추면 한 번, 거점 지키기 초도 센다', () => {
    const game = readyGame();
    const d = new Driver(game);
    const rec = new MatchRecorder(game);
    const a = CAPTURE_POINTS.A;
    place(game, 'p1', a.x + 7, a.y, Math.PI);
    place(game, 'p2', a.x, a.y);
    place(game, 'p3', 40, 10);
    place(game, 'p4', 40, 22);
    drive(game, d, rec, d.seconds(1.5));
    expect(game.points[0]!.capturing).toBe(true);
    // 괴물이 거점 안으로 (멈춤)
    place(game, 'p1', a.x + 1, a.y, Math.PI);
    drive(game, d, rec, d.seconds(1));
    expect(game.points[0]!.blocked).toBe(true);
    const m = statsOf(rec, game, 'p1');
    expect(m.pointStops).toBe(1);
    expect(m.blockSec).toBeGreaterThan(0.8);
    expect(m.pointsLeft).toBe(2);
    expect(statsOf(rec, game, 'p2').captureSec).toBeGreaterThan(1.4);
  });

  it('포효로 찾기: 발동 순간 반경 10 안 자유 · 수감 생존자 수', () => {
    const game = readyGame();
    const d = new Driver(game);
    const rec = new MatchRecorder(game);
    place(game, 'p1', 30, 18.5, 0);
    place(game, 'p2', 33, 18.5);
    place(game, 'p3', 36, 18.5);
    place(game, 'p4', 8, 16);
    drive(game, d, rec, 1, { p1: [0, 0, { pressed: BTN.ROAR }] });
    drive(game, d, rec, 5);
    expect(statsOf(rec, game, 'p1').roarFinds).toBe(2);
  });

  it('새로 찾기 · 시야에 둔 시간: 3초 넘게 안 보이던 생존자가 들어오면 한 번 (스냅샷 틱만 시야를 받아도 같다)', () => {
    const game = readyGame();
    const d = new Driver(game);
    const rec = new MatchRecorder(game);
    place(game, 'p1', 30, 18.5, 0);
    place(game, 'p2', 33, 18.5);
    place(game, 'p3', 8, 10);
    place(game, 'p4', 8, 22);
    drive(game, d, rec, d.seconds(2), {}, false);
    // 시야 밖으로 4초
    place(game, 'p2', 30, 25);
    drive(game, d, rec, d.seconds(4), {}, false);
    place(game, 'p2', 33, 18.5);
    drive(game, d, rec, d.seconds(1), {}, false);
    const m = statsOf(rec, game, 'p1');
    expect(m.finds).toBe(2);
    expect(m.seeSec).toBeGreaterThan(2.7);
    expect(m.seeSec).toBeLessThan(3.4);
  });
});

describe('판 기록: 생존자 수치', () => {
  it('구조: 감옥 안 둘을 풀면 구조 1 · 풀어 준 동료 2 · 버틴 초 약 3', () => {
    const game = readyGame();
    const d = new Driver(game);
    const rec = new MatchRecorder(game);
    place(game, 'p1', 45, 28, 0);
    for (const id of ['p2', 'p3']) {
      const s = game.survivorById(id)!;
      s.status = 'imprisoned';
      s.hp = 0;
      s.imprisonCount = 1;
    }
    place(game, 'p2', 23.5, 15.5);
    place(game, 'p3', 24.5, 15.5);
    place(game, 'p4', RESCUE_POINT.x, RESCUE_POINT.y);
    drive(game, d, rec, d.seconds(3.2), { p4: [0, 0, { held: BTN.RESCUE }] });
    const s = statsOf(rec, game, 'p4');
    expect(s.rescues).toBe(1);
    expect(s.freed).toBe(2);
    expect(s.rescueSec).toBeGreaterThan(2.8);
    expect(game.survivorById('p2')!.status).toBe('free');
  });

  it('따돌림: 2초 넘게 발각된 채 쫓기다 3초 숨으면 한 번 (맞으면 세지 않는다)', () => {
    const game = readyGame();
    const d = new Driver(game);
    const rec = new MatchRecorder(game);
    place(game, 'p1', 30, 18.5, 0);
    place(game, 'p2', 33, 18.5);
    place(game, 'p3', 8, 10);
    place(game, 'p4', 8, 22);
    drive(game, d, rec, d.seconds(2.5));
    place(game, 'p2', 30, 25);
    drive(game, d, rec, d.seconds(3.5));
    let s = statsOf(rec, game, 'p2');
    expect(s.evades).toBe(1);
    expect(s.chaseSec).toBeGreaterThan(2.3);
    // 맞은 추격은 따돌림이 아니다
    place(game, 'p2', 31, 18.5);
    drive(game, d, rec, d.seconds(2.5), { p1: [0, 0, { pressed: BTN.ATTACK, aim: 0 }] });
    expect(game.survivorById('p2')!.hp).toBeLessThan(2);
    place(game, 'p2', 30, 25);
    drive(game, d, rec, d.seconds(3.5));
    s = statsOf(rec, game, 'p2');
    expect(s.evades).toBe(1);
  });

  it('능력: 가드 기절 성공 · 팀 시야 밖 괴물 탐지는 쓸모 있게, 발각되지 않은 질주는 사용만', () => {
    const game = readyGame();
    const d = new Driver(game);
    const rec = new MatchRecorder(game);
    place(game, 'p1', 30, 18.5, Math.PI);
    place(game, 'p2', 8, 10); // 러너: 멀리
    place(game, 'p3', 31.5, 18.5); // 가드: 괴물 뒤 1.5타일
    place(game, 'p4', 8, 22); // 스카우트: 멀리 (괴물이 팀 시야 밖)
    // 가드는 괴물을 보고 있으므로 스카우트 탐지가 쓸모 있으려면 먼저 가드를 치운다
    drive(game, d, rec, 1, { p3: [0, 0, { pressed: BTN.ABILITY }] });
    place(game, 'p3', 40, 22);
    drive(game, d, rec, 1, { p2: [0, 0, { pressed: BTN.ABILITY }], p4: [0, 0, { pressed: BTN.ABILITY }] });
    drive(game, d, rec, 3);
    const guard = statsOf(rec, game, 'p3');
    const runner = statsOf(rec, game, 'p2');
    const scout = statsOf(rec, game, 'p4');
    expect(guard).toMatchObject({ abilityUses: 1, abilityGood: 1 });
    expect(runner).toMatchObject({ abilityUses: 1, abilityGood: 0 });
    expect(scout).toMatchObject({ abilityUses: 1, abilityGood: 1 });
  });

  it('탈출: 탈출구 열기 기여 초 · 탈출 · 깨끗한 탈출 · 버틴 비율, 괴물의 탈출구 지킨 초와 탈출 못 한 수', () => {
    const game = readyGame();
    const d = new Driver(game);
    const rec = new MatchRecorder(game);
    place(game, 'p1', 45, 28, 0);
    for (const p of game.points) p.done = true;
    for (const e of game.exits) e.state = 'active';
    const n = EXITS.N.center;
    place(game, 'p2', n.x - 0.4, n.y + 0.3);
    place(game, 'p3', n.x + 0.4, n.y + 0.3);
    place(game, 'p4', 8, 22);
    drive(game, d, rec, d.seconds(3.2));
    expect(game.exits[0]!.state).toBe('open');
    // 문 칸으로 걸어 들어간다
    drive(game, d, rec, d.seconds(1.5), { p2: [0, -1], p3: [0, -1] });
    expect(game.survivorById('p2')!.status).toBe('escaped');
    drive(game, d, rec, d.seconds(1));
    const r = statsOf(rec, game, 'p2');
    expect(r.exitSec).toBeGreaterThan(2.8);
    expect(r.escaped).toBe(1);
    expect(r.cleanEscape).toBe(1);
    expect(r.surviveRatio).toBe(1);
    const m = statsOf(rec, game, 'p1');
    expect(m.exitHoldSec).toBeGreaterThan(3);
    expect(m.exitHoldSec).toBeLessThan(5);
    expect(m.kept).toBe(1);
  });
});

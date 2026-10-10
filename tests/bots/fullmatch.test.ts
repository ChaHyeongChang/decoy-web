// 봇 시나리오 "전체 판": 봇 4명으로 생존자 승리 1회, 괴물 승리 1회를 끝까지 (BUILD_PLAN M5)
import { describe, expect, it } from 'vitest';
import type { Snapshot } from '@decoy/shared';
import {
  GoAndHoldBrain,
  HunterBrain,
  PatrolMonsterBrain,
  PhasedBrain,
  SPOTS,
  SimMatch,
  buildResult,
  type BotBrain,
} from '@decoy/shared/sim';
import { loadTestBalance } from '../helpers/fixtures';

const balance = loadTestBalance();
const pointDone =
  (id: 'A' | 'B') =>
  (s: Snapshot): boolean =>
    s.world.points.some((p) => p.id === id && p.state === 'done');
const exitOpen = (s: Snapshot): boolean => s.world.exits.some((e) => e.id === 'N' && e.state === 'open');

/** 거점 A → B → 북문 → 탈출 */
function escaper(offset: number): BotBrain {
  return new PhasedBrain([
    { brain: new GoAndHoldBrain({ x: SPOTS.pointA.x + offset, y: SPOTS.pointA.y }), until: pointDone('A') },
    { brain: new GoAndHoldBrain({ x: SPOTS.pointB.x + offset, y: SPOTS.pointB.y }), until: pointDone('B') },
    { brain: new GoAndHoldBrain({ x: 24 + offset, y: 2.3 }), until: exitOpen },
    { brain: new GoAndHoldBrain(SPOTS.exitNDoor, 0, 0.05) },
  ]);
}

describe('봇 시나리오: 전체 판', () => {
  it('생존자 승리: 두 명이 A · B를 함께 점령하고 북문을 열어 탈출, 세 번째도 최후의 30초 안에 탈출', () => {
    const brains = new Map<string, BotBrain>([
      [
        'p1',
        new PatrolMonsterBrain([
          { x: 44, y: 29 },
          { x: 37, y: 29 },
          { x: 44, y: 25 },
        ]),
      ],
      ['p2', escaper(-0.6)],
      ['p3', escaper(0.6)],
      [
        'p4',
        new PhasedBrain([
          { brain: new GoAndHoldBrain({ x: 30, y: 12 }), until: exitOpen },
          { brain: new GoAndHoldBrain(SPOTS.exitNDoor, 0, 0.05) },
        ]),
      ],
    ]);
    const sim = new SimMatch(SimMatch.roles(), balance, brains, 11);
    sim.runUntil((g) => g.end !== null, 240);
    const g = sim.game;
    expect(g.end?.winner).toBe('survivors');
    const r = buildResult(g);
    expect(r.escaped).toBe(3);
    expect(r.grade).toBe('full');
    expect(r.ending).toBe('END_ALL');
    // 두 거점 모두 2명이 함께 점령 (약 27초씩)
    expect(g.points.every((p) => p.done)).toBe(true);
    expect(g.survivorById('p2')!.stats.captureSeconds).toBeGreaterThan(50);
    // 판 길이 기록
    expect(r.durationSec).toBeGreaterThan(55);
  });

  it('괴물 승리: 사냥 봇이 생존자를 모두 감옥에 넣는다', () => {
    const brains = new Map<string, BotBrain>([
      ['p1', new HunterBrain({ patrol: [{ x: 30, y: 22 }] })],
      ['p2', new GoAndHoldBrain({ x: 38, y: 25 })],
      ['p3', new GoAndHoldBrain({ x: 39, y: 26 })],
      ['p4', new GoAndHoldBrain({ x: 37, y: 26 })],
    ]);
    const sim = new SimMatch(SimMatch.roles(), balance, brains, 12);
    sim.runUntil((g) => g.end !== null, 180);
    const g = sim.game;
    expect(g.end?.winner).toBe('monster');
    expect(['allImprisoned', 'noFreeSurvivors']).toContain(g.end?.reason);
    const r = buildResult(g);
    expect(r.ending).toBe('END_MONSTER');
    expect(r.players.find((p) => p.role === 'monster')!.hitsLanded).toBeGreaterThanOrEqual(6);
  });
});

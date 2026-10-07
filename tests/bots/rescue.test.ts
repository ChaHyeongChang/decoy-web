// 봇 시나리오 "구조": 두 명 수감 → 한 번에 해방 → 보호 중 피격 무효 (BUILD_PLAN M4)
import { describe, expect, it } from 'vitest';
import type { InputFrame, Snapshot } from '@decoy/shared';
import {
  GoAndHoldBrain,
  HunterBrain,
  PhasedBrain,
  SPOTS,
  Walker,
  idleBrain,
  type BotBrain,
} from '../../server/src/botBrains';
import { SimMatch } from '../../server/src/sim';
import { BTN } from '@decoy/shared';
import { loadTestBalance } from '../helpers/fixtures';

const balance = loadTestBalance();

/** 괴물: 지정한 곳으로 가서 지정한 방향을 본다 */
class LookAwayBrain implements BotBrain {
  private readonly walker = new Walker();
  constructor(
    private readonly at: { x: number; y: number },
    private readonly aim: number,
  ) {}
  decide(snap: Snapshot, _i: unknown, _b: unknown, seq: number): InputFrame {
    const w = this.walker.toward(snap, this.at, 0.4);
    return { seq, mx: w.mx, my: w.my, aim: this.aim, held: 0, pressed: 0 };
  }
}

describe('봇 시나리오: 구조', () => {
  it('두 명 수감 → 한 번에 해방 → 보호 중 피격 무효', () => {
    const imprisonedTwo = (s: Snapshot): boolean => s.world.imprisoned >= 2;
    const jailed = (s: Snapshot): boolean => s.you.surv?.status === 'imprisoned';
    const rescued = (_s: Snapshot, ev: readonly { k: string }[]): boolean =>
      ev.some((e) => e.k === 'rescued');
    const brains = new Map<string, BotBrain>([
      [
        'p1',
        new PhasedBrain([
          { brain: new HunterBrain({ patrol: [{ x: 40, y: 26 }] }), until: imprisonedTwo },
          { brain: new LookAwayBrain({ x: 24, y: 26.5 }, Math.PI / 2), until: rescued },
          { brain: new HunterBrain({ attackProtected: true, patrol: [{ x: 24, y: 20 }] }) },
        ]),
      ],
      // 괴물 쪽으로 가서 맞고, 감옥에 들어간 뒤에는 그 자리에 가만히 있는다
      [
        'p2',
        new PhasedBrain([
          { brain: new GoAndHoldBrain({ x: 40, y: 26 }), until: jailed },
          { brain: idleBrain },
        ]),
      ],
      [
        'p3',
        new PhasedBrain([
          { brain: new GoAndHoldBrain({ x: 41, y: 25 }), until: jailed },
          { brain: idleBrain },
        ]),
      ],
      [
        'p4',
        new PhasedBrain([
          { brain: new GoAndHoldBrain({ x: 8, y: 16 }), until: imprisonedTwo },
          { brain: new GoAndHoldBrain(SPOTS.rescue, BTN.RESCUE, 0.2), until: rescued },
          { brain: new GoAndHoldBrain({ x: 8, y: 16 }) },
        ]),
      ],
    ]);
    const sim = new SimMatch(SimMatch.roles(), balance, brains, 7);
    const g = sim.game;
    const runner = g.survivorById('p2')!;
    const guard = g.survivorById('p3')!;
    const scout = g.survivorById('p4')!;

    // 1) 두 명이 함께 감옥에 있는 순간
    expect(
      sim.runUntil((game) => game.survivors.filter((s) => s.status === 'imprisoned').length >= 2, 90),
    ).toBe(true);
    expect(runner.imprisonCount).toBe(1);
    expect(guard.imprisonCount).toBe(1);
    expect(g.end).toBeNull();

    // 2) 구조 한 번에 두 명 모두 풀려난다
    expect(sim.runUntil(() => runner.status === 'free' || guard.status === 'free', 60)).toBe(true);
    expect(runner.status).toBe('free');
    expect(guard.status).toBe('free');
    expect(scout.stats.rescues).toBe(1);
    expect(runner.hp).toBe(2);
    expect(guard.hp).toBe(2);
    expect(runner.protectLeft).toBeGreaterThan(3.9);

    // 3) 보호 4초 동안 괴물이 공격해도 체력이 깎이지 않는다
    const strikesBefore = g.monster.stats.hitsLanded;
    let attacks = 0;
    const protectTicks = Math.floor(balance.survivor.rescueProtection / g.dt) - 2;
    for (let i = 0; i < protectTicks; i += 1) {
      const windup = g.monster.windupLeft;
      sim.step();
      if (windup > 0 && g.monster.windupLeft === 0) attacks += 1;
      expect(runner.hp).toBe(2);
      expect(guard.hp).toBe(2);
    }
    expect(attacks).toBeGreaterThanOrEqual(1);
    expect(g.monster.stats.hitsLanded).toBe(strikesBefore);
  });
});

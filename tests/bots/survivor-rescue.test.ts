// 실전 생존자 봇: 동료와 같은 틱에 구조를 시작했으면 서로 미루지 않고 이어 간다 (플레이테스트 반영 c 통합 조정 — 갈래 tc에서 찾은 버그).
// 예전에는 '동료가 구조 중이면 맡긴다'가 둘 모두에게 참이 되어 함께 놓았다 함께 잡기를 되풀이했고 구조 진행이 매 틱 0으로 돌아갔다.
// 장면은 판에서 받은 스냅샷에 내 자리 · 동료 상태 · 구조 진행만 바꿔 두뇌에 넣는다 (두뇌가 받는 입력 그대로)
import { beforeAll, describe, expect, it } from 'vitest';
import { BTN, POINT_IDS, RESCUE_POINT, type RoleId, type Snapshot, type Vec2 } from '@decoy/shared';
import { PracticeSurvivorBrain, SimMatch, idleBrain, preparePracticeMap } from '@decoy/shared/sim';
import { loadTestBalance, place } from '../helpers/fixtures';

const balance = loadTestBalance();
const SEAT: Readonly<Record<RoleId, string>> = { runner: 'p2', guard: 'p3', scout: 'p4' };

beforeAll(() => {
  preparePracticeMap();
});

describe('생존자 봇: 동료와 함께 구조 중이면 이어 간다', () => {
  for (const role of ['runner', 'guard', 'scout'] as const) {
    it(`${role}: 나와 동료가 모두 구조 구역에서 구조 중(진행 > 0)이고 셋째가 갇혔으면, 동료에게 미루지 않고 구조 버튼을 계속 누른다`, () => {
      const seed = 3;
      const setup = SimMatch.roles();
      const sim = new SimMatch(setup, balance, new Map(setup.map((p) => [p.id, idleBrain])), seed);
      const corners: Vec2[] = [
        { x: 2.5, y: 2.5 },
        { x: 2.5, y: 29.5 },
      ];
      let k = 0;
      for (const r of ['runner', 'guard', 'scout'] as const) {
        if (r === role) continue;
        const c = corners[k] ?? { x: 2.5, y: 2.5 };
        place(sim.game, SEAT[r], c.x, c.y);
        k += 1;
      }
      place(sim.game, 'p1', 45.5, 1.5);
      for (let i = 0; i < 4; i += 1) sim.step();
      const snap = sim.lastSnap.get(SEAT[role]);
      const info = sim.infos.get(SEAT[role]);
      const surv = snap?.you.surv;
      if (!snap || !info || !surv) throw new Error('스냅샷 없음');
      const [mate, jailed] = snap.survivors.filter((s) => s.id !== snap.you.id);
      if (!mate || !jailed) throw new Error('동료 없음');
      const brain = new PracticeSurvivorBrain(role, seed);
      let held = 0;
      let pressedEvery = true;
      for (let t = 1; t <= 10; t += 1) {
        const s: Snapshot = {
          ...snap,
          tick: snap.tick + t,
          events: [],
          marks: [],
          monster: null,
          you: {
            ...snap.you,
            move: { ...snap.you.move, x: RESCUE_POINT.x, y: RESCUE_POINT.y },
            surv: { ...surv, rescue: 0.2 + 0.01 * t },
          },
          survivors: [
            { ...mate, x: RESCUE_POINT.x + 0.3, y: RESCUE_POINT.y, status: 'free', rescue: 0.2 + 0.01 * t },
            { ...jailed, status: 'imprisoned', rescue: 0 },
          ],
          world: {
            ...snap.world,
            countdown: 0,
            imprisoned: 1,
            points: POINT_IDS.map((id) => ({
              id,
              progress: id === 'A' ? 0.3 : 0,
              state: id === 'A' ? 'capturing' : 'idle',
            })),
          },
        };
        const out = brain.decide(s, info, balance, t);
        held |= out.held;
        if ((out.held & BTN.RESCUE) === 0) pressedEvery = false;
        // 구조 구역에 서서 누른다 (거점으로 떠나지 않는다)
        expect(Math.hypot(out.mx, out.my)).toBeLessThan(0.5);
      }
      expect(held & BTN.RESCUE).toBe(BTN.RESCUE);
      expect(pressedEvery).toBe(true);
    });
  }
});

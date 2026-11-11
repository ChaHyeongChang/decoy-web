// 플레이테스트 반영 c 통합 조정 tb (손잡이 B — 생존자 생존 전술): 봇끼리 판 괴물 승률을 생존자 봇만으로 낮춘다
//  - 다음에 잡히면 사망(수감 2번)인 생존자는 괴물이 6.5타일보다 멀어도 8타일 안이면 달아나기 시작한다 (수감 0 · 1번은 그대로)
//  - 조심 단계(수감 횟수 + 부상, 0~2)가 높을수록 트인 가운데 홀보다 벽 · 방 쪽 도주 지점을 고른다 (괴물 시야 끊기)
//  - 둘 다 수감 횟수 · 체력으로만 정한다: 세 역할이 같은 장면에서 같은 결정을 한다 (괴물 화면에 역할 단서가 생기지 않게)
import { beforeAll, describe, expect, it } from 'vitest';
import { CAPTURE_POINTS, type MatchInfo, type RoleId, type Snapshot, type Vec2 } from '@decoy/shared';
import {
  FLEE_SPOTS,
  PracticeSurvivorBrain,
  SimMatch,
  idleBrain,
  preparePracticeMap,
  type BotBrain,
} from '@decoy/shared/sim';
import { opennessOf } from '../../shared/src/sim/practiceMap';
import { cautionLevel } from '../../shared/src/sim/practiceSurvivor';
import { loadTestBalance, place } from '../helpers/fixtures';

const balance = loadTestBalance();
const ROLES: readonly RoleId[] = ['runner', 'guard', 'scout'];
/** SimMatch.roles()의 자리: 괴물 p1, 러너 p2, 가드 p3, 스카우트 p4 */
const SEAT: Readonly<Record<RoleId, string>> = { runner: 'p2', guard: 'p3', scout: 'p4' };

beforeAll(() => {
  preparePracticeMap();
});

/** 한 역할의 스냅샷 · MatchInfo: 나는 me, 괴물은 mon(보이는 거리), 다른 생존자는 멀리. 준 두뇌 말고는 가만히 있다 */
function sceneSnap(role: RoleId, me: Vec2, mon: Vec2): { snap: Snapshot; info: MatchInfo } {
  const setup = SimMatch.roles();
  const brains: Record<string, BotBrain> = {};
  const sim = new SimMatch(setup, balance, new Map(setup.map((p) => [p.id, brains[p.id] ?? idleBrain])), 1);
  const g = sim.game;
  g.monster.move.frozen = 0;
  for (const r of ROLES)
    if (r !== role) place(g, SEAT[r], r === 'guard' ? 5.5 : 4.5, r === 'scout' ? 28.5 : 4.5);
  place(g, SEAT[role], me.x, me.y);
  place(g, 'p1', mon.x, mon.y, Math.atan2(me.y - mon.y, me.x - mon.x));
  for (const s of g.survivors) s.abilityCd = 30;
  // 손으로 바꾼 판 상태가 스냅샷에 담길 때까지 (스냅샷은 20Hz라 틱마다 오지 않는다)
  const before = sim.lastSnap.get('p1');
  for (let i = 0; i < 4 && sim.lastSnap.get('p1') === before; i += 1) sim.step();
  const snap = sim.lastSnap.get(SEAT[role]);
  const info = sim.infos.get(SEAT[role]);
  if (!snap || !info || !snap.monster) throw new Error('장면 스냅샷 없음');
  return { snap, info };
}

/** 스냅샷의 내 수감 횟수 · 체력, 괴물 자리를 바꿔 끼운다 (괴물을 옮기면 발각은 끈다 — 괴물이 나를 보는 중이면 거리와 무관하게 달아난다) */
function withSelf(snap: Snapshot, imprisonCount: number, hp: number, monster?: Vec2): Snapshot {
  const surv = snap.you.surv;
  if (!surv || !snap.monster) throw new Error('생존자 스냅샷이 아님');
  return {
    ...snap,
    monster: monster ? { ...snap.monster, x: monster.x, y: monster.y } : snap.monster,
    you: { ...snap.you, surv: { ...surv, imprisonCount, hp, spotted: monster ? false : surv.spotted } },
  };
}

function opennessAt(s: Vec2): number {
  const k = FLEE_SPOTS.findIndex((q) => Math.abs(q.x - s.x) < 1e-6 && Math.abs(q.y - s.y) < 1e-6);
  if (k < 0) throw new Error(`도주 후보가 아님 (${s.x}, ${s.y})`);
  return opennessOf(k);
}

describe('생존자 봇 (tb): 마지막 목숨은 일찍 달아난다', () => {
  // 넓은 남쪽 홀 (괴물까지 바닥, 벽 · 기둥 없음). 괴물은 6타일 시야 밖이라 손으로 스냅샷에 넣는다 (팀 시야 · 탐지로 보인 경우)
  const ME = { x: 30.5, y: 24.5 };

  it('수감 2번(다음이 사망)이면 괴물이 7.2타일에 보여도 달아나고, 수감 0 · 1번은 하던 일을 한다 — 세 역할 모두 같다', () => {
    for (const role of ROLES) {
      const { snap, info } = sceneSnap(role, ME, { x: ME.x + 4.5, y: ME.y });
      for (const ic of [0, 1, 2]) {
        const brain = new PracticeSurvivorBrain(role, 7);
        brain.decide(
          withSelf(snap, ic, balance.survivor.maxHp, { x: ME.x + 7.2, y: ME.y }),
          info,
          balance,
          1,
        );
        expect(brain.debugState()?.fleeing, `${role} 수감 ${ic}번`).toBe(
          ic >= balance.survivor.maxImprisonments,
        );
      }
    }
  });

  it('수감 2번이어도 8타일 밖(8.4타일)이면 하던 일을 한다 · 6.2타일이면 수감 횟수와 무관하게 달아난다', () => {
    for (const role of ROLES) {
      const { snap, info } = sceneSnap(role, ME, { x: ME.x + 4.5, y: ME.y });
      const far = new PracticeSurvivorBrain(role, 7);
      far.decide(withSelf(snap, 2, balance.survivor.maxHp, { x: ME.x + 8.4, y: ME.y }), info, balance, 1);
      expect(far.debugState()?.fleeing, role).toBe(false);
      for (const ic of [0, 1, 2]) {
        const near = new PracticeSurvivorBrain(role, 7);
        near.decide(withSelf(snap, ic, balance.survivor.maxHp, { x: ME.x + 6.2, y: ME.y }), info, balance, 1);
        expect(near.debugState()?.fleeing, `${role} 수감 ${ic}번`).toBe(true);
      }
    }
  });
});

describe('생존자 봇 (tb): 잡혀 본 · 다친 생존자는 트인 곳보다 벽 · 방 쪽으로 달아난다', () => {
  it('조심 단계 = 수감 횟수 + 부상 (0~2)', () => {
    const full = balance.survivor.maxHp;
    expect(cautionLevel(0, full, balance)).toBe(0);
    expect(cautionLevel(1, full, balance)).toBe(1);
    expect(cautionLevel(0, full - 1, balance)).toBe(1);
    expect(cautionLevel(2, full, balance)).toBe(2);
    expect(cautionLevel(1, full - 1, balance)).toBe(2);
    expect(cautionLevel(2, full - 1, balance)).toBe(2);
  });

  it('거점 A에서 남쪽 4.5타일 괴물을 피할 때: 조심 단계가 높을수록 덜 트인 도주 지점 (0단계는 가운데 홀), 세 역할이 같은 곳', () => {
    const me = CAPTURE_POINTS.A;
    const mon = { x: me.x, y: me.y + 4.5 };
    // [수감 횟수, 체력] → 조심 단계 0 · 1 · 1 · 2 · 2
    const full = balance.survivor.maxHp;
    const cases: readonly (readonly [number, number])[] = [
      [0, full],
      [1, full],
      [0, full - 1],
      [2, full],
      [1, full - 1],
    ];
    const spots: Vec2[][] = cases.map(() => []);
    for (const role of ROLES) {
      const { snap, info } = sceneSnap(role, me, mon);
      cases.forEach(([ic, hp], i) => {
        const brain = new PracticeSurvivorBrain(role, 3);
        brain.decide(withSelf(snap, ic, hp), info, balance, 1);
        const d = brain.debugState();
        expect(d?.fleeing, `${role} 수감 ${ic} 체력 ${hp}`).toBe(true);
        const s = d?.fleeSpot;
        if (!s) throw new Error('도주 지점 없음');
        spots[i]?.push(s);
      });
    }
    // 역할과 무관: 같은 (수감 횟수, 체력)이면 세 역할이 같은 곳
    for (const list of spots) for (const s of list) expect(s).toEqual(list[0]);
    const open = spots.map((list) => opennessAt(list[0] as Vec2));
    // 0단계: 가운데 홀 (열린 정도 18). 1단계(수감 1번 · 부상)끼리 같은 곳, 2단계끼리 같은 곳, 단계가 오를수록 더 트인 곳으로 가지 않고
    // 2단계는 0단계보다 덜 트인 곳. (1단계 가중치 0.5는 이 장면에서 가운데 홀과 같은 곳을 고른다 — 통합 조정에서 0.45 → 0.5)
    expect(open[0]).toBe(18);
    expect(spots[1]?.[0]).toEqual(spots[2]?.[0]);
    expect(spots[3]?.[0]).toEqual(spots[4]?.[0]);
    expect(open[1]).toBeLessThanOrEqual(open[0] as number);
    expect(open[3]).toBeLessThanOrEqual(open[1] as number);
    expect(open[3]).toBeLessThan(open[0] as number);
  });
});

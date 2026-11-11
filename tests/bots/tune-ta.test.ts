// 실전 괴물 봇의 손 (플레이테스트 반영 c 조정 A): 전술은 그대로 두고 공격을 겨누고 누르고 준비 동안 따라가는 손에 사람다운 한계.
//  - 알아채기 지연: 판마다 0.05~0.15초 전에 본 표적 모습을 이어 짐작한다 → 준비 중 옆걸음을 곧바로 따라가지 못한다
//  - 조준 오차: 공격마다 ±0.08라디안
//  - 이르게 누르기: 공격마다 12%는 닿는 거리를 0.15~0.4타일 길게 본다
// 셋 다 예전 코드(1344a36)에서는 실패한다 (예전 괴물은 1~2틱 만에 옆걸음을 따라가고, 표적 쪽을 정확히 겨누고, 1.8타일 안에서만 눌렀다).
// 두뇌는 자기 스냅샷만 받는다 — 시험이 만든 스냅샷도 괴물 화면 모양 그대로(임시 ID · 역할 없음)다
import { describe, expect, it } from 'vitest';
import { BTN, type InputFrame, type MatchInfo, type Snapshot, type SurvivorView } from '@decoy/shared';
import { PracticeMonsterBrain, SimMatch, idleBrain, preparePracticeMap } from '@decoy/shared/sim';
import { loadTestBalance, place } from '../helpers/fixtures';

const balance = loadTestBalance();
const HZ = balance.network.serverTickHz;
/** practiceMonster.ts의 손 상수 (조정 A) */
const HAND_LAG_MIN = 0.05;
const HAND_LAG_MAX = 0.15;
const HAND_AIM_ERROR = 0.08;
const HAND_EARLY_MAX = 0.4;
/** 보통 공격 조건: 지금 거리가 사거리 + 생존자 반지름 - 여유(0.25) + 지금 거리 여유(0.55) 안 */
const NORMAL_PRESS_MAX = balance.monster.attack.range + balance.survivor.radius - 0.25 + 0.55;

/** 괴물 스냅샷 바탕: 시작 대기 없는 판에서 생존자 셋을 멀리 둔다 */
function baseSnap(): { snap: Snapshot; info: MatchInfo } {
  const setup = SimMatch.roles();
  const sim = new SimMatch(setup, balance, new Map(setup.map((p) => [p.id, idleBrain])), 1);
  sim.game.monster.move.frozen = 0;
  place(sim.game, 'p2', 2.5, 29.5);
  place(sim.game, 'p3', 3.5, 29.5);
  place(sim.game, 'p4', 2.5, 28.5);
  for (let i = 0; i < 4; i += 1) sim.step();
  const snap = sim.lastSnap.get('p1');
  const info = sim.infos.get('p1');
  if (!snap || !info || !snap.you.mon) throw new Error('스냅샷 없음');
  return { snap, info };
}

function seen(id: string, x: number, y: number): SurvivorView {
  return {
    id,
    x,
    y,
    face: 0,
    role: null,
    status: 'free',
    protected: false,
    hp: null,
    imprisonCount: null,
    abilityCd: null,
    rescue: null,
    spotted: null,
    connected: null,
  };
}

interface Frame {
  tick: number;
  me: { x: number; y: number; face: number };
  target: { x: number; y: number };
  /** 남은 공격 준비 (초, 0이면 준비 중 아님) */
  windup?: number;
  attackCd?: number;
  dashCd?: number;
}

function synth(base: Snapshot, f: Frame): Snapshot {
  const mon = base.you.mon;
  if (!mon) throw new Error('괴물 아님');
  return {
    ...base,
    tick: f.tick,
    you: {
      ...base.you,
      move: { ...base.you.move, x: f.me.x, y: f.me.y, face: f.me.face, dash: 0, stun: 0, frozen: 0 },
      mon: {
        ...mon,
        attackCd: f.attackCd ?? 0,
        dashCd: f.dashCd ?? 0,
        windup: f.windup ?? 0,
        roarCd: 0,
        mode: 'search',
        camp: 0,
      },
    },
    survivors: [seen('s', f.target.x, f.target.y)],
    events: [],
    world: { ...base.world, countdown: 0, monsterWait: 0, imprisoned: 0 },
  };
}

function brainFor(seed: number): PracticeMonsterBrain {
  preparePracticeMap();
  return new PracticeMonsterBrain(seed);
}

const pressed = (o: InputFrame, btn: number): boolean => (o.pressed & btn) !== 0;
const angleDiff = (a: number, b: number): number => Math.atan2(Math.sin(a - b), Math.cos(a - b));

describe('실전 괴물 봇의 손 (조정 A)', () => {
  // B 방 남쪽의 트인 곳 (x 35~46, y 17~22 바닥)
  const Y = 19.5;

  it('공격 준비 중 표적이 옆으로 비키면 곧바로 따라가지 못하고 판마다 다른 알아채기 지연(0.05~0.15초) 뒤에 따라간다', () => {
    const { snap: base, info } = baseSnap();
    const v = 4.5 / HZ;
    const turnTicks: number[] = [];
    for (let seed = 1; seed <= 12; seed += 1) {
      const brain = brainFor(seed);
      // 1) 표적이 +x로 달아나고 괴물은 1타일 뒤에서 같이 간다 (모습 기록이 쌓이게, 공격 쿨이 돌아 누르지는 않는다)
      let tx = 37;
      const lead = 20;
      for (let k = 0; k < lead; k += 1) {
        tx += v;
        brain.decide(
          synth(base, {
            tick: 100 + k,
            me: { x: tx - 1, y: Y, face: 0 },
            target: { x: tx, y: Y },
            attackCd: 1,
          }),
          info,
          balance,
          100 + k,
        );
      }
      // 2) 괴물이 공격을 준비하는 동안(조준 고정) 표적이 +y로 비킨다: 괴물이 +y 쪽으로 틀기 시작하는 틱
      let ty = Y;
      let mx = tx - 1;
      let turnAt = -1;
      for (let k = 0; k < 12 && turnAt < 0; k += 1) {
        ty += v;
        mx += v;
        const o = brain.decide(
          synth(base, {
            tick: 100 + lead + k,
            me: { x: mx, y: Y, face: 0 },
            target: { x: tx, y: ty },
            windup: Math.max(0.01, 0.4 - k / HZ),
            attackCd: 0,
          }),
          info,
          balance,
          100 + lead + k,
        );
        const sp = Math.hypot(o.mx, o.my);
        if (sp > 0 && o.my / sp > 0.2) turnAt = k;
      }
      expect(turnAt, `seed ${seed}: 비킨 첫 틱에 곧바로 따라간다`).toBeGreaterThan(0);
      // 알아채기 지연 최대(0.15초 = 4.5틱) + 스냅샷 · 속도 짐작 몇 틱 안에는 따라간다 (얼어붙지 않는다)
      expect(turnAt, `seed ${seed}`).toBeLessThanOrEqual(Math.ceil(HAND_LAG_MAX * HZ) + 3);
      expect(turnAt, `seed ${seed}`).toBeGreaterThanOrEqual(Math.floor(HAND_LAG_MIN * HZ));
      turnTicks.push(turnAt);
    }
    // 판(시드)마다 실력이 다르다: 따라가기 시작하는 틱이 한 가지가 아니다
    expect(new Set(turnTicks).size, turnTicks.join(',')).toBeGreaterThanOrEqual(3);
  });

  it('공격마다 조준이 표적 쪽에서 조금씩(±0.08라디안 안) 비껴 나간다 (예전 흐름 · 새 행동 흐름의 뽑기 순서는 그대로)', () => {
    const { snap: base, info } = baseSnap();
    /** 두뇌 안 난수 흐름의 다음 값 (시험만) */
    const peek = (b: PracticeMonsterBrain, key: 'rng' | 'tactics'): number =>
      (b as unknown as Record<string, { next(): number }>)[key]?.next() ?? NaN;
    const errors: number[] = [];
    for (let seed = 1; seed <= 12; seed += 1) {
      const brain = brainFor(seed);
      const target = { x: 41.5, y: 18.5 };
      // 서 있는 표적에게 다가가 세 번 친다 (돌진 쿨이 돌아 돌진하지 않는다). 칠 때마다 처음 자리로 돌아가 공격 쿨 1.5초 동안 기다린다
      const start = { x: 37.5, y: Y };
      const me = { ...start, face: 0 };
      let cdUntil = -1;
      let tick = 100;
      for (let hits = 0; hits < 3 && tick < 400; tick += 1) {
        const attackCd = Math.max(0, (cdUntil - tick) / HZ);
        const o = brain.decide(synth(base, { tick, me, target, attackCd, dashCd: 12 }), info, balance, tick);
        if (pressed(o, BTN.ATTACK)) {
          const exact = Math.atan2(target.y - me.y, target.x - me.x);
          errors.push(angleDiff(me.face, exact));
          cdUntil = tick + 1.5 * HZ;
          hits += 1;
          me.x = start.x;
          me.y = start.y;
          continue;
        }
        me.face = o.aim;
        if (attackCd > 0) continue;
        const sp = Math.hypot(o.mx, o.my);
        const step = sp > 0 ? (balance.monster.moveSpeed / HZ) * Math.min(1, sp) : 0;
        if (sp > 0) {
          me.x += (o.mx / sp) * step;
          me.y += (o.my / sp) * step;
        }
      }
      // 손 오차를 뽑아도 예전 흐름(this.rng) · 새 행동 흐름(tactics)은 손대지 않은 두뇌와 같은 값을 낸다
      const fresh = brainFor(seed);
      expect(peek(brain, 'rng')).toBe(peek(fresh, 'rng'));
      expect(peek(brain, 'tactics')).toBe(peek(fresh, 'tactics'));
    }
    expect(errors.length).toBeGreaterThanOrEqual(30);
    for (const e of errors) expect(Math.abs(e)).toBeLessThanOrEqual(HAND_AIM_ERROR + 1e-9);
    // 정확히 겨눈 것(오차 0.01라디안 이하)은 드물고, 양쪽으로 다 비껴 나간다
    expect(errors.filter((e) => Math.abs(e) > 0.01).length).toBeGreaterThanOrEqual(errors.length * 0.7);
    expect(errors.some((e) => e > 0.03)).toBe(true);
    expect(errors.some((e) => e < -0.03)).toBe(true);
  });

  it('가끔(공격마다 12%) 닿는 거리를 길게 보고 이르게 누른다: 보통은 1.8타일 안에서, 이르면 2.2타일까지', () => {
    const { snap: base, info } = baseSnap();
    const at: number[] = [];
    for (let seed = 1; seed <= 60; seed += 1) {
      const brain = brainFor(seed);
      const target = { x: 42, y: Y };
      const me = { x: 38, y: Y, face: 0 };
      for (let k = 0; k < 60; k += 1) {
        const o = brain.decide(
          synth(base, { tick: 100 + k, me, target, dashCd: 12 }),
          info,
          balance,
          100 + k,
        );
        if (pressed(o, BTN.ATTACK)) {
          at.push(Math.hypot(target.x - me.x, target.y - me.y));
          break;
        }
        const sp = Math.hypot(o.mx, o.my);
        if (sp > 0) {
          const step = (balance.monster.moveSpeed / HZ) * Math.min(1, sp);
          me.x += (o.mx / sp) * step;
          me.y += (o.my / sp) * step;
        }
        me.face = o.aim;
      }
    }
    expect(at.length).toBe(60);
    const early = at.filter((d) => d > NORMAL_PRESS_MAX + 0.02);
    expect(early.length, at.map((d) => d.toFixed(2)).join(' ')).toBeGreaterThanOrEqual(3);
    expect(early.length).toBeLessThanOrEqual(15);
    for (const d of at) expect(d).toBeLessThanOrEqual(NORMAL_PRESS_MAX + HAND_EARLY_MAX + 1e-6);
  });
});

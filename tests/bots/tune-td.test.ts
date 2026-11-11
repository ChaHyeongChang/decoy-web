// 실전 괴물 봇 통합 조정 d — 감옥 지키기 강도 (practiceMonster.ts): 봇끼리 판 괴물 승률이 사람 괴물보다 높아서 감옥 감시의 빈틈을 사람답게.
//  - 한 명을 가둔 직후 감옥 감시는 반반 (WATCH_AFTER_JAIL_PROB 0.85 → 0.5). 감시로 안 가면 감옥을 비우고,
//    감시 간격(WATCH_GAP_MIN 20초)만큼 '가끔 감시'도 미룬다 — 예전에는 주사위가 실패해도 다음 틱의 '가끔 감시'가 곧바로 감시로 보냈다
//  - 둘이 갇히면(한 명만 더 잡으면 이긴다) 그대로 거의 늘 감시 (0.85)
//  - 둘 이상 갇혀 있을 때 감시 자리 넷을 오가는 감시는 감시 간격마다만 (예전: 할 일이 없을 때마다 되풀이 — 감옥을 떠나지 않았다)
// 합성 스냅샷(괴물 화면 모양: 임시 ID · 역할 없음)으로 두뇌 하나를 돌린다. 괴물 자리는 두뇌 입력대로 옮긴다 (monster-brain.test.ts 와 같은 방법)
import { describe, expect, it } from 'vitest';
import {
  RESCUE_POINT,
  type GameEvent,
  type InputFrame,
  type MatchInfo,
  type Snapshot,
  type Vec2,
} from '@decoy/shared';
import {
  PracticeMonsterBrain,
  SimMatch,
  WATCH_SPOTS,
  idleBrain,
  preparePracticeMap,
} from '@decoy/shared/sim';
import { loadTestBalance, place } from '../helpers/fixtures';

const balance = loadTestBalance();
const HZ = balance.network.serverTickHz;
/** 감시 간격 최소 (practiceMonster.ts WATCH_GAP_MIN, 초) */
const WATCH_GAP_MIN = 20;
const jailedEvent: GameEvent = { k: 'imprisoned', you: false };

/** 합성 스냅샷의 바탕: 시작 대기 없는 괴물 스냅샷 (생존자 셋은 멀리, 안 보인다) */
function baseSnap(): { snap: Snapshot; info: MatchInfo } {
  const setup = SimMatch.roles();
  const sim = new SimMatch(setup, balance, new Map(setup.map((p) => [p.id, idleBrain])), 1);
  sim.game.monster.move.frozen = 0;
  place(sim.game, 'p2', 2.5, 29.5);
  place(sim.game, 'p3', 3.5, 29.5);
  place(sim.game, 'p4', 2.5, 28.5);
  const before = sim.lastSnap.get('p1');
  for (let i = 0; i < 4 && sim.lastSnap.get('p1') === before; i += 1) sim.step();
  const snap = sim.lastSnap.get('p1');
  const info = sim.infos.get('p1');
  if (!snap || !info || !snap.you.mon) throw new Error('스냅샷 없음');
  return { snap, info };
}

/** 바탕 스냅샷에 괴물 자리 · 갇힌 수 · 이벤트만 바꾼 괴물 스냅샷 (아무도 안 보인다) */
function synth(
  base: Snapshot,
  tick: number,
  me: Vec2 & { face: number },
  imprisoned: number,
  events: GameEvent[],
): Snapshot {
  const mon = base.you.mon;
  if (!mon) throw new Error('괴물 아님');
  return {
    ...base,
    tick,
    you: {
      ...base.you,
      move: { ...base.you.move, x: me.x, y: me.y, face: me.face, dash: 0, stun: 0, frozen: 0 },
      mon: { ...mon, attackCd: 0, dashCd: 0, windup: 0, roarCd: 0, mode: 'hunt', camp: 0 },
    },
    survivors: [],
    events,
    world: { ...base.world, countdown: 0, monsterWait: 0, imprisoned },
  };
}

interface Tick {
  /** 판 틱 */
  tick: number;
  at: Vec2;
  act: string;
}

/** 두뇌를 ticks틱 돌린다: frame(k)가 갇힌 수 · 이벤트를 준다. 괴물 자리는 입력대로 옮긴다 (벽 충돌 없이 — 두뇌가 길찾기로 간다) */
function drive(
  brain: PracticeMonsterBrain,
  base: Snapshot,
  info: MatchInfo,
  me: Vec2 & { face: number },
  from: number,
  ticks: number,
  frame: (k: number) => { imprisoned: number; events?: GameEvent[] },
): Tick[] {
  const log: Tick[] = [];
  for (let k = 0; k < ticks; k += 1) {
    const f = frame(k);
    const out: InputFrame = brain.decide(
      synth(base, from + k, me, f.imprisoned, f.events ?? []),
      info,
      balance,
      from + k,
    );
    const sp = Math.hypot(out.mx, out.my);
    const scale = (sp > 1 ? 1 / sp : 1) * (balance.monster.moveSpeed / HZ);
    me.x += out.mx * scale;
    me.y += out.my * scale;
    me.face = out.aim;
    log.push({ tick: from + k, at: { x: me.x, y: me.y }, act: brain.act });
  }
  return log;
}

const watching = (act: string): boolean => act === 'go:watch' || act === 'look:watch';
const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

function monsterBrain(seed: number): PracticeMonsterBrain {
  preparePracticeMap();
  return new PracticeMonsterBrain(seed);
}

/**
 * 거점 A 쪽 복도에서 한 명을 가둔 장면: 2초 돌린 뒤(아무도 안 갇힘) 가둔 이벤트, 그 뒤 seconds초 동안 갇힌 수 jailed.
 * 가둔 틱부터의 기록을 돌려준다
 */
function afterJail(seed: number, jailed: number, seconds: number): Tick[] {
  const { snap: base, info } = baseSnap();
  const brain = monsterBrain(seed);
  const me = { x: 13.5, y: 16.5, face: 0 };
  const warm = 2 * HZ;
  drive(brain, base, info, me, 100, warm, () => ({ imprisoned: jailed - 1 }));
  return drive(brain, base, info, me, 100 + warm, seconds * HZ, (k) => ({
    imprisoned: jailed,
    events: k === 0 ? [jailedEvent] : [],
  }));
}

describe('실전 괴물 봇 통합 조정 d: 감옥 지키기 강도', () => {
  const SEEDS = Array.from({ length: 60 }, (_, i) => i + 1);

  it('한 명을 가둔 직후 감옥 감시로 가는 것은 반반쯤이다 (예전: 주사위가 실패해도 곧바로 감시로 — 거의 늘)', () => {
    let watched = 0;
    for (const seed of SEEDS) {
      const log = afterJail(seed, 1, 8);
      if (log.some((t) => watching(t.act))) watched += 1;
    }
    const share = watched / SEEDS.length;
    expect(share, `감시로 간 판 ${watched}/${SEEDS.length}`).toBeGreaterThan(0.3);
    expect(share, `감시로 간 판 ${watched}/${SEEDS.length}`).toBeLessThan(0.7);
  });

  it('가둔 직후 감시로 안 갔으면 감시 간격(20초) 동안 감옥 감시로 돌아오지 않고 감옥을 비운다. 간격이 지나도 갇혀 있으면 다시 감시', () => {
    let left = 0;
    for (const seed of SEEDS) {
      const log = afterJail(seed, 1, WATCH_GAP_MIN + 15);
      const first = log.findIndex((t) => watching(t.act));
      if (first >= 0 && first < 8 * HZ) continue; // 곧장 감시로 간 판 (위 시험)
      left += 1;
      expect(first, `seed ${seed}: 감시 간격 전에 감시로 돌아왔다`).toBeGreaterThanOrEqual(
        (WATCH_GAP_MIN - 0.5) * HZ,
      );
      const away = Math.max(...log.slice(0, WATCH_GAP_MIN * HZ).map((t) => dist(t.at, RESCUE_POINT)));
      expect(away, `seed ${seed}: 감옥을 비우고 멀리 간다`).toBeGreaterThan(10);
      expect(first, `seed ${seed}: 간격이 지나도 갇혀 있으면 다시 감시한다`).toBeGreaterThan(0);
    }
    // 예전 코드는 이런 판이 없다 (주사위가 실패해도 다음 틱의 '가끔 감시'가 곧바로 감시로 보냈다)
    expect(left, '감시로 안 간 판').toBeGreaterThanOrEqual(SEEDS.length * 0.3);
  });

  it('둘째를 가두면(한 명만 더 잡으면 이긴다) 그대로 거의 늘 감옥 감시로 간다', () => {
    let watched = 0;
    for (const seed of SEEDS) {
      const log = afterJail(seed, 2, 8);
      if (log.some((t) => watching(t.act))) watched += 1;
    }
    expect(watched / SEEDS.length, `감시로 간 판 ${watched}/${SEEDS.length}`).toBeGreaterThan(0.75);
  });

  it('둘 이상 갇혀 있을 때 감시 자리 넷을 오가는 감시는 감시 간격마다만: 한 번 마치면 감옥을 떠나 다른 할 일로 가고, 간격이 지나면 다시 감시', () => {
    const { snap: base, info } = baseSnap();
    for (const seed of [1, 2, 3, 4, 5]) {
      const brain = monsterBrain(seed);
      const me = { x: 24, y: 26.5, face: 0 };
      const log = drive(brain, base, info, me, 100, 45 * HZ, () => ({ imprisoned: 2 }));
      expect(watching(log[0]?.act ?? ''), `seed ${seed}: 처음에는 감시`).toBe(true);
      // 첫 감시가 끝난 틱 · 다음 감시가 시작된 틱
      const end = log.findIndex((t) => !watching(t.act));
      expect(
        end,
        `seed ${seed}: 감시를 마치고 다른 할 일로 간다 (예전: 감시를 되풀이해 떠나지 않았다)`,
      ).toBeGreaterThan(0);
      const seenSpots = new Set<number>();
      for (const t of log.slice(0, end))
        WATCH_SPOTS.forEach((w, i) => {
          if (dist(t.at, w) <= 0.6) seenSpots.add(i);
        });
      expect(seenSpots.size, `seed ${seed}: 감시 한 번에 감시 자리 셋을 모두`).toBe(WATCH_SPOTS.length);
      const again = log.findIndex((t, i) => i > end && watching(t.act));
      expect(again, `seed ${seed}: 간격이 지나면 다시 감시`).toBeGreaterThan(end);
      expect(again, `seed ${seed}: 다음 감시는 감시 간격 뒤`).toBeGreaterThanOrEqual(WATCH_GAP_MIN * HZ);
      const away = Math.max(...log.slice(end, again).map((t) => dist(t.at, RESCUE_POINT)));
      expect(away, `seed ${seed}: 그 사이 감옥 둘레를 떠난다`).toBeGreaterThan(9);
    }
  });
});

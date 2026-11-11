// 아슬아슬 회피 판단 (플레이테스트 반영 c 손맛, docs/playtest/c-juice.md 5.4절): 생존자 화면이 자기 스냅샷만으로 판단한다.
// 괴물 (30, 21) 정면(동쪽) 기준 — 사거리 1.2 · 몸 반지름 0.3이라 중심 거리 1.5까지 맞는 경계, 1.5 초과 ~ 1.5 + δ(0.3) 띠, 그 밖은 거짓.
// 판정 부채꼴 안인데 안 맞은 경우도 참, 벽 · 철창 사이 · 수감 · 사망 · 보호 중 · hit{you:true} · 괴물 역할은 거짓
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateBalance } from '../../shared/src/balance';
import { segmentBlocked } from '../../shared/src/geometry';
import { blocksStrike } from '../../shared/src/map';
import type { GameEvent } from '../../shared/src/types';
import { NEAR_MISS, labelSlot, nearMissStrike, type NearMissInput } from '../../client/src/nearMiss';

const balance = validateBalance(JSON.parse(readFileSync('config/balance.json', 'utf8')));
const ATK = balance.monster.attack;
const R = balance.survivor.radius;
const MON = { x: 30, y: 21 };
const strike = (hits = 0, at = MON, dir = 0): GameEvent => ({ k: 'attackHit', x: at.x, y: at.y, dir, hits });

/** 괴물 정면(dir 0)에서 중심 거리 d · 각도 deg인 자리의 판단 */
function input(over: Partial<NearMissInput> = {}): NearMissInput {
  return {
    role: 'runner',
    status: 'free',
    protectLeft: 0,
    me: { x: MON.x + 1.7, y: MON.y },
    events: [strike()],
    range: ATK.range,
    arcDeg: ATK.arc,
    bodyR: R,
    ...over,
  };
}
const at = (d: number, deg = 0): { x: number; y: number } => ({
  x: MON.x + d * Math.cos((deg * Math.PI) / 180),
  y: MON.y + d * Math.sin((deg * Math.PI) / 180),
});

describe('아슬아슬 회피 판단 (nearMiss.ts)', () => {
  it('시험 자리 전제: 괴물 (30, 21) 동쪽 2.2타일까지 타격선이 막히지 않는다', () => {
    for (const d of [0.5, 1, 1.5, 1.7, 1.8, 2.2])
      expect(segmentBlocked(MON, at(d), blocksStrike)).toBe(false);
    expect(ATK.range + R).toBeCloseTo(1.5, 9);
    expect(NEAR_MISS.delta).toBe(0.3);
  });

  it('정면 거리 띠: 1.5(맞는 경계) 초과 ~ 1.5 + δ는 참, 그 밖은 거짓 — 부채꼴 안인데 안 맞은 것도 참', () => {
    const edge = ATK.range + R;
    expect(nearMissStrike(input({ me: at(edge + 0.01) }))).not.toBeNull();
    expect(nearMissStrike(input({ me: at(1.7) }))).not.toBeNull();
    expect(nearMissStrike(input({ me: at(edge + NEAR_MISS.delta - 0.01) }))).not.toBeNull();
    expect(nearMissStrike(input({ me: at(edge + NEAR_MISS.delta + 0.01) }))).toBeNull();
    expect(nearMissStrike(input({ me: at(2.2) }))).toBeNull();
    // 판정 부채꼴 안인데 hits 0 (타격 직후 한 틱 사이에 들어온 가장 가까운 회피)
    expect(nearMissStrike(input({ me: at(1.0) }))).not.toBeNull();
    expect(nearMissStrike(input({ me: at(edge) }))).not.toBeNull();
  });

  it('옆 각도 경계: 거리 1에서 부채꼴 변(45°)과의 거리가 몸 반지름 + δ 안이면 참', () => {
    // 거리 1 · 각도 θ의 점과 45° 변 사이 거리 = sin(θ − 45°) → 0.6 이하면 겹침 (θ ≤ 45° + asin 0.6 ≈ 81.9°)
    const limit = 45 + (Math.asin(R + NEAR_MISS.delta) * 180) / Math.PI;
    for (const sign of [1, -1]) {
      expect(nearMissStrike(input({ me: at(1, sign * (limit - 1)) }))).not.toBeNull();
      expect(nearMissStrike(input({ me: at(1, sign * (limit + 1)) }))).toBeNull();
    }
    // 등 뒤는 가까워도 거짓
    expect(nearMissStrike(input({ me: at(0.9, 180) }))).toBeNull();
  });

  it('벽 · 철창이 타격선을 막으면 거짓 (같은 거리 · 각도라도)', () => {
    // (33, 19~23)은 벽 기둥: 그 서쪽에서 동쪽으로 친 타격과 벽 너머 1.7타일
    const from = { x: 32.4, y: 21.5 };
    const behind = { x: from.x + 1.7, y: from.y };
    expect(segmentBlocked(from, behind, blocksStrike)).toBe(true);
    expect(nearMissStrike(input({ me: behind, events: [strike(0, from)] }))).toBeNull();
    // 같은 기하가 열린 곳에서는 참 (벽 말고는 같은 조건)
    expect(nearMissStrike(input({ me: at(1.7), events: [strike(0)] }))).not.toBeNull();
  });

  it('내 상태 · 보호 · 내 피격 · 역할: 수감 · 사망 · 탈출 · 보호 중 · hit{you:true} · 괴물이면 거짓', () => {
    expect(nearMissStrike(input({ status: 'imprisoned' }))).toBeNull();
    expect(nearMissStrike(input({ status: 'dead' }))).toBeNull();
    expect(nearMissStrike(input({ status: 'escaped' }))).toBeNull();
    expect(nearMissStrike(input({ status: null }))).toBeNull();
    expect(nearMissStrike(input({ protectLeft: 0.5 }))).toBeNull();
    const hitMe: GameEvent = { k: 'hit', you: true, x: 31.7, y: 21 };
    const hitMate: GameEvent = { k: 'hit', you: false, x: 31, y: 21 };
    expect(nearMissStrike(input({ events: [hitMe, strike(1)] }))).toBeNull();
    expect(nearMissStrike(input({ events: [strike(1), hitMe] }))).toBeNull();
    // 동료가 맞은 타격을 내가 아슬아슬하게 비껴간 것은 참
    expect(nearMissStrike(input({ events: [hitMate, strike(1)] }))).not.toBeNull();
    // 타격이 없으면 거짓
    expect(nearMissStrike(input({ events: [hitMate] }))).toBeNull();
  });

  it('괴물 역할이면 어떤 자리 · 이벤트에서도 늘 거짓 (괴물 화면에는 어떤 형태로도 알리지 않는다)', () => {
    for (const d of [0.5, 1, 1.5, 1.7, 1.8])
      for (const deg of [-60, 0, 60])
        expect(nearMissStrike(input({ role: 'monster', me: at(d, deg), events: [strike(0)] }))).toBeNull();
  });

  it('balance 사거리 · 각도 · 몸 반지름을 바꾸면 띠도 따라간다', () => {
    expect(nearMissStrike(input({ me: at(2.05) }))).toBeNull();
    expect(nearMissStrike(input({ me: at(2.05), range: 1.5 }))).not.toBeNull();
    expect(nearMissStrike(input({ me: at(1.85), bodyR: 0.4 }))).not.toBeNull();
    expect(nearMissStrike(input({ me: at(1, 100) }))).toBeNull();
    expect(nearMissStrike(input({ me: at(1, 100), arcDeg: 150 }))).not.toBeNull();
  });

  it('돌려주는 것은 같은 스냅샷의 타격 이벤트 (글자 · 효과 방향을 그 자리에서 잰다)', () => {
    const ev = strike(0, MON, 0.2);
    expect(nearMissStrike(input({ me: at(1.7, 11), events: [ev] }))).toBe(ev);
  });
});

describe('"아슬아슬" 글자 자리 (labelSlot)', () => {
  const me = { x: 10, y: 10 };
  it('이웃이 없으면 위, 위에 괴물이 있으면 비어 있는 다른 쪽', () => {
    expect(labelSlot(me, R, [], null)).toBeCloseTo(-Math.PI / 2, 9);
    const above = { x: me.x, y: me.y - NEAR_MISS.labelDist * R, r: balance.monster.radius };
    const a = labelSlot(me, R, [above], null);
    const d = NEAR_MISS.labelDist * R;
    const x = me.x + Math.cos(a) * d;
    const y = me.y + Math.sin(a) * d;
    expect(Math.hypot(x - above.x, y - above.y)).toBeGreaterThanOrEqual(NEAR_MISS.labelR * R + above.r);
  });

  it('지난 방향이 아직 비어 있으면 그대로 (글자가 옮겨 다니지 않게)', () => {
    expect(labelSlot(me, R, [], Math.PI / 2)).toBe(Math.PI / 2);
  });
});

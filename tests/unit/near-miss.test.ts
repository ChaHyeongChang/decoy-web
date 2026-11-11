// 아슬아슬 회피 판단 (플레이테스트 반영 c 손맛, docs/playtest/c-juice.md 5.4절): 생존자 화면이 자기 스냅샷만으로 판단한다.
// 괴물 (30, 21) 정면(동쪽) 기준 — 사거리 1.2 · 몸 반지름 0.3이라 중심 거리 1.5까지 맞는 경계, 1.5 초과 ~ 1.5 + δ(0.3) 띠, 그 밖은 거짓.
// 판정 부채꼴 안인데 안 맞은 경우도 참, 벽 · 철창 사이 · 수감 · 사망 · 보호 중 · hit{you:true} · 괴물 역할은 거짓
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateBalance } from '../../shared/src/balance';
import { segmentBlocked } from '../../shared/src/geometry';
import { BTN } from '../../shared/src/types';
import { MAP_H, MAP_W, blocksStrike } from '../../shared/src/map';
import { inCircleVision } from '../../shared/src/visibility';
import { Driver, place, readyGame } from '../helpers/fixtures';
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
    prevProtectLeft: 0,
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
    // 보호 마지막 틱(스냅샷 없는 틱이면 두 틱)에 막힌 타격: 이번 스냅샷 protectLeft는 이미 0이지만 지난 스냅샷은 0보다 컸다 —
    // 보호가 막아 준 것은 회피가 아니다 (부채꼴 정중앙 1.0타일이라도)
    expect(nearMissStrike(input({ prevProtectLeft: 0.05, me: at(1.0) }))).toBeNull();
    expect(nearMissStrike(input({ prevProtectLeft: 0.05, me: at(1.7) }))).toBeNull();
    expect(nearMissStrike(input({ prevProtectLeft: 0, me: at(1.0) }))).not.toBeNull();
    const hitMe: GameEvent = { k: 'hit', you: true, x: 31.7, y: 21 };
    const hitMate: GameEvent = { k: 'hit', you: false, x: 31, y: 21 };
    expect(nearMissStrike(input({ events: [hitMe, strike(1)] }))).toBeNull();
    expect(nearMissStrike(input({ events: [strike(1), hitMe] }))).toBeNull();
    // 동료가 맞은 타격을 내가 아슬아슬하게 비껴간 것은 참
    expect(nearMissStrike(input({ events: [hitMate, strike(1)] }))).not.toBeNull();
    // 타격이 없으면 거짓 (이벤트가 없는 스냅샷도 — 판 장면은 그런 스냅샷의 손맛 계획을 건너뛴다)
    expect(nearMissStrike(input({ events: [hitMate] }))).toBeNull();
    expect(nearMissStrike(input({ events: [] }))).toBeNull();
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

// ───── 아슬아슬 판단이 기대는 서버 규칙 (c-juice.md 1.2 표 · 5.1, 서버 · 공유 코드는 그대로 — 시험으로 굳힌다) ─────

/** 몸 원(반지름 r)이 벽 · 철창 칸과 겹치지 않는 자리인가 (몸이 실제로 설 수 있는 자리만 표본으로) */
function bodyFree(p: { x: number; y: number }, r: number): boolean {
  for (let j = Math.floor(p.y - r); j <= Math.floor(p.y + r); j += 1)
    for (let i = Math.floor(p.x - r); i <= Math.floor(p.x + r); i += 1) {
      if (!blocksStrike(i, j)) continue;
      const cx = Math.max(i, Math.min(p.x, i + 1));
      const cy = Math.max(j, Math.min(p.y, j + 1));
      if (Math.hypot(p.x - cx, p.y - cy) < r) return false;
    }
  return true;
}

describe('아슬아슬이 기대는 서버 규칙: 받는 사람 · 시야', () => {
  const kinds = (evs: readonly GameEvent[]): string[] => evs.map((e) => e.k);

  it('팀 시야 밖 타격은 생존자 outbox에 attackStart · attackHit이 0개, 보이면 생존자 전원에게 간다 · hit은 괴물에게 가지 않는다', () => {
    const game = readyGame();
    const d = new Driver(game);
    // 괴물 (30, 18.5) 동쪽, 생존자 셋은 멀리 (팀 시야 밖)
    place(game, 'p1', 30, 18.5, 0);
    place(game, 'p2', 8, 16);
    place(game, 'p3', 8, 17);
    place(game, 'p4', 9, 16);
    for (const id of ['p1', 'p2', 'p3', 'p4']) game.drainOutbox(id);
    d.run(1, { p1: [0, 0, { pressed: BTN.ATTACK }] });
    d.run(d.seconds(ATK.windup) + 2);
    expect(kinds(game.drainOutbox('p1'))).toEqual(expect.arrayContaining(['attackStart', 'attackHit']));
    for (const id of ['p2', 'p3', 'p4']) {
      const got = kinds(game.drainOutbox(id));
      expect(got).not.toContain('attackStart');
      expect(got).not.toContain('attackHit');
    }
    // 러너가 괴물 정면 1.7타일(괴물이 보인다): 빗나간 타격도 생존자 전원에게 attackHit, 괴물에게 hit은 없다
    place(game, 'p2', 31.7, 18.5);
    d.run(d.seconds(ATK.cooldown) + 2);
    for (const id of ['p1', 'p2', 'p3', 'p4']) game.drainOutbox(id);
    d.run(1, { p1: [0, 0, { pressed: BTN.ATTACK }] });
    d.run(d.seconds(ATK.windup) + 2);
    const mine = game.drainOutbox('p2');
    const strikeEv = mine.find((e) => e.k === 'attackHit');
    expect(strikeEv).toMatchObject({ k: 'attackHit', hits: 0 });
    for (const id of ['p3', 'p4']) expect(kinds(game.drainOutbox(id))).toContain('attackHit');
    // 그 스냅샷으로 판단하면 러너는 아슬아슬
    const runner = game.survivorById('p2')!;
    expect(nearMissStrike(input({ me: runner.move, events: mine }))).not.toBeNull();
    // 맞는 타격: hit은 생존자에게만
    place(game, 'p2', 31, 18.5);
    d.run(d.seconds(ATK.cooldown) + 2);
    for (const id of ['p1', 'p2', 'p3', 'p4']) game.drainOutbox(id);
    d.run(1, { p1: [0, 0, { pressed: BTN.ATTACK }] });
    d.run(d.seconds(ATK.windup) + 2);
    expect(kinds(game.drainOutbox('p1'))).not.toContain('hit');
    expect(kinds(game.drainOutbox('p2'))).toContain('hit');
  });

  it('보호 마지막 틱에 막힌 타격: 서버는 hits 0 · 내 피격 없음이고 그 틱 뒤 protectLeft는 0 — 지난 스냅샷의 보호를 보고 아슬아슬이 아니다', () => {
    // 한 틱은 combatTick(보호 > 0이면 무효) → prisonTick(보호를 dt 깎음) 순서라, 보호가 (0, dt] 남은 틱에 막힌 타격은 protectLeft 0인
    // 스냅샷에 실려 온다 (그 틱에 스냅샷이 없으면 다음 틱 스냅샷 — 창은 두 틱까지)
    const game = readyGame();
    const d = new Driver(game);
    place(game, 'p1', 30, 18.5, 0);
    place(game, 'p2', 31, 18.5); // 정면 1.0타일 — 보호가 없으면 맞는 자리
    place(game, 'p3', 8, 16);
    place(game, 'p4', 9, 16);
    for (const id of ['p1', 'p2', 'p3', 'p4']) game.drainOutbox(id);
    d.run(1, { p1: [0, 0, { pressed: BTN.ATTACK }] });
    const runner = game.survivorById('p2')!;
    while (game.monster.windupLeft > game.dt + 1e-9) d.run(1);
    // 타격 틱 시작에 보호가 한 틱 남았다 (지난 스냅샷이 실어 보낸 값)
    runner.protectLeft = game.dt;
    const prevProtectLeft = runner.protectLeft;
    game.drainOutbox('p2');
    d.run(1);
    const evs = game.drainOutbox('p2');
    expect(evs.find((e) => e.k === 'attackHit')).toMatchObject({ k: 'attackHit', hits: 0 });
    expect(kinds(evs)).not.toContain('hit');
    expect(runner.hp).toBe(balance.survivor.maxHp);
    expect(runner.protectLeft).toBe(0);
    // 이번 스냅샷 값만 보면 정중앙 타격이 아슬아슬로 잡힌다 — 지난 스냅샷의 보호도 본다
    const now = { me: runner.move, events: evs, protectLeft: runner.protectLeft };
    expect(nearMissStrike(input(now))).not.toBeNull();
    expect(nearMissStrike(input({ ...now, prevProtectLeft }))).toBeNull();
  });

  it('띠 안이고 타격선이 막히지 않으면 본인은 늘 괴물을 본다 — 아슬아슬은 이미 보이는 것 이상을 알리지 않는다 (맵 전체 격자 표본)', () => {
    const radius = Math.min(balance.survivor.visionRadius, balance.roles.scout.visionRadius);
    let checked = 0;
    // 표본은 칸 모서리를 정확히 지나는 광선(45° · 정수 + 0.5 자리)을 피해 조금씩 비튼다 — 모서리를 정확히 스치는 광선은 쏘는 방향에 따라
    // 막힘 판단이 갈릴 수 있다(넓이 0인 경우). 어느 쪽이든 생존자 화면은 attackHit을 괴물이 팀 시야 안일 때만 받는다(위 시험)
    for (let j = 1.5 + 0.0137; j < MAP_H; j += 2)
      for (let i = 1.5 + 0.0291; i < MAP_W; i += 2) {
        const mon = { x: i, y: j };
        if (!bodyFree(mon, balance.monster.radius)) continue;
        for (let k = 0; k < 8; k += 1) {
          const dir = (k * Math.PI) / 4 + 0.0113;
          for (let a = -110; a <= 110; a += 10)
            for (const dist of [0.6, 1.0, 1.4, 1.6, 1.75, 1.85]) {
              const ang = dir + (a * Math.PI) / 180;
              const me = { x: i + Math.cos(ang) * dist, y: j + Math.sin(ang) * dist };
              if (!bodyFree(me, R)) continue;
              const ev: GameEvent = { k: 'attackHit', x: i, y: j, dir, hits: 0 };
              if (!nearMissStrike(input({ me, events: [ev] }))) continue;
              checked += 1;
              expect(inCircleVision(me, radius, mon), `${i},${j} dir ${dir} → ${me.x},${me.y}`).toBe(true);
            }
        }
      }
    expect(checked).toBeGreaterThan(10_000);
  });
});

// 탭 공격 조준 보정 (플레이테스트 반영 a-2, client/src/aimAssist.ts): 터치 괴물의 짧은 탭 · '누르면 바로' 공격에만 걸리는 가벼운 보정.
// 여기서 고정하는 것
//  1. 보정 규칙: 대상 고르기(각도 → 거리) · 절반만 · 최대 12° · 8° 미만은 그대로 · 맞을 수 없는 대상(수감 · 보호 · 벽 · 철창 뒤) 제외
//  2. "PC 마우스보다 유리하지 않게" 불변식 — 수치 관계는 balance에서 읽어 본다(balance가 바뀌어 관계가 깨지면 여기서 알린다),
//     실제 Game으로 같은 배치의 PC(마우스를 대상 위에 두고 클릭)와 견준다
//  3. "화면에 안 보이는 생존자에게 절대 반응하지 않음" — 실제 서버 스냅샷(computeVisibility + buildSnapshot)을 거치면 부채꼴 밖 ·
//     벽 뒤 생존자와 포효로 드러난 자리는 보정 입력에 닿지 못한다
//  4. 보낸 입력은 PC가 낼 수 있는 입력이다: 전송 원문이 "마우스를 보정한 각도에 두고 한 프레임 뒤 좌클릭"과 같다
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  BTN,
  DEG,
  Rng,
  angleDiff,
  blocksStrike,
  blocksVision,
  segmentBlocked,
  turnToward,
  type InputFrame,
  type Snapshot,
  type SurvivorView,
  type Vec2,
} from '@decoy/shared';
import {
  AliasBook,
  buildSnapshot,
  computeVisibility,
  monsterCanAct,
  sanitizeInput,
  type Game,
} from '@decoy/shared/sim';
import { ASSIST, assistAim, assistRange, assistTargets, type AssistTarget } from '../../client/src/aimAssist';
import { InputSampler } from '../../client/src/input';
import { TouchInput, type TouchFrameCtx } from '../../client/src/touchInput';
import { loadTestBalance, readyGame } from '../helpers/fixtures';

const balance = loadTestBalance();
const RANGE = assistRange(balance);
const FRAME_MS = 1000 / balance.network.serverTickHz;
/** 한 입력 프레임에 서버가 조준을 돌리는 최대 각도 (도) */
const TURN_DEG = balance.monster.aimTurnRateDeg / balance.network.serverTickHz;
const deg = (r: number): number => r / DEG;

/** 둘레 2타일이 모두 바닥인 자리 (오른쪽 방 가운데) */
const OPEN: Vec2 = { x: 38, y: 14 };

const free = (x: number, y: number): AssistTarget => ({ x, y, status: 'free', protected: false });
/** me에서 base 기준 offDeg(시계 방향 +) · 거리 d에 있는 자유 생존자 */
const at = (me: Vec2, base: number, offDeg: number, d: number): AssistTarget =>
  free(me.x + Math.cos(base + offDeg * DEG) * d, me.y + Math.sin(base + offDeg * DEG) * d);

describe('조준 보정 수치: PC보다 유리하지 않게 하는 관계 (balance에서 읽는다)', () => {
  it('보정 폭 12° < 한 입력 프레임 회전량(540°/초 ÷ 30 = 18°) < 공격 호의 반(45°)', () => {
    expect(ASSIST).toEqual({ coneDeg: 30, gain: 0.5, maxTurnDeg: 12, minDeg: 8, extraRange: 0.2 });
    // 한 프레임에 다 돈다: 공격은 정확히 한 프레임만 늦고, PC가 같은 한 프레임에 돌릴 수 있는 것보다 적게 돈다
    expect(ASSIST.maxTurnDeg).toBeLessThan(TURN_DEG);
    expect(TURN_DEG).toBeLessThan(balance.monster.attack.arc / 2);
  });

  it('대상 각도 ±30° ≤ 호의 반: 탭한 순간 이미 공격 호 안에 있는 대상만 (빗나갈 공격을 명중으로 바꾸지 않는다)', () => {
    expect(ASSIST.coneDeg).toBeLessThanOrEqual(balance.monster.attack.arc / 2);
    expect(ASSIST.minDeg).toBeLessThan(ASSIST.coneDeg);
    // 최소 각도에서도 돌리는 폭이 상한을 넘지 않고, 가장 먼 대상(30°)도 상한에 잘린다
    expect(ASSIST.coneDeg * ASSIST.gain).toBeGreaterThan(ASSIST.maxTurnDeg);
  });

  it('다 맞추지 않는다: 돌리는 비율 0 < gain < 1 — 어긋남의 (1 − gain)은 늘 남는다', () => {
    expect(ASSIST.gain).toBeGreaterThan(0);
    expect(ASSIST.gain).toBeLessThan(1);
  });

  it('대상 거리 = 공격이 닿는 거리(사거리 + 생존자 반지름) + 준비 동안 좁히는 만큼(괴물 − 생존자 속도 × 준비 시간) 이하', () => {
    const reach = balance.monster.attack.range + balance.survivor.radius;
    expect(RANGE).toBeCloseTo(reach + ASSIST.extraRange, 12);
    const closing = (balance.monster.moveSpeed - balance.survivor.moveSpeed) * balance.monster.attack.windup;
    expect(ASSIST.extraRange).toBeLessThanOrEqual(closing + 1e-9);
    expect(RANGE).toBeLessThanOrEqual(reach + 0.25);
  });
});

describe('assistAim: 보정 규칙', () => {
  const me = OPEN;

  it('20° 옆 1.2타일 → 절반(10°)만 돌린다, −28° 옆 → 상한 12°, 왼쪽 · 오른쪽 대칭', () => {
    for (const base of [0, 1.1, -2.6, Math.PI]) {
      expect(deg(angleDiff(base, assistAim(base, me, [at(me, base, 20, 1.2)], RANGE)))).toBeCloseTo(10, 9);
      expect(deg(angleDiff(base, assistAim(base, me, [at(me, base, -20, 1.2)], RANGE)))).toBeCloseTo(-10, 9);
      expect(deg(angleDiff(base, assistAim(base, me, [at(me, base, -28, 1.0)], RANGE)))).toBeCloseTo(-12, 9);
      expect(deg(angleDiff(base, assistAim(base, me, [at(me, base, 30, 1.0)], RANGE)))).toBeCloseTo(12, 9);
    }
  });

  it('대상이 없거나 맞출 수 없으면 base 그대로(같은 값): 없음 · 각도 밖 · 거리 밖 · 최소 각도 아래 · 수감 · 보호', () => {
    const base = 0.7;
    expect(assistAim(base, me, [], RANGE)).toBe(base);
    expect(assistAim(base, me, [at(me, base, 31, 1.2)], RANGE)).toBe(base);
    expect(assistAim(base, me, [at(me, base, -35, 1.2)], RANGE)).toBe(base);
    expect(assistAim(base, me, [at(me, base, 20, RANGE + 0.01)], RANGE)).toBe(base);
    expect(assistAim(base, me, [at(me, base, 20, 2.0)], RANGE)).toBe(base);
    expect(assistAim(base, me, [at(me, base, 7.9, 1.2)], RANGE)).toBe(base);
    expect(assistAim(base, me, [at(me, base, -3, 1.2)], RANGE)).toBe(base);
    expect(assistAim(base, me, [{ ...at(me, base, 20, 1.2), status: 'imprisoned' }], RANGE)).toBe(base);
    expect(assistAim(base, me, [{ ...at(me, base, 20, 1.2), status: 'dead' }], RANGE)).toBe(base);
    expect(assistAim(base, me, [{ ...at(me, base, 20, 1.2), protected: true }], RANGE)).toBe(base);
    // 같은 자리가 자유 · 보호 없음이면 돈다 (위 예들이 '원래 안 도는 자리'가 아님)
    expect(assistAim(base, me, [at(me, base, 20, 1.2)], RANGE)).not.toBe(base);
    // 내 자리와 겹친 대상(방향이 없다)은 보지 않는다
    expect(assistAim(base, me, [free(me.x, me.y)], RANGE)).toBe(base);
  });

  it('공격 판정선이 막힌 대상은 없다: 벽 너머 · 철창 너머 (철창은 시야는 통과해 스냅샷에 오지만 공격은 막힌다)', () => {
    // 벽: x 33 줄(y 9~13) 너머
    const wallMe = { x: 32.64, y: 12.2 };
    const wallTarget = free(34.31, 12.5);
    const wallBase = 20 * DEG;
    expect(Math.hypot(wallTarget.x - wallMe.x, wallTarget.y - wallMe.y)).toBeLessThan(RANGE);
    expect(Math.abs(deg(angleDiff(wallBase, Math.atan2(0.3, 1.67))))).toBeLessThan(ASSIST.coneDeg);
    expect(segmentBlocked(wallMe, wallTarget, blocksStrike)).toBe(true);
    expect(assistAim(wallBase, wallMe, [wallTarget], RANGE)).toBe(wallBase);
    // 철창: 감옥 동쪽 철창(x 25) 너머 감옥 안. 시선은 통과한다
    const barMe = { x: 26.4, y: 15.5 };
    const barTarget = free(24.95, 15.05);
    const barBase = Math.PI;
    const off = Math.abs(deg(angleDiff(barBase, Math.atan2(barTarget.y - barMe.y, barTarget.x - barMe.x))));
    expect(off).toBeGreaterThan(ASSIST.minDeg);
    expect(off).toBeLessThan(ASSIST.coneDeg);
    expect(Math.hypot(barTarget.x - barMe.x, barTarget.y - barMe.y)).toBeLessThan(RANGE);
    expect(segmentBlocked(barMe, barTarget, blocksVision)).toBe(false);
    expect(segmentBlocked(barMe, barTarget, blocksStrike)).toBe(true);
    expect(assistAim(barBase, barMe, [barTarget], RANGE)).toBe(barBase);
  });

  it('두 대상이면 각도가 가까운 쪽, 각도가 같으면 가까운 쪽 — 배열 순서와 무관하다', () => {
    const base = -0.4;
    const near = at(me, base, 12, 1.5);
    const far = at(me, base, -25, 0.8);
    for (const list of [
      [near, far],
      [far, near],
    ])
      expect(deg(angleDiff(base, assistAim(base, me, list, RANGE)))).toBeCloseTo(6, 9);
    // 같은 각도(반대쪽 대칭): 가까운 쪽으로
    const a = at(me, base, 20, 1.4);
    const b = at(me, base, -20, 0.9);
    for (const list of [
      [a, b],
      [b, a],
    ])
      expect(deg(angleDiff(base, assistAim(base, me, list, RANGE)))).toBeCloseTo(-10, 9);
    // 가장 가까운 각도의 대상이 최소 각도 아래면(거의 정면) 다른 대상이 있어도 돌리지 않는다
    expect(assistAim(base, me, [at(me, base, 3, 1.2), at(me, base, 25, 1.0)], RANGE)).toBe(base);
  });

  it('불변식 (시드 고정 난수 배치 6000개): 폭 ≤ 12°, 지금 방향과 고른 대상 사이, 남는 어긋남 ≥ 처음의 절반, 순서 · 맞을 수 없는 대상과 무관', () => {
    const rng = new Rng(20261110);
    const pick = <T>(xs: readonly T[]): T => xs[rng.int(xs.length)]!;
    let turned = 0;
    let kept = 0;
    for (let n = 0; n < 6000; n += 1) {
      const base = (rng.next() * 2 - 1) * Math.PI;
      const targets: AssistTarget[] = [];
      const count = 1 + rng.int(3);
      for (let i = 0; i < count; i += 1) {
        const t = at(me, base, (rng.next() * 2 - 1) * 50, 0.3 + rng.next() * 1.8);
        targets.push({
          ...t,
          status: pick(['free', 'free', 'free', 'imprisoned'] as const),
          protected: rng.next() < 0.15,
        });
      }
      const out = assistAim(base, me, targets, RANGE);
      const turn = angleDiff(base, out);
      // 맞을 수 있는 대상: 자유 · 보호 아님 · 거리 · 각도 안 (OPEN 둘레는 막힌 곳이 없다)
      const valid = targets
        .map((t) => ({
          t,
          d: Math.hypot(t.x - me.x, t.y - me.y),
          delta: angleDiff(base, Math.atan2(t.y - me.y, t.x - me.x)),
        }))
        .filter(
          (v) =>
            v.t.status === 'free' &&
            !v.t.protected &&
            v.d <= RANGE &&
            Math.abs(v.delta) <= ASSIST.coneDeg * DEG,
        );
      expect(Math.abs(deg(turn))).toBeLessThanOrEqual(ASSIST.maxTurnDeg + 1e-9);
      if (valid.length === 0) {
        expect(out).toBe(base);
        kept += 1;
      } else {
        const best = valid.reduce((a, b) => (Math.abs(b.delta) < Math.abs(a.delta) ? b : a));
        if (Math.abs(best.delta) < ASSIST.minDeg * DEG) {
          expect(out).toBe(base);
          kept += 1;
        } else {
          turned += 1;
          // 고른 대상 쪽으로, 대상을 넘지 않고, 어긋남의 절반 이하만
          expect(Math.sign(turn)).toBe(Math.sign(best.delta));
          expect(Math.abs(turn)).toBeLessThanOrEqual(Math.abs(best.delta) * ASSIST.gain + 1e-9);
          const left = Math.abs(angleDiff(out, base + best.delta));
          expect(left).toBeGreaterThanOrEqual(Math.abs(best.delta) * (1 - ASSIST.gain) - 1e-9);
          expect(left).toBeGreaterThan(0);
          // PC가 같은 한 프레임에 대상 쪽으로 돌릴 수 있는 것(18°)보다 가깝게 겨누지 못한다
          const pc = turnToward(base, base + best.delta, TURN_DEG * DEG);
          expect(Math.abs(angleDiff(pc, base + best.delta))).toBeLessThanOrEqual(left + 1e-9);
        }
      }
      // 배열 순서를 뒤집어도, 맞을 수 없는 대상을 빼도 같은 값
      expect(assistAim(base, me, [...targets].reverse(), RANGE)).toBe(out);
      expect(
        assistAim(
          base,
          me,
          valid.map((v) => v.t),
          RANGE,
        ),
      ).toBe(out);
    }
    // 두 갈래 모두 충분히 지나갔다 (빈 통과가 아니다)
    expect(turned).toBeGreaterThan(1000);
    expect(kept).toBeGreaterThan(1000);
  });
});

describe('assistTargets: 스냅샷 ∩ 그린 목록, 자리 · 상태 · 보호만 넘긴다 (정보 숨김)', () => {
  const view = (id: string, x: number, y: number, extra: Partial<SurvivorView> = {}): SurvivorView => ({
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
    ...extra,
  });

  it('입력 타입에는 자리 · 상태 · 보호뿐이다 (ID · 역할 · 체력이 없다)', () => {
    expectTypeOf<keyof AssistTarget>().toEqualTypeOf<'x' | 'y' | 'status' | 'protected'>();
    expectTypeOf(assistAim).parameter(2).toEqualTypeOf<readonly AssistTarget[]>();
    expectTypeOf(assistTargets).returns.toEqualTypeOf<AssistTarget[]>();
  });

  it('스냅샷에만 있음(아직 안 그림) · 그린 것에만 있음(스냅샷에서 빠짐) → 대상 아님, 둘 다 있으면 그린 자리', () => {
    const snap = [view('a', 10, 10), view('b', 20, 20)];
    const drawn = new Map([
      ['a', view('a', 9.6, 10.2)],
      ['c', view('c', 30, 30)],
    ]);
    expect(assistTargets(snap, drawn)).toEqual([{ x: 9.6, y: 10.2, status: 'free', protected: false }]);
    expect(assistTargets([], drawn)).toEqual([]);
    expect(assistTargets(snap, new Map())).toEqual([]);
  });

  it('결과에는 네 칸만 있다: 역할이 드러난 생존자(능력 노출)도 ID · 역할 · 방향을 넘기지 않고, 드러나지 않은 생존자와 결과가 같다', () => {
    const hidden = assistTargets([view('a', 3, 4)], new Map([['a', view('a', 3, 4)]]));
    const revealed = assistTargets(
      [view('zz', 3, 4, { role: 'guard', face: 1.2 })],
      new Map([['zz', view('zz', 3, 4, { role: 'guard', face: 1.2 })]]),
    );
    expect(revealed).toEqual(hidden);
    for (const t of [...hidden, ...revealed])
      expect(Object.keys(t).sort()).toEqual(['protected', 'status', 'x', 'y']);
  });

  it('상태 · 보호는 둘 중 맞을 수 없는 쪽을 따른다 (그림은 아직 자유인데 스냅샷은 수감 · 보호)', () => {
    const free0 = view('a', 1, 1);
    const jailed = view('a', 5, 5, { status: 'imprisoned' });
    const shielded = view('a', 1, 1, { protected: true });
    const one = (s: SurvivorView, d: SurvivorView): AssistTarget =>
      assistTargets([s], new Map([['a', d]]))[0]!;
    expect(one(jailed, free0).status).toBe('imprisoned');
    expect(one(free0, jailed).status).toBe('imprisoned');
    expect(one(shielded, free0).protected).toBe(true);
    expect(one(free0, shielded).protected).toBe(true);
    expect(one(free0, free0)).toEqual({ x: 1, y: 1, status: 'free', protected: false });
  });
});

// ───────────── 실제 입력 샘플러 + 서버 Game + 괴물 스냅샷 ─────────────

class FakeDoc extends EventTarget {
  visibilityState: DocumentVisibilityState = 'visible';
}

const wire = (f: InputFrame): InputFrame => sanitizeInput(JSON.parse(JSON.stringify(f)) as InputFrame);

interface Row {
  frame: InputFrame;
  /** 이 입력을 처리한 뒤 서버 상태 */
  tick: number;
  face: number;
  windup: number;
  windupDir: number;
  /** 이 프레임을 만들 때 괴물이 받은 스냅샷 */
  snap: Snapshot;
}

/**
 * 터치 괴물 한 명: 실제 TouchInput + InputSampler가 만든 프레임을 실제 Game에 넣는다. 틱마다 서버가 괴물에게 보낼 스냅샷을
 * 만들고(computeVisibility + buildSnapshot), 보정은 GameScene.tapAssist와 같은 조합으로 그 스냅샷의 생존자만 본다
 * (지연 없는 판이라 그린 목록 = 그 스냅샷의 생존자)
 */
class TouchRig {
  readonly game: Game;
  readonly touch = new TouchInput();
  readonly rows: Row[] = [];
  /** 보정을 끈다 (대조군) */
  assistOn = true;
  private readonly sampler = new InputSampler();
  private readonly aliases = new AliasBook();
  private seq = 0;
  private nowMs = 1000;

  constructor(seed = 3) {
    this.game = readyGame(seed);
    this.sampler.attach(new EventTarget(), {
      touch: this.touch,
      touchAim: true,
      env: { win: new EventTarget(), doc: new FakeDoc(), orientation: new EventTarget() },
    });
    // 나머지 생존자는 멀리 (왼쪽 아래 방)
    this.game.survivors.forEach((s, i) => {
      s.move.x = 4 + i;
      s.move.y = 28;
    });
  }

  get monster(): Game['monster'] {
    return this.game.monster;
  }

  /** 괴물 자리 · 방향 */
  put(x: number, y: number, face: number): this {
    const m = this.monster.move;
    m.x = x;
    m.y = y;
    m.face = face;
    return this;
  }

  /** 첫 생존자를 괴물 기준 offDeg · 거리 d에 둔다 (지금 방향 기준) */
  target(offDeg: number, d: number): Game['survivors'][number] {
    const m = this.monster.move;
    const s = this.game.survivors[0]!;
    s.move.x = m.x + Math.cos(m.face + offDeg * DEG) * d;
    s.move.y = m.y + Math.sin(m.face + offDeg * DEG) * d;
    return s;
  }

  step(n = 1): Row {
    let row: Row | null = null;
    for (let i = 0; i < n; i += 1) {
      this.seq += 1;
      this.nowMs += FRAME_MS;
      const m = this.monster;
      const facts = computeVisibility(this.game);
      this.aliases.update(facts.monsterSees);
      const snap = buildSnapshot(this.game, m.id, this.nowMs, facts, this.aliases);
      if (!snap) throw new Error('괴물 스냅샷 없음');
      const drawn = new Map(snap.survivors.map((s) => [s.id, s]));
      const ctx: TouchFrameCtx = {
        nowMs: this.nowMs,
        face: m.move.face,
        canAttack: monsterCanAct(m) && m.attackCd <= 0,
        canDash: monsterCanAct(m) && m.dashCd <= 0,
      };
      if (this.assistOn)
        ctx.assist = (base) => assistAim(base, m.move, assistTargets(snap.survivors, drawn), RANGE);
      // GameScene과 같게: 터치 모드에서 마우스를 쓰지 않았으면 마우스 조준 = 지금 방향
      const frame = this.sampler.sample(this.seq, m.move.face, ctx);
      this.game.queueInput(m.id, [wire(frame)]);
      this.game.step();
      row = {
        frame,
        tick: this.game.tick,
        face: m.move.face,
        windup: m.windupLeft,
        windupDir: m.windupDir,
        snap,
      };
      this.rows.push(row);
    }
    return row!;
  }

  /** 탭 공격 뒤 공격 준비가 시작된 줄 (탭한 뒤 몇 번째 프레임인지와 함께) */
  tapAttack(frames = 6): { row: Row; after: number; sent: Row[] } {
    const from = this.rows.length;
    this.touch.fire(BTN.ATTACK);
    this.step(frames);
    const sent = this.rows.slice(from);
    const k = sent.findIndex((r) => (r.frame.pressed & BTN.ATTACK) !== 0);
    if (k < 0) throw new Error('ATTACK이 나가지 않음');
    expect(sent.filter((r) => (r.frame.pressed & BTN.ATTACK) !== 0)).toHaveLength(1);
    expect(sent[k]!.windup).toBeGreaterThan(0);
    return { row: sent[k]!, after: k + 1, sent };
  }
}

describe('보정한 탭 공격: 실제 입력 샘플러 + 서버 판정', () => {
  it('보이는 자유 생존자가 20° 옆 1.2타일 → 한 프레임 먼저 보정한 aim, 다음 프레임 ATTACK, 서버 공격 방향 10° (보정을 끄면 0° · 한 프레임 빠름)', () => {
    const on = new TouchRig().put(OPEN.x, OPEN.y, 0);
    on.target(20, 1.2);
    const a = on.tapAttack();
    expect(a.sent[0]!.snap.survivors).toHaveLength(1);
    expect(a.after).toBe(2);
    expect(a.sent[0]!.frame.pressed).toBe(0);
    expect(deg(a.sent[0]!.frame.aim)).toBeCloseTo(10, 1);
    expect(deg(a.row.frame.aim)).toBeCloseTo(10, 1);
    expect(deg(a.row.windupDir)).toBeCloseTo(10, 1);

    const off = new TouchRig().put(OPEN.x, OPEN.y, 0);
    off.assistOn = false;
    off.target(20, 1.2);
    const b = off.tapAttack();
    expect(b.after).toBe(1);
    expect(b.row.windupDir).toBe(0);
    // 보정은 공격을 앞당기지 않는다: 같은 배치에서 한 틱 늦다
    expect(a.row.tick - a.after).toBe(b.row.tick - b.after);
    expect(a.row.tick).toBe(b.row.tick + 1);
  });

  it('상한: −28° 옆 → −12°, 서버 face가 한 틱에 도는 폭은 18° 이하 (평범한 조준과 같은 회전 상한)', () => {
    const r = new TouchRig().put(OPEN.x, OPEN.y, 0);
    r.target(-28, 1.0);
    const a = r.tapAttack();
    expect(deg(a.row.windupDir)).toBeCloseTo(-12, 1);
    let prev = 0;
    for (const row of a.sent) {
      expect(Math.abs(deg(angleDiff(prev, row.face)))).toBeLessThanOrEqual(TURN_DEG + 1e-9);
      prev = row.face;
    }
  });

  it('보정이 없는 배치는 예전과 같다: 3° 옆 · 35° 옆 · 2.0타일 · 수감 · 구조 직후 보호 → 다음 프레임에 지금 방향으로', () => {
    const cases: [string, (r: TouchRig) => void][] = [
      ['3° 옆', (r) => void r.target(3, 1.2)],
      ['35° 옆', (r) => void r.target(35, 1.2)],
      ['2.0타일', (r) => void r.target(20, 2.0)],
      ['수감', (r) => void (r.target(20, 1.2).status = 'imprisoned')],
      ['보호', (r) => void (r.target(20, 1.2).protectLeft = 3)],
    ];
    for (const [name, place] of cases) {
      const r = new TouchRig().put(OPEN.x, OPEN.y, 0);
      place(r);
      const a = r.tapAttack();
      // 모두 괴물 화면에는 보이는 생존자다 (스냅샷에 있다) — 보이지만 보정 대상이 아닌 경우
      expect(a.sent[0]!.snap.survivors, name).toHaveLength(1);
      expect(a.after, name).toBe(1);
      expect(a.row.windupDir, name).toBe(0);
      expect(
        a.sent.every((s) => s.frame.aim === 0),
        name,
      ).toBe(true);
    }
  });
});

describe('화면에 안 보이는 생존자에게 반응하지 않는다 (실제 서버 스냅샷)', () => {
  /** 추적 모드(부채꼴 ±25°)로 */
  const hunt = (r: TouchRig): void => {
    r.monster.mode = 'hunt';
    r.monster.blend = 1;
  };

  it('부채꼴 밖 · 근접 원 밖(추적 모드 28° · 1.6타일, 벽 없음): 스냅샷에 없어 보정 0 — 같은 자리가 탐색 모드(±55°)면 보이고 12° 보정', () => {
    const hidden = new TouchRig().put(OPEN.x, OPEN.y, 0);
    hunt(hidden);
    const s = hidden.target(28, 1.6);
    // 자리만 보면 보정 조건(각도 · 거리 · 막힘 없음)을 모두 지난다 — 정답을 훔쳐본다면 12° 돌았을 자리
    const leaked = assistAim(0, OPEN, [free(s.move.x, s.move.y)], RANGE);
    expect(deg(leaked)).toBeCloseTo(12, 6);
    const a = hidden.tapAttack();
    expect(a.sent.map((x) => x.snap.survivors.length)).toEqual(a.sent.map(() => 0));
    expect(a.after).toBe(1);
    expect(a.row.windupDir).toBe(0);
    expect(a.sent.map((x) => x.frame.aim)).toEqual(a.sent.map(() => 0));

    const seen = new TouchRig().put(OPEN.x, OPEN.y, 0);
    seen.target(28, 1.6);
    const b = seen.tapAttack();
    expect(b.sent[0]!.snap.survivors).toHaveLength(1);
    expect(b.after).toBe(2);
    expect(deg(b.row.windupDir)).toBeCloseTo(12, 1);
  });

  it('벽 뒤(1.7타일 · 지금 방향과 10° 차이): 스냅샷에 없어 보정 0, 보낸 aim도 그대로', () => {
    const r = new TouchRig().put(32.64, 12.2, 20 * DEG);
    const s = r.game.survivors[0]!;
    s.move.x = 34.31;
    s.move.y = 12.5;
    const a = r.tapAttack();
    expect(a.sent.map((x) => x.snap.survivors.length)).toEqual(a.sent.map(() => 0));
    expect(a.after).toBe(1);
    expect(a.row.windupDir).toBe(20 * DEG);
    expect(a.sent.every((x) => x.frame.aim === 20 * DEG)).toBe(true);
  });

  it('포효로 드러난 자리: 좌표가 이벤트로 와도(roarPings) 스냅샷의 생존자가 아니라 보정 0', () => {
    const r = new TouchRig().put(OPEN.x, OPEN.y, 0);
    hunt(r);
    const s = r.target(28, 1.6);
    r.touch.tap(BTN.ROAR);
    const roar = r.step();
    // 다음 스냅샷에 포효 핑이 실려 온다: 보정이 돌았을 그 자리가 들어 있다
    const next = r.step();
    const pings = next.snap.events.flatMap((e) => (e.k === 'roarPings' ? e.pts : []));
    expect(roar.frame.pressed & BTN.ROAR).toBe(BTN.ROAR);
    expect(pings.some((p) => Math.hypot(p.x - s.move.x, p.y - s.move.y) < 0.01)).toBe(true);
    expect(next.snap.survivors).toEqual([]);
    const a = r.tapAttack();
    expect(a.after).toBe(1);
    expect(a.row.windupDir).toBe(0);
    expect(a.sent.every((x) => x.frame.aim === 0 && x.snap.survivors.length === 0)).toBe(true);
  });

  it('철창 너머 감옥 안: 시야는 통과해 스냅샷에 오지만 공격이 막혀 보정 0', () => {
    const r = new TouchRig().put(26.4, 15.5, Math.PI);
    const s = r.game.survivors[0]!;
    s.move.x = 24.95;
    s.move.y = 15.05;
    const a = r.tapAttack();
    expect(a.sent[0]!.snap.survivors).toHaveLength(1);
    expect(a.after).toBe(1);
    expect(a.row.windupDir).toBe(Math.PI);
  });
});

describe('PC와 견주기: 같은 배치에서 PC가 마우스를 대상 위에 두고 클릭 (실제 Game)', () => {
  /** PC 괴물: aim을 대상 방향으로 한 프레임 보낸 뒤 다음 프레임에 좌클릭 (터치 보정 탭과 같은 두 프레임) */
  function pcAttack(offDeg: number, d: number): { windupDir: number; tick: number; bearing: number } {
    const game = readyGame(3);
    game.survivors.forEach((s, i) => {
      s.move.x = 4 + i;
      s.move.y = 28;
    });
    const m = game.monster;
    m.move.x = OPEN.x;
    m.move.y = OPEN.y;
    m.move.face = 0;
    const s = game.survivors[0]!;
    s.move.x = m.move.x + Math.cos(offDeg * DEG) * d;
    s.move.y = m.move.y + Math.sin(offDeg * DEG) * d;
    const bearing = Math.atan2(s.move.y - m.move.y, s.move.x - m.move.x);
    const send = (seq: number, pressed: number): void => {
      game.queueInput(m.id, [wire({ seq, mx: 0, my: 0, aim: bearing, held: pressed, pressed })]);
      game.step();
    };
    send(1, 0);
    send(2, BTN.ATTACK);
    expect(m.windupLeft).toBeGreaterThan(0);
    return { windupDir: m.windupDir, tick: game.tick, bearing };
  }

  for (const [off, d] of [
    [20, 1.2],
    [-28, 1.0],
    [10, 1.4],
    [30, 0.8],
    [-9, 1.6],
  ] as const)
    it(`대상 ${off}° · ${d}타일: PC 공격 방향 오차 ≤ 터치 보정 오차, PC 공격 틱 ≤ 터치 공격 틱`, () => {
      const pc = pcAttack(off, d);
      const r = new TouchRig().put(OPEN.x, OPEN.y, 0);
      r.target(off, d);
      const t = r.tapAttack();
      const pcErr = Math.abs(angleDiff(pc.windupDir, pc.bearing));
      const touchErr = Math.abs(angleDiff(t.row.windupDir, pc.bearing));
      // 보정이 실제로 걸린 배치다 (지금 방향에서 돌았다)
      expect(Math.abs(t.row.windupDir)).toBeGreaterThan(0);
      expect(pcErr).toBeLessThanOrEqual(touchErr + 1e-9);
      // 어긋남의 절반은 남는다: 마우스를 대상에 올린 PC처럼 다 맞지 않는다
      expect(touchErr).toBeGreaterThanOrEqual(Math.abs(off) * DEG * (1 - ASSIST.gain) - 0.01);
      expect(pc.tick).toBeLessThanOrEqual(t.row.tick);
    });

  it('전송 원문이 같다: 보정한 탭의 프레임 열 = PC가 마우스를 보정한 각도에 두고 한 프레임 뒤 좌클릭한 프레임 열 (서버는 구별하지 못한다)', () => {
    const r = new TouchRig().put(OPEN.x, OPEN.y, 0);
    r.target(20, 1.2);
    // 오른쪽으로 걷는 중에 탭
    r.touch.stickStart(1, 'move', 0);
    r.touch.stickMove(1, 1, 0);
    r.step(3);
    r.target(20, 1.2);
    const t = r.tapAttack(4);
    expect(t.after).toBe(2);
    const theta = t.row.frame.aim;
    expect(Math.abs(deg(theta))).toBeGreaterThan(ASSIST.minDeg * ASSIST.gain - 0.5);

    // PC 샘플러: D를 누른 채 마우스 조준을 θ′로 옮기고, 다음 프레임에 좌클릭
    const win = new EventTarget();
    const host = new EventTarget();
    const pc = new InputSampler();
    pc.attach(host, { env: { win, doc: new FakeDoc(), orientation: new EventTarget() } });
    const key = (type: string, code: string): Event =>
      Object.assign(new Event(type), { code, repeat: false });
    const ptr = (type: string): Event => Object.assign(new Event(type), { pointerType: 'mouse', button: 0 });
    win.dispatchEvent(key('keydown', 'KeyD'));
    const first = t.sent[0]!.frame;
    const a = pc.sample(first.seq, theta);
    host.dispatchEvent(ptr('pointerdown'));
    const b = pc.sample(first.seq + 1, theta);
    win.dispatchEvent(ptr('pointerup'));
    expect(JSON.stringify(a)).toBe(JSON.stringify(t.sent[0]!.frame));
    expect(JSON.stringify(b)).toBe(JSON.stringify(t.sent[1]!.frame));
    expect(wire(b)).toEqual(wire(t.sent[1]!.frame));
    expect(b.pressed).toBe(BTN.ATTACK);
  });
});

describe('aimAssist.ts는 순수 모듈이다', () => {
  /** 주석을 뺀 코드 */
  const code = (file: string): string => {
    const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, false);
    return ts.createPrinter({ removeComments: true }).printFile(sf);
  };

  it('@decoy/shared 말고는 import하지 않고, DOM · Phaser · 시계를 쓰지 않는다', () => {
    const src = code('client/src/aimAssist.ts');
    const froms = [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
    expect(froms).toEqual(['@decoy/shared']);
    expect(src).not.toMatch(/\b(window|document|performance|Phaser|localStorage|Date)\b/);
    // 입력으로 받는 칸 말고 생존자를 가리는 값을 읽지 않는다
    expect(src).not.toMatch(/\.(role|hp|imprisonCount|abilityCd|face)\b/);
  });

  it('터치 상태 기계는 보정 모듈을 모른다 (훅으로만 받는다): 끌어 놓기 · 돌진 경로에 섞이지 않게', () => {
    const src = code('client/src/touchInput.ts');
    expect(src).not.toMatch(/aimAssist/);
    expect([...src.matchAll(/ctx\.assist\b/g)].length).toBeGreaterThan(0);
  });
});

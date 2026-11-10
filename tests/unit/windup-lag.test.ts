// 지연이 있을 때 괴물 공격 준비 표시 (플레이테스트 반영 a-4): 가상 시계 위의 지연 가짜 연결(tests/helpers/lagSim.ts —
// 실제 Game · LagQueue · Predictor · predictMonsterPress · cooldownAheadSec · WindupShow · TouchInput)에서
//  ① 쿨타임 어림을 입력 줄로 세면((새 입력 seq − 스냅샷 ack − 1) × 틱) 쿨타임이 끝나는 무렵의 누름도 그 입력 틱에 예측된다
//     — 옛 식(스냅샷을 받은 뒤 흐른 시간 + 왕복 / 2)은 편도 지연만큼 모자라 약 왕복 / 2 폭의 창에서 서버를 기다렸다
//  ② 예측 → 서버 확인 → 끝에서 대기 → 타격 결과까지 표시가 끊기지 않고(시작 시각 유지 · 소리 한 번), 거절 · 기절이면 꺼진다
//  ③ 판정은 그대로다: 준비 시작 틱 + 11틱에 타격, 예측을 끈 클라이언트와 서버 쪽 결과가 같다
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Rng } from '@decoy/shared';
import { stunMonster } from '@decoy/shared/sim';
import { loadTestBalance } from '../helpers/fixtures';
import {
  LAG_SIM_TIMERS,
  SIM_DT_MS,
  simulateLag,
  type LagSimOptions,
  type LagSimResult,
} from '../helpers/lagSim';

const balance = loadTestBalance();
const DT = SIM_DT_MS;
const WINDUP_MS = balance.monster.attack.windup * 1000;
/** ?lag의 지터 (client/src/app.ts가 건다, 서버 --lag는 balance.network.lagJitterMs — 같은 값) */
const JITTER = balance.network.lagJitterMs;
/** 준비 시작 틱 → 타격 틱 (준비 12틱 중 시작 틱에 한 번 줄어든다) */
const STRIKE_AFTER_MS = (Math.round(WINDUP_MS / DT) - 1) * DT;

/** 옛 쿨타임 어림 (고치기 전 GameScene.predictMonster): 스냅샷을 받은 뒤 흐른 시간 + 왕복 / 2 */
const oldAgeSec: NonNullable<LagSimOptions['ageSec']> = (c) => (c.nowMs - c.lastSnapAt + c.lag / 2) / 1000;

beforeEach(() => {
  vi.useFakeTimers(LAG_SIM_TIMERS);
});
afterEach(() => {
  vi.useRealTimers();
});

interface Windows {
  /** 서버가 받아들인 누름 가운데 그 입력 틱에 예측하지 못한 것 (훑은 칸 수) */
  late: number;
  /** 예측했는데 서버가 버린 누름 (헛 예측) */
  falsePos: number;
  /** 서버가 받아들인 누름 */
  accepted: number;
  n: number;
}

const PHASES = 6;
const STEP_MS = 5;
/** 칸 수 → 창 폭 (ms, 위상 평균) */
const widthMs = (cells: number): number => (cells * STEP_MS) / PHASES;

/**
 * 쿨타임 끝 무렵을 훑는다: 첫 공격 뒤, '서버 쿨타임이 0이 된 틱' 기준 −200 ~ +50ms에 5ms 간격으로 한 번 누른다(위상 6가지).
 * 조사 때의 시뮬레이션과 같은 위상 · 시드다(범위만 창이 생기는 구간으로 줄였다)
 */
function scanCooldownEnd(
  lag: number,
  jitter: number,
  ageSec?: LagSimOptions['ageSec'],
  touch = false,
): Windows {
  const out: Windows = { late: 0, falsePos: 0, accepted: 0, n: 0 };
  for (let k = 0; k < PHASES; k += 1) {
    const rng = new Rng(900 + k);
    const base = {
      lag,
      jitter,
      seed: 40 + k,
      serverPhase: rng.next() * DT,
      clientPhase: rng.next() * DT,
      ageSec,
    };
    const probe = simulateLag({ ...base, presses: [{ at: 1000 }], until: 3400 });
    const cdEnd = probe.cdEnds[0];
    if (cdEnd === undefined) throw new Error('쿨타임 끝 없음');
    for (let rel = -200; rel <= 50; rel += STEP_MS) {
      const r = simulateLag({
        ...base,
        presses: [{ at: 1000 }, { at: cdEnd + rel, touch }],
        until: cdEnd + rel + 700,
      });
      const t = r.traces[1];
      if (!t) throw new Error('두 번째 누름 없음');
      out.n += 1;
      if (t.srvStart !== null) out.accepted += 1;
      if (t.srvStart !== null && !t.predicted) out.late += 1;
      if (t.srvStart === null && t.predicted) out.falsePos += 1;
    }
  }
  return out;
}

/** 위상을 흩은 한 번 누름 (쿨타임 없음) */
function fresh(lag: number, i: number, extra: Partial<LagSimOptions> = {}): LagSimResult {
  const rng = new Rng(1000 + i);
  return simulateLag({
    lag,
    jitter: JITTER,
    seed: 77 + i,
    serverPhase: rng.next() * DT,
    clientPhase: rng.next() * DT,
    presses: [{ at: 600 + rng.next() * 100 }],
    until: 1900,
    ...extra,
  });
}

describe('쿨타임 어림: 입력 줄로 센다 (cooldownAheadSec)', () => {
  it('지연만 있고 지터가 없으면 서버 판정과 어림이 완전히 같다 (lag 0 · 100 · 200: 늦은 예측 0 · 헛 예측 0)', () => {
    for (const lag of [0, 100, 200]) {
      const w = scanCooldownEnd(lag, 0);
      expect(w.accepted, `lag ${lag} 받아들인 누름`).toBeGreaterThan(50);
      expect(w.accepted, `lag ${lag} 버린 누름`).toBeLessThan(w.n - 50);
      expect([w.late, w.falsePos], `lag ${lag}`).toEqual([0, 0]);
    }
  });

  it('?lag와 같은 지터(±20ms): 쿨타임 끝 무렵 누름이 그 입력 틱에 예측된다 — 서버를 기다리는 창 20ms 아래, 헛 예측 0 (lag 0 · 100 · 200)', () => {
    const lines: string[] = [];
    for (const lag of [0, 100, 200]) {
      const w = scanCooldownEnd(lag, JITTER);
      lines.push(
        `lag ${lag}: 받아들이는데 예측 없음 ${widthMs(w.late).toFixed(1)}ms · 헛 예측 ${w.falsePos}건`,
      );
      expect(w.accepted, `lag ${lag} 받아들인 누름`).toBeGreaterThan(50);
      // 남는 창은 지터로 입력이 한 틱 늦게 처리되는 경우다 (조사: lag 100 12ms · lag 200 16ms)
      expect(widthMs(w.late), `lag ${lag} 서버를 기다리는 창 (ms)`).toBeLessThan(lag === 0 ? 0.01 : 20);
      expect(w.falsePos, `lag ${lag} 헛 예측`).toBe(0);
    }
    console.log(`[windup-lag] 쿨타임 끝 무렵 (지터 ±${JITTER}ms)\n  ${lines.join('\n  ')}`);
  });

  it('옛 식(스냅샷을 받은 뒤 흐른 시간 + 왕복 / 2)은 편도 지연만큼 모자랐다: 서버를 기다리는 창이 lag 100에서 40ms, lag 200에서 90ms 넘게', () => {
    // 이 시험 틀이 그 차이를 가려내는지: 같은 훑기에서 옛 식은 약 왕복 / 2 폭 (조사: 50 · 110ms)
    const w100 = scanCooldownEnd(100, JITTER, oldAgeSec);
    const w200 = scanCooldownEnd(200, JITTER, oldAgeSec);
    expect(widthMs(w100.late)).toBeGreaterThan(40);
    expect(widthMs(w200.late)).toBeGreaterThan(90);
    expect([w100.falsePos, w200.falsePos]).toEqual([0, 0]);
  });

  it('터치 짧은 탭: 쿨타임 끝 무렵 서버가 받았을 탭이 버려지지 않는다 (옛 식은 lag 200에서 약 100ms 폭의 탭을 보내지 않았다)', () => {
    // 터치는 '할 수 없다'고 어림하면 탭을 보내지 않는다 → 서버가 받는 탭 수로 견준다 (같은 시각의 마우스 클릭이 기준)
    const mouse = scanCooldownEnd(200, JITTER);
    const tap = scanCooldownEnd(200, JITTER, undefined, true);
    const tapOld = scanCooldownEnd(200, JITTER, oldAgeSec, true);
    const lost = mouse.accepted - tap.accepted;
    const lostOld = mouse.accepted - tapOld.accepted;
    console.log(
      `[windup-lag] 터치 탭 lag 200: 마우스면 받아들였을 탭 가운데 버려진 것 ${widthMs(lost).toFixed(1)}ms 폭 (옛 식 ${widthMs(lostOld).toFixed(1)}ms)`,
    );
    expect(widthMs(lost)).toBeLessThan(20);
    expect(widthMs(lostOld)).toBeGreaterThan(90);
    // 서버가 받지 않을 탭을 보내 헛 예측하지도 않는다
    expect(tap.falsePos).toBe(0);
  });
});

describe('연타 (쿨타임 끝에 맞춰 계속 누름)', () => {
  interface Mash {
    /** 서버가 받아들인 공격 */
    attacks: number;
    /** 그 가운데 받아들여진 바로 그 누름의 입력 틱에서 예측한 것 */
    own: number;
    /** 예측한 준비가 서버 거절로 꺼진 횟수 (헛 준비 표시) */
    rejects: number;
    /** 준비 소리 수 */
    sounds: number;
  }
  /** gap ms(± 15) 간격으로 10초 동안 누른다 (위상 · 지터 시드 16가지) */
  function mash(lag: number, gap: number, ageSec?: LagSimOptions['ageSec']): Mash {
    const out: Mash = { attacks: 0, own: 0, rejects: 0, sounds: 0 };
    for (let k = 0; k < 16; k += 1) {
      const rng = new Rng(7000 + k);
      const presses: { at: number }[] = [];
      for (let t = 600 + rng.next() * 100; t < 10_000; t += gap + (rng.next() * 30 - 15))
        presses.push({ at: t });
      const r = simulateLag({
        lag,
        jitter: JITTER,
        seed: 300 + k,
        serverPhase: rng.next() * DT,
        clientPhase: rng.next() * DT,
        presses,
        until: 10_500,
        ageSec,
      });
      out.rejects += r.rejects.length;
      out.sounds += r.sounds.length;
      for (const t of r.traces) {
        if (t.srvStart === null) continue;
        out.attacks += 1;
        if (t.predicted) out.own += 1;
      }
    }
    return out;
  }

  it('lag 100 · 200에서 초당 7 · 12번 눌러도 공격의 4분의 3 넘게가 받아들여진 그 누름에서 예측되고, 헛 준비 표시는 2% 아래, 소리는 공격마다 한 번', () => {
    const lines: string[] = [];
    for (const gap of [80, 140])
      for (const lag of [100, 200]) {
        const m = mash(lag, gap);
        const label = `간격 ${gap}ms · lag ${lag}`;
        lines.push(
          `${label}: 공격 ${m.attacks} · 그 누름에서 예측 ${((m.own / m.attacks) * 100).toFixed(0)}% · 헛 준비 ${m.rejects} · 소리 ${m.sounds}`,
        );
        expect(m.attacks, label).toBeGreaterThanOrEqual(64);
        expect(m.own / m.attacks, `${label} 그 누름에서 예측`).toBeGreaterThan(0.75);
        // 예측이 거절돼도 그 뒤 누름이 가는 중이면 옮겨 잇는다(WindupShow.notePress) — 꺼지는 일은 드물다
        expect(m.rejects / m.attacks, `${label} 헛 준비`).toBeLessThan(0.02);
        // 준비 소리: 공격마다 한 번 (헛 준비가 있으면 그만큼만 더)
        expect(m.sounds, `${label} 준비 소리`).toBe(m.attacks + m.rejects);
      }
    console.log(`[windup-lag] 연타\n  ${lines.join('\n  ')}`);
  });

  it('옛 식은 lag 200 연타에서 공격의 절반도 그 누름에서 예측하지 못했다 (다음 누름이 뒤늦게 켰다)', () => {
    for (const gap of [80, 140]) {
      const m = mash(200, gap, oldAgeSec);
      expect(m.own / m.attacks, `간격 ${gap}ms`).toBeLessThan(0.5);
      expect(m.rejects).toBe(0);
    }
  });
});

describe('준비 표시가 서버를 기다리지 않고, 타격 결과까지 이어진다 (WindupShow)', () => {
  it('쿨타임이 없을 때: lag 0 · 100 · 200 모두 그 입력 틱에 예측하고(서버 확인 전), 서버는 모두 받아들여 시작 + 11틱에 타격한다', () => {
    for (const lag of [0, 100, 200]) {
      for (let i = 0; i < 24; i += 1) {
        const r = fresh(lag, i, { sample: true });
        const t = r.traces[0];
        const label = `lag ${lag} #${i}`;
        if (!t || t.input === null || t.seq === null) throw new Error(`${label}: 누름 없음`);
        const seq = t.seq;
        expect(t.predicted, label).toBe(true);
        // 입력 틱은 누른 뒤 한 틱 안, 표시는 그 틱에 켜진다 (1ms 단위로 본다)
        expect(t.input - t.press, label).toBeLessThanOrEqual(DT + 1);
        const firstOn = r.views.find((v) => v.t >= t.press && v.on);
        expect(firstOn?.t, label).toBe(Math.ceil(t.input));
        // 그 순간 서버는 이 입력을 아직 처리하지 않았다 (지연이 있으면): 서버 확인 전에 그린다
        if (lag > 0) {
          const acked = r.snaps.find((s) => s.ack >= seq);
          expect(acked && acked.t > t.input + lag / 2, label).toBe(true);
        }
        expect(t.srvStart, label).not.toBeNull();
        // 틱 시각은 정수 ms로 적는다 (1ms 안)
        expect(Math.abs((t.srvStrike ?? 0) - (t.srvStart ?? 0) - STRIKE_AFTER_MS), label).toBeLessThan(1);
      }
    }
  });

  it('lag 200: 예측 → 서버 확인 → 끝에서 대기 → 타격 결과까지 한 번도 꺼지지 않는다 — 시작 시각 그대로, 채움은 줄지 않고, 소리는 한 번', () => {
    let held = 0;
    for (let i = 0; i < 24; i += 1) {
      const r = fresh(200, i, { sample: true });
      const t = r.traces[0];
      const label = `#${i}`;
      if (!t || t.input === null || t.hitSeen === null || t.startSeen === null)
        throw new Error(`${label}: 경과 없음`);
      const from = Math.ceil(t.input);
      const shown = r.views.filter((v) => v.t >= from && v.t < t.hitSeen!);
      // 빈 구간 없음: 고치기 전에는 0.4초에 꺼지고 타격 결과까지 평균 165ms 비었다
      expect(
        shown.every((v) => v.on),
        label,
      ).toBe(true);
      expect(t.hitSeen - t.input, label).toBeGreaterThan(WINDUP_MS + 100);
      // 서버 확인(준비 스냅샷 도착)을 지나도 시작 시각이 그대로다 (다시 시작하지 않는다)
      const starts = new Set(shown.map((v) => v.startAt));
      expect(starts.size, label).toBe(1);
      // 시작 시각 = 누른 입력 틱의 명목 시각 (처리한 시각은 그 뒤 첫 정수 ms)
      const startAt = [...starts][0] ?? Number.NaN;
      expect(t.input - startAt, label).toBeGreaterThanOrEqual(0);
      expect(t.input - startAt, label).toBeLessThan(1);
      expect(t.startSeen, label).toBeGreaterThan(from);
      for (let k = 1; k < shown.length; k += 1)
        expect(shown[k]!.fill, `${label} 채움이 줄었다 (${shown[k]!.t}ms)`).toBeGreaterThanOrEqual(
          shown[k - 1]!.fill,
        );
      // 준비 시간에 다 차고(끝에서 대기) 타격 결과가 오면 꺼진다
      const holds = shown.filter((v) => v.hold);
      expect(holds[0]?.t, label).toBe(Math.ceil(startAt + WINDUP_MS));
      expect(
        holds.every((v) => v.fill === 1),
        label,
      ).toBe(true);
      held += holds.length;
      expect(r.views.find((v) => v.t === Math.ceil(t.hitSeen!))?.on, label).toBe(false);
      expect(
        r.views.filter((v) => v.t > t.hitSeen!).some((v) => v.on),
        label,
      ).toBe(false);
      // 소리: 누른 입력 틱에 한 번 (attackStart가 와도 다시 내지 않는다)
      expect(r.sounds, label).toEqual([t.input]);
    }
    // 대기 길이는 왕복 지연쯤이다 (평균 — 틱 · 스냅샷 대기 · 지터로 ± 한 틱 남짓)
    const mean = held / 24;
    console.log(`[windup-lag] lag 200 끝에서 대기 평균 ${mean.toFixed(0)}ms`);
    expect(mean).toBeGreaterThan(200 - 2 * DT);
    expect(mean).toBeLessThan(200 + 2 * DT);
  });

  it('끝에서 대기 중 범위는 타격 자리에 선다: 걷는 중에 눌러도 세워 둔 자리 = 다 찬 순간의 내 자리 = 서버가 타격을 판정한 자리 (지터가 있으면 한 틱 이동 거리 안)', () => {
    /** 한 틱에 걷는 거리 (타일) */
    const stepTiles = balance.monster.moveSpeed * (DT / 1000);
    for (const jitter of [0, JITTER]) {
      let follow = 0;
      for (let i = 0; i < 8; i += 1) {
        const r = fresh(200, i, {
          sample: true,
          jitter,
          move: { mx: 1, my: 0 },
          start: { x: 28.5, y: 16.5 },
        });
        const t = r.traces[0];
        const label = `지터 ${jitter} #${i}`;
        if (!t || t.input === null || t.hitSeen === null) throw new Error(`${label}: 경과 없음`);
        const holds = r.views.filter((v) => v.hold && v.t < t.hitSeen!);
        const first = holds[0];
        const last = holds[holds.length - 1];
        const hit = r.hitAt[0];
        if (!first || !last || !hit || !first.anchor || !last.anchor) throw new Error(`${label}: 대기 없음`);
        // 걷고 있다: 대기 동안 내 자리는 계속 간다 — 범위가 나를 따라갔다면 타격 자리에서 이만큼 벗어났다
        expect(last.me.x - first.me.x, label).toBeGreaterThan(3 * stepTiles);
        follow = Math.max(follow, Math.hypot(last.me.x - hit.x, last.me.y - hit.y));
        // 세워 둔 자리는 움직이지 않는다
        expect(last.anchor, label).toEqual(first.anchor);
        // 다 찬 순간 내가 그려지는 자리 (1ms 단위 표본이라 한 표본만큼의 이동 안): 따라가다 세울 때 튀지 않는다
        expect(Math.hypot(first.anchor.x - first.me.x, first.anchor.y - first.me.y), label).toBeLessThan(
          0.01,
        );
        // 서버가 타격을 판정한 자리 (attackHit 이벤트의 x · y): 서버가 틱마다 입력 하나를 처리하면 같은 자리다. 지터로 입력이
        // 한 틱 몰리거나 밀리면 한 틱 이동 거리만큼 다르다
        const off = Math.hypot(first.anchor.x - hit.x, first.anchor.y - hit.y);
        expect(off, label).toBeLessThan(jitter === 0 ? 1e-6 : stepTiles + 1e-6);
      }
      expect(follow, `지터 ${jitter}: 따라갔다면 벗어났을 거리`).toBeGreaterThan(4 * stepTiles);
    }
  });

  it('거절(쿨타임): 예측했는데 서버가 받지 않으면, 그 입력을 처리한 스냅샷이 오는 순간 꺼진다 (0.4초를 다 채우지 않는다)', () => {
    for (let i = 0; i < 8; i += 1) {
      // 서버에서만 쿨타임을 남긴다: 클라이언트의 마지막 스냅샷은 쿨타임 0이라 예측한다
      const r = fresh(200, i, {
        sample: true,
        beforeServerTick: (game, now) => {
          if (now >= 600 && now < 600 + DT) game.monster.attackCd = 1;
        },
      });
      const t = r.traces[0];
      const label = `#${i}`;
      if (!t || t.input === null || t.seq === null) throw new Error(`${label}: 누름 없음`);
      const seq = t.seq;
      expect([t.predicted, t.srvStart], label).toEqual([true, null]);
      const acked = r.snaps.find((s) => s.ack >= seq);
      if (!acked) throw new Error(`${label}: 확인 스냅샷 없음`);
      expect(acked.windup, label).toBe(0);
      const on = r.views.filter((v) => v.on);
      expect(on[0]?.t, label).toBe(Math.ceil(t.input));
      expect(on[on.length - 1]!.t, label).toBe(Math.ceil(acked.t) - 1);
      expect(acked.t - t.input, label).toBeLessThan(WINDUP_MS);
      expect(
        on.some((v) => v.hold),
        label,
      ).toBe(false);
      expect(r.strikes, label).toEqual([]);
    }
  });

  it('기절: 준비 중 밀치기를 맞으면 기절 이벤트가 오는 순간 꺼진다 — 서버가 그 입력을 처리하기 전에 맞았어도', () => {
    for (const [name, stunAt] of [
      ['서버 준비 중에 기절', 150],
      ['입력이 서버에 닿기 전에 기절', 30],
    ] as const) {
      for (let i = 0; i < 6; i += 1) {
        let done = false;
        const probe = fresh(200, i);
        const input = probe.traces[0]?.input;
        if (input === null || input === undefined) throw new Error('누름 없음');
        const r = fresh(200, i, {
          sample: true,
          beforeServerTick: (game, now) => {
            if (done || now < input + stunAt) return;
            done = true;
            stunMonster(game, game.monster, balance.roles.guard.stunDuration);
          },
        });
        const t = r.traces[0];
        const label = `${name} #${i}`;
        if (!t || t.input === null) throw new Error(`${label}: 누름 없음`);
        expect(t.predicted, label).toBe(true);
        const stunned = r.snaps.find((s) => s.kinds.includes('stunned'));
        if (!stunned) throw new Error(`${label}: 기절 스냅샷 없음`);
        const on = r.views.filter((v) => v.on);
        expect(on[0]?.t, label).toBe(Math.ceil(t.input));
        expect(on[on.length - 1]!.t, label).toBe(Math.ceil(stunned.t) - 1);
        expect(r.strikes, label).toEqual([]);
        expect(r.hitAt, label).toEqual([]);
      }
    }
  });

  it('판정 불변: 예측을 끈 클라이언트와 서버 쪽 준비 시작 틱 · 타격 틱 · 쿨타임 끝이 같다 (표시는 입력을 바꾸지 않는다)', () => {
    for (const lag of [0, 100, 200]) {
      for (let i = 0; i < 6; i += 1) {
        const presses = [{ at: 620 }, { at: 1500 }, { at: 2700 + i * 7 }];
        const on = fresh(lag, i, { presses, until: 3600 });
        // 어림을 아주 비관적으로: 한 번도 예측하지 않는다
        const off = fresh(lag, i, { presses, until: 3600, ageSec: () => -1e9 });
        const label = `lag ${lag} #${i}`;
        expect(
          on.traces.some((t) => t.predicted),
          label,
        ).toBe(true);
        expect(
          off.traces.some((t) => t.predicted),
          label,
        ).toBe(false);
        const server = (r: LagSimResult): unknown => ({
          starts: r.traces.map((t) => t.srvStart),
          strikes: r.strikes,
          cdEnds: r.cdEnds,
          hitAt: r.hitAt,
        });
        expect(server(on), label).toEqual(server(off));
        expect(on.strikes.length, label).toBeGreaterThanOrEqual(2);
      }
    }
  });
});

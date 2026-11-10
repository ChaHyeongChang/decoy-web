// 판 시작 카운트다운의 화면 쪽 (플레이테스트 a-8): 남은 초 → 글자(3 · 2 · 1 → "시작!") · 소리 낼 순간(순수 함수), 카운트다운 동안
// 눌린 버튼은 버리고 누르고 있는 이동은 남기는 입력(InputSampler.dropPressed), 행동 칸 못 씀, ?countdown=1 주소 인자
import { describe, expect, it } from 'vitest';
import { BTN, type Role, type Snapshot } from '@decoy/shared';
import { AliasBook, Game, buildSnapshot, computeVisibility } from '@decoy/shared/sim';
import { readParams } from '../../client/src/app';
import { UI_TEXT } from '../../client/src/data/storyText';
import { InputSampler, type InputEnv } from '../../client/src/input';
import { TouchInput, type TouchFrameCtx } from '../../client/src/touchInput';
import { CountdownTracker, GO_SHOW_MS, countdownDigit } from '../../client/src/ui/countdownView';
import { actionSlots } from '../../client/src/ui/hudArt';
import { loadTestBalance, setup4 } from '../helpers/fixtures';

const balance = loadTestBalance();
const GO = UI_TEXT.countdownGo;

describe('남은 초 → 숫자 (countdownDigit)', () => {
  it('3.00~2.01초는 3, 2.00~1.01초는 2, 그 아래는 1', () => {
    expect(countdownDigit(3, 0)).toBe(3);
    expect(countdownDigit(2.93, 0)).toBe(3);
    expect(countdownDigit(2.01, 0)).toBe(3);
    expect(countdownDigit(2, 0)).toBe(2);
    expect(countdownDigit(1.03, 0)).toBe(2);
    expect(countdownDigit(1, 0)).toBe(1);
    expect(countdownDigit(0.03, 0)).toBe(1);
  });

  it('스냅샷 사이는 받은 뒤 지난 시간으로 잇는다 (20Hz 스냅샷 사이에 숫자가 바뀌는 순간이 늦지 않게)', () => {
    expect(countdownDigit(2.03, 0)).toBe(3);
    expect(countdownDigit(2.03, 29)).toBe(3);
    expect(countdownDigit(2.03, 31)).toBe(2);
    // 받은 시각이 뒤로 가도(음수) 숫자가 올라가지 않는다
    expect(countdownDigit(2, -500)).toBe(2);
  });

  it('1 아래로는 내리지 않는다: 스냅샷이 끊겨 오래 지나도 서버가 0을 보내기 전에는 1이다', () => {
    expect(countdownDigit(0.5, 400)).toBe(1);
    expect(countdownDigit(0.03, 5000)).toBe(1);
    expect(countdownDigit(3, 60_000)).toBe(1);
  });

  it('수치가 3보다 커도 그대로 센다 (수치를 바꾸면 화면도 따라간다)', () => {
    expect(countdownDigit(5, 0)).toBe(5);
    expect(countdownDigit(4.2, 300)).toBe(4);
  });
});

/** 서버 3초 카운트다운을 20Hz 스냅샷 · 60fps 프레임으로 흘려 보며 (글자, 소리)를 모은다 */
function playCountdown(opts: { from?: number; snapEveryMs?: number } = {}): {
  labels: string[];
  sounds: string[];
  goShownMs: number;
} {
  const from = opts.from ?? 3;
  const snapEvery = opts.snapEveryMs ?? 50;
  const tr = new CountdownTracker();
  const labels: string[] = [];
  const sounds: string[] = [];
  let snapLeft = from;
  let snapAt = 0;
  let goFirst = -1;
  let goLast = -1;
  for (let now = 0; now <= from * 1000 + 2000; now += 1000 / 60) {
    // 그 시각까지 도착한 마지막 스냅샷 (서버 값은 소수 둘째 자리)
    const due = Math.floor(now / snapEvery) * snapEvery;
    if (due !== snapAt || now === 0) {
      snapAt = due;
      snapLeft = Math.max(0, Math.round((from - due / 1000) * 100) / 100);
    }
    tr.update(snapLeft, now - snapAt, false, now);
    if (tr.sound) sounds.push(tr.sound);
    if (tr.label !== null && labels.at(-1) !== tr.label) labels.push(tr.label);
    if (tr.label === GO) {
      if (goFirst < 0) goFirst = now;
      goLast = now;
    }
  }
  return { labels, sounds, goShownMs: goLast - goFirst };
}

describe('카운트다운 표시 (CountdownTracker)', () => {
  it('문구는 "시작!"이다 (STORY_TEXT 4절)', () => {
    expect(GO).toBe('시작!');
  });

  it('3초: 글자는 3 → 2 → 1 → 시작!, 소리는 숫자마다 한 번씩 셋 + 시작 소리 하나', () => {
    const r = playCountdown();
    expect(r.labels).toEqual(['3', '2', '1', GO]);
    expect(r.sounds).toEqual(['count', 'count', 'count', 'go']);
  });

  it('"시작!"은 0.7초 떠 있다가 사라진다', () => {
    const r = playCountdown();
    expect(GO_SHOW_MS).toBe(700);
    expect(r.goShownMs).toBeGreaterThan(GO_SHOW_MS - 40);
    expect(r.goShownMs).toBeLessThanOrEqual(GO_SHOW_MS);
    const tr = new CountdownTracker();
    tr.update(0.5, 0, false, 1000);
    tr.update(0, 0, false, 1100);
    expect(tr.label).toBe(GO);
    tr.update(0, 0, false, 1100 + GO_SHOW_MS - 1);
    expect(tr.label).toBe(GO);
    expect(tr.sound).toBeNull();
    tr.update(0, 0, false, 1100 + GO_SHOW_MS);
    expect(tr.label).toBeNull();
  });

  it('스냅샷이 드물어도(200ms) 숫자는 제때 바뀌고 소리는 숫자마다 한 번이다', () => {
    const r = playCountdown({ snapEveryMs: 200 });
    expect(r.labels).toEqual(['3', '2', '1', GO]);
    expect(r.sounds).toEqual(['count', 'count', 'count', 'go']);
  });

  it('늦게 온 스냅샷이 있어도 숫자가 되올라가지 않는다: 2.10을 받고 120ms 공백 → 2.03 → 2.00 (소리도 다시 나지 않는다)', () => {
    const tr = new CountdownTracker();
    const step = (left: number, rcvAt: number, now: number): [string | null, string | null] => {
      tr.update(left, now - rcvAt, false, now);
      return [tr.label, tr.sound];
    };
    expect(step(3, 0, 0)).toEqual(['3', 'count']);
    expect(step(2.1, 900, 900)).toEqual(['3', null]);
    // 다음 스냅샷이 늦다: 받은 뒤 지난 시간으로 이어 2로 내려간다
    expect(step(2.1, 900, 1000)).toEqual(['2', 'count']);
    // 늦게 온 스냅샷(2.03 — 받은 뒤 지난 시간 0)이 3을 가리켜도 되올라가지 않는다
    expect(step(2.03, 1018, 1018)).toEqual(['2', null]);
    expect(step(2.03, 1018, 1051)).toEqual(['2', null]);
    expect(step(2, 1051, 1051)).toEqual(['2', null]);
    expect(step(1, 2050, 2050)).toEqual(['1', 'count']);
    expect(step(0, 3050, 3050)).toEqual([GO, 'go']);
  });

  it('스냅샷 도착 지터(순서 보존)에도 글자는 언제나 3 · 2 · 1 · 시작!, 소리는 count 셋 + go 하나다', () => {
    // 서버가 보내는 값: 실제 Game(3초 카운트다운)의 스냅샷 틱(30Hz 중 20Hz)마다 world.countdown
    const game = new Game(setup4(), balance, { seed: 5, countdown: 3 });
    const sent: { at: number; left: number }[] = [];
    const isSnapTick = (tick: number): boolean =>
      Math.floor((tick * balance.network.snapshotHz) / balance.network.serverTickHz) !==
      Math.floor(((tick - 1) * balance.network.snapshotHz) / balance.network.serverTickHz);
    const id = [...game.players.keys()][0]!;
    for (let tick = 1; tick <= 4 * balance.network.serverTickHz; tick += 1) {
      game.step();
      if (!isSnapTick(tick)) continue;
      const snap = buildSnapshot(game, id, 0, computeVisibility(game), new AliasBook());
      if (!snap) throw new Error('스냅샷 없음');
      sent.push({ at: (tick * 1000) / balance.network.serverTickHz, left: snap.world.countdown });
    }
    expect(sent.at(-1)?.left).toBe(0);
    // 결정적 난수 (mulberry32)
    const rand = (seed: number): (() => number) => {
      let a = seed >>> 0;
      return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    };
    /** 한 판: 스냅샷마다 지연을 더하되 보낸 순서대로 받는다(TCP). 60fps 프레임마다 마지막으로 받은 스냅샷으로 update */
    const play = (delay: () => number, phase: number): string => {
      const tr = new CountdownTracker();
      const arrive: number[] = [];
      for (const s of sent) arrive.push(Math.max(arrive.at(-1) ?? 0, s.at + 40 + delay()));
      const labels: string[] = [];
      const sounds: string[] = [];
      let k = -1;
      for (let now = phase; now <= (arrive.at(-1) ?? 0) + GO_SHOW_MS + 200; now += 1000 / 60) {
        while (k + 1 < sent.length && arrive[k + 1]! <= now) k += 1;
        if (k < 0) continue;
        tr.update(sent[k]!.left, now - arrive[k]!, false, now);
        if (tr.sound) sounds.push(tr.sound);
        if (tr.label !== null && labels.at(-1) !== tr.label) labels.push(tr.label);
      }
      return `${labels.join(' ')} / ${sounds.join(' ')}`;
    };
    const want = `3 2 1 ${GO} / count count count go`;
    const models: [string, (r: () => number) => number][] = [
      ['지수 분포 평균 10ms', (r) => -10 * Math.log(1 - r())],
      ['지수 분포 평균 30ms', (r) => -30 * Math.log(1 - r())],
      ['지수 분포 평균 60ms', (r) => -60 * Math.log(1 - r())],
      ['5%가 120ms 늦음', (r) => (r() < 0.05 ? 120 : 0)],
      ['고르게 0~150ms', (r) => r() * 150],
    ];
    for (const [name, model] of models) {
      const r = rand(name.length * 7919);
      const bad = new Map<string, number>();
      for (let run = 0; run < 300; run += 1) {
        const got = play(() => model(r), r() * 16);
        if (got !== want) bad.set(got, (bad.get(got) ?? 0) + 1);
      }
      expect([...bad.entries()], name).toEqual([]);
    }
  });

  it('"시작!"은 서버가 0을 보낸 뒤에만 뜬다: 스냅샷이 끊기면 1에서 기다린다', () => {
    const tr = new CountdownTracker();
    tr.update(0.4, 0, false, 0);
    expect(tr.label).toBe('1');
    tr.update(0.4, 3000, false, 3000);
    expect(tr.label).toBe('1');
    expect(tr.sound).toBeNull();
    tr.update(0, 0, false, 3050);
    expect(tr.label).toBe(GO);
    expect(tr.sound).toBe('go');
  });

  it('재접속으로 중간에 들어오면 남은 숫자부터 (지난 숫자의 소리는 내지 않는다)', () => {
    const r = playCountdown({ from: 1.6 });
    expect(r.labels).toEqual(['2', '1', GO]);
    expect(r.sounds).toEqual(['count', 'count', 'go']);
  });

  it('처음부터 0이면(시험 방 · 판 중 재접속) 아무것도 띄우지 않고 소리도 없다', () => {
    const tr = new CountdownTracker();
    for (let now = 0; now < 2000; now += 16) {
      tr.update(0, now % 50, false, now);
      expect(tr.label).toBeNull();
      expect(tr.sound).toBeNull();
    }
  });

  it("판 정지(괴물 재접속 대기) 중에는 숫자를 숨기고('' — 끝난 것(null)이 아니다) 잇지 않는다. 풀리면 같은 숫자부터 소리 없이 다시 보인다", () => {
    const tr = new CountdownTracker();
    tr.update(2.5, 0, false, 0);
    expect([tr.label, tr.sound]).toEqual(['3', 'count']);
    // 서버 값이 2.5에서 멈춘 채 스냅샷만 온다 (받은 뒤 지난 시간이 길어도 숫자를 내리지 않는다)
    tr.update(2.5, 40, true, 100);
    expect([tr.label, tr.sound]).toEqual(['', null]);
    tr.update(2.5, 900, true, 5000);
    expect([tr.label, tr.sound]).toEqual(['', null]);
    tr.update(2.5, 10, false, 5100);
    expect([tr.label, tr.sound]).toEqual(['3', null]);
    tr.update(1.9, 0, false, 5700);
    expect([tr.label, tr.sound]).toEqual(['2', 'count']);
  });

  it('정지 중에 판이 끝나(0이 아닌 채) 그대로면 "시작!"을 띄우지 않는다', () => {
    const tr = new CountdownTracker();
    tr.update(2, 0, false, 0);
    for (let now = 100; now < 3000; now += 100) tr.update(2, 50, true, now);
    expect(tr.label).toBe('');
    expect(tr.sound).toBeNull();
  });
});

// ───────────────────────── 입력 ─────────────────────────

class FakeDoc extends EventTarget {
  visibilityState: DocumentVisibilityState = 'visible';
}

function rig(touch: TouchInput | null, touchAim = false): { sampler: InputSampler; win: EventTarget } {
  const env: InputEnv = { win: new EventTarget(), doc: new FakeDoc(), orientation: new EventTarget() };
  const sampler = new InputSampler();
  sampler.attach(new EventTarget(), { touch, touchAim, env });
  return { sampler, win: env.win };
}

const key = (type: 'keydown' | 'keyup', code: string): Event =>
  Object.assign(new Event(type, { cancelable: true }), { code, repeat: false });
const CAN: TouchFrameCtx = { nowMs: 0, face: 0, canAttack: true, canDash: true };

describe('카운트다운 동안의 입력 (InputSampler.dropPressed)', () => {
  it('키보드: 그사이 누른 능력 · 구조는 버리고, 누르고 있는 이동 키는 "시작!"에 그대로 이어진다', () => {
    const r = rig(null);
    r.win.dispatchEvent(key('keydown', 'KeyD'));
    r.win.dispatchEvent(key('keydown', 'Space'));
    r.win.dispatchEvent(key('keyup', 'Space'));
    r.win.dispatchEvent(key('keydown', 'KeyE'));
    r.win.dispatchEvent(key('keyup', 'KeyE'));
    // 카운트다운 입력 틱마다 (보내지 않는다)
    for (let i = 0; i < 90; i += 1) r.sampler.dropPressed();
    const f = r.sampler.sample(1, Number.NaN);
    expect(f).toMatchObject({ mx: 1, my: 0, pressed: 0, held: 0 });
  });

  it('키보드: 버리지 않으면 그사이 누른 능력이 시작 순간 나간다 (dropPressed가 필요한 까닭)', () => {
    const r = rig(null);
    r.win.dispatchEvent(key('keydown', 'Space'));
    r.win.dispatchEvent(key('keyup', 'Space'));
    expect(r.sampler.sample(1, Number.NaN).pressed).toBe(BTN.ABILITY);
  });

  it('터치: 누르고 있던 이동 스틱은 남고(다시 누르지 않아도 걷는다), 탭한 능력 · 포효는 버린다', () => {
    const touch = new TouchInput();
    const r = rig(touch, false);
    touch.stickStart(1, 'move', 0);
    touch.stickMove(1, 0, -1);
    touch.tap(BTN.ABILITY);
    touch.tap(BTN.ROAR);
    for (let i = 0; i < 90; i += 1) r.sampler.dropPressed();
    const f = r.sampler.sample(1, Number.NaN, CAN);
    expect(f).toMatchObject({ mx: 0, my: -1, pressed: 0, held: 0 });
    // 판 정지 · 세로 화면의 clearPressed는 손가락까지 비운다 (그래서 카운트다운에는 쓰지 않는다)
    r.sampler.clearPressed();
    expect(r.sampler.sample(2, Number.NaN, CAN)).toMatchObject({ mx: 0, my: 0 });
  });

  it('터치 괴물: 조준 스틱 발사 대기 · 짧은 탭 · 돌진 탭도 버린다 — "시작!"에 공격 · 돌진이 저절로 나가지 않는다', () => {
    const touch = new TouchInput();
    const r = rig(touch, true);
    // 조준 스틱을 끌었다 바깥에서 뗌 → 발사 대기
    touch.stickStart(1, 'aim', 0);
    touch.stickMove(1, 1, 0);
    touch.stickEnd(1, 100);
    r.sampler.dropPressed();
    expect(r.sampler.sample(1, 0, CAN).pressed).toBe(0);
    // 짧은 탭(지금 방향 공격) · 돌진 탭
    touch.stickStart(2, 'aim', 200);
    touch.stickEnd(2, 250);
    touch.stickStart(3, 'dash', 260);
    touch.stickEnd(3, 300);
    r.sampler.dropPressed();
    expect(r.sampler.sample(2, 0, { ...CAN, nowMs: 1000 }).pressed).toBe(0);
    // 버린 뒤에 새로 누른 것은 그대로 나간다
    touch.stickStart(4, 'aim', 1100);
    touch.stickEnd(4, 1150);
    expect(r.sampler.sample(3, 0, { ...CAN, nowMs: 1200 }).pressed).toBe(BTN.ATTACK);
  });

  // 플레이테스트 a-2와 함께 (통합 검토): '누르면 바로'(fire)와 탭 공격 조준 보정의 발사 대기도 카운트다운 동안 버린다
  const ASSIST20: TouchFrameCtx = { ...CAN, assist: (b) => b + (20 * Math.PI) / 180 };

  it('터치 괴물 · 누르면 바로: 카운트다운 중 누른 공격 버튼(fire)은 "시작!" 순간에도, 보정 발사 대기를 거쳐서도 나가지 않는다', () => {
    const touch = new TouchInput();
    const r = rig(touch, true);
    touch.fire(BTN.ATTACK);
    r.sampler.dropPressed();
    const f1 = r.sampler.sample(1, 0, { ...ASSIST20, nowMs: 100 });
    // 보정 각도에 face가 와 있어도 (발사 대기가 남아 있었다면 여기서 나간다)
    const f2 = r.sampler.sample(2, 0, { ...ASSIST20, face: (20 * Math.PI) / 180, nowMs: 133 });
    expect([f1.pressed, f2.pressed]).toEqual([0, 0]);
  });

  it('터치 괴물 · 누르면 바로 대조: 버리지 않으면 fire는 보정 발사 대기를 거쳐 다음 프레임에 나간다 (위 시험이 빈 통과가 아님)', () => {
    const touch = new TouchInput();
    const r = rig(touch, true);
    touch.fire(BTN.ATTACK);
    const f1 = r.sampler.sample(1, 0, { ...ASSIST20, nowMs: 100 });
    const f2 = r.sampler.sample(2, 0, { ...ASSIST20, face: (20 * Math.PI) / 180, nowMs: 133 });
    expect([f1.pressed, f2.pressed]).toEqual([0, BTN.ATTACK]);
  });

  it('터치 괴물 · 끌어서 조준: 카운트다운 동안 문턱 밖으로 끈 채 누르고 있다가 시작 뒤에 떼면 그 방향으로 나간다 (누르고 있던 입력은 이어받는다)', () => {
    const touch = new TouchInput();
    const r = rig(touch, true);
    touch.stickStart(1, 'aim', 0);
    touch.stickMove(1, 0, 1);
    for (let i = 0; i < 10; i += 1) r.sampler.dropPressed();
    touch.stickEnd(1, 3000);
    expect(r.sampler.sample(1, 0, { ...CAN, face: Math.PI / 2, nowMs: 3010 }).pressed).toBe(BTN.ATTACK);
  });

  it('터치: 누르고 있는 구조 버튼은 held로 남되 누른 신호(pressed)는 나가지 않는다 (키를 누르고 있는 것과 같다)', () => {
    const touch = new TouchInput();
    const r = rig(touch, false);
    touch.hold(BTN.RESCUE, true);
    r.sampler.dropPressed();
    expect(r.sampler.sample(1, Number.NaN, CAN)).toMatchObject({ held: BTN.RESCUE, pressed: 0 });
  });
});

// ───────────────────────── 행동 칸 · 주소 인자 ─────────────────────────

function snapFor(role: Role, countdown: number): Snapshot {
  const game = new Game(setup4(), balance, { seed: 3, countdown });
  game.monster.move.frozen = 0;
  game.step();
  const id = [...game.players.values()].find((p) => p.role === role)?.id;
  if (!id) throw new Error('역할 없음');
  const facts = computeVisibility(game);
  const snap = buildSnapshot(game, id, 0, facts, new AliasBook());
  if (!snap) throw new Error('스냅샷 없음');
  return snap;
}

describe('행동 칸 (actionSlots)', () => {
  it('카운트다운 중에는 생존자 능력 · 괴물 공격 · 돌진 · 포효 · 시야 모드가 모두 못 씀이고, 끝나면 쓸 수 있다', () => {
    const runner = snapFor('runner', 3);
    expect(runner.world.countdown).toBeGreaterThan(0);
    expect(actionSlots(runner, balance, 'runner').map((s) => `${s.id}:${s.state}`)).toEqual([
      'ability:blocked',
      'rescue:blocked',
    ]);
    const monster = snapFor('monster', 3);
    expect(actionSlots(monster, balance, 'monster').map((s) => s.state)).toEqual([
      'blocked',
      'blocked',
      'blocked',
      'blocked',
    ]);
    // 카운트다운이 없으면 (같은 상태) 능력 · 공격 · 돌진 · 포효는 준비
    expect(actionSlots(snapFor('runner', 0), balance, 'runner')[0]?.state).toBe('ready');
    expect(
      actionSlots(snapFor('monster', 0), balance, 'monster')
        .slice(0, 3)
        .map((s) => s.state),
    ).toEqual(['ready', 'ready', 'ready']);
  });
});

describe('?countdown=1 (시험 연습 판에서 카운트다운 켜기)', () => {
  it('1일 때만 켠다', () => {
    expect(readParams('').countdown).toBe(false);
    expect(readParams('?debug=hook&practice=1').countdown).toBe(false);
    expect(readParams('?debug=hook&practice=1&countdown=1').countdown).toBe(true);
    for (const v of ['0', 'true', '', '3']) expect(readParams(`?countdown=${v}`).countdown, v).toBe(false);
  });
});

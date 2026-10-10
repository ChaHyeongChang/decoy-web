// 입력 형식 동일성 (M11, MOBILE_PLAN M11 자동 검증): 키보드 · 마우스와 터치가 같은 InputFrame을 만든다.
// 두 InputSampler(PC 모드 / 터치 모드)에 같은 조작을 넣어 프레임 키 집합 · 전송 원문(JSON) · 서버 sanitizeInput 뒤 값이
// 같은지, 같은 시퀀스를 서버 Game에 넣은 결과(위치 · 공격 준비 · 돌진 방향 · 구조)가 같은지 본다.
// 그리고 InputSampler 회귀: 키 자동 반복 · 터치 pointerdown은 공격 아님 · 마우스 좌클릭은 그대로 · 창 단위 취소 이벤트.
// DOM 없이(jsdom 없음) 최소한의 EventTarget으로 이벤트를 보낸다
import { describe, expect, it } from 'vitest';
import { BTN, type InputFrame } from '@decoy/shared';
import { monsterCanAct, sanitizeInput, type Game } from '@decoy/shared/sim';
import { InputLog, InputSampler, type InputEnv } from '../../client/src/input';
import { TouchInput, type TouchFrameCtx } from '../../client/src/touchInput';
import { place, readyGame } from '../helpers/fixtures';

const FRAME_MS = 1000 / 30;

class FakeDoc extends EventTarget {
  visibilityState: DocumentVisibilityState = 'visible';
}

interface Rig {
  sampler: InputSampler;
  host: EventTarget;
  win: EventTarget;
  doc: FakeDoc;
  orientation: EventTarget;
}

function rig(touch: TouchInput | null, touchAim = false): Rig {
  const env: InputEnv & { doc: FakeDoc; orientation: EventTarget } = {
    win: new EventTarget(),
    doc: new FakeDoc(),
    orientation: new EventTarget(),
  };
  const host = new EventTarget();
  const sampler = new InputSampler();
  sampler.attach(host, { touch, touchAim, env });
  return { sampler, host, win: env.win, doc: env.doc, orientation: env.orientation };
}

const keyEv = (type: 'keydown' | 'keyup', code: string, repeat = false): Event =>
  Object.assign(new Event(type, { cancelable: true }), { code, repeat });
const ptrEv = (type: string, pointerType: string, button = 0): Event =>
  Object.assign(new Event(type, { cancelable: true }), { pointerType, button });

const press = (r: Rig, code: string): void => void r.win.dispatchEvent(keyEv('keydown', code));
const release = (r: Rig, code: string): void => void r.win.dispatchEvent(keyEv('keyup', code));
/** 마우스 버튼 누르기 (캔버스) · 떼기 (창) */
const mouseDown = (r: Rig, button: number): void =>
  void r.host.dispatchEvent(ptrEv('pointerdown', 'mouse', button));
const mouseUp = (r: Rig, button: number): void =>
  void r.win.dispatchEvent(ptrEv('pointerup', 'mouse', button));

/** 서버가 받는 값: WebSocket JSON 왕복 + sanitizeInput */
const wire = (f: InputFrame): InputFrame => sanitizeInput(JSON.parse(JSON.stringify(f)) as InputFrame);

/** 두 판에서 비교할 상태 (위치 · 조준 · 공격 준비 · 돌진 · 쿨타임 · 모드 · 구조 · 능력) */
function state(game: Game): unknown {
  const m = game.monster;
  return {
    tick: game.tick,
    monster: {
      move: { ...m.move, dirHist: [...m.move.dirHist] },
      windupLeft: m.windupLeft,
      windupDir: m.windupDir,
      attackCd: m.attackCd,
      dashCd: m.dashCd,
      roarCd: m.roarCd,
      mode: m.mode,
    },
    survivors: game.survivors.map((s) => ({
      x: s.move.x,
      y: s.move.y,
      face: s.move.face,
      status: s.status,
      hp: s.hp,
      abilityCd: s.abilityCd,
      abilityActive: s.abilityActive,
      rescueProgress: s.rescueProgress,
    })),
  };
}

/**
 * 같은 시드 판 두 개: 하나는 PC 샘플러(키보드 · 마우스), 하나는 터치 샘플러(TouchInput)가 한 플레이어를 조작한다.
 * tick()마다 두 프레임이 전송 원문까지 같은지 보고 각자의 판에 넣는다
 */
class Duo {
  readonly pcGame: Game;
  readonly tcGame: Game;
  readonly pc = rig(null);
  readonly touch = new TouchInput();
  readonly tc: Rig;
  readonly monster: boolean;
  readonly sent: InputFrame[] = [];
  private seq = 0;
  private nowMs = 1000;

  constructor(
    readonly playerId: string,
    seed = 3,
  ) {
    this.pcGame = readyGame(seed);
    this.tcGame = readyGame(seed);
    this.monster = playerId === this.pcGame.monster.id;
    this.tc = rig(this.touch, this.monster);
  }

  /** 두 판에 같은 배치 */
  place(id: string, x: number, y: number, face?: number): void {
    place(this.pcGame, id, x, y, face);
    place(this.tcGame, id, x, y, face);
  }

  /** 터치 쪽 상황: 예측 face와 행동 가능 여부 (지연 없는 판이라 서버 상태 = 예측) */
  private ctx(): TouchFrameCtx {
    const m = this.tcGame.monster;
    const me = this.tcGame.players.get(this.playerId)!;
    const mine = this.monster;
    return {
      nowMs: this.nowMs,
      face: me.move.face,
      canAttack: mine && monsterCanAct(m) && m.attackCd <= 0,
      canDash: mine && monsterCanAct(m) && m.dashCd <= 0,
    };
  }

  /** n틱: mouseAim은 PC 커서 조준(괴물), 생존자는 NaN */
  tick(mouseAim = Number.NaN, n = 1): InputFrame {
    let last: InputFrame | null = null;
    for (let i = 0; i < n; i += 1) {
      this.seq += 1;
      this.nowMs += FRAME_MS;
      const me = this.tcGame.players.get(this.playerId)!;
      const a = this.pc.sampler.sample(this.seq, mouseAim);
      // GameScene과 같게: 터치 모드에서 마우스를 쓰지 않았으면 마우스 조준 = 지금 방향
      const b = this.tc.sampler.sample(this.seq, this.monster ? me.move.face : Number.NaN, this.ctx());
      expect(Object.keys(b).sort()).toEqual(Object.keys(a).sort());
      expect(JSON.stringify(b)).toBe(JSON.stringify(a));
      const wa = wire(a);
      const wb = wire(b);
      expect(wb).toEqual(wa);
      this.pcGame.queueInput(this.playerId, [wa]);
      this.tcGame.queueInput(this.playerId, [wb]);
      this.pcGame.step();
      this.tcGame.step();
      expect(state(this.tcGame)).toEqual(state(this.pcGame));
      this.sent.push(a);
      last = a;
    }
    return last!;
  }
}

/** 오른쪽 스틱 · 커서 각도 (두 쪽이 같은 atan2 값을 쓴다) */
const angleOf = (x: number, y: number): number => Math.atan2(y, x);

describe('입력 형식 동일성: 생존자 (키보드 ↔ 터치)', () => {
  it('W ↔ 이동 스틱 위, W+D ↔ 45°: 프레임 · 원문 · 서버 값 · 판 결과가 같고 aim은 둘 다 NaN', () => {
    const d = new Duo('p2');
    press(d.pc, 'KeyW');
    d.touch.stickStart(1, 'move', 0);
    d.touch.stickMove(1, 0, -0.9);
    const up = d.tick(Number.NaN, 10);
    expect(up.my).toBe(-1);
    expect(up.mx).toBe(0);
    expect(Number.isNaN(up.aim)).toBe(true);
    expect(
      Number.isNaN(
        d.tc.sampler.sample(999, Number.NaN, { nowMs: 0, face: 0, canAttack: false, canDash: false }).aim,
      ),
    ).toBe(true);
    press(d.pc, 'KeyD');
    d.touch.stickMove(1, 0.5, -0.5);
    const diag = d.tick(Number.NaN, 10);
    expect(diag.mx).toBeCloseTo(Math.SQRT1_2, 15);
    expect(diag.my).toBeCloseTo(-Math.SQRT1_2, 15);
    release(d.pc, 'KeyW');
    release(d.pc, 'KeyD');
    d.touch.stickEnd(1, 0);
    d.tick(Number.NaN, 3);
    expect(d.pcGame.survivorById('p2')!.move.y).toBeLessThan(readyGame(3).survivorById('p2')!.move.y);
  });

  it('E 누르기 ↔ 구조 버튼 누르고 있기: 같은 틱에 감옥이 열린다', () => {
    const d = new Duo('p4');
    for (const g of [d.pcGame, d.tcGame]) {
      for (const s of [g.survivorById('p2')!, g.survivorById('p3')!]) {
        s.status = 'imprisoned';
        s.hp = 0;
        s.imprisonCount = 1;
      }
    }
    d.place('p2', 23.5, 15.5);
    d.place('p3', 24.5, 15.5);
    d.place('p4', 24, 18.6);
    d.place('p1', 40, 16);
    press(d.pc, 'KeyE');
    d.touch.hold(BTN.RESCUE, true);
    const first = d.tick();
    expect(first.pressed).toBe(BTN.RESCUE);
    expect(first.held).toBe(BTN.RESCUE);
    const next = d.tick();
    expect(next.pressed).toBe(0);
    expect(next.held).toBe(BTN.RESCUE);
    d.tick(Number.NaN, 95);
    expect(d.tcGame.survivorById('p2')!.status).toBe('free');
    release(d.pc, 'KeyE');
    d.touch.hold(BTN.RESCUE, false);
    expect(d.tick().held).toBe(0);
  });

  it('Space ↔ 능력 버튼 탭: 같은 프레임 · 같은 능력 발동', () => {
    const d = new Duo('p2');
    press(d.pc, 'Space');
    d.touch.tap(BTN.ABILITY);
    const f = d.tick();
    expect(f.pressed).toBe(BTN.ABILITY);
    release(d.pc, 'Space');
    d.tick(Number.NaN, 5);
    expect(d.tcGame.survivorById('p2')!.abilityActive).toBeGreaterThan(0);
  });
});

describe('입력 형식 동일성: 괴물 (키보드 · 마우스 ↔ 터치)', () => {
  it('좌클릭 ↔ 조준 스틱 놓기: 같은 틱에 같은 방향으로 공격 준비', () => {
    const d = new Duo('p1');
    d.place('p1', 40, 16, Math.PI);
    press(d.pc, 'KeyW');
    d.touch.stickStart(1, 'move', 0);
    d.touch.stickMove(1, 0, -1);
    const theta = angleOf(0.8, 0.6);
    d.touch.stickStart(2, 'aim', 0);
    d.touch.stickMove(2, 0.8, 0.6);
    d.tick(theta, 12);
    expect(d.pcGame.monster.move.face).toBe(theta);
    mouseDown(d.pc, 0);
    d.touch.stickEnd(2, 0);
    const shot = d.tick(theta);
    mouseUp(d.pc, 0);
    expect(shot.pressed).toBe(BTN.ATTACK);
    expect(shot.aim).toBe(theta);
    expect(d.pcGame.monster.windupLeft).toBeGreaterThan(0);
    expect(d.pcGame.monster.windupDir).toBe(theta);
    // 스틱을 놓은 뒤에는 이동 방향을 본다 (PC는 커서를 위로)
    d.tick(-Math.PI / 2, 20);
    expect(d.pcGame.monster.attackCd).toBeGreaterThan(0);
    expect(d.sent.filter((f) => (f.pressed & BTN.ATTACK) !== 0)).toHaveLength(1);
  });

  it('커서 쪽 Shift ↔ 돌진 끌기: 위로 이동하면서 오른쪽(90° 다른 쪽)으로 돌진', () => {
    const d = new Duo('p1');
    d.place('p1', 40, 16, Math.PI);
    press(d.pc, 'KeyW');
    d.touch.stickStart(1, 'move', 0);
    d.touch.stickMove(1, 0, -1);
    d.touch.stickStart(3, 'dash', 0);
    d.touch.stickMove(3, 0.7, 0);
    d.tick(angleOf(1, 0), 12);
    press(d.pc, 'ShiftLeft');
    d.touch.stickEnd(3, 0);
    const go = d.tick(0);
    release(d.pc, 'ShiftLeft');
    expect(go.pressed).toBe(BTN.DASH);
    expect(go.my).toBe(-1);
    const m = d.pcGame.monster.move;
    expect(m.dash).toBeGreaterThan(0);
    expect(m.dashDx).toBe(1);
    expect(m.dashDy).toBe(0);
    d.tick(-Math.PI / 2, 10);
  });

  it('Shift ↔ 돌진 버튼 탭 · Q ↔ 포효 · 우클릭 ↔ 시야 모드', () => {
    const d = new Duo('p1');
    d.place('p1', 40, 16, -Math.PI / 2);
    press(d.pc, 'KeyW');
    d.touch.stickStart(1, 'move', 0);
    d.touch.stickMove(1, 0, -1);
    const up = angleOf(0, -1);
    d.tick(up, 3);
    press(d.pc, 'ShiftRight');
    d.touch.stickStart(4, 'dash', 0);
    d.touch.stickEnd(4, 0);
    expect(d.tick(up).pressed).toBe(BTN.DASH);
    release(d.pc, 'ShiftRight');
    expect(d.pcGame.monster.dashCd).toBeGreaterThan(0);
    d.tick(up, 10);
    press(d.pc, 'KeyQ');
    d.touch.tap(BTN.ROAR);
    expect(d.tick(up).pressed).toBe(BTN.ROAR);
    release(d.pc, 'KeyQ');
    expect(d.pcGame.monster.roarCd).toBeGreaterThan(0);
    mouseDown(d.pc, 2);
    d.touch.tap(BTN.MODE);
    expect(d.tick(up).pressed).toBe(BTN.MODE);
    mouseUp(d.pc, 2);
    expect(d.pcGame.monster.mode).toBe('hunt');
    d.tick(up, 5);
  });
});

describe('InputSampler 회귀 (키보드 · 마우스)', () => {
  const ctx0: TouchFrameCtx = { nowMs: 0, face: 0, canAttack: true, canDash: true };

  it('키 자동 반복은 pressed를 다시 켜지 않는다', () => {
    const r = rig(null);
    r.win.dispatchEvent(keyEv('keydown', 'KeyE'));
    expect(r.sampler.sample(1, Number.NaN).pressed).toBe(BTN.RESCUE);
    r.win.dispatchEvent(keyEv('keydown', 'KeyE', true));
    r.win.dispatchEvent(keyEv('keydown', 'KeyE', true));
    const f = r.sampler.sample(2, Number.NaN);
    expect(f.pressed).toBe(0);
    expect(f.held).toBe(BTN.RESCUE);
    r.win.dispatchEvent(keyEv('keyup', 'KeyE'));
    r.win.dispatchEvent(keyEv('keydown', 'KeyE'));
    expect(r.sampler.sample(3, Number.NaN).pressed).toBe(BTN.RESCUE);
  });

  it('마우스 좌클릭은 그대로 ATTACK, 우클릭은 MODE (PC · 터치 모드 모두)', () => {
    for (const r of [rig(null), rig(new TouchInput(), true)]) {
      r.host.dispatchEvent(ptrEv('pointerdown', 'mouse', 0));
      const f = r.sampler.sample(1, 0.5, ctx0);
      expect(f.pressed).toBe(BTN.ATTACK);
      expect(f.held).toBe(BTN.ATTACK);
      r.win.dispatchEvent(ptrEv('pointerup', 'mouse', 0));
      expect(r.sampler.sample(2, 0.5, ctx0).held).toBe(0);
      r.host.dispatchEvent(ptrEv('pointerdown', 'mouse', 2));
      expect(r.sampler.sample(3, 0.5, ctx0).pressed).toBe(BTN.MODE);
    }
  });

  it('터치 pointerdown은 ATTACK · MODE를 만들지 않는다 (터치 모드 · PC 모드 모두)', () => {
    for (const r of [rig(new TouchInput(), true), rig(null)]) {
      r.host.dispatchEvent(ptrEv('pointerdown', 'touch', 0));
      r.host.dispatchEvent(ptrEv('pointerdown', 'touch', 2));
      const f = r.sampler.sample(1, 0, ctx0);
      expect(f.pressed).toBe(0);
      expect(f.held).toBe(0);
      // 그래도 조작 안내는 닫는다
      expect(r.sampler.anyKeyPressed).toBe(true);
    }
  });

  it('펜: 터치 모드에서는 공격 아님, PC 모드에서는 마우스처럼', () => {
    const t = rig(new TouchInput(), true);
    t.host.dispatchEvent(ptrEv('pointerdown', 'pen', 0));
    expect(t.sampler.sample(1, 0, ctx0).pressed).toBe(0);
    const p = rig(null);
    p.host.dispatchEvent(ptrEv('pointerdown', 'pen', 0));
    expect(p.sampler.sample(1, 0).pressed).toBe(BTN.ATTACK);
  });

  it('터치 손가락을 떼도 누르고 있는 마우스 버튼은 그대로', () => {
    const r = rig(new TouchInput(), true);
    r.host.dispatchEvent(ptrEv('pointerdown', 'mouse', 0));
    r.win.dispatchEvent(ptrEv('pointerup', 'touch', 0));
    expect(r.sampler.sample(1, 0, ctx0).held).toBe(BTN.ATTACK);
  });

  it('입력칸이 없는 환경(단위 테스트)에서도 키 이벤트를 처리하고, 떼어 내면 더 받지 않는다', () => {
    const r = rig(null);
    r.sampler.detach();
    r.win.dispatchEvent(keyEv('keydown', 'KeyW'));
    r.host.dispatchEvent(ptrEv('pointerdown', 'mouse', 0));
    const f = r.sampler.sample(1, Number.NaN);
    expect(f).toMatchObject({ mx: 0, my: 0, held: 0, pressed: 0 });
    expect(r.sampler.mode).toBe('keyboard');
  });
});

describe('InputSampler: 터치 소스 합치기', () => {
  const ctx = (face = 0): TouchFrameCtx => ({ nowMs: 0, face, canAttack: true, canDash: true });

  it('이동은 키보드가 있으면 키보드, 없으면 터치. held · pressed는 OR', () => {
    const touch = new TouchInput();
    const r = rig(touch, false);
    expect(r.sampler.mode).toBe('touch');
    touch.stickStart(1, 'move', 0);
    touch.stickMove(1, 1, 0);
    expect(r.sampler.sample(1, Number.NaN, ctx())).toMatchObject({ mx: 1, my: 0 });
    r.win.dispatchEvent(keyEv('keydown', 'KeyS'));
    touch.hold(BTN.RESCUE, true);
    const f = r.sampler.sample(2, Number.NaN, ctx());
    expect(f).toMatchObject({ mx: 0, my: 1, held: BTN.RESCUE, pressed: BTN.RESCUE });
    r.win.dispatchEvent(keyEv('keyup', 'KeyS'));
    r.win.dispatchEvent(keyEv('keydown', 'Space'));
    touch.tap(BTN.ABILITY);
    const g = r.sampler.sample(3, Number.NaN, ctx());
    expect(g).toMatchObject({ mx: 1, my: 0, held: BTN.RESCUE | BTN.ABILITY, pressed: BTN.ABILITY });
  });

  it('생존자는 터치로 움직여도 aim을 보내지 않는다 (NaN)', () => {
    const touch = new TouchInput();
    const r = rig(touch, false);
    touch.stickStart(1, 'move', 0);
    touch.stickMove(1, 0, 1);
    expect(Number.isNaN(r.sampler.sample(1, Number.NaN, ctx()).aim)).toBe(true);
  });

  it('터치 괴물: 터치가 아직 조준을 정하지 않았으면 마우스 조준, 정하면 터치 조준', () => {
    const touch = new TouchInput();
    const r = rig(touch, true);
    expect(r.sampler.sample(1, 0.25, ctx()).aim).toBe(0.25);
    touch.stickStart(1, 'move', 0);
    touch.stickMove(1, -1, 0);
    expect(r.sampler.sample(2, 0.25, ctx()).aim).toBe(Math.PI);
  });

  it('터치 모드에서 마우스 커서 조준은 실제 마우스를 움직인 뒤에만 쓴다 (PC 모드는 늘)', () => {
    const r = rig(new TouchInput(), true);
    expect(r.sampler.mouseAimUsable).toBe(false);
    r.win.dispatchEvent(ptrEv('pointermove', 'touch'));
    expect(r.sampler.mouseAimUsable).toBe(false);
    r.win.dispatchEvent(ptrEv('pointermove', 'mouse'));
    expect(r.sampler.mouseAimUsable).toBe(true);
    expect(rig(null).sampler.mouseAimUsable).toBe(true);
  });

  it('터치 화면(캔버스 밖)에 닿아도 조작 안내를 닫는다', () => {
    const r = rig(new TouchInput(), true);
    r.win.dispatchEvent(ptrEv('pointerdown', 'touch'));
    expect(r.sampler.anyKeyPressed).toBe(true);
  });

  it('판 정지 · 세로 화면(clearPressed): 터치 손가락 · 발사 대기 · 눌림을 모두 버린다', () => {
    const touch = new TouchInput();
    const r = rig(touch, true);
    touch.stickStart(1, 'aim', 0);
    touch.stickMove(1, 1, 0);
    touch.stickEnd(1, 0);
    touch.tap(BTN.ROAR);
    r.sampler.clearPressed();
    const f = r.sampler.sample(1, 0, ctx(0));
    expect(f.pressed).toBe(0);
  });
});

describe('창 단위 취소 이벤트마다 터치 이동 · RESCUE 0 (blur · 숨김 · 화면 회전)', () => {
  const ctx: TouchFrameCtx = { nowMs: 0, face: 0, canAttack: true, canDash: true };
  const events: [string, (r: Rig) => void][] = [
    ['blur', (r) => r.win.dispatchEvent(new Event('blur'))],
    [
      'visibilitychange(hidden)',
      (r) => {
        r.doc.visibilityState = 'hidden';
        r.doc.dispatchEvent(new Event('visibilitychange'));
      },
    ],
    ['orientationchange', (r) => r.win.dispatchEvent(new Event('orientationchange'))],
    ['screen.orientation change', (r) => r.orientation.dispatchEvent(new Event('change'))],
  ];
  for (const [name, fire] of events) {
    it(name, () => {
      const touch = new TouchInput();
      const r = rig(touch, true);
      touch.stickStart(1, 'move', 0);
      touch.stickMove(1, 0, -1);
      touch.hold(BTN.RESCUE, true);
      touch.stickStart(2, 'aim', 0);
      touch.stickMove(2, 1, 0);
      expect(r.sampler.sample(1, 0, ctx)).toMatchObject({ mx: 0, my: -1, held: BTN.RESCUE });
      fire(r);
      touch.stickEnd(2, 10); // 이미 비운 손가락: 발사 대기로 가지 않는다
      for (let i = 0; i < 15; i += 1) {
        const f = r.sampler.sample(2 + i, 0, { ...ctx, nowMs: 10 + i * FRAME_MS });
        expect(f).toMatchObject({ mx: 0, my: 0, held: 0, pressed: 0 });
      }
    });
  }

  it('화면 회전은 키보드 상태를 건드리지 않는다', () => {
    const r = rig(new TouchInput(), true);
    r.win.dispatchEvent(keyEv('keydown', 'KeyA'));
    r.win.dispatchEvent(new Event('orientationchange'));
    expect(r.sampler.sample(1, 0, ctx).mx).toBe(-1);
  });

  it('PC 모드는 화면 회전 이벤트를 듣지 않는다', () => {
    const r = rig(null);
    r.win.dispatchEvent(keyEv('keydown', 'KeyA'));
    r.win.dispatchEvent(new Event('orientationchange'));
    expect(r.sampler.sample(1, Number.NaN).mx).toBe(-1);
  });
});

describe('입력 기록 (getInputLog)', () => {
  it('최근 120프레임을 오래된 것부터, 프레임 + 시각 + 입력 방식', () => {
    const log = new InputLog(120);
    for (let i = 1; i <= 130; i += 1) {
      log.push(
        { seq: i, mx: 0, my: 0, aim: Number.NaN, held: 0, pressed: i === 125 ? BTN.ATTACK : 0 },
        i * 10,
        'touch',
      );
    }
    const e = log.entries();
    expect(e).toHaveLength(120);
    expect(e[0]!.seq).toBe(11);
    expect(e[119]!.seq).toBe(130);
    expect(e.find((x) => x.pressed !== 0)).toMatchObject({ seq: 125, t: 1250, mode: 'touch' });
    log.clear();
    expect(log.entries()).toEqual([]);
    log.push({ seq: 1, mx: 1, my: 0, aim: 0, held: 0, pressed: 0 }, 5, 'keyboard');
    expect(log.entries()).toEqual([
      { seq: 1, mx: 1, my: 0, aim: 0, held: 0, pressed: 0, t: 5, mode: 'keyboard' },
    ]);
  });
});

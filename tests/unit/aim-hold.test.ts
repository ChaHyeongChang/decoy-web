// 괴물 마우스 조준 붙잡기 (따라가는 카메라): 커서가 움직였을 때 커서 월드 자리를 재고, 그 사이에는 그 자리를 기준 카메라
// (앞당김 · 따라가기 지연 없이 괴물 가운데, 맵 안으로 자름)를 따라 옮긴 곳을 겨눈다
import { describe, expect, it } from 'vitest';
import { AimHold, aimAnchor } from '../../client/src/aimHold';
import { CameraDirector, type DirectorInput } from '../../client/src/render/cameraDirector';
import { loadTestBalance } from '../helpers/fixtures';

const MAP_W = 48;
const MAP_H = 32;
const VW = 16;
const VH = 32 / 3;

describe('AimHold', () => {
  it('커서가 그대로면 앞당김 · 흔들림으로 커서 아래 월드 자리가 바뀌어도(기준 카메라는 그대로) 방향이 같다', () => {
    const a = new AimHold();
    const pointer = { x: 500, y: 300 };
    const anchor = { x: 420, y: 300 };
    const body = { x: 400, y: 300 };
    const first = a.update(pointer, { x: 600, y: 300 }, body, anchor, 2, 1);
    expect(first).toBeCloseTo(0, 9);
    for (let i = 1; i <= 30; i += 1) {
      const got = a.update(pointer, { x: 600 + i * 3, y: 300 - i * 2 }, body, anchor, 2, 1);
      expect(got).toBe(first);
    }
    expect(a.held).toBe(30);
  });

  it('맵 가운데를 걸으면(기준 카메라가 괴물과 같이 움직인다) 같은 방향을 계속 본다', () => {
    const a = new AimHold();
    const pointer = { x: 500, y: 300 };
    const first = a.update(pointer, { x: 500, y: 100 }, { x: 500, y: 300 }, { x: 500, y: 300 }, 2, 0);
    expect(first).toBeCloseTo(-Math.PI / 2, 9);
    for (let i = 1; i <= 20; i += 1) {
      const p = { x: 500 - i * 7, y: 300 + i * 2 };
      // 커서 아래 월드 자리는 실제 창(앞당김 · 지연 포함)에 따라 아무렇게나 바뀌어도 쓰지 않는다
      expect(a.update(pointer, { x: 900, y: -50 }, p, p, 2, 0)).toBeCloseTo(-Math.PI / 2, 9);
    }
  });

  it('맵 끝에 막힌 축에서는(기준 카메라가 멈춘다) 화면 속 괴물이 걸어도 커서 자리를 겨눈다 (검토 반영)', () => {
    const a = new AimHold();
    const pointer = { x: 700, y: 100 };
    const anchor = { x: 600, y: 300 };
    const cursor = { x: 900, y: 100 };
    a.update(pointer, cursor, { x: 900, y: 400 }, anchor, 2, 0);
    // 괴물이 서쪽으로 300 걸었다 (기준은 막혀 그대로 → 커서 월드 자리도 그대로)
    const got = a.update(pointer, cursor, { x: 600, y: 400 }, anchor, 2, 0);
    expect(got).toBeCloseTo(Math.atan2(100 - 400, 900 - 600), 9);
  });

  it('커서가 움직이면 그 자리에서 다시 잰다', () => {
    const a = new AimHold();
    a.update({ x: 500, y: 300 }, { x: 600, y: 300 }, { x: 400, y: 300 }, { x: 400, y: 300 }, 2, 1);
    const got = a.update(
      { x: 500, y: 301 },
      { x: 400, y: 500 },
      { x: 400, y: 300 },
      { x: 400, y: 300 },
      2,
      1,
    );
    expect(got).toBeCloseTo(Math.PI / 2, 9);
    expect(a.held).toBe(0);
  });

  it('커서가 괴물 몸 위면 지난 방향, 처음이면 지금 바라보는 방향', () => {
    const a = new AimHold();
    const o = { x: 400, y: 300 };
    expect(a.update({ x: 1, y: 1 }, { x: 400.5, y: 300 }, o, o, 2, 0.7)).toBe(0.7);
    a.update({ x: 2, y: 2 }, { x: 400, y: 200 }, o, o, 2, 0.7);
    expect(a.update({ x: 3, y: 3 }, { x: 401, y: 300 }, o, o, 2, 0.7)).toBeCloseTo(-Math.PI / 2, 9);
  });

  it('reset 뒤에는 커서 자리가 같아도 다시 잰다 (새 판)', () => {
    const a = new AimHold();
    const pointer = { x: 500, y: 300 };
    const o = { x: 400, y: 300 };
    a.update(pointer, { x: 600, y: 300 }, o, o, 2, 1);
    a.reset();
    expect(a.update(pointer, { x: 400, y: 100 }, o, o, 2, 1)).toBeCloseTo(-Math.PI / 2, 9);
  });
});

describe('aimAnchor (기준 카메라 가운데)', () => {
  it('맵 가운데면 괴물 자리, 맵 끝 가까이면 창이 맵 안에 들도록 잘린다', () => {
    const o = { x: 0, y: 0 };
    expect(aimAnchor(24, 16, VW, VH, MAP_W, MAP_H, o)).toEqual({ x: 24, y: 16 });
    expect(aimAnchor(45, 28, VW, VH, MAP_W, MAP_H, o)).toEqual({ x: 40, y: 32 - VH / 2 });
    expect(aimAnchor(1, 1, VW, VH, MAP_W, MAP_H, o)).toEqual({ x: 8, y: VH / 2 });
    // 창이 맵보다 크면(확대 1) 늘 맵 가운데
    expect(aimAnchor(3, 30, 48, 32, MAP_W, MAP_H, o)).toEqual({ x: 24, y: 16 });
  });
});

describe('실제 카메라와 함께: 마우스를 가만히 두고 걸을 때 보낸 조준 = 화면의 괴물 → 커서 방향', () => {
  const balance = loadTestBalance();
  const k = 89; // 화면 px / 타일 (확대 3 PC 근처, 값 자체는 상관없다)
  /** 창 + 커서(화면 px) → 커서 월드 자리(타일) */
  const cursorWorld = (
    view: { x: number; y: number },
    c: { x: number; y: number },
  ): { x: number; y: number } => ({
    x: view.x + c.x / k,
    y: view.y + c.y / k,
  });
  const walk = (start: { x: number; y: number }, step: { x: number; y: number }, n: number) => {
    const d = new CameraDirector(VW, VH);
    const hold = new AimHold();
    const me = { x: start.x, y: start.y, face: -Math.PI / 2 };
    const input = (): DirectorInput => ({
      nowMs: 0,
      dtMs: 1000 / 60,
      role: 'monster',
      selfId: 'm',
      me,
      myStatus: null,
      survivors: new Map(),
      team: [],
      balance,
      blend: 0,
      viewW: VW,
      viewH: VH,
      devPerTile: k,
    });
    let view = d.update(input());
    for (let i = 0; i < 120; i += 1) view = d.update(input());
    // 커서: 화면에 그려진 괴물 3타일 위 (화면 px)
    const screen = { x: (me.x - view.x) * k, y: (me.y - 3 - view.y) * k };
    const pointer = { x: 1, y: 1 };
    const anchor = { x: 0, y: 0 };
    let aim = hold.update(
      pointer,
      cursorWorld(view, screen),
      me,
      aimAnchor(me.x, me.y, VW, VH, MAP_W, MAP_H, anchor),
      0.05,
      me.face,
    );
    const errs: number[] = [];
    for (let i = 0; i < n; i += 1) {
      me.x += step.x;
      me.y += step.y;
      me.face = aim;
      view = d.update(input());
      aim = hold.update(
        pointer,
        cursorWorld(view, screen),
        me,
        aimAnchor(me.x, me.y, VW, VH, MAP_W, MAP_H, anchor),
        0.05,
        me.face,
      );
      const cw = cursorWorld(view, screen);
      const seen = Math.atan2(cw.y - me.y, cw.x - me.x);
      errs.push(Math.abs(Math.atan2(Math.sin(aim - seen), Math.cos(aim - seen))));
    }
    // 걷기가 끝나고 카메라가 따라잡은 뒤
    for (let i = 0; i < 120; i += 1) {
      me.face = aim;
      view = d.update(input());
      aim = hold.update(
        pointer,
        cursorWorld(view, screen),
        me,
        aimAnchor(me.x, me.y, VW, VH, MAP_W, MAP_H, anchor),
        0.05,
        me.face,
      );
    }
    const cw = cursorWorld(view, screen);
    const seen = Math.atan2(cw.y - me.y, cw.x - me.x);
    // 예전 방식(방향만 붙잡기)이면 처음 방향 그대로였다
    const held = -Math.PI / 2;
    return {
      aim,
      settledErr: Math.abs(Math.atan2(Math.sin(aim - seen), Math.cos(aim - seen))),
      oldErr: Math.abs(Math.atan2(Math.sin(held - seen), Math.cos(held - seen))),
      errs,
    };
  };

  it('맵 끝(괴물 시작 자리 근처)에서 서쪽으로 5타일: 다 걸은 뒤 조준이 커서 쪽이다 (예전 방식은 59° 어긋났다)', () => {
    const r = walk({ x: 45, y: 25 }, { x: -5 / 300, y: 0 }, 300);
    // 남는 차이는 조준이 돌며 앞당김이 창을 옮긴 만큼뿐이다(앞당김은 되먹임을 막으려 일부러 뺀다)
    expect(r.settledErr).toBeLessThan((7 * Math.PI) / 180);
    expect(r.oldErr).toBeGreaterThan((50 * Math.PI) / 180);
  });

  it('맵 가운데에서 걸으면 조준이 그대로다 (화면의 커서와도 맞는다)', () => {
    const r = walk({ x: 20, y: 16 }, { x: -5 / 300, y: 0 }, 300);
    expect(r.aim).toBeCloseTo(-Math.PI / 2, 6);
    expect(r.settledErr).toBeLessThan(0.02);
  });
});

// 괴물 마우스 조준 붙잡기 (따라가는 카메라): 커서가 움직였을 때만 방향을 다시 재고, 카메라만 움직이면(앞당김 · 따라가기 ·
// 흔들림 → 커서 아래 월드 자리가 바뀐다) 마지막 방향을 그대로 둔다
import { describe, expect, it } from 'vitest';
import { AimHold } from '../../client/src/aimHold';

describe('AimHold', () => {
  it('커서가 그대로면 화면이 움직여도(커서 아래 자리 · 괴물 그림 자리가 바뀌어도) 방향이 같다', () => {
    const a = new AimHold();
    const pointer = { x: 500, y: 300 };
    const first = a.update(pointer, { x: 600, y: 300 }, { x: 400, y: 300 }, 2, 1);
    expect(first).toBeCloseTo(0, 9);
    // 카메라가 앞당겨져 그려진 괴물이 커서 쪽으로 다가가고 커서 아래 월드 자리도 바뀐다
    for (let i = 1; i <= 30; i += 1) {
      const got = a.update(pointer, { x: 600 + i * 3, y: 300 - i * 2 }, { x: 400 + i * 5, y: 300 + i }, 2, 1);
      expect(got).toBe(first);
    }
    expect(a.held).toBe(30);
  });

  it('커서가 움직이면 그 자리에서 다시 잰다', () => {
    const a = new AimHold();
    a.update({ x: 500, y: 300 }, { x: 600, y: 300 }, { x: 400, y: 300 }, 2, 1);
    const got = a.update({ x: 500, y: 301 }, { x: 400, y: 500 }, { x: 400, y: 300 }, 2, 1);
    expect(got).toBeCloseTo(Math.PI / 2, 9);
    expect(a.held).toBe(0);
  });

  it('커서가 괴물 몸 위면 지난 방향, 처음이면 지금 바라보는 방향', () => {
    const a = new AimHold();
    expect(a.update({ x: 1, y: 1 }, { x: 400.5, y: 300 }, { x: 400, y: 300 }, 2, 0.7)).toBe(0.7);
    a.update({ x: 2, y: 2 }, { x: 400, y: 200 }, { x: 400, y: 300 }, 2, 0.7);
    expect(a.update({ x: 3, y: 3 }, { x: 401, y: 300 }, { x: 400, y: 300 }, 2, 0.7)).toBeCloseTo(
      -Math.PI / 2,
      9,
    );
  });

  it('reset 뒤에는 커서 자리가 같아도 다시 잰다 (새 판)', () => {
    const a = new AimHold();
    const pointer = { x: 500, y: 300 };
    a.update(pointer, { x: 600, y: 300 }, { x: 400, y: 300 }, 2, 1);
    a.reset();
    expect(a.update(pointer, { x: 400, y: 100 }, { x: 400, y: 300 }, 2, 1)).toBeCloseTo(-Math.PI / 2, 9);
  });
});

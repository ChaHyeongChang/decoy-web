// 터치 판 시작 전 크기 자리 잡기 (MOBILE_PLAN M12 1번, render/settle.ts — main.ts settleViewport가 쓴다, 검토 #3 · #22).
// 가짜 시계 · 타이머 · 세로 여부로 본다: 정지 100ms · 최대 300ms, 세로 안내가 덮는 동안은 세지 않고 가로가 된 때부터 다시 센다
import { describe, expect, it } from 'vitest';
import { SETTLE_MAX_MS, SETTLE_QUIET_MS, settleSize, type SettleEnv } from '../../client/src/render/settle';
import { layoutFor } from '../../client/src/ui/layout';

interface Size {
  width: number;
  height: number;
}

/** 가짜 창: 시계(ms) · 타이머 · 크기 · 세로 안내(device.portrait와 그 구독) */
function harness(width: number, height: number, portrait = false) {
  let t = 0;
  let size: Size = { width, height };
  let turned = portrait;
  const timers: { at: number; fn: () => void }[] = [];
  const turns = new Set<() => void>();
  let doneAt: number | null = null;
  let doneSize: Size | null = null;
  const env: SettleEnv = {
    size: () => size,
    portrait: () => turned,
    onTurn: (fn) => {
      turns.add(fn);
      return () => turns.delete(fn);
    },
    now: () => t,
    later: (fn, ms) => {
      const timer = { at: t + ms, fn };
      timers.push(timer);
      return () => {
        const i = timers.indexOf(timer);
        if (i >= 0) timers.splice(i, 1);
      };
    },
  };
  const stop = settleSize(env, () => {
    expect(doneAt, '한 번만 끝난다').toBeNull();
    doneAt = t;
    doneSize = { ...size };
  });
  /** 시계를 to(ms)까지 돌린다 (그 사이 타이머는 시각 순서대로) */
  const advance = (to: number): void => {
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const next = timers[0];
      if (!next || next.at > to) break;
      timers.shift();
      t = next.at;
      next.fn();
    }
    t = to;
  };
  return {
    stop,
    advance,
    resize: (w: number, h: number): void => {
      size = { width: w, height: h };
    },
    /** 돌린다: 크기가 바뀌고 세로 여부가 바뀌었으면 구독자에게 알린다 (device.ts처럼 살아 있는 Set을 돈다) */
    turn: (w: number, h: number, p: boolean): void => {
      size = { width: w, height: h };
      if (p === turned) return;
      turned = p;
      for (const fn of turns) fn();
    },
    doneAt: (): number | null => doneAt,
    doneSize: (): Size | null => doneSize,
    timers: (): number => timers.length,
    listeners: (): number => turns.size,
  };
}

describe('판 시작 전 크기 자리 잡기 (settleSize)', () => {
  it('가로로 그대로면 정지 시간(100ms)이 지나야 끝난다', () => {
    expect([SETTLE_QUIET_MS, SETTLE_MAX_MS]).toEqual([100, 300]);
    const h = harness(863, 360);
    h.advance(SETTLE_QUIET_MS - 1);
    expect(h.doneAt()).toBeNull();
    h.advance(SETTLE_QUIET_MS + 16);
    expect(h.doneAt()).toBeGreaterThanOrEqual(SETTLE_QUIET_MS);
    expect(h.timers()).toBe(0);
  });

  it('주소창 · 전체 화면 전환 중(863×360 → 915×412, 50ms)이면 바뀐 때부터 100ms를 다시 세고, 끝난 크기의 화면비로 배치한다', () => {
    const h = harness(863, 360);
    h.advance(50);
    h.resize(915, 412);
    h.advance(50 + SETTLE_QUIET_MS - 1);
    expect(h.doneAt()).toBeNull();
    h.advance(SETTLE_MAX_MS);
    expect(h.doneAt()).toBeGreaterThanOrEqual(50 + SETTLE_QUIET_MS);
    expect(h.doneSize()).toEqual({ width: 915, height: 412 });
    const l = layoutFor(915, 412, true);
    expect(l.viewW / l.viewH).toBeCloseTo(915 / 412, 2);
  });

  it('가로에서 크기가 계속 바뀌면 최대 300ms에 끝난다', () => {
    const h = harness(800, 360);
    for (let ms = 40; ms < 600; ms += 40) {
      h.advance(ms);
      h.resize(800 + ms, 360);
    }
    expect(h.doneAt()).toBeGreaterThanOrEqual(SETTLE_MAX_MS);
    expect(h.doneAt()).toBeLessThan(SETTLE_MAX_MS + 17);
  });

  it('세로 안내가 덮는 동안에는 300ms가 지나도 끝나지 않고, 타이머 없이 가로 전환만 기다린다', () => {
    const h = harness(412, 915, true);
    h.advance(10_000);
    expect(h.doneAt()).toBeNull();
    expect(h.timers()).toBe(0);
    expect(h.listeners()).toBe(1);
  });

  it('세로로 시작해 1초 뒤 가로로 돌리면 그때부터 정지 100ms를 다시 센다 (300ms에 세로 크기로 끝나지 않는다)', () => {
    const h = harness(412, 915, true);
    h.advance(1000);
    h.turn(915, 412, false);
    expect(h.listeners()).toBe(0);
    h.advance(1000 + SETTLE_QUIET_MS - 1);
    expect(h.doneAt()).toBeNull();
    h.advance(2000);
    expect(h.doneAt()).toBeGreaterThanOrEqual(1000 + SETTLE_QUIET_MS);
    expect(h.doneAt()).toBeLessThan(1000 + SETTLE_QUIET_MS + 17);
    expect(h.doneSize()).toEqual({ width: 915, height: 412 });
  });

  it('세로 크기는 가로를 뒤집은 값이 아니다 (412×787 → 867×332): 가로 크기로 정해 touchWide · 그 화면비', () => {
    const h = harness(412, 787, true);
    h.advance(2000);
    h.turn(867, 332, false);
    h.advance(3000);
    const s = h.doneSize();
    expect(s).toEqual({ width: 867, height: 332 });
    const l = layoutFor(s?.width ?? 0, s?.height ?? 0, true);
    expect(l.kind).toBe('touchWide');
    expect(l.viewW / l.viewH).toBeCloseTo(867 / 332, 2);
    // 세로 크기로 정했다면 화면비가 다른 touchNarrow였다 (검토 #3)
    expect(layoutFor(412, 787, true).kind).toBe('touchNarrow');
  });

  it('가로로 세는 중에 세로가 되면 멈췄다가 다시 가로가 된 때부터 처음부터 센다', () => {
    const h = harness(915, 412);
    h.advance(50);
    h.turn(412, 915, true);
    h.advance(400);
    expect(h.doneAt()).toBeNull();
    expect(h.timers()).toBe(0);
    h.turn(915, 412, false);
    h.advance(400 + SETTLE_QUIET_MS - 1);
    expect(h.doneAt()).toBeNull();
    h.advance(1000);
    expect(h.doneAt()).toBeGreaterThanOrEqual(400 + SETTLE_QUIET_MS);
  });

  it('세로 안내가 없는 세로 모양 창(?touch=1 PC 좁은 창)은 기다리지 않고 최대 300ms에 끝난다', () => {
    const h = harness(500, 800, false);
    h.advance(SETTLE_MAX_MS - 1);
    expect(h.doneAt()).toBeNull();
    h.advance(SETTLE_MAX_MS + 16);
    expect(h.doneAt()).toBeGreaterThanOrEqual(SETTLE_MAX_MS);
  });

  it('멈추면(로비 복귀 · 새 판) 끝나지 않고 구독 · 타이머가 남지 않는다', () => {
    const waiting = harness(412, 915, true);
    waiting.stop();
    expect(waiting.listeners()).toBe(0);
    waiting.turn(915, 412, false);
    waiting.advance(2000);
    expect(waiting.doneAt()).toBeNull();

    const counting = harness(915, 412);
    counting.advance(50);
    counting.stop();
    expect(counting.timers()).toBe(0);
    counting.advance(2000);
    expect(counting.doneAt()).toBeNull();
  });
});

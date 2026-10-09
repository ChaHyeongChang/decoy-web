// 화면 배치 (M12 계약): PC는 언제나 1920×1080 · 지금 HUD 그대로, 배치를 적용하면 라이브 바인딩이 모두 바뀐다
import { afterEach, describe, expect, it } from 'vitest';
import { MAP_H, MAP_W, TILE_PX } from '@decoy/shared';
import * as L from '../../client/src/ui/layout';

afterEach(() => L.applyLayout(L.pcLayout()));

describe('PC 배치', () => {
  it('M11까지의 값과 같다 (1920×1080, 띠 64, 맵 가운데)', () => {
    const p = L.pcLayout();
    expect(p).toMatchObject({ kind: 'pc', viewW: 1920, viewH: 1080, hudBand: 64, mapY: 64, uiScale: 1 });
    expect(L.MAP_SCALE).toBeCloseTo(952 / (MAP_H * TILE_PX), 12);
    expect(p.mapX).toBeCloseTo((1920 - MAP_W * TILE_PX * L.MAP_SCALE) / 2, 9);
    expect(L.HUD.timer).toEqual({ x: 960, y: 32, w: 156, h: 44 });
    expect(L.HUD_RECTS.bottomBand).toEqual({ x: 0, y: 1016, w: 1920, h: 64 });
  });

  it('터치가 아니면 화면 크기와 상관없이 PC 배치', () => {
    const screens: [number, number][] = [
      [1920, 1080],
      [915, 412],
      [640, 360],
      [412, 915],
      [3840, 1600],
    ];
    for (const [w, h] of screens) {
      expect(L.layoutFor(w, h, false)).toEqual(L.pcLayout());
      expect(L.configureLayout(w, h, false)).toEqual(L.pcLayout());
    }
  });
});

describe('배치 적용', () => {
  it('라이브 바인딩(VIEW · MAP · HUD)이 모두 새 값을 본다', () => {
    L.applyLayout({ kind: 'touchWide', viewW: 2114, viewH: 952, mapX: 343, mapY: 0, hudBand: 0, uiScale: 2 });
    expect([L.VIEW_W, L.VIEW_H, L.MAP_X, L.MAP_Y, L.HUD_BAND, L.SIDE_W]).toEqual([2114, 952, 343, 0, 0, 343]);
    expect(L.MAP_RECT).toMatchObject({ x: 343, y: 0 });
    expect(L.MAP_RECT.w).toBeCloseTo(L.MAP_DRAW_W, 9);
    expect(L.layout().kind).toBe('touchWide');
    expect(L.tileToScreen(0, 0)).toEqual({ x: 343, y: 0 });
    expect(L.screenToTile(343 + TILE_PX * L.MAP_SCALE, 0)).toEqual({ x: 1, y: 0 });
    expect(L.HUD_RECTS.rightSide.x).toBe(2114 - 343);
  });

  it('맵 배율은 어떤 배치에서도 같다', () => {
    const before = L.MAP_SCALE;
    L.applyLayout({
      kind: 'touchNarrow',
      viewW: 1934,
      viewH: 1088,
      mapX: 253,
      mapY: 68,
      hudBand: 68,
      uiScale: 2,
    });
    expect(L.MAP_SCALE).toBe(before);
    expect(L.MAP_RECT.h).toBeCloseTo(L.MAP_DRAW_H, 9);
  });
});

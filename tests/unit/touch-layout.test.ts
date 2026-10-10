// 터치 화면 배치 (M11, MOBILE_PLAN M11 4번): 모든 터치 대상 48px 이상 · 서로 8px 이상 · 화면 안 · 가장자리 띠 밖,
// 이동 스틱은 왼쪽 40% 안, 생존자는 조준 스틱이 없다. 가장자리 띠에서 시작한 터치는 무시, 스틱 값은 길이 1로 자른다
import { describe, expect, it } from 'vitest';
import { BTN } from '../../shared/src/types';
import { TouchInput } from '../../client/src/touchInput';
import {
  EDGE_BAND,
  MIN_GAP,
  MIN_TARGET,
  MOVE_ZONE_RATIO,
  inEdgeBand,
  stickCenter,
  stickVector,
  touchLayout,
  type Box,
  type Insets,
} from '../../client/src/ui/touchControls';

/** 휴대폰 가로(높이 293~412) · 태블릿 가로 · 브라우저 창 (Playwright 기기 목록의 가로 크기) */
const SCREENS: [string, number, number][] = [
  ['iPhone SE', 568, 320],
  ['Galaxy S9+', 658, 320],
  ['iPhone 12', 750, 340],
  ['Pixel 5', 802, 293],
  ['Pixel 7 브라우저', 863, 360],
  ['Pixel 7 전체 화면', 915, 412],
  ['Galaxy S8', 740, 360],
  ['Galaxy Tab S9', 1024, 640],
  ['iPad Pro 11', 1194, 834],
];
const INSETS: Insets[] = [
  { l: 0, r: 0, t: 0, b: 0 },
  // 노치 쪽 안전 영역 (가로로 돌린 아이폰 · 펀치 홀)
  { l: 44, r: 44, t: 0, b: 21 },
];

/** 두 사각형 사이 간격 (겹치면 음수) */
function gapOf(a: Box, b: Box): number {
  const gx = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));
  const gy = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));
  return Math.max(gx, gy);
}

function targets(L: ReturnType<typeof touchLayout>): [string, Box][] {
  const out: [string, Box][] = [['move-zone', L.zone]];
  if (L.aim) out.push(['aim-stick', L.aim]);
  for (const [id, b] of Object.entries(L.buttons)) if (b) out.push([id, b]);
  return out;
}

describe('터치 화면 배치 touchLayout', () => {
  for (const [name, w, h] of SCREENS)
    for (const inset of INSETS)
      for (const monster of [true, false])
        for (const fullscreen of [true, false])
          it(`${name} ${w}×${h} 안전 영역 ${inset.l}/${inset.b} ${monster ? '괴물' : '생존자'}${fullscreen ? ' + 전체 화면' : ''}`, () => {
            const L = touchLayout(w, h, inset, monster, fullscreen);
            const all = targets(L);
            for (const [id, b] of all) {
              expect(b.w, `${id} 폭`).toBeGreaterThanOrEqual(MIN_TARGET);
              expect(b.h, `${id} 높이`).toBeGreaterThanOrEqual(MIN_TARGET);
              // 화면 안 + 가장자리 띠 밖 (좌우 안전 영역 + 32px, 아래 + 24px)
              expect(b.x, `${id} 왼쪽`).toBeGreaterThanOrEqual(inset.l + EDGE_BAND.side);
              expect(b.x + b.w, `${id} 오른쪽`).toBeLessThanOrEqual(w - inset.r - EDGE_BAND.side);
              expect(b.y, `${id} 위`).toBeGreaterThanOrEqual(inset.t);
              expect(b.y + b.h, `${id} 아래`).toBeLessThanOrEqual(h - inset.b - EDGE_BAND.bottom);
            }
            for (let i = 0; i < all.length; i += 1)
              for (let j = i + 1; j < all.length; j += 1) {
                const [ia, a] = all[i]!;
                const [ib, b] = all[j]!;
                expect(gapOf(a, b), `${ia} · ${ib} 간격`).toBeGreaterThanOrEqual(MIN_GAP);
              }
            // 이동 스틱 생성 영역은 왼쪽 40% 안, 손가락이 없을 때 보이는 스틱 원은 영역 안에 다 들어간다
            expect(L.zone.x + L.zone.w).toBeLessThanOrEqual(Math.round(w * MOVE_ZONE_RATIO));
            expect(L.moveHome.x - L.moveR).toBeGreaterThanOrEqual(L.zone.x);
            expect(L.moveHome.y + L.moveR).toBeLessThanOrEqual(L.zone.y + L.zone.h);
            // 역할별 버튼
            const ids = Object.keys(L.buttons).sort();
            const want = monster
              ? ['dash', 'mode', 'roar', 'scoreboard']
              : ['ability', 'rescue', 'scoreboard'];
            expect(ids).toEqual([...want, ...(fullscreen ? ['fullscreen'] : [])].sort());
            expect(L.aim === null).toBe(!monster);
            // 엄지 자리: 조준 스틱 · 능력이 오른쪽 아래 구석
            const thumb = (monster ? L.aim : L.buttons.ability)!;
            expect(thumb.x + thumb.w).toBeGreaterThan(w - inset.r - EDGE_BAND.side - 12);
            expect(thumb.y + thumb.h).toBeGreaterThan(h - inset.b - EDGE_BAND.bottom - 12);
            // 돌진 끌기 반지름 · 스틱 반지름도 손가락 크기 이상
            expect(L.dashR).toBeGreaterThanOrEqual(40);
            expect(L.moveR).toBeGreaterThanOrEqual(48);
          });

  it('큰 화면이라고 버튼을 손가락보다 한참 크게 키우지 않는다 (dp = 손가락 크기)', () => {
    const phone = touchLayout(863, 360, INSETS[0]!, true, false);
    const tablet = touchLayout(1194, 834, INSETS[0]!, true, false);
    expect(tablet.buttons.dash!.w / phone.buttons.dash!.w).toBeLessThanOrEqual(1.15);
    expect(tablet.aim!.w / phone.aim!.w).toBeLessThanOrEqual(1.15);
  });

  it('전체 화면 버튼: 판 화면 옆 빈 띠가 넓으면 점수판 아래, 아니면 점수판 왼쪽', () => {
    const wide = touchLayout(863, 360, INSETS[0]!, true, true);
    expect(wide.buttons.fullscreen!.x).toBe(wide.buttons.scoreboard!.x);
    expect(wide.buttons.fullscreen!.y).toBeGreaterThan(wide.buttons.scoreboard!.y);
    const tablet = touchLayout(1024, 640, INSETS[0]!, true, true);
    expect(tablet.buttons.fullscreen!.y).toBe(tablet.buttons.scoreboard!.y);
    expect(tablet.buttons.fullscreen!.x).toBeLessThan(tablet.buttons.scoreboard!.x);
  });
});

describe('가로 180° 뒤집기 (M12 검토): 안전 영역이 왼쪽 48 → 오른쪽 48로 바뀌면 배치도 좌우로 옮겨진다', () => {
  for (const [name, w, h] of SCREENS)
    for (const monster of [true, false])
      it(`${name} ${monster ? '괴물' : '생존자'}`, () => {
        const a = touchLayout(w, h, { l: 48, r: 0, t: 0, b: 0 }, monster, false);
        const b = touchLayout(w, h, { l: 0, r: 48, t: 0, b: 0 }, monster, false);
        // 안전 사각형은 좌우 대칭
        expect(b.safe).toEqual({ ...a.safe, x: w - (a.safe.x + a.safe.w) });
        // 오른쪽 엄지 무리 · 점수판은 48px 왼쪽으로 (크기 그대로)
        const shifted = (r: Box): Box => ({ ...r, x: r.x - 48 });
        if (monster) expect(b.aim).toEqual(shifted(a.aim!));
        for (const [id, r] of Object.entries(a.buttons))
          expect(b.buttons[id as keyof typeof a.buttons], id).toEqual(shifted(r));
        // 이동 영역은 새 왼쪽 띠(32px)에서 시작하고 오른쪽 끝(화면 40%)은 그대로
        expect([a.zone.x, b.zone.x]).toEqual([48 + EDGE_BAND.side, EDGE_BAND.side]);
        expect(b.zone.x + b.zone.w).toBe(a.zone.x + a.zone.w);
        expect(b.moveHome.x).toBe(a.moveHome.x - 48);
        // 카메라 구멍 쪽 띠에서 시작한 터치는 무시하고, 반대쪽은 받는다
        for (const [x, inA, inB] of [
          [60, true, false],
          [w - 60, false, true],
        ] as const) {
          expect(inEdgeBand(x, h / 2, a.safe), `${x}`).toBe(inA);
          expect(inEdgeBand(x, h / 2, b.safe), `${x}`).toBe(inB);
        }
      });
});

describe('가장자리 띠에서 시작한 터치는 무시 inEdgeBand', () => {
  const L = touchLayout(863, 360, { l: 0, r: 0, t: 0, b: 0 }, true, false);
  it('왼쪽 · 오른쪽 32px, 아래 24px 띠 안이면 무시', () => {
    expect(inEdgeBand(10, 180, L.safe)).toBe(true);
    expect(inEdgeBand(31.5, 180, L.safe)).toBe(true);
    expect(inEdgeBand(863 - 20, 180, L.safe)).toBe(true);
    expect(inEdgeBand(400, 360 - 10, L.safe)).toBe(true);
    expect(inEdgeBand(400, 360 - 23.5, L.safe)).toBe(true);
  });
  it('안쪽이면 받는다', () => {
    expect(inEdgeBand(32, 180, L.safe)).toBe(false);
    expect(inEdgeBand(400, 180, L.safe)).toBe(false);
    expect(inEdgeBand(863 - 32, 360 - 24, L.safe)).toBe(false);
  });
  it('안전 영역(노치)이 있으면 그만큼 더 안쪽부터', () => {
    const N = touchLayout(863, 360, { l: 44, r: 0, t: 0, b: 21 }, true, false);
    expect(inEdgeBand(60, 180, N.safe)).toBe(true);
    expect(inEdgeBand(77, 180, N.safe)).toBe(false);
    expect(inEdgeBand(400, 360 - 40, N.safe)).toBe(true);
  });
});

describe('스틱 값 stickVector', () => {
  it('반지름 안은 거리 / 반지름 그대로, 밖은 방향을 지키며 길이 1', () => {
    expect(stickVector(30, 0, 60)).toEqual({ x: 0.5, y: 0 });
    expect(stickVector(0, -60, 60)).toEqual({ x: 0, y: -1 });
    const v = stickVector(300, 400, 50);
    expect(Math.hypot(v.x, v.y)).toBeCloseTo(1, 9);
    expect(v.x / v.y).toBeCloseTo(0.75, 9);
    expect(stickVector(0, 0, 60)).toEqual({ x: 0, y: 0 });
  });
});

describe('스틱 중심 (M11 검토): 돌진은 누른 자리, 조준 스틱은 고정 중심', () => {
  const L = touchLayout(844, 390, { l: 0, r: 0, t: 0, b: 0 }, true, false);
  const dash = L.buttons.dash;
  if (!dash || !L.aim) throw new Error('괴물 배치에 돌진 · 조준 스틱이 없음');
  const off = { x: dash.x + dash.w / 2 + 15, y: dash.y + dash.h / 2 };

  it('돌진 버튼 가운데에서 15px 벗어난 탭: 중심이 누른 자리라 끌기로 잡히지 않는다', () => {
    const c = stickCenter('dash', L, off.x, off.y);
    expect(c).toEqual(off);
    expect(stickVector(off.x - c.x, off.y - c.y, L.dashR)).toEqual({ x: 0, y: 0 });
  });

  it('그대로 떼면 다음 프레임에 지금 방향으로 돌진 1번, 조준은 돌지 않는다', () => {
    const t = new TouchInput();
    const c = stickCenter('dash', L, off.x, off.y);
    const v = stickVector(off.x - c.x, off.y - c.y, L.dashR);
    const face = Math.PI / 2;
    t.stickStart(1, 'dash', 0);
    t.stickMove(1, v.x, v.y);
    t.stickEnd(1, 80);
    const ctx = { nowMs: 100, face, canAttack: true, canDash: true };
    const pressed = t.takePressed(ctx);
    expect(pressed & BTN.DASH).toBe(BTN.DASH);
    const aim = t.aimAngle(ctx);
    expect(aim === null || Math.abs(aim - face) < 1e-9).toBe(true);
  });

  it('조준 스틱은 누른 자리와 상관없이 요소 가운데가 중심', () => {
    const a = L.aim!;
    expect(stickCenter('aim', L, a.x + 3, a.y + 4)).toEqual({ x: a.x + a.w / 2, y: a.y + a.h / 2 });
    expect(stickCenter('move', L, 120, 200)).toEqual({ x: 120, y: 200 });
  });
});

// 조작 배치 (설정 화면 통합 · 조작 배치 편집, client/src/controlLayout.ts + touchControls.touchLayout opts):
// 저장 형식(역할 따로 · 기본은 저장 안 함 · 엄한 검사) · 비율 좌표 왕복 · 화면비(16:9 · 20:9 · 21:9 · 4:3) · 회전 · 좌우 반전 ·
// 범위 안 · 겹침 막기(이름표까지) · HUD 피하기 · 정해진 밀어내기 · 기본 배치로 돌아가기 · 크기 하한 48px · 이동 영역이 스틱을 따라감 ·
// thumbAvoidBoxes가 옮긴 자리를 따름 · effectiveTouchLayout이 저장값을 읽음
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CAP_BELOW,
  CONTROL_IDS,
  SIZE_SCALE,
  boxAt,
  blockersOf,
  clampScale,
  flipItems,
  isDefaultLayout,
  loadControlLayout,
  loadControlLayouts,
  matchTuning,
  minScale,
  moveRange,
  occupied,
  parseControlLayout,
  placeOf,
  ratioOf,
  resolveLayout,
  saveControlLayouts,
  separated,
  serializeControlLayout,
  type Box,
  type ControlBoxes,
  type ControlId,
  type PlaceRules,
  type TeamLayout,
} from '../../client/src/controlLayout';
import type { StorageLike } from '../../client/src/storageKeys';
import * as Lay from '../../client/src/ui/layout';
import {
  EDGE_BAND,
  MIN_GAP,
  MIN_TARGET,
  MOVE_ZONE_RATIO,
  controlBoxes,
  effectiveTouchLayout,
  hudPreview,
  thumbAvoidBoxes,
  touchLayout,
  type Insets,
  type TouchLayout,
} from '../../client/src/ui/touchControls';

function mem(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

const broken: StorageLike = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('quota');
  },
  removeItem: () => {
    throw new Error('blocked');
  },
};

const KEY = 'decoy:controlLayout';
const NO_INSET: Insets = { l: 0, r: 0, t: 0, b: 0 };

afterEach(() => Lay.applyLayout(Lay.pcLayout()));

describe('저장 형식 (decoy:controlLayout)', () => {
  it('기본 배치는 저장하지 않는다: 두 역할 다 기본이면 null(키 지움), 바꾼 역할만 적는다', () => {
    expect(serializeControlLayout({ survivor: null, monster: null })).toBeNull();
    expect(serializeControlLayout({ survivor: { mirror: false, items: {} }, monster: null })).toBeNull();
    const raw = serializeControlLayout({
      survivor: { mirror: true, items: {} },
      monster: { mirror: false, items: { attack: { u: 0.123456, v: 1, s: 1.234 } } },
    });
    expect(JSON.parse(raw!)).toEqual({
      v: 1,
      survivor: { mirror: true, items: {} },
      monster: { mirror: false, items: { attack: { u: 0.1235, v: 1, s: 1.23 } } },
    });
  });

  it('왕복: 저장 → 읽기 (역할 따로)', () => {
    const st = mem();
    const s: TeamLayout = { mirror: false, items: { ability: { u: 0.5, v: 0.25, s: 1.2 } } };
    const m: TeamLayout = {
      mirror: true,
      items: { move: { u: 0.9, v: 1, s: 1 }, roar: { u: 0, v: 0, s: 0.8 } },
    };
    expect(saveControlLayouts({ survivor: s, monster: m }, st)).toBe(true);
    expect(loadControlLayouts(st)).toEqual({ survivor: s, monster: m });
    expect(loadControlLayout('survivor', st)).toEqual(s);
    expect(loadControlLayout('monster', st)).toEqual(m);
  });

  it('두 역할 다 기본으로 저장하면 키를 지운다', () => {
    const st = mem();
    saveControlLayouts({ survivor: { mirror: true, items: {} }, monster: null }, st);
    expect(st.data.has(KEY)).toBe(true);
    expect(saveControlLayouts({ survivor: null, monster: { mirror: false, items: {} } }, st)).toBe(true);
    expect(st.data.has(KEY)).toBe(false);
  });

  it('저장소가 막히면 false (읽기는 기본)', () => {
    expect(saveControlLayouts({ survivor: { mirror: true, items: {} }, monster: null }, broken)).toBe(false);
    expect(loadControlLayouts(broken)).toEqual({ survivor: null, monster: null });
    expect(loadControlLayouts(null)).toEqual({ survivor: null, monster: null });
  });

  it('엄한 검사: 깨진 JSON · 다른 판 · 모양이 틀리면 기본, 틀린 칸만 버리고 범위 밖 수는 자른다', () => {
    const none = { survivor: null, monster: null };
    expect(parseControlLayout(null)).toEqual(none);
    expect(parseControlLayout('{')).toEqual(none);
    expect(parseControlLayout('[]')).toEqual(none);
    expect(parseControlLayout(JSON.stringify({ v: 2, survivor: { mirror: true, items: {} } }))).toEqual(none);
    const got = parseControlLayout(
      JSON.stringify({
        v: 1,
        survivor: {
          mirror: 'yes',
          items: {
            ability: { u: 1.7, v: -3, s: 9 },
            rescue: { u: 'x', v: 0.5 },
            attack: { u: 0.5, v: 0.5, s: 1 },
            nope: { u: 0.5, v: 0.5, s: 1 },
            scoreboard: { u: 0.2, v: 0.3 },
            menu: [1, 2],
            move: { u: 0.1, v: 0.9, s: 'big' },
          },
        },
        monster: { mirror: true, items: 'bad' },
        extra: 1,
      }),
    );
    expect(got).toEqual({
      survivor: {
        mirror: false,
        items: {
          ability: { u: 1, v: 0, s: SIZE_SCALE.max },
          scoreboard: { u: 0.2, v: 0.3, s: 1 },
        },
      },
      monster: { mirror: true, items: {} },
    });
    // 모두 버려져 기본이 되면 null
    expect(
      parseControlLayout(JSON.stringify({ v: 1, survivor: { items: { dash: { u: 0, v: 0 } } } })),
    ).toEqual(none);
  });

  it('isDefaultLayout: 반전 없음 · 바꾼 조작 없음 · 없음', () => {
    expect(isDefaultLayout(null)).toBe(true);
    expect(isDefaultLayout({ mirror: false, items: {} })).toBe(true);
    expect(isDefaultLayout({ mirror: true, items: {} })).toBe(false);
    expect(isDefaultLayout({ mirror: false, items: { move: { u: 0, v: 0, s: 1 } } })).toBe(false);
  });

  it('판 배치 조정: 그 역할 저장값의 좌우 반전 · 설정 버튼 칸 · 지금 설정 (기본 100% · 보통)', () => {
    const st = mem();
    saveControlLayouts({ survivor: null, monster: { mirror: true, items: {} } }, st);
    expect(matchTuning('monster', true, st)).toEqual({
      stickScale: 1,
      uiScale: 1,
      mirror: true,
      sysSlots: 3,
      team: 'monster',
    });
    expect(matchTuning('survivor', false, st)).toEqual({
      stickScale: 1,
      uiScale: 1,
      mirror: false,
      sysSlots: 2,
      team: 'survivor',
    });
  });
});

describe('비율 좌표', () => {
  const range: Box = { x: 38, y: 6, w: 720, h: 318 };

  it('사각형 → 비율 → 사각형 왕복 (정수 px라 1px 안, 같은 화면에서는 그대로)', () => {
    for (const [x, y, w, h] of [
      [38, 6, 60, 60],
      [400, 100, 78, 78],
      [758 - 66, 6, 66, 50],
      [123, 200, 120, 120],
    ] as const) {
      const b = { x, y, w, h };
      const r = ratioOf(b, range);
      expect(r.u).toBeGreaterThanOrEqual(0);
      expect(r.u).toBeLessThanOrEqual(1);
      expect(boxAt(r.u, r.v, w, h, range)).toEqual(b);
    }
  });

  it('u = 1이면 어느 화면에서나 오른쪽 끝, v = 1이면 아래 끝, 0이면 왼쪽 · 위 끝 (범위 안쪽 pad)', () => {
    for (const [w, h] of [
      [800, 360],
      [915, 412],
      [1080, 412],
      [1024, 768],
    ] as const) {
      const safe = touchLayout(w, h, NO_INSET, false, false).safe;
      const R = moveRange(safe, 6);
      const b = boxAt(1, 1, 78, 78, R);
      expect(b.x + b.w).toBe(safe.x + safe.w - 6);
      expect(b.y + b.h).toBe(safe.y + safe.h - 6);
      const a = boxAt(0, 0, 78, 78, R);
      expect([a.x, a.y]).toEqual([safe.x + 6, safe.y + 6]);
    }
  });

  it('범위가 사각형보다 좁으면 가운데(0.5), 비율은 0 ~ 1로 자른다', () => {
    expect(ratioOf({ x: 0, y: 0, w: 900, h: 400 }, range)).toEqual({ u: 0.5, v: 0.5 });
    expect(ratioOf({ x: -100, y: 999, w: 10, h: 10 }, range)).toEqual({ u: 0, v: 1 });
  });

  it('placeOf = 비율 + 크기 배율, flipItems = 좌우 뒤집기 (u → 1 − u)', () => {
    const p = placeOf({ x: 38, y: 324 - 60, w: 60, h: 60 }, 1.2, range);
    expect(p).toEqual({ u: 0, v: 1, s: 1.2 });
    expect(flipItems({ ability: { u: 0.25, v: 0.5, s: 1 } })).toEqual({ ability: { u: 0.75, v: 0.5, s: 1 } });
  });
});

describe('크기 배율', () => {
  it('하한은 0.8과 짧은 변 48px 중 큰 쪽, 상한 1.5', () => {
    expect(minScale({ x: 0, y: 0, w: 120, h: 120 })).toBe(SIZE_SCALE.min);
    expect(minScale({ x: 0, y: 0, w: 52, h: 52 })).toBeCloseTo(48 / 52, 9);
    expect(minScale({ x: 0, y: 0, w: 64, h: 48 })).toBe(1);
    expect(clampScale({ x: 0, y: 0, w: 52, h: 52 }, 0.5)).toBeCloseTo(48 / 52, 9);
    expect(clampScale({ x: 0, y: 0, w: 52, h: 52 }, 3)).toBe(1.5);
    expect(clampScale({ x: 0, y: 0, w: 52, h: 52 }, Number.NaN)).toBe(1);
  });
});

describe('겹침 규칙', () => {
  it('이름표가 버튼 아래로 나온 만큼(CAP_BELOW)까지 차지한다 (시스템 버튼은 그대로)', () => {
    const b = { x: 10, y: 10, w: 50, h: 50 };
    expect(occupied('ability', b)).toEqual({ ...b, h: 50 + CAP_BELOW });
    expect(occupied('move', b)).toEqual({ ...b, h: 50 + CAP_BELOW });
    expect(occupied('scoreboard', b)).toEqual(b);
    expect(occupied('menu', b)).toEqual(b);
  });

  it('separated: 한 축이라도 gap 이상 떨어져 있으면 참', () => {
    const a = { x: 0, y: 0, w: 10, h: 10 };
    expect(separated(a, { x: 18, y: 0, w: 10, h: 10 }, 8)).toBe(true);
    expect(separated(a, { x: 17.9, y: 0, w: 10, h: 10 }, 8)).toBe(false);
    expect(separated(a, { x: 0, y: 18, w: 10, h: 10 }, 8)).toBe(true);
  });
});

/** 화면 하나의 HUD (기본 설정 · 그 역할) + 기본 터치 배치 + 놓기 규칙 */
function screen(
  team: 'survivor' | 'monster',
  w: number,
  h: number,
  inset: Insets = NO_INSET,
  custom?: TeamLayout,
) {
  const hud = hudPreview(
    team,
    w,
    h,
    inset,
    Lay.cleanTuning({ sysSlots: 3, mirror: custom?.mirror === true }),
  );
  const boxes = hud.rects.map((r) => r.box);
  const L = touchLayout(w, h, inset, team === 'monster', true, boxes, {
    menu: true,
    custom: custom ?? null,
    viewRatio: hud.layout.viewW / hud.layout.viewH,
  });
  return { hud, boxes, L };
}

/** 터치 배치 규칙 (touch-layout.test와 같은 것 + 이름표 간격 + HUD): 문제 목록 */
function problems(L: TouchLayout, hud: readonly Box[], w: number, h: number, inset: Insets): string[] {
  const out: string[] = [];
  const b = controlBoxes(L);
  const ids = CONTROL_IDS.filter((id) => b[id]);
  for (const id of ids) {
    const r = b[id]!;
    if (id !== 'move' && (r.w < MIN_TARGET || r.h < MIN_TARGET)) out.push(`${id} 크기`);
    if (r.x < inset.l + EDGE_BAND.side - 0.01 || r.x + r.w > w - inset.r - EDGE_BAND.side + 0.01)
      out.push(`${id} 가로 띠`);
    if (r.y < inset.t - 0.01 || r.y + r.h > h - inset.b - EDGE_BAND.bottom + 0.01) out.push(`${id} 세로 띠`);
    for (const o of ids)
      if (o > id && !separated(occupied(id, r), occupied(o, b[o]!), MIN_GAP - 0.01)) out.push(`${id} ↔ ${o}`);
  }
  // 이동 고리는 이동 영역 안, 이동 영역은 스틱 쪽 40% 띠
  const ring = b.move!;
  const z = L.zone;
  if (ring.x < z.x - 0.01 || ring.y < z.y - 0.01 || ring.x + ring.w > z.x + z.w + 0.01)
    out.push('고리 ↔ 이동 영역');
  if (z.w > Math.round(w * MOVE_ZONE_RATIO) + 0.01) out.push('이동 영역 폭');
  void hud;
  return out;
}

describe('touchLayout + 조작 배치: 기본', () => {
  it('저장값이 없거나 기본이면 기본 배치 그대로 (같은 객체 모양)', () => {
    for (const custom of [null, undefined, { mirror: false, items: {} }]) {
      const a = touchLayout(800, 360, NO_INSET, true, true, [], { menu: true });
      const b = touchLayout(800, 360, NO_INSET, true, true, [], { menu: true, custom });
      expect(b).toEqual(a);
      expect(b.fallback).toBeUndefined();
    }
  });
});

describe('좌우 반전 (왼손잡이)', () => {
  for (const [w, h] of [
    [800, 360],
    [915, 412],
    [1080, 412],
    [658, 320],
    [1024, 768],
  ] as const)
    for (const team of ['survivor', 'monster'] as const)
      it(`${w}×${h} ${team}: 이동 영역 · 스틱 오른쪽, 엄지 버튼 왼쪽 아래, 시스템 버튼 왼쪽 위 — 규칙 그대로, HUD와 안 겹침`, () => {
        const { L, boxes } = screen(team, w, h, NO_INSET, { mirror: true, items: {} });
        const D = touchLayout(w, h, NO_INSET, team === 'monster', true, [], { menu: true });
        expect(L.fallback).toBeUndefined();
        expect(L.zone.x).toBe(w - Math.round(w * MOVE_ZONE_RATIO));
        expect(L.zone.x + L.zone.w).toBe(L.safe.x + L.safe.w);
        expect(L.moveHome.x).toBe(w - D.moveHome.x);
        const thumb = (team === 'monster' ? L.aim : L.buttons.ability)!;
        expect(thumb.x).toBe(L.safe.x + 6);
        expect(L.buttons.scoreboard!.x).toBe(L.safe.x + 6);
        expect(L.buttons.menu!.x).toBeGreaterThan(L.buttons.scoreboard!.x);
        expect(problems(L, boxes, w, h, NO_INSET)).toEqual([]);
        for (const [id, b] of Object.entries(controlBoxes(L)))
          for (const r of boxes)
            expect(separated(occupied(id as ControlId, b), r, 0), `${id} ↔ HUD`).toBe(true);
      });

  it('180° 뒤집기(안전 영역 좌우가 바뀜)에서도 반전 배치는 안전 사각형 안에서 같은 모양', () => {
    const a = touchLayout(800, 360, { l: 48, r: 0, t: 0, b: 0 }, false, false, [], {
      custom: { mirror: true, items: {} },
    });
    const b = touchLayout(800, 360, { l: 0, r: 48, t: 0, b: 0 }, false, false, [], {
      custom: { mirror: true, items: {} },
    });
    expect(b.buttons.ability).toEqual({ ...a.buttons.ability!, x: a.buttons.ability!.x - 48 });
    expect(b.moveHome.x).toBe(a.moveHome.x - 48);
  });
});

describe('옮긴 조작 (비율 자리)', () => {
  /** 생존자: 능력을 왼쪽 위로 크게, 구조를 오른쪽 가운데로 — 여러 화면비 · 회전에서 그 비율 자리 */
  const custom: TeamLayout = {
    mirror: false,
    items: { ability: { u: 0.7, v: 0.92, s: 1.2 }, rescue: { u: 1, v: 0.55, s: 1 } },
  };
  const SIZES: [string, number, number][] = [
    ['16:9 휴대폰 800×360(20:9)', 800, 360],
    ['Pixel 7 915×412', 915, 412],
    ['21:9 1080×412', 1080, 412],
    ['4:3 태블릿 1024×768', 1024, 768],
    ['16:9 960×540', 960, 540],
  ];
  for (const [name, w, h] of SIZES)
    it(`${name}: 비율 자리 그대로 · 규칙 지킴 · HUD 피함`, () => {
      const { L, boxes, hud } = screen('survivor', w, h, NO_INSET, custom);
      expect(L.fallback).toBeUndefined();
      const R = moveRange(L.safe, 6);
      const D = touchLayout(w, h, NO_INSET, false, true, boxes, {
        menu: true,
        viewRatio: hud.layout.viewW / hud.layout.viewH,
      });
      const a = L.buttons.ability!;
      const da = D.buttons.ability!;
      expect(a.w).toBe(Math.round(da.w * 1.2));
      const want = boxAt(0.7, 0.92, a.w, a.h, R);
      expect(a).toEqual(want);
      expect(L.buttons.rescue!.x + L.buttons.rescue!.w).toBe(L.safe.x + L.safe.w - 6);
      // 옮기지 않은 조작은 기본 자리
      expect(L.buttons.scoreboard).toEqual(D.buttons.scoreboard);
      expect(L.moveHome).toEqual(D.moveHome);
      expect(problems(L, boxes, w, h, NO_INSET)).toEqual([]);
      for (const [id, b] of Object.entries(controlBoxes(L)))
        for (const r of boxes)
          expect(separated(occupied(id as ControlId, b), r, 0), `${id} ↔ HUD`).toBe(true);
    });

  it('가로 180° 뒤집기: 같은 비율 → 안전 영역이 옮긴 만큼만 옮겨진다', () => {
    const a = touchLayout(800, 360, { l: 48, r: 0, t: 0, b: 0 }, false, false, [], { custom });
    const b = touchLayout(800, 360, { l: 0, r: 48, t: 0, b: 0 }, false, false, [], { custom });
    for (const id of ['ability', 'rescue', 'scoreboard'] as const)
      expect(b.buttons[id], id).toEqual({ ...a.buttons[id]!, x: a.buttons[id]!.x - 48 });
  });

  it('90° 세로로 돌렸다 돌아오기: 세로 크기는 긴 변을 폭으로 보아 같은 배치 (판은 가로에서만), 몇 번 돌려도 그대로', () => {
    const st = mem();
    const prev = (globalThis as { localStorage?: StorageLike }).localStorage;
    (globalThis as { localStorage?: StorageLike }).localStorage = st;
    try {
      saveControlLayouts({ survivor: custom, monster: null });
      const land = effectiveTouchLayout('survivor', 800, 360, NO_INSET, true);
      const port = effectiveTouchLayout('survivor', 360, 800, NO_INSET, true);
      expect(port).toEqual(land);
      // 비율 → px → 비율 → px (회전마다 다시 재도) 떠내려가지 않는다
      const R = moveRange(land.safe, 6);
      let box = land.buttons.ability!;
      for (let i = 0; i < 5; i += 1) {
        const r = ratioOf(box, R);
        box = boxAt(r.u, r.v, box.w, box.h, R);
      }
      expect(box).toEqual(land.buttons.ability);
    } finally {
      (globalThis as { localStorage?: StorageLike }).localStorage = prev;
    }
  });
});

describe('겹침 · HUD · 범위 막기와 밀어내기', () => {
  it('다른 조작 자리에 놓인 비율은 가장 가까운 빈자리로 민다 (이름표 간격까지, 늘 같은 결과)', () => {
    const D = touchLayout(800, 360, NO_INSET, false, true, [], { menu: true });
    const R = moveRange(D.safe, 6);
    // 능력을 구조 기본 자리에
    const rs = D.buttons.rescue!;
    const at = ratioOf({ ...rs, w: D.buttons.ability!.w, h: D.buttons.ability!.h }, R);
    const custom: TeamLayout = { mirror: false, items: { ability: { ...at, s: 1 } } };
    const a = touchLayout(800, 360, NO_INSET, false, true, [], { menu: true, custom });
    const b = touchLayout(800, 360, NO_INSET, false, true, [], { menu: true, custom });
    expect(a).toEqual(b);
    expect(a.fallback).toBeUndefined();
    expect(
      separated(occupied('ability', a.buttons.ability!), occupied('rescue', a.buttons.rescue!), MIN_GAP),
    ).toBe(true);
    expect(a.buttons.rescue).toEqual(rs);
    // 가까운 자리 (격자 반경 안)
    const want = boxAt(at.u, at.v, a.buttons.ability!.w, a.buttons.ability!.h, R);
    expect(Math.hypot(a.buttons.ability!.x - want.x, a.buttons.ability!.y - want.y)).toBeLessThan(140);
  });

  it('HUD 부품 위에 놓인 비율은 HUD 밖으로 민다', () => {
    const { boxes, L: D } = screen('survivor', 915, 412);
    const card = boxes[3]!; // card0 (왼쪽 칸)
    const R = moveRange(D.safe, 6);
    const ab = D.buttons.ability!;
    const at = ratioOf({ x: card.x, y: card.y, w: ab.w, h: ab.h }, R);
    const { L } = screen('survivor', 915, 412, NO_INSET, {
      mirror: false,
      items: { ability: { ...at, s: 1 } },
    });
    expect(L.fallback).toBeUndefined();
    for (const r of boxes) expect(separated(occupied('ability', L.buttons.ability!), r, MIN_GAP)).toBe(true);
  });

  it('큰 배율로 가장자리에 놓아도 안전 사각형(pad) 안으로 자른다', () => {
    const custom: TeamLayout = { mirror: false, items: { ability: { u: 1, v: 1, s: 1.5 } } };
    const L = touchLayout(640, 360, NO_INSET, false, false, [], { custom });
    const a = L.buttons.ability!;
    expect(a.x + a.w).toBeLessThanOrEqual(L.safe.x + L.safe.w - 6);
    expect(a.y + a.h).toBeLessThanOrEqual(L.safe.y + L.safe.h - 6);
  });

  it('놓을 자리가 없으면 기본 배치로 (반전이면 뒤집은 기본 배치), fallback 표시', () => {
    const wall = [{ x: 0, y: 0, w: 2000, h: 2000 }];
    const custom: TeamLayout = { mirror: false, items: { ability: { u: 0.5, v: 0.5, s: 1 } } };
    const L = touchLayout(800, 360, NO_INSET, false, false, wall, { custom });
    const D = touchLayout(800, 360, NO_INSET, false, false, wall);
    expect(L.fallback).toBe(true);
    expect(L.buttons).toEqual(D.buttons);
    const M = touchLayout(800, 360, NO_INSET, false, false, wall, { custom: { ...custom, mirror: true } });
    const MD = touchLayout(800, 360, NO_INSET, false, false, wall, { custom: { mirror: true, items: {} } });
    expect(M.fallback).toBe(true);
    expect(M.buttons).toEqual(MD.buttons);
    expect(M.zone.x).toBeGreaterThan(400);
  });

  it('크기를 줄여도 터치 대상 48px 이상 (시스템 버튼은 줄일 수 없다)', () => {
    const custom: TeamLayout = {
      mirror: false,
      items: { rescue: { u: 0.5, v: 0.5, s: 0.8 }, menu: { u: 0.5, v: 0, s: 0.8 } },
    };
    const L = touchLayout(568, 320, NO_INSET, false, false, [], { menu: true, custom });
    expect(Math.min(L.buttons.rescue!.w, L.buttons.rescue!.h)).toBeGreaterThanOrEqual(MIN_TARGET);
    expect(L.buttons.menu!.h).toBeGreaterThanOrEqual(MIN_TARGET);
  });

  it('blockersOf: 겹친 조작 · HUD 번호 · 범위 밖을 알려 준다', () => {
    const D = touchLayout(800, 360, NO_INSET, false, false);
    const others: ControlBoxes = controlBoxes(D);
    const rules: PlaceRules = {
      range: moveRange(D.safe, 6),
      hud: [{ x: 300, y: 100, w: 80, h: 40 }],
      zone: () => D.zone,
      midX: 400,
    };
    const rs = D.buttons.rescue!;
    expect(blockersOf('ability', { ...rs }, others, rules).controls).toEqual(['rescue']);
    expect(blockersOf('ability', { x: 310, y: 110, w: 60, h: 60 }, others, rules).hud).toEqual([0]);
    expect(blockersOf('ability', { x: 0, y: 110, w: 60, h: 60 }, others, rules).outside).toBe(true);
    // 이동 고리는 이동 영역 밖이면 막힌다 (가운데 띠)
    expect(blockersOf('move', { x: 360, y: 200, w: 100, h: 100 }, others, rules).outside).toBe(true);
  });
});

describe('이동 스틱 · 이동 영역', () => {
  it('이동 스틱을 오른쪽으로 옮기면 이동 영역도 오른쪽 40% 띠가 된다 (HUD 아래)', () => {
    const { L: D, boxes } = screen('survivor', 915, 412);
    const R = moveRange(D.safe, 6);
    // 오른쪽 가운데 (엄지 버튼 무리 위)
    const custom: TeamLayout = { mirror: false, items: { move: { u: 0.8, v: 0.45, s: 1 } } };
    const { L } = screen('survivor', 915, 412, NO_INSET, custom);
    expect(L.fallback).toBeUndefined();
    expect(L.zone.x).toBe(915 - Math.round(915 * MOVE_ZONE_RATIO));
    expect(L.moveHome.x).toBeGreaterThan(915 / 2);
    expect(problems(L, boxes, 915, 412, NO_INSET)).toEqual([]);
    for (const r of boxes) expect(separated(occupied('move', controlBoxes(L).move!), r, MIN_GAP)).toBe(true);
    void R;
  });

  it('가운데 20% 띠(어느 이동 영역도 아님)에 놓인 고리는 이동 영역 안으로 민다', () => {
    const custom: TeamLayout = { mirror: false, items: { move: { u: 0.5, v: 0.8, s: 1 } } };
    const L = touchLayout(800, 360, NO_INSET, false, false, [], { custom });
    const ring = controlBoxes(L).move!;
    expect(ring.x >= L.zone.x && ring.x + ring.w <= L.zone.x + L.zone.w).toBe(true);
  });

  it('크기 배율은 이동 스틱 반지름에도 (stickScale과 곱한다)', () => {
    const D = touchLayout(800, 360, NO_INSET, false, false, [], { stickScale: 1.2 });
    const L = touchLayout(800, 360, NO_INSET, false, false, [], {
      stickScale: 1.2,
      custom: { mirror: false, items: { move: { u: 0, v: 1, s: 1.25 } } },
    });
    expect(L.moveR).toBeCloseTo(Math.round(D.moveR * 2 * 1.25) / 2, 9);
  });
});

describe('thumbAvoidBoxes가 옮긴 자리를 따른다 (화면 밖 화살표 · 옮긴 미니맵이 피함)', () => {
  it('옮긴 능력 버튼 · 이동 고리 자리 (이름표까지)', () => {
    const custom: TeamLayout = {
      mirror: false,
      items: { ability: { u: 0.6, v: 0.3, s: 1 }, move: { u: 0.1, v: 0.5, s: 1 } },
    };
    const D = touchLayout(800, 360, NO_INSET, false, true, [], { menu: true });
    const L = touchLayout(800, 360, NO_INSET, false, true, [], { menu: true, custom });
    const got = thumbAvoidBoxes(L);
    const a = L.buttons.ability!;
    expect(got).toContainEqual({ ...a, h: a.h + CAP_BELOW });
    expect(got).not.toContainEqual({ ...D.buttons.ability!, h: D.buttons.ability!.h + CAP_BELOW });
    const ring = controlBoxes(L).move!;
    expect(got).toContainEqual({ ...ring, h: ring.h + CAP_BELOW });
    // 반전: 엄지 대상이 왼쪽으로
    const M = touchLayout(800, 360, NO_INSET, false, true, [], {
      menu: true,
      custom: { mirror: true, items: {} },
    });
    const xs = thumbAvoidBoxes(M).filter((b) => b.y > 200);
    expect(Math.min(...xs.map((b) => b.x + b.w / 2))).toBeLessThan(400);
  });
});

describe('effectiveTouchLayout (판 직전 안내 그림 · 편집 화면)', () => {
  let prev: StorageLike | undefined;
  beforeEach(() => {
    prev = (globalThis as { localStorage?: StorageLike }).localStorage;
    (globalThis as { localStorage?: StorageLike }).localStorage = mem();
  });
  afterEach(() => {
    (globalThis as { localStorage?: StorageLike }).localStorage = prev;
  });

  it('저장값이 없으면 판 HUD를 피한 기본 배치 (설정 버튼까지)', () => {
    const E = effectiveTouchLayout('monster', 915, 412, NO_INSET, false);
    const hud = hudPreview('monster', 915, 412, NO_INSET, Lay.cleanTuning({ sysSlots: 3 }));
    const D = touchLayout(
      915,
      412,
      NO_INSET,
      true,
      false,
      hud.rects.map((r) => r.box),
      { menu: true, viewRatio: hud.layout.viewW / hud.layout.viewH },
    );
    expect(E).toEqual(D);
    expect(E.buttons.menu).toBeDefined();
  });

  it('저장한 반전 · 옮긴 조작을 읽는다 (역할 따로)', () => {
    saveControlLayouts({
      survivor: null,
      monster: { mirror: true, items: { roar: { u: 0.5, v: 1, s: 1 } } },
    });
    const M = effectiveTouchLayout('monster', 915, 412, NO_INSET, false);
    expect(M.zone.x).toBeGreaterThan(915 / 2);
    const R = moveRange(M.safe, 6);
    expect(ratioOf(M.buttons.roar!, R).v).toBeCloseTo(1, 6);
    const S = effectiveTouchLayout('survivor', 915, 412, NO_INSET, false);
    expect(S.zone.x).toBeLessThan(915 / 2);
  });
});

describe('resolveLayout (순수)', () => {
  it('바꾼 조작만 정해진 순서로 놓고 나머지는 기본 자리 (앞에서 놓은 것도 피한다)', () => {
    const safe = { x: 32, y: 0, w: 736, h: 336 };
    const range = moveRange(safe, 6);
    const base: ControlBoxes = {
      move: { x: 48, y: 200, w: 100, h: 100 },
      ability: { x: 680, y: 252, w: 78, h: 78 },
      rescue: { x: 600, y: 240, w: 60, h: 60 },
      scoreboard: { x: 690, y: 8, w: 66, h: 50 },
    };
    const rules: PlaceRules = {
      range,
      hud: [],
      zone: (side) => (side === 'left' ? { x: 32, y: 0, w: 288, h: 336 } : { x: 480, y: 0, w: 288, h: 336 }),
      midX: 400,
    };
    // 둘 다 같은 자리로 → 앞(ability)이 그 자리, 뒤(rescue)가 밀린다
    const items = { ability: { u: 0.5, v: 0.5, s: 1 }, rescue: { u: 0.5, v: 0.5, s: 1 } };
    const r = resolveLayout(base, { mirror: false, items }, safe, rules);
    expect(r.fallback).toBe(false);
    expect(r.boxes.ability).toEqual(boxAt(0.5, 0.5, 78, 78, range));
    expect(separated(occupied('ability', r.boxes.ability!), occupied('rescue', r.boxes.rescue!), 8)).toBe(
      true,
    );
    expect(r.boxes.scoreboard).toEqual(base.scoreboard);
    // 없는 조작(이 배치에 없는 attack)은 무시
    const r2 = resolveLayout(base, { mirror: false, items: { attack: { u: 0, v: 0, s: 1 } } }, safe, rules);
    expect(r2.boxes).toEqual(base);
  });
});

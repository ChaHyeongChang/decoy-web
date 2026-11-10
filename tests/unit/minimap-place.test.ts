// 맵 창 안 미니맵 자리 (플레이테스트 a-5 — 괴물 화면 미니맵이 맵 위 가운데에서 시야를 가리던 것, client/src/ui/layout.ts insetCss ·
// minimapFallback, touchControls.touchLayout opts.minimap, controlLayout의 지도 칸):
//  - 자리 규칙: 옆 칸에 자리가 없을 때 ① 맵 오른쪽 위(시스템 버튼 아래)와 ③ 맵 왼쪽 위 구석 중 큰 쪽(같으면 ①). 화면 격자(폭 540~1000 ×
//    높이 270~440 + 시험 화면 · 아이폰 14 주소창 높이) × 두 역할 × 시스템 버튼 2 · 3칸 × 좌우 반전에서: 괴물 틀이 맵 위 가운데 칸(가로
//    가운데 1/3 × 위 1/3)과 겹치는 면적 0, 생존자 자리는 예전 규칙 그대로, 틀이 맵 안이고 엄지 대상(이름표 · 이동 고리) · HUD · 이동
//    영역과 겹침 0. 태블릿 · PC는 그대로. ③의 아래 끝 상한(이동 영역 위)이 걸리는 낮은 화면, ②(맵 위 가운데)가 남는 아주 낮은
//    창(게임 영역 높이 약 250 이하 — ③이 최소 크기로도 안 들어갈 때만)
//  - 낮은 화면(게임 영역 높이 350 이하) 축소: 맵 가로의 0.22 → 0.18, 72 CSS px 아래로는 줄이지 않는다 (어느 화면도 60 미만이 아니다,
//    두 역할 공통 — 생존자는 같은 자리에서 크기만)
//  - 이동 영역이 맵 안 미니맵 틀을 피한다 (탭해서 크게 보기가 이동 영역에 먹히지 않게)
//  - 판 중 창이 낮아질 때 옮길 자리: 맵 왼쪽 위 구석이 '막은 것의 왼쪽(맵 위 가운데 쪽)'보다 먼저
//  - 조작 배치의 지도 칸: 자리만(크기 배율 1), 맵 창 안에서만, 다른 조작 · 이동 영역과 안 겹침, 옆 칸 미니맵 화면에서는 쓰지 않음,
//    좌우 반전 + 기본 배치로 돌아갈 때도 뒤집힌 틀 그대로, 저장 형식 판 1 그대로(지도 칸이 없는 옛 저장값 · 지도 칸이 있는 새
//    저장값을 옛 파서가 읽는 경우), 지도만 옮긴 배치는 판 직전 안내 그림에서 기본 배치로 본다
import { afterEach, describe, expect, it } from 'vitest';
import {
  CONTROL_IDS,
  CONTROL_LAYOUT_VERSION,
  TEAM_CONTROLS,
  baseBoxes,
  blockersOf,
  boxAt,
  controlsMoved,
  flipItems,
  isDefaultLayout,
  moveRange,
  occupied,
  parseControlLayout,
  rangeOf,
  ratioOf,
  resolveLayout,
  separated,
  serializeControlLayout,
  type ControlBoxes,
  type PlaceRules,
  type SavedLayouts,
  type TeamLayout,
} from '../../client/src/controlLayout';
import { computeRenderSize } from '../../client/src/render/resolution';
import * as L from '../../client/src/ui/layout';
import {
  MIN_GAP,
  controlBoxes,
  hudCovered,
  minimapRange,
  moveZone,
  thumbAvoidBoxes,
  touchLayout,
  type Box,
  type Insets,
  type TouchLayout,
} from '../../client/src/ui/touchControls';

afterEach(() => L.applyLayout(L.pcLayout()));

const NO_INSET: Insets = { l: 0, r: 0, t: 0, b: 0 };
const RATIO = 2 / 3;

/** 겹치는가 (닿기만 하면 아니다) */
function overlaps(a: Box, b: Box, eps = 0.01): boolean {
  return a.x < b.x + b.w - eps && b.x < a.x + a.w - eps && a.y < b.y + b.h - eps && b.y < a.y + a.h - eps;
}

/** 겹치는 면적 */
function overlapArea(a: Box, b: Box): number {
  const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return ox > 0 && oy > 0 ? ox * oy : 0;
}

/** 맵 창을 3 × 3으로 나눈 위 가운데 칸 (괴물이 위로 조준하면 시야 부채꼴 끝이 오는 자리) */
function topCenter(map: Box): Box {
  return { x: map.x + map.w / 3, y: map.y, w: map.w / 3, h: map.h / 3 };
}

interface Scene {
  w: number;
  h: number;
  monster: boolean;
  l: L.LayoutInfo;
  plan: L.TouchHudPlan;
  /** 적용한 조정 값 */
  T: Readonly<L.LayoutTuning>;
  /** 판 HUD 배치가 본 화면 폭 (CSS px = 논리 폭 / 배율 — 논리 폭을 정수로 맞춰 w와 0.5px 안에서 다를 수 있다) */
  cssW: number;
  /** 맵 사각형 · 늘 떠 있는 부품 (CSS px) */
  map: Box;
  rects: { id: string; box: Box }[];
  /** 맵 창 안 미니맵 틀 · 그림 폭 (CSS px, 옆 칸 미니맵이면 null) */
  frame: Box | null;
  imgW: number;
  /** 같은 조정의 터치 화면 (설정 버튼 · 전체 화면 버튼까지, 맵 안 미니맵 틀을 넘긴 것) */
  touch: TouchLayout;
}

/** 화면 하나 · 역할 하나의 판 HUD 배치와 터치 화면 (판과 같은 식: main.ts applyMatchLayout → TouchControls.relayout) */
function scene(w: number, h: number, monster: boolean, tune: Partial<L.LayoutTuning> = {}): Scene {
  const l = L.layoutFor(w, h, true, {
    sysSlots: L.SYS_SLOTS_MENU,
    team: monster ? 'monster' : 'survivor',
    ...tune,
  });
  const t = L.touchHudPlan(l)!;
  const plan = monster ? t.monster : t.survivor;
  const k = 1 / t.L;
  const css = (r: Box): Box => ({ x: r.x * k, y: r.y * k, w: r.w * k, h: r.h * k });
  const map = css({ x: l.mapX, y: l.mapY, w: L.MAP_DRAW_W, h: L.MAP_DRAW_H });
  const rects = plan.rects.map((r) => ({ id: r.id, box: css(r.rect) }));
  const T = L.tuningOf(l);
  const i = plan.minimapInset;
  const frame = i ? css(L.minimapInsetFrame(i, l.uiScale)) : null;
  const touch = touchLayout(
    w,
    h,
    NO_INSET,
    monster,
    true,
    rects.map((r) => r.box),
    {
      stickScale: T.stickScale,
      menu: T.sysSlots >= L.SYS_SLOTS_MENU,
      custom: { mirror: T.mirror, items: {} },
      viewRatio: l.viewW / l.viewH,
      sysRows: plan.sysRows,
      minimap: frame ? { frame, map } : null,
    },
  );
  return { w, h, monster, l, plan, T, cssW: l.viewW * k, map, rects, frame, imgW: i ? i.w * k : 0, touch };
}

/** 맵 안 미니맵 그림 폭 상한 (이번 규칙): 낮은 화면이면 맵 가로의 0.18(72 아래로는 안 줄임), 아니면 0.22 · 200 이하 */
function fullWidth(mapW: number, h: number): number {
  const base = Math.min(mapW * 0.22, 200);
  return h <= 350 ? Math.min(base, Math.max(72, mapW * 0.18)) : base;
}

/**
 * 예전 자리 규칙 (PR #32까지의 layout.insetCss를 그대로 옮긴 것 — 좌우 반전 전, 그림 사각형): ① 맵 오른쪽 위(시스템 버튼이 걸치면 그
 * 아래) ② 시스템 버튼 왼쪽의 맵 위 끝, 더 큰 쪽(같으면 ①). full = 그림 폭 상한. 어느 후보를 골랐는지도 돌려준다
 */
function oldRule(s: Scene, full: number): { box: Box; which: 1 | 2 } | null {
  const a = L.TOUCH_UI.art * s.T.uiScale;
  const pad = L.TOUCH_PART.minimap.pad * a;
  const title = L.TOUCH_PART.minimap.title * a;
  const M = 6;
  const map = s.map;
  // 반전 전 배치로 잰다 (판 HUD 배치는 다 정한 뒤 뒤집는다). 폭은 논리 폭(정수로 맞춘 값)의 CSS px — layout.touchGeom과 같다
  const r = L.thumbReserve(s.cssW, s.h, s.monster, s.T, map.x + map.w);
  const clear = (f: Box): boolean =>
    r.cluster.every(
      (b) =>
        f.x >= b.x + b.w + MIN_GAP ||
        b.x >= f.x + f.w + MIN_GAP ||
        f.y >= b.y + b.h + MIN_GAP ||
        b.y >= f.y + f.h + MIN_GAP,
    );
  const fit = (right: number, top: number): Box | null => {
    let w = Math.min(full, (map.y + map.h - M - top - title - pad) / RATIO);
    while (w >= 60) {
      if (clear({ x: right - w - pad * 2, y: top, w: w + pad * 2, h: title + w * RATIO + pad })) break;
      w -= 1;
    }
    if (w < 60) return null;
    return { x: right - pad - w, y: top + title, w, h: w * RATIO };
  };
  const mapRight = map.x + map.w;
  const intrude = r.sysLeft < mapRight;
  const a1 = fit(mapRight - M, intrude ? Math.max(map.y + M, r.sysBottom + MIN_GAP) : map.y + M);
  const a2 = intrude ? fit(Math.min(mapRight - M, r.sysLeft - MIN_GAP), map.y + M) : null;
  if (a1 && a2) return a2.w > a1.w + 0.5 ? { box: a2, which: 2 } : { box: a1, which: 1 };
  if (a1) return { box: a1, which: 1 };
  return a2 ? { box: a2, which: 2 } : null;
}

/** 판 HUD 배치의 맵 안 미니맵 그림 사각형 (CSS px, 좌우 반전을 되돌린 것 — 예전 규칙과 견준다) */
function insetUnmirrored(s: Scene): Box | null {
  const i = s.plan.minimapInset;
  if (!i) return null;
  const k = s.cssW / s.l.viewW;
  const x = i.x * k;
  const w = i.w * k;
  return { x: s.T.mirror ? s.cssW - x - w : x, y: i.y * k, w, h: w * RATIO };
}

/** 시험 화면 (touch-hud.test.ts와 같은 목록) + 아이폰 14 게임 영역(안전 영역을 뺀 750, 주소창 높이) + 낮은 16:9 */
const NAMED: [number, number][] = [
  [915, 412],
  [863, 360],
  [658, 320],
  [802, 293],
  [740, 360],
  [750, 340],
  [750, 369],
  [758, 277],
  [720, 360],
  [640, 320],
  [840, 360],
  [640, 360],
  [960, 540],
  [568, 320],
  [667, 375],
  [750, 350],
  [750, 321],
  [750, 300],
  [750, 279],
  [844, 390],
  [844, 300],
  [932, 430],
  [592, 280],
  [568, 270],
  [600, 300],
  [534, 300],
];
const TABLETS: [number, number][] = [
  [1024, 640],
  [1280, 800],
  [1024, 768],
  [1194, 834],
  [1366, 1024],
  [1180, 820],
];
/** 휴대폰 가로 격자: 폭 540~1000(20씩) × 높이 270~440(10씩), 화면비 3:2 이상 */
const GRID: [number, number][] = [];
for (let w = 540; w <= 1000; w += 20)
  for (let h = 270; h <= 440; h += 10) if (w / h >= 1.5) GRID.push([w, h]);
const PHONES = [...NAMED, ...GRID];

/**
 * 맵 창 안 미니맵 틀의 문제 (빈 배열이면 통과): 틀이 맵 안, 그림 폭 60 이상, 엄지 대상(버튼 · 조준 스틱과 그 아래 이름표, 이동 스틱이
 * 쉬는 고리) · HUD 부품 · 이동 영역과 안 겹침, 이동 영역에 이동 스틱 자리가 남음, 괴물이면 맵 위 가운데 칸과 겹치는 면적 0
 */
function frameProblems(s: Scene, label: string): string[] {
  const out: string[] = [];
  const f = s.frame;
  if (!f) return [`${label}: 맵 안 미니맵 없음`];
  const m = s.map;
  if (f.x < m.x - 0.01 || f.y < m.y - 0.01) out.push(`${label}: 틀이 맵 왼쪽 · 위 밖`);
  if (f.x + f.w > m.x + m.w + 0.01 || f.y + f.h > m.y + m.h + 0.01)
    out.push(`${label}: 틀이 맵 오른쪽 · 아래 밖`);
  if (s.imgW < L.MINIMAP_INSET.min) out.push(`${label}: 그림 폭 ${s.imgW.toFixed(1)} < 60`);
  for (const b of thumbAvoidBoxes(s.touch)) if (overlaps(f, b)) out.push(`${label}: 엄지 대상과 겹침`);
  for (const r of s.rects) if (overlaps(f, r.box)) out.push(`${label}: ${r.id}와 겹침`);
  if (overlaps(f, s.touch.zone)) out.push(`${label}: 이동 영역과 겹침 (틀 아래 ${(f.y + f.h).toFixed(1)})`);
  if (s.touch.zone.h < s.touch.moveR * 2 + 24 - 0.01) out.push(`${label}: 이동 영역이 너무 낮음`);
  if (s.monster) {
    const area = overlapArea(f, topCenter(m));
    if (area > 0.01) out.push(`${label}: 맵 위 가운데 칸과 ${area.toFixed(0)}px² 겹침`);
  }
  return out;
}

describe('맵 창 안 미니맵 자리 규칙 (layout.insetCss — 플레이테스트 a-5)', () => {
  it('화면 격자 × 두 역할 × 시스템 버튼 2 · 3칸 × 좌우 반전: 괴물 틀은 맵 위 가운데 칸과 겹치지 않고, 생존자 자리는 예전 규칙 그대로(크기는 낮은 화면 축소만큼만 — 두 역할 공통), 틀은 맵 안 · 엄지 대상 · HUD · 이동 영역과 안 겹친다', () => {
    const bad: string[] = [];
    let cases = 0;
    let insets = 0;
    let monsterMoved = 0;
    let survivorInsets = 0;
    let survivorShrunk = 0;
    for (const [w, h] of [...PHONES, ...TABLETS])
      for (const monster of [true, false])
        for (const sysSlots of [2, 3])
          for (const mirror of [false, true]) {
            const s = scene(w, h, monster, { sysSlots, mirror });
            cases += 1;
            const label = `${w}×${h} ${monster ? '괴물' : '생존자'} 칸${sysSlots}${mirror ? ' 반전' : ''}`;
            const now = insetUnmirrored(s);
            // 옆 칸 미니맵이 있으면 맵 안 미니맵은 없다 (옆 칸 규칙은 그대로)
            if (s.plan.minimap) {
              if (now) bad.push(`${label}: 옆 칸 · 맵 안 둘 다 있음`);
              continue;
            }
            const old = oldRule(s, fullWidth(s.map.w, h));
            if (!now || !s.frame) {
              if (old) bad.push(`${label}: 예전에는 있던 미니맵이 없음`);
              continue;
            }
            insets += 1;
            bad.push(...frameProblems(s, label));
            if (monster) {
              if (old?.which === 2) monsterMoved += 1;
              // 예전에 오른쪽(①)이던 괴물은 그대로 오른쪽이거나, 더 큰 왼쪽 위 구석이다
              if (old?.which === 1 && now.w < old.box.w - 0.01) bad.push(`${label}: 예전 ①보다 작아짐`);
            } else {
              survivorInsets += 1;
              // 생존자: 예전 규칙이 고른 자리 그대로 (그림 사각형이 같다)
              if (!old) bad.push(`${label}: 예전 규칙에는 자리가 없음`);
              else if (
                Math.abs(now.x - old.box.x) > 0.01 ||
                Math.abs(now.y - old.box.y) > 0.01 ||
                Math.abs(now.w - old.box.w) > 0.01
              )
                bad.push(
                  `${label}: 생존자 자리가 바뀜 (${old.box.x.toFixed(1)}, ${old.box.y.toFixed(1)}, ${old.box.w.toFixed(1)}) → (${now.x.toFixed(1)}, ${now.y.toFixed(1)}, ${now.w.toFixed(1)})`,
                );
              if (old?.which === 2) bad.push(`${label}: 생존자가 예전에 ② 자리였다 (불변식의 전제가 깨짐)`);
              // 크기까지 예전 코드(폭 상한 0.22 그대로)와 견준다: 붙는 끝(오른쪽 끝 · 위 끝)은 같고, 폭은 게임 영역 높이 350
              // 넘으면 같고 그 이하면 낮은 화면 축소만큼만 작다 (축소는 두 역할 공통 — VISUAL_SPEC 12.6)
              const prev = oldRule(s, Math.min(s.map.w * 0.22, 200));
              if (prev?.which !== 1) bad.push(`${label}: 예전 코드의 생존자 자리가 ①이 아님`);
              else {
                const edge = now.x + now.w - (prev.box.x + prev.box.w);
                if (Math.abs(edge) > 0.01 || Math.abs(now.y - prev.box.y) > 0.01)
                  bad.push(`${label}: 생존자 틀이 붙는 끝이 바뀜 (오른쪽 ${edge.toFixed(2)})`);
                if (now.w > prev.box.w + 0.01) bad.push(`${label}: 생존자 그림이 예전보다 큼`);
                if (h > 350 && Math.abs(now.w - prev.box.w) > 0.01)
                  bad.push(`${label}: 높이 350 넘는 화면의 생존자 크기가 바뀜`);
                if (now.w < prev.box.w - 0.01) {
                  survivorShrunk += 1;
                  const cap = Math.max(72, s.map.w * 0.18);
                  if (now.w > cap + 0.01) bad.push(`${label}: 줄었는데 축소 상한(${cap.toFixed(1)})보다 큼`);
                }
              }
            }
          }
    console.log(
      `[minimap-place] 확인 ${cases}가지 · 맵 안 미니맵 ${insets} (생존자 ${survivorInsets}, 그중 낮은 화면 축소 ${survivorShrunk}) · 예전에 위 가운데(②)였던 괴물 ${monsterMoved}`,
    );
    expect(bad.slice(0, 20)).toEqual([]);
    // 빈 통과가 아니다: 맵 안 미니맵 화면이 충분히 있고, 예전에 위 가운데였던 괴물 화면이 실제로 있다
    expect(cases).toBeGreaterThan(3000);
    expect(insets).toBeGreaterThan(1000);
    expect(survivorInsets).toBeGreaterThan(300);
    expect(monsterMoved).toBeGreaterThan(300);
    // 낮은 화면의 생존자는 같은 자리에서 크기만 준다 (정한 동작 — 사람 확인 HUMAN_CHECKS '크기 · 생존자')
    expect(survivorShrunk).toBeGreaterThan(200);
  });

  it('조정 값(UI 크기 1.15 · 1.3, 조이스틱 크기 0.8 · 1.3, 좌우 반전)에서도: 틀은 맵 안 · 엄지 대상 · HUD · 이동 영역과 안 겹치고 괴물 틀은 맵 위 가운데 칸 밖', () => {
    const TUNINGS: Partial<L.LayoutTuning>[] = [
      { uiScale: 1.15 },
      { uiScale: 1.3 },
      { stickScale: 1.3 },
      { stickScale: 0.8 },
      { stickScale: 1.3, uiScale: 1.3, mirror: true },
    ];
    const bad: string[] = [];
    let insets = 0;
    let left = 0;
    for (const [w, h] of [...NAMED, ...TABLETS])
      for (const monster of [true, false])
        for (const tune of TUNINGS) {
          const s = scene(w, h, monster, tune);
          if (!s.frame) continue;
          insets += 1;
          bad.push(...frameProblems(s, `${w}×${h} ${monster ? '괴물' : '생존자'} ${JSON.stringify(tune)}`));
          // 왼쪽 위 구석으로 간 화면 (반전이면 오른쪽 위): 틀 가운데가 맵 가운데의 이동 영역 쪽
          const cx = s.frame.x + s.frame.w / 2;
          if (cx < s.map.x + s.map.w / 2 !== (s.T.mirror === true)) left += 1;
        }
    expect(bad.slice(0, 20)).toEqual([]);
    expect(insets).toBeGreaterThan(100);
    expect(left).toBeGreaterThan(30);
  });

  it('피드백 화면(아이폰 14 주소창 750×340 · 750×300 · 16:9 667×375 · 658×320 · 640×360)의 괴물: 맵 왼쪽 위 구석 — 틀 왼쪽 끝 = 맵 왼쪽 끝 + 6, 틀 아래 끝 ≤ 이동 스틱 그림 위 이동 영역', () => {
    for (const [w, h] of [
      [750, 340],
      [750, 300],
      [750, 279],
      [667, 375],
      [658, 320],
      [640, 360],
      [568, 320],
    ] as const) {
      const s = scene(w, h, true);
      const label = `${w}×${h}`;
      expect(s.plan.minimap, label).toBeNull();
      const f = s.frame!;
      expect(f, label).not.toBeNull();
      expect(f.x, label).toBeCloseTo(s.map.x + L.MINIMAP_INSET.margin, 6);
      expect(f.y, label).toBeCloseTo(s.map.y + L.MINIMAP_INSET.margin, 6);
      const r = L.thumbReserve(w, h, true, s.T, s.map.x + s.map.w);
      expect(f.y + f.h, label).toBeLessThanOrEqual(r.moveTop - L.TOUCH_UI.zoneTop + 0.01);
      // 틀 가운데가 맵 가운데보다 맵 폭의 1/4 넘게 왼쪽 (예전에는 가운데에서 +7 ~ +63px)
      expect(f.x + f.w / 2, label).toBeLessThan(s.map.x + s.map.w / 4);
      // 예전 규칙은 위 가운데(②)였다
      expect(oldRule(s, fullWidth(s.map.w, h))?.which, label).toBe(2);
    }
    // 고정 수치 (CSS px, 틀 x · y · w · h — 보고서 표 6)
    const frame = (w: number, h: number): number[] => {
      const f = scene(w, h, true).frame!;
      return [f.x, f.y, f.w, f.h].map((v) => Math.round(v));
    };
    expect(frame(750, 340)).toEqual([126, 6, 100, 82]);
    expect(frame(750, 300)).toEqual([156, 6, 89, 74]);
    expect(frame(667, 375)).toEqual([97, 32, 115, 91]);
    expect(frame(640, 360)).toEqual([95, 32, 110, 88]);
  });

  it('③의 아래 끝 상한이 실제로 걸리는 낮은 화면(게임 영역 높이 250 — 위 띠 배치)의 괴물: 왼쪽 위 틀은 이동 스틱 그림 위 이동 영역(moveTop − 16)에서 멈춰 폭 상한보다 작고, 이동 영역 · 엄지 대상과 안 겹치며 이동 스틱 자리가 남는다', () => {
    for (const w of [480, 500, 520, 540]) {
      const s = scene(w, 250, true);
      const label = `${w}×250`;
      const f = s.frame!;
      expect(f, label).not.toBeNull();
      // ③ 맵 왼쪽 위 구석
      expect(f.x, label).toBeCloseTo(s.map.x + L.MINIMAP_INSET.margin, 6);
      expect(f.y, label).toBeCloseTo(s.map.y + L.MINIMAP_INSET.margin, 6);
      // 틀 아래 끝 = 상한 (상한이 폭을 정했다 — 폭 상한 max(72, 맵 가로 × 0.18)보다 작다)
      const r = L.thumbReserve(s.cssW, s.h, true, s.T, s.map.x + s.map.w);
      const cap = r.moveTop - L.TOUCH_UI.zoneTop;
      expect(f.y + f.h, label).toBeCloseTo(cap, 6);
      expect(s.imgW, label).toBeLessThan(fullWidth(s.map.w, 250) - 1);
      expect(s.imgW, label).toBeGreaterThanOrEqual(L.MINIMAP_INSET.min);
      // 이동 영역은 틀 아래 8px에서 시작하고 이동 스틱 그림 + 24px 높이가 남는다
      expect(s.touch.zone.y, label).toBeGreaterThanOrEqual(f.y + f.h + MIN_GAP - 0.01);
      expect(frameProblems(s, label)).toEqual([]);
    }
  });

  it('아주 낮은 화면(게임 영역 높이 200~265): 괴물 틀이 맵 위 가운데 칸에 걸리는 것은 ② 시스템 버튼 왼쪽의 맵 위 끝뿐이고, 맵 왼쪽 위 구석에 이동 영역 위로 최소 틀(그림 60)이 들어가지 않을 때만이다 (VISUAL_SPEC 12.6 — 지원 시험 화면 밖)', () => {
    const bad: string[] = [];
    let insets = 0;
    let left = 0;
    let second = 0;
    for (let h = 200; h <= 265; h += 5)
      for (let w = 480; w <= 1000; w += 20) {
        if (w / h < 1.5) continue;
        for (const sysSlots of [2, 3]) {
          const s = scene(w, h, true, { sysSlots });
          const f = s.frame;
          if (!f) continue;
          insets += 1;
          const label = `${w}×${h} 칸${sysSlots}`;
          const m = s.map;
          if (
            f.x < m.x - 0.01 ||
            f.y < m.y - 0.01 ||
            f.x + f.w > m.x + m.w + 0.01 ||
            f.y + f.h > m.y + m.h + 0.01
          )
            bad.push(`${label}: 틀이 맵 밖`);
          for (const r of s.rects) if (overlaps(f, r.box)) bad.push(`${label}: ${r.id}와 겹침`);
          if (Math.abs(f.x - (m.x + L.MINIMAP_INSET.margin)) < 0.01) left += 1;
          if (overlapArea(f, topCenter(m)) <= 0.01) continue;
          second += 1;
          // 맵 왼쪽 위 구석에 이동 영역 위(moveTop − 16)까지 들어가는 그림 폭이 최소(60)보다 작다
          const a = L.TOUCH_UI.art * s.T.uiScale;
          const pad = L.TOUCH_PART.minimap.pad * a;
          const title = L.TOUCH_PART.minimap.title * a;
          const r = L.thumbReserve(s.cssW, h, true, s.T, m.x + m.w);
          const room =
            (r.moveTop - L.TOUCH_UI.zoneTop - (m.y + L.MINIMAP_INSET.margin) - title - pad) / RATIO;
          if (room >= L.MINIMAP_INSET.min)
            bad.push(`${label}: 왼쪽 위에 그림 ${room.toFixed(1)}이 들어가는데 위 가운데`);
          // ② 자리: 틀 오른쪽 끝 = 시스템 버튼 왼쪽 − 8 (맵 오른쪽 끝 − 6 이하), 맵 위 끝 + 6
          const edge = Math.min(m.x + m.w - L.MINIMAP_INSET.margin, r.sysLeft - MIN_GAP);
          if (Math.abs(f.x + f.w - edge) > 0.01 || Math.abs(f.y - (m.y + L.MINIMAP_INSET.margin)) > 0.01)
            bad.push(`${label}: 위 가운데에 걸린 틀이 ② 자리가 아님`);
        }
      }
    expect(bad.slice(0, 20)).toEqual([]);
    expect(insets).toBeGreaterThan(200);
    // 높이 245~265에도 왼쪽 위 구석이 있다(상한 안에 들어갈 때). ②는 그보다 낮은 창의 예외로 남는다
    expect(left).toBeGreaterThan(30);
    expect(second).toBeGreaterThan(0);
  });

  it('생존자 · 오른쪽에 자리가 있는 괴물 · 태블릿은 그대로: 고정 수치와 예전 규칙이 같다 (높이 350 넘는 화면은 크기까지)', () => {
    const frame = (w: number, h: number, monster: boolean): number[] => {
      const f = scene(w, h, monster).frame!;
      return [f.x, f.y, f.w, f.h].map((v) => Math.round(v));
    };
    // 16:9 휴대폰 생존자: 오른쪽 · 시스템 버튼 아래 (보고서 표 1)
    expect(frame(667, 375, false)).toEqual([455, 65, 115, 91]);
    // 태블릿: 오른쪽 · 시스템 버튼 아래, 두 역할이 같다
    expect(frame(1180, 820, true)).toEqual([925, 69, 208, 154]);
    expect(frame(1180, 820, false)).toEqual([925, 69, 208, 154]);
    // 낮은 넓은 화면 생존자 · 괴물: 오른쪽 끝 그대로 (크기만 0.18)
    for (const monster of [true, false]) {
      const s = scene(844, 300, monster);
      expect(s.frame!.x + s.frame!.w).toBeCloseTo(s.map.x + s.map.w - L.MINIMAP_INSET.margin, 6);
    }
    // 높이 350 넘는 화면 · 태블릿: 예전 폭(맵 가로의 0.22 · 200 이하)으로 잰 예전 규칙과 완전히 같다 — 생존자는 모두, 괴물은 예전에 ①이던 화면
    let same = 0;
    for (const [w, h] of [...PHONES, ...TABLETS]) {
      if (h <= 350) continue;
      for (const monster of [true, false]) {
        const s = scene(w, h, monster);
        const now = insetUnmirrored(s);
        const old = oldRule(s, Math.min(s.map.w * 0.22, 200));
        if (s.plan.minimap || !now) continue;
        if (monster && old?.which !== 1) continue;
        expect(old, `${w}×${h}`).not.toBeNull();
        for (const key of ['x', 'y', 'w'] as const)
          expect(now[key], `${w}×${h} ${monster} ${key}`).toBeCloseTo(old!.box[key], 6);
        same += 1;
      }
    }
    expect(same).toBeGreaterThan(40);
    // 태블릿 괴물은 모두 예전에도 ①이었다 (왼쪽 위로 가지 않는다)
    for (const [w, h] of TABLETS) {
      const s = scene(w, h, true);
      if (s.plan.minimap) continue;
      expect(oldRule(s, 200)?.which, `${w}×${h}`).toBe(1);
      expect(s.frame!.x + s.frame!.w / 2, `${w}×${h}`).toBeGreaterThan(s.map.x + s.map.w / 2);
    }
    // PC: 미니맵은 오른쪽 여백 (맵 밖) 그대로
    L.applyLayout(L.pcLayout());
    expect(L.HUD.touch).toBeNull();
    expect([L.HUD.minimap.x, L.HUD.minimap.y, L.HUD.minimap.w]).toEqual([1686, 102, 222]);
    expect(L.HUD.minimap.x).toBeGreaterThanOrEqual(L.MAP_RECT.x + L.MAP_RECT.w);
  });
});

describe('낮은 화면 축소 (MINIMAP_INSET.lowH · fracLow)', () => {
  it('게임 영역 높이 350 이하: 그림 폭 ≤ max(72, 맵 가로 × 0.18)이고 원래(0.22)보다 크지 않다. 350 넘으면 0.22 그대로. 어느 화면도 60 미만이 아니다', () => {
    expect([L.MINIMAP_INSET.lowH, L.MINIMAP_INSET.fracLow, L.TOUCH_UI.minimapMin]).toEqual([350, 0.18, 72]);
    let low = 0;
    let shrunk = 0;
    let floored = 0;
    for (const [w, h] of PHONES)
      for (const monster of [true, false]) {
        const s = scene(w, h, monster);
        if (!s.frame) continue;
        const label = `${w}×${h} ${monster ? '괴물' : '생존자'}`;
        const base = Math.min(s.map.w * 0.22, 200);
        expect(s.imgW, label).toBeGreaterThanOrEqual(L.MINIMAP_INSET.min);
        expect(s.imgW, label).toBeLessThanOrEqual(base + 1e-6);
        if (h > 350) continue;
        low += 1;
        const cap = Math.max(72, s.map.w * 0.18);
        expect(s.imgW, label).toBeLessThanOrEqual(cap + 1e-6);
        if (s.imgW < base - 0.01) shrunk += 1;
        if (s.map.w * 0.18 < 72) floored += 1;
      }
    expect(low).toBeGreaterThan(100);
    expect(shrunk).toBeGreaterThan(100);
    // 하한 72가 실제로 걸리는 화면이 있다 (맵 가로 400 미만)
    expect(floored).toBeGreaterThan(0);
  });

  it('경계: 높이 350은 줄이고 351은 줄이지 않는다 (750 폭 괴물 — 맵 왼쪽 위, 막는 것이 없어 상한 그대로)', () => {
    const at = scene(750, 350, true);
    const over = scene(750, 351, true);
    expect(at.plan.minimap).toBeNull();
    expect(over.plan.minimap).toBeNull();
    expect(at.imgW).toBeCloseTo(at.map.w * 0.18, 6);
    expect(over.imgW).toBeCloseTo(over.map.w * 0.22, 6);
    // 면적은 약 67% (0.18² / 0.22²)
    expect((at.imgW / at.map.w / (over.imgW / over.map.w)) ** 2).toBeCloseTo(0.669, 2);
  });

  it('하한: 가장 낮은 16:9(568×270)에서도 미니맵이 사라지지 않고 그림 폭이 72 (맵 가로 × 0.18 = 59 < 60)', () => {
    for (const monster of [true, false]) {
      const s = scene(568, 270, monster);
      expect(s.map.w * 0.18).toBeLessThan(L.MINIMAP_INSET.min);
      expect(s.frame, String(monster)).not.toBeNull();
      // 엄지 버튼에 막혀 더 줄 수는 있어도 60 아래는 아니다. 막는 것이 없는 쪽은 72 (원래 크기 72.0 이하)
      expect(s.imgW).toBeGreaterThanOrEqual(L.MINIMAP_INSET.min);
      expect(s.imgW).toBeLessThanOrEqual(72 + 1e-6);
    }
    expect(scene(568, 270, false).imgW).toBeCloseTo(Math.min(72, scene(568, 270, false).map.w * 0.22), 6);
  });
});

describe('이동 영역이 맵 창 안 미니맵 틀을 피한다 (touchLayout opts.minimap)', () => {
  it('기본 배치(저장한 조작 배치 없음)에서도 틀과 가로로 겹치는 이동 영역은 틀 아래에서 시작한다 — 위 띠 배치의 작은 창 괴물(HUD가 위 띠에 다 있어 영역이 띠 바로 아래부터였다)', () => {
    let moved = 0;
    for (const [w, h] of [
      [540, 340],
      [560, 360],
      [600, 400],
      [640, 400],
      [580, 380],
    ] as const) {
      const s = scene(w, h, true);
      const label = `${w}×${h}`;
      const f = s.frame!;
      expect(f, label).not.toBeNull();
      const hud = s.rects.map((r) => r.box);
      const opts = { menu: true, viewRatio: s.l.viewW / s.l.viewH, sysRows: s.plan.sysRows };
      const plain = touchLayout(w, h, NO_INSET, true, true, hud, opts);
      const aware = touchLayout(w, h, NO_INSET, true, true, hud, {
        ...opts,
        minimap: { frame: f, map: s.map },
      });
      // 틀을 넘기지 않으면(예전) 이동 영역이 틀을 덮는다 → 넘기면 틀 아래 8px부터
      if (overlaps(f, plain.zone)) {
        moved += 1;
        expect(aware.zone.y, label).toBeCloseTo(f.y + f.h + MIN_GAP, 6);
      }
      expect(overlaps(f, aware.zone), label).toBe(false);
      // 이동 스틱 그림 + 24px 높이는 남고, 나머지는 그대로
      expect(aware.zone.h, label).toBeGreaterThanOrEqual(aware.moveR * 2 + 24 - 0.01);
      expect({ ...aware, zone: plain.zone }, label).toEqual(plain);
      expect(aware.minimap, label).toBeUndefined();
    }
    expect(moved).toBeGreaterThanOrEqual(3);
  });

  it('틀이 이동 영역 띠(화면 40%) 밖이면 영역은 그대로 (오른쪽 위 미니맵 — 생존자 667×375)', () => {
    const s = scene(667, 375, false);
    const hud = s.rects.map((r) => r.box);
    const opts = { menu: true, viewRatio: s.l.viewW / s.l.viewH, sysRows: s.plan.sysRows };
    const plain = touchLayout(667, 375, NO_INSET, false, true, hud, opts);
    const aware = touchLayout(667, 375, NO_INSET, false, true, hud, {
      ...opts,
      minimap: { frame: s.frame!, map: s.map },
    });
    expect(aware).toEqual(plain);
  });
});

describe('판 중 창이 낮아질 때 옮길 자리 (layout.minimapFallback — 왼쪽 위 구석이 위 가운데 쪽보다 먼저)', () => {
  /** 판 시작 화면(w × h)의 옆 칸 미니맵이 창 높이 nh에서 덮였을 때 옮길 자리 (GameScene.placeMinimap과 같은 식, 창 CSS px) */
  const relocated = (
    w: number,
    h: number,
    nh: number,
  ): { covered: boolean; frame: Box | null; map: Box; zone: Box; thumbs: Box[] } => {
    const l = L.layoutFor(w, h, true, { sysSlots: L.SYS_SLOTS_MENU, team: 'monster' });
    L.applyLayout(l);
    const plan = L.HUD.touch!.monster;
    const r = computeRenderSize({
      cssW: w,
      cssH: nh,
      dpr: 1,
      logicalW: l.viewW,
      logicalH: l.viewH,
      preset: { dprCap: 1, maxPixels: 1e12 },
      scaleOverride: null,
    });
    const k = r.dispH / l.viewH;
    const win = (b: Box): Box => ({ x: r.left + b.x * k, y: r.top + b.y * k, w: b.w * k, h: b.h * k });
    const toL = (b: Box): Box => ({ x: (b.x - r.left) / k, y: (b.y - r.top) / k, w: b.w / k, h: b.h / k });
    const boxes = plan.rects.map(({ id, rect }) => ({ id, b: win(rect) }));
    const T = touchLayout(
      w,
      nh,
      NO_INSET,
      true,
      true,
      boxes.map((x) => x.b),
      { menu: true, sysRows: plan.sysRows },
    );
    const map = win(L.MAP_RECT);
    const thumbs = thumbAvoidBoxes(T);
    const mm = plan.minimap;
    if (!mm || !hudCovered(T, boxes).has('minimap'))
      return { covered: false, frame: null, map, zone: T.zone, thumbs };
    const k0 = L.HUD.s;
    const size = {
      w: mm.w + L.HUD.minimap.pad * k0 * 2,
      h: (mm.w * 2) / 3 + L.HUD.minimap.title * k0 + L.HUD.minimap.pad * k0,
    };
    const Lk = L.HUD.touch!.L;
    const spot = L.minimapFallback(
      L.MAP_RECT,
      size,
      thumbs.map(toL),
      L.MINIMAP_INSET.margin * Lk,
      L.MIN_GAP * Lk,
      toL(T.zone),
    );
    return { covered: true, frame: spot ? win({ ...spot, ...size }) : null, map, zone: T.zone, thumbs };
  };

  it('아이폰 14(750×369)에서 시작한 괴물 판에 주소창이 나와 321 · 300 · 279로 낮아지면: 옮긴 틀은 맵 왼쪽 위 구석 — 맵 위 가운데 칸 · 엄지 대상 · 이동 영역과 안 겹친다 (예전: 가운데에서 오른쪽으로 76~82px)', () => {
    for (const nh of [321, 300, 279]) {
      const got = relocated(750, 369, nh);
      const label = `750×369 → ${nh}`;
      expect(got.covered, label).toBe(true);
      const f = got.frame!;
      expect(f, label).not.toBeNull();
      expect(f.x, label).toBeCloseTo(got.map.x + 6 * (nh / 369), 1);
      expect(overlapArea(f, topCenter(got.map)), label).toBe(0);
      expect(overlaps(f, got.zone), label).toBe(false);
      for (const b of got.thumbs) expect(overlaps(f, b), label).toBe(false);
    }
  });

  it('오른쪽에 자리가 있으면 예전 그대로: 시스템 버튼 아래 (915×412 → 330 · 844×390 → 300)', () => {
    for (const [w, h, nh] of [
      [915, 412, 330],
      [844, 390, 300],
    ] as const) {
      const got = relocated(w, h, nh);
      expect(got.covered, `${w}×${h}`).toBe(true);
      const f = got.frame!;
      // 맵 오른쪽 끝에 붙어 있다
      expect(f.x + f.w, `${w}×${h}`).toBeGreaterThan(got.map.x + got.map.w - 8);
      expect(f.y, `${w}×${h}`).toBeGreaterThan(got.map.y + 40);
    }
  });

  it('후보 순서: 오른쪽 위 → 걸친 것 아래 → 맵 왼쪽 위 구석(이동 영역과 겹치면 건너뜀) → 막은 것의 왼쪽', () => {
    const map = { x: 100, y: 50, w: 900, h: 600 };
    const frame = { w: 200, h: 150 };
    const tr = { x: 760, y: 40, w: 100, h: 100 };
    const thumb = { x: 760, y: 200, w: 200, h: 400 };
    // 오른쪽 위 · 그 아래가 막히면 맵 왼쪽 위 구석
    expect(L.minimapFallback(map, frame, [tr, thumb], 10, 8)).toEqual({ x: 110, y: 60 });
    // 이동 영역이 그 자리에 걸치면(닿기만 하면 아니다) 막은 것의 왼쪽으로
    expect(L.minimapFallback(map, frame, [tr, thumb], 10, 8, { x: 0, y: 210, w: 400, h: 440 })).toEqual({
      x: 110,
      y: 60,
    });
    expect(L.minimapFallback(map, frame, [tr, thumb], 10, 8, { x: 0, y: 209, w: 400, h: 441 })).toEqual({
      x: 552,
      y: 60,
    });
    // 왼쪽 위 구석에 버튼(좌우 반전의 시스템 버튼)이 있어도 막은 것의 왼쪽으로
    expect(L.minimapFallback(map, frame, [tr, thumb, { x: 90, y: 40, w: 100, h: 60 }], 10, 8)).toEqual({
      x: 552,
      y: 60,
    });
  });
});

// ───────────────────────── 조작 배치의 지도 칸 ─────────────────────────

/** 괴물 750×340 (아이폰 14 주소창): 맵 안 미니맵 화면. 저장한 배치를 덮은 터치 화면 */
function withLayout(custom: TeamLayout | null, w = 750, h = 340, monster = true) {
  const s = scene(w, h, monster, { mirror: custom?.mirror === true });
  const hud = s.rects.map((r) => r.box);
  const opts = {
    menu: true,
    viewRatio: s.l.viewW / s.l.viewH,
    sysRows: s.plan.sysRows,
    minimap: s.frame ? { frame: s.frame, map: s.map } : null,
  };
  const D = touchLayout(w, h, NO_INSET, monster, true, hud, opts);
  const T = touchLayout(w, h, NO_INSET, monster, true, hud, { ...opts, custom });
  return { s, hud, D, T, range: s.frame ? minimapRange(s.map, D.safe) : null };
}

describe('조작 배치: 지도 (맵 창 안 미니맵 자리 옮기기)', () => {
  it('지도 범위 = 맵 창 안(가장자리 6px 안쪽), 아래는 가장자리 띠 위까지. 판 HUD 배치가 정한 틀은 늘 그 안이다', () => {
    const { s, D, range } = withLayout(null);
    const m = s.map;
    expect(range).toEqual({ x: m.x + 6, y: m.y + 6, w: m.w - 12, h: D.safe.y + D.safe.h - (m.y + 6) });
    // 16:9(위 · 아래 띠): 맵 아래 끝 − 6
    const c = withLayout(null, 667, 375);
    expect(c.range!.y + c.range!.h).toBeCloseTo(c.s.map.y + c.s.map.h - 6, 6);
    for (const [w, h] of PHONES)
      for (const monster of [true, false]) {
        const x = withLayout(null, w, h, monster);
        if (!x.s.frame) continue;
        const f = x.s.frame;
        const r = x.range!;
        expect(f.x >= r.x - 0.01 && f.y >= r.y - 0.01, `${w}×${h}`).toBe(true);
        expect(f.x + f.w <= r.x + r.w + 0.01 && f.y + f.h <= r.y + r.h + 0.01, `${w}×${h}`).toBe(true);
      }
  });

  it('옮기지 않았으면 결과에 minimap 칸이 없다 (판 HUD 배치의 자리) — 다른 조작만 옮긴 배치도', () => {
    const { T, D } = withLayout(null);
    expect(T).toEqual(D);
    expect('minimap' in T).toBe(false);
    const moved = withLayout({ mirror: false, items: { roar: { u: 0.5, v: 0.1, s: 1 } } });
    expect(moved.T.fallback).toBeUndefined();
    expect('minimap' in moved.T).toBe(false);
    // 옮긴 포효 버튼은 판 HUD 배치의 미니맵 틀을 피한다 (8px)
    expect(separated(occupied('roar', moved.T.buttons.roar!), moved.s.frame!, MIN_GAP)).toBe(true);
  });

  it('저장한 지도 자리 = 맵 창 범위 안 비율: 그 자리에 놓이고(크기 그대로), 맵 안 · 다른 조작 · HUD와 8px, 이동 영역은 지도와 겹치지 않는다', () => {
    // 맵 오른쪽 가운데 (엄지 버튼 무리 왼쪽 위 빈 곳)
    const place = { u: 0.62, v: 0.02, s: 1 };
    const { s, T, D, range, hud } = withLayout({ mirror: false, items: { minimap: place } });
    expect(T.fallback).toBeUndefined();
    const mm = T.minimap!;
    expect(mm).toBeDefined();
    const f = s.frame!;
    expect(mm).toEqual(boxAt(place.u, place.v, Math.round(f.w), Math.round(f.h), range!));
    expect(mm.x).toBeGreaterThan(f.x + 100);
    // 맵 창 안
    expect(mm.x >= s.map.x + 6 - 0.5 && mm.x + mm.w <= s.map.x + s.map.w - 6 + 0.5).toBe(true);
    expect(mm.y >= s.map.y + 6 - 0.5 && mm.y + mm.h <= s.map.y + s.map.h - 6 + 0.5).toBe(true);
    // 다른 조작(이름표까지) · HUD와 8px
    for (const [id, b] of Object.entries(controlBoxes(T)))
      expect(separated(mm, occupied(id as keyof ControlBoxes, b), MIN_GAP), id).toBe(true);
    for (const b of hud) expect(separated(mm, b, MIN_GAP)).toBe(true);
    expect(overlaps(mm, T.zone)).toBe(false);
    // 옮기지 않은 조작은 기본 자리 그대로, 이동 영역은 이제 판 HUD(팀 카드) 아래부터 (비운 왼쪽 위 구석은 피하지 않는다)
    expect(T.buttons).toEqual(D.buttons);
    expect(T.aim).toEqual(D.aim);
    expect(T.moveHome).toEqual(D.moveHome);
    expect(T.zone).toEqual(moveZone(750, T.safe, 'left', T.moveR, hud));
  });

  it('맵 창 밖 비율은 없다: u · v가 0 ~ 1이면 어디든 맵 창 안이고, 막힌 구석은 가까운 빈자리로 밀린다 (늘 떠 있는 HUD는 맵 밖 — 예외는 맵 창 안 미니맵뿐)', () => {
    const base = withLayout(null);
    const m = base.s.map;
    const at = (u: number, v: number) => withLayout({ mirror: false, items: { minimap: { u, v, s: 1 } } }).T;
    for (const [u, v] of [
      [0, 0],
      [1, 0],
      [0.5, 0.5],
      [0.5, 0],
      [1, 1],
      [0, 1],
    ] as const) {
      const T = at(u, v);
      const b = T.minimap!;
      expect(b, `${u},${v}`).toBeDefined();
      expect(b.x, `${u},${v}`).toBeGreaterThanOrEqual(m.x + 6 - 0.5);
      expect(b.y, `${u},${v}`).toBeGreaterThanOrEqual(m.y + 6 - 0.5);
      expect(b.x + b.w, `${u},${v}`).toBeLessThanOrEqual(m.x + m.w - 6 + 0.5);
      expect(b.y + b.h, `${u},${v}`).toBeLessThanOrEqual(m.y + m.h - 6 + 0.5);
      for (const [id, c] of Object.entries(controlBoxes(T)))
        expect(separated(b, occupied(id as keyof ControlBoxes, c), MIN_GAP), `${u},${v} ↔ ${id}`).toBe(true);
      expect(overlaps(b, T.zone), `${u},${v} ↔ 이동 영역`).toBe(false);
    }
    // 왼쪽 위 구석(판 HUD 배치의 자리와 같다)에는 그대로 놓인다
    const lt = at(0, 0).minimap!;
    expect([lt.x, lt.y]).toEqual([Math.round(m.x + 6), Math.round(m.y + 6)]);
    // 오른쪽 위 구석은 시스템 버튼(전체 화면)이 걸쳐 있어 그 아래로 밀린다
    const rt = at(1, 0);
    expect(rt.minimap!.y).toBeGreaterThanOrEqual(
      rt.buttons.fullscreen!.y + rt.buttons.fullscreen!.h + MIN_GAP,
    );
    // 왼쪽 아래 구석은 이동 영역 띠 안: 이동 스틱 그림 위로 밀려 올라가고, 이동 영역은 그 아래(이동 스틱 그림 + 24px)만 남는다
    const lb = at(0, 1);
    const ring = controlBoxes(lb).move!;
    expect(lb.minimap!.y + lb.minimap!.h).toBeLessThanOrEqual(ring.y - MIN_GAP);
    expect(lb.zone.y).toBeGreaterThanOrEqual(lb.minimap!.y + lb.minimap!.h);
    expect(lb.zone.y).toBeLessThanOrEqual(ring.y);
    expect(lb.zone.h).toBeCloseTo(lb.moveR * 2 + 24, 6);
  });

  it('버튼 위 · 이동 영역 안에 놓인 비율은 가장 가까운 빈자리로 민다 — 지도가 이동 영역을 밀어 내려 이동 고리가 영역 밖으로 나가는 자리도 받지 않는다', () => {
    const base = withLayout(null);
    const range = base.range!;
    const f = base.s.frame!;
    const size = { w: Math.round(f.w), h: Math.round(f.h) };
    // 조준 스틱 한가운데
    const aim = base.D.aim!;
    const onAim = ratioOf({ x: aim.x, y: aim.y, ...size }, range);
    const a = withLayout({ mirror: false, items: { minimap: { ...onAim, s: 1 } } });
    if (a.T.minimap) {
      for (const [id, b] of Object.entries(controlBoxes(a.T)))
        expect(separated(a.T.minimap, occupied(id as keyof ControlBoxes, b), MIN_GAP), id).toBe(true);
    } else expect(a.T.fallback).toBe(true);
    // 이동 고리 바로 위(이동 영역 띠 안, 고리보다 아래로 내려오는 자리): 영역이 지도 아래에서 시작하면 고리가 밖이다
    const ring = controlBoxes(base.D).move!;
    const zoneX = base.D.zone.x + base.D.zone.w - size.w - 4;
    const inZone = ratioOf({ x: Math.max(range.x, zoneX), y: ring.y - 20, ...size }, range);
    const z = withLayout({ mirror: false, items: { minimap: { ...inZone, s: 1 } } });
    const mm = z.T.minimap;
    if (mm) {
      expect(overlaps(mm, z.T.zone)).toBe(false);
      const r = controlBoxes(z.T).move!;
      expect(r.y).toBeGreaterThanOrEqual(z.T.zone.y - 0.01);
      expect(separated(mm, occupied('move', r), MIN_GAP)).toBe(true);
    } else expect(z.T.fallback).toBe(true);
    // 규칙 함수로 직접: 이동 영역을 막는 지도 자리는 '이동 고리'가 막은 것으로 나온다
    const boxes = controlBoxes(base.D);
    const hud = base.hud;
    const rules: PlaceRules = {
      range: moveRange(base.D.safe, 6),
      hud,
      zone: (side, r, extra = []) => moveZone(750, base.D.safe, side, r, [...hud, ...extra]),
      midX: base.D.safe.x + base.D.safe.w / 2,
      mapRange: range,
    };
    expect(rangeOf('minimap', rules)).toEqual(range);
    expect(rangeOf('roar', rules)).toEqual(rules.range);
    const beside = { x: ring.x + ring.w + 12, y: ring.y, ...size };
    // 맵 창 안이고 고리와 8px 넘게 떨어져 있지만 이동 영역 띠 안 · 고리 옆이다
    expect(beside.x).toBeGreaterThanOrEqual(range.x);
    expect(beside.x).toBeLessThan(base.D.zone.x + base.D.zone.w);
    const blocked = blockersOf('minimap', beside, boxes, rules);
    expect(blocked.outside).toBe(false);
    expect(blocked.controls).toEqual(['move']);
    // 고리를 옮길 때도 같다: 지도 옆(영역이 지도 아래에서 시작해 고리가 밖)은 범위 밖
    const mapAt = { x: range.x, y: 150, ...size };
    const ringBeside = { ...ring, x: mapAt.x + mapAt.w + 12, y: mapAt.y };
    const others: ControlBoxes = { ...boxes, minimap: mapAt };
    delete others.move;
    expect(blockersOf('move', ringBeside, others, rules).outside).toBe(true);
    // 맵 창 밖은 범위 밖
    expect(blockersOf('minimap', { x: 8, y: 150, ...size }, boxes, rules).outside).toBe(true);
  });

  it('옆 칸 미니맵 화면(750×369 · 915×412)에서는 저장한 지도 자리를 쓰지 않는다 — 옆 칸(맵 밖)이 맵을 가리지 않는 더 나은 자리다', () => {
    for (const [w, h] of [
      [750, 369],
      [915, 412],
    ] as const) {
      const none = withLayout(null, w, h);
      expect(none.s.plan.minimap, `${w}×${h}`).not.toBeNull();
      expect(none.s.frame).toBeNull();
      const saved = withLayout({ mirror: false, items: { minimap: { u: 0.5, v: 0.5, s: 1 } } }, w, h);
      expect(saved.T).toEqual(none.D);
      expect('minimap' in saved.T).toBe(false);
      expect(saved.T.fallback).toBeUndefined();
    }
  });

  it('좌우 반전: 판 HUD 배치가 뒤집어 둔 틀(맵 오른쪽 위)을 다시 뒤집지 않고, 저장한 자리는 u → 1 − u', () => {
    const place = { u: 0.3, v: 0.4, s: 1 };
    const plain = withLayout({ mirror: false, items: { minimap: place } });
    const flipped = withLayout({ mirror: true, items: flipItems({ minimap: place }) });
    // 반전 화면의 기본 틀은 맵 오른쪽 위 구석
    expect(flipped.s.frame!.x + flipped.s.frame!.w).toBeCloseTo(flipped.s.map.x + flipped.s.map.w - 6, 6);
    const a = plain.T.minimap!;
    const b = flipped.T.minimap!;
    expect(a && b).toBeTruthy();
    expect(b.y).toBe(a.y);
    expect(Math.abs(b.x - (750 - a.x - a.w))).toBeLessThanOrEqual(1);
    expect(flipped.T.zone.x).toBeGreaterThan(375);
    // 옮기지 않은 반전 배치: minimap 칸 없음, 이동 영역(오른쪽)은 뒤집힌 틀 아래에서
    const only = withLayout({ mirror: true, items: {} });
    expect('minimap' in only.T).toBe(false);
    expect(overlaps(only.s.frame!, only.T.zone)).toBe(false);
  });

  it('놓을 자리가 없으면 통째로 기본 배치 (fallback): 지도도 판 HUD 배치의 자리, 이동 영역은 그 틀을 피한다', () => {
    const s = scene(750, 340, true);
    const hud = [...s.rects.map((r) => r.box)];
    // 맵 창을 다 덮는 HUD (시험용 벽): 지도를 놓을 곳이 없다
    const wall = { x: s.map.x, y: s.map.y + s.frame!.y + s.frame!.h + 4, w: s.map.w, h: s.map.h };
    const opts = {
      menu: true,
      viewRatio: s.l.viewW / s.l.viewH,
      sysRows: s.plan.sysRows,
      minimap: { frame: s.frame!, map: s.map },
      obstacles: [wall, { x: s.map.x + s.frame!.w + 20, y: 0, w: s.map.w, h: 400 }],
    };
    const T = touchLayout(750, 340, NO_INSET, true, true, hud, {
      ...opts,
      custom: { mirror: false, items: { minimap: { u: 0.9, v: 0.9, s: 1 } } },
    });
    expect(T.fallback).toBe(true);
    expect('minimap' in T).toBe(false);
    expect(overlaps(s.frame!, T.zone)).toBe(false);
  });

  it('좌우 반전 + 놓을 자리가 없어 기본 배치 (fallback): 지도는 판 HUD 배치가 뒤집어 둔 틀(맵 오른쪽 위) 그대로 — 다시 뒤집지 않아 이동 영역(오른쪽)이 그 틀 아래에서 시작한다', () => {
    // 위 띠 배치의 작은 창: HUD가 모두 위 띠라 이동 영역이 틀을 피하지 않으면 띠 바로 아래부터다
    const s = scene(600, 400, true, { mirror: true });
    const f = s.frame!;
    expect(f.x + f.w).toBeCloseTo(s.map.x + s.map.w - L.MINIMAP_INSET.margin, 6);
    const hud = s.rects.map((r) => r.box);
    const opts = {
      menu: true,
      viewRatio: s.l.viewW / s.l.viewH,
      sysRows: s.plan.sysRows,
      minimap: { frame: f, map: s.map },
    };
    const D = touchLayout(600, 400, NO_INSET, true, true, hud, {
      ...opts,
      custom: { mirror: true, items: {} },
    });
    // 시험용 벽: 이동 영역 띠(오른쪽 40%) 왼쪽을 다 막아(띠와 가로로 겹치지 않는다) 화면 왼쪽 끝으로 옮긴 포효 버튼을 200px
    // 안에 놓을 곳이 없다
    const wall = { x: 0, y: 0, w: D.zone.x - MIN_GAP, h: 400 };
    const T = touchLayout(600, 400, NO_INSET, true, true, hud, {
      ...opts,
      obstacles: [wall],
      custom: { mirror: true, items: { roar: { u: 0, v: 0.4, s: 1 }, minimap: { u: 0.2, v: 0.5, s: 1 } } },
    });
    expect(T.fallback).toBe(true);
    expect('minimap' in T).toBe(false);
    expect(T.buttons).toEqual(D.buttons);
    // 이동 영역은 오른쪽이고 판 HUD 배치의 틀(맵 오른쪽 위) 아래 8px에서 시작한다 (다시 뒤집은 왼쪽 위 자리를 피하면 겹친다)
    expect(T.zone.x).toBeGreaterThan(300);
    expect(overlaps(f, T.zone)).toBe(false);
    expect(T.zone.y).toBeGreaterThanOrEqual(f.y + f.h + MIN_GAP - 0.01);
    expect(T.zone).toEqual(D.zone);
    // 규칙 함수로 직접: fixed(이미 제자리인 지도 틀)는 fallback 결과에서도 그대로, 다른 조작은 뒤집힌 기본 자리
    const safe = D.safe;
    const base: ControlBoxes = { roar: { x: 400, y: 100, w: 50, h: 50 } };
    const blocked: PlaceRules = {
      range: moveRange(safe, 6),
      hud: [{ x: 0, y: 0, w: 600, h: 400 }],
      zone: (side, r, extra = []) => moveZone(600, safe, side, r, extra),
      midX: safe.x + safe.w / 2,
      mapRange: minimapRange(s.map, safe),
    };
    const res = resolveLayout(
      base,
      { mirror: true, items: { roar: { u: 0.5, v: 0.5, s: 1 }, minimap: { u: 0, v: 0, s: 1 } } },
      safe,
      blocked,
      { minimap: f },
    );
    expect(res.fallback).toBe(true);
    expect(res.boxes.minimap).toEqual(f);
    expect(res.boxes.roar).toEqual(baseBoxes(base, true, safe).roar);
  });
});

describe('조작 배치 저장 형식: 지도 칸 (판 1 그대로 — 옛 저장값 · 옛 묶음 양쪽 호환)', () => {
  /** PR #32까지의 조작 목록 (지도 칸이 생기기 전) */
  const OLD_CONTROLS = {
    survivor: ['move', 'ability', 'rescue', 'scoreboard', 'menu', 'fullscreen'],
    monster: ['move', 'attack', 'dash', 'roar', 'mode', 'scoreboard', 'menu', 'fullscreen'],
  } as const;

  /**
   * 옛 묶음의 읽기 (PR #32의 parseControlLayout · cleanTeamLayout과 같은 규칙): 판이 1이 아니면 통째로 기본, 그 역할의 옛 조작
   * 목록에 없는 칸은 버린다. 값 검사는 지금 파서에 맡긴다(옛 목록에 있는 칸만 남긴 JSON을 지금 파서로 읽는다 — 그 칸들의 규칙은 같다)
   */
  const oldParse = (raw: string): SavedLayouts => {
    const obj = JSON.parse(raw) as { v: number } & Record<string, { mirror?: boolean; items?: object }>;
    if (obj.v !== 1) return { survivor: null, monster: null };
    const out: Record<string, unknown> = { v: 1 };
    for (const team of ['survivor', 'monster'] as const) {
      const t = obj[team];
      if (!t) continue;
      const items = Object.fromEntries(
        Object.entries(t.items ?? {}).filter(([id]) =>
          (OLD_CONTROLS[team] as readonly string[]).includes(id),
        ),
      );
      out[team] = { mirror: t.mirror, items };
    }
    return parseControlLayout(JSON.stringify(out));
  };

  it('저장 형식 판은 1 그대로이고, 지도는 두 역할의 조작 목록 맨 끝(버튼을 먼저 놓고 지도가 피한다) — 예전 조작 순서는 그대로', () => {
    expect(CONTROL_LAYOUT_VERSION).toBe(1);
    expect(CONTROL_IDS.at(-1)).toBe('minimap');
    expect(CONTROL_IDS.slice(0, -1)).toEqual([
      'move',
      'attack',
      'dash',
      'roar',
      'mode',
      'ability',
      'rescue',
      'scoreboard',
      'menu',
      'fullscreen',
    ]);
    for (const team of ['survivor', 'monster'] as const) {
      expect(TEAM_CONTROLS[team].at(-1)).toBe('minimap');
      expect(TEAM_CONTROLS[team].slice(0, -1)).toEqual(OLD_CONTROLS[team]);
    }
  });

  it('왕복: 지도 칸은 기존 items에 {u, v, s} 한 칸 — 크기 배율은 늘 1로 읽는다 (자리만)', () => {
    const saved: SavedLayouts = {
      survivor: { mirror: false, items: { minimap: { u: 0.25, v: 0.5, s: 1 } } },
      monster: {
        mirror: true,
        items: { roar: { u: 0.5, v: 1, s: 1.2 }, minimap: { u: 1, v: 0, s: 1 } },
      },
    };
    const raw = serializeControlLayout(saved)!;
    expect(JSON.parse(raw)).toEqual({ v: 1, ...saved });
    expect(parseControlLayout(raw)).toEqual(saved);
    // 지도 칸은 items의 마지막 (저장 순서 = CONTROL_IDS)
    expect(Object.keys((JSON.parse(raw) as { monster: { items: object } }).monster.items)).toEqual([
      'roar',
      'minimap',
    ]);
    // 다른 배율이 적혀 있어도 1 (나중 판이 크기를 넣어도 이 판은 자리만 쓴다), 틀린 값은 그 칸만 버린다
    const odd = JSON.stringify({
      v: 1,
      survivor: { mirror: false, items: { minimap: { u: 2, v: -1, s: 1.5 }, ability: { u: 0.5, v: 0.5 } } },
      monster: { mirror: false, items: { minimap: { u: 'x', v: 0 }, dash: { u: 0.1, v: 0.2, s: 1 } } },
    });
    expect(parseControlLayout(odd)).toEqual({
      survivor: {
        mirror: false,
        items: { ability: { u: 0.5, v: 0.5, s: 1 }, minimap: { u: 1, v: 0, s: 1 } },
      },
      monster: { mirror: false, items: { dash: { u: 0.1, v: 0.2, s: 1 } } },
    });
  });

  it('옛 저장값(지도 칸 없음)을 새 파서가 읽으면: 그대로 읽히고 지도는 판 HUD 배치의 자리 (결과에 minimap 칸 없음)', () => {
    // PR #32 묶음이 쓴 값 (조작 배치 편집 E2E가 저장하는 모양)
    const oldRaw =
      '{"v":1,"survivor":{"mirror":false,"items":{"ability":{"u":0.6521,"v":0.4135,"s":1}}},"monster":{"mirror":true,"items":{"roar":{"u":0.5,"v":1,"s":1}}}}';
    const got = parseControlLayout(oldRaw);
    expect(got).toEqual({
      survivor: { mirror: false, items: { ability: { u: 0.6521, v: 0.4135, s: 1 } } },
      monster: { mirror: true, items: { roar: { u: 0.5, v: 1, s: 1 } } },
    });
    // 다시 저장해도 같은 글자 (형식이 그대로다)
    expect(serializeControlLayout(got)).toBe(oldRaw);
    const { T, s } = withLayout(got.monster);
    expect(T.fallback).toBeUndefined();
    expect('minimap' in T).toBe(false);
    // 판 HUD 배치의 틀(반전이라 맵 오른쪽 위)을 옮긴 포효 버튼 · 이동 영역이 피한다
    expect(separated(occupied('roar', T.buttons.roar!), s.frame!, MIN_GAP)).toBe(true);
    expect(overlaps(s.frame!, T.zone)).toBe(false);
  });

  it('지도만 옮긴 배치는 조작을 바꾼 배치가 아니다 (controlsMoved — 판 직전 터치 안내는 손으로 다듬은 기본 그림 · 본문)', () => {
    const map = { u: 0.5, v: 0.5, s: 1 };
    expect(controlsMoved(null)).toBe(false);
    expect(controlsMoved({ mirror: false, items: {} })).toBe(false);
    expect(controlsMoved({ mirror: false, items: { minimap: map } })).toBe(false);
    expect(controlsMoved({ mirror: false, items: { roar: map } })).toBe(true);
    expect(controlsMoved({ mirror: false, items: { minimap: map, roar: map } })).toBe(true);
    expect(controlsMoved({ mirror: true, items: {} })).toBe(true);
    expect(controlsMoved({ mirror: true, items: { minimap: map } })).toBe(true);
    // 저장값으로는 지도만 옮긴 배치도 기본이 아니다 (판의 지도 자리 · 설정 화면 '기본값' 대상) — 안내 그림만 기본을 쓴다
    const saved = parseControlLayout(
      serializeControlLayout({ survivor: null, monster: { mirror: false, items: { minimap: map } } }),
    );
    expect(Object.keys(saved.monster!.items)).toEqual(['minimap']);
    expect(isDefaultLayout(saved.monster)).toBe(false);
    expect(controlsMoved(saved.monster)).toBe(false);
  });

  it('새 저장값(지도 칸 있음)을 옛 파서가 읽으면: 판 1이라 버리지 않고, 모르는 지도 칸만 빠진 나머지가 그대로다', () => {
    const now: SavedLayouts = {
      survivor: {
        mirror: false,
        items: { ability: { u: 0.7, v: 0.9, s: 1.2 }, minimap: { u: 0.3, v: 0, s: 1 } },
      },
      monster: { mirror: true, items: { minimap: { u: 0.9, v: 0.1, s: 1 } } },
    };
    const raw = serializeControlLayout(now)!;
    // 지도 칸을 뺀 배치를 저장한 글자와 지도 칸만 다르다: 최상위 · 역할 칸 모양이 같다
    const without: SavedLayouts = {
      survivor: { mirror: false, items: { ability: { u: 0.7, v: 0.9, s: 1.2 } } },
      monster: { mirror: true, items: {} },
    };
    const strip = JSON.parse(raw) as Record<string, { items: Record<string, unknown> }>;
    delete strip.survivor!.items.minimap;
    delete strip.monster!.items.minimap;
    expect(JSON.stringify(strip)).toBe(serializeControlLayout(without));
    // 옛 묶음이 읽은 결과: 능력 버튼 자리 · 좌우 반전은 그대로, 지도는 기본 자리
    expect(oldParse(raw)).toEqual(without);
    // 지도만 옮긴 역할(반전 없음)은 옛 묶음에서 기본 배치가 된다
    const only = serializeControlLayout({
      survivor: null,
      monster: { mirror: false, items: { minimap: { u: 0.9, v: 0.1, s: 1 } } },
    })!;
    expect(oldParse(only)).toEqual({ survivor: null, monster: null });
    // 판을 올렸다면 옛 묶음은 통째로 버렸을 것이다 (그래서 올리지 않는다)
    expect(oldParse(raw.replace('"v":1', '"v":2'))).toEqual({ survivor: null, monster: null });
  });
});

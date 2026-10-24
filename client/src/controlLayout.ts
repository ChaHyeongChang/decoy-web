// 조작 배치 (설정 화면 통합 · 조작 배치 편집, 터치 기기): 터치 화면 버튼 · 스틱 자리를 화면 비율로 저장하고(생존자 · 괴물 따로,
// 'decoy:controlLayout'), 지금 화면의 기본 배치 위에 덮어 실제 자리를 정한다. 순수 모듈(DOM · Phaser 없음, 단위 시험
// tests/unit/control-layout.test.ts). 화면 표시만 바꾼다 — 입력 의미 · 규칙 · 판정 · 서버로 보내는 값과 무관하다.
//
// 비율 좌표: u, v ∈ [0, 1]은 조작 하나가 '움직일 수 있는 범위'(안전 사각형 안쪽 pad) 안에서의 자리다.
//   u = (x − 범위.x) / (범위.w − w), v도 같은 식 (x · y = 조작 사각형 왼쪽 위). u = 1이면 어느 화면에서나 오른쪽 끝에 붙는다 →
//   16:9 ~ 21:9 휴대폰 · 4:3 태블릿 · 화면 회전(가로 고정 게임이라 늘 긴 변이 폭, 180° 뒤집기는 안전 영역만 바뀐다)에서 자연스러운
//   자리가 된다. s = 기본 크기 대비 배율(0.8 ~ 1.5, 터치 대상이 48px 아래로 작아지지 않게 더 자른다).
// 바꾼 조작만 저장한다(나머지는 그 화면의 기본 자리). 기본 배치(반전 없음 · 바꾼 것 없음)는 저장하지 않고, 두 역할 모두 기본이면
// 키를 지운다. 읽을 때 엄하게 검사한다(모르는 칸 · 틀린 값은 버리고, 범위 밖 수는 자른다).
//
// 실제 자리 정하기(resolveLayout): 기본 배치(좌우 반전이면 안전 사각형 가운데로 뒤집은 것) 위에 바꾼 조작만 비율 → px로 놓고 범위
// 안으로 자른다. 다른 조작 · 늘 떠 있는 판 HUD(타이머 · 게이지 · 팀 카드 · 미니맵)와 겹치면(이름표까지, 간격 MIN_GAP) 가장 가까운
// 빈자리로 민다(4px 격자를 가까운 순 · 정해진 순서로 — 늘 같은 결과). 밀 자리가 없으면 통째로 기본 배치(반전이면 뒤집은 것)로
// 돌아간다. 이동 스틱(쉬는 고리)은 이동 영역 안에만 놓는다: 고리가 있는 쪽(왼쪽 · 오른쪽) 화면 40% 띠의 HUD 아래
import type { Team } from '@decoy/shared';
import { stickScaleOf, uiScaleOf } from './prefs';
import { readKey, removeKey, writeKey, type StorageLike } from './storageKeys';
import { MIN_GAP, MIN_TARGET, SYS_SLOTS_MENU, type LayoutTuning } from './ui/layout';

/** 배치를 바꿀 수 있는 조작: 이동 스틱(쉬는 고리) · 조준 스틱(괴물 공격) · 버튼 · 시스템 버튼(점수판 · 설정 · 전체 화면) */
export type ControlId =
  'move' | 'attack' | 'dash' | 'roar' | 'mode' | 'ability' | 'rescue' | 'scoreboard' | 'menu' | 'fullscreen';

/** 정해진 순서 (자리 정하기 · 저장 순서) */
export const CONTROL_IDS: readonly ControlId[] = [
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
];

export const TEAMS: readonly Team[] = ['survivor', 'monster'];

/** 역할마다 있는 조작 */
export const TEAM_CONTROLS: Readonly<Record<Team, readonly ControlId[]>> = {
  survivor: ['move', 'ability', 'rescue', 'scoreboard', 'menu', 'fullscreen'],
  monster: ['move', 'attack', 'dash', 'roar', 'mode', 'scoreboard', 'menu', 'fullscreen'],
};

const SYS: ReadonlySet<ControlId> = new Set<ControlId>(['scoreboard', 'menu', 'fullscreen']);

/** 시스템 버튼 (이름표가 버튼 안 — 아래로 나오지 않는다) */
export function isSysControl(id: ControlId): boolean {
  return SYS.has(id);
}

/** 크기 배율 범위 · 한 번에 바꾸는 양 (편집 화면 작게 · 크게) */
export const SIZE_SCALE = { min: 0.8, max: 1.5, step: 0.1 } as const;

/**
 * 버튼 이름표(`.tc-cap`)가 버튼 상자 아래로 나오는 길이 (CSS px): style.css `.tc-cap` top = 100% − 9px, 높이 = line-height 15 +
 * padding 1 + 2 = 18 → 9px 아래로 나온다. 이동 스틱 이름표도 고리 아래로 같은 만큼(`.tc-move > .tc-cap`). 시스템 버튼(점수판 · 설정 ·
 * 전체 화면) 이름표는 버튼 안이다(`.tc-sys > .tc-cap`). touch-hud 단위 시험이 CSS와 대조한다
 */
export const CAP_BELOW = 9;

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 저장한 조작 하나: 움직일 수 있는 범위 안 비율 자리 · 크기 배율 */
export interface ControlPlace {
  u: number;
  v: number;
  s: number;
}

/** 역할 하나의 배치: 좌우 반전 + 바꾼 조작 */
export interface TeamLayout {
  mirror: boolean;
  items: Partial<Record<ControlId, ControlPlace>>;
}

export interface SavedLayouts {
  survivor: TeamLayout | null;
  monster: TeamLayout | null;
}

export type ControlBoxes = Partial<Record<ControlId, Box>>;

/** 저장 형식 판 (모양이 바뀌면 올린다. 다른 판은 읽지 않는다 → 기본 배치) */
export const CONTROL_LAYOUT_VERSION = 1;

const EPS = 0.01;
const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));
const clamp01 = (v: number): number => clamp(v, 0, 1);

// ───────────────────────── 저장 ─────────────────────────

/** 기본 배치인가 (반전 없음 · 바꾼 조작 없음, 없음도 기본) */
export function isDefaultLayout(t: TeamLayout | null | undefined): boolean {
  return !t || (!t.mirror && Object.keys(t.items).length === 0);
}

function cleanPlace(v: unknown): ControlPlace | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);
  const u = num(o.u);
  const w = num(o.v);
  if (u === null || w === null) return null;
  const s = o.s === undefined ? 1 : num(o.s);
  if (s === null) return null;
  return { u: clamp01(u), v: clamp01(w), s: clamp(s, SIZE_SCALE.min, SIZE_SCALE.max) };
}

/** 역할 하나 검사: 모르는 조작 · 그 역할에 없는 조작 · 틀린 값은 버리고 범위 밖 수는 자른다. 기본 배치면 null */
export function cleanTeamLayout(team: Team, v: unknown): TeamLayout | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const items: Partial<Record<ControlId, ControlPlace>> = {};
  const src = o.items;
  if (src && typeof src === 'object' && !Array.isArray(src)) {
    const rec = src as Record<string, unknown>;
    for (const id of TEAM_CONTROLS[team]) {
      if (!Object.prototype.hasOwnProperty.call(rec, id)) continue;
      const p = cleanPlace(rec[id]);
      if (p) items[id] = p;
    }
  }
  const t: TeamLayout = { mirror: o.mirror === true, items };
  return isDefaultLayout(t) ? null : t;
}

/** 저장값 → 두 역할 배치. 깨진 JSON · 다른 판이면 둘 다 기본(null) */
export function parseControlLayout(raw: string | null): SavedLayouts {
  const out: SavedLayouts = { survivor: null, monster: null };
  if (raw === null) return out;
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return out;
  }
  if (!obj || typeof obj !== 'object' || (obj as { v?: unknown }).v !== CONTROL_LAYOUT_VERSION) return out;
  const rec = obj as Record<string, unknown>;
  for (const team of TEAMS) out[team] = cleanTeamLayout(team, rec[team]);
  return out;
}

const round = (v: number, d: number): number => Math.round(v * 10 ** d) / 10 ** d;

/** 두 역할 배치 → 저장값 (기본 배치인 역할은 빼고, 둘 다 기본이면 null — 키를 지운다). 비율은 소수 4자리 · 배율 2자리 */
export function serializeControlLayout(s: SavedLayouts): string | null {
  const out: Record<string, unknown> = { v: CONTROL_LAYOUT_VERSION };
  let any = false;
  for (const team of TEAMS) {
    const t = cleanTeamLayout(team, s[team]);
    if (!t) continue;
    const items: Record<string, ControlPlace> = {};
    for (const id of CONTROL_IDS) {
      const p = t.items[id];
      if (p) items[id] = { u: round(p.u, 4), v: round(p.v, 4), s: round(p.s, 2) };
    }
    out[team] = { mirror: t.mirror, items };
    any = true;
  }
  return any ? JSON.stringify(out) : null;
}

/**
 * 브라우저 저장소에 쓰지 못한 배치 (사생활 보호 · 가득 참): 이번 접속에는 이 값을 쓴다 (설정 화면의 '저장되지 않아요'와 같다).
 * undefined = 없음
 */
let unsaved: string | null | undefined;

/** 저장한 두 역할 배치 (storage = 시험용 가짜, 없으면 브라우저 저장소 — 쓰지 못했으면 이번 접속의 값) */
export function loadControlLayouts(storage?: StorageLike | null): SavedLayouts {
  if (storage === undefined && unsaved !== undefined) return parseControlLayout(unsaved);
  return parseControlLayout(readKey('controlLayout', '', storage));
}

/** 저장한 역할 배치 (기본이면 null) */
export function loadControlLayout(team: Team, storage?: StorageLike | null): TeamLayout | null {
  return loadControlLayouts(storage)[team];
}

/** 두 역할 배치를 저장한다 (둘 다 기본이면 키를 지운다). 저장하지 못하면 false (브라우저 저장소면 이번 접속에는 적용) */
export function saveControlLayouts(s: SavedLayouts, storage?: StorageLike | null): boolean {
  const raw = serializeControlLayout(s);
  const ok =
    raw === null ? removeKey('controlLayout', '', storage) : writeKey('controlLayout', raw, '', storage);
  if (storage === undefined) unsaved = ok ? undefined : raw;
  return ok;
}

/**
 * 판 배치 조정 (layout.configureLayout에 넘긴다): 지금 설정의 조이스틱 크기 · UI 크기, 그 역할 배치의 좌우 반전, 시스템 버튼 칸
 * (판 중 설정 버튼까지 = SYS_SLOTS_MENU)
 */
export function matchTuning(team: Team, menu = true, storage?: StorageLike | null): LayoutTuning {
  return {
    stickScale: stickScaleOf(),
    uiScale: uiScaleOf(),
    mirror: loadControlLayout(team, storage)?.mirror === true,
    sysSlots: menu ? SYS_SLOTS_MENU : 2,
  };
}

// ───────────────────────── 기하 ─────────────────────────

/** 움직일 수 있는 범위: 안전 사각형(가장자리 띠 안쪽)에서 pad만큼 안 */
export function moveRange(safe: Box, pad: number): Box {
  return {
    x: safe.x + pad,
    y: safe.y + pad,
    w: Math.max(0, safe.w - pad * 2),
    h: Math.max(0, safe.h - pad * 2),
  };
}

/** 사각형 → 범위 안 비율 자리 (범위가 사각형보다 좁으면 가운데 0.5) */
export function ratioOf(b: Box, range: Box): { u: number; v: number } {
  const fw = range.w - b.w;
  const fh = range.h - b.h;
  return {
    u: fw > EPS ? clamp01((b.x - range.x) / fw) : 0.5,
    v: fh > EPS ? clamp01((b.y - range.y) / fh) : 0.5,
  };
}

/** 비율 자리 → 사각형 (크기 w × h, 정수 px) */
export function boxAt(u: number, v: number, w: number, h: number, range: Box): Box {
  return {
    x: Math.round(range.x + clamp01(u) * Math.max(0, range.w - w)),
    y: Math.round(range.y + clamp01(v) * Math.max(0, range.h - h)),
    w,
    h,
  };
}

/** 범위 안으로 옮긴다 (크기 그대로) */
export function clampBox(b: Box, range: Box): Box {
  return {
    ...b,
    x: Math.max(range.x, Math.min(range.x + range.w - b.w, b.x)),
    y: Math.max(range.y, Math.min(range.y + range.h - b.h, b.y)),
  };
}

/** 안전 사각형 가운데로 좌우를 뒤집는다 */
export function mirrorBox(b: Box, safe: Box): Box {
  return { ...b, x: safe.x * 2 + safe.w - b.x - b.w };
}

/** 범위 안인가 */
export function insideBox(b: Box, r: Box): boolean {
  return b.x >= r.x - EPS && b.y >= r.y - EPS && b.x + b.w <= r.x + r.w + EPS && b.y + b.h <= r.y + r.h + EPS;
}

/** 크기 배율 하한: 0.8과 '짧은 변 48px'(MIN_TARGET) 중 큰 쪽 */
export function minScale(base: Box): number {
  return Math.max(SIZE_SCALE.min, MIN_TARGET / Math.max(1, Math.min(base.w, base.h)));
}

/** 크기 배율 자르기 (하한 minScale · 상한 1.5, 하한이 상한보다 크면 하한) */
export function clampScale(base: Box, s: number): number {
  const lo = minScale(base);
  const v = Number.isFinite(s) ? s : 1;
  return clamp(v, lo, Math.max(lo, SIZE_SCALE.max));
}

/** 기본 크기의 s배 사각형 (가운데 (cx, cy), 정수 px 크기) */
export function sizedBox(base: Box, s: number, cx: number, cy: number): Box {
  const w = Math.round(base.w * s);
  const h = Math.round(base.h * s);
  return { x: Math.round(cx - w / 2), y: Math.round(cy - h / 2), w, h };
}

/** 조작이 차지하는 사각형: 버튼 · 스틱은 아래로 나오는 이름표까지, 시스템 버튼은 그대로 */
export function occupied(id: ControlId, b: Box): Box {
  return isSysControl(id) ? b : { x: b.x, y: b.y, w: b.w, h: b.h + CAP_BELOW };
}

/** 두 사각형이 gap 이상 떨어져 있는가 (한 축이라도) */
export function separated(a: Box, b: Box, gap: number): boolean {
  return (
    a.x + a.w + gap <= b.x + EPS ||
    b.x + b.w + gap <= a.x + EPS ||
    a.y + a.h + gap <= b.y + EPS ||
    b.y + b.h + gap <= a.y + EPS
  );
}

export type Side = 'left' | 'right';

/** 놓기 규칙: 움직일 수 있는 범위 · 피할 판 HUD 사각형 · 이동 영역(쪽, 고리 반지름) · 화면 가운데 x */
export interface PlaceRules {
  range: Box;
  hud: readonly Box[];
  zone: (side: Side, r: number) => Box;
  midX: number;
}

/** 이동 고리가 있는 쪽 (가운데가 화면 가운데보다 왼쪽이면 왼쪽) */
export function sideOf(ring: Box, midX: number): Side {
  return ring.x + ring.w / 2 < midX ? 'left' : 'right';
}

/** 놓을 수 없는 까닭: 겹치는 조작 · 겹치는 HUD 사각형 번호 · 범위(이동 고리는 이동 영역) 밖 */
export interface Blockers {
  controls: ControlId[];
  hud: number[];
  outside: boolean;
}

/** id를 box에 놓을 때 막는 것 (others = 다른 조작의 지금 자리, id 자신은 무시) */
export function blockersOf(id: ControlId, box: Box, others: ControlBoxes, rules: PlaceRules): Blockers {
  let outside = !insideBox(box, rules.range);
  if (id === 'move' && !outside) outside = !insideBox(box, rules.zone(sideOf(box, rules.midX), box.w / 2));
  const occ = occupied(id, box);
  const controls: ControlId[] = [];
  for (const o of CONTROL_IDS) {
    const b = others[o];
    if (o === id || !b) continue;
    if (!separated(occ, occupied(o, b), MIN_GAP)) controls.push(o);
  }
  const hud: number[] = [];
  rules.hud.forEach((b, i) => {
    if (!separated(occ, b, MIN_GAP)) hud.push(i);
  });
  return { controls, hud, outside };
}

/** id를 box에 놓을 수 있는가 */
export function placeOk(id: ControlId, box: Box, others: ControlBoxes, rules: PlaceRules): boolean {
  const b = blockersOf(id, box, others, rules);
  return !b.outside && b.controls.length === 0 && b.hud.length === 0;
}

/** 밀어내기 격자 간격 · 가장 멀리 (CSS px) */
export const PUSH = { step: 4, reach: 200 } as const;

let pushOffsets: readonly (readonly [number, number])[] | null = null;

/** 밀어낼 후보 (가까운 순, 같으면 위 · 왼쪽 먼저 — 정해진 순서) */
function offsets(): readonly (readonly [number, number])[] {
  if (pushOffsets) return pushOffsets;
  const n = Math.floor(PUSH.reach / PUSH.step);
  const out: [number, number][] = [];
  for (let j = -n; j <= n; j += 1)
    for (let i = -n; i <= n; i += 1) if (i !== 0 || j !== 0) out.push([i * PUSH.step, j * PUSH.step]);
  out.sort((a, b) => a[0] ** 2 + a[1] ** 2 - (b[0] ** 2 + b[1] ** 2) || a[1] - b[1] || a[0] - b[0]);
  pushOffsets = out;
  return out;
}

/** box에서 가장 가까운 놓을 수 있는 자리 (없으면 null) */
export function nearestFree(id: ControlId, box: Box, others: ControlBoxes, rules: PlaceRules): Box | null {
  if (placeOk(id, box, others, rules)) return box;
  for (const [dx, dy] of offsets()) {
    const c = clampBox({ ...box, x: box.x + dx, y: box.y + dy }, rules.range);
    if (placeOk(id, c, others, rules)) return c;
  }
  return null;
}

/** 기본 배치 (좌우 반전이면 뒤집은 것) */
export function baseBoxes(base: ControlBoxes, mirror: boolean, safe: Box): ControlBoxes {
  if (!mirror) return { ...base };
  const out: ControlBoxes = {};
  for (const id of CONTROL_IDS) {
    const b = base[id];
    if (b) out[id] = mirrorBox(b, safe);
  }
  return out;
}

/** 저장한 조작 하나의 지금 화면 사각형 (범위 안으로 자르기 전) */
export function placeBox(base: Box, p: ControlPlace, range: Box): Box {
  const s = clampScale(base, p.s);
  return clampBox(boxAt(p.u, p.v, Math.round(base.w * s), Math.round(base.h * s), range), range);
}

export interface Resolved {
  boxes: ControlBoxes;
  mirror: boolean;
  /** 바꾼 조작을 놓을 자리가 없어 기본 배치(반전이면 뒤집은 것)로 돌아갔다 */
  fallback: boolean;
}

/**
 * 실제 자리 (CSS px). base = 이 화면의 기본 배치(반전 전, 있는 조작만), safe = 안전 사각형, rules = 놓기 규칙.
 * 바꾸지 않은 조작은 기본 자리에 그대로 두고(피할 것), 바꾼 조작을 CONTROL_IDS 순서로 놓는다(앞에서 놓은 것도 피한다)
 */
export function resolveLayout(
  base: ControlBoxes,
  layout: TeamLayout | null,
  safe: Box,
  rules: PlaceRules,
): Resolved {
  const mirror = layout?.mirror === true;
  const def = baseBoxes(base, mirror, safe);
  const items = layout?.items ?? {};
  const ids = CONTROL_IDS.filter((id) => def[id] && items[id]);
  if (ids.length === 0) return { boxes: def, mirror, fallback: false };
  const placed: ControlBoxes = { ...def };
  for (const id of ids) delete placed[id];
  for (const id of ids) {
    const b0 = def[id];
    const p = items[id];
    if (!b0 || !p) continue;
    const box = nearestFree(id, placeBox(b0, p, rules.range), placed, rules);
    if (!box) return { boxes: def, mirror, fallback: true };
    placed[id] = box;
  }
  return { boxes: placed, mirror, fallback: false };
}

/** 사각형 + 크기 배율 → 저장할 비율 자리 */
export function placeOf(box: Box, s: number, range: Box): ControlPlace {
  return { ...ratioOf(box, range), s };
}

/** 좌우 반전을 바꿀 때 바꾼 조작도 같이 뒤집는다 (u → 1 − u) */
export function flipItems(
  items: Partial<Record<ControlId, ControlPlace>>,
): Partial<Record<ControlId, ControlPlace>> {
  const out: Partial<Record<ControlId, ControlPlace>> = {};
  for (const id of CONTROL_IDS) {
    const p = items[id];
    if (p) out[id] = { ...p, u: 1 - p.u };
  }
  return out;
}

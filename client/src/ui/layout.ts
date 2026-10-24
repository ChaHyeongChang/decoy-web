// 화면 배치. PC 논리 해상도 1920×1080. 월드 단위는 1타일 = 32px이고,
// 맵은 0.93배로 그려 위 · 아래에 HUD 띠(64px)를 만든다 (탈출구를 가리지 않게, DECISIONS D3).
// M12: 터치 모드는 판 시작 직전 configureLayout으로 화면비에 맞는 논리 크기 · 맵 자리 · HUD 배치를 고른다.
// 맵 배율(MAP_SCALE)은 모든 배치에서 같다(맵 · 캐릭터 그림 · 안개가 배율에 묶여 있다). 화면에 맞추는 것은 카메라 zoom이다.
// 아래 `export let` 값은 ES 모듈 라이브 바인딩이라 다른 모듈은 읽는 순간의 값을 본다. 판 중에는 바뀌지 않는다
// (판 중 창 크기가 바뀌면 논리 크기는 그대로 두고 zoom만 다시 맞춘다).
import { MAP_H, MAP_W, TILE_PX } from '@decoy/shared';

/** PC 논리 해상도 (PC는 언제나 이 크기) */
export const PC_VIEW_W = 1920;
export const PC_VIEW_H = 1080;
/** PC 위 · 아래 HUD 띠 높이 */
export const PC_HUD_BAND = 64;
/** 맵 배율: PC 기준(1080 − 띠 2개)으로 정하고 모든 배치에서 같다 */
export const MAP_SCALE = (PC_VIEW_H - PC_HUD_BAND * 2) / (MAP_H * TILE_PX);
export const MAP_PX_W = MAP_W * TILE_PX;
export const MAP_PX_H = MAP_H * TILE_PX;
/** 화면에 그려지는 맵 크기 (논리 px, 모든 배치에서 같다) */
export const MAP_DRAW_W = MAP_PX_W * MAP_SCALE;
export const MAP_DRAW_H = MAP_PX_H * MAP_SCALE;

/**
 * 배치 종류.
 * - pc: 1920×1080, 위 · 아래 띠 + 좌우 여백
 * - touchWide: 터치, 화면비 2:1 이상. 맵이 화면 높이 가득, HUD는 좌우 칸 위쪽, 아래쪽 좌우는 엄지 영역
 * - touchNarrow: 터치, 2:1보다 좁은 화면(16:9 등). 위 · 아래 띠를 남기고 엄지 영역이 맵 아래 구석에 겹친다
 */
export type LayoutKind = 'pc' | 'touchWide' | 'touchNarrow';

/** 한 배치의 기하 (논리 px) */
export interface LayoutInfo {
  kind: LayoutKind;
  /** 논리 해상도 */
  viewW: number;
  viewH: number;
  /** 맵 왼쪽 위 */
  mapX: number;
  mapY: number;
  /** 위 · 아래 띠 높이 (touchWide는 0) */
  hudBand: number;
  /** HUD 부품 배율 (PC 1). 터치는 글자 · 아이콘이 CSS 12px 이상이 되게 키운다 */
  uiScale: number;
  /** 적용한 판 배치 조정 (터치만, 설정 · 조작 배치). 없으면 기본값(DEFAULT_TUNING) */
  tuning?: LayoutTuning;
}

/**
 * 판 배치 조정 (설정 화면 통합, 터치만 — 화면 표시만 바꾸고 규칙 · 판정과 무관하다):
 * - stickScale: 조이스틱 크기 배율 (이동 · 조준 스틱 반지름, 버튼은 그대로) — 엄지 자리(thumbReserve)가 같은 식으로 비운다.
 *   1보다 크면 HUD가 들어가는 만큼만 (낮은 화면 — layoutFor)
 * - uiScale: UI 크기 배율 (터치 HUD 그림 단위 TOUCH_UI.art와 글자 CSS px, 띠 · 칸 최소 크기). 자리가 모자라면 들어가는 만큼만
 *   (layoutFor가 0.05씩 줄인다, 적용한 값이 tuning.uiScale)
 * - mirror: 좌우 반전 (왼손잡이). 터치 HUD 배치를 좌우로 뒤집는다 — 터치 화면(이동 스틱 오른쪽 · 엄지 버튼 왼쪽 아래 · 시스템
 *   버튼 왼쪽 위)과 같이
 * - sysSlots: 오른쪽 위 시스템 버튼 칸 수 (점수판 · 전체 화면 = 2, 판 중 설정 버튼까지 3 — SYS_SLOTS_MENU)
 */
export interface LayoutTuning {
  stickScale: number;
  uiScale: number;
  mirror: boolean;
  sysSlots: number;
}

export const DEFAULT_TUNING: Readonly<LayoutTuning> = Object.freeze({
  stickScale: 1,
  uiScale: 1,
  mirror: false,
  sysSlots: 2,
});

/** 판 중 설정 버튼까지 든 시스템 버튼 칸 수 (점수판 · 설정 · 전체 화면) */
export const SYS_SLOTS_MENU = 3;

/** 조정 값 정리: 빠진 칸 · 수가 아닌 값은 기본값, 범위 밖은 자른다 */
export function cleanTuning(t: Partial<LayoutTuning> | null | undefined): LayoutTuning {
  const num = (v: unknown, def: number, lo: number, hi: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : def;
  return {
    stickScale: num(t?.stickScale, 1, 0.5, 2),
    uiScale: num(t?.uiScale, 1, 1, 1.5),
    mirror: t?.mirror === true,
    sysSlots: Math.round(num(t?.sysSlots, 2, 1, 4)),
  };
}

function isDefaultTuning(t: LayoutTuning): boolean {
  const d = DEFAULT_TUNING;
  return (
    t.stickScale === d.stickScale &&
    t.uiScale === d.uiScale &&
    t.mirror === d.mirror &&
    t.sysSlots === d.sysSlots
  );
}

/** 배치의 조정 값 (없으면 기본값) */
export function tuningOf(l: Readonly<LayoutInfo>): Readonly<LayoutTuning> {
  return l.tuning ?? DEFAULT_TUNING;
}

/** PC 배치 */
export function pcLayout(): LayoutInfo {
  return {
    kind: 'pc',
    viewW: PC_VIEW_W,
    viewH: PC_VIEW_H,
    mapX: (PC_VIEW_W - MAP_DRAW_W) / 2,
    mapY: PC_HUD_BAND,
    hudBand: PC_HUD_BAND,
    uiScale: 1,
  };
}

// ───────────────────────── 터치 화면 수치 (M12) ─────────────────────────
// 그래픽 · 화면 수치라 판정과 무관하다(balance.json이 아니라 코드 상수, VISUAL_SPEC 8.6)

/** 손가락 화면 규칙 (CSS px = dp, M11): 가장자리 띠(좌우 안전 영역 + 32, 아래 + 24) · 대상 최소 크기 · 간격 */
export const EDGE_BAND = { side: 32, bottom: 24 } as const;
export const MIN_TARGET = 48;
export const MIN_GAP = 8;

/**
 * 터치 HUD (CSS px). 그림(HUD 아틀라스) 1단위 = art CSS px, 글자는 CSS px로 정한다(보조 12 · 주요 14 이상, 화면 높이와 상관없이).
 * - edge · gap: 칸 안 여백 · 부품 사이
 * - band: 16:9 화면 위 · 아래 띠 최소 높이(타이머 한 줄), bandStack: 좌우 칸이 없는 화면(태블릿 4:3)의 띠
 * - minSide: 좌우 칸 최소 폭(팀 카드 한 줄). 2:1 이상이어도 이보다 좁으면 16:9 배치를 쓴다
 * - zoneTop: 이동 스틱 그림 위로 남기는 이동 영역, hintH: 맨 아래 안내 줄 높이(가장자리 띠 24px 안 — 터치 대상이 없다)
 * - minimapMin: 미니맵을 보일 최소 폭(자리가 없으면 숨긴다 — 판 화면 전체가 늘 보여 같은 정보다)
 */
export const TOUCH_UI = {
  art: 0.68,
  font: { small: 12, main: 14, timer: 16 },
  edge: 6,
  gap: 6,
  band: 26,
  bandStack: 44,
  minSide: 88,
  zoneTop: 16,
  hintH: 20,
  minimapMin: 72,
} as const;

/**
 * 맵 창 안 미니맵 (따라가는 카메라, CSS px): 맵 가로의 frac · maxCss 이하, 맵 끝에서 margin. 엄지 버튼 무리는 화면 오른쪽
 * 절반 안에 있다고 보고(가장 왼쪽 포효 버튼도 그 안) 그 위 끝 위에서 멈춘다
 */
export const MINIMAP_INSET = { frac: 0.22, maxCss: 200, margin: 6, min: 60 } as const;

/**
 * 판 중 창이 낮아져 엄지 버튼이 옆 칸 미니맵을 덮었을 때 미니맵 틀을 옮길 자리 (논리 px, 틀 왼쪽 위). 확대 화면에서는 맵
 * 전체가 보이지 않아 미니맵이 필수라 숨기지 않고 맵 창 안 오른쪽 위 구석으로 옮긴다(검토 반영): 틀이 맵 안이고 피할 사각형
 * (엄지 버튼 · 시스템 버튼, 간격 gap)과 겹치지 않으면 그 자리, 아니면 null (그때는 예전처럼 숨긴다). 왼쪽은 이동 영역(화면 왼쪽
 * 40%)이 그 아래까지 올라와 있어 쓰지 않는다
 */
export function minimapFallback(
  map: { x: number; y: number; w: number; h: number },
  frame: { w: number; h: number },
  avoid: readonly { x: number; y: number; w: number; h: number }[],
  margin: number,
  gap: number,
): { x: number; y: number } | null {
  if (frame.w + margin * 2 > map.w || frame.h + margin * 2 > map.h) return null;
  const y = map.y + margin;
  const x = map.x + map.w - margin - frame.w;
  const free = avoid.every(
    (b) =>
      x >= b.x + b.w + gap || b.x >= x + frame.w + gap || y >= b.y + b.h + gap || b.y >= y + frame.h + gap,
  );
  return free ? { x, y } : null;
}

/**
 * 맵 창 안 미니맵 틀 사각형 (논리 px): 그림 자리(touchHudPlan minimapInset — 왼쪽 위 · 폭)에 틀 여백 · 제목 줄을 더한다.
 * s = 그림 1단위의 논리 px (HUD.s). 조작 배치를 바꾼 버튼이 이 틀을 피한다 (touchControls)
 */
export function minimapInsetFrame(i: { x: number; y: number; w: number }, s: number): Rect {
  const pad = TOUCH_PART.minimap.pad * s;
  const title = TOUCH_PART.minimap.title * s;
  return { x: i.x - pad, y: i.y - title, w: i.w + pad * 2, h: (i.w * MAP_H) / MAP_W + title + pad };
}

/** 터치 HUD 부품 크기 (그림 단위: × uiScale = 논리 px) */
export const TOUCH_PART = {
  /** 팀 카드 한 장 (실루엣 · 상태 아이콘 · 체력 칸 · 수감 눈금) */
  card: { w: 110, h: 44 },
  /** 거점 링 게이지 한 칸 (정사각) · 두 칸 사이 */
  gauge: 52,
  gaugeGap: 6,
  /** 타이머 틀 높이 · 안쪽 여백 · 아이콘 크기 · 아이콘과 숫자 사이 */
  timer: { h: 34, pad: 9, icon: 20, gap: 4 },
  /** 미니맵 틀 여백 · 제목 줄 */
  minimap: { pad: 6, title: 24 },
  /** 배너 리본 높이 (지속 · 알림) · 줄 사이 */
  ribbon: { h: 36, rowH: 32, gap: 6 },
  /** 맨 아래 안내 줄 (TOUCH_UI.hintH CSS px) 아이콘 */
  hintIcon: 20,
} as const;

/** 타이머 틀 폭 (CSS px): 숫자 5칸(12:00) 기준, '최후' 글자까지 */
const TIMER_CSS = { plain: 76, label: 100 } as const;

const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));

/**
 * 터치 화면 요소 크기 (CSS px). 화면 높이(안전 영역 안)에 비례(휴대폰 293~400px → 0.84~1.05배, 태블릿도 1.05배까지).
 * stickScale = 조이스틱 크기 설정 (이동 · 조준 스틱 반지름만, 버튼은 그대로)
 */
export function thumbMetrics(
  h: number,
  stickScale = 1,
): {
  k: number;
  pad: number;
  gap: number;
  rowGap: number;
  btn: number;
  aimR: number;
  ability: number;
  rescue: number;
  sysH: number;
  sysW: number;
  moveR: number;
} {
  const k = clamp(h / 380, 0.84, 1.05);
  return {
    k,
    pad: 6,
    gap: Math.round(14 * k),
    // 줄 사이는 아래 테두리에 걸친 이름표(약 9px)가 다음 줄에 닿지 않게 더 띄운다
    rowGap: Math.round(22 * k),
    btn: Math.max(52, Math.round(56 * k)),
    aimR: Math.round(60 * k * stickScale),
    ability: Math.round(78 * k),
    rescue: Math.max(52, Math.round(60 * k)),
    sysH: Math.max(MIN_TARGET, Math.round(50 * k)),
    sysW: Math.max(64, Math.round(66 * k)),
    moveR: Math.round(60 * k * stickScale),
  };
}

/**
 * 엄지 자리 (안전 영역 안 화면 기준 CSS px, touchControls.touchLayout과 같은 식): 오른쪽 아래 버튼 무리의 위 끝,
 * 오른쪽 위 시스템 버튼(점수판 + 전체 화면, 판 중 설정까지 — tune.sysSlots 칸)의 왼쪽 끝 · 아래 끝, 이동 스틱 그림 위 끝 ·
 * 이동 영역 아래 끝. tune.stickScale = 조이스틱 크기 (조준 스틱 · 이동 스틱 반지름)
 */
export function thumbReserve(
  w: number,
  h: number,
  monster: boolean,
  tune: Partial<LayoutTuning> = DEFAULT_TUNING,
): {
  clusterTop: number;
  sysLeft: number;
  sysBottom: number;
  moveTop: number;
  zoneBottom: number;
  /** 오른쪽 아래 버튼 무리의 버튼 · 조준 스틱 사각형 (touchControls.touchLayout과 같은 식) */
  cluster: Box[];
} {
  const t = thumbMetrics(h, tune.stickScale ?? 1);
  const slots = tune.sysSlots ?? DEFAULT_TUNING.sysSlots;
  const right = w - EDGE_BAND.side - t.pad;
  const bottom = h - EDGE_BAND.bottom - t.pad;
  const sq = (x: number, y: number, s: number): Box => ({ x, y, w: s, h: s });
  const cluster: Box[] = [];
  if (monster) {
    const r = t.aimR;
    const aim = sq(right - r * 2, bottom - r * 2, r * 2);
    const top = aim.y - t.rowGap - t.btn;
    const mode = sq(aim.x + r - t.btn / 2, top, t.btn);
    cluster.push(aim, sq(aim.x - t.gap - t.btn, aim.y + r - t.btn / 2, t.btn), mode);
    cluster.push(sq(mode.x - t.gap - t.btn, top, t.btn));
  } else {
    const a = t.ability;
    const rs = t.rescue;
    cluster.push(sq(right - a, bottom - a, a));
    cluster.push(sq(right - a - t.gap - rs, bottom - a / 2 - rs / 2 - Math.round(a * 0.3), rs));
  }
  const clusterTop = Math.min(...cluster.map((b) => b.y));
  const zoneBottom = h - EDGE_BAND.bottom;
  return {
    clusterTop,
    sysLeft: right - t.sysW * slots - t.gap * (slots - 1),
    sysBottom: t.pad + 2 + t.sysH,
    moveTop: zoneBottom - t.moveR * 2 - 16,
    zoneBottom,
    cluster,
  };
}

/**
 * 터치 화면 (CSS px)의 맵 크기 · 띠 · 배치 방식. ui = UI 크기 배율: 띠 · 칸 최소 크기(그림 단위 부품이 들어갈 자리)도 같이
 * 키운다 (맵이 그만큼 작아진다 — 보이는 타일 수는 같다)
 */
function touchShape(w: number, h: number, ui = 1): { kind: LayoutKind; band: number; mode: TouchHudMode } {
  const U = TOUCH_UI;
  const minSide = U.minSide * ui;
  const ratio = MAP_DRAW_W / MAP_DRAW_H;
  // 2:1 이상이고 맵을 화면 높이 가득 그려도 좌우 칸이 팀 카드 폭 이상이면 넓은 배치
  if (w >= h * 2 && (w - h * ratio) / 2 >= minSide) return { kind: 'touchWide', band: 0, mode: 'wide' };
  // 맵이 폭에 들어가는 최소 띠, 좌우 칸이 minSide가 되는 띠
  const fitMap = Math.max(0, (h * ratio - w) / (2 * ratio));
  const fitSide = Math.max(0, (h * ratio - w + 2 * minSide) / (2 * ratio));
  const column = Math.max(U.band * ui, fitMap, fitSide);
  if (column <= U.bandStack * ui) return { kind: 'touchNarrow', band: column, mode: 'column' };
  return { kind: 'touchNarrow', band: Math.max(U.bandStack * ui, fitMap), mode: 'band' };
}

/**
 * 화면(CSS px)과 입력 방식에 맞는 배치 (순수 함수). PC(touch=false)는 화면과 상관없이 언제나 pcLayout().
 * 터치는 가로 기준으로 정한다(세로로 받은 크기는 긴 변을 폭으로 본다: 세로로 열었다가 돌려 판을 시작하는 경우).
 * - touchWide(2:1 이상, 좌우 칸 ≥ TOUCH_UI.minSide): 논리 높이 = 맵 높이(띠 0), 논리 폭 = 높이 × 화면비. 상한을 두지 않고
 *   더 넓은 화면은 좌우 칸이 넓어진다(빈 여백 · 레터박스 없음, DECISIONS)
 * - touchNarrow: 위 · 아래 띠(CSS 26px 이상, 좌우 칸이 팀 카드 폭이 되게)를 남기고 논리 크기를 키워 맵을 줄인다.
 *   맵(3:2)보다 좁은 화면(태블릿 4:3 등)은 띠를 키워 HUD를 위 띠로 모은다
 * uiScale = 그림 1단위의 논리 px = TOUCH_UI.art × UI 크기 × (논리 px / CSS px)
 * tuning(터치만) = 조이스틱 크기 · UI 크기 · 좌우 반전 · 시스템 버튼 칸 수. 없거나 기본값이면 예전 배치 그대로(tuning 칸 없음).
 * UI 크기 · 조이스틱 크기가 1보다 크면 HUD가 맵 · 서로 · 엄지 자리와 겹치지 않고 점수판이 화면 폭에 들어가는 만큼만 키운다
 * (0.05씩 줄여 본다 — 적용한 값이 tuning에 남는다)
 */
export function layoutFor(
  screenW: number,
  screenH: number,
  touch: boolean,
  tuning?: Partial<LayoutTuning> | null,
): LayoutInfo {
  if (!touch) return pcLayout();
  const w = Math.max(1, Math.max(screenW, screenH));
  const h = Math.max(1, Math.min(screenW, screenH));
  const T = cleanTuning(tuning);
  const build = (ui: number, stickScale: number): LayoutInfo => {
    const shape = touchShape(w, h, ui);
    const cssMapH = h - shape.band * 2;
    // 논리 px / CSS px: 맵 높이(논리 MAP_DRAW_H)가 CSS cssMapH가 되게
    const L = MAP_DRAW_H / cssMapH;
    const viewH = MAP_DRAW_H + shape.band * 2 * L;
    const viewW = Math.round((viewH * w) / h);
    const tune = { ...T, uiScale: ui, stickScale };
    return {
      kind: shape.kind,
      viewW,
      viewH,
      mapX: (viewW - MAP_DRAW_W) / 2,
      mapY: shape.band * L,
      hudBand: shape.band * L,
      uiScale: TOUCH_UI.art * ui * L,
      ...(isDefaultTuning(tune) ? {} : { tuning: tune }),
    };
  };
  // 키운 값은 들어가는 만큼만: UI 크기를 먼저 0.05씩 줄이고, 그래도 안 되면(낮은 화면에서 조이스틱이 커 왼쪽 칸 팀 카드가
  // 이동 영역에 닿는다) 조이스틱 크기를 줄인다. 줄이거나 그대로인 값은 늘 들어간다(예전 배치보다 작다)
  const down = (v: number): number => Math.round((v - 0.05) * 100) / 100;
  for (let ui = T.uiScale; ui > 1 + 1e-9; ui = down(ui)) {
    const l = build(ui, T.stickScale);
    if (touchHudFits(l)) return l;
  }
  for (let st = T.stickScale; st > 1 + 1e-9; st = down(st)) {
    const l = build(1, st);
    if (touchHudFits(l)) return l;
  }
  return build(1, Math.min(1, T.stickScale));
}

let current: LayoutInfo = pcLayout();

/** 논리 해상도 */
export let VIEW_W = current.viewW;
export let VIEW_H = current.viewH;
/** 위 · 아래 HUD 띠 높이 (touchWide는 0) */
export let HUD_BAND = current.hudBand;
export let MAP_X = current.mapX;
export let MAP_Y = current.mapY;
/** 화면에 그려지는 맵 사각형 */
export let MAP_RECT = { x: MAP_X, y: MAP_Y, w: MAP_DRAW_W, h: MAP_DRAW_H };
/** 좌우 여백 폭 */
export let SIDE_W = MAP_X;

/** 지금 배치 */
export function layout(): Readonly<LayoutInfo> {
  return current;
}

// ───────────────────────── 카메라 (따라가는 카메라) ─────────────────────────
// 보이는 창은 맵 사각형(MAP_RECT, 모든 배치에서 같은 3:2 크기) 그대로이고, 그 안에 맵의 1/CAM_ZOOM(가로 · 세로)을
// 확대해 보인다. 그래서 보이는 타일 수는 기기 · 화면비와 상관없이 같다(넓은 화면이 더 보지 않는다). 확대 수준은 판 내내
// 고정이고 플레이어가 바꿀 수 없다(공정성, DECISIONS 9절). CAM은 카메라가 프레임마다 쓴다(render/camera.ts)

/** 기본 확대 수준 (맵 전체가 보이던 배율 대비, 1 = 맵 전체): ② 중간 — 창 16 × 10.7타일. 사용자가 고른 값 (DECISIONS 9절) */
export const DEFAULT_CAM_ZOOM = 3;

/** 카메라 확대 (맵 전체가 보이던 배율 대비). 1이면 맵 전체 (옛 고정 화면) */
export let CAM_ZOOM = 1;
/** 월드 그림 배율 (논리 px / 월드 px) = MAP_SCALE × CAM_ZOOM */
export let WORLD_SCALE = MAP_SCALE;
/**
 * 월드 위 선 굵기 배율 (논리 px 굵기에 곱한다) = √CAM_ZOOM. 확대한 만큼 그대로 굵히면(4배) 무겁고, 그대로 두면 큰 그림에서
 * 가늘어 보여 그 사이로 둔다. 판정 범위의 크기 · 모양과는 무관하다(선은 판정 경계 위에 그린다)
 */
export let WORLD_LINE = 1;
/** 보이는 범위 (타일) */
export let VIEW_TILES_W = MAP_W;
export let VIEW_TILES_H = MAP_H;
/** 카메라: 보이는 창 왼쪽 위의 맵 자리 (타일, 기기 픽셀 격자에 맞춘 값). 확대 1이면 늘 0 */
export const CAM = { x: 0, y: 0 };

/** 확대 수준을 정한다 (판 장면 · 그림 굽기가 읽기 전에). 확대 1이면 카메라를 맵 왼쪽 위에 둔다 */
export function setCamZoom(z: number): void {
  const zoom = Number.isFinite(z) && z >= 1 ? z : 1;
  CAM_ZOOM = zoom;
  WORLD_SCALE = MAP_SCALE * zoom;
  WORLD_LINE = Math.sqrt(zoom);
  VIEW_TILES_W = MAP_W / zoom;
  VIEW_TILES_H = MAP_H / zoom;
  if (zoom === 1) {
    CAM.x = 0;
    CAM.y = 0;
  }
}

/** 월드 위 선 굵기: 논리 px 굵기 → 월드 컨테이너 단위 (확대 선 배율 WORLD_LINE을 곱한다) */
export function worldLine(px: number): number {
  return (px * WORLD_LINE) / WORLD_SCALE;
}

/** 타일 좌표 → 화면 좌표 (카메라 반영) */
export function tileToScreen(x: number, y: number): { x: number; y: number } {
  const k = TILE_PX * WORLD_SCALE;
  return { x: MAP_X + (x - CAM.x) * k, y: MAP_Y + (y - CAM.y) * k };
}

/** 화면 좌표 → 타일 좌표 (카메라 반영) */
export function screenToTile(x: number, y: number): { x: number; y: number } {
  const k = TILE_PX * WORLD_SCALE;
  return { x: CAM.x + (x - MAP_X) / k, y: CAM.y + (y - MAP_Y) / k };
}

/** HUD 영역 (맵과 겹치지 않는다. touchWide는 위 · 아래 띠가 0 높이) */
function hudRects(l: LayoutInfo) {
  const side = l.mapX;
  return {
    topBand: { x: 0, y: 0, w: l.viewW, h: l.hudBand },
    bottomBand: { x: 0, y: l.viewH - l.hudBand, w: l.viewW, h: l.hudBand },
    leftSide: { x: 0, y: l.hudBand, w: side, h: l.viewH - l.hudBand * 2 },
    rightSide: { x: l.viewW - side, y: l.hudBand, w: side, h: l.viewH - l.hudBand * 2 },
  } as const;
}

export let HUD_RECTS = hudRects(current);

/**
 * 카메라 zoom = 백버퍼 px / 논리 px (M10a). 표시 CSS 크기 × 기기 픽셀 배율(품질 단계 상한 · ?scale 적용)로 정해져
 * 1보다 클 수 있다(맥북 배율 2 → 1.5). main.ts가 시작할 때와 창 크기 · DPR · 품질 · 배치가 바뀔 때 정한다 (render/resolution.ts)
 */
export let RENDER_SCALE = 1;

export function setRenderScale(v: number): void {
  RENDER_SCALE = v;
}

/** 장면 카메라를 논리 해상도에 맞춘다: 백버퍼 전체에 논리 화면이 꽉 차게 zoom */
export function fitCamera(camera: {
  setZoom(z: number): unknown;
  setOrigin(x: number, y: number): unknown;
}): void {
  camera.setOrigin(0, 0);
  camera.setZoom(RENDER_SCALE);
}

// ───────────────────────── 터치 HUD 배치 (M12, 순수) ─────────────────────────

/** 터치 HUD 배치 방식: 넓은 화면(좌우 칸) · 16:9(위 띠 타이머 + 좌우 칸) · 좌우 칸이 없는 화면(위 띠에 모두) */
export type TouchHudMode = 'wide' | 'column' | 'band';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 역할별 터치 HUD 자리 (논리 px). 오른쪽 아래 엄지 무리가 역할마다 달라 오른쪽 칸(게이지 · 미니맵) 자리가 다르다 */
export interface TouchHudPlan {
  /** 타이머 틀 가운데 · 폭 · 높이, '최후' 글자를 쓸 자리가 있는가 */
  timer: { x: number; y: number; w: number; h: number; label: boolean };
  /** 거점 링 게이지 가운데 */
  gaugeA: { x: number; y: number };
  gaugeB: { x: number; y: number };
  /** 팀 카드 격자: 첫 카드 왼쪽 위, 한 장 크기, 열 수, 간격 */
  cards: { x: number; y: number; w: number; h: number; cols: number; gap: number };
  /** 미니맵 그림 왼쪽 위 · 폭 (틀 · 제목은 바깥). 자리가 없으면 null */
  minimap: { x: number; y: number; w: number } | null;
  /**
   * 옆 칸에 자리가 없을 때 맵 창 안 오른쪽 위에 둘 미니맵 (그림 왼쪽 위 · 폭, 틀 · 제목은 바깥 — 틀까지 맵 창 안).
   * 따라가는 카메라(확대 화면)에서만 쓴다(minimap.ts): 확대 1이면 맵 전체가 보여 필요 없다. 엄지 버튼 · 시스템 버튼과
   * 겹치지 않는다. rects에는 넣지 않는다(맵 밖 부품 목록 — 이동 영역 시작 · 덮임 판단에 쓰지 않는다)
   */
  minimapInset: { x: number; y: number; w: number } | null;
  /** 늘 떠 있는 부품 사각형 (맵 · 엄지 영역과 겹치지 않는다, 터치 화면이 이동 영역을 이 아래에서 시작한다) */
  rects: { id: string; rect: Rect }[];
}

export interface TouchHud {
  mode: TouchHudMode;
  /** 좌우 반전 (조작 배치 '좌우 반전'): 시스템 버튼이 왼쪽 위, 엄지 버튼 무리가 왼쪽 아래, 타이머 · 팀 카드가 오른쪽 칸 */
  mirror: boolean;
  /** 논리 px / CSS px (배치를 정한 화면 기준) */
  L: number;
  /** 배치를 정한 화면 (CSS px, 안전 영역 안) */
  cssW: number;
  cssH: number;
  monster: TouchHudPlan;
  survivor: TouchHudPlan;
  /** 맨 아래 안내 줄 가운데 y · 높이 (가장자리 띠 안이라 터치 대상과 겹치지 않는다) */
  hint: { y: number; h: number };
  /** 배너 · 메모가 들어갈 자리: 맵 안 가로 범위, 위 끝 (오른쪽 위 버튼이 맵에 걸치면 그 아래) */
  overlay: { x0: number; x1: number; top: number };
  /**
   * 점수판: 세로 범위, 오른쪽 위 시스템 버튼 왼쪽 끝 · 아래 끝 (가로로 걸치면 그 아래에서 시작). 좌우 반전이면 시스템 버튼이
   * 왼쪽 위라 그 오른쪽 끝(sysRight)과 견준다
   */
  score: { top: number; bottom: number; sysLeft: number; sysRight: number; sysBottom: number };
}

/** CSS 사각형 */
interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 역할 하나의 자리 (CSS px) */
function planCss(
  W: number,
  H: number,
  mode: TouchHudMode,
  band: number,
  mapLeft: number,
  monster: boolean,
  map: Box,
  T: Readonly<LayoutTuning> = DEFAULT_TUNING,
): {
  timer: Box & { label: boolean };
  gaugeA: Box;
  gaugeB: Box;
  cards: Box & { cols: number; cw: number; ch: number };
  minimap: Box | null;
  inset: Box | null;
} {
  const U = TOUCH_UI;
  const P = TOUCH_PART;
  // 그림 1단위 CSS px (UI 크기 배율). 타이머 틀 폭도 같은 배율 (숫자 글자가 같이 커진다)
  const a = U.art * T.uiScale;
  const timerCss = { plain: TIMER_CSS.plain * T.uiScale, label: TIMER_CSS.label * T.uiScale };
  const r = thumbReserve(W, H, monster, T);
  const cardW = P.card.w * a;
  const cardH = P.card.h * a;
  const g = P.gauge * a;
  const pairW = g * 2 + P.gaugeGap * a;
  const timerH = P.timer.h * a;
  const grid = (cols: number): { w: number; h: number } => {
    const rows = Math.ceil(3 / cols);
    return { w: cols * cardW + (cols - 1) * U.gap, h: rows * cardH + (rows - 1) * U.gap };
  };
  const pairAt = (x: number, y: number): [Box, Box] => [
    { x, y, w: g, h: g },
    { x: x + g + P.gaugeGap * a, y, w: g, h: g },
  ];

  if (mode === 'band') {
    // 위 띠에 모두: 가운데 타이머, 그 왼쪽 링 게이지 둘, 맨 왼쪽 팀 카드 한 줄. 미니맵은 자리가 없어 숨긴다
    const cy = band / 2;
    const timerW = timerCss.label;
    const timer = { x: W / 2 - timerW / 2, y: cy - timerH / 2, w: timerW, h: timerH, label: true };
    const gr = grid(3);
    const cards = { x: U.edge, y: cy - gr.h / 2, w: gr.w, h: gr.h, cols: 3, cw: cardW, ch: cardH };
    // 카드 줄과 닿으면 게이지를 타이머 오른쪽으로
    const leftX = timer.x - U.gap * 2 - pairW;
    const gx = leftX >= cards.x + cards.w + U.gap * 2 ? leftX : timer.x + timer.w + U.gap * 2;
    const [ga, gb] = pairAt(gx, cy - g / 2);
    return { timer, gaugeA: ga, gaugeB: gb, cards, minimap: null, inset: insetCss(map, r, a) };
  }

  const cw = mapLeft;
  const colW = cw - U.edge * 2;
  const leftLimit = r.moveTop - U.zoneTop;
  const rightTop = r.sysBottom + MIN_GAP;
  const rightLimit = r.clusterTop - MIN_GAP;
  const cols = clamp(Math.floor((colW + U.gap) / (cardW + U.gap)), 1, 3);
  const gr = grid(cols);
  const wide = mode === 'wide';
  const timerW = Math.min(colW, timerCss.label);
  const label = !wide || timerW >= timerCss.label;
  const timerWidth = wide ? timerW : timerCss.label;
  const center = (w: number): number => (cw - w) / 2;
  const rightCenter = (w: number): number => W - cw + (cw - w) / 2;
  // 넓은 화면: 왼쪽 칸 맨 위에 타이머. 16:9: 위 띠 가운데
  const timerAt = (x: number, y: number): Box & { label: boolean } => ({
    x,
    y,
    w: timerWidth,
    h: timerH,
    label,
  });
  // 16:9 위 띠: 가운데. 오른쪽 위 시스템 버튼(판 중 설정까지 세 칸)에 닿으면 그 왼쪽으로 (왼쪽 칸 끝은 넘지 않는다)
  const bandX = Math.max(
    Math.min(W / 2 - timerWidth / 2, r.sysLeft - U.gap - timerWidth),
    Math.min(W / 2 - timerWidth / 2, cw + U.gap),
  );
  const timerTop = wide ? timerAt(center(timerWidth), U.edge) : timerAt(bandX, band / 2 - timerH / 2);
  const top = wide ? U.edge + timerH + U.gap : U.edge;

  // 후보 (앞에서부터): ① 타이머 옆에 게이지(넓은 칸) ② 왼쪽 칸에 게이지 · 카드 ③ 게이지는 오른쪽 칸(시스템 버튼 아래)
  type Cand = {
    timer: Box & { label: boolean };
    pair: { x: number; y: number };
    cardsY: number;
    rightY: number;
  };
  const cands: Cand[] = [];
  // 타이머 + 게이지 한 줄 (가운데 맞춤). 자리가 모자라면 '최후' 글자 없이 (색 + 문 아이콘이 같은 뜻)
  for (const tw of wide ? [timerWidth, timerCss.plain] : []) {
    if (colW < tw + U.gap + pairW || cands.length > 0) continue;
    const x0 = center(tw + U.gap + pairW);
    cands.push({
      timer: { x: x0, y: U.edge + (g - timerH) / 2, w: tw, h: timerH, label: tw >= timerCss.label },
      pair: { x: x0 + tw + U.gap, y: U.edge },
      cardsY: U.edge + g + U.gap + 2,
      rightY: rightTop,
    });
  }
  cands.push({
    timer: timerTop,
    pair: { x: center(pairW), y: top },
    cardsY: top + g + U.gap + 2,
    rightY: rightTop,
  });
  cands.push({
    timer: timerTop,
    pair: { x: rightCenter(pairW), y: rightTop },
    cardsY: top,
    rightY: rightTop + g + U.gap,
  });
  // 넘치는 양: 왼쪽 칸은 이동 영역이 조금 줄어드는 것, 오른쪽 칸은 버튼과 겹치는 것이라 훨씬 무겁게 친다
  const over = (c: Cand): number =>
    Math.max(0, c.cardsY + gr.h - leftLimit) +
    (c.pair.x < W / 2 ? 0 : Math.max(0, c.pair.y + g - rightLimit) * 100);
  const pick = cands.find((c) => over(c) === 0) ?? [...cands].sort((p, q) => over(p) - over(q))[0]!;
  const timerBox = pick.timer;
  const [ga, gb] = pairAt(pick.pair.x, pick.pair.y);
  const cards = { x: center(gr.w), y: pick.cardsY, w: gr.w, h: gr.h, cols, cw: cardW, ch: cardH };
  // 미니맵: 오른쪽 칸 남는 자리 (3:2 + 제목 · 틀). 최소 폭보다 좁으면 숨긴다
  const mm = P.minimap;
  const avail = rightLimit - pick.rightY - (mm.title + mm.pad) * a;
  const mmW = Math.min(colW - mm.pad * 2 * a, (avail * MAP_W) / MAP_H);
  const minimap =
    mmW >= U.minimapMin
      ? {
          x: rightCenter(mmW),
          y: pick.rightY + mm.title * a,
          w: mmW,
          h: (mmW * MAP_H) / MAP_W,
        }
      : null;
  return {
    timer: timerBox,
    gaugeA: ga,
    gaugeB: gb,
    cards,
    minimap,
    inset: minimap ? null : insetCss(map, r, a),
  };
}

/**
 * 맵 창 안 미니맵 자리 (CSS px, 그림 사각형 — 틀 · 제목은 바깥). 후보 둘: ① 맵 오른쪽 위 구석(시스템 버튼이 맵에 걸치면 그
 * 아래) ② 시스템 버튼 왼쪽의 맵 위 끝. 틀이 엄지 버튼(실제 버튼 사각형 + 최소 간격)과 겹치지 않는 가장 큰 폭으로 줄이고, 더 큰
 * 쪽을 고른다(같으면 ①). 최소 폭(MINIMAP_INSET.min — 확대 화면에서는 미니맵이 필수라 옆 칸 미니맵보다 작게 허용)보다 작으면 null.
 * 버튼과 가로로 겹치지 않으면 그 버튼 높이와 상관없다 (검토 반영: 예전에는 오른쪽 절반이면 무리 맨 위 끝에서 멈춰, 낮은 16:9
 * 화면의 괴물이 옆 칸 · 안쪽 미니맵을 둘 다 못 받았다)
 */
function insetCss(
  map: Box,
  r: { sysLeft: number; sysBottom: number; cluster: readonly Box[] },
  a: number = TOUCH_UI.art,
): Box | null {
  const mm = TOUCH_PART.minimap;
  const pad = mm.pad * a;
  const title = mm.title * a;
  const M = MINIMAP_INSET.margin;
  const full = Math.min(map.w * MINIMAP_INSET.frac, MINIMAP_INSET.maxCss);
  const ratio = MAP_H / MAP_W;
  const clear = (f: Box): boolean =>
    r.cluster.every(
      (b) =>
        f.x >= b.x + b.w + MIN_GAP ||
        b.x >= f.x + f.w + MIN_GAP ||
        f.y >= b.y + b.h + MIN_GAP ||
        b.y >= f.y + f.h + MIN_GAP,
    );
  const fit = (right: number, top: number): Box | null => {
    // 맵 아래 끝 안
    let w = Math.min(full, (map.y + map.h - M - top - title - pad) / ratio);
    // 엄지 버튼과 겹치지 않을 때까지 1 CSS px씩 줄인다 (배치를 정할 때 한 번, 200번 안)
    while (w >= MINIMAP_INSET.min) {
      const frame = { x: right - w - pad * 2, y: top, w: w + pad * 2, h: title + w * ratio + pad };
      if (clear(frame)) break;
      w -= 1;
    }
    if (w < MINIMAP_INSET.min) return null;
    return { x: right - pad - w, y: top + title, w, h: w * ratio };
  };
  const mapRight = map.x + map.w;
  const intrude = r.sysLeft < mapRight;
  const a1 = fit(mapRight - M, intrude ? Math.max(map.y + M, r.sysBottom + MIN_GAP) : map.y + M);
  const a2 = intrude ? fit(Math.min(mapRight - M, r.sysLeft - MIN_GAP), map.y + M) : null;
  if (a1 && a2) return a2.w > a1.w + 0.5 ? a2 : a1;
  return a1 ?? a2;
}

/**
 * 점수판 패널 최대 폭 (그림 단위): overlays.ts 생존자 표 COLS_TEAM_TOUCH.w 670 + 좌우 TOUCH_BOARD.pad 20. UI 크기를 키울 때 화면
 * 폭 안에 들어가는지 본다 (touch-hud 단위 시험이 overlays.ts 값과 대조한다)
 */
export const TOUCH_BOARD_W = 710;

/** 이동 스틱이 생기는 영역: 화면 왼쪽(좌우 반전이면 오른쪽) 이 비율 안 (touchControls.touchLayout) */
export const MOVE_ZONE_RATIO = 0.4;

/** 겹치는가 (닿기만 하면 아니다) */
function overlapsCss(a: Box, b: Box, eps = 0.01): boolean {
  return a.x < b.x + b.w - eps && b.x < a.x + a.w - eps && a.y < b.y + b.h - eps && b.y < a.y + a.h - eps;
}

/** 늘 떠 있는 부품 사각형 (CSS px, 좌우 반전 전): 타이머 · 게이지 둘 · 팀 카드 셋 · 옆 칸 미니맵 틀 */
function planBoxes(p: ReturnType<typeof planCss>, a: number): { id: string; box: Box }[] {
  const out: { id: string; box: Box }[] = [
    { id: 'timer', box: p.timer },
    { id: 'gaugeA', box: p.gaugeA },
    { id: 'gaugeB', box: p.gaugeB },
  ];
  const c = p.cards;
  for (let i = 0; i < 3; i += 1)
    out.push({
      id: `card${i}`,
      box: {
        x: c.x + (i % c.cols) * (c.cw + TOUCH_UI.gap),
        y: c.y + Math.floor(i / c.cols) * (c.ch + TOUCH_UI.gap),
        w: c.cw,
        h: c.ch,
      },
    });
  if (p.minimap) {
    const m = TOUCH_PART.minimap;
    const pad = m.pad * a;
    out.push({
      id: 'minimap',
      box: {
        x: p.minimap.x - pad,
        y: p.minimap.y - m.title * a,
        w: p.minimap.w + pad * 2,
        h: p.minimap.h + (m.title + m.pad) * a,
      },
    });
  }
  return out;
}

/** 터치 HUD 배치의 CSS 기하 (touchHudPlan · touchHudFits 공통) */
function touchGeom(l: LayoutInfo): {
  T: Readonly<LayoutTuning>;
  a: number;
  L: number;
  W: number;
  H: number;
  band: number;
  mapLeft: number;
  mapCss: Box;
  mode: TouchHudMode;
} {
  const U = TOUCH_UI;
  const T = tuningOf(l);
  // 그림 1단위 CSS px (UI 크기 배율까지)
  const a = U.art * T.uiScale;
  const L = l.uiScale / a;
  const W = l.viewW / L;
  const H = l.viewH / L;
  const band = l.hudBand / L;
  const mapLeft = l.mapX / L;
  const mode: TouchHudMode =
    l.kind === 'touchWide' ? 'wide' : mapLeft >= U.minSide * T.uiScale - 0.5 ? 'column' : 'band';
  const mapCss: Box = { x: mapLeft, y: l.mapY / L, w: MAP_DRAW_W / L, h: MAP_DRAW_H / L };
  return { T, a, L, W, H, band, mapLeft, mapCss, mode };
}

/**
 * UI 크기를 키운 배치가 들어가는가 (layoutFor가 UI 크기를 고를 때): 두 역할 모두 늘 떠 있는 부품이 화면 안이고 맵 · 서로 · 엄지
 * 자리(버튼 무리 · 시스템 버튼 칸 · 이동 스틱 그림 위 이동 영역)와 겹치지 않고, 점수판이 화면 폭에 들어간다
 */
function touchHudFits(l: LayoutInfo): boolean {
  const U = TOUCH_UI;
  const g = touchGeom(l);
  const { W, H, a } = g;
  if (TOUCH_BOARD_W * a + U.edge * 2 > W) return false;
  for (const monster of [true, false]) {
    const p = planCss(W, H, g.mode, g.band, g.mapLeft, monster, g.mapCss, g.T);
    const r = thumbReserve(W, H, monster, g.T);
    const sys: Box = { x: r.sysLeft, y: 0, w: W - r.sysLeft, h: r.sysBottom };
    const boxes = planBoxes(p, a).map((b) => b.box);
    for (const [i, b] of boxes.entries()) {
      if (b.x < -0.01 || b.y < -0.01 || b.x + b.w > W + 0.01 || b.y + b.h > H + 0.01) return false;
      if (overlapsCss(b, g.mapCss) || overlapsCss(b, sys)) return false;
      if (r.cluster.some((c) => overlapsCss(b, c))) return false;
      if (b.x < W * MOVE_ZONE_RATIO && b.y + b.h > r.moveTop - U.zoneTop + 0.01) return false;
      for (const o of boxes.slice(i + 1)) if (overlapsCss(b, o)) return false;
    }
  }
  return true;
}

/**
 * 터치 HUD 배치 (순수). 화면(CSS) 기준으로 정하고 논리 px로 돌려준다. 늘 떠 있는 부품은 맵 사각형 · 엄지 영역
 * (오른쪽 아래 버튼 무리 · 오른쪽 위 시스템 버튼 · 이동 스틱 그림)과 겹치지 않는다(tests/unit/touch-hud.test.ts).
 * 좌우 반전(tuning.mirror)이면 다 정한 뒤 좌우로 뒤집는다 (게이지는 A가 왼쪽 그대로 — 둘의 자리를 맞바꾼다)
 */
export function touchHudPlan(l: LayoutInfo): TouchHud | null {
  if (l.kind === 'pc') return null;
  const U = TOUCH_UI;
  const { T, a, L, W, H, band, mapLeft, mapCss, mode } = touchGeom(l);
  const mapH = mapCss.h;
  const toL = (b: Box): Rect => ({ x: b.x * L, y: b.y * L, w: b.w * L, h: b.h * L });
  // 좌우 반전: CSS 사각형을 화면 가운데 기준으로 뒤집는다
  const flip = (b: Box): Box => (T.mirror ? { ...b, x: W - b.x - b.w } : b);
  const plan = (monster: boolean): TouchHudPlan => {
    const p = planCss(W, H, mode, band, mapLeft, monster, mapCss, T);
    const ga = flip(T.mirror ? p.gaugeB : p.gaugeA);
    const gb = flip(T.mirror ? p.gaugeA : p.gaugeB);
    const c = p.cards;
    const gridW = c.cols * c.cw + (c.cols - 1) * U.gap;
    const cards = { ...c, x: flip({ x: c.x, y: c.y, w: gridW, h: c.h }).x };
    const timer = { ...flip(p.timer), label: p.timer.label };
    const minimap = p.minimap ? flip(p.minimap) : null;
    const inset = p.inset ? flip(p.inset) : null;
    const rects = planBoxes({ ...p, timer, gaugeA: ga, gaugeB: gb, cards, minimap }, a).map((b) => ({
      id: b.id,
      rect: toL(b.box),
    }));
    return {
      timer: {
        ...toL(timer),
        x: (timer.x + timer.w / 2) * L,
        y: (timer.y + timer.h / 2) * L,
        label: timer.label,
      },
      gaugeA: { x: (ga.x + ga.w / 2) * L, y: (ga.y + ga.h / 2) * L },
      gaugeB: { x: (gb.x + gb.w / 2) * L, y: (gb.y + gb.h / 2) * L },
      cards: {
        x: cards.x * L,
        y: cards.y * L,
        w: cards.cw * L,
        h: cards.ch * L,
        cols: cards.cols,
        gap: U.gap * L,
      },
      minimap: minimap ? { x: minimap.x * L, y: minimap.y * L, w: minimap.w * L } : null,
      minimapInset: inset ? { x: inset.x * L, y: inset.y * L, w: inset.w * L } : null,
      rects,
    };
  };
  // 배너 · 메모: 맵 안. 오른쪽 위 시스템 버튼(전체 화면까지)이 맵에 걸치면 그 아래에서 시작한다 (좌우 반전이면 왼쪽 위 — 같은 식)
  const mapRight = mapLeft + mapCss.w;
  const r = thumbReserve(W, H, true, T);
  const tile = mapH / MAP_H;
  const intrude = r.sysLeft < mapRight;
  const top = Math.max(band + tile * 3.1, intrude ? r.sysBottom + U.gap : 0);
  return {
    mode,
    mirror: T.mirror,
    L,
    cssW: W,
    cssH: H,
    monster: plan(true),
    survivor: plan(false),
    hint: { y: (H - U.hintH / 2 - 2) * L, h: U.hintH * L },
    overlay: { x0: (mapLeft + U.edge) * L, x1: (mapRight - U.edge) * L, top: top * L },
    score: {
      top: U.edge * L,
      bottom: (H - U.hintH - 4) * L,
      sysLeft: (r.sysLeft - U.gap) * L,
      sysRight: (W - r.sysLeft + U.gap) * L,
      sysBottom: (r.sysBottom + U.gap) * L,
    },
  };
}

/**
 * HUD 글자 크기 (논리 px). PC는 M10c 값 그대로, 터치는 CSS px 하한(보조 12 · 주요 14)을 논리 px로. UI 크기(tuning.uiScale)를
 * 키우면 글자 CSS px도 같은 배율 (하한 아래로는 내려가지 않는다 — 배율은 1 이상)
 */
function hudFonts(l: LayoutInfo) {
  if (l.kind === 'pc')
    return {
      gaugeLetter: 20,
      timer: 28,
      timerLabel: 15,
      cardName: 18,
      small: 15,
      slotSecs: 22,
      slotLabel: 17,
      hint: 17,
      mapTitle: 15,
      banner: 26,
      bannerRow: 21,
      note: 23,
      noteLine: 8,
      boardTitle: 22,
      boardRow: 18,
      boardCell: 17,
      ctrlKey: 15,
      ctrlNote: 15,
      ctrlDesc: 18,
      ctrlGoal: 17,
    };
  const ui = tuningOf(l).uiScale;
  const L = l.uiScale / (TOUCH_UI.art * ui);
  const F = TOUCH_UI.font;
  const px = (css: number): number => Math.ceil(css * ui * L * 10) / 10;
  return {
    gaugeLetter: px(F.main),
    timer: px(F.timer),
    timerLabel: px(F.small),
    cardName: px(F.main),
    small: px(F.small),
    slotSecs: px(F.main),
    slotLabel: px(F.main),
    hint: px(F.small),
    mapTitle: px(F.small),
    banner: px(F.main + 1),
    bannerRow: px(F.main),
    note: px(F.main),
    noteLine: px(4),
    boardTitle: px(F.main + 1),
    boardRow: px(F.main),
    boardCell: px(F.small + 1),
    ctrlKey: px(F.small),
    ctrlNote: px(F.small),
    ctrlDesc: px(F.small + 1),
    ctrlGoal: px(F.small),
  };
}

/**
 * HUD 배치 (M10c, VISUAL_SPEC 8장). 부품의 위치 · 크기는 여기서만 읽는다(M12 터치 배치가 같은 부품을 다시 배치한다).
 * 판에 늘 떠 있는 부품(위 띠 · 팀 카드 · 행동 칸 · 미니맵)은 맵 사각형과 겹치지 않게 위 · 아래 띠와 좌우 여백에 둔다.
 * 배너 · 메모 · 조작 안내 · 점수판은 잠깐 뜨는 덮개라 맵 위에 둔다(탈출구 · 감옥을 비킨 자리).
 * PC: 위 띠 오른쪽(x 1490 이후)과 아래 띠 오른쪽은 비워 둔다(선명도 탐침 자리, m10-resolution).
 * 터치 배치(touchWide · touchNarrow)는 touch(touchHudPlan)에 부품 자리를 두고, 아틀라스로 굽는 크기(gauge · timer.h ·
 * hint.h · banner)는 그림 단위(× s = 논리 px)다. PC는 s = 1이라 두 단위가 같다
 */
const GAUGE = { dia: 38, chip: 24, barW: 212, barH: 22, gap: 6 } as const;
const GAUGE_W = GAUGE.dia + GAUGE.gap + GAUGE.chip + 8 + GAUGE.barW;
const TIMER_W = 156;

function hudFor(l: LayoutInfo) {
  const side = l.mapX;
  const band = l.hudBand;
  const touch = touchHudPlan(l);
  const s = l.uiScale;
  const tileY = TILE_PX * MAP_SCALE;
  const P = TOUCH_PART;
  return {
    /** 그림 배율 (그림 단위 → 논리 px, PC 1) */
    s,
    /** 글자 크기 (논리 px) */
    font: hudFonts(l),
    /** 터치 HUD 자리 (PC는 null) */
    touch,
    /** 위 띠 가운데 타이머 틀 (가운데 x, y) */
    timer: touch
      ? { x: touch.survivor.timer.x, y: touch.survivor.timer.y, w: touch.survivor.timer.w, h: P.timer.h }
      : { x: l.viewW / 2, y: band / 2, w: TIMER_W, h: 44 },
    /** 거점 게이지: 배지 ◇ · 상태 칩 · 막대. A는 타이머 왼쪽, B는 오른쪽에 좌우 대칭(배지가 바깥). 터치는 링 게이지(배지 · 칩) */
    gauge: touch ? { ...GAUGE, dia: 34, chip: 20, w: P.gauge } : { ...GAUGE, w: GAUGE_W },
    /** 배지 쪽 바깥 끝 x (A = 왼쪽 끝, B = 오른쪽 끝) */
    gaugeA: { x: l.viewW / 2 - TIMER_W / 2 - 14 - GAUGE_W, y: band / 2 },
    gaugeB: { x: l.viewW / 2 + TIMER_W / 2 + 14 + GAUGE_W, y: band / 2 },
    /** 왼쪽 팀 카드 (생존자 화면 h, 괴물 화면 익명 카드 hAnon) */
    leftCards: { x: 14, y: band + 14, w: side - 28, h: 124, hAnon: 96, gap: 10 },
    /** 미니맵 그림 자리 (틀은 바깥으로 pad, 위로 제목 줄 title) */
    minimap: touch
      ? { x: 0, y: 0, w: 0, pad: P.minimap.pad, title: P.minimap.title }
      : { x: l.viewW - side + 12, y: band + 38, w: side - 24, pad: 6, title: 30 },
    /** 아래 띠 가운데 y */
    bottom: { y: touch ? touch.hint.y : l.viewH - band / 2 },
    /** 행동 칸: 아이콘 타일 + 이름 + 키캡 한 칸의 폭 · 간격 · 타일 한 변 */
    slot: { w: 176, gap: 12, tile: 56 },
    /** 아래 띠 안내 줄 (수감 · 관전 · 괴물 대기: 행동 칸 대신) 높이 (그림 단위). 터치는 UI 크기와 상관없이 CSS hintH (가장자리 띠 안) */
    hint: { h: touch ? TOUCH_UI.hintH / (TOUCH_UI.art * tuningOf(l).uiScale) : 42 },
    /** 배너는 북쪽 탈출구 판정 원(맵 y 3타일)보다 아래. 지속 배너 · 알림 두 줄의 가운데 y와 높이 */
    bannerY: l.mapY + 4.2 * tileY,
    banner: touch ? { h: P.ribbon.h, rowH: P.ribbon.rowH, rowGap: 50 } : { h: 46, rowH: 40, rowGap: 50 },
    /** 메모 상자 위쪽 y (알림 두 줄 아래, 감옥(맵 y 14타일)보다 위) · 글자 폭 */
    noteY: l.mapY + 8.7 * tileY,
    noteW: touch ? touch.overlay.x1 - touch.overlay.x0 - 58 * s : 900,
    /** 첫 판 조작 안내 (맵 아래쪽 1/3 가운데) · Tab 점수판 (화면 가운데) */
    tutorialY: l.viewH * 0.76,
    scoreY: l.viewH / 2,
  } as const;
}

export type HudLayoutSpec = ReturnType<typeof hudFor>;

export let HUD: HudLayoutSpec = hudFor(current);

/**
 * 배치를 적용한다 (main.ts가 판 장면을 만들기 직전에 부른다). 위 값들(VIEW_W · MAP_X · HUD …)이 모두 바뀐다.
 * 판 장면 · HUD는 만들 때 읽으므로 판 중에는 부르지 않는다. tuning = 터치 판 배치 조정 (LayoutTuning, PC는 무시)
 */
export function configureLayout(
  screenW: number,
  screenH: number,
  touch: boolean,
  tuning?: Partial<LayoutTuning> | null,
): Readonly<LayoutInfo> {
  applyLayout(layoutFor(screenW, screenH, touch, tuning));
  return current;
}

/** 배치 값을 그대로 적용한다 (configureLayout · 단위 테스트) */
export function applyLayout(l: LayoutInfo): void {
  current = { ...l };
  VIEW_W = l.viewW;
  VIEW_H = l.viewH;
  HUD_BAND = l.hudBand;
  MAP_X = l.mapX;
  MAP_Y = l.mapY;
  MAP_RECT = { x: l.mapX, y: l.mapY, w: MAP_DRAW_W, h: MAP_DRAW_H };
  SIDE_W = l.mapX;
  HUD_RECTS = hudRects(current);
  HUD = hudFor(current);
}

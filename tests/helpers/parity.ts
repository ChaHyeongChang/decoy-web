// 의상 유불리 점검 공용 (판 밖 메타 c, tests/unit/costume-parity*.test.ts). 잴 크기 · 프레임 · 화면 방향 · 위상을 게임 코드에서
// 구하고, 그림을 Node에서 칠해(client/src/art/chars/measure.ts drawingRaster — Canvas2D처럼 명령마다 칸 단위로 겹친다) 기본
// 그림과 견준다. 기준 · 그 이유는 tests/unit/costume-parity.test.ts 머리 주석에 있다.
import { describe, expect, it } from 'vitest';
import { TILE_PX, type MonsterCostumeId, type SurvivorCostumeId } from '@decoy/shared';
import {
  BASIC_COSTUME_SET,
  MONSTER_BOX,
  newStyleFrameSpecs,
  type CharFrameSpec,
  type CostumeSet,
} from '../../client/src/art/charFrames';
import { registerAllCostumeArt } from '../../client/src/art/chars/costume/art';
import type { Drawing, Paint, Stop } from '../../client/src/art/chars/kit';
import {
  discDiffShare,
  drawingRaster,
  luminance01,
  pairedSectorContrast,
  pairedSectorHue,
  resampleRaster,
  visibilityDetail,
  type DrawingRaster,
  type PairedWorst,
  type VisibilityDetail,
} from '../../client/src/art/chars/measure';
import type { RoleCharId } from '../../client/src/art/chars/types';
import { FLOOR_COLORS, MAP_COLOR } from '../../client/src/art/mapArtGeom';
import { relativeLuminance } from '../../client/src/art/palette';
import { PRESETS, TOUCH_LOW_OVERRIDE, effectivePreset, type QualityTier } from '../../client/src/gfx/presets';
import { computeRenderSize } from '../../client/src/render/resolution';
import { DEFAULT_CAM_ZOOM, MAP_SCALE, PC_VIEW_H, PC_VIEW_W, layoutFor } from '../../client/src/ui/layout';
import { loadTestBalance } from './fixtures';

registerAllCostumeArt();

const BALANCE = loadTestBalance();
/** 판정 반지름 (월드 px) */
export const MONSTER_R_PX = BALANCE.monster.radius * TILE_PX;
export const SURVIVOR_R_PX = BALANCE.survivor.radius * TILE_PX;

/**
 * 게임과 같은 외곽선 두께 (그림 단위): atlas.ts ART.outlineWorldPx 1.8 월드 px ÷ 판정 반지름 px.
 * atlas.ts는 Phaser를 불러 여기서 import하지 않는다 ('atlas.ts 굽기 식' 시험이 원본과 같은지 본다)
 */
export const OUTLINE_WORLD_PX = 1.8;
export const W = OUTLINE_WORLD_PX / MONSTER_R_PX;
export const W_SURVIVOR = OUTLINE_WORLD_PX / SURVIVOR_R_PX;

/** 그림 밑 바닥 (빛 속 바닥 강판색) */
export const FLOOR = MAP_COLOR.floor;
export const FLOOR_L = relativeLuminance(FLOOR);
/** 색조 위장 점검에 쓰는 바닥 톤: 맵 바닥에 쓰는 색 전부 (mapArtGeom FLOOR_COLORS, 같은 값은 한 번) */
export const HUE_FLOORS: readonly number[] = [...new Set(FLOOR_COLORS)];

// ───────────────────────── 게임이 굽는 크기 ─────────────────────────

/** 판 화면의 월드 배율 (논리 px / 월드 px): 따라가는 카메라 기본 확대 (main.ts setCamZoom(DEFAULT_CAM_ZOOM)) */
const GAME_WORLD_SCALE = MAP_SCALE * DEFAULT_CAM_ZOOM;

/** atlas.ts texelsPerWorldPx와 같은 식 (텍셀 / 월드 px, 품질 상한 cap) */
export function texelsPerWorldPx(zoom: number, cap: number): number {
  return Math.min(Math.max(0.25, zoom) * GAME_WORLD_SCALE, cap > 0 ? cap : Infinity);
}

export interface Screen {
  readonly name: string;
  /** CSS px (가로 기준) · 기기 픽셀 배율 */
  readonly w: number;
  readonly h: number;
  readonly dpr: number;
}

/** 기준 휴대폰 (가로, CSS px · 기기 배율) — touch-hud.test.ts 화면 목록의 휴대폰들 */
export const PHONES: readonly Screen[] = [
  { name: 'iPhone SE', w: 568, h: 320, dpr: 2 },
  { name: '16:9 휴대폰', w: 640, h: 360, dpr: 3 },
  { name: 'iPhone 8', w: 667, h: 375, dpr: 2 },
  { name: 'Galaxy S9+', w: 658, h: 320, dpr: 4.5 },
  { name: 'Pixel 5', w: 802, h: 293, dpr: 2.75 },
  { name: 'Pixel 5 + 안전 영역', w: 758, h: 277, dpr: 2.75 },
  { name: 'Galaxy S8', w: 740, h: 360, dpr: 4 },
  { name: 'iPhone 12', w: 750, h: 340, dpr: 3 },
  { name: 'Pixel 7', w: 915, h: 412, dpr: 2.625 },
];
export const PC_1080: Screen = { name: 'PC 1080p', w: PC_VIEW_W, h: PC_VIEW_H, dpr: 1 };
/** HD 노트북 · 작은 창 (배율 1) */
export const PC_720: Screen = { name: 'PC 1280×720', w: 1280, h: 720, dpr: 1 };

export function phone(name: string): Screen {
  const p = PHONES.find((s) => s.name === name);
  if (!p) throw new Error(`기준 휴대폰 없음: ${name}`);
  return p;
}

/** 그 화면 · 품질에서 괴물 위 그림 몸 지름 (아틀라스 텍셀) */
export function bodyPx(s: Screen, tier: QualityTier, touch: boolean): number {
  const l = layoutFor(s.w, s.h, touch);
  const preset = effectivePreset(tier, 'webgl', touch);
  const r = computeRenderSize({
    cssW: s.w,
    cssH: s.h,
    dpr: s.dpr,
    logicalW: l.viewW,
    logicalH: l.viewH,
    preset,
    scaleOverride: null,
  });
  return 2 * MONSTER_R_PX * texelsPerWorldPx(r.zoom, preset.charTexelCap);
}

/** 품질 상한의 몸 지름 */
export function capPx(tier: QualityTier): number {
  return 2 * MONSTER_R_PX * PRESETS[tier].charTexelCap;
}

/** 기준 휴대폰 중 터치 낮음이 가장 작은 화면 (지금 iPhone SE) */
export const PHONE_LOW = PHONES.map((p) => ({ p, d: bodyPx(p, 'low', true) })).reduce((a, b) =>
  b.d < a.d ? b : a,
);

/**
 * 아틀라스 칸 안 그림 원점의 소수부 (atlas.ts cellOf: 여백 pad = 외곽선 w + 2, ox = pad − 상자 x0 × u, 칸 자리는 정수).
 * 이 위상으로 굽는다 — 몸 지름마다 다르다
 */
export function atlasPhase(d: number): readonly [number, number] {
  const tpw = d / (2 * MONSTER_R_PX);
  const pad = OUTLINE_WORLD_PX * tpw + 2;
  const u = d / 2;
  const ox = pad - MONSTER_BOX.x0 * u;
  const oy = pad - MONSTER_BOX.y0 * u;
  return [ox - Math.floor(ox), oy - Math.floor(oy)];
}

/** 화면 방향: 축 방향 · 비스듬함 · 거의 뒤 (화소 격자와 어긋난 가장자리) */
export const ROTS_1TO1: readonly number[] = [0, 0.6, 2.5];
/** 화면 위상 (텍셀, 구운 원점에서): 0 = 텍셀이 화소에 딱 맞음, 0.5 = 반 화소 어긋남(쌍선형으로 가장 많이 번진다) */
export const PHASES_SMALL: readonly (readonly [number, number])[] = [
  [0, 0],
  [0.5, 0.5],
];

export interface SizeCase {
  readonly label: string;
  readonly d: number;
  /** 품질 상한에 닿아 늘려 찍는 크기 (구운 그대로 · 돌리지 않고 잰다) */
  readonly capped: boolean;
  readonly rots: readonly number[];
  readonly phases: readonly (readonly [number, number])[];
}

/** 위상까지 재는 작은 크기의 상한 (몸 지름 px) — 휴대폰 낮음 무리 */
const SMALL_MAX = 32;

function sizeCase(label: string, d: number, capped: boolean): SizeCase {
  return {
    label,
    d,
    capped,
    rots: capped ? [0] : ROTS_1TO1,
    phases: !capped && d < SMALL_MAX ? PHASES_SMALL : [[0, 0]],
  };
}

/**
 * 잴 크기 열 (작은 것부터). 숫자를 박지 않고 화면 · 품질 · 배치 식에서 구한다.
 *  ① 배율 1.25 휴대폰 터치 낮음 (약 21.4px): 터치 낮음 배율 하한(TOUCH_LOW_OVERRIDE.dprCap)에 닿는 가장 작은 화면 — 가장 거친 경우
 *  ② 기준 휴대폰 터치 낮음 가장 작은 값 (iPhone SE, 약 24.1px) ③ iPhone 8 터치 낮음 (약 26.5px)
 *  ④ Galaxy S8 터치 낮음 (약 29.5px — S9+ · iPhone 12도 같다) ⑤ Pixel 5 + 안전 영역 터치 높음 (약 36.4px)
 *  ⑥ PC 1280×720 높음 (약 41.7px) ⑦ 낮음 상한 charTexelCap 2 (약 44.8px) ⑧ PC 1080p 높음 (약 62.5px)
 *  ⑨ 중간 상한 charTexelCap 3 (약 67.2px) ⑩ 높음 상한 charTexelCap 4 (약 89.6px)
 */
export const SIZES: readonly SizeCase[] = [
  sizeCase(
    '배율 1.25 휴대폰 터치 낮음',
    bodyPx({ ...phone('iPhone SE'), dpr: TOUCH_LOW_OVERRIDE.dprCap }, 'low', true),
    false,
  ),
  sizeCase(`휴대폰 낮음(${PHONE_LOW.p.name})`, PHONE_LOW.d, false),
  sizeCase('iPhone 8 낮음', bodyPx(phone('iPhone 8'), 'low', true), false),
  sizeCase('Galaxy S8 낮음', bodyPx(phone('Galaxy S8'), 'low', true), false),
  sizeCase('Pixel 5 안전 영역 높음', bodyPx(phone('Pixel 5 + 안전 영역'), 'high', true), false),
  sizeCase('PC 1280×720 높음', bodyPx(PC_720, 'high', false), false),
  sizeCase('낮음 상한', capPx('low'), true),
  sizeCase('PC 1080p 높음', bodyPx(PC_1080, 'high', false), false),
  sizeCase('중간 상한', capPx('medium'), true),
  sizeCase('높음 상한', capPx('high'), true),
];

/** 크기 묶음 (의상 파일마다 시험 하나씩): 위상까지 재는 휴대폰 낮음 · 1:1 나머지 · 품질 상한 */
export const SIZE_GROUPS: readonly { readonly label: string; readonly sizes: readonly SizeCase[] }[] = [
  { label: '휴대폰 낮음 (방향 셋 × 위상 둘)', sizes: SIZES.filter((s) => s.phases.length > 1) },
  { label: '1:1 큰 화면 (방향 셋)', sizes: SIZES.filter((s) => !s.capped && s.phases.length === 1) },
  { label: '품질 상한 (구운 그대로)', sizes: SIZES.filter((s) => s.capped) },
];

// ───────────────────────── 프레임 (아틀라스가 굽는 그대로) ─────────────────────────

/** 그 의상을 입힌 괴물 프레임 (charFrames.ts newStyleFrameSpecs의 괴물 칸 21개 — 대기 망토 8 · 걷기 8 · 돌진 · 기절 · 준비 · 타격 · 포효) */
export function monsterFrames(costume: MonsterCostumeId): CharFrameSpec[] {
  return newStyleFrameSpecs({ ...BASIC_COSTUME_SET, monster: costume }).filter((s) => s.owner === 'monster');
}

/** 그 의상을 입힌 역할 생존자 프레임 (그 역할 칸 전부 — 걷기 · 질주 · 능력 · 수감 · 구조 · 피격 · 번쩍 · 회색) */
export function survivorFrames(role: RoleCharId, costume: SurvivorCostumeId): CharFrameSpec[] {
  const set: CostumeSet = { ...BASIC_COSTUME_SET, [role]: costume };
  return newStyleFrameSpecs(set).filter((s) => s.owner === role);
}

/** 그림 명령 열쇠 (같은 그림이면 같은 값) */
export function drawingKey(dr: Drawing): string {
  return JSON.stringify(dr.ops);
}

/** 그림 지문 (FNV-1a 32비트, 명령 JSON) — scripts/char-art/raster-calibrate.ts와 같은 식 */
export function fingerprint(dr: Drawing): string {
  const s = drawingKey(dr);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

// ───────────────────────── 칠하기 · 화면에 찍기 · 재기 ─────────────────────────

export interface View {
  readonly size: SizeCase;
  readonly rot: number;
  readonly phase: readonly [number, number];
}

export function viewsOf(size: SizeCase): View[] {
  return size.rots.flatMap((rot) => size.phases.map((phase) => ({ size, rot, phase })));
}

export function viewName(v: View): string {
  const ph = v.phase[0] === 0 && v.phase[1] === 0 ? '' : ` · 위상 ${v.phase[0]},${v.phase[1]}`;
  return `${v.size.label} ${v.size.d.toFixed(1)}px · 방향 ${v.rot}${ph}`;
}

/** 테두리 띠: 외곽선(바깥으로 w) 안쪽부터 몸 지름의 8% 폭 */
export const BAND = 0.08;
/** 바닥 대비 면적의 대비 하한: 바닥 위에서 따로 보이는 칸 (WCAG 1.5 — 짙은 외곽선 #05080C는 바닥과 1.2라 빠진다) */
export const FLOOR_CONTRAST = 1.5;
/** 조각 수 · 배치 (몸 방향 기준 45°씩: 0 = 앞 가운데에서 시작, 0.5 = 반 조각 어긋남) */
export const SECTORS = 8;
export const SECTOR_LAYOUTS: readonly number[] = [0, 0.5];
export const SECTOR_NAME = ['앞', '앞오른', '오른', '뒤오른', '뒤', '뒤왼', '왼', '앞왼'] as const;

/** 아틀라스처럼 굽기 (돌리지 않고, 그 크기의 아틀라스 위상으로) */
export function bake(dr: Drawing, d: number): DrawingRaster {
  const n = Math.ceil(d * 1.7);
  const [px, py] = atlasPhase(d);
  const half = n / 2 - Math.floor(n / 2);
  return drawingRaster(dr, d, 0, { dx: px - half, dy: py - half });
}

/** 구운 그림을 그 화면 방향 · 위상으로 찍는다 (방향 0 · 위상 0이면 구운 그대로) */
export function onScreen(baked: DrawingRaster, v: View): DrawingRaster {
  if (v.rot === 0 && v.phase[0] === 0 && v.phase[1] === 0) return baked;
  const n = baked.n;
  const cx = (baked.cx ?? n / 2) - n / 2 + v.phase[0];
  const cy = (baked.cy ?? n / 2) - n / 2 + v.phase[1];
  return resampleRaster(baked, v.rot, cx, cy);
}

/** 한 화면에서 잰 값: 보이는 정도 + 화면에 찍은 그림 */
export interface ViewMeasure {
  readonly v: VisibilityDetail;
  readonly r: DrawingRaster;
}

export function measureRaster(r: DrawingRaster, d: number, rot: number): ViewMeasure {
  return {
    v: visibilityDetail(r, FLOOR, (W * d) / 2, BAND * d, {
      sectors: SECTORS,
      rot,
      minContrast: FLOOR_CONTRAST,
    }),
    r,
  };
}

/** 그림 · 크기마다 굽기를 한 번만 (같은 그림이 여러 프레임 · 화면에 나온다) */
export class ParityCache {
  private readonly baked = new Map<string, DrawingRaster>();
  private readonly views = new Map<string, ViewMeasure>();

  bakeOf(dr: Drawing, key: string, d: number): DrawingRaster {
    const k = `${key}@${d}`;
    let r = this.baked.get(k);
    if (!r) this.baked.set(k, (r = bake(dr, d)));
    return r;
  }

  measure(dr: Drawing, v: View, key = drawingKey(dr)): ViewMeasure {
    const k = `${key}@${v.size.d}/${v.rot}/${v.phase[0]},${v.phase[1]}`;
    let m = this.views.get(k);
    if (!m)
      this.views.set(k, (m = measureRaster(onScreen(this.bakeOf(dr, key, v.size.d), v), v.size.d, v.rot)));
    return m;
  }

  /** 한 크기를 다 잰 뒤 비운다 (메모리) */
  clear(): void {
    this.baked.clear();
    this.views.clear();
  }
}

// ───────────────────────── 견주기 (의상 / 기본) ─────────────────────────

/** 조각 번호 · 배치 (0 또는 0.5) · 비율 */
export type SectorWorst = PairedWorst;

export interface Gap {
  readonly area: number;
  readonly luma: number;
  readonly rim: number;
  readonly contrastArea: number;
  /** 조각별 바닥 대비 (기본 그림의 테두리 띠 칸에서 의상 / 기본) 중 가장 작은 값 */
  readonly sector: SectorWorst;
  /** 조각별 바닥 색 차이 ΔE76 (기본 띠 칸, 바닥 톤마다) 의상 / 기본 중 가장 작은 값 · 그 바닥 톤 */
  readonly hue: SectorWorst & { readonly floor: number };
}

/** 의상(x)과 기본(b)을 같은 화면에서 견준다 (조각 · 색조는 기본 띠 칸에서 — measure.ts pairedSector* 설명) */
export function compare(x: ViewMeasure, b: ViewMeasure): Gap {
  const xv = x.v;
  const bv = b.v;
  return {
    area: xv.area / bv.area,
    luma: xv.luma / bv.luma,
    rim: xv.rim / bv.rim,
    contrastArea: xv.contrastArea / bv.contrastArea,
    sector: pairedSectorContrast(xv, bv, FLOOR_L, SECTORS, SECTOR_LAYOUTS),
    hue: pairedSectorHue(x.r, b.r, bv, HUE_FLOORS, SECTORS, SECTOR_LAYOUTS),
  };
}

// ───────────────────────── 기준 ─────────────────────────

export const AREA_TOL = 0.02;
export const LUMA_TOL = 0.05;
export const RIM_TOL = 0.05;
export const CONTRAST_AREA_TOL = 0.05;
export const SECTOR_MIN = 0.93;
export const HUE_MIN = 0.9;
/** 몸 가운데 원판: 반지름 0.45r, 기본과 ΔE76 15 넘게 다른 칸 몫 상한 */
export const DISC_R = 0.45;
export const DISC_DE = 15;
export const DISC_MAX = 0.05;

export function sectorLabel(s: SectorWorst): string {
  const name = SECTOR_NAME[s.at] ?? String(s.at);
  return s.layout === 0 ? name : `${name}+½`;
}

/** 평균 셋 (면적 · 밝기 · 외곽 대비) — 1판 점검 */
export function outsideMeans(g: Gap): string[] {
  const bad: string[] = [];
  if (Math.abs(g.area - 1) > AREA_TOL) bad.push(`면적 ×${g.area.toFixed(3)}`);
  if (Math.abs(g.luma - 1) > LUMA_TOL) bad.push(`밝기 ×${g.luma.toFixed(3)}`);
  if (Math.abs(g.rim - 1) > RIM_TOL) bad.push(`외곽 대비 ×${g.rim.toFixed(3)}`);
  return bad;
}

/** 조각 · 바닥 대비 면적 · 색조 — 평균으로 숨길 수 없는 것 */
export function outsideSpread(g: Gap): string[] {
  const bad: string[] = [];
  if (g.sector.ratio < SECTOR_MIN)
    bad.push(`조각 ${sectorLabel(g.sector)} 대비 ×${g.sector.ratio.toFixed(3)}`);
  if (Math.abs(g.contrastArea - 1) > CONTRAST_AREA_TOL)
    bad.push(`바닥 대비 면적 ×${g.contrastArea.toFixed(3)}`);
  if (g.hue.ratio < HUE_MIN)
    bad.push(
      `조각 ${sectorLabel(g.hue)} 바닥색(#${g.hue.floor.toString(16).padStart(6, '0')}) 차이 ×${g.hue.ratio.toFixed(3)}`,
    );
  return bad;
}

export function outside(g: Gap): string[] {
  return [...outsideMeans(g), ...outsideSpread(g)];
}

export interface CaseResult {
  readonly frame: string;
  readonly view: View;
  readonly gap: Gap;
}

/**
 * 의상 하나를 크기 열 sizes · 그 크기의 방향 · 위상 · 프레임 전부에서 기본과 견준다. extra = 의상 그림을 바꿔 보는 반례용,
 * frames = 프레임 이름으로 줄이기 (없으면 21개 전부)
 */
export function parityCases(
  costume: MonsterCostumeId,
  sizes: readonly SizeCase[],
  opts: { extra?: (dr: Drawing) => Drawing; frames?: readonly string[] } = {},
): CaseResult[] {
  const base = new Map(monsterFrames('basic').map((s) => [s.name, s.draw(W)]));
  const dressed = monsterFrames(costume)
    .filter((s) => !opts.frames || opts.frames.includes(s.name))
    .map((s) => {
      const dr = s.draw(W);
      return { name: s.name, dr: opts.extra ? opts.extra(dr) : dr };
    });
  const keys = new Map<Drawing, string>();
  const keyOf = (dr: Drawing): string => {
    let k = keys.get(dr);
    if (k === undefined) keys.set(dr, (k = drawingKey(dr)));
    return k;
  };
  const cache = new ParityCache();
  const out: CaseResult[] = [];
  for (const size of sizes) {
    for (const { name, dr } of dressed) {
      const b = base.get(name);
      if (!b) throw new Error(`기본 프레임 없음: ${name}`);
      for (const view of viewsOf(size)) {
        const gap = compare(cache.measure(dr, view, keyOf(dr)), cache.measure(b, view, keyOf(b)));
        out.push({ frame: name, view, gap });
      }
    }
    cache.clear();
  }
  return out;
}

/** 기준 밖 경우를 묶어 보고 (점검별 가장 나쁜 값 · 경우 수 · 앞의 몇 개) */
export function summarize(results: readonly CaseResult[], limit = 12): string[] {
  const bad = results
    .map((r) => ({ r, why: outside(r.gap) }))
    .filter((x) => x.why.length > 0)
    .map((x) => `${x.r.frame} · ${viewName(x.r.view)}: ${x.why.join(', ')}`);
  if (bad.length <= limit) return bad;
  return [
    ...bad.slice(0, limit),
    `… 외 ${bad.length - limit}건 (모두 ${results.length}건 중 ${bad.length}건)`,
  ];
}

// ───────────────────────── 몸 가운데 원판 ─────────────────────────

/** 몸 가운데 원판(반지름 DISC_R × 몸 반지름)에서 의상(a) · 기본(b) 색이 ΔE76 DISC_DE 넘게 다른 칸 몫 */
export function discShare(a: DrawingRaster, b: DrawingRaster, d: number): number {
  return discDiffShare(a, b, (DISC_R * d) / 2, FLOOR, DISC_DE).share;
}

// ───────────────────────── 반례 만들기 ─────────────────────────

/** 같은 상대 휘도로 바닥색 색조(선형 RGB 비율)를 띤 색 */
export function floorHueAt(color: number): number {
  const ch = (c: number, s: number): number => ((c >> s) & 255) / 255;
  const lin = (v: number): number => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const enc = (v: number): number => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
  const L = luminance01(ch(color, 16), ch(color, 8), ch(color, 0));
  const f = [ch(FLOOR, 16), ch(FLOOR, 8), ch(FLOOR, 0)].map(lin);
  const k = L / FLOOR_L;
  const rgb = f.map((v) => Math.round(Math.max(0, Math.min(1, enc(v * k))) * 255));
  return ((rgb[0] ?? 0) << 16) | ((rgb[1] ?? 0) << 8) | (rgb[2] ?? 0);
}

/** 칠의 모든 색을 floorHueAt으로 (알파 · 위치는 그대로) */
export function floorHuePaint(p: Paint): Paint {
  if (p.kind === 'solid') return { ...p, color: floorHueAt(p.color) };
  const stops = p.stops.map(([o, c, a]): Stop =>
    a === undefined ? [o, floorHueAt(c)] : [o, floorHueAt(c), a],
  );
  return { ...p, stops };
}

// ───────────────────────── 의상 파일마다 같은 시험 ─────────────────────────

/** 괴물 의상 하나: 크기 묶음마다 시험 하나 (21프레임 × 그 묶음의 크기 · 방향 · 위상 전부) */
export function describeMonsterParity(costume: MonsterCostumeId): void {
  describe(`괴물 의상 ${costume}: 생존자 화면에서 기본 괴물과 같게 보인다 (꾸미기는 유불리가 없다)`, () => {
    for (const group of SIZE_GROUPS)
      it(`${group.label} ${group.sizes.map((s) => s.d.toFixed(1)).join(' · ')}px: 면적 ±${AREA_TOL * 100}% · 밝기 ±${LUMA_TOL * 100}% · 외곽 대비 ±${RIM_TOL * 100}% · 조각 대비 ≥ ${SECTOR_MIN} · 바닥 대비 면적 ±${CONTRAST_AREA_TOL * 100}% · 조각 색조 ≥ ${HUE_MIN}`, () => {
        const res = parityCases(costume, group.sizes);
        const views = group.sizes.reduce((sum, s) => sum + viewsOf(s).length, 0);
        expect(res.length).toBe(monsterFrames(costume).length * views);
        expect(summarize(res)).toEqual([]);
      });
  });
}

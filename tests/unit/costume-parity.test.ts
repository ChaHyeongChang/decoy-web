// 의상 유불리 점검 (판 밖 메타 c, 사용자 결정: '꾸미기는 유불리가 없어야 한다'): 괴물 의상은 생존자 화면에도 그대로 보이므로,
// 의상 때문에 괴물이 안개 · 어둠 속에서 덜 보이면 생존자에게 불리하고, 더 보이면 괴물에게 불리하다. 그래서 생존자 화면의 괴물
// 위 그림(게임 화면)을 Node에서 직접 칠해(client/src/art/chars/measure.ts drawingRaster — Canvas 없이, 결정적) 보이는 정도를
// 같은 자세 · 같은 크기 · 같은 방향의 기본 그림과 견준다.
//
// 크기 — 게임이 실제로 굽는 크기에서 잰다 (숫자를 박지 않고 코드에서 구한다):
//   몸 지름(텍셀) = 2 × 괴물 판정 반지름(balance monster.radius) × TILE_PX × 텍셀/월드 px.
//   텍셀/월드 px = min(화면 배율 zoom × 월드 배율(MAP_SCALE × DEFAULT_CAM_ZOOM), 품질 charTexelCap) — atlas.ts texelsPerWorldPx.
//   zoom은 배치(layout.ts layoutFor)와 해상도(resolution.ts computeRenderSize, 품질 preset)가 정한다.
//    ① 휴대폰 낮음: 기준 휴대폰 중 가장 작은 값 (iPhone SE 568×320 터치 낮음, 약 24px) — 가장 거친 화면
//    ② 낮음 상한: charTexelCap 2 (약 45px — PC 낮음 · 큰 화면은 여기서 늘려 그린다)
//    ③ PC 1080p: 1920×1080 배율 1, 높음 · 중간 (상한 아래, 약 62px)
//    ④ 중간 상한: charTexelCap 3 (약 67px), ⑤ 높음 상한: charTexelCap 4 (약 90px)
//   방향: 1:1로 화면에 찍히는 크기(①②③)는 화면에서 돌아간 그림의 격자 어긋남이 결과를 움직이므로 비스듬한 방향(0.6)을 잰다
//   (①②는 축 방향 0도 같이). 상한 크기(④⑤)는 아틀라스가 돌리지 않은 프레임을 굽고 늘려 찍으므로 구운 그대로(0)를 잰다.
//   ⑤는 자세 일부만 잰다 (POSES_AT_HIGH_CAP 설명).
//
// 견주는 값 (모두 의상 / 기본 비율):
//  - 보이는 면적: 알파 0.5 이상 칸 수 (외곽선 포함 실루엣)
//  - 밝기: 보이는 칸을 바닥 위에 얹은 색의 평균 상대 휘도 (WCAG 식)
//  - 외곽 대비: 외곽선 바로 안쪽 테두리 띠의 평균 상대 휘도 — 짙은 외곽선(#05080C)은 어두운 바닥과 거의 같아 실루엣을 가르지
//    못하고 모든 의상이 같다. 바닥 · 안개에서 괴물을 가르는 곳은 그 안쪽 띠이고, 의상이 어둡게 만들 수 있는 곳도 거기다
//  - 조각별 외곽 대비: 평균은 한쪽을 어둡게 하고 다른 쪽을 밝게 하면 맞출 수 있다(검증에서 찾은 빈틈 — 뒤쪽 테두리를 바닥색,
//    옆을 옅은 분홍으로 칠하면 평균 셋을 다 지나면서 뒤 4분의 1이 바닥에 묻힌다). 그래서 테두리 띠를 몸 중심 둘레 8조각(몸
//    방향 기준 45°씩)으로 나눠, 조각마다 바닥과의 WCAG 대비를 기본의 같은 조각과 견주고 가장 많이 잃은 조각을 본다
//  - 바닥 대비 면적: 바닥 위에 얹은 색이 바닥(MAP_COLOR.floor)과 WCAG 대비 1.5 이상인 칸 수. 보이는 면적은 바닥색으로 칠한
//    칸도 알파만 있으면 센다 — 이 값은 바닥과 실제로 갈리는 칸만 센다 (바닥색 칠 · 옅은 칠은 대비가 1 근처라 빠진다)
// 안개 · 어둠: 빛 지도는 이 위에 곱해진다. 상대 휘도 비율(밝기 · 외곽 대비)은 곱해도 거의 그대로이고, 조각별 대비 비율
// (L + 0.05) / (L기본 + 0.05)는 빛이 줄수록 1 쪽으로 다가가므로 빛 속(빛 1)에서 재는 것이 가장 엄하다.
// 생존자 의상은 여기서 재지 않는다: 괴물 화면의 생존자는 언제나 흰 공통 그림이고(의상 훅 없음, VISUAL_SPEC 0장 ③), 생존자
// 의상은 같은 편(생존자끼리)에게만 보이므로 누가 누구를 보는지(상대 편 정보)를 바꾸지 못한다.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MONSTER_COSTUMES, TILE_PX, type MonsterCostumeId } from '@decoy/shared';
import { registerAllCostumeArt } from '../../client/src/art/chars/costume/art';
import { MONSTER_ART } from '../../client/src/art/chars/index';
import { path, linear, solid, type Drawing } from '../../client/src/art/chars/kit';
import {
  drawingMask,
  drawingRaster,
  luminance01,
  outsideDistance,
  visibility,
  visibilityDetail,
  wcagContrast,
  type VisibilityDetail,
} from '../../client/src/art/chars/measure';
import { MONSTER_REST, type MonsterPose } from '../../client/src/art/chars/types';
import { MAP_COLOR } from '../../client/src/art/mapArtGeom';
import { relativeLuminance } from '../../client/src/art/palette';
import { PRESETS, effectivePreset, type QualityTier } from '../../client/src/gfx/presets';
import { computeRenderSize } from '../../client/src/render/resolution';
import { DEFAULT_CAM_ZOOM, MAP_SCALE, PC_VIEW_H, PC_VIEW_W, layoutFor } from '../../client/src/ui/layout';
import { loadTestBalance } from '../helpers/fixtures';

registerAllCostumeArt();

/** 괴물 판정 반지름 (월드 px) */
const MONSTER_R_PX = loadTestBalance().monster.radius * TILE_PX;

/**
 * 게임과 같은 외곽선 두께 (그림 단위): atlas.ts ART.outlineWorldPx 1.8 월드 px ÷ 괴물 판정 반지름 px.
 * atlas.ts는 Phaser를 불러 여기서 import하지 않는다 (아래 '게임 굽기 식' 시험이 원본과 같은지 본다)
 */
const OUTLINE_WORLD_PX = 1.8;
const W = OUTLINE_WORLD_PX / MONSTER_R_PX;

/** 그림 밑 바닥 (빛 속 바닥 강판색) */
const FLOOR = MAP_COLOR.floor;
const FLOOR_L = relativeLuminance(FLOOR);

// ───────────────────────── 게임이 굽는 크기 ─────────────────────────

/** 판 화면의 월드 배율 (논리 px / 월드 px): 따라가는 카메라 기본 확대 (main.ts setCamZoom(DEFAULT_CAM_ZOOM)) */
const GAME_WORLD_SCALE = MAP_SCALE * DEFAULT_CAM_ZOOM;

/** atlas.ts texelsPerWorldPx와 같은 식 (텍셀 / 월드 px, 품질 상한 cap) */
function texelsPerWorldPx(zoom: number, cap: number): number {
  return Math.min(Math.max(0.25, zoom) * GAME_WORLD_SCALE, cap > 0 ? cap : Infinity);
}

interface Screen {
  readonly name: string;
  /** CSS px (가로 기준) · 기기 픽셀 배율 */
  readonly w: number;
  readonly h: number;
  readonly dpr: number;
}

/** 기준 휴대폰 (가로, CSS px · 기기 배율) — touch-hud.test.ts 화면 목록의 휴대폰들 */
const PHONES: readonly Screen[] = [
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
const PC_1080: Screen = { name: 'PC 1080p', w: PC_VIEW_W, h: PC_VIEW_H, dpr: 1 };

/** 그 화면 · 품질에서 괴물 위 그림 몸 지름 (아틀라스 텍셀) */
function bodyPx(s: Screen, tier: QualityTier, touch: boolean): number {
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
function capPx(tier: QualityTier): number {
  return 2 * MONSTER_R_PX * PRESETS[tier].charTexelCap;
}

const PHONE_LOW = PHONES.map((p) => ({ p, d: bodyPx(p, 'low', true) })).reduce((a, b) => (b.d < a.d ? b : a));

/** 화면 방향 (축에 맞은 경우 · 비스듬한 경우 — 화소 격자와 어긋난 가장자리) */
const ROT_AXIS = 0;
const ROT_SLANT = 0.6;

const TAU = Math.PI * 2;
/** 자세 묶음: 굽는 프레임과 같은 결 (서기 · 망토 물결 · 걷기 넷 · 공격 준비 · 타격 · 돌진 · 포효 · 기절) */
const POSES: readonly (readonly [string, Partial<MonsterPose>])[] = [
  ['서기', {}],
  ['서기 물결', { cloak: TAU / 4 }],
  ...[0, 2, 4, 6].map((i): [string, Partial<MonsterPose>] => {
    const ph = (i / 8) * TAU;
    return [`걷기 ${i}`, { walk: ph, cloak: ph, stride: 1 }];
  }),
  ['공격 준비', { windup: 1 }],
  ['타격', { strike: 1 }],
  ['돌진', { dash: 1 }],
  ['포효', { roar: 1 }],
  ['기절', { stun: 1, eyes: 'stun' }],
];

function monsterTop(pose: Partial<MonsterPose>, costume: MonsterCostumeId): Drawing {
  return MONSTER_ART.top({ ...MONSTER_REST, ...pose }, { w: W, costume });
}

/** 그림 명령 열쇠 (같은 그림이면 같은 값 — 자세가 달라도 그림이 같으면 한 번만 칠한다) */
function drawingKey(dr: Drawing): string {
  return JSON.stringify(dr.ops);
}

/**
 * 의상 하나에서 잴 자세: 기본 그림 · 그 의상 그림이 둘 다 앞 자세와 똑같은 자세는 뺀다 (지금 두건 · 사슬은 '걷기 0'이
 * '서기'와 같다 — 걸음 위상 0이면 보폭이 그림을 바꾸지 않는다. 깃털은 보폭으로 깃이 흔들려 다르다). 그림이 바뀌어
 * 달라지면 저절로 다시 잰다
 */
function distinctPoses(costume: MonsterCostumeId): (readonly [string, Partial<MonsterPose>])[] {
  const seen = new Set<string>();
  return POSES.filter(([, pose]) => {
    const key = drawingKey(monsterTop(pose, 'basic')) + drawingKey(monsterTop(pose, costume));
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * ⑤ 높음 상한(약 90px)에서 잴 자세: 시간(파일 20초 안) 때문에 자세 가족마다 하나씩만 — 쉬기 · 걷기 끝 · 팔 내밂 · 늘어남 ·
 * 고개 듦 (기절 · 타격 · 망토 물결은 ④까지). 같은 그림을 67px(④, 모든 자세)에서 90px로 키운 차이는 같은 자세에서 밝기 1.3% ·
 * 외곽 0.8% · 바닥 대비 면적 1.2% · 조각 2.6% 안쪽(지금 의상 측정)이라, 90px에서 새로 걸릴 자세는 ④에서 이미 경계 가까이 있다
 */
const POSES_AT_HIGH_CAP: readonly string[] = ['서기', '걷기 2', '공격 준비', '돌진', '포효'];

interface SizeCase {
  readonly label: string;
  readonly d: number;
  readonly rots: readonly number[];
  /** 이 크기에서 잴 자세 이름 (없으면 모든 자세) */
  readonly poses?: readonly string[];
}

const SIZES: readonly SizeCase[] = [
  { label: `휴대폰 낮음(${PHONE_LOW.p.name})`, d: PHONE_LOW.d, rots: [ROT_AXIS, ROT_SLANT] },
  { label: '낮음 상한', d: capPx('low'), rots: [ROT_AXIS, ROT_SLANT] },
  { label: 'PC 1080p', d: bodyPx(PC_1080, 'high', false), rots: [ROT_SLANT] },
  { label: '중간 상한', d: capPx('medium'), rots: [ROT_AXIS] },
  { label: '높음 상한', d: capPx('high'), rots: [ROT_AXIS], poses: POSES_AT_HIGH_CAP },
];

// ───────────────────────── 재기 · 기준 ─────────────────────────

/** 테두리 띠: 외곽선(바깥으로 w) 안쪽부터 몸 지름의 8% 폭 */
const BAND = 0.08;
/** 테두리 띠 조각 수 (몸 방향 기준 45°씩, 0 = 앞 가운데, 화면 시계 방향) */
const SECTORS = 8;
const SECTOR_NAME = ['앞', '앞오른', '오른', '뒤오른', '뒤', '뒤왼', '왼', '앞왼'] as const;
/** 바닥 대비 면적의 대비 하한: 바닥 위에서 따로 보이는 칸 (WCAG 1.5 — 짙은 외곽선 #05080C는 바닥과 1.2라 빠진다) */
const FLOOR_CONTRAST = 1.5;

/**
 * 허용 폭 (기본 값에 대한 비율). '같게'를 이렇게 정했다:
 *  - 면적 ±2%: 의상은 크기 기준(measure.SIZE_RULE)을 넘지 못하고 키우지 않는다. 깃 끝이 어깨에서 조금 나오는 몫만 둔다
 *  - 밝기 · 외곽 대비 ±5%: 같은 기본 괴물도 자세에 따라 밝기가 ±10%(포효 0.087 ~ 걷기 0.105, 45px), 외곽 띠가 ±50% 오르내리고,
 *    같은 그림을 24px · 90px로 그린 차이도 6~9%다. 그 아래로 두어 의상이 보이는 정도를 자세 하나가 바뀌는 것보다 작게
 *    바꾼다. 위아래 모두 막는다 (더 밝으면 괴물이 불리하다)
 *  - 조각별 외곽 대비 ≥ 0.93: 어느 한쪽(조각)도 바닥과의 대비를 기본보다 7% 넘게 잃지 않는다. 띠 평균 ±5%(휘도)를 대비로
 *    바꾸면 띠 휘도 0.05 ~ 0.3에서 ±2~4%인데, 조각 하나는 띠의 1/8(24px에서 16~19칸)이라 칸 하나가 조각 평균을 몇 % 움직여
 *    두 배쯤 둔다. 테두리를 건드리지 않는 두건은 0.985 이상이고, 뒤를 바닥색으로 칠한 반례는 0.71 ~ 0.80이다.
 *    가장 어두운 조각 하나만 견주면((L최소 + 0.05) / (기본 L최소 + 0.05)) 서기 · 걷기 · 공격 준비 · 기절에서는 늘
 *    앞(얼굴 그늘, 휘도 0.005 — 바닥보다 어둡다)이 가장 어두워 뒤가 바닥에 묻혀도 못 잡는다 → 같은 조각끼리 견준다(이 값이
 *    0.93 이상이면 가장 어두운 조각끼리도 0.93 이상이다). 아래쪽만 막는다: 한쪽이 더 밝아지면 의상을 입은 괴물이 불리할
 *    뿐이고, 고르게 밝아지는 것은 밝기 · 외곽 대비 상한이 막는다. 대비는 바닥 기준 WCAG 식이라 바닥보다 어두운 조각(얼굴)이
 *    바닥색 쪽으로 밝아져도 잃는다
 *  - 바닥 대비 면적 ±5%: 기본 괴물도 자세에 따라 ±6%(포효 989 ~ 걷기 1125칸, 45px) 오르내린다. 그 아래로 둔다. 바닥색 · 옅은
 *    칠은 세지 않으므로 알파만 채운 칠로 면적을 지킬 수 없다. 위아래 모두 막는다
 */
const AREA_TOL = 0.02;
const LUMA_TOL = 0.05;
const RIM_TOL = 0.05;
const SECTOR_MIN = 0.93;
const CONTRAST_AREA_TOL = 0.05;

function measure(dr: Drawing, d: number, rot: number): VisibilityDetail {
  return visibilityDetail(drawingRaster(dr, d, rot), FLOOR, (W * d) / 2, BAND * d, {
    sectors: SECTORS,
    rot,
    minContrast: FLOOR_CONTRAST,
  });
}

/** 기본 그림 값 (같은 그림 · 크기 · 방향은 한 번만 칠한다) */
const basicCache = new Map<string, VisibilityDetail>();
function basic(pose: Partial<MonsterPose>, d: number, rot: number): VisibilityDetail {
  const dr = monsterTop(pose, 'basic');
  const key = `${drawingKey(dr)}@${d}/${rot}`;
  let v = basicCache.get(key);
  if (!v) basicCache.set(key, (v = measure(dr, d, rot)));
  return v;
}

interface Gap {
  readonly where: string;
  readonly area: number;
  readonly luma: number;
  readonly rim: number;
  /** 조각별 대비 비율 중 가장 작은 값과 그 조각 */
  readonly sector: number;
  readonly sectorAt: number;
  readonly contrastArea: number;
}

/** 조각마다 바닥 대비 비율 (의상 / 기본) 중 가장 작은 것 */
function worstSector(x: VisibilityDetail, b: VisibilityDetail): { ratio: number; at: number } {
  let ratio = Infinity;
  let at = -1;
  for (let q = 0; q < SECTORS; q += 1) {
    const xl = x.rimSectors[q] ?? Number.NaN;
    const bl = b.rimSectors[q] ?? Number.NaN;
    // 기본에 칸이 있는 조각을 의상이 없애면(띠가 끊기면) 그 조각은 바닥과 같다고 본다
    if (Number.isNaN(bl)) continue;
    const r = wcagContrast(Number.isNaN(xl) ? FLOOR_L : xl, FLOOR_L) / wcagContrast(bl, FLOOR_L);
    if (r < ratio) {
      ratio = r;
      at = q;
    }
  }
  return { ratio, at };
}

interface Coverage {
  readonly sizes: readonly SizeCase[];
  /** 자세를 이 이름들로 줄인다 (없으면 크기마다 정한 자세) */
  readonly poses?: readonly string[];
}

/** 잴 경우 수 (의상 하나) */
function caseCount(costume: MonsterCostumeId, cover: Coverage = { sizes: SIZES }): number {
  const names = distinctPoses(costume).map(([name]) => name);
  return cover.sizes.reduce(
    (s, z) =>
      s +
      names.filter((n) => (!z.poses || z.poses.includes(n)) && (!cover.poses || cover.poses.includes(n)))
        .length *
        z.rots.length,
    0,
  );
}

/** 의상 하나의 비율 (의상 / 기본) — 크기마다 정한 자세 · 방향 */
function ratios(
  costume: MonsterCostumeId,
  extra?: (dr: Drawing) => Drawing,
  cover: Coverage = { sizes: SIZES },
): Gap[] {
  const out: Gap[] = [];
  const poses = distinctPoses(costume);
  for (const size of cover.sizes)
    for (const [name, pose] of poses) {
      if (size.poses && !size.poses.includes(name)) continue;
      if (cover.poses && !cover.poses.includes(name)) continue;
      for (const rot of size.rots) {
        const b = basic(pose, size.d, rot);
        const dr = monsterTop(pose, costume);
        const x = measure(extra ? extra(dr) : dr, size.d, rot);
        const s = worstSector(x, b);
        out.push({
          where: `${name} · ${size.label} ${size.d.toFixed(1)}px · ${rot}`,
          area: x.area / b.area,
          luma: x.luma / b.luma,
          rim: x.rim / b.rim,
          sector: s.ratio,
          sectorAt: s.at,
          contrastArea: x.contrastArea / b.contrastArea,
        });
      }
    }
  return out;
}

/** 평균 셋 (면적 · 밝기 · 외곽 대비) — 1판 점검 */
function outsideMeans(g: Gap): string[] {
  const bad: string[] = [];
  if (Math.abs(g.area - 1) > AREA_TOL) bad.push(`${g.where} 면적 ×${g.area.toFixed(3)}`);
  if (Math.abs(g.luma - 1) > LUMA_TOL) bad.push(`${g.where} 밝기 ×${g.luma.toFixed(3)}`);
  if (Math.abs(g.rim - 1) > RIM_TOL) bad.push(`${g.where} 외곽 대비 ×${g.rim.toFixed(3)}`);
  return bad;
}

/** 조각 · 바닥 대비 면적 — 평균으로 숨길 수 없는 것 */
function outsideSpread(g: Gap): string[] {
  const bad: string[] = [];
  if (g.sector < SECTOR_MIN)
    bad.push(`${g.where} 조각 ${SECTOR_NAME[g.sectorAt] ?? g.sectorAt} 대비 ×${g.sector.toFixed(3)}`);
  if (Math.abs(g.contrastArea - 1) > CONTRAST_AREA_TOL)
    bad.push(`${g.where} 바닥 대비 면적 ×${g.contrastArea.toFixed(3)}`);
  return bad;
}

function outside(g: Gap): string[] {
  return [...outsideMeans(g), ...outsideSpread(g)];
}

// ───────────────────────── 시험 ─────────────────────────

describe('그림 칠하기 · 보이는 정도 재기 (measure.ts drawingRaster · visibility · visibilityDetail)', () => {
  const disc = (color: number, r = 0.8): Drawing => ({
    ops: [{ d: path().circle(0, 0, r).d, fill: solid(color) }],
  });

  it('단색 원판: 면적은 πr², 칸 색은 그 색 그대로 (가장자리만 섞인다)', () => {
    const d = 40;
    const r = drawingRaster(disc(0xef4444), d);
    const v = visibility(r, FLOOR, 0, 2);
    const px = 0.8 * (d / 2);
    expect(v.area / (Math.PI * px * px)).toBeGreaterThan(0.97);
    expect(v.area / (Math.PI * px * px)).toBeLessThan(1.03);
    // 가운데 칸
    const c = (Math.floor(r.n / 2) * r.n + Math.floor(r.n / 2)) * 4;
    expect(r.rgba[c + 3]).toBeCloseTo(1, 5);
    expect(r.rgba[c]).toBeCloseTo(0xef / 255, 5);
    expect(luminance01(0xef / 255, 0x44 / 255, 0x44 / 255)).toBeCloseTo(relativeLuminance(0xef4444), 6);
  });

  it('evenodd 고리는 구멍이 비고, nonzero는 같은 방향 두 원을 다 채운다', () => {
    const d = 40;
    const two = path().circle(0, 0, 0.8).circle(0, 0, 0.4).d;
    const hole = drawingRaster({ ops: [{ d: two, fill: solid(0xffffff), rule: 'evenodd' }] }, d);
    const full = drawingRaster({ ops: [{ d: two, fill: solid(0xffffff) }] }, d);
    const c = (Math.floor(hole.n / 2) * hole.n + Math.floor(hole.n / 2)) * 4 + 3;
    expect(hole.rgba[c]).toBe(0);
    expect(full.rgba[c]).toBeCloseTo(1, 5);
  });

  it('선은 두께 × 길이만큼 덮고, butt 끝은 끝점에서 자른다 · 명령 알파는 칠 알파에 곱한다', () => {
    const d = 40;
    const sum = (dr: Drawing): number => {
      const r = drawingRaster(dr, d);
      let s = 0;
      for (let k = 3; k < r.rgba.length; k += 4) s += r.rgba[k] ?? 0;
      return s;
    };
    const unit = d / 2;
    const round = sum({ ops: [{ d: 'M-1 0L1 0', stroke: { paint: solid(0xffffff), width: 0.2 } }] });
    const butt = sum({
      ops: [{ d: 'M-1 0L1 0', stroke: { paint: solid(0xffffff), width: 0.2, cap: 'butt' } }],
    });
    expect(butt / (2 * unit * 0.2 * unit)).toBeCloseTo(1, 1);
    // 둥근 끝 = 양 끝 반원 하나 몫 더
    expect((round - butt) / (Math.PI * (0.1 * unit) ** 2)).toBeCloseTo(1, 1);
    const alphaOp = sum({
      ops: [{ d: 'M-1 0L1 0', stroke: { paint: solid(0xffffff, 0.5), width: 0.2, cap: 'butt' }, alpha: 0.5 }],
    });
    expect(alphaOp / butt).toBeCloseTo(0.25, 2);
  });

  it('선형 칠은 끝점 사이를 잇고 겹쳐 칠하기는 앞에서부터 (뒤 명령이 위)', () => {
    const d = 40;
    const sq = path().poly([
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]).d;
    const r = drawingRaster(
      {
        ops: [
          {
            d: sq,
            fill: linear(-1, 0, 1, 0, [
              [0, 0x000000],
              [1, 0xffffff],
            ]),
          },
          { d: path().circle(0.5, 0, 0.2).d, fill: solid(0xff0000) },
        ],
      },
      d,
    );
    const at = (x: number, y: number): number => {
      const i = Math.floor(((x + 1.7) / 3.4) * r.n);
      const j = Math.floor(((y + 1.7) / 3.4) * r.n);
      return (j * r.n + i) * 4;
    };
    expect(r.rgba[at(-0.8, 0.6)] ?? 1).toBeLessThan(0.2);
    expect(r.rgba[at(0.8, 0.6)] ?? 0).toBeGreaterThan(0.8);
    // 원판(뒤 명령)이 위: 빨강
    expect(r.rgba[at(0.5, 0) + 1] ?? 1).toBeLessThan(0.02);
    expect(r.rgba[at(0.5, 0)] ?? 0).toBeGreaterThan(0.98);
  });

  it('칠한 면적은 실루엣 마스크(drawingMask)와 같은 격자 · 거의 같은 칸', () => {
    const dr = monsterTop({}, 'basic');
    const mask = drawingMask(dr, 36);
    let m = 0;
    for (const v of mask) m += v;
    // 마스크는 선(외곽선)을 넣지 않는다 → 칠만 남긴 그림과 견주면 거의 같고, 선까지 칠하면 외곽선 몫(바깥 w)만큼 크다
    const fills = drawingRaster({ ops: dr.ops.filter((o) => !o.stroke) }, 36);
    const all = visibility(drawingRaster(dr, 36), FLOOR, 0, 1);
    expect(fills.n * fills.n).toBe(mask.length);
    expect(visibility(fills, FLOOR, 0, 1).area / m).toBeCloseTo(1, 1);
    expect(all.area).toBeGreaterThan(m * 1.1);
  });

  it('외곽 대비는 외곽선 안쪽 띠를 잰다: 짙은 테를 두른 빨간 원판의 띠는 빨강', () => {
    const d = 40;
    const w = 0.1;
    const ring = path().circle(0, 0, 0.8).d;
    const dr: Drawing = {
      ops: [
        { d: ring, stroke: { paint: solid(0x05080c), width: w * 2 } },
        { d: ring, fill: solid(0xef4444) },
      ],
    };
    const v = visibility(drawingRaster(dr, d), FLOOR, (w * d) / 2, BAND * d);
    expect(v.rimCells).toBeGreaterThan(0);
    expect(v.rim / relativeLuminance(0xef4444)).toBeGreaterThan(0.95);
    expect(v.rimContrast).toBeGreaterThan(3);
  });

  it('바깥까지 거리(거리 변환)는 모든 바깥 칸을 다 훑은 거리와 같다 · visibilityDetail의 평균 값은 visibility와 같다', () => {
    // 결정적 무늬 (가운데 큰 덩어리 + 구멍 + 가장자리에 닿는 칸)
    const n = 23;
    const on = new Uint8Array(n * n);
    for (let j = 0; j < n; j += 1)
      for (let i = 0; i < n; i += 1)
        on[j * n + i] = (i * 7 + j * 13) % 11 !== 0 && Math.hypot(i - 11, j - 9) < 10 ? 1 : 0;
    on[0] = 1;
    const dist = outsideDistance(on, n);
    for (let j = 0; j < n; j += 1)
      for (let i = 0; i < n; i += 1) {
        let best = Math.min(i + 1, j + 1, n - i, n - j);
        for (let jj = 0; jj < n; jj += 1)
          for (let ii = 0; ii < n; ii += 1)
            if (!on[jj * n + ii]) best = Math.min(best, Math.hypot(ii - i, jj - j));
        expect(dist[j * n + i]).toBeCloseTo(best, 9);
      }
    for (const costume of MONSTER_COSTUMES)
      for (const [d, rot] of [
        [24, ROT_SLANT],
        [36, ROT_AXIS],
      ] as const) {
        const r = drawingRaster(monsterTop({ dash: 1 }, costume), d, rot);
        const v = visibility(r, FLOOR, (W * d) / 2, BAND * d);
        const x = visibilityDetail(r, FLOOR, (W * d) / 2, BAND * d, { rot });
        expect([x.area, x.luma, x.rim, x.rimCells, x.rimContrast]).toEqual([
          v.area,
          v.luma,
          v.rim,
          v.rimCells,
          v.rimContrast,
        ]);
        expect(x.rimSectorCells.reduce((a, b) => a + b, 0)).toBe(v.rimCells);
      }
  });

  it('조각은 몸 방향 기준: 오른쪽 반만 흰 원판은 돌려 칠해도 오른쪽 조각(2)이 밝고 왼쪽 조각(6)이 어둡다', () => {
    const d = 40;
    // 짙은 원판 + 오른쪽(+y, 화면 아래 = 앞(+x)을 볼 때 오른손 쪽) 반원만 흰색
    const dr: Drawing = {
      ops: [
        { d: path().circle(0, 0, 0.8).d, fill: solid(0x303030) },
        { d: path().arc(0, 0, 0.8, 0, Math.PI).Z().d, fill: solid(0xffffff) },
      ],
    };
    for (const rot of [0, 1.1, 2.5]) {
      const x = visibilityDetail(drawingRaster(dr, d, rot), FLOOR, 0, BAND * d, { rot });
      const s = x.rimSectors;
      expect(s.length).toBe(8);
      expect(s[2] ?? 0).toBeGreaterThan(0.8);
      expect(s[6] ?? 1).toBeLessThan(0.05);
      expect(Math.min(...x.rimSectorCells)).toBeGreaterThan(0);
    }
  });

  it('바닥 대비 면적은 바닥색 칠을 세지 않는다 (보이는 면적은 센다)', () => {
    const d = 40;
    const floorDisc = visibilityDetail(drawingRaster(disc(FLOOR), d), FLOOR, 0, 2);
    const whiteDisc = visibilityDetail(drawingRaster(disc(0xffffff), d), FLOOR, 0, 2);
    const faint = visibilityDetail(
      drawingRaster({ ops: [{ d: path().circle(0, 0, 0.8).d, fill: solid(0xffc0cb, 0.1) }] }, d),
      FLOOR,
      0,
      2,
    );
    expect(floorDisc.area).toBeGreaterThan(0);
    expect(floorDisc.contrastArea).toBe(0);
    expect(faint.contrastArea).toBe(0);
    expect(whiteDisc.contrastArea / whiteDisc.area).toBeGreaterThan(0.99);
    expect(wcagContrast(relativeLuminance(0x05080c), FLOOR_L)).toBeLessThan(FLOOR_CONTRAST);
  });
});

describe('잴 크기는 게임이 굽는 크기 (layout · resolution · presets · atlas 식)', () => {
  it('atlas.ts 굽기 식 · 외곽선 두께가 여기 옮긴 것과 같다 (atlas.ts는 Phaser를 불러 import하지 못한다)', () => {
    const src = readFileSync('client/src/art/atlas.ts', 'utf8');
    expect(src).toContain('return Math.min(Math.max(0.25, zoom) * worldScale, cap > 0 ? cap : Infinity);');
    expect(src).toContain(`outlineWorldPx: ${OUTLINE_WORLD_PX},`);
    expect(src).toContain('m: params.monsterR * TILE_PX * tpw');
    expect(src).toContain('const wm = ART.outlineWorldPx / (monsterR * TILE_PX);');
    // 판 화면은 기본 확대 수준으로 굽는다
    expect(readFileSync('client/src/main.ts', 'utf8')).toMatch(/setCamZoom\([\s\S]*?DEFAULT_CAM_ZOOM,?\s*\)/);
  });

  it('크기 다섯: 휴대폰 낮음 < 낮음 상한 < PC 1080p < 중간 상한 < 높음 상한, 상한은 실제 화면이 닿는다', () => {
    const ds = SIZES.map((s) => s.d);
    for (let i = 1; i < ds.length; i += 1) expect(ds[i] ?? 0).toBeGreaterThan(ds[i - 1] ?? Infinity);
    // 가장 작은 휴대폰 크기는 지금 약 24px (iPhone SE · 터치 낮음)
    expect(PHONE_LOW.d).toBeGreaterThan(16);
    expect(PHONE_LOW.d).toBeLessThan(32);
    // PC 1920×1080 배율 2: 높음 · 중간은 상한에 닿고, 낮음은 배율 1에서 이미 상한
    const pc2 = { ...PC_1080, dpr: 2 };
    expect(bodyPx(pc2, 'high', false)).toBeCloseTo(capPx('high'), 6);
    expect(bodyPx(pc2, 'medium', false)).toBeCloseTo(capPx('medium'), 6);
    expect(bodyPx(PC_1080, 'low', false)).toBeCloseTo(capPx('low'), 6);
    // PC 1080p 높음 · 중간은 상한 아래 (1:1)
    expect(bodyPx(PC_1080, 'medium', false)).toBeCloseTo(bodyPx(PC_1080, 'high', false), 6);
    expect(bodyPx(PC_1080, 'high', false)).toBeLessThan(capPx('medium'));
    // 높음 상한은 자세 일부만 (이름이 실제 자세 이름인지)
    const names = POSES.map(([name]) => name);
    for (const n of POSES_AT_HIGH_CAP) expect(names).toContain(n);
    // 같은 그림 빼기는 한 자세(걷기 0 = 서기)까지만 — 더 빠지면 자세 묶음이 그림과 어긋난 것이다
    for (const c of MONSTER_COSTUMES)
      expect(distinctPoses(c).length).toBeGreaterThanOrEqual(POSES.length - 1);
  });
});

describe('괴물 의상: 생존자 화면에서 보이는 정도가 기본과 같다 (꾸미기는 유불리가 없다)', () => {
  for (const costume of MONSTER_COSTUMES.filter((c) => c !== 'basic'))
    it(`${costume}: 게임 크기 다섯 · 모든 자세 · 방향에서 면적 ±${AREA_TOL * 100}% · 밝기 ±${LUMA_TOL * 100}% · 외곽 대비 ±${RIM_TOL * 100}% · 조각 대비 ≥ ${SECTOR_MIN} · 바닥 대비 면적 ±${CONTRAST_AREA_TOL * 100}%`, () => {
      const gaps = ratios(costume);
      expect(gaps.length).toBe(caseCount(costume));
      expect(gaps.flatMap(outside)).toEqual([]);
    });
});

describe('점검이 실제로 잡는다 (반례)', () => {
  /** 반례는 작은 두 크기 · 자세 셋에서만 (시간) */
  const SMALL: Coverage = { sizes: SIZES.slice(0, 2), poses: ['서기', '걷기 2', '공격 준비'] };

  it('옛 시안처럼 어깨에 거의 검은 말굽 띠(#1A0B0E)를 두르면 밝기 · 조각 대비가 기준 밖', () => {
    // 목 둘레 0.5r ~ 어깨 0.97r 말굽 띠 (뒤쪽 반 + 옆, 앞은 열림) — 옛 '까마귀 깃' 위 그림의 깃 몸 색
    const band = path()
      .arc(0, 0, 0.97, Math.PI * 0.3, Math.PI * 1.7)
      .arc(0, 0, 0.5, Math.PI * 1.7, Math.PI * 0.3, false)
      .Z().d;
    const dark = (dr: Drawing): Drawing => {
      const ops = [...dr.ops];
      // 망토 칠 바로 위 (의상 훅 자리와 같게 — 두건 · 팔 · 얼굴보다 먼저). 앞쪽 명령은 외곽선 패스(선만)라 첫 칠이 망토다
      const cloak = ops.findIndex((o) => o.fill !== undefined);
      ops.splice(cloak + 1, 0, { d: band, fill: solid(0x1a0b0e) });
      return { ops };
    };
    const gaps = ratios('basic', dark, SMALL);
    expect(gaps.some((g) => g.luma < 1 - LUMA_TOL)).toBe(true);
    expect(Math.min(...gaps.map((g) => g.luma))).toBeLessThan(0.8);
    expect(gaps.every((g) => g.sector < SECTOR_MIN)).toBe(true);
  });

  it('검증 반례: 망토 테두리를 뒤(x < −0.45)는 바닥색, 옆 · 앞은 옅은 분홍(알파 0.18)으로 덧칠하면 평균 셋은 지나도 조각 대비 · 바닥 대비 면적이 잡는다', () => {
    // 망토 외곽을 따라 0.3 굵기 선 (외곽선 위 · 테두리 띠를 덮는다). 뒤 4분의 1은 바닥에 묻히고, 옆 · 앞을 조금 밝혀 평균을 맞춘다
    const cut = -0.45;
    const t = (cut + 1.2) / 2.4;
    const sneaky = (dr: Drawing): Drawing => {
      const ops = [...dr.ops];
      const i = ops.findIndex((o) => o.fill !== undefined);
      const cloak = ops[i];
      if (!cloak) throw new Error('망토 칠이 없다');
      ops.splice(i + 1, 0, {
        d: cloak.d,
        stroke: {
          paint: linear(-1.2, 0, 1.2, 0, [
            [0, FLOOR, 1],
            [t, FLOOR, 1],
            [t + 0.004, 0xffc0cb, 0.18],
            [1, 0xffc0cb, 0.18],
          ]),
          width: 0.3,
          join: 'round',
        },
      });
      return { ops };
    };
    const gaps = ratios('basic', sneaky, SMALL);
    expect(gaps.length).toBe(12);
    // 1판 점검(평균 셋)의 빈틈: 바닥색 칠도 면적으로 세고, 평균은 옆이 메운다
    expect(gaps.every((g) => Math.abs(g.area - 1) <= AREA_TOL)).toBe(true);
    expect(gaps.some((g) => outsideMeans(g).length === 0)).toBe(true);
    // 2판 점검: 모든 경우에서 뒤 조각 대비와 바닥 대비 면적이 기준 밖
    for (const g of gaps) {
      expect(g.sector, g.where).toBeLessThan(SECTOR_MIN);
      expect(SECTOR_NAME[g.sectorAt], g.where).toMatch(/뒤/);
      expect(g.contrastArea, g.where).toBeLessThan(1 - CONTRAST_AREA_TOL);
    }
  });
});

// 의상 유불리 점검 (판 밖 메타 c, 사용자 결정: '꾸미기는 유불리가 없어야 한다'): 괴물 의상은 생존자 화면에도 그대로 보이므로,
// 의상 때문에 괴물이 바닥 · 어둠 속에서 덜 보이면 생존자에게 불리하고, 더 보이면 괴물에게 불리하다. 그래서 생존자 화면의 괴물
// 위 그림(게임 화면)을 Node에서 직접 칠해(client/src/art/chars/measure.ts drawingRaster) 같은 프레임 · 크기 · 화면의 기본 그림과
// 견준다. 이 파일은 칠하기 · 재기 도구, 잴 크기 · 프레임, 반례, Chromium 기준 값을 본다. 괴물 의상마다 점검(보이는 정도 · 몸 색조 ·
// 몸 가운데 원판)은 costume-parity-{hood,feathers,chains}.test.ts, 생존자 의상의 몸 가운데 원판은 costume-parity-disc*.test.ts
// (공용 식: tests/helpers/parity.ts).
//
// 칠하기 — 실제 Canvas2D와 같게 (3판, 검증에서 찾은 빈틈):
//   Canvas는 명령(칠 · 선)마다 따로 안티에일리어싱해 겹친다. 두 도형이 맞닿은 곳(깃대를 따라 나뉜 두 광택 반쪽, 사슬 가장자리 ·
//   쇠 · 광택 선)에서는 두 도형이 각자 칸을 반쯤 덮어 밑의 짙은 층이 이음매로 비친다. 표본을 다 칠한 뒤 평균하면(2판 방식) 이
//   이음매가 메워져 깃 · 사슬이 실제보다 2 ~ 4% 밝게 나왔다. 지금은 명령마다 칸 덮임을 재서 칸 단위로 겹치고(source-over), 화면에서
//   1px 이하인 선은 Skia처럼 머리카락 선 × 두께로 긋는다. 남은 차이(Skia의 작은 곡선 · 얇은 조각 근사)는
//   scripts/char-art/raster-calibrate.ts로 잰다: 의상 / 기본 비율이 소프트웨어 Canvas와 45px에서 밝기 · 외곽 · 조각 1% 안(바닥 대비
//   면적 2.2%), 21 ~ 24px에서 밝기 1.8% · 조각 2.9% · 외곽 4% 안(평균 0.3 ~ 0.8%)이고 Node가 조금 너그러운 쪽이다. GPU Canvas는
//   소프트웨어 Canvas와 그만큼(작은 크기 밝기 ±3 ~ 4%) 다르다. 기준(±5% · 0.93 · 0.9)은 이 차이보다 넓지만 경계 바로 안쪽 값
//   (작은 크기 밝기 0.95 ~ 0.97)은 실제 화면에서 경계를 넘을 수 있으니 그림은 여유를 둔다. 아래 'Chromium 기준 값' 시험이 잰 값을
//   박아 두어 칠하기가 Canvas에서 멀어지면 잡는다.
//
// 화면 — 아틀라스에 굽고 화면에 찍는 그대로:
//   캐릭터 그림은 안개 · 어둠 층 위에 그린다(art/atlas.ts 굽기 → 스프라이트). 어둠은 바닥만 어둡게 하고 그림 색은 그대로다.
//   그래서 그림 칸 색 · 휘도 비율(밝기 · 외곽 대비)은 빛과 상관없고, 조각 대비 비율은 바닥보다 밝은 조각이면 바닥 밝기와 상관없이
//   (L의상 + 0.05) / (L기본 + 0.05)이다. 바닥보다 어두운 조각(얼굴 그늘)만 빛 속 바닥에서 더 엄하므로 빛 속 바닥 강판색
//   (MAP_COLOR.floor)에서 잰다. 색조는 맵 바닥 톤 전부(FLOOR_COLORS — 짙은 이음선 톤까지)에서 잰다.
//   굽기: 프레임을 돌리지 않고 아틀라스 칸 위상(atlas.ts cellOf의 원점 소수부, 크기마다 다르다)으로 굽는다. 1:1로 찍히는 크기는
//   화면에서 방향 0 · 0.6 · 2.5(축 · 비스듬 · 거의 뒤)로 돌려 WebGL 쌍선형으로 다시 샘플하고(measure.ts resampleRaster), 휴대폰
//   낮음 무리(32px 아래)는 반 화소 어긋난 위상(0.5, 0.5 — 쌍선형이 가장 많이 번지는 자리)도 잰다. 품질 상한에 닿은 크기는
//   아틀라스가 상한으로 구운 그림을 늘려 찍으므로 구운 그대로(방향 0) 잰다.
//
// 크기 — 몸 지름(텍셀) = 2 × 괴물 판정 반지름 × TILE_PX × 텍셀/월드 px (atlas.ts texelsPerWorldPx: 화면 배율 zoom × 월드 배율, 품질
//   charTexelCap 상한). zoom은 배치(layout.ts) · 해상도(resolution.ts, 품질 preset)가 정한다 — 숫자를 박지 않고 그 식에서 구한다.
//   ① 배율 1.25 휴대폰 터치 낮음 ≈ 21.4 (터치 낮음 배율 하한에 닿는 가장 작은 화면) ② iPhone SE 터치 낮음 ≈ 24.1 ③ iPhone 8 ≈ 26.5
//   ④ Galaxy S8 ≈ 29.5 (S9+ · iPhone 12 같은 값) ⑤ Pixel 5 + 안전 영역 터치 높음 ≈ 36.4 ⑥ PC 1280×720 높음 ≈ 41.7 ⑦ 낮음 상한 44.8
//   ⑧ PC 1080p 높음 ≈ 62.5 ⑨ 중간 상한 67.2 ⑩ 높음 상한 89.6 (실제 화면은 21.4 ~ 89.6 사이 어디든 된다 — 흔한 값 · 끝 · 상한을 잰다)
// 프레임 — 아틀라스가 굽는 괴물 칸 21개 전부 (charFrames.ts newStyleFrameSpecs: 대기 망토 8 · 걷기 8 · 돌진 · 기절 · 공격 준비 ·
//   타격 · 포효). 같은 그림은 한 번만 칠한다.
//
// 견주는 값 (모두 의상 / 기본 비율, 같은 프레임 · 크기 · 화면):
//  - 보이는 면적 ±2%: 알파 0.5 이상 칸 수 (외곽선 포함 실루엣). 의상은 크기 기준(measure.SIZE_RULE)을 넘지 못하고 키우지 않는다
//  - 밝기 ±5%: 보이는 칸을 바닥 위에 얹은 색의 평균 상대 휘도 (WCAG 식). 같은 기본 괴물도 자세에 따라 ±10%, 같은 그림을 24px ·
//    90px로 그린 차이도 6 ~ 9%다 — 그 아래로 두어 의상이 보이는 정도를 자세 하나가 바뀌는 것보다 작게 바꾼다. 위아래 모두 막는다
//  - 외곽 대비 ±5%: 외곽선(#05080C, 바닥과 거의 같은 어둠) 바로 안쪽 테두리 띠(몸 지름 8% 폭)의 평균 상대 휘도 — 바닥 · 어둠에서
//    실루엣을 가르는 곳이고 의상이 어둡게 만들 수 있는 곳이다
//  - 조각 대비 ≥ 0.93: 띠를 몸 중심 둘레 8조각(몸 방향 기준 45°)으로 나눠 조각마다 바닥과의 WCAG 대비를 견준다. 배치는 둘 —
//    앞 가운데에서 시작하는 배치와 반 조각(22.5°) 어긋난 배치 — 이라 조각 경계에 걸친 어두운 덩어리가 두 조각에 나뉘어 숨지
//    못한다. 조각은 기본 그림의 띠 칸에서 두 그림을 견준다(같은 칸, measure.ts pairedSectorContrast): 그림마다 제 띠를 쓰면 의상이
//    실루엣을 1px만 키워도 띠가 밀려 24px에서 조각(띠 15칸 안팎) 평균이 칸 하나에 6%씩 흔들린다 — 기본 괴물이 바닥과 갈리던
//    자리가 의상을 입어도 그만큼 갈리는지를 본다. 0.93 = 7% 넘게 잃지 않기: 테두리를 건드리지 않는 두건이 0.98 이상, Node와
//    Chromium의 차이가 ±0.03 안이고, 뒤를 바닥색으로 칠한 반례는 0.66 ~ 0.88, 말굽 띠는 0.57 ~ 0.71이다. 아래쪽만 막는다
//    (한쪽이 밝아지면 의상을 입은 괴물이 불리할 뿐이고, 고르게 밝아지는 것은 밝기 · 외곽 대비 상한이 막는다). 대비는 바닥 기준
//    WCAG 식이라 바닥보다 어두운 조각(얼굴)이 바닥색 쪽으로 밝아져도 잃는다
//  - 바닥 대비 면적 ±5%: 바닥 위에 얹은 색이 바닥과 WCAG 대비 1.5 이상인 칸 수 — 바닥색 · 옅은 칠은 세지 않으므로 알파만 채운
//    칠로 면적을 지킬 수 없다. 기본 괴물도 자세에 따라 ±6% 오르내린다. 위아래 모두 막는다
//  - 조각 색조 ≥ 0.9: 휘도만 보면 같은 휘도의 바닥 청회색으로 칠한 테두리가 빠져나간다(검증: 사슬 끝 IRON_DARK #1F2937은 바닥
//    #17212B와 ΔE76 4.8, 기본 망토 끝은 36.9). 그래서 같은 띠 칸 · 같은 두 배치의 조각마다 바닥 톤까지 평균 ΔE76(CIELAB)을
//    견주고 가장 나쁜 바닥 톤 · 조각을 본다. 두건 0.987 이상, Node ↔ Chromium 차이 ±0.015(0.85 이상 값에서), 망토를 같은 휘도의
//    바닥 색조로 칠한 반례는 0.12 ~ 0.21이다. 아래쪽만 막는다
//  - 몸 색조 ≥ 0.9 (4판, 검증에서 찾은 빈틈): 띠 색조는 테두리 띠만 봐서, 띠 안쪽(0.47 ~ 0.65r 고리 — 몸의 약 20%)을 같은 휘도의
//    바닥 색조로 칠하면 휘도 점검 · 띠 색조를 다 지나갔다. 그래서 기본 그림의 보이는 칸 전부(외곽선 포함, 같은 칸)에서 칸 색과
//    바닥 톤의 ΔE76을 ① 몸 전체 평균 ② 몸 중심 둘레 8조각(몸 방향 기준, 띠와 같은 두 배치)마다 평균해 의상 / 기본을 견주고 가장
//    나쁜 바닥 톤 · 조각을 본다(measure.ts pairedBodyHue). 하한은 띠 색조와 같은 0.9: 두건 몸 전체 0.989 · 몸 조각 0.969 이상, 까마귀
//    깃 0.976 · 0.952 이상, 고리 반례는 21프레임 · 크기 열 전부에서 몸 전체 0.83 ~ 0.90 · 몸 조각 0.75 ~ 0.85다. Node − Chromium
//    (raster-calibrate와 같은 격자, 9자세 × 21 ~ 45px × 화면 셋)은 소프트웨어 Canvas에서 몸 전체 −0.006 ~ +0.002 · 몸 조각 −0.014 ~
//    +0.009, GPU Canvas에서 −0.016 ~ +0.006 · −0.032 ~ +0.015라 0.95 안팎 값(까마귀 깃)도 0.9와 여유가 있다. 아래쪽만 막는다
//  - 몸 가운데 원판 (VISUAL_SPEC 0장 ②, 4판부터 크기 열 · 방향 · 위상 전부 — 전에는 44.8px 구운 그대로만): 0.45r 원판에서 기본 그림과
//    ΔE76 15 넘게 다른 칸이 5% 이하. 크기와 상관없이 같은 상한이다 — 원판 둘레 1텍셀 안으로 번지는 가장자리(안티에일리어싱 ·
//    쌍선형)도 휴대폰 크기 화면에 실제로 보이는 역할색 침범이라 그대로 센다(원판 칸이 21px에서 약 74칸 · 생존자 18px에서 약 54칸이라
//    5%는 2 ~ 3칸: 의상 가장자리가 원판에서 1텍셀 넘게 떨어져야 한다). Node − Chromium 원판 몫 차이 −1.4 ~ +2.7%p
// 생존자 의상은 보이는 정도를 재지 않는다: 괴물 화면의 생존자는 언제나 흰 공통 그림이고(의상 훅 없음, VISUAL_SPEC 0장 ③), 생존자
// 의상은 같은 편(생존자끼리)에게만 보이므로 누가 누구를 보는지(상대 편 정보)를 바꾸지 못한다. 몸 가운데 역할색만 본다 — 생존자
// 몸 지름(괴물 몸 지름 × 생존자 반지름 / 괴물 반지름, 같은 화면 · 품질에서 약 18.4 ~ 76.8px)으로 같은 화면 방향 · 위상에서.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MONSTER_COSTUMES, type MonsterCostumeId } from '@decoy/shared';
import { MONSTER_BOX, MONSTER_FRAME_NAMES, SURVIVOR_BOX } from '../../client/src/art/charFrames';
import { MONSTER_ART } from '../../client/src/art/chars/index';
import { linear, path, solid, type Drawing } from '../../client/src/art/chars/kit';
import {
  deltaE76,
  discDiffShare,
  drawingMask,
  drawingRaster,
  labHex,
  luminance01,
  outsideDistance,
  pairedBodyHue,
  pairedSectorContrast,
  pairedSectorHue,
  resampleRaster,
  sectorMeans,
  visibility,
  visibilityDetail,
  wcagContrast,
  type DrawingRaster,
} from '../../client/src/art/chars/measure';
import { MONSTER_REST, type MonsterPose } from '../../client/src/art/chars/types';
import { relativeLuminance } from '../../client/src/art/palette';
import { TOUCH_LOW_OVERRIDE } from '../../client/src/gfx/presets';
import {
  AREA_TOL,
  BAND,
  BODY_HUE_MIN,
  CONTRAST_AREA_TOL,
  FLOOR,
  FLOOR_CONTRAST,
  FLOOR_L,
  HUE_FLOORS,
  HUE_MIN,
  LUMA_TOL,
  MONSTER_R_PX,
  OUTLINE_WORLD_PX,
  PC_1080,
  PHONE_LOW,
  PHASES_SMALL,
  ROTS_1TO1,
  SECTOR_MIN,
  SECTOR_NAME,
  SIZES,
  SIZE_GROUPS,
  SURVIVOR_R_PX,
  SURVIVOR_SIZES,
  W,
  atlasPhase,
  bake,
  bodyPx,
  capPx,
  fingerprint,
  floorHueAt,
  floorHuePaint,
  monsterFrames,
  outsideBody,
  outsideDisc,
  outsideMeans,
  outsideSpread,
  outsideVisibility,
  parityCases,
  phone,
  type CaseResult,
} from '../helpers/parity';

function monsterTop(pose: Partial<MonsterPose>, costume: MonsterCostumeId): Drawing {
  return MONSTER_ART.top({ ...MONSTER_REST, ...pose }, { w: W, costume });
}

/** 칸 (x, y) (그림 좌표 단위, 원점 = 격자 가운데) → 칸 번호 */
function cellAt(r: DrawingRaster, d: number, x: number, y: number): number {
  const i = Math.floor((r.cx ?? r.n / 2) + (x * d) / 2);
  const j = Math.floor((r.cy ?? r.n / 2) + (y * d) / 2);
  return (j * r.n + i) * 4;
}

function alphaSum(r: DrawingRaster): number {
  let s = 0;
  for (let k = 3; k < r.rgba.length; k += 4) s += r.rgba[k] ?? 0;
  return s;
}

// ───────────────────────── 칠하기 · 재기 도구 ─────────────────────────

describe('그림 칠하기 · 보이는 정도 재기 (measure.ts drawingRaster · resampleRaster · visibilityDetail)', () => {
  const disc = (color: number, r = 0.8): Drawing => ({
    ops: [{ d: path().circle(0, 0, r).d, fill: solid(color) }],
  });

  it('단색 원판: 면적은 πr² (그림 단위 1 = 몸 지름 / 2 텍셀), 칸 색은 그 색 그대로 (가장자리만 섞인다)', () => {
    const d = 40;
    const r = drawingRaster(disc(0xef4444), d);
    const v = visibility(r, FLOOR, 0, 2);
    const px = 0.8 * (d / 2);
    expect(v.area / (Math.PI * px * px)).toBeGreaterThan(0.98);
    expect(v.area / (Math.PI * px * px)).toBeLessThan(1.02);
    expect(alphaSum(r) / (Math.PI * px * px)).toBeCloseTo(1, 2);
    const c = cellAt(r, d, 0.01, 0.01);
    expect(r.rgba[c + 3]).toBeCloseTo(1, 5);
    expect(r.rgba[c]).toBeCloseTo(0xef / 255, 5);
    expect(luminance01(0xef / 255, 0x44 / 255, 0x44 / 255)).toBeCloseTo(relativeLuminance(0xef4444), 6);
  });

  it('evenodd 고리는 구멍이 비고, nonzero는 같은 방향 두 원을 다 채운다', () => {
    const d = 40;
    const two = path().circle(0, 0, 0.8).circle(0, 0, 0.4).d;
    const hole = drawingRaster({ ops: [{ d: two, fill: solid(0xffffff), rule: 'evenodd' }] }, d);
    const full = drawingRaster({ ops: [{ d: two, fill: solid(0xffffff) }] }, d);
    const c = cellAt(hole, d, 0.01, 0.01) + 3;
    expect(hole.rgba[c]).toBe(0);
    expect(full.rgba[c]).toBeCloseTo(1, 5);
  });

  it('선은 두께 × 길이만큼 덮고, butt 끝은 끝점에서 자른다 · 명령 알파는 칠 알파에 곱한다', () => {
    const d = 40;
    const sum = (dr: Drawing): number => alphaSum(drawingRaster(dr, d));
    const unit = d / 2;
    const round = sum({ ops: [{ d: 'M-1 0L1 0', stroke: { paint: solid(0xffffff), width: 0.2 } }] });
    const butt = sum({
      ops: [{ d: 'M-1 0L1 0', stroke: { paint: solid(0xffffff), width: 0.2, cap: 'butt' } }],
    });
    expect(butt / (2 * unit * 0.2 * unit)).toBeCloseTo(1, 2);
    // 둥근 끝 = 양 끝 반원 하나 몫 더
    expect((round - butt) / (Math.PI * (0.1 * unit) ** 2)).toBeCloseTo(1, 1);
    const alphaOp = sum({
      ops: [{ d: 'M-1 0L1 0', stroke: { paint: solid(0xffffff, 0.5), width: 0.2, cap: 'butt' }, alpha: 0.5 }],
    });
    expect(alphaOp / butt).toBeCloseTo(0.25, 2);
  });

  it('1px 이하 선은 Skia처럼 머리카락 선 × 두께: 덮임 합 = 두께 × 긴 축 길이 (45° 선은 길이 × 두께의 0.71배)', () => {
    const d = 40;
    const u = d / 2;
    const w = 0.04; // 0.8px
    const flat = alphaSum(
      drawingRaster(
        { ops: [{ d: 'M-0.9 0.013L0.9 0.013', stroke: { paint: solid(0xffffff), width: w, cap: 'butt' } }] },
        d,
      ),
    );
    const diag = alphaSum(
      drawingRaster(
        { ops: [{ d: 'M-0.6 -0.6L0.6 0.6', stroke: { paint: solid(0xffffff), width: w, cap: 'butt' } }] },
        d,
      ),
    );
    expect(flat / (w * u * 1.8 * u)).toBeCloseTo(1, 2);
    // 긴 축 길이 1.2u × 두께 (실제 길이 1.2√2 u의 1/√2)
    expect(diag / (w * u * 1.2 * u)).toBeCloseTo(1, 2);
    // 1px 넘는 선은 그대로 두께 × 길이
    const thick = alphaSum(
      drawingRaster(
        { ops: [{ d: 'M-0.6 -0.6L0.6 0.6', stroke: { paint: solid(0xffffff), width: 0.1, cap: 'butt' } }] },
        d,
      ),
    );
    expect(thick / (0.1 * u * 1.2 * Math.SQRT2 * u)).toBeCloseTo(1, 2);
  });

  it('맞닿은 두 도형의 이음매: 명령마다 칸 단위로 겹쳐 밑 색이 비친다 (Canvas와 같다 — 표본 평균이면 흰색으로 메워진다)', () => {
    // 짙은 원판 위에 흰 반원 둘 (y = 0에서 맞닿음). 위상 dy = 0.25 → 이음매가 칸 줄 가운데에서 1/4 아래 (위 반원이 3/4, 아래 반원이 1/4)
    const { d, dx, dy, row } = SYNTH_GRID;
    const r = drawingRaster(SYNTH.seam, d, 0, { dx, dy });
    const red = seamRowRed(r);
    // 칸 단위로 겹치면: 아래 반쪽(1/4) 먼저 → 위 반쪽(3/4) = 0.75 + 0.25 × (0.25 + 0.75 × 짙은 색)
    const dark = 0x20 / 255;
    expect(red).toBeCloseTo(0.75 + 0.25 * (0.25 + 0.75 * dark), 2);
    // 같은 줄의 칸 하나하나가 흰색이 아니다 (이음매가 메워지지 않는다)
    expect(r.rgba[(row * r.n + Math.floor(r.cx ?? 0)) * 4] ?? 1).toBeLessThan(0.9);
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
    expect(r.rgba[cellAt(r, d, -0.8, 0.6)] ?? 1).toBeLessThan(0.2);
    expect(r.rgba[cellAt(r, d, 0.8, 0.6)] ?? 0).toBeGreaterThan(0.8);
    // 원판(뒤 명령)이 위: 빨강
    expect(r.rgba[cellAt(r, d, 0.5, 0.01) + 1] ?? 1).toBeLessThan(0.02);
    expect(r.rgba[cellAt(r, d, 0.5, 0.01)] ?? 0).toBeGreaterThan(0.98);
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
        [24, 0.6],
        [36, 0],
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
        expect(x.rimIndex.length).toBe(v.rimCells);
      }
  });

  it('조각은 몸 방향 기준: 오른쪽 반만 흰 원판은 돌려 칠해도 오른쪽 조각(2)이 밝고 왼쪽 조각(6)이 어둡다 · 반 조각 어긋난 배치도 같다', () => {
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
      // 반 조각 어긋난 배치: 조각 q는 (q + 0.5) × 45° 가운데 — 1 · 2(67.5° · 112.5°)는 흰 반쪽 안, 5 · 6은 짙은 반쪽 안
      const h = sectorMeans(x, (k) => x.pixelLuma[k] ?? 0, 8, 0.5).mean;
      expect(Math.min(h[1] ?? 0, h[2] ?? 0)).toBeGreaterThan(0.8);
      expect(Math.max(h[5] ?? 1, h[6] ?? 1)).toBeLessThan(0.05);
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

  it('화면에 찍기(resampleRaster): 방향 0 · 같은 원점은 그대로, 반 화소 위상은 2×2 평균, 돌려도 덮임 합이 같다', () => {
    const d = 30;
    const r = drawingRaster(monsterTop({}, 'basic'), d, 0, { dx: 0.3, dy: -0.2 });
    const same = resampleRaster(r, 0, 0.3, -0.2);
    let diff = 0;
    for (let k = 0; k < r.rgba.length; k += 1)
      diff = Math.max(diff, Math.abs((same.rgba[k] ?? 0) - (r.rgba[k] ?? 0)));
    expect(diff).toBeLessThan(1e-6);
    const half = resampleRaster(r, 0, 0.8, 0.3);
    const n = r.n;
    const i = Math.floor(n / 2);
    for (let q = 0; q < 4; q += 1) {
      const avg =
        ((r.rgba[((i - 1) * n + i - 1) * 4 + q] ?? 0) +
          (r.rgba[((i - 1) * n + i) * 4 + q] ?? 0) +
          (r.rgba[(i * n + i - 1) * 4 + q] ?? 0) +
          (r.rgba[(i * n + i) * 4 + q] ?? 0)) /
        4;
      expect(half.rgba[(i * n + i) * 4 + q]).toBeCloseTo(avg, 5);
    }
    for (const rot of [0.6, 2.5])
      expect(alphaSum(resampleRaster(r, rot, 0.3, -0.2)) / alphaSum(r)).toBeCloseTo(1, 2);
  });

  it('CIELAB ΔE76: 흰색은 L 100, 사슬 끝 쇠색 #1F2937은 바닥 #17212B와 ΔE 4.8 (검증 값)', () => {
    const white = labHex(0xffffff);
    expect(white[0]).toBeCloseTo(100, 1);
    expect(Math.abs(white[1]) + Math.abs(white[2])).toBeLessThan(0.05);
    expect(deltaE76(labHex(0x1f2937), labHex(0x17212b))).toBeCloseTo(4.8, 1);
    expect(deltaE76(labHex(FLOOR), labHex(FLOOR))).toBe(0);
  });

  it('같은 칸 견주기: 같은 그림은 1, 한쪽 띠를 바닥색으로 칠하면 그 조각의 대비 · 색조가 떨어진다 · 몸 가운데 원판 몫', () => {
    const d = 40;
    const base: Drawing = { ops: [{ d: path().circle(0, 0, 0.8).d, fill: solid(0xef4444) }] };
    const left: Drawing = {
      ops: [
        ...base.ops,
        {
          d: path()
            .arc(0, 0, 0.8, Math.PI, 2 * Math.PI)
            .Z().d,
          fill: solid(FLOOR),
        },
      ],
    };
    const rb = drawingRaster(base, d);
    const rl = drawingRaster(left, d);
    const vb = visibilityDetail(rb, FLOOR, 0, BAND * d);
    const vl = visibilityDetail(rl, FLOOR, 0, BAND * d);
    expect(pairedSectorContrast(vb, vb, FLOOR_L, 8, [0, 0.5]).ratio).toBe(1);
    expect(pairedSectorHue(rb, rb, vb, [FLOOR], 8, [0, 0.5]).ratio).toBe(1);
    const s = pairedSectorContrast(vl, vb, FLOOR_L, 8, [0, 0.5]);
    expect(s.ratio).toBeLessThan(0.75);
    expect(SECTOR_NAME[s.at]).toBe('왼');
    expect(pairedSectorHue(rl, rb, vb, [FLOOR], 8, [0, 0.5]).ratio).toBeLessThan(0.1);
    // 원판: 같은 그림 0, 가운데를 다른 색으로 덮으면 1
    expect(discDiffShare(rb, rb, 0.45 * (d / 2), FLOOR, 15).share).toBe(0);
    const centre: Drawing = { ops: [...base.ops, { d: path().circle(0, 0, 0.6).d, fill: solid(0x22c55e) }] };
    expect(discDiffShare(drawingRaster(centre, d), rb, 0.45 * (d / 2), FLOOR, 15).share).toBe(1);
  });

  it('몸 색조(pairedBodyHue): 같은 그림은 1, 띠 안쪽 고리를 같은 휘도의 바닥 색조로 칠하면 띠 색조는 그대로여도 몸 전체 · 몸 조각이 떨어진다', () => {
    const d = 40;
    const red = 0xef4444;
    const base: Drawing = { ops: [{ d: path().circle(0, 0, 0.8).d, fill: solid(red) }] };
    const ring = (dr: string): Drawing => ({
      ops: [...base.ops, { d: dr, fill: solid(floorHueAt(red)), rule: 'evenodd' }],
    });
    // 띠(0.8r 바깥에서 몸 지름 8% = 0.16r, 0.64r까지) 안쪽 0.2 ~ 0.6r 고리 · 그 뒤쪽 반만
    const full = ring(path().circle(0, 0, 0.6).circle(0, 0, 0.2).d);
    const back = ring(
      path()
        .arc(0, 0, 0.6, Math.PI / 2, (Math.PI * 3) / 2)
        .arc(0, 0, 0.2, (Math.PI * 3) / 2, Math.PI / 2, false)
        .Z().d,
    );
    const rb = drawingRaster(base, d);
    const vb = visibilityDetail(rb, FLOOR, 0, BAND * d);
    const same = pairedBodyHue(rb, rb, HUE_FLOORS, 8, [0, 0.5]);
    expect([same.whole.ratio, same.sector.ratio]).toEqual([1, 1]);
    expect(same.cells).toBe(vb.area);
    // 같은 휘도라 밝기는 그대로, 띠 칸은 건드리지 않는다
    expect(relativeLuminance(floorHueAt(red)) / relativeLuminance(red)).toBeCloseTo(1, 1);
    for (const dr of [full, back]) {
      const rx = drawingRaster(dr, d);
      expect(pairedSectorHue(rx, rb, vb, HUE_FLOORS, 8, [0, 0.5]).ratio).toBeGreaterThan(0.99);
      const h = pairedBodyHue(rx, rb, HUE_FLOORS, 8, [0, 0.5]);
      expect(h.whole.ratio).toBeLessThan(BODY_HUE_MIN);
      expect(h.sector.ratio).toBeLessThan(h.whole.ratio + 1e-9);
    }
    // 뒤쪽 반 고리: 가장 나쁜 몸 조각이 뒤 쪽 (몸 방향 기준 — 돌려 칠해도 같다)
    for (const rot of [0, 2.5]) {
      const h = pairedBodyHue(
        drawingRaster(back, d, rot),
        drawingRaster(base, d, rot),
        HUE_FLOORS,
        8,
        [0, 0.5],
        rot,
      );
      expect(SECTOR_NAME[h.sector.at]).toMatch(/뒤/);
      expect(h.sector.ratio).toBeLessThan(0.8);
    }
  });
});

// ───────────────────────── Chromium 기준 값 ─────────────────────────
// 2026-10 헤드리스 Chromium 153 소프트웨어 Canvas(--disable-gpu --disable-accelerated-2d-canvas)에서 게임 drawToCanvas로 같은 격자에
// 칠해 잰 값. 다시 재기: `npx tsx scripts/char-art/raster-calibrate.ts` (① 합성 도형 · ② 괴물 서기 줄을 여기에 옮긴다).
// Node가 Canvas에서 멀어지면(칠하기를 바꾸다 이음매 · 머리카락 선 · 덮임이 틀어지면) 여기서 잡는다. 허용 폭 = 지금 남은 차이 + 여유:
// 큰 도형 2%, 굵은 선 3%, 0.25px 머리카락 선 · 반지름 3px 원판 5% (Skia가 작은 곡선을 몇 조각으로 펴 조금 작게 칠한다).
// 괴물 서기 값은 그림 지문(명령 JSON의 FNV-1a)과 묶여 있다: 그림이 바뀌면 지문 시험이 실패하고(건너뛰지 않는다 — 건너뛰면 기준
// 값이 낡은 채 아무도 모른다), 위 명령으로 다시 재서 ② 줄의 지문 · 밝기를 ART_REF에 옮겨야 지나간다.

/** 합성 도형 격자: 몸 지름 24px, 원점 위상 (0.3, 0.25) — 이음매(y = 0)가 칸 줄 20의 3/4 자리 */
const SYNTH_GRID = { d: 24, dx: 0.3, dy: 0.25, row: Math.floor(Math.ceil(24 * 1.7) / 2 + 0.25) } as const;

/** raster-calibrate.ts SYNTH와 같은 그림 */
const SYNTH = {
  seam: {
    ops: [
      { d: path().circle(0, 0, 0.8).d, fill: solid(0x202020) },
      { d: path().arc(0, 0, 0.8, 0, Math.PI).Z().d, fill: solid(0xffffff) },
      {
        d: path()
          .arc(0, 0, 0.8, Math.PI, 2 * Math.PI)
          .Z().d,
        fill: solid(0xffffff),
      },
    ],
  },
  'hair-0.02': { ops: [{ d: 'M-1 -0.3L1 0.2L0.5 0.9', stroke: { paint: solid(0xffffff), width: 0.02 } }] },
  'hair-0.05': { ops: [{ d: 'M-1 -0.3L1 0.2L0.5 0.9', stroke: { paint: solid(0xffffff), width: 0.05 } }] },
  'stroke-0.2': { ops: [{ d: 'M-1 -0.3L1 0.2L0.5 0.9', stroke: { paint: solid(0xffffff), width: 0.2 } }] },
  'disc-3px': { ops: [{ d: path().circle(0, 0, 0.25).d, fill: solid(0xffffff) }] },
  grad: {
    ops: [
      {
        d: path().circle(0, 0, 0.8).d,
        fill: linear(-0.8, 0, 0.8, 0, [
          [0, 0x000000],
          [1, 0xffffff],
        ]),
      },
    ],
  },
} satisfies Record<string, Drawing>;

/** Chromium 값: 알파 합 · 허용 폭 (이음매는 이음매 줄 빨강 평균도) */
const SYNTH_REF: Record<keyof typeof SYNTH, { alpha: number; tol: number; seamRed?: number }> = {
  seam: { alpha: 295.404, tol: 0.02, seamRed: 0.835 },
  'hair-0.02': { alpha: 7.741, tol: 0.05 },
  'hair-0.05': { alpha: 19.494, tol: 0.03 },
  'stroke-0.2': { alpha: 85.796, tol: 0.03 },
  'disc-3px': { alpha: 27.22, tol: 0.05 },
  grad: { alpha: 285.271, tol: 0.02 },
};

/** 이음매 줄(원점 줄) 가운데 ±0.6r 칸의 빨강 평균 */
function seamRowRed(r: DrawingRaster): number {
  const { d, row } = SYNTH_GRID;
  const cx = r.cx ?? r.n / 2;
  let s = 0;
  let c = 0;
  for (let i = 0; i < r.n; i += 1)
    if (Math.abs(i + 0.5 - cx) < 0.6 * (d / 2)) {
      s += r.rgba[(row * r.n + i) * 4] ?? 0;
      c += 1;
    }
  return s / c;
}

/** 괴물 서기(monster-idle-0) 구운 그대로: 기본 밝기 · 의상 / 기본 밝기 비율과 그때 그림 지문 (2026-10-27, 사슬 4판 그림 — Chromium 153 소프트웨어 Canvas) */
const ART_REF = {
  fingerprints: { basic: '570c896f', hood: '88c88a33', feathers: 'da16e7b9', chains: '2ad238cb' },
  sizes: [
    { d: PHONE_LOW.d, basic: 0.0968, ratio: { hood: 1.004, feathers: 0.981, chains: 1.011 } },
    { d: capPx('low'), basic: 0.1037, ratio: { hood: 1.001, feathers: 0.993, chains: 1.013 } },
  ],
} as const;

const RECALIBRATE = 'npx tsx scripts/char-art/raster-calibrate.ts';

describe('Chromium 기준 값 (Node 칠하기가 실제 Canvas에서 멀어지지 않는다)', () => {
  it('합성 도형: 이음매 · 머리카락 선 · 굵은 선 · 작은 원판 · 그라디언트의 덮임 합이 Chromium과 허용 폭 안', () => {
    const { d, dx, dy } = SYNTH_GRID;
    for (const [name, dr] of Object.entries(SYNTH) as [keyof typeof SYNTH, Drawing][]) {
      const ref = SYNTH_REF[name];
      const r = drawingRaster(dr, d, 0, { dx, dy });
      expect(Math.abs(alphaSum(r) / ref.alpha - 1), name).toBeLessThanOrEqual(ref.tol);
      if (ref.seamRed !== undefined) expect(Math.abs(seamRowRed(r) - ref.seamRed), name).toBeLessThan(0.01);
    }
  });

  const current = Object.fromEntries(
    (['basic', 'hood', 'feathers', 'chains'] as const).map((c) => [
      c,
      monsterFrames(c)
        .find((s) => s.name === MONSTER_FRAME_NAMES.idle[0])
        ?.draw(W),
    ]),
  ) as Record<'basic' | 'hood' | 'feathers' | 'chains', Drawing>;
  it('괴물 서기 그림 지문이 기준 값을 잰 그림과 같다 (다르면 실패 — 다시 재서 ART_REF를 고친다)', () => {
    const changed = (Object.keys(ART_REF.fingerprints) as (keyof typeof ART_REF.fingerprints)[])
      .filter((c) => fingerprint(current[c]) !== ART_REF.fingerprints[c])
      .map((c) => `${c}: 지금 ${fingerprint(current[c])}, 잰 때 ${ART_REF.fingerprints[c]}`);
    expect(
      changed,
      `괴물 서기 그림이 바뀌어 Chromium 기준 값이 낡았다 — \`${RECALIBRATE}\`로 다시 재서 ② 줄(지문 · 기본 밝기 · 의상 / 기본 밝기)을 tests/unit/costume-parity.test.ts ART_REF에 옮긴다`,
    ).toEqual([]);
  });

  it('괴물 서기 24px · 45px 구운 그대로: 기본 밝기 ±2%, 의상 / 기본 밝기 비율 ±0.012', () => {
    for (const s of ART_REF.sizes) {
      const base = visibilityDetail(bake(current.basic, s.d), FLOOR, (W * s.d) / 2, BAND * s.d);
      expect(Math.abs(base.luma / s.basic - 1)).toBeLessThan(0.02);
      for (const c of ['hood', 'feathers', 'chains'] as const) {
        const v = visibilityDetail(bake(current[c], s.d), FLOOR, (W * s.d) / 2, BAND * s.d);
        expect(
          Math.abs(v.luma / base.luma - s.ratio[c]),
          `${c} ${s.d.toFixed(1)}px (그림이 바뀌었으면 \`${RECALIBRATE}\`로 다시 잰다)`,
        ).toBeLessThanOrEqual(0.012);
      }
    }
  });
});

// ───────────────────────── 잴 크기 · 프레임 ─────────────────────────

describe('잴 크기 · 프레임 · 화면은 게임이 굽고 찍는 그대로 (layout · resolution · presets · atlas · charFrames 식)', () => {
  it('atlas.ts 굽기 식 · 외곽선 두께 · 칸 위상이 여기 옮긴 것과 같다 (atlas.ts는 Phaser를 불러 import하지 못한다)', () => {
    const src = readFileSync('client/src/art/atlas.ts', 'utf8');
    expect(src).toContain('return Math.min(Math.max(0.25, zoom) * worldScale, cap > 0 ? cap : Infinity);');
    expect(src).toContain(`outlineWorldPx: ${OUTLINE_WORLD_PX},`);
    expect(src).toContain('m: params.monsterR * TILE_PX * tpw');
    expect(src).toContain('s: params.survivorR * TILE_PX * tpw');
    expect(src).toContain('const wm = ART.outlineWorldPx / (monsterR * TILE_PX);');
    // 칸 원점 (atlasPhase가 따르는 식): 여백 = 외곽선 + 2, 원점 = 여백 − 상자 시작 × 단위, 칸 자리는 정수
    expect(src).toContain('const w = ART.outlineWorldPx * tpw;');
    expect(src).toContain('const pad = w + 2;');
    expect(src).toContain('ox: pad - b.x0 * u,');
    expect(src).toContain('oy: pad - b.y0 * u,');
    expect(src).toContain('ctx.translate(f.x + c.ox, f.y + c.oy);');
    expect(MONSTER_BOX.x0).toBeLessThan(0);
    const [px, py] = atlasPhase(capPx('low'));
    expect(px).toBeGreaterThanOrEqual(0);
    expect(py).toBeLessThan(1);
    // 판 화면은 기본 확대 수준으로 굽는다
    expect(readFileSync('client/src/main.ts', 'utf8')).toMatch(/setCamZoom\([\s\S]*?DEFAULT_CAM_ZOOM,?\s*\)/);
  });

  it('크기 열: 작은 것부터 열 개, 휴대폰 낮음 · 흔한 휴대폰 · PC · 품질 상한이 실제 화면 값과 같다', () => {
    const ds = SIZES.map((s) => s.d);
    expect(ds.length).toBe(10);
    for (let i = 1; i < ds.length; i += 1) expect(ds[i] ?? 0).toBeGreaterThan(ds[i - 1] ?? Infinity);
    // ① 터치 낮음 배율 하한 1.25에 닿은 iPhone SE 크기 화면 (약 21.4px), ② 기준 휴대폰 터치 낮음 가장 작은 값 (약 24.1px)
    expect(TOUCH_LOW_OVERRIDE.dprCap).toBe(1.25);
    expect(SIZES[0]?.d).toBeGreaterThan(18);
    expect(SIZES[0]?.d).toBeLessThan(PHONE_LOW.d);
    expect(PHONE_LOW.d).toBeGreaterThan(16);
    expect(PHONE_LOW.d).toBeLessThan(32);
    // ④ S8 · S9+ · iPhone 12 터치 낮음은 같은 값 (약 29.5px)
    expect(bodyPx(phone('Galaxy S9+'), 'low', true)).toBeCloseTo(bodyPx(phone('Galaxy S8'), 'low', true), 1);
    expect(bodyPx(phone('iPhone 12'), 'low', true)).toBeCloseTo(bodyPx(phone('Galaxy S8'), 'low', true), 1);
    // PC 1920×1080 배율 2: 높음 · 중간은 상한에 닿고, 낮음은 배율 1에서 이미 상한
    const pc2 = { ...PC_1080, dpr: 2 };
    expect(bodyPx(pc2, 'high', false)).toBeCloseTo(capPx('high'), 6);
    expect(bodyPx(pc2, 'medium', false)).toBeCloseTo(capPx('medium'), 6);
    expect(bodyPx(PC_1080, 'low', false)).toBeCloseTo(capPx('low'), 6);
    // PC 1080p 높음 · 중간은 상한 아래 (1:1)
    expect(bodyPx(PC_1080, 'medium', false)).toBeCloseTo(bodyPx(PC_1080, 'high', false), 6);
    expect(bodyPx(PC_1080, 'high', false)).toBeLessThan(capPx('medium'));
    // 상한 크기는 구운 그대로, 1:1 크기는 방향 셋, 32px 아래는 반 화소 위상까지
    const caps = [capPx('low'), capPx('medium'), capPx('high')];
    for (const s of SIZES) {
      expect(s.capped, s.label).toBe(caps.includes(s.d));
      expect(s.rots, s.label).toEqual(s.capped ? [0] : ROTS_1TO1);
      expect(s.phases.length, s.label).toBe(!s.capped && s.d < 32 ? PHASES_SMALL.length : 1);
    }
    expect(SIZE_GROUPS.flatMap((g) => g.sizes).length).toBe(SIZES.length);
  });

  it('생존자 크기 열: 같은 화면 · 품질의 괴물 크기 × 생존자 반지름 / 괴물 반지름, 방향 · 위상은 그 화면과 같고 칸 위상은 생존자 상자로', () => {
    expect(SURVIVOR_SIZES.length).toBe(SIZES.length);
    expect(SURVIVOR_R_PX).toBeLessThan(MONSTER_R_PX);
    SURVIVOR_SIZES.forEach((s, i) => {
      const m = SIZES[i];
      if (!m) throw new Error('크기 열 길이');
      expect(s.who).toBe('survivor');
      expect(m.who).toBe('monster');
      expect(s.d / m.d).toBeCloseTo(SURVIVOR_R_PX / MONSTER_R_PX, 9);
      expect([s.label, s.capped, s.rots, s.phases]).toEqual([m.label, m.capped, m.rots, m.phases]);
    });
    // 생존자 칸 원점: 같은 텍셀 배율(tpw)의 여백 · 생존자 상자 시작으로 (atlas.ts cellOf, 단위 s)
    const d = SURVIVOR_SIZES[1]?.d ?? 0;
    const tpw = d / (2 * SURVIVOR_R_PX);
    const ox = OUTLINE_WORLD_PX * tpw + 2 - SURVIVOR_BOX.x0 * (d / 2);
    const oy = OUTLINE_WORLD_PX * tpw + 2 - SURVIVOR_BOX.y0 * (d / 2);
    const [px, py] = atlasPhase(d, 'survivor');
    expect(px).toBeCloseTo(ox - Math.floor(ox), 9);
    expect(py).toBeCloseTo(oy - Math.floor(oy), 9);
  });

  it('프레임: 아틀라스가 굽는 괴물 칸 21개 그대로 (대기 망토 8 · 걷기 8 · 돌진 · 기절 · 준비 · 타격 · 포효), 의상마다 같은 이름', () => {
    const M = MONSTER_FRAME_NAMES;
    const want = [...M.idle, ...M.move, M.dash, M.stun, M.windup, M.strike, M.roar];
    for (const c of MONSTER_COSTUMES) expect(monsterFrames(c).map((s) => s.name)).toEqual(want);
  });
});

// ───────────────────────── 반례 ─────────────────────────

describe('점검이 실제로 잡는다 (반례 — 휴대폰 낮음 두 크기 · 방향 셋 · 위상 둘 · 자세 셋)', () => {
  const SMALL = SIZES.slice(0, 2);
  const FRAMES = [
    MONSTER_FRAME_NAMES.idle[0] ?? '',
    MONSTER_FRAME_NAMES.move[2] ?? '',
    MONSTER_FRAME_NAMES.windup,
  ];
  /** 망토 칠 바로 위에 끼운다 (의상 훅 자리와 같게 — 두건 · 팔 · 얼굴보다 먼저). 앞쪽 명령은 외곽선 패스(선만)라 첫 칠이 망토다 */
  const overCloak = (dr: Drawing, op: Drawing['ops'][number]): Drawing => {
    const ops = [...dr.ops];
    ops.splice(ops.findIndex((o) => o.fill !== undefined) + 1, 0, op);
    return { ops };
  };
  const cases = (extra: (dr: Drawing) => Drawing): CaseResult[] =>
    parityCases('basic', SMALL, { extra, frames: FRAMES });

  it('옛 시안처럼 어깨에 거의 검은 말굽 띠(#1A0B0E)를 두르면 밝기 · 조각 대비 · 바닥 대비 면적이 기준 밖', () => {
    // 목 둘레 0.5r ~ 어깨 0.97r 말굽 띠 (뒤쪽 반 + 옆, 앞은 열림) — 옛 '까마귀 깃' 위 그림의 깃 몸 색
    const band = path()
      .arc(0, 0, 0.97, Math.PI * 0.3, Math.PI * 1.7)
      .arc(0, 0, 0.5, Math.PI * 1.7, Math.PI * 0.3, false)
      .Z().d;
    const gaps = cases((dr) => overCloak(dr, { d: band, fill: solid(0x1a0b0e) }));
    expect(gaps.length).toBe(36);
    for (const g of gaps) {
      expect(g.gap.luma, g.frame).toBeLessThan(1 - LUMA_TOL);
      expect(g.gap.sector.ratio, g.frame).toBeLessThan(SECTOR_MIN);
      expect(g.gap.contrastArea, g.frame).toBeLessThan(1 - CONTRAST_AREA_TOL);
    }
    expect(Math.min(...gaps.map((g) => g.gap.luma))).toBeLessThan(0.8);
  });

  it('검증 반례: 망토 테두리를 뒤(x < −0.45)는 바닥색, 옆 · 앞은 옅은 분홍(알파 0.18)으로 덧칠하면 평균 셋은 지나도 뒤 조각 대비 · 색조가 잡는다', () => {
    // 망토 외곽을 따라 0.3 굵기 선 (외곽선 위 · 테두리 띠를 덮는다). 뒤 4분의 1은 바닥에 묻히고, 옆 · 앞을 조금 밝혀 평균을 맞춘다
    const t = (-0.45 + 1.2) / 2.4;
    const gaps = cases((dr) => {
      const cloak = dr.ops.find((o) => o.fill !== undefined);
      if (!cloak) throw new Error('망토 칠이 없다');
      return overCloak(dr, {
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
    });
    expect(gaps.length).toBe(36);
    // 1판 점검(평균 셋)의 빈틈: 바닥색 칠도 면적으로 세고, 평균은 옆이 메운다
    expect(gaps.every((g) => Math.abs(g.gap.area - 1) <= AREA_TOL)).toBe(true);
    expect(gaps.filter((g) => outsideMeans(g.gap).length === 0).length).toBeGreaterThan(gaps.length / 2);
    // 3판 점검: 모든 경우에서 뒤쪽 조각 대비 · 색조가 기준 밖
    for (const g of gaps) {
      expect(g.gap.sector.ratio, g.frame).toBeLessThan(SECTOR_MIN);
      expect(SECTOR_NAME[g.gap.sector.at], g.frame).toMatch(/뒤/);
      expect(g.gap.hue.ratio, g.frame).toBeLessThan(HUE_MIN);
      expect(outsideSpread(g.gap).length, g.frame).toBeGreaterThan(0);
    }
  });

  it('색조 반례: 망토를 같은 휘도의 바닥 청회색으로 칠하면 휘도 점검(평균 셋 · 조각 대비 · 바닥 대비 면적)은 다 지나도 조각 색조 · 몸 색조가 잡는다', () => {
    const gaps = cases((dr) => {
      const ops = [...dr.ops];
      const i = ops.findIndex((o) => o.fill !== undefined);
      const cloak = ops[i];
      if (!cloak?.fill) throw new Error('망토 칠이 없다');
      ops[i] = { ...cloak, fill: floorHuePaint(cloak.fill) };
      return { ops };
    });
    expect(gaps.length).toBe(36);
    for (const g of gaps) {
      expect(outsideMeans(g.gap), g.frame).toEqual([]);
      expect(g.gap.sector.ratio, g.frame).toBeGreaterThanOrEqual(SECTOR_MIN);
      expect(Math.abs(g.gap.contrastArea - 1), g.frame).toBeLessThanOrEqual(CONTRAST_AREA_TOL);
      expect(g.gap.hue.ratio, g.frame).toBeLessThan(HUE_MIN);
      expect(outsideBody(g.gap).length, g.frame).toBe(2);
    }
    expect(Math.max(...gaps.map((g) => g.gap.hue.ratio))).toBeLessThan(0.3);
  });

  it('몸 색조 반례 (4판 검증): 띠 안쪽 0.47 ~ 0.65r 고리(몸의 약 20%)를 같은 휘도의 바닥 색조로 칠하면 휘도 점검 · 띠 색조는 다 지나도 몸 색조가 잡는다', () => {
    // 망토 칠 바로 위 고리, 칠은 망토 칠을 같은 휘도의 바닥 색조로 (그라디언트 위치 그대로 — 칸마다 휘도가 망토와 같다)
    const ringD = path().circle(0, 0, 0.65).circle(0, 0, 0.47).d;
    const gaps = cases((dr) => {
      const cloak = dr.ops.find((o) => o.fill !== undefined);
      if (!cloak?.fill) throw new Error('망토 칠이 없다');
      return overCloak(dr, { d: ringD, fill: floorHuePaint(cloak.fill), rule: 'evenodd' });
    });
    expect(gaps.length).toBe(36);
    for (const g of gaps) {
      // 3판까지의 점검(평균 셋 · 조각 대비 · 바닥 대비 면적 · 띠 색조)은 모두 지난다 — 이 빈틈을 몸 색조가 막는다
      expect(outsideVisibility(g.gap), `${g.frame} ${g.view.size.d.toFixed(1)}px`).toEqual([]);
      expect(g.gap.body.whole.ratio, g.frame).toBeLessThan(BODY_HUE_MIN);
      expect(g.gap.body.sector.ratio, g.frame).toBeLessThan(BODY_HUE_MIN);
    }
    expect(Math.max(...gaps.map((g) => g.gap.body.sector.ratio))).toBeLessThan(0.86);
  });
});

describe('기본 괴물을 기본 괴물과 견주면 어느 점검도 걸리지 않는다 (크기 열 · 방향 · 위상 전부)', () => {
  // 자세 다섯 (서기 · 걷기 · 돌진 · 기절 · 공격 준비 — 실루엣 · 조각 칸 수가 가장 다른 것들). 21프레임 전부는 의상 파일마다 기본 그림을
  // 같은 식으로 재므로 여기서는 비어 있는 조각 · 0 나누기 같은 크기 · 화면 탓 빈틈만 본다
  const FRAMES = [
    MONSTER_FRAME_NAMES.idle[0] ?? '',
    MONSTER_FRAME_NAMES.move[2] ?? '',
    MONSTER_FRAME_NAMES.dash,
    MONSTER_FRAME_NAMES.stun,
    MONSTER_FRAME_NAMES.windup,
  ];
  it('모든 비율이 정확히 1, 원판 0%', () => {
    const res = parityCases('basic', SIZES, { frames: FRAMES });
    expect(res.length).toBe(FRAMES.length * SIZES.reduce((n, s) => n + s.rots.length * s.phases.length, 0));
    const off = res.filter((r) => {
      const g = r.gap;
      return (
        [
          g.area,
          g.luma,
          g.rim,
          g.contrastArea,
          g.sector.ratio,
          g.hue.ratio,
          g.body.whole.ratio,
          g.body.sector.ratio,
        ].some((v) => v !== 1) || g.disc !== 0
      );
    });
    expect(off.map((r) => `${r.frame} ${r.view.size.d.toFixed(1)}px`)).toEqual([]);
    expect(
      res.flatMap((r) => [...outsideVisibility(r.gap), ...outsideBody(r.gap), ...outsideDisc(r.gap)]),
    ).toEqual([]);
  });
});

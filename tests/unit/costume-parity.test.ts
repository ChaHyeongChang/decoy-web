// 의상 유불리 점검 (판 밖 메타 c, 사용자 결정: '꾸미기는 유불리가 없어야 한다'): 괴물 의상은 생존자 화면에도 그대로 보이므로,
// 의상 때문에 괴물이 안개 · 어둠 속에서 덜 보이면 생존자에게 불리하고, 더 보이면 괴물에게 불리하다. 그래서 생존자 화면의 괴물
// 위 그림(게임 화면)을 Node에서 직접 칠해(client/src/art/chars/measure.ts drawingRaster — Canvas 없이, 결정적) 보이는 정도 셋을
// 같은 자세 · 같은 크기 · 같은 방향의 기본 그림과 견준다.
//  - 보이는 면적: 알파 0.5 이상 칸 수 (외곽선 포함 실루엣)
//  - 밝기: 보이는 칸을 바닥 위에 얹은 색의 평균 상대 휘도 (WCAG 식)
//  - 외곽 대비: 외곽선 바로 안쪽 테두리 띠의 평균 상대 휘도 — 짙은 외곽선(#05080C)은 어두운 바닥과 거의 같아 실루엣을 가르지
//    못하고 모든 의상이 같다. 바닥 · 안개에서 괴물을 가르는 곳은 그 안쪽 띠이고, 의상이 어둡게 만들 수 있는 곳도 거기다
// 생존자 의상은 여기서 재지 않는다: 괴물 화면의 생존자는 언제나 흰 공통 그림이고(의상 훅 없음, VISUAL_SPEC 0장 ③), 생존자
// 의상은 같은 편(생존자끼리)에게만 보이므로 누가 누구를 보는지(상대 편 정보)를 바꾸지 못한다.
import { describe, expect, it } from 'vitest';
import { MONSTER_COSTUMES, TILE_PX, type MonsterCostumeId } from '@decoy/shared';
import { registerAllCostumeArt } from '../../client/src/art/chars/costume/art';
import { MONSTER_ART } from '../../client/src/art/chars/index';
import { path, linear, solid, type Drawing } from '../../client/src/art/chars/kit';
import {
  drawingMask,
  drawingRaster,
  luminance01,
  visibility,
  type Visibility,
} from '../../client/src/art/chars/measure';
import { MONSTER_REST, type MonsterPose } from '../../client/src/art/chars/types';
import { MAP_COLOR } from '../../client/src/art/mapArtGeom';
import { relativeLuminance } from '../../client/src/art/palette';
import { loadTestBalance } from '../helpers/fixtures';

registerAllCostumeArt();

/**
 * 게임과 같은 외곽선 두께 (그림 단위): atlas.ts ART.outlineWorldPx 1.8 월드 px ÷ 괴물 판정 반지름 px.
 * atlas.ts는 Phaser를 불러 여기서 import하지 않는다
 */
const OUTLINE_WORLD_PX = 1.8;
const W = OUTLINE_WORLD_PX / (loadTestBalance().monster.radius * TILE_PX);

/** 그림 밑 바닥 (빛 속 바닥 강판색). 안개 · 어둠은 이 위에 빛 지도를 곱하므로 비율로 견주면 같은 판정이 된다 */
const FLOOR = MAP_COLOR.floor;

/** 몸 지름 px: 휴대폰(괴물 반지름 약 8.5px) · 데스크톱 확대 화면 */
const SIZES = [18, 36] as const;
/** 화면 방향 (축에 맞은 경우 · 비스듬한 경우 — 화소 격자와 어긋난 가장자리) */
const ROTS = [0, 0.6] as const;

/** 테두리 띠: 외곽선(바깥으로 w) 안쪽부터 몸 지름의 8% 폭 */
const BAND = 0.08;

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

/**
 * 허용 폭 (기본 값에 대한 비율). '같게'를 이렇게 정했다:
 *  - 면적 ±2%: 의상은 크기 기준(measure.SIZE_RULE)을 넘지 못하고 키우지 않는다. 깃 끝이 어깨에서 조금 나오는 몫만 둔다
 *    (지금 의상 최대 0.4%)
 *  - 밝기 · 외곽 대비 ±5%: 같은 기본 괴물도 자세에 따라 밝기가 ±13%(포효 0.080 ~ 걷기 0.104), 외곽 띠가 ±50% 오르내리고,
 *    같은 그림을 18px · 36px로 그린 차이도 3~4%다. 그 아래로 두어 의상이 보이는 정도를 자세 하나가 바뀌는 것보다 작게
 *    바꾼다. 위아래 모두 막는다 (더 밝으면 괴물이 불리하다). 지금 의상 최대 차이: 밝기 4% · 외곽 4%
 */
const AREA_TOL = 0.02;
const LUMA_TOL = 0.05;
const RIM_TOL = 0.05;

function measure(dr: Drawing, d: number, rot: number): Visibility {
  return visibility(drawingRaster(dr, d, rot), FLOOR, (W * d) / 2, BAND * d);
}

function monsterTop(pose: Partial<MonsterPose>, costume: MonsterCostumeId): Drawing {
  return MONSTER_ART.top({ ...MONSTER_REST, ...pose }, { w: W, costume });
}

/** 기본 그림 값 (자세 · 크기 · 방향마다 한 번만 칠한다) */
const basicCache = new Map<string, Visibility>();
function basic(name: string, pose: Partial<MonsterPose>, d: number, rot: number): Visibility {
  const key = `${name}@${d}/${rot}`;
  let v = basicCache.get(key);
  if (!v) basicCache.set(key, (v = measure(monsterTop(pose, 'basic'), d, rot)));
  return v;
}

interface Gap {
  readonly where: string;
  readonly area: number;
  readonly luma: number;
  readonly rim: number;
}

/** 의상 하나의 자세 묶음 비율 (의상 / 기본) */
function ratios(costume: MonsterCostumeId, extra?: (dr: Drawing) => Drawing): Gap[] {
  const out: Gap[] = [];
  for (const [name, pose] of POSES)
    for (const d of SIZES)
      for (const rot of ROTS) {
        const b = basic(name, pose, d, rot);
        const dr = monsterTop(pose, costume);
        const x = measure(extra ? extra(dr) : dr, d, rot);
        out.push({
          where: `${name} ${d}px ${rot}`,
          area: x.area / b.area,
          luma: x.luma / b.luma,
          rim: x.rim / b.rim,
        });
      }
  return out;
}

function outside(g: Gap): string[] {
  const bad: string[] = [];
  if (Math.abs(g.area - 1) > AREA_TOL) bad.push(`${g.where} 면적 ×${g.area.toFixed(3)}`);
  if (Math.abs(g.luma - 1) > LUMA_TOL) bad.push(`${g.where} 밝기 ×${g.luma.toFixed(3)}`);
  if (Math.abs(g.rim - 1) > RIM_TOL) bad.push(`${g.where} 외곽 대비 ×${g.rim.toFixed(3)}`);
  return bad;
}

describe('그림 칠하기 · 보이는 정도 재기 (measure.ts drawingRaster · visibility)', () => {
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
});

describe('괴물 의상: 생존자 화면에서 보이는 정도가 기본과 같다 (꾸미기는 유불리가 없다)', () => {
  for (const costume of MONSTER_COSTUMES.filter((c) => c !== 'basic'))
    it(`${costume}: 모든 자세 · 크기 · 방향에서 면적 ±${AREA_TOL * 100}% · 밝기 ±${LUMA_TOL * 100}% · 외곽 대비 ±${RIM_TOL * 100}%`, () => {
      const gaps = ratios(costume);
      expect(gaps.length).toBe(POSES.length * SIZES.length * ROTS.length);
      expect(gaps.flatMap(outside)).toEqual([]);
    });

  it('점검이 실제로 잡는다: 옛 시안처럼 어깨에 거의 검은 말굽 띠(#1A0B0E)를 두르면 밝기 · 외곽 대비가 기준 밖', () => {
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
    const gaps = ratios('basic', dark);
    expect(gaps.some((g) => g.luma < 1 - LUMA_TOL)).toBe(true);
    expect(Math.min(...gaps.map((g) => g.luma))).toBeLessThan(0.8);
  });
});

// Node 칠하기(client/src/art/chars/measure.ts drawingRaster) ↔ 실제 Chromium Canvas(게임 drawToCanvas) 견주기 (의상 유불리 점검).
// 같은 그림 · 같은 격자 · 같은 위상을 두 쪽에서 칠해 tests/unit/costume-parity*.test.ts와 같은 값(밝기 · 외곽 대비 · 바닥 대비 면적 ·
// 조각 대비 · 색조)을 의상 / 기본 비율로 견주고, 시험에 박아 둔 Chromium 기준 값(합성 도형 · 괴물 서기 24px)을 다시 잰다.
//   npx tsx scripts/char-art/raster-calibrate.ts          소프트웨어 Canvas (헤드리스 기본: --disable-gpu --disable-accelerated-2d-canvas)
//   npx tsx scripts/char-art/raster-calibrate.ts --gpu    GPU Canvas (SwiftShader, 가속 2D 캔버스)
// 화면 다시 샘플(돌림 · 반 화소 위상)은 Chromium drawImage 쌍선형과 measure.ts resampleRaster를 같은 구운 그림에서 견준다.
import { TILE_PX, validateBalance, type MonsterCostumeId } from '@decoy/shared';
import { chromium } from '@playwright/test';
import { build } from 'esbuild';
import balanceJson from '../../config/balance.json';
import { BASIC_COSTUME_SET, MONSTER_BOX, newStyleFrameSpecs } from '../../client/src/art/charFrames';
import { registerAllCostumeArt } from '../../client/src/art/chars/costume/art';
import { linear, path, solid, type Drawing } from '../../client/src/art/chars/kit';
import {
  drawingRaster,
  pairedSectorContrast,
  pairedSectorHue,
  resampleRaster,
  visibilityDetail,
  type DrawingRaster,
  type VisibilityDetail,
} from '../../client/src/art/chars/measure';
import { FLOOR_COLORS, MAP_COLOR } from '../../client/src/art/mapArtGeom';
import { relativeLuminance } from '../../client/src/art/palette';
import { PRESETS, TOUCH_LOW_OVERRIDE, effectivePreset, type QualityTier } from '../../client/src/gfx/presets';
import { computeRenderSize } from '../../client/src/render/resolution';
import { DEFAULT_CAM_ZOOM, MAP_SCALE, layoutFor } from '../../client/src/ui/layout';

registerAllCostumeArt();
const BAL = validateBalance(balanceJson);
const MONSTER_R_PX = BAL.monster.radius * TILE_PX;
const W = 1.8 / MONSTER_R_PX;
const FLOOR = MAP_COLOR.floor;
const FLOOR_L = relativeLuminance(FLOOR);
const HUE_FLOORS = [...new Set(FLOOR_COLORS)];
/** 그 화면 · 품질의 괴물 몸 지름 (텍셀) — tests/helpers/parity.ts bodyPx와 같은 식 */
function bodyPx(w: number, h: number, dpr: number, tier: QualityTier, touch: boolean): number {
  const l = layoutFor(w, h, touch);
  const preset = effectivePreset(tier, 'webgl', touch);
  const r = computeRenderSize({
    cssW: w,
    cssH: h,
    dpr,
    logicalW: l.viewW,
    logicalH: l.viewH,
    preset,
    scaleOverride: null,
  });
  const tpw = Math.min(Math.max(0.25, r.zoom) * MAP_SCALE * DEFAULT_CAM_ZOOM, preset.charTexelCap);
  return 2 * MONSTER_R_PX * tpw;
}
/** 시험 크기 열의 일부 (tests/helpers/parity.ts SIZES ①② ④ ⑦) */
const SIZE = {
  touchLow125: bodyPx(568, 320, TOUCH_LOW_OVERRIDE.dprCap, 'low', true),
  phoneLow: bodyPx(568, 320, 2, 'low', true),
  s8Low: bodyPx(740, 360, 4, 'low', true),
  lowCap: 2 * MONSTER_R_PX * PRESETS.low.charTexelCap,
};
const argv = (globalThis as { process?: { argv?: string[] } }).process?.argv ?? [];
const GPU = argv.includes('--gpu');

// ───────────────────────── 브라우저 쪽 (게임 drawToCanvas 그대로) ─────────────────────────

const ENTRY = `
import { drawToCanvas } from '../../client/src/art/chars/kit';
const b64 = (a) => { let s = ''; for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode(...a.subarray(i, i + 0x8000)); return btoa(s); };
const ctx2d = (c) => c.getContext('2d', ${GPU ? '{}' : '{ willReadFrequently: true }'});
window.CAL = {
  render(jobs) {
    return jobs.map((j) => {
      const c = document.createElement('canvas');
      c.width = j.n; c.height = j.n;
      const ctx = ctx2d(c);
      ctx.translate(j.cx, j.cy);
      ctx.rotate(j.rot);
      drawToCanvas(ctx, j.dr, j.u);
      return b64(ctx.getImageData(0, 0, j.n, j.n).data);
    });
  },
  resample(src, n, sx, sy, rot, dx, dy) {
    const bytes = Uint8ClampedArray.from(atob(src), (ch) => ch.charCodeAt(0));
    const a = document.createElement('canvas');
    a.width = n; a.height = n;
    a.getContext('2d').putImageData(new ImageData(bytes, n, n), 0, 0);
    const c = document.createElement('canvas');
    c.width = n; c.height = n;
    const ctx = ctx2d(c);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'low';
    ctx.translate(n / 2 + dx, n / 2 + dy);
    ctx.rotate(rot);
    ctx.drawImage(a, -sx, -sy);
    return b64(ctx.getImageData(0, 0, n, n).data);
  },
};
`;

interface Job {
  dr: Drawing;
  n: number;
  cx: number;
  cy: number;
  u: number;
  rot: number;
}

/** RGBA 바이트(알파 곱하지 않은 Canvas 값, base64) → 알파 곱한 0~1 칠 */
function toRaster(b64: string, n: number, cx: number, cy: number): DrawingRaster {
  const s = atob(b64);
  const rgba = new Float32Array(n * n * 4);
  for (let k = 0; k < n * n; k += 1) {
    const a = s.charCodeAt(k * 4 + 3) / 255;
    for (let q = 0; q < 3; q += 1) rgba[k * 4 + q] = (s.charCodeAt(k * 4 + q) / 255) * a;
    rgba[k * 4 + 3] = a;
  }
  return { n, rgba, cx, cy };
}

// ───────────────────────── 견줄 값 ─────────────────────────

/** 아틀라스 위상 (atlas.ts cellOf: pad = 외곽선 + 2, ox = pad − 상자 x0 × u) */
function bakeOffset(d: number): [number, number] {
  const n = Math.ceil(d * 1.7);
  const pad = 1.8 * (d / (2 * MONSTER_R_PX)) + 2;
  const ox = pad - MONSTER_BOX.x0 * (d / 2);
  const oy = pad - MONSTER_BOX.y0 * (d / 2);
  const half = n / 2 - Math.floor(n / 2);
  return [ox - Math.floor(ox) - half, oy - Math.floor(oy) - half];
}

function detail(r: DrawingRaster, d: number, rot: number): VisibilityDetail {
  return visibilityDetail(r, FLOOR, (W * d) / 2, 0.08 * d, { sectors: 8, rot, minContrast: 1.5 });
}

interface Ratios {
  luma: number;
  rim: number;
  cArea: number;
  sector: number;
  hue: number;
}

function ratios(x: DrawingRaster, b: DrawingRaster, d: number, rot: number): Ratios {
  const xv = detail(x, d, rot);
  const bv = detail(b, d, rot);
  return {
    luma: xv.luma / bv.luma,
    rim: xv.rim / bv.rim,
    cArea: xv.contrastArea / bv.contrastArea,
    sector: pairedSectorContrast(xv, bv, FLOOR_L, 8, [0, 0.5]).ratio,
    hue: pairedSectorHue(x, b, bv, HUE_FLOORS, 8, [0, 0.5]).ratio,
  };
}

function monsterFrame(name: string, costume: MonsterCostumeId): Drawing {
  const s = newStyleFrameSpecs({ ...BASIC_COSTUME_SET, monster: costume }).find((f) => f.name === name);
  if (!s) throw new Error(name);
  return s.draw(W);
}

/** 그림 지문 (FNV-1a 32비트, 명령 JSON) — 시험의 기준 값이 같은 그림에서 잰 것인지 */
function fingerprint(dr: Drawing): string {
  const s = JSON.stringify(dr.ops);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** 합성 도형 (tests/unit/costume-parity.test.ts SYNTH와 같은 그림 · 격자: 몸 지름 24px, 위상 (0.3, 0.25)) */
const SYNTH: [string, Drawing][] = [
  [
    'seam',
    {
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
  ],
  ['hair-0.02', { ops: [{ d: 'M-1 -0.3L1 0.2L0.5 0.9', stroke: { paint: solid(0xffffff), width: 0.02 } }] }],
  ['hair-0.05', { ops: [{ d: 'M-1 -0.3L1 0.2L0.5 0.9', stroke: { paint: solid(0xffffff), width: 0.05 } }] }],
  ['stroke-0.2', { ops: [{ d: 'M-1 -0.3L1 0.2L0.5 0.9', stroke: { paint: solid(0xffffff), width: 0.2 } }] }],
  ['disc-3px', { ops: [{ d: path().circle(0, 0, 0.25).d, fill: solid(0xffffff) }] }],
  [
    'grad',
    {
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
  ],
];

const f3 = (v: number): string => v.toFixed(3);

const bundle = await build({
  stdin: { contents: ENTRY, resolveDir: new URL('.', import.meta.url).pathname, loader: 'ts' },
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  write: false,
  logLevel: 'warning',
});
const browser = await chromium.launch({
  args: GPU
    ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
    : ['--disable-gpu', '--disable-accelerated-2d-canvas'],
});
try {
  const page = await browser.newPage();
  await page.setContent('<!doctype html><html><body></body></html>');
  await page.addScriptTag({ content: bundle.outputFiles[0]?.text ?? '' });
  type Cal = {
    render: (j: Job[]) => string[];
    resample: (s: string, n: number, sx: number, sy: number, rot: number, dx: number, dy: number) => string;
  };
  // page.evaluate 함수는 브라우저에서 돈다 (바깥 변수를 쓰지 못한다)
  const renderRaw = (jobs: Job[]): Promise<string[]> =>
    page.evaluate((js) => (window as unknown as { CAL: Cal }).CAL.render(js), jobs);
  console.log(`Chromium ${browser.version()} · ${GPU ? 'GPU Canvas' : '소프트웨어 Canvas'}`);

  // ① 합성 도형: 알파 합 · 빨강 합 · 이음매 줄 빨강 평균 (Chromium / Node)
  {
    const d = 24;
    const n = Math.ceil(d * 1.7);
    const [dx, dy] = [0.3, 0.25];
    const raw = await renderRaw(
      SYNTH.map(([, dr]) => ({ dr, n, cx: n / 2 + dx, cy: n / 2 + dy, u: d / 2, rot: 0 })),
    );
    console.log('\n① 합성 도형 (몸 지름 24px, 위상 0.3, 0.25) — 시험 SYNTH 기준 값');
    SYNTH.forEach(([name, dr], i) => {
      const c = toRaster(raw[i] ?? '', n, n / 2 + dx, n / 2 + dy);
      const nd = drawingRaster(dr, d, 0, { dx, dy });
      const sums = (r: DrawingRaster): [number, number, number] => {
        let a = 0;
        let red = 0;
        let seam = 0;
        let cells = 0;
        const row = Math.floor(n / 2 + dy);
        for (let k = 0; k < n * n; k += 1) {
          a += r.rgba[k * 4 + 3] ?? 0;
          red += r.rgba[k * 4] ?? 0;
          const i2 = k % n;
          if (Math.floor(k / n) === row && Math.abs(i2 + 0.5 - (n / 2 + dx)) < 0.6 * (d / 2)) {
            seam += r.rgba[k * 4] ?? 0;
            cells += 1;
          }
        }
        return [a, red, seam / cells];
      };
      const [ca, cr, cs] = sums(c);
      const [na, nr, ns] = sums(nd);
      console.log(
        `  ${name.padEnd(11)} 알파 합 Chromium ${ca.toFixed(3)} Node ${na.toFixed(3)} (×${(na / ca).toFixed(3)}) · 빨강 합 ${cr.toFixed(3)} / ${nr.toFixed(3)} · 이음매 줄 빨강 ${f3(cs)} / ${f3(ns)}`,
      );
    });
  }

  // ② 괴물 서기(monster-idle-0) 구운 그대로: 밝기 비율 · 지문
  const costumes: MonsterCostumeId[] = ['basic', 'hood', 'feathers', 'chains'];
  const sizes = [SIZE.phoneLow, SIZE.lowCap];
  console.log('\n② 괴물 서기 구운 그대로 (아틀라스 위상) — 시험 ART_REF 기준 값');
  for (const d of sizes) {
    const n = Math.ceil(d * 1.7);
    const [dx, dy] = bakeOffset(d);
    const drs = costumes.map((c) => monsterFrame('monster-idle-0', c));
    const raw = await renderRaw(
      drs.map((dr) => ({ dr, n, cx: n / 2 + dx, cy: n / 2 + dy, u: d / 2, rot: 0 })),
    );
    const ch = raw.map((s) => toRaster(s, n, n / 2 + dx, n / 2 + dy));
    const nd = drs.map((dr) => drawingRaster(dr, d, 0, { dx, dy }));
    const bc = detail(ch[0] as DrawingRaster, d, 0);
    const bn = detail(nd[0] as DrawingRaster, d, 0);
    console.log(
      `  ${d.toFixed(2)}px 기본 밝기 Chromium ${bc.luma.toFixed(4)} Node ${bn.luma.toFixed(4)} · 지문 ${fingerprint(drs[0] as Drawing)}`,
    );
    for (let i = 1; i < costumes.length; i += 1) {
      const rc = ratios(ch[i] as DrawingRaster, ch[0] as DrawingRaster, d, 0);
      const rn = ratios(nd[i] as DrawingRaster, nd[0] as DrawingRaster, d, 0);
      console.log(
        `  ${(costumes[i] ?? '').padEnd(9)} 밝기 Chromium ${f3(rc.luma)} Node ${f3(rn.luma)} · 지문 ${fingerprint(drs[i] as Drawing)}`,
      );
    }
  }

  // ③ 견주기 표: 프레임 × 크기 × 화면(구운 그대로 · 돌림 0.6 · 돌림 2.5 + 반 화소) — 의상 / 기본 비율 Chromium vs Node
  const FRAMES = ['monster-idle-0', 'monster-move-2', 'monster~wu', 'monster-dash', 'monster~ro'];
  const VIEWS: [number, number][] = [
    [0, 0],
    [0.6, 0],
    [2.5, 0.5],
  ];
  const keys: (keyof Ratios)[] = ['luma', 'rim', 'cArea', 'sector', 'hue'];
  const diff: Record<string, number[]> = {};
  console.log('\n③ 의상 / 기본 비율: Chromium → Node (프레임 · 크기 · 화면)');
  for (const d of [SIZE.touchLow125, SIZE.phoneLow, SIZE.s8Low, SIZE.lowCap]) {
    const n = Math.ceil(d * 1.7);
    const [dx, dy] = bakeOffset(d);
    for (const fr of FRAMES) {
      const drs = costumes.map((c) => monsterFrame(fr, c));
      const raw = await renderRaw(
        drs.map((dr) => ({ dr, n, cx: n / 2 + dx, cy: n / 2 + dy, u: d / 2, rot: 0 })),
      );
      const nd = drs.map((dr) => drawingRaster(dr, d, 0, { dx, dy }));
      for (const [rot, ph] of VIEWS) {
        const sx = n / 2 + dx;
        const sy = n / 2 + dy;
        const ch =
          rot === 0 && ph === 0
            ? raw.map((s) => toRaster(s, n, sx, sy))
            : await Promise.all(
                raw.map(async (s) =>
                  toRaster(
                    await page.evaluate(
                      (a) =>
                        (window as unknown as { CAL: Cal }).CAL.resample(
                          a.s,
                          a.n,
                          a.sx,
                          a.sy,
                          a.rot,
                          a.px,
                          a.py,
                        ),
                      {
                        s,
                        n,
                        sx,
                        sy,
                        rot,
                        px: dx + ph,
                        py: dy + ph,
                      },
                    ),
                    n,
                    n / 2 + dx + ph,
                    n / 2 + dy + ph,
                  ),
                ),
              );
        const no = rot === 0 && ph === 0 ? nd : nd.map((r) => resampleRaster(r, rot, dx + ph, dy + ph));
        for (let i = 1; i < costumes.length; i += 1) {
          const rc = ratios(ch[i] as DrawingRaster, ch[0] as DrawingRaster, d, rot);
          const rn = ratios(no[i] as DrawingRaster, no[0] as DrawingRaster, d, rot);
          console.log(
            `  ${fr.padEnd(15)} ${d.toFixed(1).padStart(5)}px 방향 ${rot}${ph ? ' 위상 ½' : '      '} ${(costumes[i] ?? '').padEnd(8)} ` +
              keys.map((k) => `${k} ${f3(rc[k])}→${f3(rn[k])}`).join('  '),
          );
          for (const k of keys) (diff[k] ??= []).push(rn[k] - rc[k]);
        }
      }
    }
  }
  console.log('\n차이 (Node − Chromium): 최소 / 최대 / 평균 절댓값');
  for (const k of keys) {
    const v = diff[k] ?? [];
    const mean = v.reduce((s, x) => s + Math.abs(x), 0) / Math.max(1, v.length);
    console.log(`  ${k.padEnd(7)} ${f3(Math.min(...v))} / ${f3(Math.max(...v))} / ${f3(mean)}`);
  }
} finally {
  await browser.close();
}

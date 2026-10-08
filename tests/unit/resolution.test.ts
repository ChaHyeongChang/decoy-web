// 렌더 해상도 계산 (M10a 선명도): 백버퍼 = 표시 CSS 크기 × min(DPR, 품질 상한, 픽셀 상한) × ?scale
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PRESETS, TOUCH_LOW_OVERRIDE, effectivePreset } from '../../client/src/gfx/presets';
import {
  LAYOUT_UNIT,
  computeRenderSize,
  snapToDevice,
  type RenderSize,
  type RenderSizeInput,
} from '../../client/src/render/resolution';

const PC = { logicalW: 1920, logicalH: 1080, scaleOverride: null } as const;

function size(cssW: number, cssH: number, dpr: number, extra: Partial<RenderSizeInput> = {}): RenderSize {
  return computeRenderSize({ ...PC, cssW, cssH, dpr, preset: PRESETS.high, ...extra });
}

/** 화면 절대 위치 × dpr이 기기 픽셀 정수이고, 값이 브라우저 배치 단위(1/64px)로 정확히 나타난다 */
function expectDeviceAligned(v: number, dpr: number): void {
  expect(Math.abs(v * dpr - Math.round(v * dpr))).toBeLessThan(0.01);
  expect(Math.abs(v / LAYOUT_UNIT - Math.round(v / LAYOUT_UNIT))).toBeLessThan(1e-9);
}

describe('computeRenderSize: 흔한 PC 화면 (품질 높음)', () => {
  it('맥북 1440×900 @2 → 백버퍼 2880×1620, zoom 1.5, 위아래 띠 45px', () => {
    const r = size(1440, 900, 2);
    expect([r.backingW, r.backingH]).toEqual([2880, 1620]);
    expect(r.zoom).toBe(1.5);
    expect([r.dispW, r.dispH]).toEqual([1440, 810]);
    expect([r.left, r.top]).toEqual([0, 45]);
  });

  it('QHD 2560×1440 @1 → 2560×1440 (확대 없이 1:1)', () => {
    const r = size(2560, 1440, 1);
    expect([r.backingW, r.backingH]).toEqual([2560, 1440]);
    expect(r.zoom).toBeCloseTo(4 / 3, 10);
    expect([r.left, r.top]).toEqual([0, 0]);
  });

  it('FHD 1920×1080 @1.25 → 2400×1350, zoom 1.25', () => {
    const r = size(1920, 1080, 1.25);
    expect([r.backingW, r.backingH]).toEqual([2400, 1350]);
    expect(r.zoom).toBe(1.25);
  });

  it('윈도 노트북 창 1536×730 @1.25: 위치가 기기 픽셀 정수 (반 픽셀 어긋남 없음)', () => {
    const r = size(1536, 730, 1.25);
    expect(r.backingH).toBe(Math.round(1080 * (730 / 1080) * 1.25));
    expectDeviceAligned(r.left, 1.25);
    expectDeviceAligned(r.top, 1.25);
    // 가운데에서 크게 벗어나지 않는다 (기기 6px 이내)
    expect(Math.abs(r.left - (1536 - r.dispW) / 2) * 1.25).toBeLessThanOrEqual(6);
  });

  it('1080p 모니터 브라우저 창 1920×969 @1 → 높이에 맞춰 1723×969', () => {
    const r = size(1920, 969, 1);
    expect([r.backingW, r.backingH]).toEqual([1723, 969]);
    expect(r.left).toBe(99);
  });

  it('불변식: 백버퍼 ≈ 표시 CSS × k, 16:9 오차 1px 이하, 위치는 기기 픽셀 격자', () => {
    for (const [w, h, dpr] of [
      [1440, 900, 2],
      [2560, 1440, 1],
      [1920, 1080, 1.25],
      [1536, 730, 1.25],
      [1920, 969, 1],
      [1366, 768, 1],
      [1280, 720, 1.5],
      [1000, 700, 2],
      [1600, 900, 1.75],
      [844, 390, 3],
    ] as const) {
      const r = size(w, h, dpr);
      expect(Math.abs(r.backingW - r.dispW * r.k)).toBeLessThanOrEqual(1);
      expect(Math.abs(r.backingH - r.dispH * r.k)).toBeLessThanOrEqual(1);
      expect(Math.abs(r.backingH - (r.backingW * 9) / 16)).toBeLessThanOrEqual(1);
      expect(r.dispW).toBeLessThanOrEqual(w + 1);
      expect(r.dispH).toBeLessThanOrEqual(h + 1);
      expect(r.zoom).toBe(r.backingW / 1920);
      expectDeviceAligned(r.left, dpr);
      expectDeviceAligned(r.top, dpr);
    }
  });

  it('부모 요소가 화면에서 떨어져 있어도 화면 절대 위치를 맞춘다', () => {
    const r = size(1536, 730, 1.25, { originX: 10.4, originY: 0 });
    expect(Math.abs((10.4 + r.left) * 1.25 - Math.round((10.4 + r.left) * 1.25))).toBeLessThan(0.01);
  });
});

describe('computeRenderSize: 품질 단계 상한', () => {
  it('중간: 1920×1080 @2에서도 픽셀 수가 2560×1440 이하', () => {
    const r = size(1920, 1080, 2, { preset: PRESETS.medium });
    expect(r.backingW * r.backingH).toBeLessThanOrEqual(2560 * 1440);
    expect([r.backingW, r.backingH]).toEqual([2560, 1440]);
  });

  it('중간: 배율 상한 1.5 (맥북 @2 → 2160×1215)', () => {
    const r = size(1440, 900, 2, { preset: PRESETS.medium });
    expect(r.k).toBe(1.5);
    expect([r.backingW, r.backingH]).toEqual([2160, 1215]);
  });

  it('높음: 4K 창 @2에서도 8.3MP를 넘지 않는다', () => {
    const r = size(3840, 2160, 2);
    expect(r.backingW * r.backingH).toBeLessThanOrEqual(3840 * 2160);
  });

  it('낮음: 배율 1, 1920×1080 이하 (QHD는 늘려서 보여 준다)', () => {
    const mac = size(1440, 900, 2, { preset: PRESETS.low });
    expect([mac.backingW, mac.backingH]).toEqual([1440, 810]);
    const qhd = size(2560, 1440, 1, { preset: PRESETS.low });
    expect([qhd.backingW, qhd.backingH]).toEqual([1920, 1080]);
    expect([qhd.dispW, qhd.dispH]).toEqual([2560, 1440]);
  });

  it('터치 낮음 하한: DPR 3 휴대폰에서 1배로 내리지 않고 1.5배 · 1.2MP 안', () => {
    const touchLow = effectivePreset('low', 'webgl', true);
    expect(touchLow.dprCap).toBe(TOUCH_LOW_OVERRIDE.dprCap);
    const r = size(844, 390, 3, { preset: touchLow });
    expect(r.k).toBeGreaterThan(1);
    expect(r.k).toBeLessThanOrEqual(1.5);
    expect(r.backingW * r.backingH).toBeLessThanOrEqual(TOUCH_LOW_OVERRIDE.maxPixels);
    // PC 낮음이었다면 1배
    expect(size(844, 390, 3, { preset: PRESETS.low }).k).toBe(1);
  });
});

describe('computeRenderSize: ?scale 배율 · 논리 크기', () => {
  it('scaleOverride를 k에 곱한다 (1920×1080 @1, 0.5 → 960×540)', () => {
    const r = size(1920, 1080, 1, { scaleOverride: 0.5 });
    expect([r.backingW, r.backingH]).toEqual([960, 540]);
    expect(r.zoom).toBe(0.5);
    expect([r.dispW, r.dispH]).toEqual([1920, 1080]);
  });

  it('scaleOverride는 품질 상한 뒤에 곱한다 (맥북 @2 × 0.5 → 1440×810)', () => {
    const r = size(1440, 900, 2, { scaleOverride: 0.5 });
    expect([r.backingW, r.backingH]).toEqual([1440, 810]);
  });

  it('논리 폭 2400(나중 터치 레이아웃)도 같은 함수로', () => {
    const r = computeRenderSize({
      cssW: 1200,
      cssH: 540,
      dpr: 2,
      logicalW: 2400,
      logicalH: 1080,
      preset: PRESETS.high,
      scaleOverride: null,
    });
    expect([r.backingW, r.backingH]).toEqual([2400, 1080]);
    expect(r.zoom).toBe(1);
    expect([r.left, r.top]).toEqual([0, 0]);
  });

  it('크기가 0이거나 DPR이 이상해도 1px 이상, 숫자', () => {
    const r = size(0, 0, Number.NaN);
    expect(r.backingW).toBeGreaterThanOrEqual(1);
    expect(r.backingH).toBeGreaterThanOrEqual(1);
    expect(Number.isFinite(r.zoom)).toBe(true);
  });
});

describe('snapToDevice', () => {
  it('배율 1 · 2는 그대로 반올림', () => {
    expect(snapToDevice(99.4, 1)).toBe(99);
    expect(snapToDevice(44.8, 2)).toBe(45);
  });

  it('배율 1.25: 기기 px 정수이면서 1/64px로 정확히 나타나는 값 (크로미움이 내림해도 그대로)', () => {
    const v = snapToDevice(119.2, 1.25);
    expectDeviceAligned(v, 1.25);
    expect(Math.abs(v - 119.2)).toBeLessThanOrEqual(6 / 1.25);
  });
});

// 직접 만든 Text는 해상도 · 격자 맞춤을 빠뜨린다 (1080p 창에서 오히려 기준보다 흐려지는 것을 실측) → 한 곳에서만 만든다
describe('소스 검사: Phaser 글자는 ui/text.ts에서만 만든다', () => {
  const root = join(__dirname, '../../client/src');
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith('.ts')) files.push(p);
    }
  };
  walk(root);

  it('client/src에서 .add.text( 가 ui/text.ts 밖에 없다', () => {
    const offenders = files
      .filter((f) => relative(root, f).split(sep).join('/') !== 'ui/text.ts')
      .filter((f) => /\.add\s*\.text\s*\(/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(root, f));
    expect(files.length).toBeGreaterThan(10);
    expect(offenders).toEqual([]);
  });

  it('new Phaser.GameObjects.Text( 도 ui/text.ts 밖에 없다', () => {
    const offenders = files
      .filter((f) => relative(root, f).split(sep).join('/') !== 'ui/text.ts')
      .filter((f) => /new\s+Phaser\.GameObjects\.Text\s*\(/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(root, f));
    expect(offenders).toEqual([]);
  });
});

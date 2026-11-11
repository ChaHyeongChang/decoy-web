// 지도 크게 보기 선명도 — WebGL 텍스처 예산 (남은 문제 정리). 크게 본 지도 바닥을 화면 해상도로 합성하되 열린 동안에도 올린 텍스처
// 바이트가 예산(높음 32MiB)을 넘지 않는다 — 예산이 먼저다(사용자 요청 '텍스처 예산(32MiB)과 저사양 보호는 유지', DECISIONS 13절).
// 바닥 폭은 prefsFx.bigMinimapTexels가 정한다: 남은 예산으로 작은 미니맵 합성보다 크게 구울 수 있으면 그만큼, 아니면 따로 굽지 않고
// 작은 지도 합성을 늘려 쓴다(예전과 같다). 가장 빠듯한 PC 1920×1080 · 배율 2 · 품질 높음은 거점 C(플레이테스트 반영 b — 동적 조각 ·
// 배지 약 1.1MiB)가 들어온 뒤 닫혀 있어도 약 31MiB라 따로 굽지 않는다(DECISIONS 16절 b). 그래서 배율 2는 예산 · 결정 규칙 · 놓기를 보고,
// WebGL에서 화면 해상도 바닥을 실제로 굽는 길은 예산이 넉넉한 배율 1 장면이 본다. 닫으면 놓는다 — 크게 본 지도 텍스처('minimap-big')
// 하나만 본다: 굽기를 기다리는 동안(CI 러너에서는 수십 초) 판이 흘러 다른 텍스처가 제 때에 생기고 사라지므로 합계를 열기 전과 견주면
// 지도와 무관하게 틀린다(전체 검사 194 · 196: 닫은 뒤 합계가 열기 전보다 64~128KiB 많았다 — 지도 텍스처는 4바이트).
// 선명도 스크린샷 비교는 minimap-sharp.spec.ts(Canvas)
import { expect, test, type Browser } from '@playwright/test';
import type { MatchPrefsDebug } from '@decoy/shared';
import { MAP_H, MAP_W } from '@decoy/shared';
import { MINIMAP_BIG_TEXELS, bigMinimapTexels } from '../../client/src/render/prefsFx';
import { newPlayerPage, press, waitForSnapshots } from './helpers';

const MiB = 1024 * 1024;
const HIGH_BUDGET = 32 * MiB;

interface BigMapResult {
  /** 연 뒤 정한 바닥 폭 (0 = 따로 굽지 않음) */
  texels: number;
  smallTexW: number;
  needW: number;
  tex: { w: number; h: number };
  closedBytes: number;
  openBytes: number;
  bigBytesOpen: number;
}

/** WebGL PC 1920×1080 높음에서 판을 열고 지도를 크게 본 뒤 닫는다. 예산 · 놓기는 여기서 늘 본다 */
async function bigMapScene(browser: Browser, dpr: number): Promise<BigMapResult> {
  const { context, page, problems } = await newPlayerPage(browser, {
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: dpr,
  });
  await page.goto('/?bots=1&debug=hook&quality=high');
  await page.waitForFunction(() => window.__DECOY__ !== undefined);
  await page.evaluate(() => window.__DECOY__?.injectFps(60));
  await press(page.getByTestId('create-room'));
  await press(page.getByTestId('role-runner'));
  await press(page.getByTestId('ready-button'));
  await press(page.getByTestId('start-button'));
  await waitForSnapshots(page, 5);
  const prefs = async (): Promise<MatchPrefsDebug> =>
    (await page.evaluate(() => window.__DECOY__!.getMatchPrefs()))!;
  const bytes = (): Promise<number> =>
    page.evaluate(() => Number(window.__DECOY__!.gfx.features.textureBytes ?? 0));
  const bigBytes = (): Promise<number> =>
    page.evaluate(() => window.__DECOY__!.getTextureBytesByKey()['minimap-big'] ?? 0);
  const texels = (): Promise<number> =>
    page.evaluate(() => Number(window.__DECOY__!.gfx.features.minimapBigTexels ?? -1));
  const g = await page.evaluate(() => ({ q: window.__DECOY__!.gfx.quality, r: window.__DECOY__!.renderer }));
  expect(g).toEqual({ q: 'high', r: 'webgl' });
  await expect.poll(async () => (await prefs()).minimapTap !== null).toBe(true);
  const closedBytes = await bytes();
  expect(await bigBytes()).toBeLessThanOrEqual(4);
  const tap = (await prefs()).minimapTap!;
  await page.mouse.click(tap.x + tap.w / 2, tap.y + tap.h / 2);
  await expect.poll(async () => (await prefs()).minimapBig.open).toBe(true);
  // 바닥 폭은 열 때 정한다 (0 = 작은 지도 합성을 늘려 씀)
  await expect.poll(texels).toBeGreaterThanOrEqual(0);
  const w = await texels();
  if (w > 0) {
    // 화면 해상도 바닥은 한 프레임 4ms씩 10여 프레임에 나눠 굽는다. 이 장면(SwiftShader)은 프레임이 컨테이너에서 1초 안팎,
    // CI 러너에서는 몇 초씩이라 넉넉히 기다린다 (실패하면 그때까지 굽기 걸음 수를 남긴다)
    const t0 = Date.now();
    try {
      await expect.poll(async () => (await prefs()).minimapBig.sharpReady, { timeout: 120_000 }).toBe(true);
    } finally {
      const f = await page.evaluate(() => window.__DECOY__!.gfx.features);
      console.log(
        `[minimap-sharp.webgl] 배율 ${dpr} 연 뒤 ${((Date.now() - t0) / 1000).toFixed(1)}초: 굽기 ${String(f.minimapBigSteps)}걸음 · 한 걸음 최대 ${String(f.minimapBigStepMaxMs)}ms · 합계 ${String(f.minimapBigBakeMs)}ms · 바닥 폭 ${String(f.minimapBigTexels)}`,
      );
    }
  }
  const big = (await prefs()).minimapBig;
  const openBytes = await bytes();
  const bigBytesOpen = await bigBytes();
  console.log(
    `[minimap-sharp.webgl] 배율 ${dpr}: 바닥 ${big.smallTexW} → ${w > 0 ? `${big.tex.w}×${big.tex.h}` : '따로 굽지 않음(작은 지도 늘려 씀)'} (화면 ${big.needW.toFixed(0)}px), 텍스처 ${(closedBytes / MiB).toFixed(2)} → ${(openBytes / MiB).toFixed(2)}MiB`,
  );
  // 예산: 열린 동안에도 넘지 않는다
  expect(openBytes).toBeLessThanOrEqual(HIGH_BUDGET);
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await prefs()).minimapBig.open).toBe(false);
  expect((await prefs()).minimapBig.tex).toEqual({ w: 1, h: 1 });
  // 닫으면 지도 텍스처는 1×1(4바이트)로 놓는다
  expect(await bigBytes()).toBeLessThanOrEqual(4);
  expect(await bytes()).toBeLessThanOrEqual(HIGH_BUDGET);
  expect(problems).toEqual([]);
  await context.close();
  return {
    texels: w,
    smallTexW: big.smallTexW,
    needW: big.needW,
    tex: big.tex,
    closedBytes,
    openBytes,
    bigBytesOpen,
  };
}

test('지도 크게 보기 (WebGL PC 1920×1080@2 높음 — 가장 빠듯함): 열린 동안에도 텍스처 32MiB 안, 바닥 폭은 남은 예산으로 정한다(작은 지도보다 크게 못 구우면 따로 굽지 않음), 닫으면 놓음', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const r = await bigMapScene(browser, 2);
  // 결정은 남은 예산 규칙 그대로다: 닫혀 있던 텍스처(지도 바닥 1×1 포함)로 같은 순수 함수를 돌린 값과 같다
  const others = r.closedBytes - 4;
  expect(r.texels).toBe(bigMinimapTexels(r.needW, r.smallTexW, MAP_W / MAP_H, HIGH_BUDGET, others) ?? 0);
  if (r.texels > 0) {
    // 구웠다면 작은 지도 합성보다 크고 화면 px를 넘지 않으며, 열린 동안 지도 텍스처 바이트 = 바닥 크기
    expect(r.tex.w).toBeGreaterThan(r.smallTexW);
    expect(r.tex.w).toBeLessThanOrEqual(Math.ceil(r.needW));
    expect(r.bigBytesOpen).toBe(r.tex.w * r.tex.h * 4);
  } else {
    // 따로 굽지 않았다: 남은 예산으로는 작은 지도 합성보다 큰 바닥이 들어가지 않는다 · 지도 텍스처를 올리지 않았다
    const room = HIGH_BUDGET - MINIMAP_BIG_TEXELS.budgetMargin - others;
    expect(Math.floor(Math.sqrt((Math.max(0, room) / 4) * (MAP_W / MAP_H))) - 1).toBeLessThanOrEqual(
      r.smallTexW,
    );
    expect(r.bigBytesOpen).toBeLessThanOrEqual(4);
  }
});

test('지도 크게 보기 (WebGL PC 1920×1080@1 높음): 예산이 넉넉하면 바닥을 화면 해상도로 굽는다(작은 지도 합성보다 크게), 32MiB 안, 닫으면 놓음', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const r = await bigMapScene(browser, 1);
  expect(r.texels).toBeGreaterThan(0);
  expect(r.tex.w).toBeGreaterThan(r.smallTexW);
  expect(r.tex.w).toBeGreaterThanOrEqual(Math.floor(r.needW));
  expect(r.tex.w).toBeLessThanOrEqual(Math.ceil(r.needW));
  expect(r.bigBytesOpen).toBe(r.tex.w * r.tex.h * 4);
});

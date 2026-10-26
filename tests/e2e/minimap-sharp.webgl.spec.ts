// 지도 크게 보기 선명도 — WebGL 텍스처 예산 (남은 문제 정리). 크게 본 지도 바닥을 화면 해상도로 합성하되 열린 동안에도 올린 텍스처
// 바이트가 예산(높음 32MiB)을 넘지 않는다: 가장 빠듯한 PC 1920×1080 · 배율 2 · 품질 높음(닫혀 있어도 약 29.4MiB)은 남은 만큼만
// 키운다(작은 미니맵 합성 768px보다는 크게). 닫으면 놓는다. 선명도 스크린샷 비교는 minimap-sharp.spec.ts(Canvas)
import { expect, test } from '@playwright/test';
import type { MatchPrefsDebug } from '@decoy/shared';
import { newPlayerPage, press, waitForSnapshots } from './helpers';

const MiB = 1024 * 1024;
const HIGH_BUDGET = 32 * MiB;

test('지도 크게 보기 (WebGL PC 1920×1080@2 높음): 열린 동안에도 텍스처 32MiB 안 · 바닥은 작은 지도 합성보다 크게(남은 예산만큼), 닫으면 놓음', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const { context, page, problems } = await newPlayerPage(browser, {
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 2,
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
  const g = await page.evaluate(() => ({ q: window.__DECOY__!.gfx.quality, r: window.__DECOY__!.renderer }));
  expect(g).toEqual({ q: 'high', r: 'webgl' });
  await expect.poll(async () => (await prefs()).minimapTap !== null).toBe(true);
  const closed = await bytes();
  const tap = (await prefs()).minimapTap!;
  await page.mouse.click(tap.x + tap.w / 2, tap.y + tap.h / 2);
  await expect.poll(async () => (await prefs()).minimapBig.open).toBe(true);
  await expect.poll(async () => (await prefs()).minimapBig.sharpReady, { timeout: 30_000 }).toBe(true);
  const big = (await prefs()).minimapBig;
  const open = await bytes();
  console.log(
    `[minimap-sharp.webgl] 바닥 ${big.smallTexW} → ${big.tex.w}×${big.tex.h} (화면 ${big.needW.toFixed(0)}px), 텍스처 ${(closed / MiB).toFixed(2)} → ${(open / MiB).toFixed(2)}MiB`,
  );
  expect(open).toBeLessThanOrEqual(HIGH_BUDGET);
  expect(big.tex.w).toBeGreaterThan(big.smallTexW);
  expect(big.tex.w).toBeLessThanOrEqual(Math.ceil(big.needW));
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await prefs()).minimapBig.open).toBe(false);
  expect((await prefs()).minimapBig.tex).toEqual({ w: 1, h: 1 });
  expect(await bytes()).toBeLessThanOrEqual(closed + 4);
  expect(problems).toEqual([]);
  await context.close();
});

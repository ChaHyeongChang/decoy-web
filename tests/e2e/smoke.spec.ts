import { chromium, expect, test } from '@playwright/test';

test('설치된 Chromium을 쓴다 (다시 받지 않음)', () => {
  expect(chromium.executablePath()).toContain('/opt/pw-browsers');
});

test('빈 페이지가 열리고 캔버스가 그려진다', async ({ page }) => {
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') problems.push(`${msg.type()}: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  await page.goto('/?debug=hook');
  await expect(page.locator('canvas')).toHaveCount(1);
  await page.waitForTimeout(500);
  // 기본 렌더러는 WebGL (Canvas 폴백이 아니다)
  expect(await page.evaluate(() => window.__DECOY__?.renderer)).toBe('webgl');
  expect(problems).toEqual([]);
});

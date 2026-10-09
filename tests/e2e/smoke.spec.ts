import { existsSync } from 'node:fs';
import { chromium, expect, test } from '@playwright/test';

test('설치된 Chromium을 쓴다 (다시 받지 않음)', { tag: '@core' }, () => {
  const path = chromium.executablePath();
  // 브라우저 설치 경로가 정해진 환경(개발 컨테이너의 /opt/pw-browsers)이면 그 안의 것을 쓴다.
  // CI처럼 지정이 없으면 @playwright/test 버전에 맞게 미리 받아 둔 기본 경로의 것을 쓴다
  const installed = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (installed) expect(path).toContain(installed);
  expect(existsSync(path)).toBe(true);
});

test('빈 페이지가 열리고 캔버스가 그려진다', { tag: '@core' }, async ({ page }) => {
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

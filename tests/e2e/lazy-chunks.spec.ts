// 나눠 받는 조각 (번들 줄이기, DECISIONS 11절 '나눠 받기'): 판에 들어가기 전이나 가끔만 쓰는 코드는 첫 묶음 밖이다.
//  - 첫 화면 HTML이 부르는 JS는 첫 묶음 하나. 판 밖 쉬는 시간에 결과 · '내 기록' · 설정(DOM까지 만들어 둠) · 봇과 연습 · 의상 그림
//    조각을 미리 받고, 주소에 ?debug가 없으면 디버그 조각은 받지 않는다. 배치 편집은 로비 설정을 열 때(터치)
//  - 봇과 연습: 역할을 누를 때는 연습 조각을 이미 받아 두어 새로 받지 않는다
//  - 판 중 설정을 처음 열 때: 조각 · 화면을 로비에서 이미 받아 만들어 두어 판 중에는 JS를 더 받지 않고, 긴 작업(50ms 넘게)이 없다
//  - 조각을 받지 못하면(새 배포 직후 옛 화면): 설정 · 봇과 연습 · 배치 편집은 "새 버전이 있어요"를 띄우고 화면은 그대로 쓸 수 있다
// 요청을 세려고 서비스 워커는 막는다 (워커 캐시 · 오프라인은 m13-offline.spec.ts)
import { readFileSync, readdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { PHONE_LANDSCAPE, dpr1, newPlayerPage, press } from './helpers';
import { startBotRoom } from './m10-map.shared';

/** 쉬는 시간에 미리 받는 조각 (첫 화면 다음) */
const PREFETCHED = ['art', 'hub', 'localServer', 'result', 'settingsPanel'];
/** 막은 조각 · 서비스 워커를 막은 경고(이 시험이 막았다)만 허용 */
const BLOCKED = /Failed to load resource|dynamically imported module|Service Worker registration blocked/;

/** 이 페이지가 요청한 JS 조각 이름 (assets/<이름>-<해시>.js), 요청 순서대로 */
function recordChunks(page: Page): string[] {
  const names: string[] = [];
  page.on('request', (r) => {
    const m = /\/assets\/([A-Za-z]+)-[\w-]+\.js$/.exec(new URL(r.url()).pathname);
    if (m?.[1]) names.push(m[1]);
  });
  return names;
}

/** 지금부터 긴 작업(50ms 넘게)을 모은다 */
async function watchLongTasks(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __longTasks: number[] };
    w.__longTasks = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) w.__longTasks.push(Math.round(e.duration));
    }).observe({ type: 'longtask' });
  });
}

test('첫 화면 HTML이 부르는 JS는 첫 묶음 하나, 나눠 받는 조각은 HTML에 없다', () => {
  const html = readFileSync('client/dist/index.html', 'utf8');
  const scripts = [...html.matchAll(/assets\/([A-Za-z]+)-[\w-]+\.js/g)].map((m) => m[1]);
  expect(scripts).toEqual(['index']);
  const lazy = readdirSync('client/dist/assets')
    .filter((f) => f.endsWith('.js') && !f.startsWith('index-'))
    .map((f) => f.replace(/-[\w-]+\.js$/, ''));
  expect(lazy.length).toBeGreaterThanOrEqual(8);
  for (const name of lazy) expect(html).not.toContain(`assets/${name}-`);
});

test('쉬는 시간에 결과 · 내 기록 · 설정(화면까지) · 연습 · 의상 그림 조각을 미리 받고, ?debug가 없으면 디버그 조각은 받지 않는다 (PC)', async ({
  browser,
}) => {
  const { context, page, problems } = await newPlayerPage(browser, { serviceWorkers: 'block' });
  const chunks = recordChunks(page);
  await page.goto('/?renderer=canvas');
  await expect(page.getByTestId('create-room')).toBeVisible();
  // 설정 화면은 받은 뒤 DOM까지 만들어 둔다 (숨긴 채)
  await expect(page.getByTestId('settings-modal')).toBeAttached({ timeout: 15_000 });
  await expect(page.getByTestId('settings-modal')).toBeHidden();
  await expect.poll(() => PREFETCHED.filter((c) => !chunks.includes(c)), { timeout: 15_000 }).toEqual([]);
  expect(chunks[0]).toBe('index');
  await page.waitForTimeout(500);
  expect(chunks).not.toContain('debug');
  // 배치 편집(터치 로비 설정의 조작 탭)은 PC에서 받지 않는다
  expect(chunks).not.toContain('layoutEditor');
  expect(await page.evaluate(() => window.__DECOY__ === undefined)).toBe(true);
  // 같은 조각을 두 번 받지 않는다
  expect(new Set(chunks).size).toBe(chunks.length);
  expect(problems.filter((p) => !BLOCKED.test(p))).toEqual([]);
  await context.close();
});

test('봇과 연습: 역할을 누를 때 연습 조각은 이미 받아 두어 새로 받지 않고 판이 시작된다', async ({
  browser,
}) => {
  const { context, page, problems } = await newPlayerPage(browser, { serviceWorkers: 'block' });
  const chunks = recordChunks(page);
  await page.goto('/?debug=hook&renderer=canvas&quality=low');
  await expect.poll(() => chunks.includes('localServer'), { timeout: 15_000 }).toBe(true);
  // ?debug가 있으면 디버그 조각을 받은 뒤 앱을 시작한다 (첫 화면이 그려질 때 훅이 이미 있다)
  expect(chunks.indexOf('debug')).toBeGreaterThan(chunks.indexOf('index'));
  expect(await page.evaluate(() => window.__DECOY__ !== undefined)).toBe(true);
  await page.waitForTimeout(300);
  const before = chunks.length;
  await press(page.getByTestId('practice'));
  await press(page.getByTestId('practice-role-runner'));
  await expect.poll(() => page.evaluate(() => window.__DECOY__?.phase), { timeout: 15_000 }).toBe('playing');
  expect(await page.evaluate(() => window.__DECOY__?.transport)).toBe('local');
  expect(chunks.slice(before)).toEqual([]);
  expect(problems.filter((p) => !BLOCKED.test(p))).toEqual([]);
  await context.close();
});

test('판 중 설정을 처음 열 때: 로비에서 받아 만들어 둔 화면이라 판 중에는 JS를 더 받지 않고 긴 작업이 없다', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  // 로비에서 쉬는 시간 미리 받기를 기다린 뒤 판을 시작한다 (startBotRoom은 서비스 워커를 막지 않는다 — 요청 기록은 같다)
  const s = await startBotRoom(browser, '&renderer=canvas&quality=low', 'runner', async (page) => {
    await expect(page.getByTestId('settings-modal')).toBeAttached({ timeout: 15_000 });
  });
  const { page } = s;
  const chunks = recordChunks(page);
  await expect(page.getByTestId('match-menu')).toBeVisible({ timeout: 15_000 });
  await watchLongTasks(page);
  const t0 = Date.now();
  await page.getByTestId('match-menu').click();
  await expect(page.getByTestId('settings-panel')).toBeVisible();
  const openMs = Date.now() - t0;
  await page.waitForTimeout(500);
  const long = await page.evaluate(() => (window as unknown as { __longTasks: number[] }).__longTasks);
  console.log(
    `[lazy-chunks] 판 중 설정 처음 열기: 누름 → 보임 ${openMs}ms (Playwright 왕복 포함), 긴 작업 ${JSON.stringify(long)}`,
  );
  expect(long).toEqual([]);
  expect(chunks).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('settings-panel')).toBeHidden();
  expect(s.problems).toEqual([]);
  await s.context.close();
});

test('조각을 받지 못하면(배포 직후 옛 화면) 설정 · 봇과 연습은 "새 버전이 있어요", 첫 화면은 그대로 쓸 수 있다 (PC)', async ({
  browser,
}) => {
  const { context, page, problems } = await newPlayerPage(browser, { serviceWorkers: 'block' });
  await page.route(/\/assets\/(settingsPanel|localServer)-[^/]*\.js$/, (route) => route.abort());
  await page.goto('/?debug=hook&renderer=canvas');
  await expect(page.getByTestId('create-room')).toBeVisible();
  await press(page.getByTestId('settings-button').first());
  await expect(page.getByTestId('update-available')).toBeVisible();
  await expect(page.getByTestId('settings-panel')).toHaveCount(0);
  await press(page.getByTestId('practice'));
  await press(page.getByTestId('practice-role-scout'));
  await page.waitForTimeout(1000);
  expect(await page.evaluate(() => window.__DECOY__?.transport)).toBe('net');
  await expect(page.getByTestId('practice-picker')).toBeVisible();
  // 첫 화면은 그대로: 연습 고르기를 닫고 방을 만들 수 있다
  await press(page.getByTestId('practice-cancel'));
  await press(page.getByTestId('create-room'));
  await expect(page.getByTestId('room-code')).toHaveText(/^[A-Z]{4}$/);
  expect(problems.filter((p) => !BLOCKED.test(p) && !/settingsPanel-|localServer-/.test(p))).toEqual([]);
  await context.close();
});

test('터치 로비 설정: 배치 편집 조각은 설정을 열 때 받고, 받지 못하면 설정 화면으로 돌아와 "새 버전이 있어요"', async ({
  browser,
}) => {
  const ok = await newPlayerPage(browser, { ...dpr1(PHONE_LANDSCAPE), serviceWorkers: 'block' });
  const chunks = recordChunks(ok.page);
  await ok.page.goto('/?debug=hook&renderer=canvas');
  await expect(ok.page.getByTestId('settings-modal')).toBeAttached({ timeout: 15_000 });
  await ok.page.waitForTimeout(300);
  expect(chunks).not.toContain('layoutEditor');
  await press(ok.page.getByTestId('settings-button').first());
  await expect.poll(() => chunks.includes('layoutEditor')).toBe(true);
  await press(ok.page.getByTestId('settings-tab-controls'));
  await press(ok.page.getByTestId('layout-edit'));
  await expect(ok.page.getByTestId('layout-editor')).toBeVisible();
  await press(ok.page.getByTestId('le-cancel'));
  await expect(ok.page.getByTestId('settings-panel')).toBeVisible();
  expect(ok.problems.filter((p) => !BLOCKED.test(p))).toEqual([]);
  await ok.context.close();

  const bad = await newPlayerPage(browser, { ...dpr1(PHONE_LANDSCAPE), serviceWorkers: 'block' });
  await bad.page.route(/\/assets\/layoutEditor-[^/]*\.js$/, (route) => route.abort());
  await bad.page.goto('/?debug=hook&renderer=canvas');
  await press(bad.page.getByTestId('settings-button').first());
  await expect(bad.page.getByTestId('settings-panel')).toBeVisible();
  await press(bad.page.getByTestId('settings-tab-controls'));
  await press(bad.page.getByTestId('layout-edit'));
  await expect(bad.page.getByTestId('update-available')).toBeVisible();
  await expect(bad.page.getByTestId('settings-panel')).toBeVisible();
  await expect(bad.page.getByTestId('layout-editor')).toHaveCount(0);
  expect(bad.problems.filter((p) => !BLOCKED.test(p) && !/layoutEditor-/.test(p))).toEqual([]);
  await bad.context.close();
});

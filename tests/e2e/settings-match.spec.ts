// 판 중 설정 · 로비 조작 탭 (설정 화면 통합) — 진짜 설정 화면(app.settings)과 판 장면 · 조작 배치 편집 · 판 직전 안내의 연결:
//  - PC: 판 중 메뉴 버튼 · Esc가 진짜 설정 화면을 판 중 탭(그래픽 · 화면 · 소리)으로 연다. 열린 동안 입력이 멈추고 판 · 그리기는
//    계속(긴 작업 없음), 판 중에 고친 값(흔들림 줄이기)이 바로 판에 걸린다, 설정 화면 안 Esc는 닫기만(다시 열리지 않음),
//    판이 끝나면(결과) 저절로 닫힌다
//  - 터치: 판 중 '설정' 버튼이 같은 판 중 탭으로 열고, 닫으면 입력을 다시 받는다
//  - 터치 로비: 조작 탭의 '조작 배치 편집'이 편집 화면을 열고, 취소하면 설정 화면 조작 탭으로 돌아온다
//  - 터치 판 직전 안내: 조작 배치를 바꿨으면(좌우 반전) 그림이 바꾼 배치(이동 영역이 오른쪽)를 그리고 본문은 자리 말이 없다
import { expect, test, type Page } from '@playwright/test';
import type { MatchPrefsDebug } from '@decoy/shared';
import { TOUCH_TEXT } from '../../client/src/data/storyText';
import { PHONE_LANDSCAPE, dpr1, newPlayerPage, press, waitForSnapshots } from './helpers';
import { startBotRoom } from './m10-map.shared';
import { waitForTouchTarget } from './touch';

const QUERY = '&renderer=canvas&quality=low';
const MATCH_TABS = ['graphics', 'screen', 'sound'];

async function prefs(page: Page): Promise<MatchPrefsDebug> {
  const p = await page.evaluate(() => window.__DECOY__?.getMatchPrefs() ?? null);
  if (!p) throw new Error('판 장면 없음');
  return p;
}

/** 설정 화면에 보이는 탭 id */
async function tabIds(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[data-testid^="settings-tab-"]')]
      .filter((t) => t.offsetParent !== null)
      .map((t) => (t.dataset.testid ?? '').replace('settings-tab-', '')),
  );
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

async function longTasks(page: Page): Promise<number[]> {
  return page.evaluate(() => (window as unknown as { __longTasks: number[] }).__longTasks);
}

test('PC 판 중 설정: 메뉴 버튼 · Esc로 진짜 설정 화면(판 중 탭 셋), 입력 멈춤 · 판은 계속 · 긴 작업 없음, 고친 값은 바로, 결과에서 닫힘', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const s = await startBotRoom(browser, QUERY, 'runner');
  const { page } = s;
  const panel = page.getByTestId('settings-panel');
  await expect.poll(async () => (await prefs(page)).menuButton?.visible).toBe(true);
  expect((await prefs(page)).shakeScale).toBeGreaterThan(0);

  // 메뉴 버튼 → 판 중 설정 (조작 탭 · 배치 편집 없음, 판이 멈추지 않는다는 안내)
  await watchLongTasks(page);
  const snaps0 = await page.evaluate(() => window.__DECOY__!.snapCount);
  const frames0 = (await page.evaluate(() => window.__DECOY__!.getAnimState()?.frames)) ?? 0;
  await page.getByTestId('match-menu').click();
  await expect(panel).toBeVisible();
  expect(await tabIds(page)).toEqual(MATCH_TABS);
  await expect(page.getByTestId('settings-tab-controls')).toBeHidden();
  await expect(page.getByTestId('layout-edit')).toBeHidden();
  await expect(page.getByTestId('settings-inmatch')).toBeVisible();
  await expect.poll(async () => (await prefs(page)).inputSuspended).toBe(true);
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__DECOY__!.snapCount)).toBeGreaterThan(snaps0 + 5);
  expect((await page.evaluate(() => window.__DECOY__!.getAnimState()?.frames)) ?? 0).toBeGreaterThan(
    frames0 + 5,
  );
  const long1 = await longTasks(page);
  console.log(`[settings-match] 판 중 설정 열기 긴 작업 ${JSON.stringify(long1)}`);
  expect(long1).toEqual([]);

  // 판 중에 고친 값이 바로 걸린다 (흔들림 줄이기 → 흔들림 배율 0), 탭 바꾸기도 긴 작업 없음
  await press(page.getByTestId('settings-tab-screen'));
  await press(page.getByTestId('reduce-shake-on'));
  await expect.poll(async () => (await prefs(page)).shakeScale).toBe(0);
  await press(page.getByTestId('settings-tab-sound'));
  await press(page.getByTestId('settings-tab-graphics'));
  expect(await longTasks(page)).toEqual([]);

  // 설정 화면 안(포커스가 탭에 있다)의 Esc: 닫기만 하고 판 장면이 다시 열지 않는다
  await page.getByTestId('settings-tab-graphics').focus();
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await page.waitForTimeout(200);
  await expect(panel).toBeHidden();
  await expect.poll(async () => (await prefs(page)).inputSuspended).toBe(false);

  // 판 화면의 Esc: 열고 · 닫는다
  await page
    .locator('canvas')
    .first()
    .click({ position: { x: 900, y: 500 } });
  await page.keyboard.press('Escape');
  await expect(panel).toBeVisible();
  expect(await tabIds(page)).toEqual(MATCH_TABS);
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();

  // 열어 둔 채 판이 끝나면 저절로 닫힌다
  await page.getByTestId('match-menu').click();
  await expect(panel).toBeVisible();
  await page.evaluate(() => window.__DECOY__!.sendTest({ kind: 'setTime', timeLeft: 0 }));
  await page.waitForFunction(() => (window.__DECOY__?.getResult() ?? null) !== null, null, {
    timeout: 20_000,
  });
  await expect(panel).toBeHidden();
  expect(s.problems).toEqual([]);
  await s.context.close();
});

test('터치 판 중 설정: 설정 버튼이 판 중 탭 셋으로 열고, 여는 동안 입력이 멈추고, 닫으면 다시 받는다', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const { context, page, problems } = await newPlayerPage(browser, dpr1(PHONE_LANDSCAPE));
  await page.goto('/?bots=1&debug=hook&renderer=canvas&quality=low');
  await press(page.getByTestId('create-room'));
  await press(page.getByTestId('role-runner'));
  await press(page.getByTestId('ready-button'));
  const ok = page.getByTestId('touch-tutorial-ok');
  if (await ok.isVisible()) await press(ok);
  await press(page.getByTestId('start-button'));
  await waitForSnapshots(page, 3);
  const menu = await waitForTouchTarget(page, 'menu');
  await page.waitForTimeout(400);
  // 손가락을 댈 때 연다: 뗄 때 생기는 click이 새로 뜬 닫기 단추에 떨어져도 닫히지 않는다
  await page.touchscreen.tap(menu.x + menu.w / 2, menu.y + menu.h / 2);
  const panel = page.getByTestId('settings-panel');
  await expect(panel).toBeVisible();
  await page.waitForTimeout(600);
  await expect(panel).toBeVisible();
  expect(await tabIds(page)).toEqual(MATCH_TABS);
  await expect(page.getByTestId('settings-inmatch')).toBeVisible();
  await expect.poll(async () => (await prefs(page)).inputSuspended).toBe(true);
  await press(page.getByTestId('settings-close'));
  await expect(panel).toBeHidden();
  await expect.poll(async () => (await prefs(page)).inputSuspended).toBe(false);
  expect(problems).toEqual([]);
  await context.close();
});

test('터치 로비 조작 탭: 조작 배치 편집을 열고 취소하면 설정 화면 조작 탭으로 돌아온다', async ({
  browser,
}) => {
  const { context, page, problems } = await newPlayerPage(browser, dpr1(PHONE_LANDSCAPE));
  await page.goto('/?debug=hook&renderer=canvas');
  await press(page.getByTestId('settings-button').first());
  const panel = page.getByTestId('settings-panel');
  await expect(panel).toBeVisible();
  expect(await tabIds(page)).toEqual([...MATCH_TABS, 'controls']);
  await press(page.getByTestId('settings-tab-controls'));
  await press(page.getByTestId('layout-edit'));
  const editor = page.getByTestId('layout-editor');
  await expect(editor).toBeVisible();
  await expect(panel).toBeHidden();
  await press(page.getByTestId('le-cancel'));
  await expect(editor).toHaveCount(0);
  await expect(panel).toBeVisible();
  await expect(page.getByTestId('settings-tab-controls')).toHaveAttribute('aria-selected', 'true');
  expect(await page.evaluate(() => localStorage.getItem('decoy:controlLayout'))).toBeNull();
  expect(problems).toEqual([]);
  await context.close();
});

test('터치 판 직전 안내: 좌우 반전한 배치면 그림의 이동 영역이 오른쪽 · 본문은 자리 말 없이, 기본 배치면 예전 그림', async ({
  browser,
}) => {
  const { context, page, problems } = await newPlayerPage(browser, dpr1(PHONE_LANDSCAPE));
  await context.addInitScript(() => {
    if (sessionStorage.getItem('e2e-layout-set')) return;
    sessionStorage.setItem('e2e-layout-set', '1');
    localStorage.setItem(
      'decoy:controlLayout',
      JSON.stringify({ v: 1, survivor: { mirror: true, items: {} } }),
    );
  });
  await page.goto('/?debug=hook&renderer=canvas');
  await press(page.getByTestId('create-room'));
  await press(page.getByTestId('role-runner'));
  await press(page.getByTestId('ready-button'));
  const card = page.getByTestId('touch-tutorial');
  await expect(card).toBeVisible();
  await expect(page.getByTestId('touch-tutorial-custom')).toHaveText(TOUCH_TEXT.tutorialCustomNote);
  const lines = await card.locator('li').allTextContents();
  expect(lines).toEqual([...TOUCH_TEXT.tutorialSurvivorCustom]);
  for (const l of lines) expect(l).not.toMatch(/왼쪽|오른쪽/);
  await expect(card.locator('.tt-badge')).toHaveCount(3);
  const art = await page.evaluate(() => {
    const box = document.querySelector('.tt-art')!.getBoundingClientRect();
    const zone = document.querySelector('.tt-art .tt-zone')!.getBoundingClientRect();
    const badges = [...document.querySelectorAll('.tt-badge')].map((b) => b.getBoundingClientRect());
    const outside = badges.filter(
      (r) =>
        r.left < box.left - 0.5 ||
        r.right > box.right + 0.5 ||
        r.top < box.top - 0.5 ||
        r.bottom > box.bottom + 0.5,
    ).length;
    return { mid: box.left + box.width / 2, zoneMid: zone.left + zone.width / 2, outside };
  });
  // 좌우 반전: 이동 영역이 그림 오른쪽 · 번호는 그림 안
  expect(art.zoneMid).toBeGreaterThan(art.mid);
  expect(art.outside).toBe(0);

  // 기본 배치로 되돌리면 예전 그림 · 예전 본문 (준비를 풀었다 다시)
  await page.evaluate(() => localStorage.removeItem('decoy:controlLayout'));
  await press(page.getByTestId('ready-button'));
  await press(page.getByTestId('settings-button').first());
  await press(page.getByTestId('settings-tab-controls'));
  await press(page.getByTestId('tutorial-replay'));
  await press(page.getByTestId('settings-close'));
  await press(page.getByTestId('ready-button'));
  await expect(card).toBeVisible();
  await expect(page.getByTestId('touch-tutorial-custom')).toHaveCount(0);
  expect(await card.locator('li').allTextContents()).toEqual([...TOUCH_TEXT.tutorialSurvivor]);
  expect(problems).toEqual([]);
  await context.close();
});

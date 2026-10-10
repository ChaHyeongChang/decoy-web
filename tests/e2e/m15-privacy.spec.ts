// M15 개인정보 처리방침 · 외부 전송 (MOBILE_PLAN M15 자동 검증)
//  - 로비 첫 화면의 링크를 탭하면 /privacy가 열린다: 200 · text/html · lang="ko" · 게임 HTML 아님, 돌아가기 링크로 첫 화면
//  - 360px 폭(세로 휴대폰)과 가로 휴대폰에서 가로 스크롤이 없다
//  - 앱 셸을 받은 뒤 네트워크를 끊고 서버도 끈 채 /privacy를 열어도 뜬다 (서비스 워커 캐시)
//  - 외부 전송 없음(실제 요청): 혼합 판(PC + 휴대폰 + 봇) 한 판과 봇과 연습 한 판 동안 모든 요청 · WebSocket 대상이 같은 출처
import { expect, test, type Page } from '@playwright/test';
import { freePort, startServer } from '../helpers/serverProcess';
import {
  PHONE_LANDSCAPE,
  createRoom,
  dpr1,
  joinRoom,
  myId,
  newPlayerPage,
  pickRoleAndReady,
  press,
  sendTest,
  waitForSnapshots,
  watchConsole,
} from './helpers';

/** 세로 휴대폰 360px 폭 */
const PHONE_PORTRAIT = {
  viewport: { width: 360, height: 740 },
  screen: { width: 360, height: 740 },
  deviceScaleFactor: 1,
  isMobile: true,
  hasTouch: true,
};

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

test('로비 링크를 탭하면 처리방침이 열리고(200 · HTML · 한국어), 돌아가기로 첫 화면 · 360px 폭과 가로 휴대폰에서 가로 스크롤 없음', async ({
  browser,
}) => {
  const { context, page, problems } = await newPlayerPage(browser, dpr1(PHONE_LANDSCAPE));
  await page.goto('/?debug=hook&renderer=canvas');
  const link = page.getByTestId('privacy-link');
  await expect(link).toBeVisible();
  await expect(link).toHaveText('개인정보 처리방침');
  const [res] = await Promise.all([page.waitForResponse((r) => new URL(r.url()).pathname === '/privacy'), press(link)]);
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toBe('text/html; charset=utf-8');
  await expect(page).toHaveURL(/\/privacy$/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'ko');
  await expect(page.locator('h1')).toHaveText('DECOY 개인정보 처리방침');
  expect(await page.locator('#game-root').count()).toBe(0);
  // 필수 절 제목
  const heads = await page.locator('h2').allTextContents();
  for (const w of ['항목', '목적', '보관', '제3자', '위탁', '국외 이전', '파기', '권리', '문의처', '시행일'])
    expect(
      heads.some((h) => h.includes(w)),
      w,
    ).toBe(true);
  expect(await horizontalOverflow(page), '가로 휴대폰 가로 스크롤').toBeLessThanOrEqual(0);
  // 돌아가기 → 첫 화면
  await press(page.getByTestId('privacy-back'));
  await expect(page.getByTestId('practice')).toBeVisible();
  expect(problems).toEqual([]);
  await context.close();

  // 360px 폭 세로 휴대폰: 표가 카드로 바뀌어 가로로 넘치지 않는다
  const narrow = await newPlayerPage(browser, PHONE_PORTRAIT);
  await narrow.page.goto('/privacy');
  await expect(narrow.page.locator('h1')).toBeVisible();
  expect(await horizontalOverflow(narrow.page), '360px 가로 스크롤').toBeLessThanOrEqual(0);
  const wide = await narrow.page.evaluate(() =>
    [...document.querySelectorAll('main *')]
      .filter((el) => el.getBoundingClientRect().right > document.documentElement.clientWidth + 0.5)
      .map((el) => `${el.tagName} ${(el.textContent ?? '').slice(0, 20)}`),
  );
  expect(wide, '화면 밖으로 나간 요소').toEqual([]);
  expect(narrow.problems).toEqual([]);
  await narrow.context.close();
});

test('앱 셸을 받은 뒤 네트워크를 끊고 서버도 끈 채 /privacy를 열어도 뜬다', async ({ browser }) => {
  const port = await freePort();
  const server = await startServer([], { port });
  const base = `http://localhost:${port}`;
  const context = await browser.newContext({ viewport: { width: 960, height: 540 } });
  const page = await context.newPage();
  const problems: string[] = [];
  watchConsole(page, problems);
  try {
    await page.goto(`${base}/?debug=hook&renderer=canvas`);
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, { timeout: 20_000 });
    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            const shell = (await caches.keys()).find((k) => k.startsWith('decoy-shell-'));
            if (!shell) return false;
            return (await (await caches.open(shell)).match(new URL('privacy.html', location.href).href)) !== undefined;
          }),
        { timeout: 20_000 },
      )
      .toBe(true);
    await server.stop();
    await context.setOffline(true);
    await page.goto(`${base}/privacy`);
    await expect(page.locator('h1')).toHaveText('DECOY 개인정보 처리방침');
    await expect(page.getByTestId('privacy-contact')).toContainText('개발자 연락처');
    // 돌아가기도 오프라인 앱 셸로 (첫 화면 + 봇과 연습)
    await page.getByTestId('privacy-back').click();
    await expect(page.getByTestId('practice')).toBeVisible();
  } finally {
    await context.close();
    await server.stop();
  }
  // 서버를 끈 시험이라 브라우저 자체 연결 실패 로그만 허용 (m13-offline과 같은 기준)
  expect(problems.filter((p) => !/WebSocket connection to .* failed|Failed to load resource/.test(p))).toEqual([]);
});

test('외부 전송 없음: 혼합 판(PC + 휴대폰 + 봇)과 봇과 연습 동안 모든 요청 · WebSocket이 같은 출처', async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(120_000);
  const origin = new URL(baseURL ?? '').origin;
  const wsOrigin = origin.replace(/^http/, 'ws');
  const seen: string[] = [];
  const track = (page: Page): void => {
    page.on('request', (r) => seen.push(r.url()));
    page.on('websocket', (ws) => seen.push(ws.url()));
  };
  const pc = await newPlayerPage(browser);
  const phone = await newPlayerPage(browser, dpr1(PHONE_LANDSCAPE));
  track(pc.page);
  track(phone.page);
  const code = await createRoom(pc.page, '&bots=1');
  await joinRoom(phone.page, code);
  await pickRoleAndReady(phone.page, 'runner');
  await pickRoleAndReady(pc.page, 'monster');
  await press(pc.page.getByTestId('start-button'));
  await waitForSnapshots(pc.page, 3);
  await waitForSnapshots(phone.page, 3);
  // 잠깐 움직이고 끝까지
  await phone.page.keyboard.down('KeyD');
  await pc.page.waitForTimeout(1500);
  await phone.page.keyboard.up('KeyD');
  expect(await myId(pc.page)).not.toBe('');
  await sendTest(pc.page, { kind: 'setTime', timeLeft: 0.1 });
  await expect(pc.page.getByTestId('result')).toBeVisible({ timeout: 15_000 });
  await expect(phone.page.getByTestId('result')).toBeVisible({ timeout: 15_000 });
  await pc.context.close();
  await phone.context.close();

  // 봇과 연습 한 판 (기기 안)
  const solo = await newPlayerPage(browser, dpr1(PHONE_LANDSCAPE));
  track(solo.page);
  await solo.page.goto('/?debug=hook&renderer=canvas');
  await press(solo.page.getByTestId('practice'));
  await press(solo.page.getByTestId('practice-role-scout'));
  await expect.poll(() => solo.page.evaluate(() => window.__DECOY__?.phase ?? null), { timeout: 15_000 }).toBe(
    'playing',
  );
  await solo.page.waitForTimeout(3000);
  await solo.page.evaluate(() => window.__DECOY__?.sendTest({ kind: 'setTime', timeLeft: 0.1 }));
  await expect(solo.page.getByTestId('result')).toBeVisible({ timeout: 15_000 });
  await solo.context.close();

  const network = seen.filter((u) => /^(https?|wss?):/.test(u));
  expect(network.length).toBeGreaterThan(10);
  const outside = network.filter((u) => {
    const o = new URL(u).origin;
    return o !== origin && o !== wsOrigin;
  });
  expect(outside, '다른 출처로 간 요청').toEqual([]);
  // 데이터 · blob 주소만 그 밖으로 있다 (그림 · 글꼴을 앱 안에서 만든다)
  expect(seen.filter((u) => !/^(https?|wss?|data|blob):/.test(u))).toEqual([]);
  expect(pc.problems).toEqual([]);
  expect(phone.problems).toEqual([]);
  expect(solo.problems).toEqual([]);
});

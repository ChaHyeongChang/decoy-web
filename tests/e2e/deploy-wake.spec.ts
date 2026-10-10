// 잠든 서버 깨우기 (Render 무료 플랜 대비): /test/stall 훅으로 서버가 깨어나는 동안을 흉내 낸다
//  - 첫 화면: 연결을 기다리면 상태 줄 '서버를 깨우는 중… n초' + 봇과 연습 (M13b, 가운데 패널 대신)
//  - 방 안에서: 끊긴 뒤면 가운데 패널 '서버에 다시 연결하는 중' 안내
//  - 페이지를 새로 열 때: 서비스 워커가 미리 받아 둔 깨우기 화면(wake.html)을 보여 주고, 깨어나면 원래 주소로 돌아간다
import { expect, test, type Page } from '@playwright/test';
import { BASE_QUERY, createRoom, newPlayerPage } from './helpers';

async function stall(page: Page, query: string): Promise<void> {
  const res = await page.request.get(`/test/stall?${query}`);
  expect(res.status()).toBe(200);
}

test.afterEach(async ({ request }) => {
  // 실패해도 다음 테스트가 붙잡힌 서버를 만나지 않게
  await request.get('/test/stall?ms=0');
  await request.get('/test/unmark?ms=0');
});

test('처음 접속할 때 서버 연결이 늦으면 첫 화면은 바로 뜨고 상태 줄이 "서버를 깨우는 중" · 봇과 연습을 알리며, 연결되면 방 만들기가 켜진다', async ({
  browser,
}) => {
  const { context, page, problems } = await newPlayerPage(browser);
  await stall(page, 'ms=9000&http=0');
  await page.goto(`/?${BASE_QUERY.slice(1)}`);
  // 첫 화면은 연결과 상관없이 바로 (M13b): 가운데 깨우기 패널 대신 상태 줄, 연결이 필요한 버튼은 꺼짐
  const status = page.getByTestId('server-status');
  await expect(status).toBeVisible({ timeout: 3000 });
  await expect(page.getByTestId('practice')).toBeVisible();
  await expect(page.getByTestId('create-room')).toBeDisabled();
  await expect(status).toHaveAttribute('data-state', 'waking');
  await expect(status).toContainText(/서버를 깨우는 중… \d+초 — 기다리는 동안 봇과 연습을 할 수 있어요/);
  await page.waitForTimeout(3000);
  await expect(page.getByTestId('server-waking')).toBeHidden();
  await expect(status).toContainText(/[3-9]초/);
  await page.screenshot({ path: 'artifacts/screens/wake-lobby.png' });
  // 서버가 깨어나면 상태 줄이 연결됨으로 바뀌고 방 만들기가 켜진다
  await expect(status).toHaveAttribute('data-state', 'connected', { timeout: 15_000 });
  await expect(status).toContainText('서버 연결됨');
  await expect(page.getByTestId('create-room')).toBeEnabled();
  await expect(page.getByTestId('server-waking')).toBeHidden();
  expect(problems).toEqual([]);
  await context.close();
});

test('로비에서 연결이 끊기면 "서버에 다시 연결하는 중" 안내 뒤 같은 방으로 돌아온다', async ({ browser }) => {
  const { context, page, problems } = await newPlayerPage(browser);
  const code = await createRoom(page);
  await stall(page, 'ms=8000&drop=1');
  const notice = page.getByTestId('server-waking');
  await expect(notice).toBeVisible({ timeout: 6000 });
  await expect(notice).toContainText('서버에 다시 연결하는 중');
  await expect(notice.locator('.wake-logo')).toBeHidden();
  await expect(notice).toBeHidden({ timeout: 15_000 });
  await expect(page.getByTestId('room-code')).toHaveText(code);
  expect(problems).toEqual([]);
  await context.close();
});

test('서버가 잠든 동안 페이지를 다시 열면 깨우기 화면이 뜨고, 깨어나면 방 주소 그대로 돌아온다', async ({
  browser,
}) => {
  const { context, page, problems } = await newPlayerPage(browser);
  const code = await createRoom(page);
  expect(page.url()).toContain(`room=${code}`);
  // 첫 접속에서 서비스 워커가 깨우기 화면을 받아 두고 이 페이지를 맡을 때까지
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await stall(page, 'ms=10000&drop=1');
  await page.reload();
  const wake = page.getByTestId('wake-page');
  await expect(wake).toBeVisible();
  await expect(wake).toContainText('서버를 깨우는 중');
  await expect(wake).toContainText(/\d+초째 기다리는 중/);
  await page.screenshot({ path: 'artifacts/screens/wake-page.png' });
  // healthz가 이 서버의 표시와 함께 답하면 스스로 새로고침 → 원래 주소(방 코드)로
  await expect(page.getByTestId('room-code')).toHaveText(code, { timeout: 20_000 });
  expect(page.url()).toContain(`room=${code}`);
  await expect(page.getByTestId('server-waking')).toBeHidden();
  expect(problems).toEqual([]);
  await context.close();
});

test('서버가 깨어 있으면 서비스 워커가 있어도 첫 화면은 서버가 그대로 준다', async ({ browser }) => {
  const { context, page, problems } = await newPlayerPage(browser);
  await createRoom(page);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  const t0 = Date.now();
  await page.reload();
  await expect(page.getByTestId('room-code')).toHaveText(/^[A-Z]{4}$/);
  expect(Date.now() - t0).toBeLessThan(5000);
  await expect(page.getByTestId('wake-page')).toHaveCount(0);
  expect(problems).toEqual([]);
  await context.close();
});

test('서버는 깨어 있는데 표시가 없으면(예전 버전으로 되돌림) 깨우기 화면에 갇히지 않고 서비스 워커를 지워 게임으로 간다', async ({
  browser,
}) => {
  const { context, page, problems } = await newPlayerPage(browser);
  await createRoom(page);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  const res = await page.request.get('/test/unmark?ms=20000');
  expect(res.status()).toBe(200);
  // 깨우기 화면은 곧바로 빠져나가 눈에 잘 안 잡히므로, 그 화면만 보내는 healthz 요청으로 거쳐 갔는지 확인한다
  const healthChecks: string[] = [];
  page.on('request', (r) => {
    if (new URL(r.url()).pathname === '/healthz') healthChecks.push(r.url());
  });
  const t0 = Date.now();
  await page.reload();
  // 표시 없는 응답 → 깨우기 화면 → healthz가 표시 없이 ok → 워커를 지우고 다시 연다
  await expect(page.getByTestId('room-code')).toHaveText(/^[A-Z]{4}$/, { timeout: 10_000 });
  expect(healthChecks.length).toBeGreaterThan(0);
  // 표시가 없는 동안(20초) 안에 빠져나왔다
  expect(Date.now() - t0).toBeLessThan(15_000);
  expect(problems).toEqual([]);
  await context.close();
});

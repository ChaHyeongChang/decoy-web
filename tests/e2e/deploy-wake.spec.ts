// 잠든 서버 깨우기 (Render 무료 플랜 대비): /test/stall 훅으로 서버가 깨어나는 동안을 흉내 낸다
//  - 로비 안에서: 연결을 기다리면 '서버를 깨우는 중' / 끊긴 뒤면 '서버에 다시 연결하는 중' 안내
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
});

test('처음 접속할 때 서버 연결이 늦으면 로비 자리에 "서버를 깨우는 중" 안내가 뜨고, 연결되면 로비가 나온다', async ({
  browser,
}) => {
  const { context, page, problems } = await newPlayerPage(browser);
  await stall(page, 'ms=9000&http=0');
  await page.goto(`/?${BASE_QUERY.slice(1)}`);
  const notice = page.getByTestId('server-waking');
  await expect(notice).toBeVisible({ timeout: 6000 });
  await expect(notice).toContainText('서버를 깨우는 중');
  await expect(notice).toContainText('15분');
  await expect(notice.locator('.wake-logo')).toBeVisible();
  await expect(notice).toContainText(/\d+초째 기다리는 중/);
  await page.screenshot({ path: 'artifacts/screens/wake-lobby.png' });
  // 서버가 깨어나면 안내가 사라지고 로비 첫 화면
  await expect(page.getByTestId('create-room')).toBeVisible({ timeout: 15_000 });
  await expect(notice).toBeHidden();
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

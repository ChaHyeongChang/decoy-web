// 판 중 메뉴를 닫은 뒤 입력 이어받기 (남은 문제 정리): 메뉴를 여는 동안 판 입력은 멈추지만(이동 0 · 버튼 0), 닫는 순간 지금 누르고
// 있는 이동 키(PC) · 이동 스틱 손가락(터치)을 이어받아 다시 누르지 않아도 걷는다. 메뉴를 닫으려고 누른 Esc · 닫기 클릭 · 닫기 탭 ·
// 바깥 누르기는 게임 입력(공격 · 능력 · 탭)으로 새지 않는다. 진짜 설정 화면으로 연다 (Canvas 렌더러 · 봇 방 탭 하나)
import { expect, test, type Page } from '@playwright/test';
import { BTN, type InputLogEntry, type MatchPrefsDebug } from '@decoy/shared';
import {
  PHONE_LANDSCAPE,
  countPressed,
  dpr1,
  inputLog,
  newPlayerPage,
  press,
  waitForSnapshots,
} from './helpers';
import { settle, startBotRoom } from './m10-map.shared';
import { MultiTouch, centerOf, waitForTouchTarget } from './touch';

const QUERY = '&renderer=canvas&quality=low';

async function prefs(page: Page): Promise<MatchPrefsDebug> {
  const p = await page.evaluate(() => window.__DECOY__?.getMatchPrefs() ?? null);
  if (!p) throw new Error('판 장면 없음');
  return p;
}

const now = (page: Page): Promise<number> => page.evaluate(() => performance.now());

async function since(page: Page, t: number): Promise<InputLogEntry[]> {
  return (await inputLog(page)).filter((f) => f.t > t);
}

/** 판 중 설정이 열려 입력이 멈췄다 */
async function waitOpen(page: Page): Promise<void> {
  await expect(page.getByTestId('settings-panel')).toBeVisible();
  await expect.poll(async () => (await prefs(page)).inputSuspended).toBe(true);
}

/** 닫혀 입력을 다시 받는다 */
async function waitClosed(page: Page): Promise<void> {
  await expect(page.getByTestId('settings-panel')).toBeHidden();
  await expect.poll(async () => (await prefs(page)).inputSuspended).toBe(false);
}

/** 닫은 뒤 처음으로 움직이는 입력 프레임 (시각 · 값) — 이어받기가 늦지 않은지 */
async function firstMoveAfter(page: Page, t: number): Promise<InputLogEntry> {
  let hit: InputLogEntry | undefined;
  await expect
    .poll(async () => {
      hit = (await since(page, t)).find((f) => f.mx !== 0 || f.my !== 0);
      return hit !== undefined;
    })
    .toBe(true);
  return hit!;
}

/** 이 프레임들에 누른 신호 · 누른 버튼이 하나도 없다 */
function expectNoButtons(frames: readonly InputLogEntry[], label: string): void {
  for (const f of frames) expect([f.pressed, f.held], `${label} seq ${f.seq}`).toEqual([0, 0]);
}

test('PC: W를 누른 채 메뉴 버튼으로 열고 · 여는 동안 D도 누른 뒤 Esc로 닫으면 다시 누르지 않아도 그 방향으로 걷는다 (Esc는 게임 입력이 아니다)', async ({
  browser,
}) => {
  const s = await startBotRoom(browser, QUERY, 'runner');
  const { page } = s;
  await settle(page);
  await page.keyboard.down('KeyW');
  await expect.poll(async () => (await inputLog(page)).at(-1)?.my).toBe(-1);
  await page.getByTestId('match-menu').click();
  await waitOpen(page);
  const tOpen = await now(page);
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(300);
  for (const f of await since(page, tOpen + 40))
    expect([f.mx, f.my, f.pressed, f.held]).toEqual([0, 0, 0, 0]);
  const tClose = await now(page);
  await page.keyboard.press('Escape');
  await waitClosed(page);
  const first = await firstMoveAfter(page, tClose);
  console.log(`[menu-resume] PC Esc로 닫은 뒤 첫 움직임 입력 ${(first.t - tClose).toFixed(0)}ms`);
  expect(first.mx).toBeCloseTo(Math.SQRT1_2, 3);
  expect(first.my).toBeCloseTo(-Math.SQRT1_2, 3);
  // 닫은 뒤 입력 틱 몇 개 안에 (Esc를 누른 프레임부터 재므로 크게 잡는다 — 입력 틱 1/30초)
  expect(first.t - tClose).toBeLessThan(400);
  await page.waitForTimeout(300);
  const after = await since(page, tClose);
  expectNoButtons(after, 'Esc로 닫은 뒤');
  expect(after.at(-1)).toMatchObject({ my: expect.closeTo(-Math.SQRT1_2, 3) as unknown as number });
  // 떼면 멈춘다
  await page.keyboard.up('KeyD');
  await page.keyboard.up('KeyW');
  await expect.poll(async () => (await inputLog(page)).at(-1)?.my).toBe(0);
  expect(s.problems).toEqual([]);
  await s.context.close();
});

test('PC: 닫기 단추를 마우스로 눌러 닫아도 걷기를 이어받고 그 클릭은 공격 · 능력으로 가지 않는다, 여는 동안 뗀 키는 남지 않는다', async ({
  browser,
}) => {
  const s = await startBotRoom(browser, QUERY, 'monster');
  const { page } = s;
  await settle(page);
  const t0 = await now(page);
  // 괴물: 왼쪽 클릭 = 공격. 닫기 단추 클릭이 공격으로 새지 않아야 한다
  await page.keyboard.down('KeyS');
  await expect.poll(async () => (await inputLog(page)).at(-1)?.my).toBe(1);
  await page.keyboard.press('Escape');
  await waitOpen(page);
  // 여는 동안 A를 눌렀다 뗀다 (남지 않아야 한다)
  await page.keyboard.down('KeyA');
  await page.keyboard.up('KeyA');
  const tClose = await now(page);
  await page.getByTestId('settings-close').click();
  await waitClosed(page);
  const first = await firstMoveAfter(page, tClose);
  expect([first.mx, first.my]).toEqual([0, 1]);
  await page.waitForTimeout(400);
  const after = await since(page, tClose);
  expect(countPressed(after, BTN.ATTACK)).toBe(0);
  expectNoButtons(after, '닫기 클릭 뒤');
  for (const f of after) expect(f.mx).toBe(0);
  // 바깥(어두운 막)을 눌러 닫기: 누르는 순간 닫히고 손을 떼기 전이라도 공격으로 가지 않는다
  await page.keyboard.press('Escape');
  await waitOpen(page);
  const card = (await page.getByTestId('settings-panel').boundingBox())!;
  const vp = page.viewportSize()!;
  const outside = { x: Math.max(8, card.x / 2), y: vp.height / 2 };
  const tClose2 = await now(page);
  await page.mouse.move(outside.x, outside.y);
  await page.mouse.down();
  await waitClosed(page);
  await page.waitForTimeout(200);
  await page.mouse.up();
  await page.waitForTimeout(300);
  const after2 = await since(page, tClose2);
  expect(countPressed(after2, BTN.ATTACK)).toBe(0);
  expectNoButtons(after2, '바깥 누르기로 닫은 뒤');
  expect(after2.at(-1)?.my).toBe(1);
  await page.keyboard.up('KeyS');
  // 처음부터 지금까지 공격은 하나도 나가지 않았다
  expect(countPressed(await since(page, t0), BTN.ATTACK)).toBe(0);
  expect(s.problems).toEqual([]);
  await s.context.close();
});

test('PC: 여는 동안 이동 키를 떼면 닫은 뒤 걷지 않는다', async ({ browser }) => {
  const s = await startBotRoom(browser, QUERY, 'runner');
  const { page } = s;
  await settle(page);
  await page.keyboard.down('KeyD');
  await expect.poll(async () => (await inputLog(page)).at(-1)?.mx).toBe(1);
  await page.keyboard.press('Escape');
  await waitOpen(page);
  await page.keyboard.up('KeyD');
  const tClose = await now(page);
  await page.keyboard.press('Escape');
  await waitClosed(page);
  await page.waitForTimeout(400);
  const after = await since(page, tClose);
  expect(after.length).toBeGreaterThan(3);
  for (const f of after) expect([f.mx, f.my, f.pressed, f.held]).toEqual([0, 0, 0, 0]);
  expect(s.problems).toEqual([]);
  await s.context.close();
});

/** 터치 봇 방 (휴대폰 915×412, 기기 배율 1) — 판 직전 안내는 닫고 시작 */
async function touchMatch(
  browser: Parameters<typeof newPlayerPage>[0],
  role: 'runner' | 'monster',
): Promise<Awaited<ReturnType<typeof newPlayerPage>>> {
  const r = await newPlayerPage(browser, dpr1(PHONE_LANDSCAPE));
  const { page } = r;
  await page.goto(`/?bots=1&debug=hook${QUERY}`);
  await press(page.getByTestId('create-room'));
  await press(page.getByTestId(`role-${role}`));
  await press(page.getByTestId('ready-button'));
  const ok = page.getByTestId('touch-tutorial-ok');
  if (await ok.isVisible()) await press(ok);
  await press(page.getByTestId('start-button'));
  await waitForSnapshots(page, 3);
  await waitForTouchTarget(page, 'move-zone');
  // 판 시작 위치 표시가 사라질 때까지 기다리지 않는다 (입력을 막지 않는다)
  await page.waitForTimeout(300);
  return r;
}

test('터치: 이동 스틱을 누른 채 설정을 열고 닫으면(닫기 탭) 스틱을 다시 누르지 않아도 그 손가락 방향으로 걷는다, 닫기 탭은 게임 입력이 아니다', async ({
  browser,
}) => {
  const { context, page, problems } = await touchMatch(browser, 'runner');
  const mt = await MultiTouch.attach(page);
  const zone = await waitForTouchTarget(page, 'move-zone');
  const c = { x: zone.x + zone.w * 0.45, y: zone.y + zone.h * 0.55 };
  await mt.down(1, c.x, c.y);
  await mt.move(1, c.x + 60, c.y, { steps: 4, stepMs: 20 });
  await expect.poll(async () => (await inputLog(page)).at(-1)?.mx).toBe(1);
  // 다른 손가락으로 '설정'
  const menu = centerOf(await waitForTouchTarget(page, 'menu'));
  await mt.tap(2, menu.x, menu.y);
  await waitOpen(page);
  const tOpen = await now(page);
  // 여는 동안 스틱 손가락을 오른쪽 위로 옮긴다 (판 입력은 멈춤)
  await mt.move(1, c.x + 45, c.y - 45, { steps: 3, stepMs: 20 });
  await page.waitForTimeout(300);
  for (const f of await since(page, tOpen + 40))
    expect([f.mx, f.my, f.pressed, f.held]).toEqual([0, 0, 0, 0]);
  expect(await page.evaluate(() => window.__DECOY__!.getMatchPrefs()!.inputSuspended)).toBe(true);
  // 닫기 탭 (스틱 손가락은 누른 채)
  const close = (await page.getByTestId('settings-close').boundingBox())!;
  const tClose = await now(page);
  await mt.tap(2, close.x + close.width / 2, close.y + close.height / 2);
  await waitClosed(page);
  const first = await firstMoveAfter(page, tClose);
  console.log(`[menu-resume] 터치 닫기 탭 뒤 첫 움직임 입력 ${(first.t - tClose).toFixed(0)}ms`);
  expect(first.mx).toBeCloseTo(Math.SQRT1_2, 2);
  expect(first.my).toBeCloseTo(-Math.SQRT1_2, 2);
  expect(first.t - tClose).toBeLessThan(400);
  // 이어받은 스틱은 계속 따라간다 · 닫기 탭은 아무 버튼도 내지 않았다
  await mt.move(1, c.x, c.y + 60, { steps: 3, stepMs: 20 });
  await expect.poll(async () => (await inputLog(page)).at(-1)?.my).toBe(1);
  expectNoButtons(await since(page, tClose), '닫기 탭 뒤');
  // 떼면 멈춘다
  await mt.up(1);
  await expect.poll(async () => (await inputLog(page)).at(-1)?.my).toBe(0);
  await mt.detach();
  expect(problems).toEqual([]);
  await context.close();
});

test('터치 괴물: 스틱을 누른 채 바깥(조준 스틱 자리)을 눌러 닫아도 공격이 나가지 않고 걷기를 이어받는다, 여는 동안 스틱을 떼면 이어받지 않는다', async ({
  browser,
}) => {
  const { context, page, problems } = await touchMatch(browser, 'monster');
  const mt = await MultiTouch.attach(page);
  const zone = await waitForTouchTarget(page, 'move-zone');
  const aim = centerOf(await waitForTouchTarget(page, 'aim-stick'));
  const t0 = await now(page);
  const c = { x: zone.x + zone.w * 0.45, y: zone.y + zone.h * 0.55 };
  await mt.down(1, c.x, c.y);
  await mt.move(1, c.x, c.y + 60, { steps: 4, stepMs: 20 });
  await expect.poll(async () => (await inputLog(page)).at(-1)?.my).toBe(1);
  const menu = centerOf(await waitForTouchTarget(page, 'menu'));
  await mt.tap(2, menu.x, menu.y);
  await waitOpen(page);
  // 바깥 누르기 자리: 조준 스틱 자리가 설정 카드 밖이면 그곳(가장 나쁜 경우), 아니면 카드 밖 왼쪽 가운데
  const card = (await page.getByTestId('settings-panel').boundingBox())!;
  const inCard = (p: { x: number; y: number }): boolean =>
    p.x >= card.x && p.x <= card.x + card.width && p.y >= card.y && p.y <= card.y + card.height;
  const out = inCard(aim) ? { x: Math.max(4, card.x / 2), y: card.y + card.height / 2 } : aim;
  const tClose = await now(page);
  await mt.down(2, out.x, out.y);
  await waitClosed(page);
  await page.waitForTimeout(150);
  await mt.up(2);
  const first = await firstMoveAfter(page, tClose);
  expect([first.mx, first.my]).toEqual([0, 1]);
  await page.waitForTimeout(400);
  const after = await since(page, tClose);
  expect(countPressed(after, BTN.ATTACK)).toBe(0);
  expectNoButtons(after, '바깥 누르기로 닫은 뒤');
  // 여는 동안 스틱을 떼면 닫은 뒤 걷지 않는다
  await mt.tap(2, menu.x, menu.y);
  await waitOpen(page);
  await mt.up(1);
  const close = (await page.getByTestId('settings-close').boundingBox())!;
  const tClose2 = await now(page);
  await mt.tap(2, close.x + close.width / 2, close.y + close.height / 2);
  await waitClosed(page);
  await page.waitForTimeout(400);
  const after2 = await since(page, tClose2);
  expect(after2.length).toBeGreaterThan(3);
  for (const f of after2) expect([f.mx, f.my, f.pressed, f.held]).toEqual([0, 0, 0, 0]);
  expect(countPressed(await since(page, t0), BTN.ATTACK)).toBe(0);
  await mt.detach();
  expect(problems).toEqual([]);
  await context.close();
});

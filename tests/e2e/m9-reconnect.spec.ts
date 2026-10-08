// M9: 판 중 접속 끊김 — 재접속 30초, 괴물 이탈 시 일시정지 → 무효, 생존자 이탈 시 사망 처리
import { expect, test, type Page } from '@playwright/test';
import { closeAll, lastSnapshot, startFourPlayerMatch, waitForSnapshots } from './helpers';

const GRACE_MS = 30_000;

async function banners(page: Page): Promise<string[]> {
  return page.evaluate(() => window.__DECOY__?.getBanners() ?? []);
}

test('괴물이 나갔다 30초 안에 돌아오면 판이 멈췄다가 같은 자리로 이어진다', async ({ browser }) => {
  const { players } = await startFourPlayerMatch(browser);
  const monster = players.find((p) => p.role === 'monster')!;
  const runner = players.find((p) => p.role === 'runner')!;
  const url = monster.page.url();
  expect(url).toContain('room=');
  await runner.page.waitForTimeout(500);
  await monster.page.goto('about:blank');
  // 생존자 화면: 일시정지 + "괴물 재접속 대기 n초", 남은 시간이 멈춘다
  await runner.page.waitForFunction(
    () => (window.__DECOY__?.getLastSnapshot()?.world.paused ?? null) !== null,
  );
  const t1 = (await lastSnapshot(runner.page))!.world.timeLeft;
  await runner.page.waitForTimeout(2000);
  const snap = (await lastSnapshot(runner.page))!;
  expect(snap.world.timeLeft).toBe(t1);
  expect(snap.world.paused!).toBeGreaterThan(20);
  expect((await banners(runner.page)).some((b) => b.startsWith('괴물 재접속 대기'))).toBe(true);
  // 일시정지 중에는 생존자 입력을 보내지 않는다 (예측 위치가 서버와 어긋나지 않게)
  const before = await runner.page.evaluate(() => window.__DECOY__?.getLocalState() ?? null);
  await runner.page.keyboard.down('KeyD');
  await runner.page.waitForTimeout(500);
  await runner.page.keyboard.up('KeyD');
  const after = await runner.page.evaluate(() => window.__DECOY__?.getLocalState() ?? null);
  expect(Math.hypot(after!.x - before!.x, after!.y - before!.y)).toBeLessThan(0.01);
  // 정지 중에 누른 능력은 재개 순간 나가지 않는다
  await runner.page.keyboard.press('Space');
  // 괴물 복귀: 같은 탭이라 같은 자리로
  await monster.page.goto(url);
  await waitForSnapshots(monster.page, 3);
  expect(await monster.page.evaluate(() => window.__DECOY__?.you)).toBe(monster.id);
  expect(await monster.page.evaluate(() => window.__DECOY__?.role)).toBe('monster');
  await runner.page.waitForFunction(() => window.__DECOY__?.getLastSnapshot()?.world.paused === null);
  await runner.page.waitForTimeout(1500);
  expect((await lastSnapshot(runner.page))!.world.timeLeft).toBeLessThan(t1 - 1);
  expect((await lastSnapshot(runner.page))!.you.surv!.abilityCd).toBe(0);
  expect((await banners(runner.page)).some((b) => b.startsWith('괴물 재접속 대기'))).toBe(false);
  for (const p of players) expect(p.problems).toEqual([]);
  await closeAll(players);
});

test('괴물이 30초 안에 돌아오지 않으면 판은 무효 (결과 화면)', async ({ browser }) => {
  test.setTimeout(120_000);
  const { players } = await startFourPlayerMatch(browser);
  const monster = players.find((p) => p.role === 'monster')!;
  const survivors = players.filter((p) => p.role !== 'monster');
  await monster.context.close();
  for (const p of survivors) {
    await expect(p.page.getByTestId('result')).toBeVisible({ timeout: GRACE_MS + 10_000 });
    await expect(p.page.getByTestId('result-winner')).toHaveText('무효');
    await expect(p.page.getByTestId('result-ending')).toContainText('무효');
  }
  for (const p of survivors) expect(p.problems).toEqual([]);
  await closeAll(survivors);
});

test('생존자가 나가면 판은 계속되고(팀원 화면에 연결 끊김), 30초 안에 안 돌아오면 사망 처리', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const { players } = await startFourPlayerMatch(browser);
  const runner = players.find((p) => p.role === 'runner')!;
  const guard = players.find((p) => p.role === 'guard')!;
  const others = players.filter((p) => p !== runner);
  await runner.context.close();
  await guard.page.waitForFunction(
    (id) => window.__DECOY__?.getLastSnapshot()?.survivors.find((s) => s.id === id)?.connected === false,
    runner.id,
  );
  const t1 = (await lastSnapshot(guard.page))!.world.timeLeft;
  await guard.page.waitForTimeout(1500);
  expect((await lastSnapshot(guard.page))!.world.timeLeft).toBeLessThan(t1 - 1);
  expect((await lastSnapshot(guard.page))!.world.paused).toBeNull();
  await guard.page.waitForFunction(
    (id) => window.__DECOY__?.getLastSnapshot()?.survivors.find((s) => s.id === id)?.status === 'dead',
    runner.id,
    { timeout: GRACE_MS + 10_000 },
  );
  // 한 명 사망만으로는 끝나지 않는다
  expect(await guard.page.evaluate(() => window.__DECOY__?.phase)).toBe('playing');
  for (const p of others) expect(p.problems).toEqual([]);
  await closeAll(others);
});

// M1: 접속과 이동 동기화
import { expect, test } from '@playwright/test';
import {
  closeAll,
  createRoom,
  joinRoom,
  myId,
  newPlayerPage,
  sendTest,
  startFourPlayerMatch,
  truth,
  waitForSnapshots,
  type Player,
} from './helpers';

const KEYS: Record<string, string> = { monster: 'KeyW', runner: 'KeyS', guard: 'KeyS', scout: 'KeyS' };

async function drawnErrors(
  players: Player[],
  code: string,
): Promise<{ self: number; others: number; count: number }> {
  const t = await truth(players[0]!.page, code);
  const pos = new Map(t.players.map((p) => [p.id, p]));
  const monsterId = t.players.find((q) => q.role === 'monster')!.id;
  let self = 0;
  let others = 0;
  let count = 0;
  for (const p of players) {
    const drawn = await p.page.evaluate(() => window.__DECOY__?.getDrawn() ?? []);
    for (const d of drawn) {
      let real = pos.get(d.kind === 'monster' ? monsterId : d.id);
      if (!real && d.kind === 'survivor') {
        // 괴물 화면의 생존자는 임시 ID: 가장 가까운 실제 생존자와 비교
        real = t.players
          .filter((q) => q.role !== 'monster')
          .sort((a, b) => Math.hypot(a.x - d.x, a.y - d.y) - Math.hypot(b.x - d.x, b.y - d.y))[0];
      }
      if (!real) throw new Error(`알 수 없는 엔티티 ${d.id}`);
      const err = Math.hypot(real.x - d.x, real.y - d.y);
      count += 1;
      if (d.kind === 'self') self = Math.max(self, err);
      else others = Math.max(others, err);
    }
  }
  return { self, others, count };
}

test(
  '4명이 같은 방에 들어가 시작하고, 움직인 뒤 서버 위치와 화면 위치가 맞는다',
  { tag: '@core' },
  async ({ browser }) => {
    const { code, players } = await startFourPlayerMatch(browser);
    const monster = players.find((p) => p.role === 'monster')!;
    await sendTest(monster.page, { kind: 'freeze', target: monster.id, frozen: false });
    await players[0]!.page.waitForTimeout(300);

    // 각자 움직이기
    await Promise.all(players.map((p) => p.page.keyboard.down(KEYS[p.role] ?? 'KeyS')));
    await players[0]!.page.waitForTimeout(700);
    await Promise.all(players.map((p) => p.page.keyboard.up(KEYS[p.role] ?? 'KeyS')));
    await players[0]!.page.waitForTimeout(800);

    const t = await truth(players[0]!.page, code);
    const m = t.players.find((p) => p.role === 'monster')!;
    expect(m.y).toBeLessThan(26); // 괴물이 위로 움직였다 (y=24 벽에서 멈춤)
    for (const s of t.players.filter((p) => p.role !== 'monster')) expect(s.y).toBeGreaterThan(17); // 감옥 문 밖으로

    const err = await drawnErrors(players, code);
    // 생존자 셋은 팀원 셋을 항상 그린다 (괴물은 보일 때만)
    expect(err.count).toBeGreaterThanOrEqual(3 * 3 + 1);
    expect(err.self).toBeLessThan(0.05);
    expect(err.others).toBeLessThan(0.1);
    for (const p of players) expect(p.problems).toEqual([]);
    await closeAll(players);
  },
);

test('lag=200에서도 내 입력이 즉시 반영되고 최종 위치가 수렴한다', async ({ browser }) => {
  const { code, players } = await startFourPlayerMatch(
    browser,
    ['monster', 'runner', 'guard', 'scout'],
    ['', '&lag=200', '', ''],
  );
  const runner = players.find((p) => p.role === 'runner')!;
  await runner.page.waitForFunction(() => (window.__DECOY__?.ping ?? 0) > 150, undefined, {
    timeout: 10_000,
  });
  const ping = await runner.page.evaluate(() => window.__DECOY__?.ping ?? 0);
  expect(ping).toBeGreaterThan(150);
  expect(ping).toBeLessThan(320);

  const before = await runner.page.evaluate(() => window.__DECOY__?.getLocalState()?.y ?? 0);
  await runner.page.keyboard.down('KeyS');
  // 왕복 200ms보다 훨씬 짧은 80ms 안에 내 화면 위치가 움직인다 (예측)
  await runner.page.waitForTimeout(80);
  const early = await runner.page.evaluate(() => window.__DECOY__?.getLocalState()?.y ?? 0);
  expect(early - before).toBeGreaterThan(0.15);
  await runner.page.waitForTimeout(600);
  await runner.page.keyboard.up('KeyS');
  await runner.page.waitForTimeout(1200);

  const t = await truth(runner.page, code);
  const real = t.players.find((p) => p.id === runner.id)!;
  const local = await runner.page.evaluate(() => window.__DECOY__?.getRenderPos());
  expect(Math.hypot(real.x - local!.x, real.y - local!.y)).toBeLessThan(0.05);
  // 팀원 화면에서도 같은 위치로 수렴 (괴물 화면에는 시야 안일 때만, 임시 ID로 그려진다)
  for (const p of players.filter((q) => q !== runner && q.role !== 'monster')) {
    const drawn = await p.page.evaluate(() => window.__DECOY__?.getDrawn() ?? []);
    const d = drawn.find((e) => e.id === runner.id);
    expect(d).toBeTruthy();
    expect(Math.hypot(real.x - d!.x, real.y - d!.y)).toBeLessThan(0.1);
  }
  for (const p of players) expect(p.problems).toEqual([]);
  await closeAll(players);
});

test('한 브라우저에서 탭 4개로 입장하면 서로 다른 4자리, 새로고침하면 같은 자리로 돌아온다', async ({
  browser,
}) => {
  const { context, page, problems } = await newPlayerPage(browser);
  const code = await createRoom(page);
  const pages = [page];
  for (let i = 0; i < 3; i += 1) {
    const p = await context.newPage();
    await joinRoom(p, code);
    pages.push(p);
  }
  const ids = await Promise.all(pages.map((p) => myId(p)));
  expect(new Set(ids).size).toBe(4);
  await expect(page.getByTestId('player-list').locator('.player')).toHaveCount(4);

  // 새로고침 → 같은 자리
  const second = pages[1]!;
  await second.getByTestId('role-guard').click();
  await second.reload();
  await expect(second.getByTestId('room-code')).toHaveText(code);
  expect(await myId(second)).toBe(ids[1]);
  await expect(second.getByTestId('role-guard')).toHaveClass(/mine/);

  // 탭을 닫고 같은 브라우저에서 새로 열면 끊긴 자리로 돌아온다
  const third = pages[2]!;
  const thirdId = ids[2];
  await third.close();
  await page.waitForTimeout(300);
  const reopened = await context.newPage();
  await joinRoom(reopened, code);
  expect(await myId(reopened)).toBe(thirdId);
  expect(problems).toEqual([]);
  await context.close();
});

test('방 코드가 틀리면 안내가 나온다', async ({ browser }) => {
  const { context, page } = await newPlayerPage(browser);
  await page.goto('/?room=ZZZZ&debug=hook');
  await expect(page.getByTestId('lobby-error')).toContainText('찾을 수 없습니다');
  // 링크로 들어가려던 방이 없으면 서버가 잠들었다 깨어났을 수 있다고 알려 준다
  await expect(page.getByTestId('lobby-error')).toContainText('새 방을 만들어');
  // 직접 입력한 코드가 틀린 것은 그냥 "찾을 수 없습니다"
  await page.getByTestId('room-code-input').fill('ZZZY');
  await page.getByTestId('join-room').click();
  await expect(page.getByTestId('lobby-error')).toHaveText('방 ZZZY을(를) 찾을 수 없습니다');
  await context.close();
  void waitForSnapshots;
});

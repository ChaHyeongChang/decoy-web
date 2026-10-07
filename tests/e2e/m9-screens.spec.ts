// M9: 최종 보고용 스크린샷 — 로비(역할 카드) · 결과 화면 (판 화면 4장은 m7-hud.spec.ts)
import { expect, test } from '@playwright/test';
import {
  closeAll,
  createRoom,
  joinRoom,
  newPlayerPage,
  pickRoleAndReady,
  sendTest,
  type Player,
} from './helpers';

test('로비와 결과 화면 스크린샷', async ({ browser }) => {
  const host = await newPlayerPage(browser);
  const code = await createRoom(host.page);
  const players: Player[] = [{ ...host, role: 'monster', id: '' }];
  for (const role of ['runner', 'guard', 'scout'] as const) {
    const p = await newPlayerPage(browser);
    await joinRoom(p.page, code);
    players.push({ ...p, role, id: '' });
  }
  for (const p of players.slice(1)) await pickRoleAndReady(p.page, p.role);
  await host.page.getByTestId('role-monster').click();
  await expect(host.page.getByTestId('player-list')).toContainText('스카우트');
  await host.page.screenshot({ path: 'artifacts/screens/lobby.png' });
  await host.page.getByTestId('ready-button').click();
  await expect(host.page.getByTestId('start-button')).toBeEnabled();
  await host.page.getByTestId('start-button').click();
  const runner = players[1]!;
  await runner.page.waitForFunction(() => (window.__DECOY__?.snapCount ?? 0) > 3);
  // 시간 초과로 끝낸다 (탈출 0명 → 괴물 승리, END_TIMEOUT)
  await sendTest(runner.page, { kind: 'setTime', timeLeft: 0.1 });
  await expect(runner.page.getByTestId('result')).toBeVisible({ timeout: 10_000 });
  await expect(runner.page.getByTestId('result-winner')).toHaveText('괴물 승리');
  await runner.page.screenshot({ path: 'artifacts/screens/result.png' });
  for (const p of players) expect(p.problems).toEqual([]);
  await closeAll(players);
});

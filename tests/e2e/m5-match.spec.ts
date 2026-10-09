// M5: 거점 → 탈출구 → 탈출 → 결과 화면 → 다시 하기 (테스트 훅으로 시간을 줄여 브라우저에서 끝까지)
import { expect, test } from '@playwright/test';
import { closeAll, lastSnapshot, sendTest, startFourPlayerMatch } from './helpers';

test('거점 점령 → 탈출구 개방 → 2명 탈출 → 결과 화면 → 다시 하기', { tag: '@core' }, async ({ browser }) => {
  const { players } = await startFourPlayerMatch(browser);
  const [monster, runner, guard, scout] = players as [
    (typeof players)[0],
    (typeof players)[0],
    (typeof players)[0],
    (typeof players)[0],
  ];
  const host = monster.page;
  await sendTest(host, { kind: 'teleport', target: monster.id, x: 45, y: 28 });
  await sendTest(host, { kind: 'teleport', target: runner.id, x: 8, y: 16 });
  await sendTest(host, { kind: 'teleport', target: guard.id, x: 40, y: 16 });
  await sendTest(host, { kind: 'setPoint', point: 'A', progress: 0.99 });
  await sendTest(host, { kind: 'setPoint', point: 'B', progress: 0.99 });
  await runner.page.waitForFunction(() =>
    (window.__DECOY__?.getLastSnapshot()?.world.exits ?? []).every((e) => e.state === 'active'),
  );
  // 괴물 화면에도 거점 완료가 보인다 (탈출구 진행도는 없다)
  const ms = await lastSnapshot(monster.page);
  expect(ms!.world.points.every((p) => p.state === 'done')).toBe(true);

  await sendTest(host, { kind: 'teleport', target: runner.id, x: 23.5, y: 2.5 });
  await sendTest(host, { kind: 'teleport', target: guard.id, x: 24.5, y: 2.5 });
  await runner.page.waitForFunction(
    () => window.__DECOY__?.getLastSnapshot()?.world.exits.find((e) => e.id === 'N')?.state === 'open',
    undefined,
    { timeout: 10_000 },
  );
  await Promise.all([runner.page.keyboard.down('KeyW'), guard.page.keyboard.down('KeyW')]);
  await runner.page.waitForFunction(
    () => window.__DECOY__?.getLastSnapshot()?.you.surv?.status === 'escaped',
  );
  await guard.page.waitForFunction(() => window.__DECOY__?.getLastSnapshot()?.you.surv?.status === 'escaped');
  await Promise.all([runner.page.keyboard.up('KeyW'), guard.page.keyboard.up('KeyW')]);
  // 남은 스카우트는 최후의 30초를 받는다
  await scout.page.waitForFunction(() => (window.__DECOY__?.getLastSnapshot()?.world.grace ?? null) !== null);
  await sendTest(host, { kind: 'setSurvivor', target: scout.id, status: 'dead' });

  for (const p of players) {
    await expect(p.page.getByTestId('result')).toBeVisible();
    await expect(p.page.getByTestId('result-winner')).toHaveText('생존자 승리');
  }
  await expect(runner.page.getByTestId('result-grade')).toContainText('탈출 성공');
  await expect(monster.page.getByTestId('result-grade')).toHaveCount(0);
  await expect(runner.page.getByTestId('result-ending')).toContainText('두 사람이 빠져나갔다');

  await host.getByTestId('rematch').click();
  for (const p of players) {
    await expect(p.page.getByTestId('room-code')).toBeVisible();
    await expect(p.page.getByTestId(`role-${p.role}`)).toHaveClass(/mine/);
  }
  for (const p of players) expect(p.problems).toEqual([]);
  await closeAll(players);
});

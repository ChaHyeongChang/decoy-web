// M4: 브라우저에서 공격 → 부상 → 수감 (클라이언트가 결과를 그리고 콘솔 에러가 없다)
import { expect, test } from '@playwright/test';
import { closeAll, lastSnapshot, sendTest, startFourPlayerMatch } from './helpers';

test('괴물이 좌클릭으로 공격하면 생존자가 부상, 두 번째에 수감된다', async ({ browser }) => {
  const { players } = await startFourPlayerMatch(browser);
  const monster = players.find((p) => p.role === 'monster')!;
  const runner = players.find((p) => p.role === 'runner')!;
  for (let hit = 1; hit <= 2; hit += 1) {
    await sendTest(monster.page, { kind: 'teleport', target: runner.id, x: 31, y: 21 });
    await sendTest(monster.page, { kind: 'teleport', target: monster.id, x: 30, y: 21, face: 0 });
    await monster.page.waitForTimeout(400);
    const c = await monster.page.evaluate(() => window.__DECOY__?.tileToClient(33, 21) ?? null);
    await monster.page.mouse.move(c!.x, c!.y);
    await monster.page.waitForTimeout(200);
    await monster.page.mouse.down({ button: 'left' });
    await monster.page.mouse.up({ button: 'left' });
    // 괴물 화면: 준비 중
    await monster.page.waitForFunction(() => (window.__DECOY__?.getLastSnapshot()?.you.mon?.windup ?? 0) > 0);
    if (hit === 1) {
      await runner.page.waitForFunction(() => window.__DECOY__?.getLastSnapshot()?.you.surv?.hp === 1);
    } else {
      await runner.page.waitForFunction(
        () => window.__DECOY__?.getLastSnapshot()?.you.surv?.status === 'imprisoned',
      );
    }
    await monster.page.waitForTimeout(1700);
  }
  const snap = await lastSnapshot(runner.page);
  expect(snap!.you.surv!.imprisonCount).toBe(1);
  // 팀원 화면에도 수감 상태가 보인다
  const guard = players.find((p) => p.role === 'guard')!;
  const g = await lastSnapshot(guard.page);
  expect(g!.survivors.find((s) => s.id === runner.id)!.status).toBe('imprisoned');
  // 괴물 화면 상태 목록에 수감 1명 (익명)
  const m = await lastSnapshot(monster.page);
  expect(m!.world.statusList!.filter((x) => x.state === 'imprisoned')).toHaveLength(1);
  for (const p of players) expect(p.problems).toEqual([]);
  await closeAll(players);
});

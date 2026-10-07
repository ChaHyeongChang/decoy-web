// M6: 능력 — 포효 시 생존자 화면에 괴물 마커 1초, 탐지 · 밀치기 · 질주 · 정체 노출
import { expect, test } from '@playwright/test';
import { closeAll, lastSnapshot, sendTest, startFourPlayerMatch } from './helpers';

test('포효하면 생존자 화면에 괴물 위치 마커가 1초 뜨고, 괴물 화면에 생존자 핑이 뜬다', async ({
  browser,
}) => {
  const { players } = await startFourPlayerMatch(browser);
  const monster = players.find((p) => p.role === 'monster')!;
  const runner = players.find((p) => p.role === 'runner')!;
  // 괴물은 생존자들 시야 밖, 포효 반경(10) 안
  await sendTest(monster.page, { kind: 'teleport', target: monster.id, x: 33, y: 16, face: 0 });
  await monster.page.waitForTimeout(500);
  expect((await lastSnapshot(runner.page))!.monster).toBeNull();
  await monster.page.keyboard.press('KeyQ');
  for (const p of players.filter((q) => q.role !== 'monster')) {
    await p.page.waitForFunction(() =>
      (window.__DECOY__?.getDrawn() ?? []).some((d) => d.tag === 'roarSelf'),
    );
    const mark = (await p.page.evaluate(() => window.__DECOY__?.getDrawn() ?? [])).find(
      (d) => d.tag === 'roarSelf',
    )!;
    expect(Math.hypot(mark.x - 33, mark.y - 16)).toBeLessThan(0.05);
  }
  // 괴물 화면: 감옥 안 생존자 셋(반경 10 안)의 핑
  await monster.page.waitForFunction(
    () => (window.__DECOY__?.getDrawn() ?? []).filter((d) => d.tag === 'roarPing').length === 3,
  );
  // 1초 뒤 사라진다
  await runner.page.waitForTimeout(1300);
  expect(
    (await runner.page.evaluate(() => window.__DECOY__?.getDrawn() ?? [])).some((d) => d.tag === 'roarSelf'),
  ).toBe(false);
  expect((await lastSnapshot(monster.page))!.you.mon!.roarCd).toBeGreaterThan(25);
  for (const p of players) expect(p.problems).toEqual([]);
  await closeAll(players);
});

test('스카우트 탐지 · 가드 밀치기 · 러너 질주 · 능력 사용 시 괴물에게 역할 노출', async ({ browser }) => {
  const { players } = await startFourPlayerMatch(browser);
  const monster = players.find((p) => p.role === 'monster')!;
  const runner = players.find((p) => p.role === 'runner')!;
  const guard = players.find((p) => p.role === 'guard')!;
  const scout = players.find((p) => p.role === 'scout')!;
  await sendTest(monster.page, { kind: 'teleport', target: monster.id, x: 40, y: 16, face: Math.PI });
  await monster.page.waitForTimeout(400);
  // 탐지: 팀 전원 화면에 초록 다이아
  await scout.page.keyboard.press('Space');
  for (const p of [runner, guard, scout]) {
    await p.page.waitForFunction(() => (window.__DECOY__?.getDrawn() ?? []).some((d) => d.tag === 'track'));
  }
  // 밀치기: 괴물 옆으로 가서
  await sendTest(monster.page, { kind: 'teleport', target: guard.id, x: 38.5, y: 16 });
  await guard.page.waitForTimeout(300);
  await guard.page.keyboard.press('Space');
  await monster.page.waitForFunction(() => (window.__DECOY__?.getLastSnapshot()?.you.move.stun ?? 0) > 0);
  // 질주 + 정체 노출: 괴물 앞에서 능력을 쓰면 1초 동안 역할 색
  await sendTest(monster.page, { kind: 'teleport', target: runner.id, x: 37.5, y: 16.5 });
  await runner.page.waitForTimeout(300);
  await runner.page.keyboard.press('Space');
  await runner.page.waitForFunction(
    () => (window.__DECOY__?.getLastSnapshot()?.you.surv?.abilityActive ?? 0) > 0,
  );
  await monster.page.waitForFunction(() =>
    (window.__DECOY__?.getLastSnapshot()?.survivors ?? []).some((s) => s.role === 'runner'),
  );
  await monster.page.waitForTimeout(1300);
  const after = await lastSnapshot(monster.page);
  expect(after!.survivors.every((s) => s.role === null)).toBe(true);
  for (const p of players) expect(p.problems).toEqual([]);
  await closeAll(players);
});

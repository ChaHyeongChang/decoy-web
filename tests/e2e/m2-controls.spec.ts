// M2: 괴물 조준 각도가 네 클라이언트에서 같다 (서로 보이게 배치한 뒤 비교)
import { expect, test } from '@playwright/test';
import { closeAll, sendTest, startFourPlayerMatch, truth } from './helpers';

function angDiff(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d);
}

test('괴물 조준 각도가 네 클라이언트에서 같다', async ({ browser }) => {
  const { code, players } = await startFourPlayerMatch(browser);
  const monster = players.find((p) => p.role === 'monster')!;
  // 괴물을 감옥 문 앞(생존자 시야 안)으로 옮기고 대기 해제
  await sendTest(monster.page, { kind: 'teleport', target: monster.id, x: 24, y: 21, face: 0 });
  await monster.page.waitForTimeout(300);
  for (const target of [
    { x: 30, y: 21 },
    { x: 24, y: 27 },
    { x: 18, y: 25 },
  ]) {
    const client = await monster.page.evaluate(
      (t) => window.__DECOY__?.tileToClient(t.x, t.y) ?? null,
      target,
    );
    expect(client).not.toBeNull();
    await monster.page.mouse.move(client!.x, client!.y);
    // 회전 시간 + 보간 100ms + 스냅샷 두 번
    await monster.page.waitForTimeout(700);
    const t = await truth(monster.page, code);
    const expected = Math.atan2(target.y - 21, target.x - 24);
    expect(angDiff(t.monster!.aim, expected)).toBeLessThan((2 * Math.PI) / 180);
    for (const p of players) {
      const drawn = await p.page.evaluate(() => window.__DECOY__?.getDrawn() ?? []);
      const m = drawn.find((d) => d.kind === 'monster' || (d.kind === 'self' && p.role === 'monster'));
      expect(m, `${p.role} 화면에 괴물이 없다`).toBeTruthy();
      expect(angDiff(m!.face, t.monster!.aim), `${p.role} 화면 조준 각도`).toBeLessThan((2 * Math.PI) / 180);
    }
  }
  for (const p of players) expect(p.problems).toEqual([]);
  await closeAll(players);
});

test('우클릭으로 시야 모드가 바뀌고 0.4초에 걸쳐 모양이 바뀐다', async ({ browser }) => {
  const { code, players } = await startFourPlayerMatch(browser);
  const monster = players.find((p) => p.role === 'monster')!;
  await sendTest(monster.page, { kind: 'teleport', target: monster.id, x: 24, y: 21, face: 0 });
  await monster.page.waitForTimeout(300);
  const c = await monster.page.evaluate(() => window.__DECOY__?.tileToClient(30, 21) ?? null);
  await monster.page.mouse.move(c!.x, c!.y);
  await monster.page.mouse.down({ button: 'right' });
  await monster.page.mouse.up({ button: 'right' });
  await monster.page.waitForTimeout(150);
  const mid = await truth(monster.page, code);
  expect(mid.monster!.mode).toBe('hunt');
  expect(mid.monster!.blend).toBeGreaterThan(0);
  expect(mid.monster!.blend).toBeLessThan(1);
  await monster.page.waitForTimeout(600);
  const done = await truth(monster.page, code);
  expect(done.monster!.blend).toBe(1);
  const snap = await monster.page.evaluate(() => window.__DECOY__?.getLastSnapshot()?.you.mon ?? null);
  expect(snap!.mode).toBe('hunt');
  await closeAll(players);
});

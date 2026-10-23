// M2: 괴물 조준 각도가 네 클라이언트에서 같다 (서로 보이게 배치한 뒤 비교)
// 따라가는 카메라: 타일 자리로 마우스를 옮겨 조준을 재는 시험이라 맵 전체 고정 화면(?cam=1). 확대 화면 조준은 camera.spec.ts
import { expect, test } from '@playwright/test';
import { CAM1, closeAll, sendTest, startFourPlayerMatch, truth, truthLogSize, truthSince } from './helpers';

function angDiff(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d);
}

test('괴물 조준 각도가 네 클라이언트에서 같다', async ({ browser }) => {
  const { code, players } = await startFourPlayerMatch(browser, undefined, [CAM1, CAM1, CAM1, CAM1]);
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
  const { code, players } = await startFourPlayerMatch(browser, undefined, [CAM1, CAM1, CAM1, CAM1]);
  const monster = players.find((p) => p.role === 'monster')!;
  await sendTest(monster.page, { kind: 'teleport', target: monster.id, x: 24, y: 21, face: 0 });
  await monster.page.waitForTimeout(300);
  const c = await monster.page.evaluate(() => window.__DECOY__?.tileToClient(30, 21) ?? null);
  await monster.page.mouse.move(c!.x, c!.y);
  const offset = truthLogSize();
  await monster.page.mouse.down({ button: 'right' });
  await monster.page.mouse.up({ button: 'right' });
  // 서버 정답 기록(틱마다)으로 전환을 본다: 고정 대기 뒤 한 번 읽으면 느린 러너(2코어, 4탭)에서는 읽는 사이에
  // 0.4초 전환이 이미 끝나 있다(M11 전체 검사에서 blend 1로 실패)
  const hunt = (): { tick: number; blend: number }[] =>
    truthSince(offset, code)
      .filter((f) => f.monster?.mode === 'hunt')
      .map((f) => ({ tick: f.tick, blend: f.monster!.blend }));
  await expect
    .poll(() => hunt().some((m) => m.blend === 1), { timeout: 15_000, intervals: [100] })
    .toBe(true);
  const ticks = hunt();
  const firstFull = ticks.findIndex((m) => m.blend === 1);
  const between = ticks.slice(0, firstFull);
  // 0.4초 = 30Hz 12틱: 그 사이(0 < blend < 1) 틱이 11개쯤, 이어지는 틱이고 blend가 늘기만 한다
  expect(between.length, '전환 중 틱 수').toBeGreaterThanOrEqual(10);
  expect(between.length, '전환 중 틱 수').toBeLessThanOrEqual(13);
  for (let i = 0; i < between.length; i += 1) {
    expect(between[i]!.blend).toBeGreaterThan(0);
    expect(between[i]!.blend).toBeLessThan(1);
    if (i > 0) {
      expect(between[i]!.tick).toBe(between[i - 1]!.tick + 1);
      expect(between[i]!.blend).toBeGreaterThan(between[i - 1]!.blend);
    }
  }
  const done = await truth(monster.page, code);
  expect(done.monster!.mode).toBe('hunt');
  expect(done.monster!.blend).toBe(1);
  const snap = await monster.page.evaluate(() => window.__DECOY__?.getLastSnapshot()?.you.mon ?? null);
  expect(snap!.mode).toBe('hunt');
  await closeAll(players);
});

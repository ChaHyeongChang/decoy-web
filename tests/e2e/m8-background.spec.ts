// M8: 브라우저 탭이 백그라운드(숨김 · 멈춤)여도 연결과 판정이 유지되고, 돌아오면 최신 상태로 그린다
import { expect, test, type Page } from '@playwright/test';
import { closeAll, lastSnapshot, sendTest, startFourPlayerMatch, truth } from './helpers';

const FREEZE_MS = 10_000;

/** 탭을 숨김으로 보이게 한다 (헤드리스는 늘 보이는 상태라 visibilitychange를 직접 낸다) */
async function setHidden(page: Page, hidden: boolean): Promise<void> {
  await page.evaluate((h) => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => (h ? 'hidden' : 'visible'),
    });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
}

test('백그라운드 탭이 10초 멈췄다 돌아와도 같은 자리로 연결이 유지되고, 그동안의 서버 판정이 반영된다', async ({
  browser,
}) => {
  const { code, players } = await startFourPlayerMatch(browser);
  const monster = players.find((p) => p.role === 'monster')!;
  const runner = players.find((p) => p.role === 'runner')!;
  const guard = players.find((p) => p.role === 'guard')!;
  const scout = players.find((p) => p.role === 'scout')!;
  await sendTest(scout.page, { kind: 'teleport', target: runner.id, x: 31, y: 21 });
  await runner.page.waitForTimeout(500);
  const before = await runner.page.evaluate(() => ({
    you: window.__DECOY__?.you,
    room: window.__DECOY__?.room,
    snaps: window.__DECOY__?.snapCount ?? 0,
  }));

  // 러너 탭: 숨김 → 멈춤. CDP 동결은 타이머 · 렌더를 멈추지만 메시지 처리는 계속되므로,
  // 메인 스레드를 10초 붙잡아 메시지 처리까지 멈춘다 (오래 잠든 백그라운드 탭과 같다)
  await setHidden(runner.page, true);
  const cdp = await runner.context.newCDPSession(runner.page);
  await cdp.send('Page.setWebLifecycleState', { state: 'frozen' });
  const frozenAt = Date.now();
  const stall = runner.page.evaluate((ms) => {
    const t = performance.now();
    while (performance.now() - t < ms) {
      // 바쁜 대기
    }
  }, FREEZE_MS);

  // 그동안 서버는 계속 판정한다: 괴물이 러너를 때리고, 가드가 다른 곳으로 옮겨진다
  await sendTest(scout.page, { kind: 'teleport', target: monster.id, x: 30, y: 21, face: 0 });
  await monster.page.waitForTimeout(800);
  const c = await monster.page.evaluate(() => window.__DECOY__?.tileToClient(33, 21) ?? null);
  await monster.page.mouse.move(c!.x, c!.y);
  await monster.page.waitForTimeout(200);
  await monster.page.mouse.down({ button: 'left' });
  await monster.page.mouse.up({ button: 'left' });
  await sendTest(scout.page, { kind: 'teleport', target: guard.id, x: 12, y: 26 });
  // 괴물 화면(익명 상태 목록)에 부상 1명: 서버가 멈춘 탭과 상관없이 판정했다
  await monster.page.waitForFunction(() =>
    (window.__DECOY__?.getLastSnapshot()?.world.statusList ?? []).some((x) => x.state === 'injured'),
  );
  const remaining = FREEZE_MS - (Date.now() - frozenAt);
  if (remaining > 0) await monster.page.waitForTimeout(remaining);

  // 돌아온다
  await stall;
  await cdp.send('Page.setWebLifecycleState', { state: 'active' });
  await setHidden(runner.page, false);

  // 2초 안에 최신 상태: 서버 틱을 따라잡고, 맞은 결과(체력 1)와 가드의 새 위치가 보인다
  await runner.page.waitForFunction(() => window.__DECOY__?.getLastSnapshot()?.you.surv?.hp === 1, null, {
    timeout: 5_000,
  });
  const t = await truth(runner.page, code);
  const snap = await lastSnapshot(runner.page);
  expect(t.tick - snap!.tick).toBeLessThan(30);
  await runner.page.waitForFunction(
    (gid) => {
      const g = (window.__DECOY__?.getDrawn() ?? []).find((d) => d.id === gid);
      return g !== undefined && Math.hypot(g.x - 12, g.y - 26) < 0.1;
    },
    guard.id,
    { timeout: 5_000 },
  );
  // 같은 자리 그대로 (재접속 없이), 스냅샷이 계속 들어온다
  const after = await runner.page.evaluate(() => ({
    you: window.__DECOY__?.you,
    room: window.__DECOY__?.room,
    snaps: window.__DECOY__?.snapCount ?? 0,
  }));
  expect(after.you).toBe(before.you);
  expect(after.room).toBe(before.room);
  expect(after.snaps).toBeGreaterThan(before.snaps);
  // 내 위치도 서버와 맞는다 (입력이 끊긴 동안 제자리)
  const me = t.players.find((p) => p.id === runner.id)!;
  await runner.page.waitForFunction(
    ([x, y]) => {
      const p = window.__DECOY__?.getRenderPos();
      return p !== null && p !== undefined && Math.hypot(p.x - x!, p.y - y!) < 0.05;
    },
    [me.x, me.y],
    { timeout: 5_000 },
  );
  // 멈춘 동안 쌓인 지난 일(타격음 · 플래시)은 뒤늦게 울리지 않는다
  const fx = await runner.page.evaluate(() => window.__DECOY__?.getEffects() ?? {});
  expect(fx.hitFlash ?? 0).toBe(0);
  expect(await runner.page.evaluate(() => window.__DECOY__?.getSounds() ?? [])).not.toContain('hit');
  // 다시 움직일 수 있다
  await runner.page.keyboard.down('KeyD');
  await runner.page.waitForTimeout(600);
  await runner.page.keyboard.up('KeyD');
  await runner.page.waitForTimeout(300);
  const moved = (await truth(runner.page, code)).players.find((p) => p.id === runner.id)!;
  expect(moved.x - me.x).toBeGreaterThan(1);
  for (const p of players) expect(p.problems).toEqual([]);
  await closeAll(players);
});

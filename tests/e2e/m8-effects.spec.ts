// M8: 연출과 소리 — VISUAL_SPEC 6.2 연출이 실제로 그려지고, 효과음이 맞는 사람에게 울리고, 콘솔 에러가 없다
import { expect, test, type Page } from '@playwright/test';
import { aimMonsterAt, closeAll, lastSnapshot, sendTest, startFourPlayerMatch } from './helpers';

async function effects(page: Page): Promise<Record<string, number | boolean>> {
  return page.evaluate(() => window.__DECOY__?.getEffects() ?? {});
}

async function sounds(page: Page): Promise<string[]> {
  return page.evaluate(() => window.__DECOY__?.getSounds() ?? []);
}

async function waitEffect(page: Page, key: string): Promise<void> {
  try {
    await page.waitForFunction(
      (k) => {
        const v = window.__DECOY__?.getEffects()[k];
        return v === true || (typeof v === 'number' && v > 0);
      },
      key,
      { timeout: 8_000 },
    );
  } catch (e) {
    const st = await page.evaluate(() => ({
      fx: window.__DECOY__?.getEffects(),
      mon: window.__DECOY__?.getLastSnapshot()?.you.mon,
      surv: window.__DECOY__?.getLastSnapshot()?.you.surv,
      move: window.__DECOY__?.getLocalState(),
      monster: window.__DECOY__?.getLastSnapshot()?.monster,
    }));
    throw new Error(`연출 ${key}가 나오지 않음: ${JSON.stringify(st)} / ${String(e)}`);
  }
}

test('공격 준비는 누른 순간 보이고, 피격 플래시 · 수감 페이드 · 기절 별 · 채도 감소 · 돌진 잔상 · 효과음이 나온다', async ({
  browser,
}) => {
  // 괴물만 왕복 400ms 지연: 서버 확인 전에 내 화면에 공격 범위가 먼저 떠야 한다
  const { players } = await startFourPlayerMatch(
    browser,
    ['monster', 'runner', 'guard', 'scout'],
    ['&lag=400', '', '', ''],
  );
  const monster = players.find((p) => p.role === 'monster')!;
  const runner = players.find((p) => p.role === 'runner')!;
  const guard = players.find((p) => p.role === 'guard')!;
  const scout = players.find((p) => p.role === 'scout')!;
  // 첫 사용자 입력에서 오디오가 열린다 (괴물 화면 클릭은 공격이 되므로 키로)
  for (const p of players) {
    await p.page.keyboard.press('KeyX');
    await p.page.waitForFunction(() => window.__DECOY__?.audioReady === true);
  }

  // 1) 공격: 즉시 피드백 → 피격 플래시 + 소리, 두 번째에 수감 페이드
  for (let hit = 1; hit <= 2; hit += 1) {
    await sendTest(scout.page, { kind: 'teleport', target: runner.id, x: 31, y: 21 });
    await sendTest(scout.page, { kind: 'teleport', target: monster.id, x: 30, y: 21, face: 0 });
    // 조준을 먼저 러너 쪽(동쪽)으로 돌려 두고 서버 조준까지 확인한 뒤 그 자리에서 누른다 (helpers.aimMonsterAt).
    // 따라가는 카메라: 순간 이동 뒤 창이 따라가는 동안 화면 좌표를 재면 커서가 엉뚱한 타일을 가리켜 조준이 돌다가 준비가
    // 시작된다 — 느린 러너(CI 전체 검사, CPU 6배 느림으로 재현)에서 준비가 북동(−0.89rad)으로 시작해 러너를 빗나갔다
    await aimMonsterAt(monster.page, 33, 21);
    await monster.page.mouse.down({ button: 'left' });
    await monster.page.mouse.up({ button: 'left' });
    // 누른 직후(서버 확인 전, 왕복 400ms): 내 화면에 공격 범위 + 준비 소리
    const t0 = Date.now();
    await waitEffect(monster.page, 'attackRange');
    const early = Date.now() - t0;
    const snapWindup = (await lastSnapshot(monster.page))!.you.mon!.windup;
    if (hit === 1) {
      expect(early).toBeLessThan(250);
      expect(snapWindup).toBe(0);
    }
    expect(await sounds(monster.page)).toContain('windup');
    if (hit === 1) {
      await waitEffect(runner.page, 'hitFlash');
      expect(await sounds(runner.page)).toContain('hit');
      // 팀원도 작게 듣는다
      await guard.page.waitForFunction(() => (window.__DECOY__?.getSounds() ?? []).includes('hit'));
      // 0.2초 뒤 사라진다
      await runner.page.waitForTimeout(400);
      expect((await effects(runner.page)).hitFlash).toBe(0);
    } else {
      await waitEffect(runner.page, 'fade');
      await runner.page.waitForTimeout(700);
      expect((await effects(runner.page)).fade).toBe(0);
      expect((await lastSnapshot(runner.page))!.you.surv!.status).toBe('imprisoned');
    }
    // 괴물 쪽도 타격음
    await monster.page.waitForFunction(
      () => (window.__DECOY__?.getSounds() ?? []).filter((s) => s === 'hit').length >= 1,
    );
    await monster.page.waitForTimeout(1600);
  }

  // 2) 가드 밀치기 → 괴물 기절: 양쪽 화면 기절 별, 괴물 화면 채도 감소
  await sendTest(scout.page, { kind: 'teleport', target: monster.id, x: 40, y: 16, face: Math.PI });
  await sendTest(scout.page, { kind: 'teleport', target: guard.id, x: 38.5, y: 16 });
  await guard.page.waitForTimeout(700);
  await guard.page.keyboard.press('Space');
  await waitEffect(monster.page, 'desaturate');
  await waitEffect(monster.page, 'stunStars');
  await waitEffect(guard.page, 'stunStars');
  await monster.page.waitForTimeout(2200);
  const after = await effects(monster.page);
  expect(after.desaturate).toBe(false);
  expect(after.stunStars).toBe(false);

  // 3) 돌진 잔상: 괴물 화면 + 괴물이 보이는 생존자 화면
  await sendTest(scout.page, { kind: 'teleport', target: monster.id, x: 36, y: 13, face: 0 });
  await sendTest(scout.page, { kind: 'teleport', target: guard.id, x: 38, y: 15.5 });
  // 돌진 방향(동쪽)도 창이 자리 잡은 뒤 조준하고 서버 조준까지 확인한다 (위 공격과 같은 까닭)
  await aimMonsterAt(monster.page, 42, 13);
  await monster.page.keyboard.press('Shift');
  await waitEffect(monster.page, 'dashGhosts');
  await waitEffect(guard.page, 'dashGhosts');

  // 4) 포효: 괴물과 생존자 모두 포효 소리
  await monster.page.waitForTimeout(500);
  await monster.page.keyboard.press('KeyQ');
  await monster.page.waitForFunction(() => (window.__DECOY__?.getSounds() ?? []).includes('roar'));
  for (const p of [runner, guard, scout])
    await p.page.waitForFunction(() => (window.__DECOY__?.getSounds() ?? []).includes('roar'));

  for (const p of players) expect(p.problems).toEqual([]);
  await closeAll(players);
});

test('점령 시작은 괴물에게만, 점령 완료 · 문 열림은 양쪽에 소리가 난다', async ({ browser }) => {
  const { players } = await startFourPlayerMatch(browser);
  const monster = players.find((p) => p.role === 'monster')!;
  const runner = players.find((p) => p.role === 'runner')!;
  const guard = players.find((p) => p.role === 'guard')!;
  for (const p of players) await p.page.keyboard.press('KeyX');
  // 두 거점을 거의 다 채워 두고 한 명씩 넣는다
  await sendTest(runner.page, { kind: 'setPoint', point: 'A', progress: 0.96 });
  await sendTest(runner.page, { kind: 'setPoint', point: 'B', progress: 0.97 });
  await sendTest(runner.page, { kind: 'teleport', target: runner.id, x: 8, y: 16 });
  await sendTest(runner.page, { kind: 'teleport', target: guard.id, x: 40, y: 16 });
  await monster.page.waitForFunction(() => (window.__DECOY__?.getSounds() ?? []).includes('captureStart'));
  for (const p of [monster, runner])
    await p.page.waitForFunction(() => (window.__DECOY__?.getSounds() ?? []).includes('captureDone'), null, {
      timeout: 10_000,
    });
  expect(await sounds(runner.page)).not.toContain('captureStart');
  // 두 거점이 모두 끝나 탈출구가 켜질 때까지
  await runner.page.waitForFunction(
    () => (window.__DECOY__?.getLastSnapshot()?.world.exits ?? []).every((e) => e.state === 'active'),
    null,
    { timeout: 10_000 },
  );
  // 탈출구: 두 명이 북쪽 문 앞에 3초
  await sendTest(runner.page, { kind: 'teleport', target: runner.id, x: 23.6, y: 1.6 });
  await sendTest(runner.page, { kind: 'teleport', target: guard.id, x: 24.4, y: 1.6 });
  for (const p of [monster, runner, guard])
    await p.page.waitForFunction(() => (window.__DECOY__?.getSounds() ?? []).includes('doorOpen'), null, {
      timeout: 10_000,
    });
  for (const p of players) expect(p.problems).toEqual([]);
  await closeAll(players);
});

// M7: 역할별 HUD · 미니맵 · 배너 · 안내. 역할별 스크린샷 4장을 artifacts/에 저장한다
import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { aimMonsterAt, closeAll, lastSnapshot, sendTest, startFourPlayerMatch, type Player } from './helpers';

const OUT = 'artifacts/screens';

async function minimapSubsetOfMain(p: Player): Promise<void> {
  const main = await p.page.evaluate(() => window.__DECOY__?.getDrawn() ?? []);
  const mini = await p.page.evaluate(() => window.__DECOY__?.getDrawnMinimap() ?? []);
  expect(mini.length).toBe(main.length);
  for (const m of mini) {
    expect(main.some((d) => d.id === m.id && Math.abs(d.x - m.x) < 1e-6 && Math.abs(d.y - m.y) < 1e-6)).toBe(
      true,
    );
  }
}

test('첫 판 조작 안내 · 시작 문구 · Tab 점수판', async ({ browser }) => {
  const { players } = await startFourPlayerMatch(browser);
  const runner = players.find((p) => p.role === 'runner')!;
  const monster = players.find((p) => p.role === 'monster')!;
  // 시작 문구 (생존자: 기록자의 벽글씨, 괴물: 명령)
  await runner.page.waitForFunction(() =>
    (window.__DECOY__?.getBanners() ?? []).some((t) => t.includes('비밀번호는 두 장소')),
  );
  await monster.page.waitForFunction(() =>
    (window.__DECOY__?.getBanners() ?? []).some((t) => t.includes('다시 가둬라')),
  );
  // Tab 점수판은 누르고 있는 동안만
  await runner.page.keyboard.down('Tab');
  await runner.page.waitForTimeout(150);
  await runner.page.screenshot({ path: 'artifacts/screens/tab-runner.png' });
  await runner.page.keyboard.up('Tab');
  for (const p of players) expect(p.problems).toEqual([]);
  await closeAll(players);
});

test('역할별 스크린샷 4장 + 미니맵도 같은 정보 규칙', async ({ browser }) => {
  mkdirSync(OUT, { recursive: true });
  const { players } = await startFourPlayerMatch(browser);
  for (const p of players) await p.page.setViewportSize({ width: 1920, height: 1080 });
  const monster = players.find((p) => p.role === 'monster')!;
  const runner = players.find((p) => p.role === 'runner')!;
  const guard = players.find((p) => p.role === 'guard')!;
  const scout = players.find((p) => p.role === 'scout')!;
  const host = monster.page;
  // 장면: 러너는 거점 A를 점령 중, 가드는 감옥 앞에서 괴물에게 발각, 스카우트는 B 쪽, 괴물은 추적 모드로 감옥 쪽을 봄
  await sendTest(host, { kind: 'teleport', target: runner.id, x: 8, y: 16.5 });
  await sendTest(host, { kind: 'teleport', target: guard.id, x: 24, y: 20 });
  await sendTest(host, { kind: 'teleport', target: scout.id, x: 37, y: 14 });
  await sendTest(host, { kind: 'teleport', target: monster.id, x: 26, y: 25, face: -1.9 });
  await sendTest(host, { kind: 'setPoint', point: 'B', progress: 0.45 });
  // 따라가는 카메라: 창이 멈춘 뒤 감옥 쪽을 조준하고 서버 조준이 그 방향인지 확인한다 (helpers.aimMonsterAt)
  await aimMonsterAt(host, 24, 19);
  await host.mouse.down({ button: 'right' });
  await host.mouse.up({ button: 'right' });
  // 점령 시작 알림이 괴물에게 뜰 때까지
  await host.waitForFunction(
    () => (window.__DECOY__?.getBanners() ?? []).some((t) => t.includes('무언가 움직인다')),
    undefined,
    {
      timeout: 10_000,
    },
  );
  await guard.page.waitForFunction(() => window.__DECOY__?.getLastSnapshot()?.you.surv?.spotted === true);
  await host.waitForTimeout(600);
  for (const p of players) {
    await p.page.screenshot({ path: `${OUT}/role-${p.role}.png` });
    await minimapSubsetOfMain(p);
  }
  // 괴물 미니맵: 시야 밖 생존자(러너 · 스카우트) 없음, 시야 안 가드 하나.
  // 다른 탭을 찍는 동안 이 탭이 멈췄다 돌아온 첫 프레임은 보간 버퍼가 비어 생존자를 아직 안 그릴 수 있어 잠깐 기다린다
  // (시야 밖 생존자가 그려지는지는 바로 위 minimapSubsetOfMain과 m3-info가 매 프레임 본다)
  await expect
    .poll(
      async () =>
        (await host.evaluate(() => window.__DECOY__?.getDrawnMinimap() ?? [])).filter(
          (d) => d.kind === 'survivor',
        ).length,
      { timeout: 5_000 },
    )
    .toBe(1);
  // 생존자 미니맵: 괴물이 보일 때만
  const snap = await lastSnapshot(runner.page);
  const runnerMini = await runner.page.evaluate(() => window.__DECOY__?.getDrawnMinimap() ?? []);
  expect(runnerMini.some((d) => d.kind === 'monster')).toBe(snap!.monster !== null);
  for (const p of players) expect(p.problems).toEqual([]);
  await closeAll(players);
});

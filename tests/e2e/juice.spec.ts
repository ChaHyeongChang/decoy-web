// 플레이테스트 반영 c 손맛 (docs/playtest/c-juice.md): 판정과 정보 범위는 그대로 두고, 받는 사람이 이미 받은 이벤트 · 자기 스냅샷으로만
// 소리 · 그림 · 배너를 낸다.
//  - 아슬아슬 회피: 괴물 정면 1.7타일의 러너 화면에만(괴물 · 가드 화면은 없음), 2.2타일은 없음, 1.0타일은 피격만
//  - 빗나감은 바람 소리, 명중은 괴물 화면에 낮은 쿵. 수감은 철창 소리 + 본인 · 동료 · 괴물 배너(괴물 배너는 누구 · 어디 없이) + 괴물 익명 칸
//    펄스, 구조 완료는 생존자 화음 · 청록 가장자리 · 구조자 '문을 열었다.', 괴물은 경고음뿐 — 괴물이 감옥 · 풀려난 자리를 보고 있어도
//    풀려난 자리 청록 고리는 생존자 화면에만 (VISUAL_SPEC 0장 ③)
import { expect, test, type Page } from '@playwright/test';
import { RESCUE_POINT, validateBalance } from '@decoy/shared';
import { readFileSync } from 'node:fs';
import { aimMonsterAt, closeAll, lastSnapshot, sendTest, startFourPlayerMatch } from './helpers';

const balance = validateBalance(JSON.parse(readFileSync('config/balance.json', 'utf8')));
const MON = { x: 30, y: 21 };

async function sounds(page: Page): Promise<string[]> {
  return page.evaluate(() => window.__DECOY__?.getSounds() ?? []);
}

async function count(page: Page, name: string): Promise<number> {
  return (await sounds(page)).filter((s) => s === name).length;
}

async function nearMisses(page: Page): Promise<number> {
  return page.evaluate(() => Number(window.__DECOY__?.getEffects().nearMisses ?? 0));
}

async function releaseRings(page: Page): Promise<number> {
  return page.evaluate(() => Number(window.__DECOY__?.getEffects().releaseRings ?? 0));
}

async function waitBanner(page: Page, text: string): Promise<void> {
  await page.waitForFunction((t) => (window.__DECOY__?.getBanners() ?? []).includes(t), text, {
    timeout: 8_000,
  });
}

test('아슬아슬 회피: 괴물 정면 1.7타일 러너 화면에만 (괴물 · 가드 화면 없음), 2.2타일은 없음, 1.0타일은 피격만', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const { players } = await startFourPlayerMatch(browser);
  const monster = players.find((p) => p.role === 'monster')!;
  const runner = players.find((p) => p.role === 'runner')!;
  const guard = players.find((p) => p.role === 'guard')!;
  const scout = players.find((p) => p.role === 'scout')!;
  for (const p of players) await p.page.keyboard.press('KeyX');

  /** 러너를 괴물 정면 d타일에 두고 한 번 친다. 괴물 화면에 타격 결과(바람 소리)가 올 때까지 */
  async function strikeAt(d: number): Promise<void> {
    await sendTest(scout.page, { kind: 'teleport', target: runner.id, x: MON.x + d, y: MON.y });
    // 가드는 괴물이 보이는 남쪽 2.5타일(부채꼴 · 띠 밖): 타격 이벤트는 받지만 아슬아슬은 아니다
    await sendTest(scout.page, { kind: 'teleport', target: guard.id, x: MON.x, y: MON.y + 2.5 });
    await sendTest(scout.page, { kind: 'teleport', target: monster.id, x: MON.x, y: MON.y, face: 0 });
    await aimMonsterAt(monster.page, MON.x + 3, MON.y);
    const swings = await count(monster.page, 'swing');
    await monster.page.mouse.down({ button: 'left' });
    await monster.page.mouse.up({ button: 'left' });
    await monster.page.waitForFunction(
      (n) => (window.__DECOY__?.getSounds() ?? []).filter((s) => s === 'swing').length > n,
      swings,
      {
        timeout: 8_000,
      },
    );
    // 같은 틱의 스냅샷이 생존자 화면에도 닿을 시간
    await runner.page.waitForTimeout(400);
  }

  // 1.7타일: 띠 안 (맞는 경계 1.5 초과 ~ 1.5 + 0.3) — 러너만
  await strikeAt(1.7);
  await expect.poll(() => nearMisses(runner.page), { timeout: 5_000 }).toBe(1);
  expect(await sounds(runner.page)).toContain('graze');
  expect(await sounds(runner.page)).toContain('swing');
  expect((await lastSnapshot(runner.page))!.you.surv!.hp).toBe(balance.survivor.maxHp);
  for (const p of [monster, guard]) {
    expect(await nearMisses(p.page)).toBe(0);
    expect(await sounds(p.page)).not.toContain('graze');
  }
  // 가드도 같은 타격을 받았다 (괴물이 보인다) — 받고도 아슬아슬은 아니다
  expect(await sounds(guard.page)).toContain('swing');
  // 빗나감: 괴물 화면에 타격음 · 쿵 없음
  expect(await sounds(monster.page)).not.toContain('thud');
  await monster.page.waitForTimeout(balance.monster.attack.cooldown * 1000 + 200);

  // 2.2타일: 띠 밖
  await strikeAt(2.2);
  expect(await nearMisses(runner.page)).toBe(1);
  await monster.page.waitForTimeout(balance.monster.attack.cooldown * 1000 + 200);

  // 1.0타일: 맞는다 — 피격만, 아슬아슬 없음. 괴물 화면에 명중 쿵
  await strikeAt(1.0);
  await expect
    .poll(async () => (await lastSnapshot(runner.page))!.you.surv!.hp, { timeout: 5_000 })
    .toBe(balance.survivor.maxHp - 1);
  expect(await nearMisses(runner.page)).toBe(1);
  await expect.poll(() => count(monster.page, 'thud'), { timeout: 5_000 }).toBe(1);
  for (const p of [monster, guard]) expect(await nearMisses(p.page)).toBe(0);

  for (const p of players) expect(p.problems).toEqual([]);
  await closeAll(players);
});

test('수감 · 구조 손맛: 철창 소리 · 본인 · 동료 · 괴물 배너 · 괴물 익명 칸 펄스, 구조 완료 화음 · 가장자리 · 구조자 문구 · 괴물 경고음', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const { players } = await startFourPlayerMatch(browser);
  const monster = players.find((p) => p.role === 'monster')!;
  const runner = players.find((p) => p.role === 'runner')!;
  const guard = players.find((p) => p.role === 'guard')!;
  const scout = players.find((p) => p.role === 'scout')!;
  for (const p of players) await p.page.keyboard.press('KeyX');

  // 수감: 체력 1 러너를 한 번에
  await sendTest(scout.page, { kind: 'setSurvivor', target: runner.id, hp: 1 });
  await sendTest(scout.page, { kind: 'teleport', target: runner.id, x: MON.x + 1, y: MON.y });
  await sendTest(scout.page, { kind: 'teleport', target: monster.id, x: MON.x, y: MON.y, face: 0 });
  await aimMonsterAt(monster.page, MON.x + 3, MON.y);
  await monster.page.mouse.down({ button: 'left' });
  await monster.page.mouse.up({ button: 'left' });
  await runner.page.waitForFunction(
    () => window.__DECOY__?.getLastSnapshot()?.you.surv?.status === 'imprisoned',
    null,
    {
      timeout: 8_000,
    },
  );
  await waitBanner(runner.page, '붙잡혔다. 누군가 문을 열어야 한다.');
  await waitBanner(guard.page, '러너가 붙잡혔다.');
  await waitBanner(monster.page, '한 명을 가뒀다.');
  for (const p of [runner, guard, monster]) expect(await sounds(p.page)).toContain('jail');
  expect(await sounds(monster.page)).toEqual(expect.arrayContaining(['swing', 'hit', 'thud', 'jail']));
  await expect
    .poll(() => monster.page.evaluate(() => Number(window.__DECOY__?.getHud().anonPulses ?? 0)), {
      timeout: 5_000,
    })
    .toBeGreaterThanOrEqual(1);
  // 괴물 배너에는 역할 이름이 없다
  for (const t of await monster.page.evaluate(() => window.__DECOY__?.getBanners() ?? []))
    for (const name of ['러너', '가드', '스카우트']) expect(t).not.toContain(name);

  // 구조: 괴물은 감옥 문 남쪽에서 북쪽(감옥 · 풀려날 자리)을 본다 — 수감자를 계속 보고 있어 같은 임시 ID가 수감 → 자유로 바뀌는 것을
  // 괴물 화면도 그린다(그래도 풀려난 자리 고리는 없어야 한다). 가드가 구조 자리에서 구조 키를 누르고 있다
  await sendTest(scout.page, {
    kind: 'teleport',
    target: monster.id,
    x: RESCUE_POINT.x,
    y: RESCUE_POINT.y + 1.7,
    face: -Math.PI / 2,
  });
  await aimMonsterAt(monster.page, RESCUE_POINT.x, RESCUE_POINT.y - 5);
  await sendTest(scout.page, { kind: 'teleport', target: guard.id, x: RESCUE_POINT.x, y: RESCUE_POINT.y });
  // 전제: 괴물 화면에 수감자가 보인다 (그 임시 ID를 풀려난 뒤에도 본다)
  const prisonerAlias = await monster.page
    .waitForFunction(
      () => window.__DECOY__?.getLastSnapshot()?.survivors.find((s) => s.status === 'imprisoned')?.id ?? null,
      null,
      { timeout: 8_000 },
    )
    .then((h) => h.jsonValue());
  await guard.page.waitForTimeout(400);
  // 가장자리 선은 0.3초뿐이라 먼저 기다리기 시작한다
  const rim = guard.page.waitForFunction(
    () => Number(window.__DECOY__?.getEffects().rescueRim ?? 0) > 0,
    null,
    {
      timeout: 15_000,
    },
  );
  await guard.page.keyboard.down('KeyE');
  await runner.page.waitForFunction(
    () => window.__DECOY__?.getLastSnapshot()?.you.surv?.status === 'free',
    null,
    {
      timeout: 15_000,
    },
  );
  await guard.page.keyboard.up('KeyE');
  await rim;
  await waitBanner(guard.page, '문을 열었다.');
  await waitBanner(runner.page, '감옥 문이 열렸다.');
  await waitBanner(monster.page, '감옥 문이 열렸다.');
  for (const p of [guard, runner, scout]) await expect.poll(() => count(p.page, 'rescue')).toBe(1);
  await expect.poll(() => count(monster.page, 'alarm')).toBe(1);
  expect(await sounds(monster.page)).not.toContain('rescue');
  expect(await guard.page.evaluate(() => window.__DECOY__?.getBanners() ?? [])).not.toContain(
    '감옥 문이 열렸다.',
  );
  await expect
    .poll(() => monster.page.evaluate(() => Number(window.__DECOY__?.getHud().anonPulses ?? 0)), {
      timeout: 5_000,
    })
    .toBeGreaterThanOrEqual(2);
  // 괴물 화면: 같은 임시 ID가 자유로 보인다(전환을 그렸다) — 그래도 풀려난 자리 고리는 0. 생존자 화면(구조자 · 본인 · 멀리 있는 팀원)은 고리
  await monster.page.waitForFunction(
    (id) => window.__DECOY__?.getLastSnapshot()?.survivors.find((s) => s.id === id)?.status === 'free',
    prisonerAlias,
    { timeout: 5_000 },
  );
  for (const p of [guard, runner, scout])
    await expect.poll(() => releaseRings(p.page), { timeout: 5_000 }).toBeGreaterThanOrEqual(1);
  await monster.page.waitForTimeout(400);
  expect(await releaseRings(monster.page)).toBe(0);
  // 새 배너 아이콘 · 펄스 틀이 HUD 아틀라스에 있다
  for (const p of players)
    expect(await p.page.evaluate(() => window.__DECOY__?.getHud().missingFrames)).toBe('');

  for (const p of players) expect(p.problems).toEqual([]);
  await closeAll(players);
});

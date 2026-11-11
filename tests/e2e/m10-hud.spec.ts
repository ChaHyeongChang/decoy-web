// M10c HUD (Canvas · 소프트웨어 합성): 늘 떠 있는 HUD는 맵 사각형과 겹치지 않음, Tab 점수판이 열리면 첫 판 조작 안내가 닫힘,
// 괴물 화면 카드 · 점수판에 이름 · 역할 없음(익명 규칙 그대로), 거점 정지 · 완료 상태 칩(디버그 값 + 픽셀),
// 가만히 있으면 HUD 텍스처를 다시 굽지 않음(배율이 바뀔 때만), HUD에 Graphics 없음, 콘솔 0,
// 거점 진행 숫자(플레이테스트 a-7): 생존자 화면은 자기 스냅샷 진행의 내림 %, 괴물 화면은 숫자 없음(플레이테스트 b), 숫자가 바뀌어도
// 굽기 · 글자 그리기 없음. 꺼진 거점(플레이테스트 b): 두 곳이 끝나면 남은 C가 회색 ⊘ 칩 · 숫자 없음
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { HUD, MAP_RECT } from '../../client/src/ui/layout';
import {
  BASE_QUERY,
  closeAll,
  hudPctTexts,
  pickRoleAndReady,
  pointPct,
  sendTest,
  startFourPlayerMatch,
  tryPointPct,
  waitForSnapshots,
  waitPointPct,
  watchConsole,
  type PointPct,
} from './helpers';

type HudInfo = Record<string, number | boolean | string>;

const LONG_NAME = '가나다라마바사아자차카타';
/** 판 시간 (초, config/balance.json) */
const TIME_LIMIT = (
  JSON.parse(readFileSync('config/balance.json', 'utf8')) as { match: { timeLimit: number } }
).match.timeLimit;

async function hud(page: Page): Promise<HudInfo> {
  return page.evaluate(() => window.__DECOY__?.getHud() ?? {});
}

/** 늘 떠 있는 HUD 부품 자리가 맵 사각형과 겹치지 않는다 */
function expectOffMap(info: HudInfo, label: string): void {
  const rects = JSON.parse(String(info.panels ?? '[]')) as [number, number, number, number][];
  expect(rects.length, `${label} 부품 수`).toBeGreaterThanOrEqual(8);
  const m = MAP_RECT;
  for (const [x, y, w, h] of rects) {
    const apart =
      x + w <= m.x + 1e-6 || m.x + m.w <= x + 1e-6 || y + h <= m.y + 1e-6 || m.y + m.h <= y + 1e-6;
    expect(apart, `${label} [${x}, ${y}, ${w}, ${h}]가 맵 사각형과 겹침`).toBe(true);
  }
}

test('생존자 HUD: 맵과 겹치지 않음 · Tab이면 조작 안내가 닫힘 · 가만히 있으면 다시 굽지 않음 · Graphics 없음', async ({
  browser,
}) => {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();
  const problems: string[] = [];
  watchConsole(page, problems);
  await page.goto(`/?bots=1${BASE_QUERY}`);
  // 이름 최대 길이(12자) 한글: 점수판 이름 칸보다 길다
  await page.getByTestId('name-input').fill(LONG_NAME);
  await page.getByTestId('create-room').click();
  await expect(page.getByTestId('room-code')).toHaveText(/^[A-Z]{4}$/);
  await pickRoleAndReady(page, 'runner');
  await page.getByTestId('start-button').click();
  await waitForSnapshots(page, 1);
  // 첫 판 조작 안내 (5초) 위에 Tab 점수판을 열면 조작 안내가 닫힌다 (예전에는 두 패널이 겹쳤다)
  const first = await hud(page);
  expect(first.help).toBe(true);
  expect(first.scoreboard).toBe(false);
  await page.keyboard.down('Tab');
  await page.waitForFunction(() => window.__DECOY__?.getHud().scoreboard === true, null, { polling: 100 });
  const tab = await hud(page);
  expect([tab.scoreboard, tab.help]).toEqual([true, false]);
  expect(String(tab.scoreText)).toMatch(/러너.*가드.*스카우트.*괴물/);
  // 긴 이름은 상태 아이콘을 덮지 않게 끝을 …로 줄인다
  expect(String(tab.scoreText)).not.toContain(LONG_NAME);
  expect(String(tab.scoreText)).toMatch(/러너 가나다라[가-힣]*… /);
  await page.keyboard.up('Tab');
  await page.waitForFunction(() => window.__DECOY__?.getHud().scoreboard === false, null, { polling: 100 });
  expect((await hud(page)).help).toBe(false);

  const info = await hud(page);
  expectOffMap(info, '생존자');
  expect(info.hudGraphics).toBe(0);
  expect(String(info.slots)).toMatch(/^ability:(ready|active),rescue:blocked$/);
  // 가만히 2초: 타이머 · 쿨타임 글자만 바뀌고 HUD 텍스처는 다시 굽지 않는다
  const b0 = Number(info.bakes);
  expect(b0).toBeGreaterThanOrEqual(1);
  const t0 = String(info.timerText);
  await page.waitForTimeout(2000);
  const idle = await hud(page);
  console.log(`[m10-hud] 굽기 ${b0} → ${idle.bakes} (2초), 타이머 ${t0} → ${idle.timerText}`);
  expect(idle.bakes).toBe(b0);
  expect(idle.timerText).not.toBe(t0);
  // 빈 통과가 아님: 백버퍼 배율이 바뀌면 한 번 다시 굽는다
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.waitForFunction((b) => Number(window.__DECOY__?.getHud().bakes ?? 0) > b, b0, {
    polling: 100,
    timeout: 15_000,
  });
  const resized = await hud(page);
  expect(Number(resized.bakes)).toBe(b0 + 1);
  expectOffMap(resized, '생존자 1280×720');
  // 아틀라스에 없는 프레임을 요청해 조용히 숨겨진 그림이 없다
  expect(resized.missingFrames).toBe('');
  expect(problems).toEqual([]);
  await context.close();
});

test('괴물 HUD는 익명 · 거점 정지 · 완료 상태 칩 (디버그 값 + 픽셀) · 상태가 바뀌어도 다시 굽지 않음', async ({
  browser,
}) => {
  test.setTimeout(150_000);
  const { players } = await startFourPlayerMatch(browser);
  const monster = players.find((p) => p.role === 'monster')!;
  const runner = players.find((p) => p.role === 'runner')!;
  const scout = players.find((p) => p.role === 'scout')!;
  const host = monster.page;
  // 시작 대기(5초)가 저절로 흐르지 않게 괴물을 붙잡아 둔다 (느린 러너에서 안내 줄을 읽기 전에 깨어나지 않게)
  await sendTest(host, { kind: 'freeze', target: monster.id, frozen: true });
  for (const p of [monster, runner]) await p.page.setViewportSize({ width: 1920, height: 1080 });
  await sendTest(host, { kind: 'setSurvivor', target: scout.id, hp: 1, imprisonCount: 1 });

  // 괴물 화면: 카드 · 점수판에 역할 · 이름이 없다 (생존자 N · 상태 · 수감만)
  await host.waitForFunction(() => String(window.__DECOY__?.getHud().cardText ?? '').includes('부상'), null, {
    polling: 100,
  });
  const names = ['러너', '가드', '스카우트', '플레이어 2', '플레이어 3', '플레이어 4'];
  await host.keyboard.down('Tab');
  await host.waitForFunction(() => window.__DECOY__?.getHud().scoreboard === true, null, { polling: 100 });
  const mon = await hud(host);
  await host.keyboard.up('Tab');
  console.log(`[m10-hud] 괴물 카드: ${mon.cardText} / 점수판: ${mon.scoreText}`);
  expect(String(mon.cardText)).toMatch(/^생존자 1 .*\| 생존자 2 .*\| 생존자 3 /);
  expect(String(mon.scoreText)).toMatch(/생존자 1.*생존자 2.*생존자 3/);
  for (const n of names) {
    expect(String(mon.cardText)).not.toContain(n);
    expect(String(mon.scoreText)).not.toContain(n);
  }
  // 시작 대기 동안은 행동 칸 자리에 안내 줄, 깨어나면 행동 칸 네 개
  expect(String(mon.hint)).toContain('괴물이 깨어나기까지');
  expectOffMap(mon, '괴물 (대기)');
  await sendTest(host, { kind: 'freeze', target: monster.id, frozen: false });
  await host.waitForFunction(() => window.__DECOY__?.getHud().hint === '', null, {
    polling: 100,
    timeout: 15_000,
  });
  const awake = await hud(host);
  expect(String(awake.slots)).toBe('attack:ready,dash:ready,roar:ready,mode:ready');
  expectOffMap(awake, '괴물');
  expect(awake.hudGraphics).toBe(0);

  // 거점 A 완료(✓ 칩) · B 정지(주황 + ‖ 칩). 정지는 괴물이 들어간 뒤 유예(5초) 전에 잰다 (느린 러너는 다시)
  // 굽기 기준값: 러너 창을 키운 뒤의 다시 굽기(배율 0.5 → 1)가 끝난 다음에 읽는다
  await runner.page.waitForFunction(() => window.__DECOY__?.gfx.zoom === 1, null, { polling: 100 });
  await runner.page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))),
  );
  const bakes = Number((await hud(runner.page)).bakes);
  // 완료는 안에 생존자가 있어 점령이 진행될 때 판정된다
  await sendTest(host, { kind: 'setPoint', point: 'A', progress: 1 });
  await sendTest(host, { kind: 'teleport', target: runner.id, x: 8, y: 16.5 });
  await runner.page.waitForFunction(() => window.__DECOY__?.getHud().pointA === 'done', null, {
    polling: 100,
  });
  const G = HUD.gauge;
  // 칩 왼쪽 위: 배지 쪽 바깥 끝에서 배지 · 틈 다음 (side 1 = 배지가 왼쪽 — 거점 셋이라 A · B 모두, C는 −1)
  const chipAt = (o: { x: number; y: number; side: 1 | -1 }): { x: number; y: number } => ({
    x: o.side === 1 ? o.x + G.dia + G.gap : o.x - G.dia - G.gap - G.chip,
    y: o.y - G.chip / 2,
  });
  const chipA = chipAt(HUD.gaugeA);
  const chipB = chipAt(HUD.gaugeB);
  let paused: ({ info: HudInfo } & ChipPixels) | null = null;
  for (let attempt = 1; attempt <= 3 && !paused; attempt += 1) {
    await sendTest(host, { kind: 'teleport', target: monster.id, x: 44.5, y: 12.5, face: 0 });
    // 서버가 B 밖 위치로 한 틱을 돌아 지키기 시간이 0으로 돌아간 뒤에 다시 들여보낸다 (고정 대기 대신 스냅샷으로 확인)
    await host.waitForFunction(
      () => {
        const m = window.__DECOY__?.getLastSnapshot()?.you.move;
        return !!m && Math.abs(m.x - 44.5) < 0.05 && Math.abs(m.y - 12.5) < 0.05;
      },
      null,
      { polling: 50 },
    );
    await sendTest(host, { kind: 'setPoint', point: 'B', progress: 0.4 });
    await sendTest(host, { kind: 'teleport', target: scout.id, x: 40, y: 14.6 });
    await sendTest(host, { kind: 'teleport', target: monster.id, x: 41.5, y: 17.5, face: Math.PI });
    const seen = await runner.page
      .waitForFunction(() => window.__DECOY__?.getHud().pointB === 'paused', null, {
        polling: 100,
        timeout: 4000,
      })
      .then(
        () => true,
        () => false,
      );
    if (!seen && attempt < 3) continue;
    await runner.page.waitForTimeout(150);
    const png = await runner.page.screenshot();
    const counts = await countChipPixels(runner.page, png, chipA, chipB, G.chip);
    const info = await hud(runner.page);
    if (info.pointB === 'paused' || attempt === 3) paused = { info, ...counts };
  }
  console.log(`[m10-hud] 칩 아이콘 칸 픽셀: ${JSON.stringify(paused && { ...paused, info: undefined })}`);
  expect(paused?.info.pointB).toBe('paused');
  expect(paused?.info.pointBChip).toBe('chip:paused');
  expect(paused?.info.pointA).toBe('done');
  expect(paused?.info.pointAChip).toBe('chip:done');
  // 칩 테두리를 뺀 아이콘 칸만 센다: 정지 ‖ 는 두 막대(가운데 열은 비어 있음), 완료 ✓ 는 청록 선
  expect(paused?.orange ?? 0).toBeGreaterThanOrEqual(12);
  expect(paused?.orangeMid ?? 99).toBeLessThanOrEqual(Math.floor((paused?.orange ?? 0) / 6));
  expect(paused?.cyanA ?? 0).toBeGreaterThanOrEqual(12);
  // 꺼진 거점 (플레이테스트 b): B도 끝나면 남은 C가 꺼진다 — 회색 ⊘ 칩, 진행 숫자 없음 (괴물 화면도 같은 상태)
  await sendTest(host, { kind: 'teleport', target: monster.id, x: 44.5, y: 12.5, face: 0 });
  await sendTest(host, { kind: 'setPoint', point: 'B', progress: 1 });
  for (const page of [runner.page, host])
    await page.waitForFunction(
      () => {
        const h = window.__DECOY__?.getHud();
        return h?.pointB === 'done' && h.pointC === 'off';
      },
      null,
      { polling: 100, timeout: 10_000 },
    );
  for (const page of [runner.page, host]) {
    const h = await hud(page);
    expect([h.pointC, h.pointCChip, h.pointCPct, h.pointCPctFrame]).toEqual(['off', 'chip:off', '', '']);
  }
  // 상태가 바뀌어도(점령 완료 · 정지 · 부상) 프레임만 바꾼다
  const last = await hud(runner.page);
  expect(last.bakes).toBe(bakes);
  expect(last.missingFrames).toBe('');
  expect((await hud(host)).missingFrames).toBe('');
  for (const p of players) expect(p.problems).toEqual([]);
  await closeAll(players);
});

async function redraws(page: Page): Promise<number> {
  return page.evaluate(() => window.__DECOY__?.textAudit().redraws ?? -1);
}

test('거점 진행 숫자: 생존자 화면은 자기 스냅샷 진행의 내림 % · 정지 주황 · 완료 100, 괴물 화면은 같은 상태에 숫자 없음(플레이테스트 b) · 숫자가 바뀌어도 다시 굽지 않고 글자를 그리지 않는다', async ({
  browser,
}) => {
  test.setTimeout(150_000);
  const { players } = await startFourPlayerMatch(browser);
  const monster = players.find((p) => p.role === 'monster')!;
  const runner = players.find((p) => p.role === 'runner')!;
  const guard = players.find((p) => p.role === 'guard')!;
  const scout = players.find((p) => p.role === 'scout')!;
  const host = monster.page;
  // mon = 괴물 화면 (진행 숫자를 보이지 않는다 — hudArt.PCT_FOR_MONSTER, 숫자 · 숫자 그림 '')
  const screens = [
    { name: '괴물', page: monster.page, mon: true },
    { name: '러너', page: runner.page, mon: false },
  ];
  // 괴물은 붙잡아 두고, 생존자는 모두 거점 밖으로 (러너 = A 옆 바닥)
  await sendTest(host, { kind: 'freeze', target: monster.id, frozen: true });
  await sendTest(host, { kind: 'teleport', target: guard.id, x: 24, y: 22 });
  await sendTest(host, { kind: 'teleport', target: scout.id, x: 30, y: 24 });
  await sendTest(host, { kind: 'teleport', target: runner.id, x: 14, y: 16.5 });
  for (const s of screens) await s.page.setViewportSize({ width: 1920, height: 1080 });
  // 굽기 기준값: 창을 키운 뒤의 다시 굽기(배율 0.5 → 1)가 끝난 다음에 읽는다
  for (const s of screens) {
    await s.page.waitForFunction(() => window.__DECOY__?.gfx.zoom === 1, null, { polling: 100 });
    await s.page.evaluate(
      () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))),
    );
  }
  const bakes0 = await Promise.all(screens.map(async (s) => Number((await hud(s.page)).bakes)));

  // ① 멈춘 진행: B 0.4(아무도 없음 → 대기, 진행은 남는다) · A 0 → 러너 화면 B 40 · A 흐린 0, 괴물 화면은 숫자 없음
  await sendTest(host, { kind: 'setPoint', point: 'A', progress: 0 });
  await sendTest(host, { kind: 'setPoint', point: 'B', progress: 0.4 });
  for (const s of screens) {
    const b = await waitPointPct(s.page, 'B', (p) => p.want === 40 && p.state === 'idle', `${s.name} B 40`);
    expect([b.visible, b.frame], s.name).toEqual(s.mon ? [false, ''] : [true, 'pct:text:o0']);
    const a = await waitPointPct(s.page, 'A', (p) => p.want === 0, `${s.name} A 0`);
    expect(a.frame, s.name).toBe(s.mon ? '' : 'pct:dim:o0');
  }

  // ② 점령 중: 러너가 A에 들어가 1명 속도(1%당 0.4초)로 오르는 동안 두 화면 모두 자기 스냅샷의 내림 %다.
  //    같은 길이의 가만히 있는 구간과 견줘 숫자가 바뀌는 동안 글자를 더 그리지 않는다(글자 객체였다면 숫자가 바뀔 때마다 한 번)
  // 타이머는 처음 나오는 (자리, 글자)마다 글자를 한 번 그린다(hudKit Digits): 끝자리 0~9가 다 나온 뒤(판 시작 11초 뒤)에 잰다
  await runner.page.waitForFunction(
    (limit) => (window.__DECOY__?.getLastSnapshot()?.world.timeLeft ?? limit) <= limit - 11,
    TIME_LIMIT,
    { polling: 200, timeout: 30_000 },
  );
  const idle0 = await redraws(runner.page);
  await runner.page.waitForTimeout(3000);
  const idleRedraws = (await redraws(runner.page)) - idle0;
  const cap0 = await redraws(runner.page);
  await sendTest(host, { kind: 'teleport', target: runner.id, x: 8, y: 16.5 });
  const start = await waitPointPct(runner.page, 'A', (p) => p.state === 'capturing', '러너 A 점령 시작');
  const startN = Number(start.shown);
  const seen = new Set<number>([startN]);
  for (let k = 1; k <= 3; k += 1) {
    const p = await waitPointPct(
      runner.page,
      'A',
      (q) => q.state === 'capturing' && Number(q.shown) >= startN + k * 2,
      `러너 A 점령 중 +${k * 2}`,
    );
    expect(p.gauge).toBe('capturing');
    expect(p.frame).toMatch(/^pct:text:o\d$/);
    seen.add(Number(p.shown));
  }
  const capRedraws = (await redraws(runner.page)) - cap0;
  const changes = Math.max(...seen) - startN;
  console.log(
    `[m10-hud] 진행 숫자 ${startN} → ${Math.max(...seen)} (${changes}번 바뀜, 본 값 ${[...seen].join(' ')}), 글자 다시 그리기: 가만히 3초 ${idleRedraws} · 점령 중 ${capRedraws}`,
  );
  // 숫자가 6번 넘게 바뀐 것은 위 +2 · +4 · +6 기다림이 보장한다
  expect(capRedraws).toBeLessThanOrEqual(idleRedraws + 2);
  // 괴물 화면: 점령 중 진행이 올라도(자기 스냅샷) 숫자 · 숫자 그림이 없다 — 게이지 상태는 같다
  const now = (await pointPct(monster.page, 'A')).want;
  for (let k = 1; k <= 2; k += 1) {
    const p = await waitPointPct(
      monster.page,
      'A',
      (q) => q.state === 'capturing' && q.want >= now + k,
      `괴물 A 점령 중 +${k}`,
    );
    expect([p.gauge, p.shown, p.frame]).toEqual(['capturing', '', '']);
  }
  for (const s of screens) expect(await hudPctTexts(s.page), s.name).toEqual([]);

  // ③ 멈춘 뒤 두 화면이 같은 숫자: 러너가 나가면 진행이 그 자리에 멈춘다
  await sendTest(host, { kind: 'teleport', target: runner.id, x: 14, y: 16.5 });
  const stopped: PointPct[] = [];
  for (const s of screens)
    stopped.push(
      await waitPointPct(s.page, 'A', (p) => p.state === 'idle' && p.gauge === 'idle', `${s.name} A 멈춤`),
    );
  expect(stopped[0]!.want).toBe(stopped[1]!.want);
  expect(stopped[0]!.shown).toBe('');
  expect(Number(stopped[1]!.shown)).toBeGreaterThanOrEqual(startN + 6);

  // ④ 정지: 러너가 A에 있고 괴물이 들어가면(유예 5초 안) 진행이 멈추고 숫자가 주황 — 두 화면 같은 값.
  //    유예가 지나 점령이 다시 오르면(느린 러너) 괴물을 내보냈다가 다시 들여보낸다
  await sendTest(host, { kind: 'teleport', target: runner.id, x: 8, y: 16.5 });
  let paused: PointPct[] = [];
  for (let attempt = 1; attempt <= 3 && paused.length < 2; attempt += 1) {
    await waitPointPct(runner.page, 'A', (p) => p.state === 'capturing', `러너 A 다시 점령 (${attempt})`);
    await sendTest(host, { kind: 'teleport', target: monster.id, x: 9.5, y: 17, face: 0 });
    paused = [];
    for (const s of screens) {
      const p = await tryPointPct(s.page, 'A', (q) => q.state === 'blocked' && q.gauge === 'paused', 4000);
      if (p) paused.push(p);
    }
    if (paused.length < 2) await sendTest(host, { kind: 'teleport', target: monster.id, x: 44.5, y: 12.5 });
  }
  expect(paused.length, 'A 정지가 두 화면에 보였다').toBe(2);
  expect(paused[0]!.want).toBe(paused[1]!.want);
  expect([paused[0]!.shown, paused[0]!.frame]).toEqual(['', '']);
  expect(paused[1]!.frame).toMatch(/^pct:warn:o\d$/);

  // ⑤ 완료: 괴물이 나가고 진행을 1로 → ✓ 와 함께 100 (완료 전에는 99까지)
  await sendTest(host, { kind: 'teleport', target: monster.id, x: 44.5, y: 12.5, face: 0 });
  await sendTest(host, { kind: 'setPoint', point: 'A', progress: 1 });
  for (const s of screens) {
    const done = await waitPointPct(s.page, 'A', (p) => p.state === 'done', `${s.name} A 완료`);
    expect([done.shown, done.gauge, done.frame], s.name).toEqual(
      s.mon ? ['', 'done', ''] : [100, 'done', 'pct:text:100'],
    );
    // B는 그대로 40
    expect((await pointPct(s.page, 'B')).shown, s.name).toBe(s.mon ? '' : 40);
  }

  // 숫자가 몇 번 바뀌어도 · 상태가 바뀌어도 아틀라스를 다시 굽지 않고, 아틀라스에 없는 프레임도 없다
  for (const [i, s] of screens.entries()) {
    const info = await hud(s.page);
    expect(Number(info.bakes), s.name).toBe(bakes0[i]);
    expect(info.missingFrames, s.name).toBe('');
    expect(await hudPctTexts(s.page), s.name).toEqual([]);
  }
  for (const p of players) expect(p.problems).toEqual([]);
  await closeAll(players);
});

interface ChipPixels {
  /** B 정지 칩 아이콘 칸의 주황 픽셀 */
  orange: number;
  /** 그중 가운데 두 열 (‖ 의 두 막대 사이라 비어 있어야 한다) */
  orangeMid: number;
  /** A 완료 칩 아이콘 칸의 청록 픽셀 */
  cyanA: number;
}

/**
 * 칩 자리(논리 = CSS px, 창 1920×1080)의 아이콘 칸만 센다. 칩 테두리(상태색 선)는 빼야 아이콘이 빠져도 잡힌다:
 * 아이콘은 칩 가운데 ±8에 그린다(hudArt chip)
 */
async function countChipPixels(
  page: Page,
  png: Buffer,
  a: { x: number; y: number },
  b: { x: number; y: number },
  size: number,
): Promise<ChipPixels> {
  return page.evaluate(
    async ({ b64, a, b, size }) => {
      const img = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('2d 없음');
      ctx.drawImage(img, 0, 0);
      const ICON = 16;
      const inset = size / 2 - ICON / 2;
      const count = (
        p: { x: number; y: number },
        test: (r: number, g: number, bl: number) => boolean,
        cols: [number, number] = [0, ICON],
      ): number => {
        const d = ctx.getImageData(Math.round(p.x + inset), Math.round(p.y + inset), ICON, ICON).data;
        let n = 0;
        for (let i = 0; i < d.length; i += 4) {
          const col = (i / 4) % ICON;
          if (col >= cols[0] && col < cols[1] && test(d[i] ?? 0, d[i + 1] ?? 0, d[i + 2] ?? 0)) n += 1;
        }
        return n;
      };
      const orange = (r: number, g: number, bl: number): boolean =>
        r > 190 && g > 100 && g < 200 && bl < 90 && r - g > 40;
      return {
        orange: count(b, orange),
        orangeMid: count(b, orange, [ICON / 2 - 1, ICON / 2 + 1]),
        cyanA: count(a, (r, g, bl) => r < 120 && g > 160 && bl > 190),
      };
    },
    { b64: png.toString('base64'), a, b, size },
  );
}

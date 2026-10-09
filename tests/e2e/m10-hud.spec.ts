// M10c HUD (Canvas · 소프트웨어 합성): 늘 떠 있는 HUD는 맵 사각형과 겹치지 않음, Tab 점수판이 열리면 첫 판 조작 안내가 닫힘,
// 괴물 화면 카드 · 점수판에 이름 · 역할 없음(익명 규칙 그대로), 거점 정지 · 완료 상태 칩(디버그 값 + 픽셀),
// 가만히 있으면 HUD 텍스처를 다시 굽지 않음(배율이 바뀔 때만), HUD에 Graphics 없음, 콘솔 0
import { expect, test, type Page } from '@playwright/test';
import { HUD, MAP_RECT } from '../../client/src/ui/layout';
import {
  BASE_QUERY,
  closeAll,
  pickRoleAndReady,
  sendTest,
  startFourPlayerMatch,
  waitForSnapshots,
  watchConsole,
} from './helpers';

type HudInfo = Record<string, number | boolean | string>;

const LONG_NAME = '가나다라마바사아자차카타';

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
  const chipA = { x: HUD.gaugeA.x + G.dia + G.gap, y: HUD.gaugeA.y - G.chip / 2 };
  const chipB = { x: HUD.gaugeB.x - G.dia - G.gap - G.chip, y: HUD.gaugeB.y - G.chip / 2 };
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
  // 상태가 바뀌어도(점령 완료 · 정지 · 부상) 프레임만 바꾼다
  const last = await hud(runner.page);
  expect(last.bakes).toBe(bakes);
  expect(last.missingFrames).toBe('');
  expect((await hud(host)).missingFrames).toBe('');
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

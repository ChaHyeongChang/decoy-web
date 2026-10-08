// M10a 그래픽 품질 (Canvas 렌더러 · 소프트웨어 합성): Canvas에서 WebGL 전용 기능 0개, 판 중 자동 하향(한 번, 재연결 없음),
// 로비 품질 선택 저장 · 새로고침 · 자동
import { expect, test, type Page } from '@playwright/test';
import { QUALITY_STORAGE_KEY } from '../../client/src/gfx/quality';
import { BASE_QUERY, newPlayerPage, pickRoleAndReady, waitForSnapshots } from './helpers';

async function gfx(page: Page) {
  return page.evaluate(() => {
    const g = window.__DECOY__?.gfx;
    if (!g) throw new Error('디버그 훅이 없다');
    return g;
  });
}

async function startSolo(page: Page, extra: string): Promise<void> {
  await page.goto(`/?bots=1${BASE_QUERY}${extra}`);
  await page.getByTestId('create-room').click();
  await expect(page.getByTestId('room-code')).toHaveText(/^[A-Z]{4}$/);
  await pickRoleAndReady(page, 'runner');
  await page.getByTestId('start-button').click();
  await waitForSnapshots(page, 3);
}

test('Canvas 렌더러는 ?quality=high여도 WebGL 전용 기능이 꺼진다', async ({ browser }) => {
  const { context, page, problems } = await newPlayerPage(browser);
  await startSolo(page, '&quality=high');
  const g = await gfx(page);
  expect(g.renderer).toBe('canvas');
  expect(g.quality).toBe('high');
  expect(g.qualitySource).toBe('url');
  expect(g.features.bloom).toBe(false);
  expect(g.features.fogShader).toBe(false);
  expect(g.features.colorGrade).toBe(false);
  expect(g.features.vignette).not.toBe('postfx');
  expect(g.features.fog).toBe('canvas');
  await page.waitForTimeout(1000);
  expect(problems).toEqual([]);
  await context.close();
});

test('판 중 FPS가 낮으면 한 번 한 단계 내린다 (재연결 · 장면 재시작 없음)', async ({ browser }) => {
  const { context, page, problems } = await newPlayerPage(browser);
  let sockets = 0;
  page.on('websocket', () => {
    sockets += 1;
  });
  await startSolo(page, '&quality=high');
  const you = await page.evaluate(() => window.__DECOY__?.you ?? null);
  // 예열(판 시작 뒤 5초)이 지나도록 기다린다. 그동안은 실제 FPS(약 60)로 하향이 없어야 한다
  await page.waitForTimeout(5500);
  let g = await gfx(page);
  expect(g.quality).toBe('high');
  expect(g.downgrades).toBe(0);
  const snapsBefore = await page.evaluate(() => window.__DECOY__?.snapCount ?? 0);

  await page.evaluate(() => window.__DECOY__?.injectFps(20));
  const injectedAt = Date.now();
  await page.waitForFunction(() => (window.__DECOY__?.gfx.downgrades ?? 0) >= 1, null, { timeout: 15_000 });
  console.log(`FPS 20 주입 뒤 ${((Date.now() - injectedAt) / 1000).toFixed(1)}초에 한 단계 내림`);
  g = await gfx(page);
  expect(g.quality).toBe('medium');
  expect(g.downgrades).toBe(1);
  expect(g.measuredFps).toBeLessThan(40);

  // 판당 한 번: FPS가 계속 낮아도 더 내리지 않는다
  await page.waitForTimeout(3000);
  g = await gfx(page);
  expect(g.quality).toBe('medium');
  expect(g.downgrades).toBe(1);

  // 같은 사람 · 같은 연결: 스냅샷이 끊기지 않고 이어서 늘고(판 재시작이면 0부터), 웹소켓을 다시 열지 않았다
  expect(await page.evaluate(() => window.__DECOY__?.you ?? null)).toBe(you);
  const snapsAfter = await page.evaluate(() => window.__DECOY__?.snapCount ?? 0);
  expect(snapsAfter).toBeGreaterThan(snapsBefore + 30);
  expect(sockets).toBe(1);
  expect(await page.evaluate(() => window.__DECOY__?.phase ?? null)).toBe('playing');

  await page.evaluate(() => window.__DECOY__?.injectFps(null));
  expect(problems).toEqual([]);
  await context.close();
});

test('로비에서 고른 품질을 저장하고 바로 적용한다. 자동이면 저장값을 지운다', async ({ browser }) => {
  const { context, page, problems } = await newPlayerPage(browser);
  await page.goto(`/?${BASE_QUERY.slice(1)}`);
  const select = page.getByTestId('quality-select');
  await expect(select).toBeVisible();
  await expect(select).toHaveValue('auto');
  let g = await gfx(page);
  // Canvas 렌더러 자동 → 낮음
  expect([g.quality, g.qualitySource]).toEqual(['low', 'auto']);

  await select.selectOption('high');
  await expect.poll(async () => (await gfx(page)).quality).toBe('high');
  g = await gfx(page);
  expect(g.qualitySource).toBe('saved');
  expect(await page.evaluate((k) => localStorage.getItem(k), QUALITY_STORAGE_KEY)).toBe('high');

  await select.selectOption('low');
  await expect.poll(async () => (await gfx(page)).quality).toBe('low');
  expect(await page.evaluate((k) => localStorage.getItem(k), QUALITY_STORAGE_KEY)).toBe('low');

  // 새로고침 뒤에도 저장값
  await page.reload();
  await expect(page.getByTestId('quality-select')).toHaveValue('low');
  g = await gfx(page);
  expect([g.quality, g.qualitySource]).toEqual(['low', 'saved']);

  // 자동: 저장값 삭제
  await page.getByTestId('quality-select').selectOption('auto');
  await expect.poll(async () => (await gfx(page)).qualitySource).toBe('auto');
  expect(await page.evaluate((k) => localStorage.getItem(k), QUALITY_STORAGE_KEY)).toBeNull();
  await page.reload();
  await expect(page.getByTestId('quality-select')).toHaveValue('auto');
  expect((await gfx(page)).qualitySource).toBe('auto');
  expect(problems).toEqual([]);
  await context.close();
});

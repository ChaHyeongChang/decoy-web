// M10a 그래픽 품질 (Canvas 렌더러 · 소프트웨어 합성): Canvas에서 WebGL 전용 기능 0개, 같은 색이면 글자를 다시 그리지 않음,
// 판 중 자동 하향(한 번, 재연결 없음)과 효과가 없을 때 되돌리기, 로비 품질 선택 저장 · 새로고침 · 자동 · 저장소가 막힌 브라우저.
// 하향이 실제로 백버퍼 · 글자 · 안개를 바꾸고 입력이 이어지는지는 m10-quality.webgl.spec.ts(기기 배율 2)에서 본다
import { expect, test, type Page } from '@playwright/test';
import type { TextAudit } from '@decoy/shared';
import { DOWNGRADE_CHECK, FPS_WATCH, QUALITY_STORAGE_KEY } from '../../client/src/gfx/quality';
import { BASE_QUERY, newPlayerPage, pickRoleAndReady, waitForSnapshots } from './helpers';

async function gfx(page: Page) {
  return page.evaluate(() => {
    const g = window.__DECOY__?.gfx;
    if (!g) throw new Error('디버그 훅이 없다');
    return g;
  });
}

async function textAudit(page: Page): Promise<TextAudit> {
  return page.evaluate(() => {
    const h = window.__DECOY__;
    if (!h) throw new Error('디버그 훅이 없다');
    return h.textAudit();
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

  // HUD는 매 프레임 남은 시간 · 팀 카드 이름에 setColor를 부른다. 같은 색이면 글자를 다시 그리지 않아야 한다
  // (예전: 러너 화면 프레임당 4장 → 초당 약 240번 다시 그리고 올림). 1초 동안 다시 그린 횟수 ≤ 글자 · 배치가 바뀐 횟수 + 여유 2
  const a = await textAudit(page);
  await page.waitForTimeout(1000);
  const b = await textAudit(page);
  const redraws = b.redraws - a.redraws;
  const relayouts = b.relayouts - a.relayouts;
  console.log(`판 중 1초: 글자 다시 그림 ${redraws}번, 그중 배치 변경 ${relayouts}번`);
  expect(redraws).toBeLessThanOrEqual(relayouts + 2);
  expect(problems).toEqual([]);
  await context.close();
});

test('판 중 FPS가 낮으면 한 단계 내리고, 내려도 오르지 않으면 되돌린 뒤 이번 세션에서는 끈다 (재연결 · 장면 재시작 없음)', async ({
  browser,
}) => {
  const { context, page, problems } = await newPlayerPage(browser);
  let sockets = 0;
  page.on('websocket', () => {
    sockets += 1;
  });
  await startSolo(page, '&quality=high');
  const you = await page.evaluate(() => window.__DECOY__?.you ?? null);
  let g = await gfx(page);
  expect([g.quality, g.downgrades, g.features.autoDowngrade]).toEqual(['high', 0, 'on']);
  const snapsBefore = await page.evaluate(() => window.__DECOY__?.snapCount ?? 0);

  // 판 시작 직후부터 FPS 20: 예열(5초) 뒤 느린 상태가 10초를 넘으면 한 단계 내린다
  // (예열 동안 하향이 없다는 것은 구조상 참이라 FpsWatch 단위 테스트가 본다)
  await page.evaluate(() => window.__DECOY__?.injectFps(20));
  const injectedAt = Date.now();
  await page.waitForFunction(() => (window.__DECOY__?.gfx.downgrades ?? 0) >= 1, null, {
    timeout: FPS_WATCH.warmupMs + FPS_WATCH.sustainMs + 10_000,
  });
  console.log(`FPS 20 주입 뒤 ${((Date.now() - injectedAt) / 1000).toFixed(1)}초에 한 단계 내림`);
  g = await gfx(page);
  expect(g.quality).toBe('medium');
  expect(g.downgrades).toBe(1);
  expect(g.measuredFps).toBeLessThan(40);
  expect(g.features.autoDowngrade).toBe('checking');

  // FPS가 그대로 20(화면 갱신 상한과 같은 상황): 효과 확인 뒤 원래 단계로 되돌리고 자동 하향을 끈다
  const downAt = Date.now();
  await page.waitForFunction(() => window.__DECOY__?.gfx.features.autoDowngrade === 'off', null, {
    timeout: DOWNGRADE_CHECK.settleMs + DOWNGRADE_CHECK.measureMs + 10_000,
  });
  console.log(`하향 뒤 ${((Date.now() - downAt) / 1000).toFixed(1)}초에 효과 없음 → 되돌림`);
  g = await gfx(page);
  expect(g.quality).toBe('high');
  expect(g.qualitySource).toBe('url');
  // 실제로 내린 횟수는 그대로
  expect(g.downgrades).toBe(1);

  // 이번 세션에서는 꺼짐: FPS가 계속 낮아도 더 내리지 않는다
  await page.waitForTimeout(3000);
  g = await gfx(page);
  expect([g.quality, g.downgrades, g.features.autoDowngrade]).toEqual(['high', 1, 'off']);

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
  // 저장소가 정상이면 '저장되지 않음' 안내는 없다
  await expect(page.getByTestId('quality-note')).toBeHidden();
  expect(problems).toEqual([]);
  await context.close();
});

test('저장소가 막힌 브라우저에서도 로비에서 고른 품질이 이번 접속에 적용되고, 저장되지 않는다고 알린다', async ({
  browser,
}) => {
  const { context, page, problems } = await newPlayerPage(browser);
  // 쿠키 · 사이트 데이터 차단 · 서드파티 iframe: localStorage에 접근만 해도 SecurityError
  await context.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('사이트 데이터 차단', 'SecurityError');
      },
    });
  });
  // ?quality=low로 들어와 로비에서 '높음' → 주소 값이 아니라 고른 값
  await page.goto(`/?${BASE_QUERY.slice(1)}&quality=low`);
  const select = page.getByTestId('quality-select');
  await expect(select).toBeVisible();
  expect([(await gfx(page)).quality, (await gfx(page)).qualitySource]).toEqual(['low', 'url']);
  await expect(page.getByTestId('quality-note')).toBeHidden();

  await select.selectOption('high');
  await expect.poll(async () => (await gfx(page)).quality).toBe('high');
  expect((await gfx(page)).qualitySource).toBe('saved');
  await expect(page.getByTestId('quality-note')).toBeVisible();
  // 문구 원본은 client/src/ui/lobby.ts QUALITY_NOT_SAVED (lobby.ts는 PNG를 import해서 여기서 불러올 수 없다)
  await expect(page.getByTestId('quality-note')).toContainText('설정이 저장되지 않아요');

  await select.selectOption('medium');
  await expect.poll(async () => (await gfx(page)).quality).toBe('medium');

  // '자동': Canvas 렌더러 자동 = 낮음 (주소의 ?quality도 이번 세션에서는 쓰지 않는다)
  await select.selectOption('auto');
  await expect.poll(async () => (await gfx(page)).qualitySource).toBe('auto');
  expect((await gfx(page)).quality).toBe('low');

  // 판 화면까지 그대로 (고른 값으로 판을 연다)
  await select.selectOption('high');
  await expect.poll(async () => (await gfx(page)).quality).toBe('high');
  await page.getByTestId('create-room').click();
  await expect(page.getByTestId('room-code')).toHaveText(/^[A-Z]{4}$/);
  expect([(await gfx(page)).quality, (await gfx(page)).qualitySource]).toEqual(['high', 'saved']);
  expect(problems).toEqual([]);
  await context.close();
});

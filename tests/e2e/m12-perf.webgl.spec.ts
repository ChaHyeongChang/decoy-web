// M12 성능 (WebGL 1탭, SwiftShader): 하드웨어 GPU 휴대폰으로 보이게 한 컨텍스트(렌더러 이름 · 코어 8 · 메모리 4GB)에서
//  - 터치 기기 자동 선택 = 중간, 판 중 하향 기준 50fps
//  - 판 중 하향(중간 → 낮음)이 효과가 있으면(FPS가 오름) 'decoy:perf'에 온라인 기억으로 남고, 다시 열면 낮음으로 시작한다
//  - 로비에서 품질을 직접 고르면(자동 포함) 기억을 지우고 기기 자동 단계로 돌아간다
//  - (검토 반영) 봇과 연습 판의 하향은 '연습' 기억으로만 남는다: 온라인 판 시작 품질은 그대로, 다음 연습 판은 낮음으로
// Canvas 휴대폰의 하향 · 입력 연속 · 터치 낮음 해상도 · CPU 4배 기록은 m12-perf.spec.ts
import { expect, test, type Page } from '@playwright/test';
import type { GfxDebugInfo } from '@decoy/shared';
import { DOWNGRADE_CHECK, PERF_MEMORY_VERSION, TOUCH_FPS_WATCH } from '../../client/src/gfx/quality';
import { STORAGE_KEYS } from '../../client/src/storageKeys';
import { PHONE_LANDSCAPE, dpr1, newPlayerPage, pickRoleAndReady, press, waitForSnapshots } from './helpers';

const QUERY = '/?bots=1&debug=hook&renderer=webgl';
const POLL = { polling: 200 } as const;
const PERF_KEY = STORAGE_KEYS.perf.key;

/** 하드웨어 GPU 휴대폰 흉내: WebGL 렌더러 이름(SwiftShader 대신 Adreno) · 코어 8 · 메모리 4GB, 전체 화면은 흉내만 */
function fakeMidPhone(): void {
  const name = 'ANGLE (Qualcomm, Adreno (TM) 642L, OpenGL ES 3.2)';
  for (const C of [WebGLRenderingContext, WebGL2RenderingContext]) {
    const orig = C.prototype.getParameter;
    C.prototype.getParameter = function (this: WebGLRenderingContext, p: number): unknown {
      // RENDERER · UNMASKED_RENDERER_WEBGL
      if (p === 0x1f01 || p === 0x9246) return name;
      return orig.call(this, p) as unknown;
    };
  }
  Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', { get: () => 8, configurable: true });
  Object.defineProperty(Navigator.prototype, 'deviceMemory', { get: () => 4, configurable: true });
  Element.prototype.requestFullscreen = function () {
    return Promise.resolve();
  };
}

async function gfx(page: Page): Promise<GfxDebugInfo> {
  return page.evaluate(() => {
    const g = window.__DECOY__?.gfx;
    if (!g) throw new Error('디버그 훅이 없다');
    return JSON.parse(JSON.stringify(g)) as GfxDebugInfo;
  });
}

async function perfMemory(page: Page): Promise<unknown> {
  return page.evaluate((k) => {
    const raw = localStorage.getItem(k);
    return raw === null ? null : (JSON.parse(raw) as unknown);
  }, PERF_KEY);
}

test('휴대폰 자동 중간 → 판 중 하향이 효과가 있으면 기억해 다음 접속은 낮음, 로비에서 고르면 지운다', async ({
  browser,
}) => {
  const { context, page, problems } = await newPlayerPage(browser, dpr1(PHONE_LANDSCAPE));
  await context.addInitScript(fakeMidPhone);
  await page.goto(QUERY);
  await press(page.getByTestId('create-room'));
  await expect(page.getByTestId('room-code')).toHaveText(/^[A-Z]{4}$/);
  let g = await gfx(page);
  expect(g.touch).toBe(true);
  expect([g.renderer, g.quality, g.qualitySource]).toEqual(['webgl', 'medium', 'auto']);
  expect(g.features.perfTier).toBe('none');
  expect(g.features.autoMinFps).toBe(TOUCH_FPS_WATCH.minFps);
  expect(await perfMemory(page)).toBeNull();

  await pickRoleAndReady(page, 'runner');
  await press(page.getByTestId('start-button'));
  await waitForSnapshots(page, 3);
  // 중간에서 42fps(목표 50 미만): 예열 + 10초 뒤 낮음으로
  await page.evaluate(() => window.__DECOY__?.injectFps(42));
  await page.waitForFunction(() => (window.__DECOY__?.gfx.downgrades ?? 0) >= 1, null, {
    ...POLL,
    timeout: TOUCH_FPS_WATCH.warmupMs + TOUCH_FPS_WATCH.sustainMs + 20_000,
  });
  g = await gfx(page);
  expect([g.quality, g.qualitySource]).toEqual(['low', 'auto']);
  expect(g.features.autoDowngrade).toBe('checking');
  // 안개는 다음 프레임에 낮음 방식(Canvas 합성)으로 다시 만든다
  await expect.poll(async () => (await gfx(page)).fogMode, { intervals: [100, 200] }).toBe('canvas');
  // 확인 전에는 기억하지 않는다 (효과가 없어 되돌릴 수도 있다)
  expect(await perfMemory(page)).toBeNull();

  // 낮음에서 58fps: 효과 있음 → 유지하고 온라인 기억으로 남긴다
  await page.evaluate(() => window.__DECOY__?.injectFps(58));
  await page.waitForFunction(() => window.__DECOY__?.gfx.features.autoDowngrade === 'on', null, {
    ...POLL,
    timeout: DOWNGRADE_CHECK.settleMs + DOWNGRADE_CHECK.measureMs + 20_000,
  });
  g = await gfx(page);
  expect([g.quality, g.downgrades]).toEqual(['low', 1]);
  expect(g.features.perfSaved).toBe('low');
  expect(await perfMemory(page)).toEqual({ v: PERF_MEMORY_VERSION, online: { tier: 'low', base: 'medium' } });

  // 다시 열기(첫 화면): 기억한 낮음으로 시작 (출처는 자동, 로비 선택은 '자동' 그대로).
  // 방으로 되돌아가지 않게 마지막 방 기억(터치 기기 30초 복귀)은 새 문서가 시작될 때 지운다:
  // 지금 지워도 떠나는 페이지가 pagehide에서 다시 적는다(M12 마지막 방 복귀)
  await page.addInitScript((k) => localStorage.removeItem(k), STORAGE_KEYS.lastRoom.key);
  await page.goto(QUERY);
  await expect(page.getByTestId('quality-select')).toHaveValue('auto');
  g = await gfx(page);
  expect([g.quality, g.qualitySource]).toEqual(['low', 'auto']);
  expect(g.features.perfTier).toBe('low');

  // 로비에서 '자동'을 직접 고르면 기억을 지우고 기기 자동(중간)부터 다시 잰다
  await page.getByTestId('quality-select').selectOption('auto');
  await expect.poll(async () => (await gfx(page)).quality, { intervals: [100, 200] }).toBe('medium');
  g = await gfx(page);
  expect([g.qualitySource, g.features.perfTier]).toEqual(['auto', 'none']);
  expect(await perfMemory(page)).toBeNull();
  // 단계를 직접 골라도 지운다 (다시 기억을 만든 뒤)
  await page.evaluate(([k, v]) => localStorage.setItem(k, v), [
    PERF_KEY,
    JSON.stringify({ v: PERF_MEMORY_VERSION, online: { tier: 'low', base: 'medium' } }),
  ] as const);
  await page.getByTestId('quality-select').selectOption('high');
  await expect.poll(async () => (await gfx(page)).quality, { intervals: [100, 200] }).toBe('high');
  expect(await perfMemory(page)).toBeNull();

  await page.evaluate(() => window.__DECOY__?.injectFps(null));
  expect(problems).toEqual([]);
  await context.close();
});

test('봇과 연습 판의 하향은 연습 기억으로만 남아 온라인 시작 품질은 그대로, 다음 연습 판은 낮음으로 시작한다', async ({
  browser,
}) => {
  const { context, page, problems } = await newPlayerPage(browser, dpr1(PHONE_LANDSCAPE));
  await context.addInitScript(fakeMidPhone);
  const query = '/?debug=hook&renderer=webgl';
  await page.goto(query);
  let g = await gfx(page);
  expect([g.renderer, g.quality, g.qualitySource, g.features.perfTier]).toEqual([
    'webgl',
    'medium',
    'auto',
    'none',
  ]);
  await press(page.getByTestId('practice'));
  await press(page.getByTestId('practice-role-runner'));
  await waitForSnapshots(page, 3);
  expect(await page.evaluate(() => window.__DECOY__?.transport)).toBe('local');
  // 중간에서 42fps → 낮음, 낮음에서 58fps → 유지(효과 있음)
  await page.evaluate(() => window.__DECOY__?.injectFps(42));
  await page.waitForFunction(() => (window.__DECOY__?.gfx.downgrades ?? 0) >= 1, null, {
    ...POLL,
    timeout: TOUCH_FPS_WATCH.warmupMs + TOUCH_FPS_WATCH.sustainMs + 20_000,
  });
  await page.evaluate(() => window.__DECOY__?.injectFps(58));
  await page.waitForFunction(() => window.__DECOY__?.gfx.features.autoDowngrade === 'on', null, {
    ...POLL,
    timeout: DOWNGRADE_CHECK.settleMs + DOWNGRADE_CHECK.measureMs + 20_000,
  });
  g = await gfx(page);
  expect([g.quality, g.features.perfSaved]).toEqual(['low', 'low']);
  // 연습 기억만 (온라인 키 없음)
  expect(await perfMemory(page)).toEqual({
    v: PERF_MEMORY_VERSION,
    practice: { tier: 'low', base: 'medium' },
  });
  await page.evaluate(() => window.__DECOY__?.injectFps(null));

  // 다시 열기: 첫 화면 · 온라인 판의 시작 품질은 기기 자동(중간) 그대로
  await page.goto(query);
  g = await gfx(page);
  expect([g.quality, g.qualitySource, g.features.perfTier]).toEqual(['medium', 'auto', 'none']);
  // 다시 연습: 판 장면을 만들기 전에 연습 기억(낮음)으로 시작한다
  await press(page.getByTestId('practice'));
  await press(page.getByTestId('practice-role-runner'));
  await waitForSnapshots(page, 3);
  await expect.poll(async () => (await gfx(page)).quality, { intervals: [100, 200] }).toBe('low');
  g = await gfx(page);
  expect([g.quality, g.qualitySource, g.features.perfTier]).toEqual(['low', 'auto', 'low']);
  expect(problems).toEqual([]);
  await context.close();
});

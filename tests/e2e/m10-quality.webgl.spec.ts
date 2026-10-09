// M10a 판 중 자동 하향이 실제로 바꾸는 것 (WebGL 1탭, SwiftShader, 기기 배율 2):
//  - 높음 → 중간에서 백버퍼 2배 → 1.5배, 카메라 zoom · 글자 해상도(모든 글자) · 안개 합성 배율이 따라간다
//    (applyResolution과 안개 재구성이 실제로 돌아야만 바뀌는 값들)
//  - 같은 연결 · 끊기지 않은 입력: 마우스를 움직이지 않아도 조준이 그대로, 이동 키가 서버에 닿고 입력 확인 번호(ack)가 계속 는다
// Canvas 960×540 배율 1에서는 높음 · 중간의 백버퍼가 같아 이것을 볼 수 없다 (m10-quality.spec.ts는 하향 판단 · 되돌리기를 본다)
import { expect, test, type Page } from '@playwright/test';
import type { GfxDebugInfo, TextAudit } from '@decoy/shared';
import { DOWNGRADE_CHECK, FPS_WATCH } from '../../client/src/gfx/quality';
import { pickRoleAndReady, truth, waitForSnapshots, watchConsole } from './helpers';

const QUERY = '?bots=1&debug=hook&renderer=webgl&quality=high';
/** 괴물을 둘 곳과 조준할 곳 (타일). (24,21)에서 아래로 3타일은 바닥 */
const SPOT = { x: 24, y: 21 };
const AIM = { x: 18, y: 25 };

interface State {
  canvasW: number;
  canvasH: number;
  gfx: GfxDebugInfo;
  texts: TextAudit;
  ack: number;
  snapCount: number;
}

async function state(page: Page): Promise<State> {
  return page.evaluate(() => {
    const h = window.__DECOY__;
    const c = document.querySelector<HTMLCanvasElement>('#game-root canvas');
    if (!h || !c) throw new Error('디버그 훅 · 캔버스가 없다');
    return {
      canvasW: c.width,
      canvasH: c.height,
      gfx: h.gfx,
      texts: h.textAudit(),
      ack: h.getLastSnapshot()?.ack ?? -1,
      snapCount: h.snapCount,
    };
  });
}

function expectTexts(a: TextAudit, zoom: number, label: string): void {
  expect(a.count, `${label} 글자 수`).toBeGreaterThan(0);
  expect([a.styleResMin, a.styleResMax], `${label} 글자 해상도`).toEqual([zoom, zoom]);
  expect([a.sourceResMin, a.sourceResMax], `${label} 텍스처 해상도`).toEqual([zoom, zoom]);
  expect(a.gridErrMax, `${label} 격자 어긋남`).toBeLessThan(1e-3);
}

function angDiff(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d);
}

test('판 중 하향: 백버퍼 · zoom · 글자 · 안개 합성이 1.5배로 바뀌고 입력이 끊기지 않는다', async ({
  browser,
}) => {
  // 작은 창(640×360 @2 → 백버퍼 1280×720): GitHub Actions 러너의 SwiftShader에서 높음 한 프레임이 1초를 넘으면
  // FPS 감시가 끊김으로 보고 처음부터 다시 재서(gapMs) 하향이 늦어진다. 전환 자체는 크기와 상관없다
  const context = await browser.newContext({ viewport: { width: 640, height: 360 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const problems: string[] = [];
  watchConsole(page, problems);
  let sockets = 0;
  page.on('websocket', () => {
    sockets += 1;
  });

  await page.goto(`/${QUERY}`);
  await page.getByTestId('create-room').click();
  const codeEl = page.getByTestId('room-code');
  await expect(codeEl).toHaveText(/^[A-Z]{4}$/);
  const code = (await codeEl.textContent()) ?? '';
  await pickRoleAndReady(page, 'monster');
  await page.getByTestId('start-button').click();
  await waitForSnapshots(page, 3);
  // 판 시작 직후부터 FPS 20: 예열(5초) + 느린 상태 10초 뒤 한 단계 내린다
  await page.evaluate(() => window.__DECOY__?.injectFps(20));
  const startedAt = Date.now();
  const me = await page.evaluate(() => window.__DECOY__?.you ?? '');

  const before = await state(page);
  expect([before.canvasW, before.canvasH]).toEqual([1280, 720]);
  expect(before.gfx.quality).toBe('high');
  expect(before.gfx.zoom).toBeCloseTo(1280 / 1920, 10);
  expect(before.gfx.compositeScale).toBeCloseTo(1280 / 1920, 10);
  expect(before.gfx.downgrades).toBe(0);
  expectTexts(before.texts, before.gfx.zoom, '하향 전');

  // 조준을 둔다 (괴물 대기 시간에도 서버는 목표 각도를 받는다). 이후 마우스는 움직이지 않는다
  await page.evaluate(
    ([id, x, y]) => window.__DECOY__?.sendTest({ kind: 'teleport', target: id, x, y, face: 0 }),
    [me, SPOT.x, SPOT.y] as const,
  );
  await page.waitForTimeout(400);
  const aimAt = await page.evaluate((t) => window.__DECOY__?.tileToClient(t.x, t.y) ?? null, AIM);
  expect(aimAt).not.toBeNull();
  await page.mouse.move(aimAt!.x, aimAt!.y);
  const expectedAim = Math.atan2(AIM.y - SPOT.y, AIM.x - SPOT.x);
  const aimErr = async (): Promise<number> => {
    const t = await truth(page, code);
    return (angDiff(t.monster!.aim, expectedAim) * 180) / Math.PI;
  };
  await page.waitForTimeout(900);
  const errBefore = await aimErr();
  expect(errBefore, '하향 전 조준 오차').toBeLessThan(2);

  // 폴링은 rAF가 아니라 시간 간격으로 (느린 프레임에서도 하향을 바로 알아채고 FPS 60을 넣어야 효과 확인이 맞다)
  await page.waitForFunction(() => (window.__DECOY__?.gfx.downgrades ?? 0) >= 1, null, {
    timeout: FPS_WATCH.warmupMs + FPS_WATCH.sustainMs + 30_000,
    polling: 100,
  });
  // 하향이 효과가 있었던 것으로 (FPS 60): 효과 확인 뒤에도 중간으로 남는다
  await page.evaluate(() => window.__DECOY__?.injectFps(60));
  console.log(`FPS 20 주입 뒤 ${((Date.now() - startedAt) / 1000).toFixed(1)}초에 한 단계 내림`);

  // 백버퍼 640×360 × 1.5 (applyResolution), 안개 재구성은 다음 그리기에서
  await page.waitForFunction(
    () => document.querySelector<HTMLCanvasElement>('#game-root canvas')?.width === 960,
    null,
    { timeout: 20_000, polling: 100 },
  );
  await page.waitForFunction(() => window.__DECOY__?.gfx.compositeScale === 0.5, null, {
    timeout: 20_000,
    polling: 100,
  });
  const after = await state(page);
  expect([after.canvasW, after.canvasH]).toEqual([960, 540]);
  expect(after.gfx.quality).toBe('medium');
  expect(after.gfx.downgrades).toBe(1);
  expect(after.gfx.zoom).toBe(0.5);
  expect(after.gfx.compositeScale).toBe(0.5);
  expect(after.gfx.features.autoDowngrade).toBe('checking');
  expectTexts(after.texts, 0.5, '하향 뒤');

  // 마우스를 움직이지 않았는데 조준이 그대로 (포인터 좌표를 새 백버퍼 배율로 옮겼다)
  await page.waitForTimeout(700);
  const errAfter = await aimErr();
  console.log(`조준 오차: 하향 전 ${errBefore.toFixed(2)}°, 하향 뒤 ${errAfter.toFixed(2)}°`);
  expect(errAfter, '하향 뒤 조준 유지').toBeLessThan(2);

  // 이동 키가 서버에 닿는다 (아래로), 입력 확인 번호가 계속 는다
  const p0 = (await truth(page, code)).players.find((p) => p.id === me)!;
  const ack0 = (await state(page)).ack;
  await page.keyboard.down('KeyS');
  await page.waitForTimeout(500);
  await page.keyboard.up('KeyS');
  await page.waitForTimeout(500);
  const p1 = (await truth(page, code)).players.find((p) => p.id === me)!;
  const s1 = await state(page);
  console.log(`이동: y ${p0.y.toFixed(2)} → ${p1.y.toFixed(2)}, 입력 확인 ${ack0} → ${s1.ack}`);
  expect(p1.y - p0.y, '하향 뒤 이동').toBeGreaterThan(0.3);
  expect(s1.ack - ack0, '입력 확인 번호').toBeGreaterThanOrEqual(10);

  // 같은 사람 · 같은 연결 · 판 그대로
  expect(await page.evaluate(() => window.__DECOY__?.you ?? '')).toBe(me);
  expect(s1.snapCount).toBeGreaterThan(before.snapCount);
  expect(sockets).toBe(1);
  expect(await page.evaluate(() => window.__DECOY__?.phase ?? null)).toBe('playing');

  // 효과 확인: FPS가 올랐으니 중간을 유지하고 자동 하향은 다시 감시 상태
  await page.waitForFunction(() => window.__DECOY__?.gfx.features.autoDowngrade === 'on', null, {
    timeout: DOWNGRADE_CHECK.settleMs + DOWNGRADE_CHECK.measureMs + 30_000,
    polling: 200,
  });
  const kept = await state(page);
  expect([kept.gfx.quality, kept.gfx.downgrades, kept.canvasW]).toEqual(['medium', 1, 960]);

  await page.evaluate(() => window.__DECOY__?.injectFps(null));
  expect(problems).toEqual([]);
  await context.close();
});

// 따라가는 카메라 3단계: 기존 · 새 캐릭터 스타일을 확대 화면(② 3)에서 나란히 (npx playwright test --config tests/camera/playwright.config.ts char-compare)
//  - 같은 장면 · 같은 순간: 봇을 멈추고 장식 시계를 멈춘 뒤 스타일만 바꿔(디버그 setCharStyle — 판 장면이 그 자리에서 다시 굽는다) 두 번 찍는다
//  - 기기: 휴대폰 800×360(배율 3) 중간 · 낮음, PC 1920×1080 높음
//  - 장면: 생존자 화면(러너 — 세 역할 + 괴물이 한 화면), 괴물 화면(탐색 시야 안 세 생존자 = 흰 공통 그림)
//  - 결과: artifacts/camera/chars/<기기>-<장면>-<스타일>.png (캐릭터 둘레 자른 그림, 기기 px 그대로) + manifest.json
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type BrowserContextOptions, type Page } from '@playwright/test';
import type { Role } from '@decoy/shared';
import { openTab, placeBots, placeSelf, press, send, settleHud } from './shotKit';

const OUT = 'artifacts/camera/chars';
const phone: BrowserContextOptions = {
  viewport: { width: 800, height: 360 },
  screen: { width: 800, height: 360 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
};
const DEVICES: { name: string; ctx: BrowserContextOptions; quality: string; renderer: string }[] = [
  { name: 'phone-medium', ctx: phone, quality: 'medium', renderer: 'webgl' },
  { name: 'phone-low', ctx: phone, quality: 'low', renderer: 'canvas' },
  {
    name: 'pc-high',
    ctx: { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 },
    quality: 'high',
    renderer: 'webgl',
  },
];
const problems: string[] = [];
const records: {
  file: string;
  device: string;
  scene: string;
  style: string;
  atlasBytes: number;
  tpw: number;
}[] = [];

async function startMatch(
  page: Page,
  role: Role,
  quality: string,
  renderer: string,
): Promise<{ code: string; you: string }> {
  await page.goto(`/?debug=hook&renderer=${renderer}&quality=${quality}&chars=classic&bots=1`);
  await expect(page.getByTestId('server-status')).toHaveAttribute('data-state', 'connected');
  await press(page, 'create-room');
  await expect(page.getByTestId('room-code')).toHaveText(/^[A-Z]{4}$/);
  const code = (await page.getByTestId('room-code').textContent()) ?? '';
  await press(page, `role-${role}`);
  await press(page, 'ready-button');
  await press(page, 'start-button');
  await page.waitForFunction(() => (window.__DECOY__?.snapCount ?? 0) >= 3, null, { timeout: 30_000 });
  await page.evaluate(() => window.__DECOY__?.injectFps(60));
  return { code, you: await page.evaluate(() => window.__DECOY__?.you ?? '') };
}

/** 두 스타일로 같은 자리를 찍는다 (캐릭터 타일 자리 둘레를 자른다) */
async function shootBoth(
  page: Page,
  device: string,
  scene: string,
  tiles: readonly [number, number][],
): Promise<void> {
  const pts = await page.evaluate((ts) => ts.map(([x, y]) => window.__DECOY__!.tileToClient(x, y)!), tiles);
  const k = await page.evaluate(() => {
    const a = window.__DECOY__!.tileToClient(0, 0)!;
    const b = window.__DECOY__!.tileToClient(1, 0)!;
    return b.x - a.x;
  });
  const vp = page.viewportSize()!;
  const pad = k * 1.4;
  const x0 = Math.max(0, Math.min(...pts.map((p) => p.x)) - pad);
  const y0 = Math.max(0, Math.min(...pts.map((p) => p.y)) - pad);
  const x1 = Math.min(vp.width, Math.max(...pts.map((p) => p.x)) + pad);
  const y1 = Math.min(vp.height, Math.max(...pts.map((p) => p.y)) + pad);
  for (const style of ['classic', 'new'] as const) {
    await page.evaluate((s) => window.__DECOY__?.setCharStyle(s), style);
    await page.waitForFunction((s) => window.__DECOY__?.gfx.features.atlasStyle === s, style);
    await page.waitForTimeout(600);
    const file = `${device}-${scene}-${style}.png`;
    await page.screenshot({ path: join(OUT, file), clip: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } });
    const f = await page.evaluate(() => window.__DECOY__!.gfx.features);
    records.push({
      file,
      device,
      scene,
      style,
      atlasBytes: Number(f.atlasBytes ?? 0),
      tpw: Number(f.atlasTexPerWorld ?? 0),
    });
  }
}

test.beforeAll(() => {
  mkdirSync(OUT, { recursive: true });
});

test.afterAll(() => {
  writeFileSync(
    join(OUT, 'manifest.json'),
    `${JSON.stringify({ createdAt: new Date().toISOString(), records, problems }, null, 2)}\n`,
  );
});

for (const dev of DEVICES) {
  test(`${dev.name}: 생존자 화면 기존 · 새`, async ({ browser }) => {
    const tab = await openTab(browser, dev.ctx, `${dev.name} 생존자`, problems);
    const { page } = tab;
    const { code, you } = await startMatch(page, 'runner', dev.quality, dev.renderer);
    // 거점 B 방: 러너 가운데, 가드 · 스카우트 · 괴물이 러너 시야 안 (모두 한 화면)
    await placeBots(page, code, [
      ['guard', 40.4, 14.8, 2.6],
      ['scout', 41.6, 17.4, -2.2],
      ['monster', 36.2, 18.6, -0.5],
    ]);
    await placeSelf(page, code, you, 38.4, 16.2, 0.4);
    await settleHud(page);
    await page.evaluate(() => window.__DECOY__?.freezeClock(12_000));
    await page.waitForTimeout(1500);
    await shootBoth(page, dev.name, 'survivor', [
      [38.4, 16.2],
      [40.4, 14.8],
      [41.6, 17.4],
      [36.2, 18.6],
    ]);
    await tab.close();
  });

  test(`${dev.name}: 괴물 화면 기존 · 새`, async ({ browser }) => {
    const tab = await openTab(browser, dev.ctx, `${dev.name} 괴물`, problems);
    const { page } = tab;
    const { code, you } = await startMatch(page, 'monster', dev.quality, dev.renderer);
    await placeBots(page, code, [
      ['runner', 40.6, 17.6, 0.4],
      ['guard', 38.6, 16.4, -0.6],
      ['scout', 39.8, 15.0, 1.2],
    ]);
    await page.waitForFunction(() => (window.__DECOY__?.getLastSnapshot()?.you.move.frozen ?? 1) <= 0, null, {
      timeout: 20_000,
    });
    await placeSelf(page, code, you, 39.6, 20.2, -Math.PI / 2);
    await settleHud(page);
    await send(page, { kind: 'freeze', target: you, frozen: true });
    await page.evaluate(() => window.__DECOY__?.freezeClock(12_000));
    await page.waitForTimeout(2500);
    await shootBoth(page, dev.name, 'monster', [
      [39.6, 20.2],
      [40.6, 17.6],
      [38.6, 16.4],
      [39.8, 15.0],
    ]);
    await tab.close();
  });
}

// 따라가는 카메라 최종 확인 촬영 (npx playwright test --config tests/camera/playwright.config.ts final-shots)
//  - 기기: 휴대폰 가로 800×360(배율 3) · 915×412(배율 2.625) · 16:9 640×360(배율 3), 태블릿 1024×768(배율 2), PC 1920×1080
//  - 장면: 생존자 화면 화면 밖 화살표(팀원 · 공유 시야 괴물 · 점령 중 거점), 괴물 화면(점령 알림 · 포효로 드러난 자리),
//    수감 중 관전(동료 화면으로 옮겨 보기)
//  - 결과: artifacts/camera/final/<기기>/<장면>.png + manifest.json(카메라 창 · 화살표 · 콘솔 문제)
// 확대는 기본값(② 3), 캐릭터 스타일은 새 캐릭터(?chars=new)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type BrowserContextOptions, type Page } from '@playwright/test';
import type { CameraDebug, Role } from '@decoy/shared';
import { openTab, placeBots, placeSelf, players, press, send, settleHud } from './shotKit';

const OUT = 'artifacts/camera/final';
const touchCtx = (w: number, h: number, dpr: number): BrowserContextOptions => ({
  viewport: { width: w, height: h },
  screen: { width: w, height: h },
  deviceScaleFactor: dpr,
  isMobile: true,
  hasTouch: true,
});
export const FINAL_DEVICES: { name: string; ctx: BrowserContextOptions; quality: string }[] = [
  { name: 'phone-800x360', ctx: touchCtx(800, 360, 3), quality: 'medium' },
  { name: 'phone-915x412', ctx: touchCtx(915, 412, 2.625), quality: 'medium' },
  { name: 'phone-640x360', ctx: touchCtx(640, 360, 3), quality: 'medium' },
  { name: 'tablet-1024x768', ctx: touchCtx(1024, 768, 2), quality: 'medium' },
  {
    name: 'pc-1920x1080',
    ctx: { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 },
    quality: 'high',
  },
];
const ONLY = process.env.DECOY_CAMERA_DEVICE ?? '';
const SCENES = (process.env.DECOY_CAMERA_SCENES ?? 'survivor,monster,spectate').split(',');
const CLOCK_MS = 12_000;

interface Shot {
  file: string;
  device: string;
  scene: string;
  camera: CameraDebug | null;
}
const shots: Shot[] = [];
const problems: string[] = [];

async function startMatch(page: Page, role: Role, quality: string): Promise<{ code: string; you: string }> {
  await page.goto(`/?debug=hook&renderer=webgl&quality=${quality}&chars=new&bots=1`);
  await expect(page.getByTestId('server-status')).toHaveAttribute('data-state', 'connected');
  await press(page, 'create-room');
  await expect(page.getByTestId('room-code')).toHaveText(/^[A-Z]{4}$/);
  const code = (await page.getByTestId('room-code').textContent()) ?? '';
  await press(page, `role-${role}`);
  await expect(page.getByTestId(`role-${role}`)).toHaveClass(/mine/);
  await press(page, 'ready-button');
  await press(page, 'start-button');
  await page.waitForFunction(() => (window.__DECOY__?.snapCount ?? 0) >= 3, null, { timeout: 30_000 });
  await page.evaluate(() => window.__DECOY__?.injectFps(60));
  return { code, you: await page.evaluate(() => window.__DECOY__?.you ?? '') };
}

async function shoot(page: Page, device: string, scene: string, settleMs = 1500): Promise<void> {
  await page.waitForTimeout(settleMs);
  const camera = await page.evaluate(() => window.__DECOY__?.getCamera() ?? null);
  const file = join(device, `${scene}.png`);
  mkdirSync(join(OUT, device), { recursive: true });
  await page.screenshot({ path: join(OUT, file) });
  shots.push({ file, device, scene, camera });
}

test.beforeAll(() => {
  mkdirSync(OUT, { recursive: true });
});

test.afterAll(() => {
  let old: Shot[] = [];
  try {
    old = (JSON.parse(readFileSync(join(OUT, 'manifest.json'), 'utf8')) as { shots?: Shot[] }).shots ?? [];
  } catch {
    old = [];
  }
  const all = [...old.filter((o) => !shots.some((n) => n.file === o.file)), ...shots];
  all.sort((a, b) => (a.file < b.file ? -1 : 1));
  writeFileSync(
    join(OUT, 'manifest.json'),
    `${JSON.stringify({ createdAt: new Date().toISOString(), shots: all, problems }, null, 2)}\n`,
  );
});

for (const dev of FINAL_DEVICES) {
  if (ONLY && !dev.name.includes(ONLY)) continue;
  const touch = dev.ctx.hasTouch === true;

  if (SCENES.includes('survivor'))
    test(`${dev.name}: 생존자 화면 화면 밖 화살표`, async ({ browser }) => {
      const tab = await openTab(browser, dev.ctx, `${dev.name} 생존자`, problems);
      const { page } = tab;
      const { code, you } = await startMatch(page, 'runner', dev.quality);
      // 러너는 거점 A 방. 가드는 거점 B를 점령 중이고 그 시야 안에 괴물(공유 시야), 스카우트는 북쪽 탈출구 근처
      await placeBots(page, code, [
        ['guard', 40.5, 15.2, Math.PI],
        ['monster', 37.6, 18.4, -0.6],
        ['scout', 25.5, 4.5, 0.3],
      ]);
      await placeSelf(page, code, you, 9.5, 17, 0);
      await send(page, { kind: 'setPoint', point: 'B', progress: 0.42 });
      await settleHud(page);
      await send(page, { kind: 'setTime', timeLeft: 522.4 });
      await page.evaluate((ms) => window.__DECOY__?.freezeClock(ms), CLOCK_MS);
      await expect
        .poll(() =>
          page.evaluate(() => (window.__DECOY__?.getCamera()?.markers ?? []).map((m) => m.kind).sort()),
        )
        .toEqual(expect.arrayContaining(['monster', 'point', 'teammate', 'teammate']));
      await shoot(page, dev.name, 'survivor-arrows');
      await tab.close();
    });

  if (SCENES.includes('monster'))
    test(`${dev.name}: 괴물 화면 점령 알림 · 포효로 드러난 자리`, async ({ browser }) => {
      const tab = await openTab(browser, dev.ctx, `${dev.name} 괴물`, problems);
      const { page } = tab;
      const { code, you } = await startMatch(page, 'monster', dev.quality);
      // 괴물은 남쪽 복도에서 남쪽을 본다(창이 맵 아래 끝에 붙는다). 러너는 거점 A 점령 중(포효 반지름 밖), 스카우트 · 가드는
      // 포효 반지름(10타일) 안이지만 창 밖(위로 8타일 · 오른쪽 9타일) — 포효로 드러난 자리가 가장자리 화살표로 나온다
      await placeBots(page, code, [
        ['runner', 8.4, 16.2, 0],
        ['scout', 19.5, 16.5, -1.2],
        ['guard', 29.5, 25.5, 0.4],
      ]);
      await page.waitForFunction(
        () => (window.__DECOY__?.getLastSnapshot()?.you.move.frozen ?? 1) <= 0,
        null,
        {
          timeout: 20_000,
        },
      );
      await placeSelf(page, code, you, 20.5, 24.5, Math.PI / 2);
      await settleHud(page);
      await send(page, { kind: 'setTime', timeLeft: 501.7 });
      await expect
        .poll(() =>
          page.evaluate(
            () => window.__DECOY__?.getLastSnapshot()?.world.points.find((p) => p.id === 'A')?.state,
          ),
        )
        .toBe('capturing');
      await page.evaluate((ms) => window.__DECOY__?.freezeClock(ms), CLOCK_MS);
      // 포효 (Q 키, 터치 화면도): 헤드리스 SwiftShader에서는 DOM 버튼을 탭한 뒤 다른 DOM 버튼 타일이 엉뚱한 자리에 한 벌 더
      // 찍히는 합성 잔상이 있다(확대 1에서도 같음, 화면 DOM은 정상 — HUMAN_CHECKS). 드러난 자리는 1.5초만 보이므로 화살표가
      // 나오자마자 찍는다
      await page.keyboard.press('KeyQ');
      await page.waitForFunction(
        () => (window.__DECOY__?.getCamera()?.markers ?? []).filter((m) => m.kind === 'roarPing').length >= 2,
        null,
        { timeout: 5_000, polling: 'raf' },
      );
      await shoot(page, dev.name, 'monster-arrows', 0);
      await tab.close();
    });

  if (SCENES.includes('spectate'))
    test(`${dev.name}: 수감 중 관전`, async ({ browser }) => {
      const tab = await openTab(browser, dev.ctx, `${dev.name} 관전`, problems);
      const { page } = tab;
      const { code, you } = await startMatch(page, 'scout', dev.quality);
      await placeBots(page, code, [
        ['runner', 40.4, 15.6, 2.4],
        ['guard', 9.5, 16.5, 0],
        ['monster', 30.5, 9.5, 0.5],
      ]);
      await placeSelf(page, code, you, 23.5, 15.5, 0);
      await send(page, { kind: 'setSurvivor', target: you, status: 'imprisoned', imprisonCount: 1 });
      await send(page, { kind: 'setPoint', point: 'B', progress: 0.3 });
      await settleHud(page);
      await send(page, { kind: 'setTime', timeLeft: 410.2 });
      await expect.poll(() => page.evaluate(() => window.__DECOY__?.getCamera()?.canSpectate)).toBe(true);
      // 첫 동료(카드 순서: 러너)로 옮겨 본다 — 터치: 카드 탭, PC: 숫자 키
      const runner = (await players(page, code)).find((p) => p.role === 'runner')?.id ?? '';
      if (touch) {
        const card = await page.evaluate(() => window.__DECOY__?.getSpectateCards() ?? []);
        const c = card.find((x) => x.id !== null && x.index === 0);
        if (!c) throw new Error('관전 카드 없음');
        await page.touchscreen.tap(c.x + c.w / 2, c.y + c.h / 2);
      } else await page.keyboard.press('Digit1');
      await expect.poll(() => page.evaluate(() => window.__DECOY__?.getCamera()?.spectating)).toBe(runner);
      await page.evaluate((ms) => window.__DECOY__?.freezeClock(ms), CLOCK_MS);
      await shoot(page, dev.name, 'spectate', 1200);
      await tab.close();
    });
}

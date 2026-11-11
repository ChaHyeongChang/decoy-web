// 입체감 시안 비교 촬영 (VISUAL_SPEC 14장 · DECISIONS 17절): npx playwright test --config tests/depth/playwright.config.ts
//  - 기기 둘: PC 1920×1080(배율 1, 품질 높음) · 아이폰 14 가로 844×390(배율 3, 터치, 품질 중간)
//  - 시안 넷: off = 입체감 끔(전), a = 낮게 · 옅게, b = 중간, c = 높게 · 진하게 (주소 ?depth=0 · ?depthLook=)
//  - 장면 둘: 생존자 화면(러너 — 북쪽 벽 · 기둥 남쪽 면이 시야 빛을 받고, 가드는 벽 북쪽(띄운 윗면 아래)에 선다),
//    괴물 화면(탐색 시야 북쪽 — 생존자 하나가 기둥 북쪽(띄운 윗면 아래)에 선다, 셋 모두 흰색)
//  - 결과: artifacts/depth/shots/<기기>/<시안>-<장면>.png + manifest.json (입체감 디버그 값 · 콘솔 문제)
// 고르는 법 · 결과는 docs/DECISIONS.md 17절, 비교 그림은 scripts/depth-compare.mjs가 만든다
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type BrowserContextOptions, type Page } from '@playwright/test';
import type { DepthDebugInfo, Role } from '@decoy/shared';
import { MultiTouch } from '../e2e/touch';
import { openTab, placeBots, placeSelf, press, send, settleHud } from '../camera/shotKit';

const OUT = 'artifacts/depth/shots';
const DEVICES: { name: string; ctx: BrowserContextOptions; quality: string }[] = [
  {
    name: 'pc-1920x1080',
    ctx: { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 },
    quality: 'high',
  },
  {
    name: 'iphone14-844x390',
    ctx: {
      viewport: { width: 844, height: 390 },
      screen: { width: 844, height: 390 },
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
    },
    quality: 'medium',
  },
];
const VARIANTS = (process.env.DECOY_DEPTH_VARIANTS ?? 'off,a,b,c').split(',');
const ONLY = process.env.DECOY_DEPTH_DEVICE ?? '';
const SCENES = (process.env.DECOY_DEPTH_SCENES ?? 'survivor,monster').split(',');
const CLOCK_MS = 12_000;

interface Shot {
  file: string;
  device: string;
  variant: string;
  scene: string;
  depth: DepthDebugInfo | null;
}
const shots: Shot[] = [];
const problems: string[] = [];

function query(variant: string): string {
  return variant === 'off' ? '&depth=0' : `&depth=1&depthLook=${variant}`;
}

async function soloMatch(
  page: Page,
  role: Role,
  quality: string,
  variant: string,
): Promise<{ code: string; you: string }> {
  await page.goto(`/?debug=hook&renderer=webgl&quality=${quality}&chars=new&cam=3&bots=1${query(variant)}`);
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

async function shoot(page: Page, device: string, variant: string, scene: string): Promise<void> {
  await page.waitForTimeout(1500);
  const depth = await page.evaluate(() => window.__DECOY__?.getDepth() ?? null);
  const file = join(device, `${variant}-${scene}.png`);
  mkdirSync(join(OUT, device), { recursive: true });
  await page.screenshot({ path: join(OUT, file) });
  shots.push({ file, device, variant, scene, depth });
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

for (const dev of DEVICES) {
  if (ONLY && !dev.name.includes(ONLY)) continue;
  for (const variant of VARIANTS) {
    if (SCENES.includes('survivor'))
      test(`${dev.name} 시안 ${variant}: 생존자 화면`, async ({ browser }) => {
        const tab = await openTab(browser, dev.ctx, `${dev.name} ${variant} 생존자`, problems);
        const { page } = tab;
        const { code, you } = await soloMatch(page, 'runner', dev.quality, variant);
        // 러너는 감옥 북쪽 마당: 북쪽 벽 기둥 (20–21 · 28–29, 8–11) · 기둥 (23–24, 10–11)의 남쪽 면이 시야 빛을 받는다.
        // 가드는 동쪽 벽 덩어리 북쪽(띄운 윗면 아래 — 반투명), 괴물은 시야 안 동쪽에서 등을 돌리고 있다, 스카우트는 서쪽
        await placeBots(page, code, [
          ['guard', 28.6, 7.62, -Math.PI / 2],
          ['scout', 18.2, 13.4, 0.2],
          ['monster', 27.6, 13.9, 0],
        ]);
        await placeSelf(page, code, you, 24.2, 13.1, -Math.PI / 2);
        await settleHud(page);
        await send(page, { kind: 'setTime', timeLeft: 522.4 });
        await page.evaluate((ms) => window.__DECOY__?.freezeClock(ms), CLOCK_MS);
        await placeBots(page, code, [['monster', 27.6, 13.9, 0]]);
        await shoot(page, dev.name, variant, 'survivor');
        await tab.close();
      });

    if (SCENES.includes('monster'))
      test(`${dev.name} 시안 ${variant}: 괴물 화면`, async ({ browser }) => {
        const tab = await openTab(browser, dev.ctx, `${dev.name} ${variant} 괴물`, problems);
        const { page } = tab;
        const { code, you } = await soloMatch(page, 'monster', dev.quality, variant);
        // 괴물은 기둥 (23–24, 10–11) 남동쪽에서 북쪽을 본다. 생존자: 하나는 기둥 북동쪽(띄운 윗면 아래), 둘은 탁 트인 자리
        await placeBots(page, code, [
          ['runner', 24.9, 9.45, 0.4],
          ['guard', 21.6, 12.6, -0.6],
          ['scout', 28.0, 10.8, 1.2],
        ]);
        await page.waitForFunction(
          () => (window.__DECOY__?.getLastSnapshot()?.you.move.frozen ?? 1) <= 0,
          null,
          { timeout: 20_000 },
        );
        const touch = dev.ctx.hasTouch === true;
        const aimNorth = async (): Promise<boolean> => {
          const r = await page.request.get(`/test/state?room=${code}`);
          const t = (await r.json()) as { monster: { aim: number } | null };
          return Math.abs((t.monster?.aim ?? 0) + Math.PI / 2) < 0.2;
        };
        if (touch) {
          for (let attempt = 0; attempt < 4; attempt += 1) {
            await placeSelf(page, code, you, 26.2, 13.4, -Math.PI / 2);
            const zone = await page.evaluate(
              () => window.__DECOY__?.getTouchTargets().find((t) => t.id === 'move-zone') ?? null,
            );
            if (!zone) throw new Error('이동 영역 없음');
            const mt = await MultiTouch.attach(page);
            const sx = zone.x + zone.w * 0.5;
            const sy = zone.y + zone.h * 0.75;
            await mt.down(1, sx, sy);
            await mt.move(1, sx, sy - 50, { steps: 6, stepMs: 34 });
            await page.waitForTimeout(600);
            await mt.up(1);
            await mt.detach();
            await page.waitForTimeout(300);
            if (await aimNorth()) break;
          }
        }
        await placeSelf(page, code, you, 26.2, 12.9, -Math.PI / 2);
        if (!touch) {
          for (let i = 0; i < 4; i += 1) {
            const aim = await page.evaluate(() => window.__DECOY__?.tileToClient(26.2, 7) ?? null);
            if (aim) await page.mouse.move(aim.x, aim.y, { steps: 3 });
            await page.waitForTimeout(400);
          }
        }
        await expect
          .poll(async () => {
            const r = await page.request.get(`/test/state?room=${code}`);
            const t = (await r.json()) as { monster: { aim: number } | null };
            return Math.abs((t.monster?.aim ?? 0) + Math.PI / 2);
          })
          .toBeLessThan(0.2);
        await settleHud(page);
        await send(page, { kind: 'setTime', timeLeft: 522.4 });
        await page.evaluate((ms) => window.__DECOY__?.freezeClock(ms), CLOCK_MS);
        await shoot(page, dev.name, variant, 'monster');
        await tab.close();
      });
  }
}

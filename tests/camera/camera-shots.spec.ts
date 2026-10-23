// 따라가는 카메라 1단계: 확대 수준 후보 비교 촬영 (npx playwright test --config tests/camera/playwright.config.ts)
//  - 기기 셋: 휴대폰 가로 800×360(배율 3) · 915×412(배율 2.625), PC 1920×1080(배율 1)
//  - 확대 넷: 1 = 지금(맵 전체 고정), 4 = ① 가깝게(맵 가로 1/4), 3 = ② 중간(1/3), 2 = ③ 넓게(1/2)
//  - 장면 셋: 생존자 화면(러너, 거점 B 방), 괴물 화면 탐색 시야 · 추적 시야(북쪽 조준 — 부채꼴이 화면 세로로 가장 긴 경우)
//  - 결과: artifacts/camera/shots/<기기>/z<확대>-<장면>.png + artifacts/camera/shots/manifest.json(카메라 창 · 콘솔 문제)
// 확대는 시험 · 촬영용 ?cam(로컬 주소에서만 받는다). 캐릭터 스타일은 새 캐릭터(?chars=new): 이번 작업의 대상 그림
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Browser, type BrowserContextOptions, type Page } from '@playwright/test';
import type { CameraDebug, Role, TestCommand } from '@decoy/shared';
import { watchConsole } from '../e2e/helpers';
import { MultiTouch } from '../e2e/touch';

const OUT = 'artifacts/camera/shots';
const log = (m: string): void => {
  if (process.env.DECOY_CAMERA_LOG) console.log(m);
};
const DEVICES: { name: string; ctx: BrowserContextOptions; quality: string }[] = [
  {
    name: 'phone-800x360',
    ctx: {
      viewport: { width: 800, height: 360 },
      screen: { width: 800, height: 360 },
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
    },
    quality: 'medium',
  },
  {
    name: 'phone-915x412',
    ctx: {
      viewport: { width: 915, height: 412 },
      screen: { width: 915, height: 412 },
      deviceScaleFactor: 2.625,
      isMobile: true,
      hasTouch: true,
    },
    quality: 'medium',
  },
  {
    name: 'pc-1920x1080',
    ctx: { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 },
    quality: 'high',
  },
];
const ZOOMS = (process.env.DECOY_CAMERA_ZOOMS ?? '1,4,3,2').split(',').map(Number);
const ONLY = process.env.DECOY_CAMERA_DEVICE ?? '';
const CLOCK_MS = 12_000;

interface Shot {
  file: string;
  device: string;
  zoom: number;
  scene: string;
  camera: CameraDebug | null;
}
const shots: Shot[] = [];
const problems: string[] = [];

async function send(page: Page, cmd: TestCommand): Promise<void> {
  await page.evaluate((c) => window.__DECOY__?.sendTest(c), cmd);
}

async function press(page: Page, testId: string): Promise<void> {
  const el = page.getByTestId(testId);
  await expect(el).toBeEnabled();
  if (await page.evaluate(() => matchMedia('(pointer: coarse)').matches)) await el.tap();
  else await el.click();
}

interface Tab {
  page: Page;
  close(): Promise<void>;
}

async function openTab(browser: Browser, ctx: BrowserContextOptions, label: string): Promise<Tab> {
  const context = await browser.newContext(ctx);
  await context.addInitScript(() => {
    try {
      localStorage.setItem('decoy:touchTutorial', '1');
    } catch {
      // 저장소가 막혀도 촬영은 한다
    }
  });
  const page = await context.newPage();
  const list: string[] = [];
  watchConsole(page, list);
  return {
    page,
    close: async () => {
      problems.push(...list.map((p) => `${label} ${p}`));
      await context.close();
    },
  };
}

async function soloMatch(
  page: Page,
  role: Role,
  zoom: number,
  quality: string,
): Promise<{ code: string; you: string }> {
  await page.goto(`/?debug=hook&renderer=webgl&quality=${quality}&chars=new&cam=${zoom}&bots=1`);
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

interface TruthPlayer {
  id: string;
  role: string;
  x: number;
  y: number;
}

async function players(page: Page, code: string): Promise<TruthPlayer[]> {
  const r = await page.request.get(`/test/state?room=${code}`);
  expect(r.ok()).toBe(true);
  return ((await r.json()) as { players: TruthPlayer[] }).players;
}

async function placeBots(
  page: Page,
  code: string,
  spots: readonly (readonly [Role, number, number, number])[],
): Promise<void> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const all = await players(page, code);
    for (const [role, x, y, face] of spots) {
      const p = all.find((q) => q.role === role);
      if (!p) throw new Error(`봇 ${role} 없음`);
      await send(page, { kind: 'teleport', target: p.id, x, y, face });
      await send(page, { kind: 'freeze', target: p.id, frozen: true });
    }
    await page.waitForTimeout(200);
    const now = await players(page, code);
    const off = spots.some(([role, x, y]) => {
      const p = now.find((q) => q.role === role);
      return !p || Math.hypot(p.x - x, p.y - y) > 1e-3;
    });
    if (!off) return;
  }
  throw new Error('봇을 자리에 놓지 못함');
}

async function placeSelf(
  page: Page,
  code: string,
  you: string,
  x: number,
  y: number,
  face: number,
): Promise<void> {
  await send(page, { kind: 'teleport', target: you, x, y, face });
  await expect
    .poll(async () => {
      const me = (await players(page, code)).find((p) => p.id === you);
      return me !== undefined && Math.hypot(me.x - x, me.y - y) < 0.05;
    })
    .toBe(true);
  await page.waitForFunction(
    ([tx, ty]) => {
      const st = window.__DECOY__?.getLocalState();
      return st !== null && st !== undefined && Math.hypot(st.x - tx!, st.y - ty!) < 0.05;
    },
    [x, y],
    { timeout: 20_000 },
  );
}

async function tapTarget(page: Page, id: string): Promise<void> {
  const t = await page.evaluate(
    (want) => window.__DECOY__?.getTouchTargets().find((x) => x.id === want) ?? null,
    id,
  );
  if (!t) throw new Error(`터치 대상 ${id} 없음`);
  await page.touchscreen.tap(t.x + t.w / 2, t.y + t.h / 2);
}

async function shoot(page: Page, device: string, zoom: number, scene: string): Promise<void> {
  // 카메라가 자리 잡을 때까지 (따라가기 · 앞당김 시간 상수의 몇 배)
  await page.waitForTimeout(1500);
  const camera = await page.evaluate(() => window.__DECOY__?.getCamera() ?? null);
  const file = join(device, `z${zoom}-${scene}.png`);
  mkdirSync(join(OUT, device), { recursive: true });
  await page.screenshot({ path: join(OUT, file) });
  shots.push({ file, device, zoom, scene, camera });
}

/** 판 시작 알림 · 처음 위치 표시가 걷히고 조작 안내를 닫는다 */
async function settleHud(page: Page): Promise<void> {
  await page.waitForFunction(() => (window.__DECOY__?.getBanners() ?? []).length === 0, null, {
    timeout: 30_000,
  });
  // PC 첫 판 조작 안내: 아무 키나 누르면 닫힌다 (움직이지 않는 키)
  await page.keyboard.press('KeyZ');
  await page.waitForTimeout(300);
}

test.beforeAll(() => {
  mkdirSync(OUT, { recursive: true });
});

test.afterAll(() => {
  // 일부 장면만 다시 찍으면 나머지 장면 기록은 남긴다
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
  for (const zoom of ZOOMS) {
    test(`${dev.name} 확대 ${zoom}: 생존자 화면`, async ({ browser }) => {
      const tab = await openTab(browser, dev.ctx, `${dev.name} z${zoom} 생존자`);
      const { page } = tab;
      const { code, you } = await soloMatch(page, 'runner', zoom, dev.quality);
      // 러너는 거점 B 방 가운데. 가드는 거점 B 점령 중, 스카우트는 방 밖 북서쪽(7.5타일),
      // 괴물은 러너 시야 안 남쪽(약 4.6타일)에서 등을 돌리고 있다 — 확대에 따라 화면 안 · 밖이 갈린다
      await placeBots(page, code, [
        ['guard', 40.5, 15.2, Math.PI],
        ['scout', 31, 12.6, 0.3],
        ['monster', 36.4, 20.9, Math.PI / 2],
      ]);
      await placeSelf(page, code, you, 38, 16.5, 0);
      await send(page, { kind: 'setPoint', point: 'B', progress: 0.42 });
      await settleHud(page);
      await send(page, { kind: 'setTime', timeLeft: 522.4 });
      await page.evaluate((ms) => window.__DECOY__?.freezeClock(ms), CLOCK_MS);
      await placeBots(page, code, [['monster', 36.4, 20.9, Math.PI / 2]]);
      await shoot(page, dev.name, zoom, 'survivor');
      await tab.close();
    });

    test(`${dev.name} 확대 ${zoom}: 괴물 화면 탐색 · 추적`, async ({ browser }) => {
      const tab = await openTab(browser, dev.ctx, `${dev.name} z${zoom} 괴물`);
      const { page } = tab;
      const { code, you } = await soloMatch(page, 'monster', zoom, dev.quality);
      // 괴물은 거점 B 방 남쪽에서 북쪽을 본다. 생존자: 러너 3.3타일 · 가드 4.9타일(탐색 시야 안), 스카우트 8.1타일(추적 시야에서만)
      await placeBots(page, code, [
        ['runner', 40.6, 17.2, 0.4],
        ['guard', 38.7, 15.9, -0.6],
        ['scout', 39.6, 12.4, 1.2],
      ]);
      log('step: ' + 'await page.waitForFunction(() => (window');
      await page.waitForFunction(
        () => (window.__DECOY__?.getLastSnapshot()?.you.move.frozen ?? 1) <= 0,
        null,
        {
          timeout: 20_000,
        },
      );
      log('step: ' + 'const touch = dev.ctx.hasTouch ===');
      const touch = dev.ctx.hasTouch === true;
      /** 서버 조준이 북쪽인가 */
      const aimNorth = async (): Promise<boolean> => {
        const r = await page.request.get(`/test/state?room=${code}`);
        const t = (await r.json()) as { monster: { aim: number } | null };
        return Math.abs((t.monster?.aim ?? 0) + Math.PI / 2) < 0.2;
      };
      if (touch) {
        // 터치 화면은 조준 스틱을 놓고 있으면 마지막 이동 스틱 방향을 조준한다: 이동 스틱을 북쪽으로 잠깐 끈다
        // (끄는 동안 입력 틱이 몇 번 지나야 서버 조준이 따라온다 — 안 되면 다시)
        for (let attempt = 0; attempt < 4; attempt += 1) {
          await placeSelf(page, code, you, 40, 21, -Math.PI / 2);
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
      log('step: ' + 'await placeSelf(page, code, you, 4');
      await placeSelf(page, code, you, 40, 20.5, -Math.PI / 2);
      if (!touch) {
        // PC: 마우스로 북쪽 조준 (카메라가 앞당겨지면 같은 화면 자리가 다른 타일이 되므로 몇 번 다시 맞춘다)
        for (let i = 0; i < 4; i += 1) {
          const aim = await page.evaluate(() => window.__DECOY__?.tileToClient(40, 15) ?? null);
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
      log('step: ' + 'await settleHud(page);\n      await');
      await settleHud(page);
      await send(page, { kind: 'setTime', timeLeft: 522.4 });
      await page.evaluate((ms) => window.__DECOY__?.freezeClock(ms), CLOCK_MS);
      await shoot(page, dev.name, zoom, 'monster-search');
      if (touch) await tapTarget(page, 'mode');
      else {
        const aim = await page.evaluate(() => window.__DECOY__?.tileToClient(40, 15) ?? null);
        if (aim) await page.mouse.click(aim.x, aim.y, { button: 'right' });
      }
      await expect
        .poll(() => page.evaluate(() => window.__DECOY__?.getLastSnapshot()?.you.mon?.mode))
        .toBe('hunt');
      await shoot(page, dev.name, zoom, 'monster-hunt');
      await tab.close();
    });
  }
}

// 카메라 촬영 공통 (따라가는 카메라 1단계 비교 · 최종 확인 촬영): 봇 방 탭 하나를 열고 판을 시작해 캐릭터를 자리에 놓는다
import { expect, type Browser, type BrowserContextOptions, type Page } from '@playwright/test';
import type { Role, TestCommand } from '@decoy/shared';
import { watchConsole } from '../e2e/helpers';

export const log = (m: string): void => {
  if (process.env.DECOY_CAMERA_LOG) console.log(m);
};

export async function send(page: Page, cmd: TestCommand): Promise<void> {
  await page.evaluate((c) => window.__DECOY__?.sendTest(c), cmd);
}

export async function press(page: Page, testId: string): Promise<void> {
  const el = page.getByTestId(testId);
  await expect(el).toBeEnabled();
  if (await page.evaluate(() => matchMedia('(pointer: coarse)').matches)) await el.tap();
  else await el.click();
}

export interface Tab {
  page: Page;
  close(): Promise<void>;
}

/** 탭을 연다 (콘솔 오류 · 경고는 닫을 때 problems에 모은다) */
export async function openTab(
  browser: Browser,
  ctx: BrowserContextOptions,
  label: string,
  problems: string[],
): Promise<Tab> {
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

export async function soloMatch(
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

export interface TruthPlayer {
  id: string;
  role: string;
  x: number;
  y: number;
}

export async function players(page: Page, code: string): Promise<TruthPlayer[]> {
  const r = await page.request.get(`/test/state?room=${code}`);
  expect(r.ok()).toBe(true);
  return ((await r.json()) as { players: TruthPlayer[] }).players;
}

export async function placeBots(
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

export async function placeSelf(
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

export async function tapTarget(page: Page, id: string): Promise<void> {
  const t = await page.evaluate(
    (want) => window.__DECOY__?.getTouchTargets().find((x) => x.id === want) ?? null,
    id,
  );
  if (!t) throw new Error(`터치 대상 ${id} 없음`);
  await page.touchscreen.tap(t.x + t.w / 2, t.y + t.h / 2);
}

/** 판 시작 알림 · 처음 위치 표시가 걷히고 조작 안내를 닫는다 */
export async function settleHud(page: Page): Promise<void> {
  await page.waitForFunction(() => (window.__DECOY__?.getBanners() ?? []).length === 0, null, {
    timeout: 30_000,
  });
  // PC 첫 판 조작 안내: 아무 키나 누르면 닫힌다 (움직이지 않는 키)
  await page.keyboard.press('KeyZ');
  await page.waitForTimeout(300);
}

// E2E 공용 도우미: 여러 브라우저 컨텍스트로 방 만들기 · 입장 · 역할 · 시작
import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import type { Role, Snapshot, TestCommand } from '@decoy/shared';

/**
 * 헤드리스 컨테이너에는 GPU가 없어 WebGL(SwiftShader) 탭 4개가 1~3FPS밖에 안 나온다.
 * 그래서 여러 탭 E2E는 Canvas 렌더러로 돌린다 (WebGL 경로는 스모크 테스트에서 탭 1개로 확인).
 */
export const BASE_QUERY = '&debug=hook&renderer=canvas';

export interface Player {
  context: BrowserContext;
  page: Page;
  role: Role;
  id: string;
  problems: string[];
}

/** 앱 코드가 낸 콘솔 에러 · 경고를 모은다 (브라우저 내부 GL 메시지는 제외) */
export function watchConsole(page: Page, problems: string[]): void {
  page.on('console', (msg) => {
    const type = msg.type();
    if (type !== 'error' && type !== 'warning') return;
    const text = msg.text();
    if (text.includes('[.WebGL-') || text.includes('GL Driver Message') || text.includes('GroupMarkerNotSet'))
      return;
    problems.push(`${type}: ${text}`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
}

export async function newPlayerPage(
  browser: Browser,
): Promise<{ context: BrowserContext; page: Page; problems: string[] }> {
  const context = await browser.newContext({ viewport: { width: 960, height: 540 } });
  const page = await context.newPage();
  const problems: string[] = [];
  watchConsole(page, problems);
  return { context, page, problems };
}

export async function createRoom(page: Page, query = ''): Promise<string> {
  await page.goto(`/?${BASE_QUERY.slice(1)}${query}`);
  await page.getByTestId('create-room').click();
  const code = page.getByTestId('room-code');
  await expect(code).toHaveText(/^[A-Z]{4}$/);
  return (await code.textContent()) ?? '';
}

export async function joinRoom(page: Page, code: string, query = ''): Promise<void> {
  await page.goto(`/?room=${code}${BASE_QUERY}${query}`);
  await expect(page.getByTestId('room-code')).toHaveText(code);
}

export async function pickRoleAndReady(page: Page, role: Role): Promise<void> {
  await page.getByTestId(`role-${role}`).click();
  await expect(page.getByTestId(`role-${role}`)).toHaveClass(/mine/);
  await page.getByTestId('ready-button').click();
  await expect(page.getByTestId('ready-button')).toHaveText('준비 취소');
}

export async function myId(page: Page): Promise<string> {
  return page.evaluate(() => window.__DECOY__?.you ?? '');
}

/** 4명이 방에 들어가 역할을 고르고 시작한다. 첫 번째가 방장 */
export async function startFourPlayerMatch(
  browser: Browser,
  roles: Role[] = ['monster', 'runner', 'guard', 'scout'],
  queries: string[] = ['', '', '', ''],
): Promise<{ code: string; players: Player[] }> {
  const players: Player[] = [];
  const first = await newPlayerPage(browser);
  const code = await createRoom(first.page, queries[0] ?? '');
  players.push({ ...first, role: roles[0] ?? 'monster', id: await myId(first.page) });
  for (let i = 1; i < roles.length; i += 1) {
    const p = await newPlayerPage(browser);
    await joinRoom(p.page, code, queries[i] ?? '');
    players.push({ ...p, role: roles[i] ?? 'runner', id: await myId(p.page) });
  }
  for (const p of players) await pickRoleAndReady(p.page, p.role);
  const host = players[0];
  if (!host) throw new Error('방장이 없습니다');
  await expect(host.page.getByTestId('start-button')).toBeEnabled();
  await host.page.getByTestId('start-button').click();
  for (const p of players) await waitForSnapshots(p.page, 3);
  return { code, players };
}

export async function waitForSnapshots(page: Page, n: number): Promise<void> {
  await page.waitForFunction((k) => (window.__DECOY__?.snapCount ?? 0) >= k, n, { timeout: 20_000 });
}

export async function lastSnapshot(page: Page): Promise<Snapshot | null> {
  return page.evaluate(() => window.__DECOY__?.getLastSnapshot() ?? null);
}

export async function sendTest(page: Page, cmd: TestCommand): Promise<void> {
  await page.evaluate((c) => window.__DECOY__?.sendTest(c), cmd);
}

export interface TruthPlayer {
  id: string;
  role: string;
  x: number;
  y: number;
  face: number;
  status: string;
}

export interface TruthFrame {
  room: string;
  tick: number;
  players: TruthPlayer[];
  monster: { aim: number; blend: number; mode: string; windup: number } | null;
}

/**
 * 마우스를 타일 (x, y) 위로 옮긴다. 괴물 조준은 마우스를 따르므로, 판 시작 뒤 조준을 직접 정할 때 쓴다
 * (로비에서 마지막으로 누른 버튼 자리에 기대면 로비 배치가 바뀔 때마다 조준이 달라진다)
 */
export async function aimTile(page: Page, x: number, y: number): Promise<void> {
  const c = await page.evaluate(([tx, ty]) => window.__DECOY__?.tileToClient(tx!, ty!) ?? null, [x, y]);
  if (!c) throw new Error('tileToClient 없음');
  await page.mouse.move(c.x, c.y);
}

export async function truth(page: Page, code: string): Promise<TruthFrame> {
  const res = await page.request.get(`/test/state?room=${code}`);
  expect(res.ok()).toBe(true);
  return (await res.json()) as TruthFrame;
}

export async function closeAll(players: Player[]): Promise<void> {
  for (const p of players) await p.context.close();
}

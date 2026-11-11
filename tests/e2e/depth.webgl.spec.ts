// 입체감 (VISUAL_SPEC 14장, WebGL · SwiftShader · 봇 방 · 품질 높음): 정보가 묻히지 않는다
//  - 띄운 벽 북쪽(윗면 아래)에 선 팀원 몸이 가려지지 않는다: 그 칸은 반투명, 몸 자리 픽셀이 역할색이고 입체감을 끈 화면과 같다
//  - 입체감을 켜고 꺼도 정보 레이어 · 그린 엔티티가 같다 (설정 → 그래픽 '입체감' 바로 적용), 입체감 후처리는 구조 레이어에만
//  - 품질 낮음이면 켜 두어도 그리지 않는다 (지금 그대로)
//  - 괴물 화면: 기둥 윗면 아래에 선 생존자도 흰 몸이 보이고(공통 그림 키), 셋에게 같은 비스듬 그림자 · 후처리는 구조 레이어에만
// 헤드리스 SwiftShader는 판 중 자동 하향이 일어나므로 injectFps(60)으로 막는다. 콘솔 에러 · 경고는 문제로 센다.
import { expect, test, type Browser, type Page } from '@playwright/test';
import type { TestCommand } from '@decoy/shared';
import { aimMonsterAt, chooseSetting, closeSettings, watchConsole } from './helpers';
import { spotStats } from './pixelSpot';
import { deltaE } from './visualProbe';

const GUARD: [number, number, number] = [0xa8, 0x55, 0xf7];

interface Room {
  page: Page;
  problems: string[];
  send(cmd: TestCommand): Promise<void>;
  id(role: string): string;
  placeBots(spots: readonly (readonly [string, number, number, number])[]): Promise<void>;
  close(): Promise<void>;
}

async function startRoom(browser: Browser, role: string): Promise<Room> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  // 품질 · 입체감은 주소로 정하지 않는다 (설정 줄이 잠기지 않게): 품질은 저장한 선택 '높음', 입체감은 기본값 켬
  await context.addInitScript(() => {
    try {
      localStorage.setItem('decoy:quality', 'high');
    } catch {
      // 저장소가 막히면 자동 품질 — 아래 단언이 잡는다
    }
  });
  const page = await context.newPage();
  const problems: string[] = [];
  watchConsole(page, problems);
  await page.goto('/?bots=1&debug=hook&renderer=webgl&chars=classic');
  await page.waitForFunction(() => window.__DECOY__ !== undefined);
  await page.evaluate(() => window.__DECOY__?.injectFps(60));
  await page.getByTestId('create-room').click();
  const code = page.getByTestId('room-code');
  await expect(code).toHaveText(/^[A-Z]{4}$/);
  const room = (await code.textContent()) ?? '';
  await page.getByTestId(`role-${role}`).click();
  await expect(page.getByTestId(`role-${role}`)).toHaveClass(/mine/);
  await page.getByTestId('ready-button').click();
  await page.getByTestId('start-button').click();
  await page.waitForFunction(() => (window.__DECOY__?.snapCount ?? 0) > 5, null, { timeout: 30_000 });
  const truth = (await (await page.request.get(`/test/state?room=${room}`)).json()) as {
    players: { id: string; role: string }[];
  };
  const id = (r: string): string => truth.players.find((p) => p.role === r)?.id ?? '';
  const send = (cmd: TestCommand): Promise<void> => page.evaluate((c) => window.__DECOY__?.sendTest(c), cmd);
  // 순간이동 + 멈춤을 한 번에 보내고, 서버 정답 자리가 목표와 같아질 때까지 다시 (m10-visual.webgl과 같은 방법)
  const placeBots = async (spots: readonly (readonly [string, number, number, number])[]): Promise<void> => {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const cmds: TestCommand[] = spots.flatMap(([r, x, y, face]): TestCommand[] => [
        { kind: 'teleport', target: id(r), x, y, face },
        { kind: 'freeze', target: id(r), frozen: true },
      ]);
      await page.evaluate((cs) => {
        for (const c of cs) window.__DECOY__?.sendTest(c);
      }, cmds);
      await page.waitForTimeout(150);
      const now = (await (await page.request.get(`/test/state?room=${room}`)).json()) as {
        players: { role: string; x: number; y: number }[];
      };
      const off = spots.some(([r, x, y]) => {
        const p = now.players.find((q) => q.role === r);
        return !p || Math.abs(p.x - x) > 1e-6 || Math.abs(p.y - y) > 1e-6;
      });
      if (!off) return;
    }
    throw new Error('봇을 정확한 자리에 세우지 못했다');
  };
  await page.keyboard.press('KeyX');
  return { page, problems, send, id, placeBots, close: () => context.close() };
}

async function placeSelf(
  page: Page,
  send: Room['send'],
  you: string,
  x: number,
  y: number,
  face: number,
): Promise<void> {
  await send({ kind: 'teleport', target: you, x, y, face });
  await page.waitForFunction(
    ([tx, ty]) => {
      const st = window.__DECOY__?.getLocalState();
      return !!st && Math.hypot(st.x - tx!, st.y - ty!) < 0.05;
    },
    [x, y],
    { timeout: 20_000 },
  );
}

/** 판 중 설정(메뉴 버튼으로 연다)에서 고르는 칸 하나를 누르고 닫는다 */
async function chooseInMatch(page: Page, seg: string): Promise<void> {
  if (!(await page.getByTestId('settings-panel').isVisible())) await page.getByTestId('match-menu').click();
  await chooseSetting(page, 'graphics', seg);
  await closeSettings(page);
}

async function noBanners(page: Page): Promise<void> {
  await page.waitForFunction(() => (window.__DECOY__?.getBanners() ?? []).length === 0, null, {
    timeout: 15_000,
  });
}

/** 후처리는 구조 레이어(map · glow)에만, 카메라에는 없다. 입체감 후처리가 걸렸으면 map에 'depth' */
async function fxTargets(page: Page): Promise<{ layer: string; effects: string[] }[]> {
  const targets = await page.evaluate(() => window.__DECOY__?.getFxTargets() ?? []);
  for (const t of targets) {
    expect(['map', 'glow'], `후처리 레이어 ${t.layer}`).toContain(t.layer);
    for (const e of t.effects) expect(e.startsWith('camera:'), `카메라 후처리 ${e}`).toBe(false);
  }
  return targets;
}

const hasDepthFx = (targets: { layer: string; effects: string[] }[]): boolean =>
  targets.some((t) => t.effects.includes('depth'));

test('입체감 (WebGL 높음): 띄운 벽 북쪽(윗면 아래)에 선 팀원이 가려지지 않고, 켜고 꺼도 정보 레이어 · 그린 엔티티가 같다, 품질 낮음은 지금 그대로', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const r = await startRoom(browser, 'runner');
  const { page, send } = r;
  const you = await page.evaluate(() => window.__DECOY__?.you ?? '');
  // 가드: 벽 덩어리 (28–29, 8–11) 북쪽에 바짝 (몸 아래쪽이 띄운 윗면 아래). 괴물은 멀리 (보이지 않음), 스카우트는 서쪽
  await r.placeBots([
    ['guard', 28.6, 7.62, -Math.PI / 2],
    ['scout', 18.2, 13.4, 0.2],
    ['monster', 4, 28, 0],
  ]);
  await placeSelf(page, send, you, 26.3, 11.4, -Math.PI / 2);
  await noBanners(page);
  await page.evaluate(() => window.__DECOY__?.freezeClock(1000));
  await page.waitForTimeout(1200);

  const on = await page.evaluate(() => window.__DECOY__?.getDepth() ?? null);
  expect(on, 'getDepth').not.toBeNull();
  if (!on) return;
  console.log(`[depth.webgl] 켬: ${JSON.stringify({ ...on, faded: on.faded.slice(0, 8) })}`);
  expect(on.on).toBe(true);
  expect(on.look).toBe('b');
  expect(on.cast).toBe(true);
  expect(on.grade).toBe(true);
  expect(on.cells).toBeGreaterThan(0);
  expect(on.halos).toBe(6);
  // 가드 몸이 띄운 윗면 아래: 그 칸은 반투명
  expect(
    on.faded.some((f) => (f.i === 28 || f.i === 29) && f.j === 8),
    JSON.stringify(on.faded),
  ).toBe(true);
  expect(on.fadedBody).toBeGreaterThan(0);
  // 러너 시야 빛이 북쪽 벽 남쪽 면에 닿는다 (빛 = 받은 시야)
  expect(on.litFaces).toBeGreaterThan(0);
  expect(on.eyes).toBeGreaterThan(0);
  expect(hasDepthFx(await fxTargets(page)), '입체감 후처리가 구조 레이어에').toBe(true);
  const spotOn = (await spotStats(page, { guard: [28.6, 7.62] }, 2)).guard;
  const infoOn = await page.evaluate(() => window.__DECOY__?.getInfoLayer() ?? []);
  const drawnOn = await page.evaluate(() => window.__DECOY__?.getDrawn() ?? []);
  expect(drawnOn.some((d) => d.kind === 'survivor' && Math.hypot(d.x - 28.6, d.y - 7.62) < 0.05)).toBe(true);
  // 몸 가운데는 역할색 (윗면이 덮지 않는다 — 캐릭터는 구조 레이어 위)
  expect(spotOn, '가드 몸 표본').toBeDefined();
  if (!spotOn) return;
  expect(deltaE(spotOn.rgb, GUARD), `가드 몸 ${spotOn.rgb.map(Math.round).join(',')}`).toBeLessThanOrEqual(
    30,
  );

  // 설정에서 끄면 바로: 입체 · 그림자 · 후처리 끔, 정보는 같다
  await chooseInMatch(page, 'depth-off');
  await page.waitForTimeout(600);
  const off = await page.evaluate(() => window.__DECOY__?.getDepth() ?? null);
  expect(off?.on).toBe(false);
  expect(off?.cast).toBe(false);
  expect(off?.grade).toBe(false);
  expect(hasDepthFx(await fxTargets(page))).toBe(false);
  const infoOff = await page.evaluate(() => window.__DECOY__?.getInfoLayer() ?? []);
  const drawnOff = await page.evaluate(() => window.__DECOY__?.getDrawn() ?? []);
  expect(infoOff).toEqual(infoOn);
  expect(drawnOff).toEqual(drawnOn);
  const spotOff = (await spotStats(page, { guard: [28.6, 7.62] }, 2)).guard;
  if (spotOff) expect(deltaE(spotOn.rgb, spotOff.rgb), '켬 · 끔 가드 몸 색').toBeLessThanOrEqual(12);

  // 다시 켜고, 품질 낮음으로 내리면 켜 두어도 그리지 않는다
  await chooseInMatch(page, 'depth-on');
  await expect.poll(() => page.evaluate(() => window.__DECOY__?.getDepth()?.on ?? false)).toBe(true);
  await chooseInMatch(page, 'quality-low');
  await expect
    .poll(() => page.evaluate(() => window.__DECOY__?.getDepth()?.on ?? true), { timeout: 30_000 })
    .toBe(false);
  expect(hasDepthFx(await fxTargets(page))).toBe(false);
  expect(r.problems, '콘솔 에러 · 경고').toEqual([]);
  await r.close();
});

test('입체감 괴물 화면 (WebGL 높음): 기둥 윗면 아래에 선 생존자도 흰 공통 몸이 보이고, 셋 모두 같은 그림 키 · 입체감 후처리는 구조 레이어에만', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const r = await startRoom(browser, 'monster');
  const { page, send } = r;
  const you = await page.evaluate(() => window.__DECOY__?.you ?? '');
  // 생존자: 러너는 기둥 (23–24, 10–11) 북동쪽 바짝(띄운 윗면 아래), 가드 · 스카우트는 탁 트인 자리 — 모두 괴물 탐색 시야 안
  await r.placeBots([
    ['runner', 24.9, 9.45, 0.4],
    ['guard', 26.7, 11.1, -0.6],
    ['scout', 25.9, 9.9, 1.2],
  ]);
  await placeSelf(page, send, you, 26.2, 12.9, -Math.PI / 2);
  await aimMonsterAt(page, 26.2, 7);
  await noBanners(page);
  await page.evaluate(() => window.__DECOY__?.freezeClock(1000));
  await page.waitForTimeout(1200);
  const drawn = await page.evaluate(() => window.__DECOY__?.getDrawn() ?? []);
  const survivors = drawn.filter((d) => d.kind === 'survivor');
  console.log(`[depth.webgl] 괴물 화면 그린 생존자: ${JSON.stringify(survivors)}`);
  expect(survivors.length).toBe(3);
  expect(survivors.map((d) => d.sprite)).toEqual(['survivor-hidden', 'survivor-hidden', 'survivor-hidden']);
  const depth = await page.evaluate(() => window.__DECOY__?.getDepth() ?? null);
  expect(depth?.on).toBe(true);
  expect(depth?.cast).toBe(true);
  // 기둥 덩어리 (23, 10)가 반투명 (러너 몸 · 거점 C 판정 원)
  expect(
    depth?.faded.some((f) => f.i === 23 && f.j === 10),
    JSON.stringify(depth?.faded),
  ).toBe(true);
  const spots = await spotStats(
    page,
    Object.fromEntries(survivors.map((d, i) => [`s${i}`, [d.x, d.y] as [number, number]])),
    2,
  );
  for (const [name, s] of Object.entries(spots)) {
    // 흰 몸 (무채색 · 밝음): 띄운 윗면 · 비스듬 그림자 · 후처리가 덮지 않는다
    expect(s.luma, `${name} 밝기 ${s.rgb.map(Math.round).join(',')}`).toBeGreaterThan(200);
    expect(Math.max(...s.rgb) - Math.min(...s.rgb), `${name} 채도`).toBeLessThanOrEqual(24);
  }
  expect(hasDepthFx(await fxTargets(page))).toBe(true);
  expect(r.problems, '콘솔 에러 · 경고').toEqual([]);
  await r.close();
});

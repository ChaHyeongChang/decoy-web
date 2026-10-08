// M10b 캐릭터 · 효과 (WebGL · SwiftShader · 탭 1개 · 봇 방 · 품질 높음): 셰이더 비네트 · 색보정 · 눈빛 · 먼지가 켜진 상태에서도
//  - 괴물 화면 생존자는 흰 공통 실루엣 (몸 원판 90% 이상 무채색 · 밝음, 역할 4색과 ΔE 40 이상, 그림 키 'survivor-hidden')
//  - 공격 준비 범위 경계 = attack.range × 타일 화면 크기 ±2px
//  - 후처리는 구조 레이어(map)에만, 생존자 화면 팀원 몸 역할색 · 몸/링 대비가 Canvas 낮음과 같은 수준 (효과가 정보를 가리지 않음)
// 헤드리스 SwiftShader는 판 중 자동 하향이 거의 반드시 일어나므로 injectFps(60)으로 막고 downgrades = 0을 단언한다.
// 이 검사는 콘솔을 거르지 않는다 (셰이더 컴파일 경고도 문제로 센다).
import { readFileSync } from 'node:fs';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { validateBalance, type TestCommand } from '@decoy/shared';
import { captureBodies, describe as describeCapture, type BodyProbe, type Capture } from './visualProbe';

const balance = validateBalance(JSON.parse(readFileSync('config/balance.json', 'utf8')));
const ROLE_HEX = { runner: 0x3b82f6, guard: 0xa855f7, scout: 0x22c55e } as const;

interface Session {
  context: BrowserContext;
  page: Page;
  problems: string[];
  send(cmd: TestCommand): Promise<void>;
  id(role: string): string;
}

async function startSolo(browser: Browser, role: 'monster' | 'runner', query: string): Promise<Session> {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') problems.push(`${msg.type()}: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  await page.goto(`/?bots=1&debug=hook${query}`);
  await page.waitForFunction(() => window.__DECOY__ !== undefined);
  await page.evaluate(() => window.__DECOY__?.injectFps(60));
  await page.getByTestId('create-room').click();
  await page.getByTestId(`role-${role}`).click();
  await page.getByTestId('ready-button').click();
  await page.getByTestId('start-button').click();
  await page.waitForFunction(() => (window.__DECOY__?.snapCount ?? 0) > 5, null, { timeout: 30_000 });
  const room = await page.evaluate(() => window.__DECOY__?.room ?? '');
  const truth = (await (await page.request.get(`/test/state?room=${room}`)).json()) as {
    players: { id: string; role: string }[];
  };
  const id = (r: string): string => truth.players.find((p) => p.role === r)?.id ?? '';
  const send = (cmd: TestCommand): Promise<void> => page.evaluate((c) => window.__DECOY__?.sendTest(c), cmd);
  await page.keyboard.press('KeyX');
  return { context, page, problems, send, id };
}

async function aimAt(page: Page, x: number, y: number): Promise<void> {
  const c = await page.evaluate(([tx, ty]) => window.__DECOY__?.tileToClient(tx!, ty!) ?? null, [x, y]);
  await page.mouse.move(c!.x, c!.y);
}

test('괴물 화면 흰색 위장 (WebGL 높음: 셰이더 비네트 · 색보정 · 눈빛 켬) + 공격 범위 = 판정값 + 후처리는 구조 레이어에만', async ({
  browser,
}) => {
  const s = await startSolo(browser, 'monster', '&renderer=webgl&quality=high');
  const { page, send, id } = s;
  // 봇 생존자: 러너는 근접 원 · 공격 범위, 가드 · 스카우트는 부채꼴 안. 모두 멈춤
  const spots: Record<string, [number, number]> = { runner: [41, 11], guard: [39.6, 12], scout: [38, 10.6] };
  for (const [r, [x, y]] of Object.entries(spots)) {
    await send({ kind: 'teleport', target: id(r), x, y });
    await send({ kind: 'freeze', target: id(r), frozen: true });
  }
  await send({ kind: 'teleport', target: id('monster'), x: 42, y: 11.4, face: Math.PI });
  await aimAt(page, 36, 11.4);
  await page.waitForFunction(() => (window.__DECOY__?.getBanners() ?? []).length === 0, null, {
    timeout: 15_000,
  });
  await page.evaluate(() => window.__DECOY__?.freezeClock(1000));
  await page.waitForTimeout(1000);
  const drawn = await page.evaluate(() => window.__DECOY__?.getDrawn() ?? []);
  const bodies: BodyProbe[] = drawn
    .filter((d) => d.kind === 'survivor')
    .map((d, i) => ({ name: `s${i}`, x: d.x, y: d.y, face: d.face, r: balance.survivor.radius }));
  expect(bodies.length).toBe(3);
  const still = await captureBodies(page, bodies);
  console.log(`[m10-visual.webgl] 괴물 화면: ${describeCapture(still)}`);
  expect(still.ok).toBe(true);
  expect(still.drawn.filter((d) => d.kind === 'survivor').map((d) => d.sprite)).toEqual([
    'survivor-hidden',
    'survivor-hidden',
    'survivor-hidden',
  ]);
  for (const b of still.stats) {
    expect(b.whiteFrac, `${b.name} 흰 비율`).toBeGreaterThanOrEqual(0.9);
    expect(b.minRoleDeltaE, `${b.name} 역할색 ΔE`).toBeGreaterThanOrEqual(40);
  }
  // 공격 준비 (누른 순간부터 예측)
  const me = (await page.evaluate(() => window.__DECOY__?.getRenderPos()))!;
  await page.mouse.down({ button: 'left' });
  await page.mouse.up({ button: 'left' });
  const atk: Capture = await captureBodies(page, bodies, {
    waitEffect: 'attackRange',
    range: { x: me.x, y: me.y, dir: me.face, tiles: balance.monster.attack.range },
  });
  console.log(
    `[m10-visual.webgl] 공격 준비: ${describeCapture(atk)} / 범위 경계 ${atk.rangePx?.toFixed(2)}px (판정 ${atk.rangeExpectPx?.toFixed(2)}px) 밝기 ${atk.rangeProfile.join(',')}`,
  );
  expect(atk.ok).toBe(true);
  for (const b of atk.stats) {
    expect(b.whiteFrac).toBeGreaterThanOrEqual(0.9);
    expect(b.minRoleDeltaE).toBeGreaterThanOrEqual(40);
  }
  expect(Math.abs(atk.rangePx! - atk.rangeExpectPx!)).toBeLessThanOrEqual(2);
  // 후처리: 높음은 구조 레이어에 셰이더 비네트 + 색보정 (+ 안개 경계 셰이더). 캐릭터 · 마커 · HUD 레이어에는 없다
  const targets = await page.evaluate(() => window.__DECOY__?.getFxTargets() ?? []);
  const gfx = await page.evaluate(() => window.__DECOY__!.gfx);
  console.log(`[m10-visual.webgl] 후처리 ${JSON.stringify(targets)} / 특징 ${JSON.stringify(gfx.features)}`);
  expect(gfx.renderer).toBe('webgl');
  expect(gfx.quality).toBe('high');
  expect(gfx.downgrades).toBe(0);
  for (const t of targets) expect(['map', 'glow']).toContain(t.layer);
  expect(targets.flatMap((t) => t.effects)).toEqual(expect.arrayContaining(['vignette', 'colorGrade']));
  expect(gfx.features.vignette).toBe('postfx');
  expect(gfx.features.colorGrade).toBe(true);
  expect(s.problems).toEqual([]);
  await s.context.close();
});

/** 러너로 봇 방을 열어 팀원(봇 가드 · 스카우트)을 빛 바닥에 세우고 잰다 */
async function teamRun(
  browser: Browser,
  query: string,
): Promise<{
  cap: Capture;
  targets: { layer: string; effects: string[] }[];
  problems: string[];
  downgrades: number;
}> {
  const s = await startSolo(browser, 'runner', query);
  const { page, send, id } = s;
  const spots: Record<string, [number, number, number]> = {
    runner: [36, 11, 0],
    guard: [37.6, 11.6, 0.5],
    scout: [36.2, 12.7, 2.2],
    monster: [5, 28, 0],
  };
  for (const [r, [x, y, face]] of Object.entries(spots)) {
    await send({ kind: 'teleport', target: id(r), x, y, face });
    if (r !== 'runner') await send({ kind: 'freeze', target: id(r), frozen: true });
  }
  await page.waitForFunction(() => (window.__DECOY__?.getBanners() ?? []).length === 0, null, {
    timeout: 15_000,
  });
  await page.evaluate(() => window.__DECOY__?.freezeClock(1000));
  await page.waitForTimeout(1000);
  const drawn = await page.evaluate(() => window.__DECOY__?.getDrawn() ?? []);
  const bodies: BodyProbe[] = (['guard', 'scout'] as const).map((r) => {
    const d = drawn.find((e) => e.id === id(r))!;
    return { name: r, x: d.x, y: d.y, face: d.face, r: balance.survivor.radius };
  });
  const cap = await captureBodies(page, bodies, {
    refColors: { guard: ROLE_HEX.guard, scout: ROLE_HEX.scout },
  });
  const targets = await page.evaluate(() => window.__DECOY__?.getFxTargets() ?? []);
  const downgrades = await page.evaluate(() => window.__DECOY__!.gfx.downgrades);
  await s.context.close();
  return { cap, targets, problems: s.problems, downgrades };
}

test('생존자 화면: WebGL 높음(후처리 · 먼지 켬)과 Canvas 낮음의 팀원 몸 역할색 · 몸/링 대비가 같은 수준', async ({
  browser,
}) => {
  const high = await teamRun(browser, '&renderer=webgl&quality=high');
  const low = await teamRun(browser, '&renderer=canvas&quality=low');
  console.log(
    `[m10-visual.webgl] 높음 ${describeCapture(high.cap)} / 낮음 ${describeCapture(low.cap)} / 후처리 ${JSON.stringify(high.targets)}`,
  );
  expect(high.cap.ok && low.cap.ok).toBe(true);
  expect(high.downgrades).toBe(0);
  for (const h of high.cap.stats) {
    const l = low.cap.stats.find((x) => x.name === h.name)!;
    expect(h.deltaE!, `${h.name} 역할색 ΔE (높음)`).toBeLessThanOrEqual(15);
    expect(h.contrast, `${h.name} 대비 (높음)`).toBeGreaterThanOrEqual(3);
    expect(h.contrast, `${h.name} 대비 높음 ≥ 낮음 × 0.8`).toBeGreaterThanOrEqual(l.contrast * 0.8);
    expect(Math.abs(h.deltaE! - l.deltaE!), `${h.name} 몸 색 차이`).toBeLessThanOrEqual(10);
  }
  for (const t of high.targets) expect(['map', 'glow']).toContain(t.layer);
  expect(high.problems).toEqual([]);
  expect(low.problems).toEqual([]);
});

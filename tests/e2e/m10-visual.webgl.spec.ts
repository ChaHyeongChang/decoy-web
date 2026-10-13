// M10b 캐릭터 · 효과 (WebGL · SwiftShader · 봇 방 · 품질 높음 위주): 셰이더 비네트 · 색보정 · 눈빛 · 먼지가 켜진 상태에서도
//  - 괴물 화면 생존자는 흰 공통 실루엣 (몸 원판 90% 이상 무채색 · 밝음, 역할 4색과 ΔE 40 이상, 그림 키 'survivor-hidden',
//    세 몸의 흰 폭 · 그림자 폭 ±1px · 평균색 ΔE ≤ 1)
//  - 공격 준비 범위 경계 = attack.range × 타일 화면 크기 ±2px
//  - 후처리는 구조 레이어(map)에만: 장면 표시 목록 · 카메라에서 직접 모은 getFxTargets에 entities · markers · hud · 카메라가 없다
//  - 생존자 화면 팀원 몸 역할색 · 몸/링 대비가 Canvas 낮음과 같은 수준(몸 평균색 Lab ΔE ≤ 10), 먼지는 원호 테셀레이션 없이,
//    후처리 렌더 타깃 바이트를 기록
//  - 기절 채도 감소는 맵 위 · 캐릭터 아래 (숨은 생존자 흰색 · 몸/링 대비 · 가드 노출 링 그대로)
//  - 품질 WebGL 높음 · 중간 · Canvas 낮음에서 범위가 있는 장면(공격 준비 · 캠핑 · 근접 원 · 포효 · 구조 구역 · 밀치기)의
//    그린 엔티티 · 정보 레이어가 같고, 각 범위의 화면 반지름 · 각도가 판정값 ±2px
// 헤드리스 SwiftShader는 판 중 자동 하향이 거의 반드시 일어나므로 injectFps(60)으로 막고 downgrades = 0을 단언한다.
// 이 검사는 콘솔을 거르지 않는다 (셰이더 컴파일 경고도 문제로 센다).
import { readFileSync } from 'node:fs';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { PRISON_CENTER, RESCUE_POINT, validateBalance, type InfoItem, type TestCommand } from '@decoy/shared';
import {
  captureBodies,
  captureSweep,
  deltaE,
  describe as describeCapture,
  median,
  type BodyProbe,
  type Capture,
  type CaptureOptions,
  type RayResult,
} from './visualProbe';

const balance = validateBalance(JSON.parse(readFileSync('config/balance.json', 'utf8')));
const ROLE_HEX = { runner: 0x3b82f6, guard: 0xa855f7, scout: 0x22c55e } as const;
const STAR_HEX = 0xeab308;

interface Tab {
  context: BrowserContext;
  page: Page;
  problems: string[];
}

interface Session {
  host: Tab;
  guest: Tab | null;
  send(cmd: TestCommand): Promise<void>;
  id(role: string): string;
  /**
   * 봇을 정확히 그 자리에 세우고 멈춘다. teleport가 멈춤을 풀어 freeze가 닿기 전 한 틱 움직일 수 있으므로
   * 서버 정답 자리가 목표와 같아질 때까지 다시 한다 (품질 사이 정보 비교는 자리가 같아야 한다)
   */
  placeBots(spots: readonly (readonly [string, number, number, number])[]): Promise<void>;
  close(): Promise<void>;
}

async function openTab(browser: Browser, url: string): Promise<Tab> {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') problems.push(`${msg.type()}: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  await page.goto(url);
  await page.waitForFunction(() => window.__DECOY__ !== undefined);
  await page.evaluate(() => window.__DECOY__?.injectFps(60));
  return { context, page, problems };
}

async function ready(page: Page, role: string): Promise<void> {
  await page.getByTestId(`role-${role}`).click();
  await expect(page.getByTestId(`role-${role}`)).toHaveClass(/mine/);
  await page.getByTestId('ready-button').click();
}

/** 봇 방: 방장(hostRole, hostQuery) + 손님 한 명(선택, 다른 렌더러 · 품질 가능). 빈 역할은 봇이 채운다 */
async function startRoom(
  browser: Browser,
  hostRole: string,
  hostQuery: string,
  guestRole: string | null = null,
  guestQuery = '&renderer=canvas&quality=low',
): Promise<Session> {
  const host = await openTab(browser, `/?bots=1&debug=hook${hostQuery}`);
  await host.page.getByTestId('create-room').click();
  const code = host.page.getByTestId('room-code');
  await expect(code).toHaveText(/^[A-Z]{4}$/);
  const room = (await code.textContent()) ?? '';
  let guest: Tab | null = null;
  if (guestRole) {
    guest = await openTab(browser, `/?room=${room}&debug=hook${guestQuery}`);
    await expect(guest.page.getByTestId('room-code')).toHaveText(room);
    await ready(guest.page, guestRole);
  }
  await ready(host.page, hostRole);
  await host.page.getByTestId('start-button').click();
  for (const t of [host, guest])
    if (t)
      await t.page.waitForFunction(() => (window.__DECOY__?.snapCount ?? 0) > 5, null, { timeout: 30_000 });
  const truth = (await (await host.page.request.get(`/test/state?room=${room}`)).json()) as {
    players: { id: string; role: string }[];
  };
  const id = (r: string): string => truth.players.find((p) => p.role === r)?.id ?? '';
  const send = (cmd: TestCommand): Promise<void> =>
    host.page.evaluate((c) => window.__DECOY__?.sendTest(c), cmd);
  // 순간이동은 멈춤을 풀고(서버 test 훅), 봇은 쉬지 않고 움직인다. 순간이동과 멈춤을 page.evaluate 두 번에 나눠 보내면
  // 느린 러너(2코어 · WebGL 소프트웨어 렌더)에서 그 사이에 서버 틱이 끼어 봇이 자리를 벗어나고, 다시 시도해도 같은 틈이
  // 생겨 여섯 번 모두 실패했다(출시 전 검토 전체 검사). 한 번의 evaluate(같은 작업)에서 이어 보내 틈을 없앤다
  const placeBots = async (spots: readonly (readonly [string, number, number, number])[]): Promise<void> => {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const cmds: TestCommand[] = spots.flatMap(([r, x, y, face]): TestCommand[] => [
        { kind: 'teleport', target: id(r), x, y, face },
        { kind: 'freeze', target: id(r), frozen: true },
      ]);
      await host.page.evaluate((cs) => {
        for (const c of cs) window.__DECOY__?.sendTest(c);
      }, cmds);
      await host.page.waitForTimeout(150);
      const now = (await (await host.page.request.get(`/test/state?room=${room}`)).json()) as {
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
  for (const t of [host, guest]) if (t) await t.page.keyboard.press('KeyX');
  return {
    host,
    guest,
    send,
    id,
    placeBots,
    close: async () => {
      await host.context.close();
      await guest?.context.close();
    },
  };
}

async function aimAt(page: Page, x: number, y: number): Promise<void> {
  const c = await page.evaluate(([tx, ty]) => window.__DECOY__?.tileToClient(tx!, ty!) ?? null, [x, y]);
  await page.mouse.move(c!.x, c!.y);
}

async function noBanners(page: Page): Promise<void> {
  await page.waitForFunction(() => (window.__DECOY__?.getBanners() ?? []).length === 0, null, {
    timeout: 15_000,
  });
}

/** 후처리는 구조 레이어(map · glow)에만, 카메라에는 없다 (표시 목록에서 모은 실제 값) */
function expectFxOnlyOnMap(targets: { layer: string; effects: string[] }[], label: string): void {
  for (const t of targets) {
    expect(['map', 'glow'], `${label} 후처리 레이어 ${t.layer}`).toContain(t.layer);
    for (const e of t.effects) expect(e.startsWith('camera:'), `${label} 카메라 후처리 ${e}`).toBe(false);
  }
}

test('괴물 화면 흰색 위장 (WebGL 높음: 셰이더 비네트 · 색보정 · 눈빛 켬) + 공격 범위 = 판정값 + 후처리는 구조 레이어에만', async ({
  browser,
}) => {
  const s = await startRoom(browser, 'monster', '&renderer=webgl&quality=high');
  const { send, id } = s;
  const page = s.host.page;
  // 봇 생존자: 러너는 근접 원 · 공격 범위, 가드 · 스카우트는 부채꼴 안. 모두 멈춤
  await s.placeBots([
    ['runner', 41, 11, 0.3],
    ['guard', 39.6, 12, -2.6],
    ['scout', 38, 10.6, 1.2],
  ]);
  await send({ kind: 'teleport', target: id('monster'), x: 42, y: 11.4, face: Math.PI });
  await aimAt(page, 36, 11.4);
  await noBanners(page);
  await page.evaluate(() => window.__DECOY__?.freezeClock(1000));
  await page.waitForTimeout(1000);
  const drawn = await page.evaluate(() => window.__DECOY__?.getDrawn() ?? []);
  const bodies: BodyProbe[] = drawn
    .filter((d) => d.kind === 'survivor')
    .map((d, i) => ({
      name: `s${i}`,
      x: d.x,
      y: d.y,
      face: d.face,
      r: balance.survivor.radius,
    }));
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
  // 같은 실루엣: 흰 폭 · 그림자 폭 ±1px, 평균색 ΔE ≤ 1
  const [a0, ...rest] = still.stats;
  console.log(
    `[m10-visual.webgl] 흰 폭 ${still.stats.map((b) => b.widths.map((w) => w.toFixed(1)).join('/')).join(' | ')} · 그림자 ${still.stats.map((b) => b.shadowW?.toFixed(1)).join(' | ')}`,
  );
  for (const b of rest) {
    b.widths.forEach((w, i) =>
      expect(Math.abs(w - a0!.widths[i]!), `${b.name} 흰 폭 ${i}`).toBeLessThanOrEqual(1),
    );
    expect(b.shadowW).not.toBeNull();
    expect(Math.abs(b.shadowW! - a0!.shadowW!), `${b.name} 그림자 폭`).toBeLessThanOrEqual(1);
    expect(deltaE(b.mean, a0!.mean), `${b.name} 몸 평균색`).toBeLessThanOrEqual(1);
  }
  // 공격 준비 (누른 순간부터 예측). SwiftShader는 프레임이 몰아서 와(0.6~1초 멈춤) 0.4초 준비를 통째로 놓치거나,
  // 앞머리 호가 범위 탐침에 걸친 프레임을 잡을 수 있다: 쿨타임 뒤 다시 누른다(windupCapture와 같은 이유, 여섯 번까지)
  const me = (await page.evaluate(() => window.__DECOY__?.getRenderPos()))!;
  const atkOpts: CaptureOptions = {
    waitEffect: 'attackRange',
    range: { x: me.x, y: me.y, dir: me.face, tiles: balance.monster.attack.range },
    timeoutMs: 2500,
  };
  let atk: Capture | null = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    if (attempt > 0) {
      await page.waitForTimeout(1700);
      // 러너는 공격 부채꼴 안이라 놓친 회차의 준비에도 맞는다: 두 번 맞아 수감돼 탐침 자리가 비지 않게 체력을 되돌린다
      // (괴물 화면에는 체력이 오지 않고 흰 실루엣에 체력 인자가 없어 그림은 같다)
      await send({ kind: 'setSurvivor', target: id('runner'), hp: 2 });
    }
    await page.mouse.down({ button: 'left' });
    await page.mouse.up({ button: 'left' });
    atk = await captureBodies(page, bodies, atkOpts);
    if (atk.ok && !frontArcNearProbe(atk, atkOpts)) break;
    console.log(
      `[m10-visual.webgl] 공격 준비 ${attempt + 1}번째: ok ${String(atk.ok)} · 채움 ${String(atk.effects.attackFill)} — 다시`,
    );
  }
  console.log(
    `[m10-visual.webgl] 공격 준비: ${describeCapture(atk!)} / 범위 경계 ${atk!.rangePx?.toFixed(2)}px (판정 ${atk!.rangeExpectPx?.toFixed(2)}px) 밝기 ${atk!.rangeProfile.join(',')}`,
  );
  expect(atk!.ok).toBe(true);
  for (const b of atk!.stats) {
    expect(b.whiteFrac).toBeGreaterThanOrEqual(0.9);
    expect(b.minRoleDeltaE).toBeGreaterThanOrEqual(40);
  }
  expect(Math.abs(atk!.rangePx! - atk!.rangeExpectPx!)).toBeLessThanOrEqual(2);
  // 후처리: 높음은 구조 레이어에 셰이더 비네트 + 색보정 (+ 안개 경계 셰이더). 장면 표시 목록 · 카메라에서 직접 모은 값에
  // 캐릭터(entities) · 마커 · HUD · 화면 효과 · 카메라 후처리가 없다
  const targets = await page.evaluate(() => window.__DECOY__?.getFxTargets() ?? []);
  const gfx = await page.evaluate(() => window.__DECOY__!.gfx);
  console.log(`[m10-visual.webgl] 후처리 ${JSON.stringify(targets)} / 특징 ${JSON.stringify(gfx.features)}`);
  expect(gfx.renderer).toBe('webgl');
  expect(gfx.quality).toBe('high');
  expect(gfx.downgrades).toBe(0);
  expectFxOnlyOnMap(targets, '높음');
  const mapFx = targets.find((t) => t.layer === 'map');
  expect(mapFx?.effects.length ?? 0, '구조 레이어 후처리').toBeGreaterThanOrEqual(1);
  expect(targets.flatMap((t) => t.effects)).toEqual(expect.arrayContaining(['vignette', 'colorGrade']));
  expect(gfx.features.vignette).toBe('postfx');
  expect(gfx.features.colorGrade).toBe(true);
  // 후처리 렌더 타깃 = 백버퍼 크기 RGBA 한 장
  expect(gfx.features.postFxBytes).toBe(gfx.backingW * gfx.backingH * 4);
  expect(s.host.problems).toEqual([]);
  await s.close();
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
  features: Record<string, boolean | number | string>;
}> {
  const s = await startRoom(browser, 'runner', query);
  const { send, id } = s;
  const page = s.host.page;
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
  await noBanners(page);
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
  const gfx = await page.evaluate(() => window.__DECOY__!.gfx);
  await s.close();
  return { cap, targets, problems: s.host.problems, downgrades: gfx.downgrades, features: gfx.features };
}

test('생존자 화면: WebGL 높음(후처리 · 먼지 켬)과 Canvas 낮음의 팀원 몸 역할색 · 몸/링 대비가 같은 수준, 먼지는 원호 없이', async ({
  browser,
}) => {
  const high = await teamRun(browser, '&renderer=webgl&quality=high');
  const low = await teamRun(browser, '&renderer=canvas&quality=low');
  console.log(
    `[m10-visual.webgl] 높음 ${describeCapture(high.cap)} / 낮음 ${describeCapture(low.cap)} / 후처리 ${JSON.stringify(high.targets)}`,
  );
  console.log(
    `[m10-visual.webgl] 높음 먼지 ${high.cap.effects.dust} · 원호 ${high.features.charGfxArcs} · 채우기 ${high.features.charGfxFills} · 후처리 RT ${high.features.postFxBytes}B / 낮음 원호 ${low.features.charGfxArcs} · 채우기 ${low.features.charGfxFills}`,
  );
  expect(high.cap.ok && low.cap.ok).toBe(true);
  expect(high.downgrades).toBe(0);
  for (const h of high.cap.stats) {
    const l = low.cap.stats.find((x) => x.name === h.name)!;
    expect(h.deltaE!, `${h.name} 역할색 ΔE (높음)`).toBeLessThanOrEqual(15);
    expect(h.contrast, `${h.name} 대비 (높음)`).toBeGreaterThanOrEqual(3);
    expect(h.contrast, `${h.name} 대비 높음 ≥ 낮음 × 0.8`).toBeGreaterThanOrEqual(l.contrast * 0.8);
    expect(deltaE(h.mean, l.mean), `${h.name} 몸 평균색 Lab ΔE(높음, 낮음)`).toBeLessThanOrEqual(10);
  }
  expectFxOnlyOnMap(high.targets, '높음 (생존자)');
  // 빛 속 먼지는 그림 묶음 이미지: 먼지가 떠 있어도 캐릭터 쪽 Graphics 원호 명령은 0 (정적 장면, 이벤트 효과 없음)
  expect(Number(high.cap.effects.dust)).toBeGreaterThan(0);
  expect(high.features.charGfxArcs).toBe(0);
  expect(low.features.charGfxArcs).toBe(0);
  // 후처리 렌더 타깃 바이트: 높음(WebGL) > 0, Canvas 낮음 0
  expect(Number(high.features.postFxBytes)).toBeGreaterThan(0);
  expect(low.features.postFxBytes).toBe(0);
  expect(high.problems).toEqual([]);
  expect(low.problems).toEqual([]);
});

test('기절 채도 감소 (WebGL 높음): 맵 위 · 캐릭터 아래라 숨은 생존자 흰색 · 몸/링 대비 · 가드 노출 링이 그대로, 별도 몸을 덮지 않는다', async ({
  browser,
}) => {
  // 겹치는 프레임을 놓치면 밀치기 쿨타임(35초)을 기다려 다시 민다
  test.setTimeout(300_000);
  const s = await startRoom(browser, 'monster', '&renderer=webgl&quality=high', 'guard');
  const { send, id } = s;
  const page = s.host.page;
  const guard = s.guest!.page;
  const sr = balance.survivor.radius;
  const M: [number, number] = [42, 12];
  const spots: Record<string, [number, number, number]> = {
    runner: [42, 11.3, Math.PI / 2],
    guard: [40.6, 12.3, 0],
    scout: [40.5, 13.6, Math.PI / 2],
  };
  await s.placeBots([
    ['runner', ...spots.runner!],
    ['scout', ...spots.scout!],
  ]);
  await send({ kind: 'teleport', target: id('guard'), x: 40.6, y: 12.3, face: 0 });
  await send({ kind: 'teleport', target: id('monster'), x: M[0], y: M[1], face: Math.PI });
  await aimAt(page, 36, M[1]);
  await noBanners(page);
  const clocks = [0, 1, 2, 3].map((j) => (((3 * Math.PI) / 2 + (j * 2 * Math.PI) / 9) / 3.85) * 1000);
  await page.evaluate((ms) => window.__DECOY__?.freezeClock(ms), clocks[0]!);
  await page.waitForTimeout(1000);
  const probes: BodyProbe[] = Object.entries(spots).map(([name, [x, y, face]]) => ({
    name,
    x,
    y,
    face,
    r: sr,
  }));
  const ref = { runner: ROLE_HEX.runner, guard: ROLE_HEX.guard, scout: ROLE_HEX.scout };
  // 기절 전 기준: 별 위상(장식 시계)마다
  const before = await captureSweep(page, probes, clocks, { refColors: ref, markColors: [STAR_HEX] });
  console.log(`[m10-visual.webgl] 기절 전: ${describeCapture(before[0]!)}`);
  expect(before.every((c) => c.ok)).toBe(true);
  expect(before[0]!.drawn.filter((d) => d.kind === 'survivor').length).toBe(3);
  // 밀치기 직후(채도 감소 + 별 + 가드 노출)부터 별 위상을 잇달아 훑는다 (SwiftShader는 느려 기절 1.5초 안에 한 번에).
  // 노출(1초)과 기절(1.5초)이 겹치는 창은 약 1초라, 러너가 몹시 느려 프레임 간격이 그보다 길면 한 프레임도 못 볼 수 있다:
  // 그때는 밀치기 쿨타임(35초)을 기다려 자리를 다시 잡고 다시 민다 (최대 3번)
  let sweep: Awaited<ReturnType<typeof captureSweep>> = [];
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    if (attempt > 1) {
      await guard.waitForFunction(
        () => (window.__DECOY__?.getLastSnapshot()?.you.surv?.abilityCd ?? 1) <= 0,
        null,
        {
          timeout: 60_000,
          polling: 250,
        },
      );
      await send({ kind: 'teleport', target: id('guard'), x: 40.6, y: 12.3, face: 0 });
      await send({ kind: 'teleport', target: id('monster'), x: M[0], y: M[1], face: Math.PI });
      await page.waitForTimeout(1500);
    }
    await page.evaluate((ms) => window.__DECOY__?.freezeClock(ms), clocks[0]!);
    await guard.keyboard.press('Space');
    sweep = await captureSweep(page, probes, clocks, {
      waitEffects: ['desaturate', 'stunStars', 'reveal'],
      refColors: ref,
      markColors: [STAR_HEX],
      firstClockSet: true,
    });
    if (sweep[0]?.ok === true) break;
    const fps = await page.evaluate(() => window.__DECOY__?.fps ?? 0);
    console.log(
      `[m10-visual.webgl] 밀치기 ${attempt}번째: 겹치는 프레임을 못 봄 (괴물 화면 ${fps.toFixed(1)}fps) — 다시`,
    );
  }
  let dsatSeen = 0;
  let starSeen = 0;
  for (const [i, c] of sweep.entries()) {
    console.log(
      `[m10-visual.webgl] 기절 중 (위상 ${i}, 채도 감소 ${String(c.effects.desaturate)} · 별 ${String(c.effects.stunStars)} · 노출 ${String(c.effects.reveal)}): ${describeCapture(c)} · 가드 링 ${c.stats[1]?.ringRoleHits} · 러너 몸 안 별색 ${c.stats[0]?.bodyMarkHits}`,
    );
    if (!c.ok) continue;
    // 채도 감소 막: 숨은 몸 흰색 · 평균색 그대로, 별과 떨어진 몸의 몸/링 대비 ≥ 기절 전 80%, 가드 노출 링 그대로
    if (c.effects.desaturate === true) {
      dsatSeen += 1;
      for (const b of c.stats) {
        const b0 = before[i]!.stats.find((x) => x.name === b.name)!;
        expect(b.whiteFrac, `위상 ${i} ${b.name} 흰 비율 (채도 감소 중)`).toBeGreaterThanOrEqual(0.9);
        expect(deltaE(b.mean, b0.mean), `위상 ${i} ${b.name} 몸 평균색 그대로`).toBeLessThanOrEqual(3);
        expect(b.bodyMarkHits, `위상 ${i} ${b.name} 몸 안 별색`).toBeLessThanOrEqual(2);
        if (b.name === 'guard') {
          if (Number(c.effects.reveal) > 0)
            expect(b.ringRoleHits, `위상 ${i} 가드 노출 링`).toBeGreaterThan(20);
        } else
          expect(b.contrast, `위상 ${i} ${b.name} 몸/링 대비 ≥ 기절 전 80%`).toBeGreaterThanOrEqual(
            b0.contrast * 0.8,
          );
      }
    }
    // 별: 몸 아래 · 옆 몸과 링을 비켜 가 북쪽 러너 몸이 위상마다 기절 전 같은 위상과 같다
    if (c.effects.stunStars === true) {
      starSeen += 1;
      const b = c.stats.find((x) => x.name === 'runner')!;
      const b0 = before[i]!.stats.find((x) => x.name === 'runner')!;
      expect(deltaE(b.mean, b0.mean), `위상 ${i} 북쪽 러너 몸 평균색 그대로`).toBeLessThanOrEqual(2);
      expect(b.contrast, `위상 ${i} 북쪽 러너 몸/링 대비`).toBeGreaterThanOrEqual(3);
    }
  }
  expect(sweep[0]!.ok && sweep[0]!.effects.reveal, '밀치기 직후 프레임 (가드 노출 중)').toBeTruthy();
  expect(dsatSeen, '채도 감소가 보인 위상 수').toBeGreaterThanOrEqual(1);
  // SwiftShader가 몹시 느리면(부하 · 1FPS 안팎) 기절 1.5초 안에 한 위상만 볼 수 있다. 여러 위상은 Canvas 검사(m10-visual.spec.ts)가 본다
  expect(starSeen, '별이 보인 위상 수').toBeGreaterThanOrEqual(1);
  const gfx = await page.evaluate(() => window.__DECOY__!.gfx);
  expect(gfx.renderer).toBe('webgl');
  expect(gfx.downgrades).toBe(0);
  expect(s.host.problems).toEqual([]);
  expect(s.guest!.problems).toEqual([]);
  await s.close();
});

// ───────────────────────── 품질별 정보 동일성 · 범위 반지름 (WebGL 높음 · 중간 · Canvas 낮음) ─────────────────────────

const CONFIGS = [
  { name: 'webgl-high', q: '&renderer=webgl&quality=high' },
  { name: 'webgl-medium', q: '&renderer=webgl&quality=medium' },
  { name: 'canvas-low', q: '&renderer=canvas&quality=low' },
] as const;

const DEG = Math.PI / 180;
const r3 = (v: number): number => Math.round(v * 1000) / 1000;

/** 그린 엔티티를 품질과 무관한 문자열로 (봇 id는 판마다 다르니 역할로) */
function drawnKey(c: Capture, roleOf: (id: string) => string): string[] {
  return c.drawn
    .map(
      (d) =>
        `${d.kind}:${d.tag ?? roleOf(d.id)}:${r3(d.x)},${r3(d.y)},${r3(Math.cos(d.face))},${r3(Math.sin(d.face))}`,
    )
    .sort();
}

/** 범위 선 반지름 판정: 찾은 광선 수 · 중앙값 · ±2px 안 비율 */
function expectRays(r: RayResult, label: string, minFound: number): void {
  const errs = r.found.map((f, i) => (f === null ? null : f - r.expectPx[i]!));
  const found = errs.filter((e): e is number => e !== null);
  const med = median(errs);
  console.log(
    `[m10-visual.webgl] ${label} ${r.name}: 찾음 ${found.length}/${r.found.length} · 오차 중앙값 ${med?.toFixed(2)}px · 범위 ${Math.min(...found).toFixed(2)}~${Math.max(...found).toFixed(2)}px (기대 ${r.expectPx[0]?.toFixed(1)}px)`,
  );
  expect(found.length, `${label} ${r.name} 찾은 광선`).toBeGreaterThanOrEqual(minFound);
  expect(Math.abs(med!), `${label} ${r.name} 반지름 중앙값`).toBeLessThanOrEqual(2);
  const within = found.filter((e) => Math.abs(e) <= 2).length;
  expect(within / found.length, `${label} ${r.name} ±2px 안 비율`).toBeGreaterThanOrEqual(0.85);
}

/** 공격 준비 범위 반지름 (가운데 줄) · 직선 변 각도 (±arc/2) */
function expectAttack(c: Capture, it: InfoItem, label: string): void {
  console.log(
    `[m10-visual.webgl] ${label} 공격 범위 경계 ${c.rangePx?.toFixed(2)}px (판정 ${c.rangeExpectPx?.toFixed(2)}px) · 변 ${c.arcs.map((a) => `${((a.angle ?? NaN) / DEG).toFixed(1)}°`).join(', ')}`,
  );
  expect(Math.abs(c.rangePx! - c.rangeExpectPx!), `${label} 공격 반지름`).toBeLessThanOrEqual(2);
  const half = (balance.monster.attack.arc * DEG) / 2;
  const want = [it.dir! - half, it.dir! + half];
  c.arcs.forEach((a, i) => {
    expect(a.angle, `${label} 공격 변 ${i}`).not.toBeNull();
    let d = a.angle! - want[i]!;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    expect(Math.abs(d) * a.rhoPx, `${label} 공격 변 ${i} 각도 (px)`).toBeLessThanOrEqual(2);
  });
}

/**
 * 차오르는 앞머리 호(반지름 = 채움 × 사거리, 판정 경계와 같은 색 · 층)가 변을 재는 원 가까이 있으면 그 밝은 호를 변으로
 * 잘못 잡는다(러너에서 채움 0.87쯤 프레임이 잡혀 변이 ±35°로 재진 적이 있다). 그런 프레임은 쓰지 않는다
 */
function frontArcNearProbe(cap: Capture, opts: CaptureOptions): boolean {
  const fill = Number(cap.effects.attackFill ?? 0);
  const front = fill * balance.monster.attack.range;
  // 범위 경계 탐침은 0.7R~1.3R을 바깥에서 훑어 '최댓값 − 25' 이상인 첫 띠를 고른다: 받침 없는 흰 앞머리 호(실측 217)가
  // 그 안에 있으면 경계(176)가 문턱에서 빠진다(채움 0.82에서 −5.7px). 채움 1(다 참)은 앞머리 호가 경계와 겹쳐 괜찮다
  if (opts.range && fill >= 0.65 && fill < 0.97) return true;
  return (opts.arcs ?? []).some((a) => Math.abs(front - a.rho) < 0.12);
}

/**
 * 괴물이 공격을 누르고 보는 화면에서 공격 준비 첫 프레임을 잰다. SwiftShader가 느려(4~10FPS) 0.4초 준비 동안 그린 프레임을
 * 놓칠 수 있으므로 놓치면 쿨타임(1.5초) 뒤 다시 누른다(여섯 번까지, 같은 자리 · 같은 조준이라 정보는 같다).
 * 앞머리 호가 변을 재는 원에 걸친 프레임도 다시 잰다
 */
async function windupCapture(view: Page, clicker: Page, opts: CaptureOptions): Promise<Capture> {
  let cap: Capture | null = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await clicker.mouse.down({ button: 'left' });
    await clicker.mouse.up({ button: 'left' });
    cap = await captureBodies(view, [], { ...opts, waitInfo: 'attack', timeoutMs: 2500 });
    if (cap.ok && !frontArcNearProbe(cap, opts)) return cap;
    if (cap.ok)
      console.log(
        `[m10-visual.webgl] 공격 준비 채움 ${String(cap.effects.attackFill)}: 앞머리 호가 변 측정 원에 걸쳐 다시`,
      );
    await view.waitForTimeout(1700);
  }
  return cap!;
}

interface MonsterScenes {
  campInfo: InfoItem[];
  campDrawn: string[];
  attackInfo: InfoItem[];
  roarInfo: InfoItem[];
  problems: string[];
  downgrades: number;
}

/** 괴물 화면 (탭 하나 = 품질 cfg): 감옥 앞 캠핑 · 근접 원 → 공격 준비 → 포효 */
async function monsterRun(browser: Browser, cfg: (typeof CONFIGS)[number]): Promise<MonsterScenes> {
  const s = await startRoom(browser, 'monster', cfg.q);
  const { send, id } = s;
  const page = s.host.page;
  const label = `${cfg.name} 괴물`;
  await send({ kind: 'setSurvivor', target: id('runner'), status: 'imprisoned', hp: 2 });
  await s.placeBots([
    ['runner', 23.5, 15.5, 0],
    ['guard', 5, 2, 0],
    ['scout', 45, 2, 0],
  ]);
  // 감옥 아래 (24,21): 철창 사각형까지 3타일 ≤ campRadius 4. 근접 원 1.5 안은 트인 바닥. 동쪽을 본다
  await send({ kind: 'teleport', target: id('monster'), x: 24, y: 21, face: 0 });
  await aimAt(page, 30, 21);
  await noBanners(page);
  await page.evaluate(() => window.__DECOY__?.freezeClock(1000));
  await page.waitForFunction(() => window.__DECOY__?.getLastSnapshot()?.you.mon?.camp === 2, null, {
    timeout: 20_000,
  });
  await page.waitForTimeout(300);
  const roleOf = (pid: string): string =>
    ['runner', 'guard', 'scout', 'monster'].find((r) => id(r) === pid) ?? '-';
  const near = balance.monster.nearVisionRadius;
  const cr = balance.prison.campRadius;
  // 근접 원: 부채꼴(동쪽 ±55°) 밖 · 캠핑 선과 겹치지 않는 서 · 북쪽 방향
  const nearAngles = [160, 180, 200, 220, 240, 260, 280].map((d) => d * DEG);
  // 캠핑: 철창 사각형(22~26 × 14~18)에서 campRadius 떨어진 둥근 사각형 → 감옥 중심에서 서 · 북 · 동 6타일, 북서 대각선 2√2 + 4
  const campAngles = [Math.PI, -Math.PI / 2, 0, (-3 * Math.PI) / 4];
  const campExpect = [2 + cr, 2 + cr, 2 + cr, 2 * Math.SQRT2 + cr];
  const camp = await captureBodies(page, [], {
    waitInfo: 'camp',
    rays: [
      {
        name: '근접 원 1.5',
        x: 24,
        y: 21,
        metric: 'warm',
        angles: nearAngles,
        expect: nearAngles.map(() => near),
      },
      {
        name: '캠핑 4',
        x: PRISON_CENTER.x,
        y: PRISON_CENTER.y,
        metric: 'warm',
        angles: campAngles,
        expect: campExpect,
        lo: 0.85,
        hi: 1.15,
      },
    ],
  });
  expect(camp.ok, `${label} 캠핑`).toBe(true);
  expect(camp.info.find((i) => i.tag === 'near')?.r).toBe(near);
  expect(camp.info.find((i) => i.tag === 'camp')?.r).toBe(cr);
  expectRays(camp.rays[0]!, label, nearAngles.length);
  expectRays(camp.rays[1]!, label, campAngles.length);
  // 공격 준비 (첫 프레임: 차오르는 앞머리가 아직 경계 근처가 아니다)
  const me = (await page.evaluate(() => window.__DECOY__?.getRenderPos()))!;
  const half = (balance.monster.attack.arc * DEG) / 2;
  const atk = await windupCapture(page, page, {
    range: { x: me.x, y: me.y, dir: me.face, tiles: balance.monster.attack.range },
    arcs: [-1, 1].map((sg) => ({
      name: `변 ${sg}`,
      x: me.x,
      y: me.y,
      rho: 1.05,
      a0: me.face + sg * half - 0.35,
      a1: me.face + sg * half + 0.35,
      metric: 'lum' as const,
    })),
  });
  expect(atk.ok, `${label} 공격 준비`).toBe(true);
  const atkItem = atk.info.find((i) => i.tag === 'attack')!;
  expect(atkItem.r).toBe(balance.monster.attack.range);
  expectAttack(atk, atkItem, label);
  await page.waitForTimeout(1600);
  // 포효
  await page.keyboard.press('KeyQ');
  const roar = await captureBodies(page, [], { waitInfo: 'roar' });
  expect(roar.ok, `${label} 포효`).toBe(true);
  expect(roar.info.find((i) => i.tag === 'roar')?.r).toBe(balance.monster.roar.radius);
  const gfx = await page.evaluate(() => window.__DECOY__!.gfx);
  console.log(
    `[m10-visual.webgl] ${label}: 원호 ${gfx.features.charGfxArcs} · 채우기 ${gfx.features.charGfxFills} · 하향 ${gfx.downgrades}`,
  );
  const out: MonsterScenes = {
    campInfo: camp.info,
    campDrawn: drawnKey(camp, roleOf),
    attackInfo: atk.info,
    roarInfo: roar.info,
    problems: [...s.host.problems],
    downgrades: gfx.downgrades,
  };
  await s.close();
  return out;
}

interface GuardScenes {
  info: InfoItem[];
  drawn: string[];
  attackInfo: InfoItem[];
  problems: string[];
  downgrades: number;
}

/** 가드 화면 (탭 하나 = 품질 cfg, 괴물은 Canvas 낮음 손님): 수감자 → 구조 구역, 밀치기 사거리, 괴물 부채꼴 → 공격 준비 */
async function guardRun(browser: Browser, cfg: (typeof CONFIGS)[number]): Promise<GuardScenes> {
  const s = await startRoom(browser, 'guard', cfg.q, 'monster');
  const { send, id } = s;
  const page = s.host.page;
  const mon = s.guest!.page;
  const label = `${cfg.name} 가드`;
  await send({ kind: 'setSurvivor', target: id('runner'), status: 'imprisoned', hp: 2 });
  await s.placeBots([
    ['runner', 23.5, 15.5, 0],
    ['scout', 45, 2, 0],
  ]);
  const G = { x: 29.9, y: 19.5 };
  const M = { x: 31.6, y: 19.5 };
  await send({ kind: 'teleport', target: id('guard'), x: G.x, y: G.y, face: Math.PI });
  // 괴물은 남쪽을 본다 (공격 범위 · 부채꼴이 가드 · 나 표시 링과 겹치지 않게)
  await send({ kind: 'teleport', target: id('monster'), x: M.x, y: M.y, face: Math.PI / 2 });
  await aimAt(mon, M.x, 26);
  await noBanners(page);
  await page.evaluate(() => window.__DECOY__?.freezeClock(1000));
  await page.waitForFunction(
    () => {
      const info = window.__DECOY__?.getInfoLayer() ?? [];
      const a = window.__DECOY__?.getLastSnapshot()?.monster?.aim;
      return (
        info.some((i) => i.tag === 'shove') &&
        info.some((i) => i.tag === 'rescue') &&
        info.some((i) => i.kind === 'cone') &&
        a !== undefined &&
        Math.abs(a - Math.PI / 2) < 0.005
      );
    },
    null,
    { timeout: 20_000 },
  );
  await page.waitForTimeout(300);
  const roleOf = (pid: string): string =>
    ['runner', 'guard', 'scout', 'monster'].find((r) => id(r) === pid) ?? '-';
  const shoveR = balance.roles.guard.shoveRange;
  const rr = balance.prison.rescueRadius;
  // 밀치기 점선: 24칸 각 점의 가운데 (괴물 쪽 동쪽 ±40°는 뺀다)
  const shoveAngles = Array.from({ length: 24 }, (_, i) => ((i + 0.275) * 2 * Math.PI) / 24).filter(
    (a) => Math.cos(a) < Math.cos(40 * DEG),
  );
  // 구조 구역 점선 (돌아가는 점선이라 촘촘히): 아래쪽 반원 (위쪽은 감옥 문 네온)
  const rescueAngles = Array.from({ length: 48 }, (_, i) => (0.12 + (0.76 * i) / 47) * Math.PI);
  const cap = await captureBodies(page, [], {
    rays: [
      {
        name: '밀치기 2',
        x: G.x,
        y: G.y,
        metric: 'purple',
        angles: shoveAngles,
        expect: shoveAngles.map(() => shoveR),
        minPeak: 25,
      },
      {
        name: '구조 1.2',
        x: RESCUE_POINT.x,
        y: RESCUE_POINT.y,
        metric: 'cyan',
        angles: rescueAngles,
        expect: rescueAngles.map(() => rr),
        minPeak: 40,
      },
    ],
  });
  expect(cap.ok, `${label} 장면`).toBe(true);
  expect(cap.info.find((i) => i.tag === 'shove')?.value).toBe('in');
  expectRays(cap.rays[0]!, label, Math.floor(shoveAngles.length * 0.6));
  expectRays(cap.rays[1]!, label, Math.floor(rescueAngles.length * 0.3));
  // 괴물 공격 준비 (생존자 화면: 서버 값으로)
  const snapMon = (await page.evaluate(() => window.__DECOY__?.getLastSnapshot()?.monster))!;
  const half = (balance.monster.attack.arc * DEG) / 2;
  const atk = await windupCapture(page, mon, {
    range: { x: snapMon.x, y: snapMon.y, dir: snapMon.aim, tiles: balance.monster.attack.range },
    arcs: [-1, 1].map((sg) => ({
      name: `변 ${sg}`,
      x: snapMon.x,
      y: snapMon.y,
      rho: 1.05,
      a0: snapMon.aim + sg * half - 0.35,
      a1: snapMon.aim + sg * half + 0.35,
      metric: 'lum' as const,
    })),
  });
  expect(atk.ok, `${label} 공격 준비`).toBe(true);
  expectAttack(
    atk,
    atk.info.find((i) => i.tag === 'attack')!,
    label,
  );
  const gfx = await page.evaluate(() => window.__DECOY__!.gfx);
  const out: GuardScenes = {
    info: cap.info,
    drawn: drawnKey(cap, roleOf),
    attackInfo: atk.info,
    problems: [...s.host.problems, ...s.guest!.problems],
    downgrades: gfx.downgrades,
  };
  await s.close();
  return out;
}

test('품질 WebGL 높음 · 중간 · Canvas 낮음: 범위가 있는 장면의 정보 레이어 · 그린 엔티티가 같고 범위 반지름 · 각도 = 판정값 ±2px', async ({
  browser,
}) => {
  test.setTimeout(600_000);
  const mons: MonsterScenes[] = [];
  const guards: GuardScenes[] = [];
  for (const cfg of CONFIGS) {
    mons.push(await monsterRun(browser, cfg));
    guards.push(await guardRun(browser, cfg));
  }
  const [mh, mm, ml] = mons;
  const [gh, gm, gl] = guards;
  for (const [a, name] of [
    [mh!, '높음'],
    [mm!, '중간'],
  ] as const) {
    expect(a.campInfo, `괴물 캠핑 · 근접 원 정보 (${name} = 낮음)`).toEqual(ml!.campInfo);
    expect(a.campDrawn, `괴물 캠핑 그린 엔티티 (${name} = 낮음)`).toEqual(ml!.campDrawn);
    expect(a.attackInfo, `괴물 공격 준비 정보 (${name} = 낮음)`).toEqual(ml!.attackInfo);
    expect(a.roarInfo, `괴물 포효 정보 (${name} = 낮음)`).toEqual(ml!.roarInfo);
  }
  for (const [a, name] of [
    [gh!, '높음'],
    [gm!, '중간'],
  ] as const) {
    expect(a.info, `가드 구조 구역 · 밀치기 · 부채꼴 정보 (${name} = 낮음)`).toEqual(gl!.info);
    expect(a.drawn, `가드 그린 엔티티 (${name} = 낮음)`).toEqual(gl!.drawn);
    expect(a.attackInfo, `가드 화면 공격 준비 정보 (${name} = 낮음)`).toEqual(gl!.attackInfo);
  }
  // 장면에 범위 항목이 실제로 있다 (빈 비교가 아니다)
  for (const tag of ['camp', 'near'])
    expect(
      ml!.campInfo.some((i) => i.tag === tag),
      tag,
    ).toBe(true);
  expect(ml!.campInfo.some((i) => i.kind === 'cone' && i.tag === 'self')).toBe(true);
  expect(ml!.attackInfo.some((i) => i.tag === 'attack')).toBe(true);
  expect(ml!.roarInfo.some((i) => i.tag === 'roar')).toBe(true);
  for (const tag of ['rescue', 'shove', 'monster'])
    expect(
      gl!.info.some((i) => i.tag === tag),
      tag,
    ).toBe(true);
  expect(gl!.attackInfo.some((i) => i.tag === 'attack')).toBe(true);
  for (const r of [...mons, ...guards]) {
    expect(r.downgrades).toBe(0);
    expect(r.problems).toEqual([]);
  }
});

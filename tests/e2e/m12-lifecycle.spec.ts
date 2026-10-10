// M12 앱 생명주기 (MOBILE_PLAN M12 자동 검증 'E2E m12-lifecycle'): 숨김 · 소켓 끊김 · 반쯤 열린 소켓 · 오프라인 · 마지막 방 복귀 ·
// 뒤로 가기 확인 · 화면 꺼짐 방지 · 진동 · 판 직전 터치 안내와 판 중 10초 위치 표시(입력을 막지 않음) · 다른 탭 안내.
// 성능 항목은 m12-perf.
// 헤드리스 크롬에서 실제로 되는 방법(실험으로 확인, Chromium 141):
//  - 숨김: 탭 전환 · 창 최소화 · CDP 어느 것도 document.visibilityState를 바꾸지 않는다 → 시작 스크립트가 visibilityState ·
//    hidden을 덮어쓰고 visibilitychange를 낸다. 실제 멈춤은 CDP Page.setWebLifecycleState(frozen)로 함께 흉내 낸다
//  - 이 탭의 소켓만 끊기 · 반쯤 열린 소켓: page.routeWebSocket으로 서버와 이어 주며 한쪽만 닫거나 서버 → 페이지 중계만 멈춘다
//  - 오프라인: context.setOffline(true)는 navigator.onLine을 false로 하고 offline 이벤트를 내지만 열린 소켓은 OPEN인 채
//    아무것도 오가지 않는다(반쯤 열린 소켓과 같다). 그 사이 새 WebSocket을 만들면 콘솔 에러(ERR_INTERNET_DISCONNECTED)가 난다
//  - page.evaluate · locator 기다리기는 사용자 활성화를 준다 → '활성화 전' 진동은 시작 스크립트에서(어떤 evaluate보다 먼저) 본다
// 느린 CI 대비: 간격 폴링(100~200ms), 시간 창은 넉넉히(3초 · 2초 기준은 그 시각을 페이지 안에서 잰다)
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
  type WebSocketRoute,
} from '@playwright/test';
import type { Role } from '@decoy/shared';
import type { LifecycleDebug } from '../../client/src/lifecycle';
import {
  BASE_QUERY,
  PHONE_LANDSCAPE,
  createRoom,
  dpr1,
  inputLog,
  myId,
  newPlayerPage,
  pickRoleAndReady,
  press,
  sendTest,
  truth,
  waitForSnapshots,
  watchConsole,
  type DeviceOptions,
} from './helpers';
import { MultiTouch, centerOf, waitForTouchTarget } from './touch';

/** 기능 시험 기기: Pixel 7 가로 전체 화면 915×412, 기기 배율 1 */
const PHONE = dpr1(PHONE_LANDSCAPE);
const POLL = { intervals: [100, 150, 200], timeout: 20_000 };

// ───────────── 페이지 안 시작 스크립트 ─────────────

interface E2EWindow {
  __e2eSetVisible?: (on: boolean) => void;
  __e2eWake?: { op: string; id: number; vis: string }[];
  __e2eVib?: { pattern: number[]; active: boolean }[];
  __e2eEarlyVib?: { calls: number; active: boolean } | null;
  __e2ePush?: { active: boolean; ev: string | null }[];
  __DECOY_LIFE__?: LifecycleDebug;
}

/** 숨김 흉내 + 가짜 전체 화면 · 가로 고정 (헤드리스에서 진짜 전체 화면이 되면 창 크기가 바뀌어 시험마다 달라진다) */
function baseInit(): void {
  const w = window as unknown as E2EWindow;
  let vis: DocumentVisibilityState = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => vis });
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => vis === 'hidden' });
  w.__e2eSetVisible = (on) => {
    vis = on ? 'visible' : 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
  };
  Element.prototype.requestFullscreen = () => Promise.resolve();
  if (typeof ScreenOrientation !== 'undefined')
    (ScreenOrientation.prototype as unknown as { lock: () => Promise<void> }).lock = () => Promise.resolve();
  // 뒤로 가기 기록 항목: 넣는 순간 사용자 활성화 · 이벤트 종류
  const push = history.pushState.bind(history);
  w.__e2ePush = [];
  history.pushState = (data: unknown, unused: string, url?: string | URL | null) => {
    const ev = window.event;
    w.__e2ePush?.push({ active: navigator.userActivation.isActive, ev: ev ? ev.type : null });
    push(data, unused, url);
  };
}

/** 가짜 Wake Lock: 요청 · 해제를 적고, 숨겨지면 브라우저처럼 스스로 놓는다 */
function fakeWakeLock(): void {
  const w = window as unknown as E2EWindow;
  const log: { op: string; id: number; vis: string }[] = [];
  w.__e2eWake = log;
  const held: { id: number; released: boolean; release: () => Promise<void> }[] = [];
  let n = 0;
  const api = {
    request: (): Promise<{ released: boolean; release: () => Promise<void> }> => {
      n += 1;
      const id = n;
      log.push({ op: 'request', id, vis: document.visibilityState });
      const s = {
        id,
        released: false,
        release: (): Promise<void> => {
          if (!s.released) {
            s.released = true;
            log.push({ op: 'release', id, vis: document.visibilityState });
          }
          return Promise.resolve();
        },
      };
      held.push(s);
      return Promise.resolve(s);
    },
  };
  Object.defineProperty(navigator, 'wakeLock', { configurable: true, get: () => api });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'hidden') return;
    for (const s of held)
      if (!s.released) {
        s.released = true;
        log.push({ op: 'auto-release', id: s.id, vis: 'hidden' });
      }
  });
}

/**
 * 가짜 진동: 부른 패턴과 그때 사용자 활성화를 적는다. 문서가 준비되자마자(어떤 evaluate보다 먼저 — evaluate는 활성화를 준다)
 * 시험 훅으로 피격 진동을 한 번 불러, 활성화 전에는 부르지 않는지 본다
 */
function fakeVibrate(): void {
  const w = window as unknown as E2EWindow;
  w.__e2eVib = [];
  w.__e2eEarlyVib = null;
  // Phaser가 부팅 때 navigator.vibrate에 다시 대입하므로 쓸 수 있게 둔다
  Object.defineProperty(navigator, 'vibrate', {
    configurable: true,
    writable: true,
    value: (p: number | number[]) => {
      w.__e2eVib?.push({
        pattern: Array.isArray(p) ? p.slice() : [p],
        active: navigator.userActivation.hasBeenActive,
      });
      return true;
    },
  });
  document.addEventListener('DOMContentLoaded', () => {
    const active = navigator.userActivation.hasBeenActive;
    const hook = w.__DECOY_LIFE__;
    if (!hook) return;
    hook.hapticHit(0);
    w.__e2eEarlyVib = { calls: w.__e2eVib?.length ?? 0, active };
  });
}

// ───────────── 소켓 중계 (page.routeWebSocket) ─────────────

interface RelayPair {
  page: WebSocketRoute;
  server: WebSocketRoute;
  /** 서버 → 페이지 중계를 멈춘다 (반쯤 열린 소켓) */
  hold: boolean;
  /** 끊었다: 어느 쪽으로도 더 보내지 않는다 (닫히는 중인 소켓에 보내면 페이지 콘솔 에러) */
  cut: boolean;
}

interface Relay {
  pairs: RelayPair[];
  /** 페이지가 보낸 join 수 */
  joins: number;
  /** 페이지 쪽이 닫혀도 서버 쪽은 열어 둔다 (서버가 끊김을 모르는 옛 소켓) */
  keepServer: boolean;
}

/** 이 페이지의 WebSocket을 서버와 이어 준다 (페이지를 열기 전에 건다) */
async function relayWs(page: Page): Promise<Relay> {
  const r: Relay = { pairs: [], joins: 0, keepServer: false };
  await page.routeWebSocket(/\/ws$/, (ws) => {
    const server = ws.connectToServer();
    const pair: RelayPair = { page: ws, server, hold: false, cut: false };
    r.pairs.push(pair);
    ws.onMessage((m) => {
      if (typeof m === 'string' && m.includes('"t":"join"')) r.joins += 1;
      if (!pair.cut) server.send(m);
    });
    server.onMessage((m) => {
      if (!pair.hold && !pair.cut) ws.send(m);
    });
    // 어느 쪽이 먼저 닫히든 중계를 멈춘다 (닫힌 소켓에 보내면 콘솔 에러가 난다)
    ws.onClose(() => {
      pair.cut = true;
      if (!r.keepServer) void server.close();
    });
    server.onClose(() => {
      pair.cut = true;
      void ws.close();
    });
  });
  return r;
}

/** 이 탭의 지금 소켓만 끊는다 (양쪽 모두, OS가 끊은 것처럼) */
async function cutSocket(r: Relay): Promise<void> {
  const p = r.pairs.at(-1);
  if (!p) throw new Error('중계 중인 소켓 없음');
  p.cut = true;
  await p.server.close();
  await p.page.close();
}

// ───────────── 도우미 ─────────────

async function life<T>(page: Page, fn: (h: LifecycleDebug) => T): Promise<T> {
  return page.evaluate((src) => {
    const h = (window as unknown as E2EWindow).__DECOY_LIFE__;
    if (!h) throw new Error('__DECOY_LIFE__ 없음');
    return (new Function('h', `return (${src})(h)`) as (h: LifecycleDebug) => T)(h);
  }, fn.toString());
}

async function setVisible(page: Page, on: boolean): Promise<void> {
  await page.evaluate((v) => (window as unknown as E2EWindow).__e2eSetVisible?.(v), on);
}

interface Solo {
  context: BrowserContext;
  page: Page;
  problems: string[];
  code: string;
  id: string;
  relay: Relay | null;
}

/** 봇 방을 만들어 역할을 고르고 혼자 시작한다 (빈 역할은 서버 봇). 터치 기기는 로비를 탭으로 */
async function soloMatch(
  browser: Browser,
  device: DeviceOptions | undefined,
  role: Role,
  opts: { relay?: boolean; inits?: (() => void)[] } = {},
): Promise<Solo> {
  const { context, page, problems } = await newPlayerPage(browser, device);
  for (const init of [baseInit, ...(opts.inits ?? [])]) await context.addInitScript(init);
  const relay = opts.relay ? await relayWs(page) : null;
  const code = await createRoom(page, '&bots=1');
  await pickRoleAndReady(page, role);
  await press(page.getByTestId('start-button'));
  await waitForSnapshots(page, 3);
  return { context, page, problems, code, id: await myId(page), relay };
}

const snapCount = (page: Page): Promise<number> => page.evaluate(() => window.__DECOY__?.snapCount ?? 0);
const lastTick = (page: Page): Promise<number> =>
  page.evaluate(() => window.__DECOY__?.getLastSnapshot()?.tick ?? -1);

/**
 * 다시 연결해 같은 자리로 스냅샷이 다시 온다: 서버 틱 tick0 뒤의 스냅샷 3개 (판은 이어지므로 틱은 계속 는다).
 * 다시 들어가면 서버가 match를 또 보내 snapCount가 0부터 센다 — 숨기기 전까지 쌓인 수와 견주지 않는다
 */
async function waitForResumed(page: Page, tick0: number, id: string): Promise<void> {
  await page.waitForFunction(
    ([t, me]) => {
      const d = window.__DECOY__;
      return !!d && d.snapCount >= 3 && (d.getLastSnapshot()?.tick ?? -1) > (t as number) && d.you === me;
    },
    [tick0, id] as const,
    { polling: 100, timeout: 20_000 },
  );
}

/** 다른 플레이어(봇)를 세운다: 괴물 봇의 공격 진동이 세는 값에 섞이지 않게 */
async function freezeOthers(s: Solo): Promise<void> {
  const tr = await truth(s.page, s.code);
  for (const p of tr.players)
    if (p.id !== s.id) await sendTest(s.page, { kind: 'freeze', target: p.id, frozen: true });
}

/** 가짜 진동이 받은 피격 패턴(한 번 울림) 수 */
const hitVibes = (page: Page): Promise<number> =>
  page.evaluate(
    () => (window as unknown as E2EWindow).__e2eVib?.filter((v) => v.pattern.length === 1).length ?? 0,
  );

/**
 * 숨김에서 돌아와 다시 연결한 뒤 시계를 맞추면 진동이 다시 울린다: 숨김이 진동을 막고(holdClock), 새 소켓의 첫 pong이
 * 푼다(clockSynced). 풀리지 않으면 그 뒤 판 내내 피격 · 발각 진동이 0번이다
 */
async function expectHapticsBack(page: Page): Promise<void> {
  await expect.poll(() => life(page, (h) => h.clockFresh), POLL).toBe(true);
  const n = await hitVibes(page);
  await life(page, (h) => h.hapticHit(0));
  expect(await hitVibes(page), '다시 연결한 뒤 피격 진동').toBe(n + 1);
}

/** 마지막 입력 프레임의 이동 · 입력 방식 */
async function lastMove(page: Page): Promise<{ mx: number; my: number; mode: string } | null> {
  const e = (await inputLog(page)).at(-1);
  return e ? { mx: e.mx, my: e.my, mode: e.mode } : null;
}

// ───────────── 숨김 · 끊김 · 재연결 ─────────────

test('숨김 → 이 탭의 소켓만 끊김 → 다시 보임: 숨김에서 손가락을 모두 놓고, 숨긴 동안 재연결 0회, 보이면 3초 안에 같은 자리 · 스냅샷 재개, 다시 연결한 뒤 진동이 울린다', async ({
  browser,
}) => {
  test.setTimeout(150_000);
  const s = await soloMatch(browser, PHONE, 'runner', { relay: true, inits: [fakeVibrate] });
  const { page } = s;
  const relay = s.relay!;
  await freezeOthers(s);
  // 이동 스틱을 잡은 채 숨긴다 (손가락은 CDP로 계속 눌려 있다)
  const zone = centerOf(await waitForTouchTarget(page, 'move-zone'));
  const t = await MultiTouch.attach(page);
  await t.down(1, zone.x, zone.y);
  await t.move(1, zone.x + 50, zone.y - 10, { steps: 4, stepMs: 34 });
  await expect.poll(async () => Math.abs((await lastMove(page))?.mx ?? 0), POLL).toBeGreaterThan(0.5);
  // ① 소켓은 그대로 숨김 → 보임 (판 장면도 그대로): 숨김에서 터치 화면이 손가락을 모두 놓았다. 손가락 1을 누른 채로
  // 새 손가락 2가 이동 스틱을 잡는다 — 놓지 않았다면 남은 손가락 1 기록이 손가락 2를 거부한다(입력 0만 봐서는 못 잡는다)
  // (숨겨진 동안은 입력 프레임을 만들지 않는다 — 보인 뒤 첫 프레임부터 본다)
  await setVisible(page, false);
  await setVisible(page, true);
  await expect.poll(() => lastMove(page), POLL).toMatchObject({ mx: 0, my: 0 });
  await t.down(2, zone.x, zone.y);
  await t.move(2, zone.x, zone.y - 90, { steps: 6, stepMs: 20 });
  await expect
    .poll(async () => {
      const m = await lastMove(page);
      return m !== null && m.mode === 'touch' && m.my < -0.9 && Math.abs(m.mx) < 0.1;
    }, POLL)
    .toBe(true);
  await t.up(2);
  // ② 손가락 1은 누른 채 숨기고 이 탭의 소켓만 끊는다 (OS가 끊은 것처럼)
  const connects0 = await life(page, (h) => h.connects);
  await setVisible(page, false);
  await cutSocket(relay);
  await expect.poll(() => life(page, (h) => h.link), POLL).toBe('waiting');
  // 숨겨진 동안은 다시 연결하지 않는다 (1 → 2초 간격을 넘겨 기다려도)
  await page.waitForTimeout(3500);
  expect(await life(page, (h) => h.connects)).toBe(connects0);
  expect(relay.pairs).toHaveLength(1);
  const tick0 = await lastTick(page);
  const t0 = await page.evaluate(() => {
    (window as unknown as E2EWindow).__e2eSetVisible?.(true);
    return performance.now();
  });
  // 보이면 바로 연결 → 같은 자리 · 판 장면 다시 · 스냅샷 (재연결 + 스냅샷 3개 받는 시간만 잰다)
  await waitForResumed(page, tick0, s.id);
  const took = await page.evaluate((a) => performance.now() - a, t0);
  console.log(`[m12-lifecycle] 숨김 복귀 → 스냅샷 재개 ${Math.round(took)}ms`);
  expect(took).toBeLessThan(3000);
  expect(relay.pairs).toHaveLength(2);
  expect(await page.evaluate(() => window.__DECOY__?.role)).toBe('runner');
  // 서버의 같은 자리 (30초 유예 동안 자리를 지킨다 — 접속 중인지는 위의 스냅샷 재개 · you가 보장한다)
  const me = (await truth(page, s.code)).players.find((p) => p.id === s.id);
  expect(me?.role).toBe('runner');
  // 다시 만든 판 장면도 눌린 채 남은 손가락 1을 이동으로 보지 않는다
  await expect.poll(() => lastMove(page), POLL).toMatchObject({ mx: 0, my: 0 });
  // 진동: 숨김이 막은 진동이 새 소켓에서 시계를 맞춘 뒤 다시 울린다
  await expectHapticsBack(page);
  await t.detach();
  expect(s.problems).toEqual([]);
  await s.context.close();
});

test('반쯤 열린 소켓(숨김에서 돌아왔는데 서버 → 페이지 중계만 멈춤): 수신 감시가 4초 뒤 끊고 바로 다시 연결해 같은 자리로, 진동도 다시 울린다', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const s = await soloMatch(browser, PHONE, 'scout', { relay: true, inits: [fakeVibrate] });
  const { page } = s;
  const relay = s.relay!;
  await freezeOthers(s);
  const first = relay.pairs[0]!;
  // 숨긴 사이 소켓이 반쯤 열린 채가 된다 → 돌아오면 시계 다시 맞추기 ping에 답이 없다
  await setVisible(page, false);
  first.hold = true;
  const t0 = Date.now();
  await setVisible(page, true);
  await expect.poll(() => life(page, (h) => h.watchdogDrops), { ...POLL, timeout: 15_000 }).toBe(1);
  const tookDrop = Date.now() - t0;
  console.log(`[m12-lifecycle] 반쯤 열린 소켓 → 감시가 끊음 ${tookDrop}ms`);
  // 4초 무응답 + 확인 간격 0.5초 (테스트 쪽 왕복 여유)
  expect(tookDrop).toBeGreaterThanOrEqual(3500);
  expect(tookDrop).toBeLessThan(8000);
  // 끊긴 소켓으로는 더 오지 않는다: 이 틱 뒤의 스냅샷은 새 소켓으로 온 것이다
  await waitForResumed(page, await lastTick(page), s.id);
  expect(relay.pairs.length).toBe(2);
  await expectHapticsBack(page);
  expect(s.problems).toEqual([]);
  await s.context.close();
});

test('휴대폰: 다시 연결한 뒤 판 장면이 다시 생기기 전(세로로 든 동안)에 온 거점 메모는 가로로 돌려 새 장면이 생기면 다시 뜬다', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const s = await soloMatch(browser, PHONE, 'runner', { relay: true });
  const { page } = s;
  const relay = s.relay!;
  await freezeOthers(s);
  const banners = (): Promise<string[]> => page.evaluate(() => window.__DECOY__?.getBanners() ?? []);
  await expect.poll(async () => (await banners()).length, POLL).toBe(0);
  // 세로로 든다: 판 장면은 그대로 돌고(세로 안내), 다시 연결해 'match'가 와도 가로가 될 때까지 새 장면을 만들지 않는다
  const land = { width: 915, height: 412 };
  await page.setViewportSize({ width: land.height, height: land.width });
  const tick0 = await lastTick(page);
  await cutSocket(relay);
  await waitForResumed(page, tick0, s.id);
  expect(relay.pairs.length).toBe(2);
  // 새 장면이 생기기 전에 거점 A 해독: 메모는 'match' 뒤에 오고, 지금은 곧 멈출 옛 장면만 받는다
  await sendTest(page, { kind: 'setPoint', point: 'A', progress: 1 });
  await sendTest(page, { kind: 'teleport', target: s.id, x: 8, y: 16 });
  await expect.poll(async () => (await banners()).some((b) => b.includes('앞자리')), POLL).toBe(true);
  // 옛 장면의 터치 화면에 표시를 해 두고 가로로 돌린다 → 새 장면(표시 없는 터치 화면)이 생긴 뒤에도 메모가 보인다
  await page.evaluate(() => document.querySelector('.touch-layer')?.setAttribute('data-e2e-old', '1'));
  await page.setViewportSize(land);
  await page.waitForFunction(
    () => document.querySelector('.touch-layer:not([data-e2e-old])') !== null,
    null,
    {
      polling: 100,
      timeout: 20_000,
    },
  );
  expect(await page.evaluate(() => document.querySelectorAll('.touch-layer[data-e2e-old]').length)).toBe(0);
  await expect.poll(async () => (await banners()).some((b) => b.includes('앞자리')), POLL).toBe(true);
  expect(s.problems).toEqual([]);
  await s.context.close();
});

test('오프라인: 연결 시도 0회(시도하면 콘솔 에러), 온라인 이벤트 뒤 2초 안에 다시 연결', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const { context, page, problems } = await newPlayerPage(browser, PHONE);
  await context.addInitScript(baseInit);
  // 네트워크 수준에서 WebSocket을 만든 수 (앱 계수와 따로 센다)
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  let created = 0;
  cdp.on('Network.webSocketCreated', () => (created += 1));
  const code = await createRoom(page);
  const id = await myId(page);
  expect(created).toBe(1);
  await context.setOffline(true);
  expect(await page.evaluate(() => navigator.onLine)).toBe(false);
  // 열린 소켓은 조용해진다 → 수신 감시가 버린다 → 오프라인이라 다시 시도하지 않는다
  await expect.poll(() => life(page, (h) => h.watchdogDrops), { ...POLL, timeout: 15_000 }).toBe(1);
  const connects = await life(page, (h) => h.connects);
  await page.waitForTimeout(6000);
  expect(await life(page, (h) => h.connects)).toBe(connects);
  expect(await life(page, (h) => h.link)).toBe('waiting');
  expect(created).toBe(1);
  await context.setOffline(false);
  const t0 = Date.now();
  await expect.poll(() => life(page, (h) => h.link), { intervals: [50, 100], timeout: 10_000 }).toBe('open');
  await expect(page.getByTestId('room-code')).toHaveText(code);
  const took = Date.now() - t0;
  console.log(`[m12-lifecycle] 온라인 → 다시 연결 · 방 화면 ${took}ms`);
  expect(took).toBeLessThan(2000);
  expect(await myId(page)).toBe(id);
  expect(created).toBe(2);
  // 오프라인 동안 새 소켓을 만들었다면 ERR_INTERNET_DISCONNECTED 콘솔 에러가 남는다
  expect(problems).toEqual([]);
  await context.close();
});

// ───────────── 마지막 방 복귀 ─────────────

test('휴대폰: ?room= 없이 다시 열어도 30초 안이면 같은 자리 (판 중), PC는 자동 복귀 없음', async ({
  browser,
}) => {
  test.setTimeout(150_000);
  const s = await soloMatch(browser, PHONE, 'guard');
  expect(await life(s.page, (h) => h.lifeApp)).toBe(true);
  await s.page.close();
  const page = await s.context.newPage();
  const problems: string[] = [];
  watchConsole(page, problems);
  await page.goto(`/?${BASE_QUERY.slice(1)}`);
  await waitForSnapshots(page, 3);
  expect(await myId(page)).toBe(s.id);
  expect(await page.evaluate(() => window.__DECOY__?.role)).toBe('guard');
  expect(page.url()).toContain(`room=${s.code}`);
  expect([...s.problems, ...problems]).toEqual([]);
  await s.context.close();

  // PC: 같은 일을 해도 첫 화면 (지금 동작 그대로 — 마지막 방을 적지도 않는다)
  const pc = await newPlayerPage(browser);
  const code = await createRoom(pc.page);
  expect(code).toMatch(/^[A-Z]{4}$/);
  expect(await pc.page.evaluate(() => localStorage.getItem('decoy:lastRoom'))).toBeNull();
  await pc.page.close();
  const pc2 = await pc.context.newPage();
  await pc2.goto(`/?${BASE_QUERY.slice(1)}`);
  await expect(pc2.getByTestId('create-room')).toBeVisible();
  expect(await pc2.evaluate(() => window.__DECOY__?.room ?? null)).toBeNull();
  expect(pc.problems).toEqual([]);
  await pc.context.close();
});

test('휴대폰: 옛 소켓이 반쯤 열린 채 남아도(in-progress) 2초마다 다시 시도해 같은 자리로 — ?room= 없이 다시 열어도, 같은 방 주소(초대 링크 · 기록)로 다시 열어도', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const s = await soloMatch(browser, PHONE, 'runner', { relay: true });
  let old = { page: s.page, relay: s.relay! };
  const problems: string[] = [];
  // welcome마다 주소에 ?room=이 붙으므로 기록 · 같은 방 링크로 다시 열면 주소에 방 코드가 있다
  for (const url of [`/?${BASE_QUERY.slice(1)}`, `/?room=${s.code}${BASE_QUERY}`]) {
    // 옛 앱: 숨겨진 뒤 멈췄다(프로세스가 죽은 것처럼). 서버는 그 소켓이 아직 살아 있다고 본다(하트비트로 잡히기 전)
    await setVisible(old.page, false);
    const cdp = await s.context.newCDPSession(old.page);
    await cdp.send('Page.setWebLifecycleState', { state: 'frozen' });
    // 앱을 다시 연다 (새 탭: 이 탭의 자리 토큰이 없다)
    const page = await s.context.newPage();
    watchConsole(page, problems);
    const relay = await relayWs(page);
    await page.goto(url);
    // 거절(in-progress) → 2초마다 다시 (그동안 '다시 연결하는 중' 안내, 첫 화면으로 가지 않는다)
    await expect.poll(() => relay.joins, POLL).toBeGreaterThanOrEqual(3);
    await expect(page.getByTestId('server-waking')).toContainText('다시 연결하는 중');
    await expect(page.getByTestId('create-room')).toHaveCount(0);
    // 서버가 옛 소켓을 끊었다 (하트비트) → 다음 시도에서 같은 자리
    await old.relay.pairs.at(-1)!.server.close();
    await waitForSnapshots(page, 3);
    expect(await myId(page), url).toBe(s.id);
    await expect(page.getByTestId('server-waking')).toBeHidden();
    console.log(`[m12-lifecycle] 옛 소켓이 남은 동안 입장 시도 ${relay.joins}번 (${url.split('&')[0]})`);
    old = { page, relay };
  }
  expect([...s.problems, ...problems]).toEqual([]);
  await s.context.close();
});

// ───────────── 뒤로 가기 · 화면 꺼짐 방지 ─────────────

test('휴대폰 판 중 뒤로 가기 → 확인 창: "계속"이면 판 유지, "나가기"면 첫 화면. 항목은 사용자 활성화 안에서 넣는다 (실제 Wake Lock은 헤드리스에서 거부돼도 콘솔 0)', async ({
  browser,
}) => {
  test.setTimeout(150_000);
  const s = await soloMatch(browser, PHONE, 'runner');
  const { page } = s;
  const pushes = (): Promise<{ active: boolean; ev: string | null }[]> =>
    page.evaluate(() => (window as unknown as E2EWindow).__e2ePush?.slice() ?? []);
  // 서버 match로는 넣지 않는다 (사용자 활성화가 없다)
  expect(await pushes()).toEqual([]);
  const zone = centerOf(await waitForTouchTarget(page, 'move-zone'));
  const t = await MultiTouch.attach(page);
  await t.tap(1, zone.x, zone.y);
  await expect.poll(async () => (await pushes()).length, POLL).toBe(1);
  expect((await pushes())[0]).toEqual({ active: true, ev: 'pointerup' });
  await expect.poll(() => life(page, (h) => h.guarding), POLL).toBe(true);
  // 두 번째 탭은 넣지 않는다
  await t.tap(2, zone.x, zone.y);
  await page.waitForTimeout(300);
  expect(await pushes()).toHaveLength(1);

  // 뒤로 가기 → 확인 창, 판은 계속 흐른다
  await page.goBack({ waitUntil: 'commit' });
  const dialog = page.getByTestId('leave-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('판에서 나가시겠어요?');
  const n = await snapCount(page);
  await expect.poll(() => snapCount(page), POLL).toBeGreaterThan(n + 5);
  await press(page.getByTestId('leave-stay'));
  await expect(dialog).toBeHidden();
  expect(await pushes()).toHaveLength(2);
  expect((await pushes())[1]).toMatchObject({ active: true });
  expect(['click', 'pointerup']).toContain((await pushes())[1]!.ev);
  expect(await page.evaluate(() => window.__DECOY__?.phase)).toBe('playing');

  // 다시 뒤로 가기 → 나가기 → 첫 화면 (방 코드 칸에 방금 방, 판 장면 끝)
  await page.goBack({ waitUntil: 'commit' });
  await expect(dialog).toBeVisible();
  await press(page.getByTestId('leave-go'));
  await expect(page.getByTestId('create-room')).toBeVisible();
  await expect(page.getByTestId('room-code-input')).toHaveValue(s.code);
  expect(page.url()).not.toContain('room=');
  await expect.poll(() => page.evaluate(() => window.__DECOY__?.getHudLayout() ?? null), POLL).toBeNull();
  // 서버는 끊긴 자리로 본다 (30초 유예)
  await expect
    .poll(async () => (await truth(page, s.code)).players.some((p) => p.id === s.id), POLL)
    .toBe(true);
  await expect.poll(() => life(page, (h) => h.link), POLL).toBe('open');
  expect(await page.evaluate(() => localStorage.getItem('decoy:lastRoom'))).toBeNull();
  await t.detach();
  expect(s.problems).toEqual([]);
  await s.context.close();
});

test('휴대폰 판 중 새로고침(탭 폐기 뒤 복원과 같다): 남은 뒤로 가기 항목을 그대로 써 하나 더 넣지 않고, 결과에서 걷어 낸다', async ({
  browser,
}) => {
  test.setTimeout(150_000);
  const s = await soloMatch(browser, PHONE, 'runner');
  const { page } = s;
  const pushes = (): Promise<number> =>
    page.evaluate(() => (window as unknown as E2EWindow).__e2ePush?.length ?? 0);
  const state = (): Promise<string> => page.evaluate(() => JSON.stringify(history.state));
  let t = await MultiTouch.attach(page);
  const zone = centerOf(await waitForTouchTarget(page, 'move-zone'));
  await t.tap(1, zone.x, zone.y);
  await expect.poll(() => life(page, (h) => h.guarding), POLL).toBe(true);
  expect(await state()).toBe('{"decoyGuard":1}');
  const entries = await page.evaluate(() => history.length);
  await t.detach();
  // 판 중 다시 읽힌다 (이 탭의 자리 토큰으로 같은 자리) — 지금 기록 항목이 이미 내 항목이다
  await page.reload();
  await waitForSnapshots(page, 3);
  expect(await myId(page)).toBe(s.id);
  expect(await life(page, (h) => h.guarding)).toBe(true);
  t = await MultiTouch.attach(page);
  const zone2 = centerOf(await waitForTouchTarget(page, 'move-zone'));
  await t.tap(1, zone2.x, zone2.y);
  await page.waitForTimeout(300);
  expect(await pushes()).toBe(0);
  expect(await page.evaluate(() => history.length)).toBe(entries);
  // 뒤로 가기 → 확인 창 (새로고침 뒤에도 그 아래 항목과 같은 문서다), "계속"이면 다시 넣는다
  await page.goBack({ waitUntil: 'commit' });
  const dialog = page.getByTestId('leave-dialog');
  await expect(dialog).toBeVisible();
  await press(page.getByTestId('leave-stay'));
  await expect(dialog).toBeHidden();
  expect(await pushes()).toBe(1);
  expect(await page.evaluate(() => window.__DECOY__?.phase)).toBe('playing');
  // 판을 끝낸다 (시간 초과) → 결과: 넣어 둔 항목을 걷어 내 판 전 항목으로 돌아온다
  await sendTest(page, { kind: 'setTime', timeLeft: 0.5 });
  await expect(page.getByTestId('result')).toBeVisible();
  await expect.poll(() => life(page, (h) => h.guarding), POLL).toBe(false);
  await expect.poll(state, POLL).toBe('null');
  await t.detach();
  expect(s.problems).toEqual([]);
  await s.context.close();
});

test('휴대폰: 끊겨 다시 연결을 기다리는 중에 "나가기" → 첫 화면, 다시 연결한 뒤 진짜 끊김에는 알림이 뜬다', async ({
  browser,
}) => {
  test.setTimeout(150_000);
  const s = await soloMatch(browser, PHONE, 'runner', { relay: true });
  const { page, context } = s;
  const relay = s.relay!;
  const zone = centerOf(await waitForTouchTarget(page, 'move-zone'));
  const t = await MultiTouch.attach(page);
  await t.tap(1, zone.x, zone.y);
  await expect.poll(() => life(page, (h) => h.guarding), POLL).toBe(true);
  const toast = page.locator('.toast', { hasText: '연결이 끊겼습니다' });
  // 망이 끊겼다: 오프라인이라 다시 시도하지 않고 기다린다 (끊김 알림은 이때 한 번)
  await context.setOffline(true);
  await cutSocket(relay);
  await expect(toast).toBeVisible();
  await expect.poll(() => life(page, (h) => h.link), POLL).toBe('waiting');
  // 이 알림이 사라진 뒤에 본다 (마지막 단언이 이 알림으로 맞지 않게)
  await expect(toast).toHaveCount(0);
  // 기다리는 중에 뒤로 가기 → 나가기: 버릴 소켓이 없어 닫힘 이벤트가 나지 않는다
  await page.goBack({ waitUntil: 'commit' });
  await expect(page.getByTestId('leave-dialog')).toBeVisible();
  await press(page.getByTestId('leave-go'));
  await expect(page.getByTestId('create-room')).toBeVisible();
  expect(await life(page, (h) => h.link)).toBe('waiting');
  await context.setOffline(false);
  await expect.poll(() => life(page, (h) => h.link), POLL).toBe('open');
  expect(relay.pairs).toHaveLength(2);
  // 첫 화면에서 쓰던 연결이 진짜로 끊긴다 → 알림
  await cutSocket(relay);
  await expect(toast).toBeVisible();
  await t.detach();
  expect(s.problems).toEqual([]);
  await context.close();
});

test('휴대폰 판 중 다시 연결했는데 자리가 없다(in-progress): 첫 화면 · 화면 꺼짐 방지 해제 · 뒤로 가기 항목 걷음 · 판 장면 멈춤', async ({
  browser,
}) => {
  test.setTimeout(150_000);
  const s = await soloMatch(browser, PHONE, 'runner', { relay: true, inits: [fakeWakeLock] });
  const { page } = s;
  const wakeLog = (): Promise<{ op: string; id: number; vis: string }[]> =>
    page.evaluate(() => (window as unknown as E2EWindow).__e2eWake?.slice() ?? []);
  await expect.poll(wakeLog, POLL).toEqual([{ op: 'request', id: 1, vis: 'visible' }]);
  const zone = centerOf(await waitForTouchTarget(page, 'move-zone'));
  const t = await MultiTouch.attach(page);
  await t.tap(1, zone.x, zone.y);
  await expect.poll(() => life(page, (h) => h.guarding), POLL).toBe(true);
  // 이 기기의 자리 토큰을 잃었다(저장소가 지워짐): 다시 연결하면 진행 중인 방에 들어갈 자리가 없다.
  // 서버가 잠들었다 깨거나 다시 시작해 방이 사라진 경우(room-not-found)도 같은 길로 첫 화면에 간다
  await page.evaluate((c) => {
    sessionStorage.removeItem(`decoy:seat:${c}`);
    localStorage.removeItem('decoy:seats');
  }, s.code);
  // 끊기 전에는 판 장면이 있다 (아래 '판 장면 멈춤' 단언이 그냥 통과하지 않게)
  expect(await page.evaluate(() => window.__DECOY__?.getHudLayout() ?? null)).not.toBeNull();
  await cutSocket(s.relay!);
  await expect(page.getByTestId('create-room')).toBeVisible();
  await expect(page.getByTestId('lobby-error')).toContainText('이미 진행 중인 방입니다');
  await expect.poll(() => life(page, (h) => h.guarding), POLL).toBe(false);
  await expect.poll(() => page.evaluate(() => JSON.stringify(history.state)), POLL).toBe('null');
  await expect.poll(wakeLog, POLL).toEqual([
    { op: 'request', id: 1, vis: 'visible' },
    { op: 'release', id: 1, vis: 'visible' },
  ]);
  await expect.poll(() => page.evaluate(() => window.__DECOY__?.getHudLayout() ?? null), POLL).toBeNull();
  // 다시 보여도 화면 꺼짐 방지를 다시 요청하지 않는다
  await setVisible(page, false);
  await setVisible(page, true);
  await page.waitForTimeout(300);
  expect((await wakeLog()).filter((e) => e.op === 'request')).toHaveLength(1);
  await t.detach();
  expect(s.problems).toEqual([]);
  await s.context.close();
});

test('PC 뒤로 가기는 지금 동작 그대로 (기록 항목을 넣지 않고 확인 창도 없다)', async ({ browser }) => {
  test.setTimeout(120_000);
  const s = await soloMatch(browser, undefined, 'monster');
  const { page } = s;
  const box = await page.locator('#game-root canvas').boundingBox();
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.keyboard.press('KeyW');
  expect(await life(page, (h) => h.lifeApp)).toBe(false);
  expect(await page.evaluate(() => (window as unknown as E2EWindow).__e2ePush?.length)).toBe(0);
  expect(s.problems).toEqual([]);
  await page.goBack();
  expect(page.url()).toBe('about:blank');
  await s.context.close();
});

/** 시작 스크립트: matchMedia('(display-mode: <mode>)')가 맞다고 답한다 (PC 브라우저 F11 · 키오스크 = fullscreen, 설치한 PWA = standalone) */
function fakeDisplayMode(mode: string): void {
  const real = window.matchMedia.bind(window);
  window.matchMedia = (q: string): MediaQueryList =>
    q === `(display-mode: ${mode})`
      ? ({
          matches: true,
          media: q,
          onchange: null,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
          addListener: () => undefined,
          removeListener: () => undefined,
          dispatchEvent: () => false,
        } as MediaQueryList)
      : real(q);
}

test('PC 브라우저 전체 화면(F11 · 키오스크 = display-mode fullscreen)은 설치 앱이 아니다: 마지막 방 · 뒤로 가기 확인 없음. 설치한 PWA(standalone)는 설치 앱', async ({
  browser,
}) => {
  test.setTimeout(90_000);
  for (const [mode, installed] of [
    ['fullscreen', false],
    ['standalone', true],
  ] as const) {
    const pc = await newPlayerPage(browser);
    await pc.context.addInitScript(fakeDisplayMode, mode);
    const code = await createRoom(pc.page);
    expect(await pc.page.evaluate((m) => matchMedia(`(display-mode: ${m})`).matches, mode)).toBe(true);
    expect(await life(pc.page, (h) => h.lifeApp), mode).toBe(installed);
    const last = await pc.page.evaluate(() => localStorage.getItem('decoy:lastRoom'));
    expect(last === null ? null : (JSON.parse(last) as { room: string }).room, mode).toBe(
      installed ? code : null,
    );
    expect(pc.problems).toEqual([]);
    await pc.context.close();
  }
});

test('Wake Lock: 판 시작 때 요청 · 숨겨져 풀린 뒤 다시 보이면 재요청 · 결과에서 해제 (로비에서는 요청 없음)', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const { context, page, problems } = await newPlayerPage(browser, PHONE);
  await context.addInitScript(baseInit);
  await context.addInitScript(fakeWakeLock);
  const wakeLog = (): Promise<{ op: string; id: number; vis: string }[]> =>
    page.evaluate(() => (window as unknown as E2EWindow).__e2eWake?.slice() ?? []);
  const code = await createRoom(page, '&bots=1');
  await pickRoleAndReady(page, 'runner');
  expect(await wakeLog()).toEqual([]);
  await press(page.getByTestId('start-button'));
  await waitForSnapshots(page, 3);
  await expect.poll(wakeLog, POLL).toEqual([{ op: 'request', id: 1, vis: 'visible' }]);
  await setVisible(page, false);
  await expect.poll(wakeLog, POLL).toHaveLength(2);
  expect((await wakeLog())[1]).toMatchObject({ op: 'auto-release', id: 1 });
  await setVisible(page, true);
  await expect.poll(wakeLog, POLL).toHaveLength(3);
  expect((await wakeLog())[2]).toEqual({ op: 'request', id: 2, vis: 'visible' });
  // 판을 끝낸다 (시간 초과) → 결과 화면 → 해제
  await sendTest(page, { kind: 'setTime', timeLeft: 0.5 });
  await expect(page.getByTestId('result')).toBeVisible();
  await expect.poll(wakeLog, POLL).toHaveLength(4);
  expect((await wakeLog())[3]).toMatchObject({ op: 'release', id: 2 });
  // 결과 화면에서 숨겼다 돌아와도 다시 요청하지 않는다
  await setVisible(page, false);
  await setVisible(page, true);
  await page.waitForTimeout(300);
  expect((await wakeLog()).filter((e) => e.op === 'request')).toHaveLength(2);
  expect(code).toMatch(/^[A-Z]{4}$/);
  expect(problems).toEqual([]);
  await context.close();
});

// ───────────── 진동 ─────────────

test('진동: 활성화 전 0번, 피격 1번 · 오래된 피격 0번, 발각 전환 1번(이어지는 동안 0번), 설정 끄기 0번, 숨김에서 돌아와 시계를 맞추기 전 0번', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const { context, page, problems } = await newPlayerPage(browser, PHONE);
  await context.addInitScript(baseInit);
  await context.addInitScript(fakeVibrate);
  await page.goto(`/?${BASE_QUERY.slice(1)}`);
  // 문서가 준비될 때(사용자 활성화 전) 부른 피격: 부르지 않았다
  const early = await page.evaluate(() => (window as unknown as E2EWindow).__e2eEarlyVib);
  expect(early).toEqual({ calls: 0, active: false });
  await press(page.getByTestId('name-input'));
  const vib = (): Promise<{ pattern: number[]; active: boolean }[]> =>
    page.evaluate(() => (window as unknown as E2EWindow).__e2eVib?.slice() ?? []);
  await expect.poll(() => life(page, (h) => h.clockFresh), POLL).toBe(true);
  await life(page, (h) => h.hapticHit(0));
  await life(page, (h) => h.hapticHit(2500));
  expect(await vib()).toEqual([{ pattern: [70], active: true }]);
  await life(page, (h) => {
    h.hapticSpotted(false, 0);
    h.hapticSpotted(true, 0);
    h.hapticSpotted(true, 0);
    h.hapticSpotted(true, 0);
  });
  expect((await vib()).map((v) => v.pattern)).toEqual([[70], [35, 80, 35]]);
  // 설정에서 끄기 → 0번, 다시 켜기 → 울림
  await press(page.getByTestId('settings-button'));
  await press(page.getByTestId('haptics-off'));
  await expect(page.getByTestId('haptics-off')).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => localStorage.getItem('decoy:haptics'))).toBe('0');
  await life(page, (h) => h.hapticHit(0));
  expect(await vib()).toHaveLength(2);
  await press(page.getByTestId('haptics-on'));
  await life(page, (h) => h.hapticHit(0));
  expect(await vib()).toHaveLength(3);
  // 숨겨진 동안 · 돌아온 직후(시계를 다시 맞추기 전, 같은 작업 안에서) 0번, 다시 맞춘 뒤에는 울림
  await setVisible(page, false);
  await life(page, (h) => h.hapticHit(0));
  const fresh = await page.evaluate(() => {
    const w = window as unknown as E2EWindow;
    w.__e2eSetVisible?.(true);
    w.__DECOY_LIFE__?.hapticHit(100);
    return w.__DECOY_LIFE__?.clockFresh;
  });
  expect(fresh).toBe(false);
  expect(await vib()).toHaveLength(3);
  await expect.poll(() => life(page, (h) => h.clockFresh), POLL).toBe(true);
  await life(page, (h) => h.hapticHit(0));
  expect(await vib()).toHaveLength(4);
  expect((await vib()).every((v) => v.active)).toBe(true);
  expect(problems).toEqual([]);
  await context.close();
});

test('진동 (판 이벤트): 내 피격 1번 · 발각 전환 1번, 멈췄다 돌아온 뒤 지난 일 0번', async ({ browser }) => {
  test.setTimeout(180_000);
  const mon = await newPlayerPage(browser);
  const code = await createRoom(mon.page, '&bots=1');
  const phone = await newPlayerPage(browser, PHONE);
  await phone.context.addInitScript(baseInit);
  await phone.context.addInitScript(fakeVibrate);
  await phone.page.goto(`/?room=${code}${BASE_QUERY}`);
  await expect(phone.page.getByTestId('room-code')).toHaveText(code);
  await pickRoleAndReady(mon.page, 'monster');
  await pickRoleAndReady(phone.page, 'runner');
  await press(mon.page.getByTestId('start-button'));
  await waitForSnapshots(mon.page, 3);
  await waitForSnapshots(phone.page, 3);
  const monId = await myId(mon.page);
  const runId = await myId(phone.page);
  const tr = await truth(mon.page, code);
  for (const p of tr.players)
    if (p.id !== monId && p.id !== runId)
      await sendTest(mon.page, { kind: 'freeze', target: p.id, frozen: true });
  const vib = (): Promise<number[][]> =>
    phone.page.evaluate(() => (window as unknown as E2EWindow).__e2eVib?.map((v) => v.pattern) ?? []);
  const hitCount = async (): Promise<number> => (await vib()).filter((p) => p.length === 1).length;
  const spotCount = async (): Promise<number> => (await vib()).filter((p) => p.length === 3).length;
  /** 괴물 바로 앞에 러너를 두고 좌클릭 공격 */
  const strike = async (): Promise<void> => {
    await sendTest(mon.page, { kind: 'teleport', target: runId, x: 31, y: 21 });
    await sendTest(mon.page, { kind: 'teleport', target: monId, x: 30, y: 21, face: 0 });
    await mon.page.waitForTimeout(400);
    const c = await mon.page.evaluate(() => window.__DECOY__?.tileToClient(33, 21) ?? null);
    await mon.page.mouse.move(c!.x, c!.y);
    await mon.page.waitForTimeout(200);
    await mon.page.mouse.down({ button: 'left' });
    await mon.page.mouse.up({ button: 'left' });
  };
  await strike();
  await phone.page.waitForFunction(() => window.__DECOY__?.getLastSnapshot()?.you.surv?.hp === 1, null, {
    polling: 100,
    timeout: 20_000,
  });
  await phone.page.waitForTimeout(500);
  const hits1 = await hitCount();
  const spots1 = await spotCount();
  console.log(`[m12-lifecycle] 판 이벤트 진동: 피격 ${hits1} · 발각 ${spots1}`);
  expect(hits1).toBe(1);
  expect(spots1).toBe(1);
  // 멈췄다 돌아온다: 숨김 + 페이지 정지 동안 두 번째 피격(수감) → 돌아오면 밀린 스냅샷의 지난 일
  const cdp = await phone.context.newCDPSession(phone.page);
  await setVisible(phone.page, false);
  await cdp.send('Page.setWebLifecycleState', { state: 'frozen' });
  await mon.page.waitForTimeout(1800);
  await strike();
  await expect
    .poll(async () => (await truth(mon.page, code)).players.find((p) => p.id === runId)?.status, POLL)
    .toBe('imprisoned');
  await mon.page.waitForTimeout(2500);
  await cdp.send('Page.setWebLifecycleState', { state: 'active' });
  await setVisible(phone.page, true);
  await phone.page.waitForFunction(
    () => window.__DECOY__?.getLastSnapshot()?.you.surv?.status === 'imprisoned',
    null,
    { polling: 100, timeout: 20_000 },
  );
  await phone.page.waitForTimeout(800);
  expect(await hitCount()).toBe(hits1);
  expect([...mon.problems, ...phone.problems]).toEqual([]);
  await mon.context.close();
  await phone.context.close();
});

// ───────────── 판 직전 터치 안내 · 설정 · 다른 탭 ─────────────

test('판 직전 터치 안내: 새 휴대폰에서 준비 뒤 카드, 닫으면 다시 안 뜸, 다시 보기 뒤 다시 뜸, 떠 있는 채 판이 시작하면 본 것, 그 판 처음 10초 위치 표시는 입력을 막지 않고 사라짐. 능력 줄은 키캡 없이. PC는 그대로', async ({
  browser,
}) => {
  test.setTimeout(150_000);
  const { context, page, problems } = await newPlayerPage(browser, PHONE);
  await context.addInitScript(baseInit);
  await createRoom(page, '&bots=1');
  // 역할 카드 능력 줄: 터치는 키캡 없이 이름만
  await expect(page.getByTestId('role-monster').locator('.role-ability')).toContainText('공격');
  expect(await page.locator('.role-card .keycap').count()).toBe(0);
  const card = page.getByTestId('touch-tutorial');
  await press(page.getByTestId('role-scout'));
  await expect(page.getByTestId('role-scout')).toHaveClass(/mine/);
  await expect(card).toHaveCount(0);
  await press(page.getByTestId('ready-button'));
  await expect(card).toBeVisible();
  await expect(card).toContainText('터치 조작');
  await expect(card.locator('li')).toHaveCount(3);
  await expect(card).toContainText('오른쪽 아래 능력 버튼');
  // 시작 · 준비 버튼을 가리지 않는다 (탭이 그 버튼에 닿는다)
  for (const id of ['start-button', 'ready-button', 'settings-button']) {
    const b = (await page.getByTestId(id).boundingBox())!;
    const hit = await page.evaluate(
      ([x, y]) => document.elementFromPoint(x!, y!)?.closest('[data-testid]')?.getAttribute('data-testid'),
      [b.x + b.width / 2, b.y + b.height / 2],
    );
    expect(hit, id).toBe(id);
  }
  await press(page.getByTestId('touch-tutorial-ok'));
  await expect(card).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('decoy:touchTutorial'))).toBe('1');
  // 다시 열어도(새로고침) 준비 뒤 안 뜬다
  await page.reload();
  await expect(page.getByTestId('room-code')).toBeVisible();
  await press(page.getByTestId('ready-button'));
  await expect(page.getByTestId('ready-button')).toHaveText('준비 취소');
  await page.waitForTimeout(300);
  await expect(card).toHaveCount(0);
  // 설정 → 다시 보기: 준비한 채면 바로 다시 뜬다
  await press(page.getByTestId('settings-button'));
  await press(page.getByTestId('tutorial-replay'));
  await expect(page.getByTestId('settings-panel')).toContainText('다음 판 전에 다시 보여 드려요');
  // 설정 판이 열린 동안은 숨어 있다가(겹치지 않게) 닫으면 보인다
  await expect(card).toBeHidden();
  await press(page.getByTestId('settings-button'));
  await expect(page.getByTestId('settings-panel')).toBeHidden();
  await expect(card).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('decoy:touchTutorial'))).toBeNull();
  // 떠 있는 채 판이 시작하면 본 것으로 친다
  await press(page.getByTestId('start-button'));
  await waitForSnapshots(page, 3);
  expect(await page.evaluate(() => localStorage.getItem('decoy:touchTutorial'))).toBe('1');
  await expect(card).toBeHidden();
  // 판 중 처음 10초 위치 표시: 떠 있는 동안 입력을 막지 않는다 (덮개 아래 대상이 실제 히트 테스트에 잡히고, 이동 스틱이 입력을 만든다)
  const hints = page.locator('.tc-hints');
  await expect(hints).toBeVisible();
  await expect(hints.locator('.tc-hint-zone')).toContainText('여기를 누르고 끌어 이동');
  for (const id of ['move-zone', 'ability', 'rescue']) {
    const c = centerOf(await waitForTouchTarget(page, id));
    const hit = await page.evaluate(
      ([x, y]) =>
        document
          .elementFromPoint(x!, y!)
          ?.closest('[data-touch-target]')
          ?.getAttribute('data-touch-target') ?? null,
      [c.x, c.y],
    );
    expect(hit, id).toBe(id);
  }
  const zone = centerOf(await waitForTouchTarget(page, 'move-zone'));
  const t = await MultiTouch.attach(page);
  await t.down(1, zone.x, zone.y);
  await t.move(1, zone.x + 90, zone.y, { steps: 6, stepMs: 20 });
  await expect
    .poll(async () => {
      const m = await lastMove(page);
      return m !== null && m.mode === 'touch' && m.mx > 0.9 && Math.abs(m.my) < 0.1;
    }, POLL)
    .toBe(true);
  // 그 입력은 위치 표시가 떠 있는 동안 만든 것이다
  expect(await hints.evaluate((el) => el.classList.contains('gone'))).toBe(false);
  await t.up(1);
  await t.detach();
  // 10초 뒤 사라진다
  await expect(hints).toBeHidden({ timeout: 20_000 });
  expect(problems).toEqual([]);
  await context.close();

  // PC: 카드 · 설정 단추 없음, 능력 줄 키캡, 첫 판 조작 안내 그대로
  const pc = await newPlayerPage(browser);
  await createRoom(pc.page, '&bots=1');
  expect(await pc.page.locator('.role-card .keycap').count()).toBeGreaterThan(0);
  await pickRoleAndReady(pc.page, 'runner');
  await pc.page.waitForTimeout(300);
  await expect(pc.page.getByTestId('touch-tutorial')).toHaveCount(0);
  await expect(pc.page.getByTestId('settings-button')).toHaveCount(0);
  await press(pc.page.getByTestId('start-button'));
  await waitForSnapshots(pc.page, 3);
  await expect.poll(() => pc.page.evaluate(() => window.__DECOY__?.getHud().help), POLL).toBe(true);
  await expect(pc.page.locator('.tc-hints')).toHaveCount(0);
  expect(pc.problems).toEqual([]);
  await pc.context.close();
});

test('다른 탭에서 접속: 안내 + "여기서 계속하기" → 이 기기로 다시 들어오고 저쪽이 안내를 받는다', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const { context, page, problems } = await newPlayerPage(browser, PHONE);
  await context.addInitScript(baseInit);
  const code = await createRoom(page);
  const id = await myId(page);
  // 같은 기기의 다른 탭(같은 자리 토큰을 sessionStorage에 복사)이 이 자리로 들어온다
  const token = await page.evaluate((c) => sessionStorage.getItem(`decoy:seat:${c}`), code);
  const other = await context.newPage();
  await other.addInitScript(
    ([c, t]) => {
      if (!sessionStorage.getItem(`decoy:seat:${c}`)) sessionStorage.setItem(`decoy:seat:${c}`, t!);
    },
    [code, token] as const,
  );
  await other.goto(`/?room=${code}${BASE_QUERY}`);
  await expect(other.getByTestId('room-code')).toHaveText(code);
  expect(await myId(other)).toBe(id);
  const notice = page.getByTestId('replaced-notice');
  await expect(notice).toBeVisible();
  await expect(notice).toContainText('다른 탭에서 이 자리로 접속했습니다');
  // 다시 연결하지 않는다
  const connects = await life(page, (h) => h.connects);
  await page.waitForTimeout(2500);
  expect(await life(page, (h) => h.connects)).toBe(connects);
  await press(page.getByTestId('continue-here'));
  await expect(notice).toBeHidden();
  await expect.poll(() => life(page, (h) => h.link), POLL).toBe('open');
  await expect(page.getByTestId('room-code')).toHaveText(code);
  await expect(other.getByTestId('replaced-notice')).toBeVisible();
  expect(await myId(page)).toBe(id);
  expect(problems).toEqual([]);
  await context.close();
});

// 선택형 구글 로그인 · 계정 저장 E2E (docs/ACCOUNT_PLAN.md 6 · 7 · 8 · 9절): 실제 서버(로그인 켬 · 메모리 저장소 · 가짜 구글)를
// 시험마다 빈 포트로 따로 띄워 브라우저로 로그인 흐름 전체를 시험한다. 기본 E2E 서버(playwright.config webServer)는 로그인 꺼짐 그대로
//  1. 로그인 · 첫 로그인 올리기 · 서버 적립(credit을 붙잡아 '저장하는 중' → 놓으면 '저장했어요', 판 중 설정에는 계정 탭 없음) ·
//     다른 기기(새 컨텍스트)에서 같은 기록
//  2. 계정 · 이 기기 둘 다 기록이 있으면 고르기 창 (이 기기 기록 → 계정이 바뀜, 계정 기록 → 그대로), 새로고침하면 다시 묻지 않음
//  3. 로그인한 채 봇과 연습: 계정에 적립하지 않고 기기 기록도 그대로
//  4. 로그아웃(첫 화면 소켓을 새로 열어 다음 온라인 판은 계정에 적립하지 않음) · 설정에서 계정 삭제(두 번 확인) · 웹 삭제
//     페이지(로그인해 삭제 — 리퍼러 정책 때문에 Origin: null로 거절되던 것을 고쳤다) · 로그인 꺼진 서버의 삭제 페이지
//  5. 로그인 꺼짐(기본 서버): 첫 화면 · 연습 판에 계정 요청 · 계정 조각 없음, 설정을 열면 상태 요청 한 번 뒤 계정 탭 없음
//  6. DB 장애: 새로고침하면 게스트 안내 · 기기 기록으로 연습 · 온라인 판 끝까지, 되돌리면 계정, 로그인 중 장애는 ?login=db
//  7. 나쁜 토큰(만료 · 가짜 서명 · 다른 aud · nonce) · 취소: 안내만, 쿠키 · 계정 없음
//  8. 정보 숨김: 로그인한 생존자 셋 + 로그인 안 한 괴물의 친구 방 — 괴물이 받은 원문에 계정 단서 없음, credit은 그 생존자 연결에만
//  9. 서비스 워커: 계정 · 로그인 요청은 워커 캐시를 거치지 않고, 서버를 끄고 오프라인으로 다시 열어도 첫 화면 · 봇과 연습(게스트 안내)
// 콘솔 오류 · 경고는 0이다. 브라우저가 스스로 찍는 것만 허용한다: 서버를 끈 시험(9)의 연결 실패(m13-offline과 같은 기준),
// DB 장애 시험(6)의 503 응답 실패 로그, 크롬의 글꼴 미리 받기 경고(issues)
import { readFileSync } from 'node:fs';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import type { ServerMessage } from '@decoy/shared';
// @decoy/shared/meta 묶음은 progression.json을 import로 가져와 Playwright(Node ESM)에서 못 읽는다 (meta.spec과 같이 파일로 읽는다)
import { levelOf } from '../../shared/src/meta/rating';
import { validateProgression } from '../../shared/src/meta/progressionCheck';
import { ACCOUNT_TEXT } from '../../client/src/data/storyText';
import { freePort, startServer, type RunningServer } from '../helpers/serverProcess';
import { collectFrames, type CollectedFrames } from './frames';
import { myId, newPlayerPage, pickRoleAndReady, press, sendTest, waitForSnapshots } from './helpers';

const PROGRESSION = validateProgression(JSON.parse(readFileSync('config/progression.json', 'utf8')));
const T = ACCOUNT_TEXT;
const Q = 'debug=hook&renderer=canvas';
const PROGRESS_KEY = 'decoy:progress';
const MARK_KEY = 'decoy:account';

/** 로그인 켬 + 메모리 저장소 (시험 훅 모드 기본값은 가짜 구글) */
const LOGIN_ENV: Record<string, string> = {
  DECOY_LOGIN: '1',
  GOOGLE_CLIENT_ID: 'e2e-client',
  DECOY_SESSION_SECRET: 'e2e-account-session-secret-0123456789-abcdef',
  DECOY_ACCOUNT_STORE: 'memory',
};

/** 서비스 워커를 막은 컨텍스트 · 서버를 끈 시험에서만 허용하는 브라우저 자체 로그 */
const SW_BLOCKED = /Service Worker registration blocked/;
const OFFLINE_NOISE = /WebSocket connection to .* failed|Failed to load resource/;

// ───────────────────────── 서버 ─────────────────────────

interface AccountRow {
  id: string;
  sub: string;
  profile: string | null;
}

interface ProfileView {
  xp: number;
  coins: number;
  recent: string[];
}

interface LoginServer {
  base: string;
  server: RunningServer;
  /** /test/accounts (계정 ID · sub · 기록 글) */
  accounts(): Promise<AccountRow[]>;
  /** sub의 계정 (없으면 null) */
  account(sub: string): Promise<AccountRow | null>;
  /** 메모리 저장소 장애 흉내 켜기 · 끄기 */
  storeFail(on: boolean): Promise<void>;
  stop(): Promise<void>;
}

/** 로그인을 켠 서버를 빈 포트로 (시험 훅 · 메모리 저장소 · 가짜 구글) */
async function startLoginServer(): Promise<LoginServer> {
  const port = await freePort();
  const server = await startServer(['--test-hooks'], { port, env: LOGIN_ENV });
  expect(server.output.join(''), '서버 시작 로그').toContain('계정 로그인: 켜짐 (memory, 가짜 구글)');
  const base = `http://127.0.0.1:${port}`;
  const accounts = async (): Promise<AccountRow[]> => {
    const res = await fetch(`${base}/test/accounts`);
    expect(res.status).toBe(200);
    return (await res.json()) as AccountRow[];
  };
  return {
    base,
    server,
    accounts,
    account: async (sub) => (await accounts()).find((a) => a.sub === sub) ?? null,
    storeFail: async (on) => {
      const res = await fetch(`${base}/test/account-store?fail=${on ? 1 : 0}`);
      expect(((await res.json()) as { failing: boolean }).failing).toBe(on);
    },
    stop: () => server.stop(),
  };
}

function view(profile: string | null | undefined): ProfileView | null {
  if (!profile) return null;
  const o = JSON.parse(profile) as Partial<ProfileView>;
  return { xp: o.xp ?? 0, coins: o.coins ?? 0, recent: o.recent ?? [] };
}

// ───────────────────────── 브라우저 ─────────────────────────

interface Client {
  context: BrowserContext;
  page: Page;
  /** 콘솔 오류 · 경고 (helpers.ts watchConsole) */
  problems: string[];
}

/** 크롬의 글꼴 미리 받기 '쓰지 않음' 경고 (앱 코드가 아닌 브라우저 경고) */
const FONT_PRELOAD = /noto-sans-kr-ui\.woff2 was preloaded using link preload but not used/;

/**
 * 콘솔 오류 · 경고에서 크롬의 글꼴 미리 받기 경고만 뺀다. 같은 탭이 앞 문서에서 이미 받은 글꼴로 새 문서를 열 때 크롬이 낸다:
 * 같은 출처 가짜 구글을 거쳐 돌아온 문서(/?login=…)에서는 이 컨테이너에서 로그인할 때마다, 다른 문서에서도 가끔
 * (m13-offline이 허용한 경고 · PROGRESS 알려진 문제와 같은 종류)
 */
function issues(c: Client): string[] {
  return c.problems.filter((p) => !FONT_PRELOAD.test(p));
}

/** 페이지 안: 계정 안내 줄(account-notice 안 .acct-note)이 뜰 때마다 글을 모은다 (몇 초 뒤 사라져도 시험이 놓치지 않게) */
function recordNotices(): void {
  const seen: string[] = [];
  (window as unknown as { __acctNotices: string[] }).__acctNotices = seen;
  new MutationObserver((list) => {
    for (const m of list)
      for (const n of m.addedNodes)
        if (n instanceof HTMLElement && n.classList.contains('acct-note')) seen.push(n.textContent ?? '');
  }).observe(document, { childList: true, subtree: true });
}

/**
 * 페이지 안: 주소에 renderer=가 없는 문서(로그인하고 돌아온 /?login=… — 서버가 정한 주소라 시험이 BASE_QUERY를 붙일 수 없다)는
 * WebGL 컨텍스트를 주지 않아 Phaser가 Canvas로 뜨게 한다. GPU 없는 컨테이너의 소프트웨어 WebGL은 첫 화면 굽기로 메인 스레드를
 * 오래 붙잡는다 — 여러 탭 E2E가 Canvas로 도는 것과 같은 이유(helpers.ts BASE_QUERY)
 */
function canvasWithoutQuery(): void {
  if (new URLSearchParams(location.search).has('renderer')) return;
  const get = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (
    this: HTMLCanvasElement,
    type: string,
    ...rest: unknown[]
  ) {
    if (/webgl/i.test(type)) return null;
    return (get as (this: HTMLCanvasElement, t: string, ...r: unknown[]) => RenderingContext | null).call(
      this,
      type,
      ...rest,
    );
  } as typeof HTMLCanvasElement.prototype.getContext;
}

/** 플레이어 하나 (PC 960×540). 계정 안내를 모은다 */
async function newClient(browser: Browser, opts: Parameters<typeof newPlayerPage>[1] = {}): Promise<Client> {
  const c = await newPlayerPage(browser, opts);
  await c.context.addInitScript(recordNotices);
  await c.context.addInitScript(canvasWithoutQuery);
  return { context: c.context, page: c.page, problems: c.problems };
}

/** 이 문서가 연 뒤 뜬 계정 안내 (새로 연 문서마다 새로 센다) */
async function notices(page: Page): Promise<string[]> {
  return page.evaluate(() => [...((window as unknown as { __acctNotices?: string[] }).__acctNotices ?? [])]);
}

async function expectNotice(page: Page, text: string): Promise<void> {
  await expect.poll(() => notices(page), { timeout: 15_000 }).toContain(text);
}

async function expectStore(page: Page, store: 'device' | 'server'): Promise<void> {
  await expect(page.getByTestId('level-chip')).toHaveAttribute('data-store', store, { timeout: 15_000 });
}

async function chipLevel(page: Page): Promise<number> {
  return Number(await page.getByTestId('level-num').textContent());
}

async function readKey(page: Page, key: string): Promise<string | null> {
  return page.evaluate((k) => localStorage.getItem(k), key);
}

/** 이 기기 계정 표시의 tag (없으면 null) */
async function markTag(page: Page): Promise<string | null> {
  const raw = await readKey(page, MARK_KEY);
  return raw ? ((JSON.parse(raw) as { tag?: string }).tag ?? null) : null;
}

async function cookieNames(context: BrowserContext): Promise<string[]> {
  return (await context.cookies()).map((c) => c.name);
}

/** 첫 화면 */
async function home(page: Page, base: string, query = ''): Promise<void> {
  await page.goto(`${base}/?${Q}${query}`);
  await expect(page.getByTestId('practice')).toBeVisible();
}

/**
 * 가짜 구글로 로그인하고 돌아온 첫 화면까지: /auth/google/start?test_sub=… → 가짜 구글이 콜백으로 자동 POST → /?…
 * (화면이 ?login=을 읽고 주소에서 지운다). 토큰 · 취소 흉내는 extra로
 */
async function loginByUrl(page: Page, base: string, sub: string, extra = ''): Promise<void> {
  // 가짜 구글 페이지는 읽는 도중 폼을 보낸다: 첫 이동은 commit까지만 기다린다
  await page.goto(`${base}/auth/google/start?test_sub=${encodeURIComponent(sub)}${extra}`, {
    waitUntil: 'commit',
  });
  await page.waitForURL((u) => u.pathname === '/', { timeout: 15_000 });
}

/**
 * 화면에서 로그인을 시작하는 누름 뒤 가짜 구글 콜백(POST)을 지나 돌아온 첫 화면까지. page.route를 건 페이지에서는 Playwright가 콜백의
 * 303 대신 리디렉트 끝의 응답을 콜백 주소로 알려 주므로(서비스 워커가 맡은 화면) 요청만 기다린다
 */
async function loginByClick(page: Page, click: () => Promise<void>): Promise<void> {
  const cb = page.waitForRequest(
    (r) => r.method() === 'POST' && new URL(r.url()).pathname === '/auth/google/callback',
  );
  await click();
  await cb;
  await page.waitForURL((u) => u.pathname === '/', { timeout: 15_000 });
}

/** 화면의 로그인 단추(location.assign('/auth/google/start'))가 이 sub로 로그인하게 시작 주소에 test_sub를 붙인다 */
async function loginAs(page: Page, sub: string): Promise<void> {
  await page.route(/\/auth\/google\/start(\?|$)/, async (route) => {
    const url = new URL(route.request().url());
    if (!url.searchParams.has('test_sub')) url.searchParams.set('test_sub', sub);
    await route.continue({ url: url.toString() });
  });
}

/** 첫 화면 설정 › 계정 탭 (로그인 기능이 켜졌으면 상태를 읽은 뒤 보인다) */
async function openAccountTab(page: Page): Promise<void> {
  const panel = page.getByTestId('settings-panel');
  if (!(await panel.isVisible())) await press(page.getByTestId('settings-button').first());
  await expect(panel).toBeVisible();
  const tab = page.getByTestId('settings-tab-account');
  await expect(tab).toBeVisible({ timeout: 15_000 });
  await press(tab);
  await expect(tab).toHaveAttribute('aria-selected', 'true');
}

/** 연습 판을 생존자 승리로 끝낸다 (나 · 하나 탈출, 하나 사망, 판 길이 5분 — meta.spec과 같다) */
async function survivorsWin(page: Page): Promise<void> {
  const ids = await page.evaluate(() => {
    const t = window.__DECOY__!.getTruth!();
    return t ? t.players.filter((p) => p.role !== 'monster').map((p) => p.id) : [];
  });
  const me = await myId(page);
  const others = ids.filter((i) => i !== me);
  await sendTest(page, { kind: 'setTime', timeLeft: 400, elapsed: 300 });
  await sendTest(page, { kind: 'setSurvivor', target: me, status: 'escaped' });
  await sendTest(page, { kind: 'setSurvivor', target: others[0]!, status: 'escaped' });
  await sendTest(page, { kind: 'setSurvivor', target: others[1]!, status: 'dead' });
}

/** 지금 첫 화면에서 봇과 연습(달리는 생존자)을 시작해 생존자 승리로 끝내고 결과 '내 평가'까지 */
async function playPractice(page: Page): Promise<void> {
  await press(page.getByTestId('practice'));
  await press(page.getByTestId('practice-role-runner'));
  await waitForSnapshots(page, 3);
  expect(await page.evaluate(() => window.__DECOY__?.transport)).toBe('local');
  await survivorsWin(page);
  await expect(page.getByTestId('rating')).toBeVisible({ timeout: 20_000 });
}

/**
 * 개발 봇 방(?bots=1, 시험 훅 서버)을 만들어 달리는 생존자로 시작하고, 판 시간을 넘겨 결과 '내 평가'까지 (서버 판).
 * store = 방을 만들기 전 첫 화면 레벨 칩이 보여야 하는 기록 저장소 (계정을 읽은 뒤 판을 시작한다)
 */
async function playOnline(
  page: Page,
  base: string,
  store: 'device' | 'server',
  during?: () => Promise<void>,
): Promise<void> {
  await page.goto(`${base}/?${Q}&bots=1`);
  await expectStore(page, store);
  await press(page.getByTestId('create-room'));
  await expect(page.getByTestId('room-code')).toHaveText(/^[A-Z]{4}$/);
  await pickRoleAndReady(page, 'runner');
  // 결과 조각을 미리 받아 둔 뒤 시작한다 (결과가 오면 바로 그린다)
  await expect(page.getByTestId('settings-modal')).toBeAttached({ timeout: 15_000 });
  await press(page.getByTestId('start-button'));
  await waitForSnapshots(page, 3);
  expect(await page.evaluate(() => window.__DECOY__?.transport)).toBe('net');
  await during?.();
  await sendTest(page, { kind: 'setTime', timeLeft: 0.1, elapsed: 300 });
  await expect(page.getByTestId('rating')).toBeVisible({ timeout: 20_000 });
}

/**
 * 게임 소켓 엿보기 (page.routeWebSocket — 페이지 소켓을 서버로 그대로 잇는다): 서버가 보낸 원문을 모으고, holdCredit이면 계정 적립
 * 알림(credit)만 붙잡아 두었다가 release로 보낸다. 페이지를 열기 전에 건다
 */
interface SocketTap {
  frames: string[];
  held: string[];
  /** 이 페이지가 연 게임 소켓 수 */
  opened: number;
  release(): void;
}

async function tapSocket(page: Page, holdCredit: boolean): Promise<SocketTap> {
  const queue: (() => void)[] = [];
  let hold = holdCredit;
  const tap: SocketTap = {
    frames: [],
    held: [],
    opened: 0,
    release() {
      hold = false;
      for (const send of queue.splice(0)) send();
    },
  };
  await page.routeWebSocket(/\/ws$/, (ws) => {
    tap.opened += 1;
    const server = ws.connectToServer();
    ws.onMessage((m) => server.send(m));
    server.onMessage((m) => {
      const text = typeof m === 'string' ? m : m.toString('utf8');
      tap.frames.push(text);
      if (hold && (JSON.parse(text) as ServerMessage).t === 'credit') {
        tap.held.push(text);
        queue.push(() => ws.send(m));
        return;
      }
      ws.send(m);
    });
  });
  return tap;
}

function messages(raw: readonly string[]): ServerMessage[] {
  return raw.map((t) => JSON.parse(t) as ServerMessage);
}

/** 받은 원문 가운데 내 결과의 평가 판 ID */
function ratedMatchId(raw: readonly string[]): string {
  const res = messages(raw).filter((m): m is Extract<ServerMessage, { t: 'result' }> => m.t === 'result');
  const id = res.at(-1)?.rating?.matchId;
  if (!id) throw new Error('결과 평가 없음');
  return id;
}

function credits(raw: readonly string[]): Extract<ServerMessage, { t: 'credit' }>[] {
  return messages(raw).filter((m): m is Extract<ServerMessage, { t: 'credit' }> => m.t === 'credit');
}

/** 이 기기 기록을 미리 둔다 (첫 접속에만 — 시험 중 바뀐 기록은 덮지 않는다) */
async function seedDevice(context: BrowserContext, profile: Record<string, unknown>): Promise<void> {
  await context.addInitScript(
    ([k, v]) => {
      if (localStorage.getItem(k) === null) localStorage.setItem(k, v);
    },
    [PROGRESS_KEY, JSON.stringify({ v: 1, ...profile })] as const,
  );
}

// ───────────────────────── 1. 로그인 · 올리기 · 서버 적립 · 다른 기기 ─────────────────────────

test('로그인: 연습 판 기기 기록이 첫 로그인에 계정으로 올라가고, 온라인 판은 서버가 적립해 credit이 오면 "저장하는 중" → "저장했어요", 다른 기기(새 컨텍스트)에서 같은 sub로 로그인하면 묻지 않고 같은 레벨', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const srv = await startLoginServer();
  const a = await newClient(browser);
  try {
    // 게스트로 봇과 연습 한 판 → 기기 기록 (레벨 2)
    await home(a.page, srv.base);
    await expectStore(a.page, 'device');
    await playPractice(a.page);
    await press(a.page.getByTestId('result-home'));
    const device = view(await readKey(a.page, PROGRESS_KEY));
    expect(device?.xp ?? 0).toBeGreaterThan(100);
    expect(device?.recent).toHaveLength(1);
    expect(await srv.accounts()).toEqual([]);

    // 설정 › 계정 › 'Google 계정으로 로그인' (가짜 구글, sub=alice)
    await loginAs(a.page, 'alice');
    await openAccountTab(a.page);
    await expect(a.page.getByTestId('account-page')).toHaveAttribute('data-view', 'out');
    await loginByClick(a.page, () => press(a.page.getByTestId('account-login')));
    await expectNotice(a.page, T.results.ok);
    await expectNotice(a.page, T.imported);
    await expectStore(a.page, 'server');
    expect(new URL(a.page.url()).searchParams.has('login'), '?login=을 주소에서 지운다').toBe(false);
    // 기기 기록이 계정으로 올라갔다 (같은 경험치 · 같은 판), 기기 기록은 지우지 않는다
    const alice = await srv.account('alice');
    expect(alice?.id).toMatch(/^[0-9a-f]{32}$/);
    expect(view(alice?.profile)).toEqual(device);
    expect(view(await readKey(a.page, PROGRESS_KEY))).toEqual(device);
    expect(await markTag(a.page)).toMatch(/^[\w-]{16}$/);
    expect(await cookieNames(a.context)).toContain('decoy_sid');
    expect(await a.page.locator('[data-testid="account-choose"]').count()).toBe(0);
    await openAccountTab(a.page);
    await expect(a.page.getByTestId('account-page')).toHaveAttribute('data-view', 'in');
    await expect(a.page.getByTestId('account-signed-in')).toBeVisible();
    await press(a.page.getByTestId('settings-close'));

    // 온라인 판 (서버 판 — 개발 봇 방): 서버가 적립한 뒤 credit을 붙잡아 두면 결과는 '저장하는 중', 놓으면 '저장했어요'
    const tap = await tapSocket(a.page, true);
    await playOnline(a.page, srv.base, 'server', async () => {
      // 판 중 설정에는 계정 탭이 없다 (로그인 · 로그아웃은 페이지를 떠난다)
      await press(a.page.getByTestId('match-menu'));
      await expect(a.page.getByTestId('settings-panel')).toBeVisible();
      await expect(a.page.getByTestId('settings-tab-graphics')).toBeVisible();
      await expect(a.page.getByTestId('settings-tab-account')).toBeHidden();
      await a.page.keyboard.press('Escape');
      await expect(a.page.getByTestId('settings-panel')).toBeHidden();
    });
    const matchId = ratedMatchId(tap.frames);
    expect(device?.recent).not.toContain(matchId);
    const line = a.page.getByTestId('rate-account');
    await expect(line).toHaveAttribute('data-state', 'pending');
    await expect(line).toHaveText(T.saving);
    await expect(a.page.getByTestId('xp-gain')).toContainText('경험치 +');
    await expect.poll(() => tap.held.length, { timeout: 15_000 }).toBe(1);
    const after = view((await srv.account('alice'))?.profile);
    expect(after?.recent).toContain(matchId);
    expect(after?.xp ?? 0).toBeGreaterThan(device?.xp ?? 0);
    // 서버는 이미 적립했지만 화면은 credit을 기다린다
    await expect(line).toHaveAttribute('data-state', 'pending');
    const credit = credits(tap.held)[0]!;
    expect(credit).toMatchObject({ matchId, ok: true });
    expect(view(credit.profile)).toEqual(after);
    tap.release();
    await expect(line).toHaveAttribute('data-state', 'saved');
    await expect(line).toHaveText(T.saved);
    // 이 판은 기기 기록에 쓰지 않는다 (계정 모드)
    expect(view(await readKey(a.page, PROGRESS_KEY))).toEqual(device);
    await press(a.page.getByTestId('result-home'));
    const level = levelOf(after?.xp ?? 0, PROGRESSION).level;
    await expect(a.page.getByTestId('level-num')).toHaveText(String(level));

    // 다른 기기 흉내 (새 컨텍스트, 저장소 빈 상태): 같은 sub로 로그인 → 기기 기록이 비어 묻지 않고 계정 기록 그대로
    const b = await newClient(browser);
    try {
      await home(b.page, srv.base);
      await loginByUrl(b.page, srv.base, 'alice');
      await expectNotice(b.page, T.results.ok);
      await expectStore(b.page, 'server');
      await expect(b.page.getByTestId('level-num')).toHaveText(String(level));
      expect(await chipLevel(b.page)).toBe(await chipLevel(a.page));
      expect(await b.page.locator('[data-testid="account-choose"]').count()).toBe(0);
      expect(await notices(b.page)).not.toContain(T.imported);
      // 같은 계정 · 계정 기록 그대로 (B의 기기 기록은 비어 있다)
      expect(await srv.accounts()).toHaveLength(1);
      expect(view((await srv.account('alice'))?.profile)).toEqual(after);
      expect(await readKey(b.page, PROGRESS_KEY)).toBeNull();
      expect(await markTag(b.page)).toBe(await markTag(a.page));
      expect(issues(b)).toEqual([]);
    } finally {
      await b.context.close();
    }
    expect(issues(a)).toEqual([]);
  } finally {
    await a.context.close();
    await srv.stop();
  }
});

// ───────────────────────── 2. 둘 다 기록이 있을 때 고르기 ─────────────────────────

test('고르기: 계정과 이 기기 둘 다 기록이 있으면 고르기 창 — "이 기기 기록"은 계정 기록을 바꾸고 "계정 기록"은 그대로, 새로고침하면 다시 묻지 않는다', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const srv = await startLoginServer();
  const clients: Client[] = [];
  try {
    // 계정에 기록을 만든다: 기록이 있는 기기에서 bob으로 처음 로그인 (계정이 비어 묻지 않고 올린다)
    const x = await newClient(browser);
    clients.push(x);
    await seedDevice(x.context, { xp: 2600, coins: 77, played: { survivor: 9, monster: 3 } });
    await home(x.page, srv.base);
    await loginByUrl(x.page, srv.base, 'bob');
    await expectNotice(x.page, T.imported);
    await expectStore(x.page, 'server');
    const seeded = (await srv.account('bob'))?.profile ?? null;
    expect(view(seeded)).toMatchObject({ xp: 2600, coins: 77 });

    // Y: 연습 판 기록이 있는 새 기기 → bob 로그인 → 고르기 창 → '이 기기 기록'
    const y = await newClient(browser);
    clients.push(y);
    await home(y.page, srv.base);
    await playPractice(y.page);
    await press(y.page.getByTestId('result-home'));
    const yDevice = view(await readKey(y.page, PROGRESS_KEY));
    expect(yDevice?.recent).toHaveLength(1);
    await loginAs(y.page, 'bob');
    await openAccountTab(y.page);
    await loginByClick(y.page, () => press(y.page.getByTestId('account-login')));
    const choose = y.page.getByTestId('account-choose');
    await expect(choose).toBeVisible({ timeout: 15_000 });
    // 고르는 동안은 아직 계정 기록 그대로 · 두 기록의 요약 (레벨 · 불씨 · 의상 · 판 수)
    expect((await srv.account('bob'))?.profile).toBe(seeded);
    await expect(y.page.getByTestId('account-choose-account')).toContainText(
      `Lv ${levelOf(2600, PROGRESSION).level} · 불씨 77 · 의상 0벌 · 12판`,
    );
    await expect(y.page.getByTestId('account-choose-device')).toContainText(
      `Lv ${levelOf(yDevice?.xp ?? 0, PROGRESSION).level} · 불씨 ${yDevice?.coins} · 의상 0벌 · 1판`,
    );
    await press(y.page.getByTestId('account-choose-device'));
    await expect(choose).toHaveCount(0);
    await expectStore(y.page, 'server');
    await expect.poll(async () => view((await srv.account('bob'))?.profile)).toEqual(yDevice);
    await expect(y.page.getByTestId('level-num')).toHaveText(
      String(levelOf(yDevice?.xp ?? 0, PROGRESSION).level),
    );
    expect(await notices(y.page)).toContain(T.imported);
    // 새로고침: 이 기기 표시가 계정과 같아 다시 묻지 않는다
    await home(y.page, srv.base);
    await expectStore(y.page, 'server');
    expect(await y.page.locator('[data-testid="account-choose"]').count()).toBe(0);
    expect(view((await srv.account('bob'))?.profile)).toEqual(yDevice);

    // Z: 또 다른 연습 판 기록 기기 → bob 로그인 → '계정 기록' → 계정 기록 그대로
    const z = await newClient(browser);
    clients.push(z);
    await home(z.page, srv.base);
    await playPractice(z.page);
    await press(z.page.getByTestId('result-home'));
    const zDevice = view(await readKey(z.page, PROGRESS_KEY));
    expect(zDevice?.recent).not.toEqual(yDevice?.recent);
    const before = (await srv.account('bob'))?.profile ?? null;
    await loginByUrl(z.page, srv.base, 'bob');
    await expect(z.page.getByTestId('account-choose')).toBeVisible({ timeout: 15_000 });
    await press(z.page.getByTestId('account-choose-account'));
    await expectStore(z.page, 'server');
    expect((await srv.account('bob'))?.profile).toBe(before);
    await expect(z.page.getByTestId('level-num')).toHaveText(
      String(levelOf(yDevice?.xp ?? 0, PROGRESSION).level),
    );
    expect(await notices(z.page)).not.toContain(T.imported);
    // 이 기기 기록은 어느 쪽이든 그대로 남는다
    expect(view(await readKey(z.page, PROGRESS_KEY))).toEqual(zDevice);
    await home(z.page, srv.base);
    await expectStore(z.page, 'server');
    expect(await z.page.locator('[data-testid="account-choose"]').count()).toBe(0);
    expect((await srv.account('bob'))?.profile).toBe(before);
    for (const c of clients) expect(issues(c)).toEqual([]);
  } finally {
    for (const c of clients) await c.context.close();
    await srv.stop();
  }
});

// ───────────────────────── 3. 연습 판은 계정에 적립하지 않음 ─────────────────────────

test('로그인한 채 봇과 연습: 결과에 "연습 판은 계정에 적립되지 않아요", 계정 기록 · 이 기기 기록 모두 그대로', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const srv = await startLoginServer();
  const c = await newClient(browser);
  try {
    await seedDevice(c.context, { xp: 250, coins: 30, played: { survivor: 2, monster: 0 } });
    await home(c.page, srv.base);
    await loginByUrl(c.page, srv.base, 'carol');
    await expectNotice(c.page, T.imported);
    await expectStore(c.page, 'server');
    const account = (await srv.account('carol'))?.profile ?? null;
    expect(view(account)).toMatchObject({ xp: 250, coins: 30 });
    const device = await readKey(c.page, PROGRESS_KEY);
    const level = await chipLevel(c.page);
    // 로그인하고 돌아온 주소(/?login=ok)에는 시험 훅 주소 값이 없다: 첫 화면을 다시 연다 (계정 모드 그대로)
    await home(c.page, srv.base);
    await expectStore(c.page, 'server');
    await playPractice(c.page);
    await expect(c.page.getByTestId('rate-practice')).toHaveText(T.practice);
    // 평가는 보이지만 적립 · 저장 줄은 없다
    for (const id of ['xp-gain', 'rate-account', 'rate-not-saved', 'rate-already'])
      expect(await c.page.locator(`[data-testid="${id}"]`).count(), id).toBe(0);
    expect((await srv.account('carol'))?.profile).toBe(account);
    expect(await readKey(c.page, PROGRESS_KEY)).toBe(device);
    await press(c.page.getByTestId('result-home'));
    await expectStore(c.page, 'server');
    expect(await chipLevel(c.page)).toBe(level);
    expect((await srv.account('carol'))?.profile).toBe(account);
    expect(issues(c)).toEqual([]);
  } finally {
    await c.context.close();
    await srv.stop();
  }
});

// ───────────────────────── 4. 로그아웃 · 계정 삭제 · 웹 삭제 페이지 ─────────────────────────

test('로그아웃하면 이 기기 기록으로 · 첫 화면 소켓을 새로 열어 다음 온라인 판은 계정에 적립하지 않고, 다시 로그인해 설정에서 계정 삭제(두 번 확인)하면 서버 기록이 바로 사라지고 게스트', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const srv = await startLoginServer();
  const c = await newClient(browser);
  try {
    const tap = await tapSocket(c.page, false);
    await home(c.page, srv.base);
    await loginByUrl(c.page, srv.base, 'dave');
    await expectStore(c.page, 'server');
    expect(await markTag(c.page)).not.toBeNull();
    const account = (await srv.account('dave'))?.profile ?? null;
    expect(account).not.toBeNull();
    // 첫 화면(개발 봇 방을 만들 수 있게 ?bots=1)에서 로그아웃
    await home(c.page, srv.base, '&bots=1');
    await expectStore(c.page, 'server');
    await expect(c.page.getByTestId('server-status')).toHaveAttribute('data-state', 'connected');
    const sockets = tap.opened;
    await openAccountTab(c.page);
    await press(c.page.getByTestId('account-logout'));
    await expectStore(c.page, 'device');
    await expect(c.page.getByTestId('account-page')).toHaveAttribute('data-view', 'out');
    await expect(c.page.getByTestId('account-login')).toBeVisible();
    await expectNotice(c.page, T.loggedOut);
    expect(await readKey(c.page, MARK_KEY)).toBeNull();
    expect(await cookieNames(c.context)).not.toContain('decoy_sid');
    // 로그아웃은 계정을 지우지 않는다
    expect(await srv.account('dave')).not.toBeNull();
    // 서버는 소켓을 열 때의 쿠키로 계정을 정한다: 첫 화면이면 로그아웃한 쿠키로 소켓을 새로 연다
    await expect.poll(() => tap.opened).toBe(sockets + 1);
    await press(c.page.getByTestId('settings-close'));
    // 같은 문서에서 바로 온라인 판: 게스트로 적립(이 기기 기록), 계정에는 적립하지 않고 credit도 없다
    await press(c.page.getByTestId('create-room'));
    await expect(c.page.getByTestId('room-code')).toHaveText(/^[A-Z]{4}$/);
    await pickRoleAndReady(c.page, 'runner');
    await press(c.page.getByTestId('start-button'));
    await waitForSnapshots(c.page, 3);
    await sendTest(c.page, { kind: 'setTime', timeLeft: 0.1, elapsed: 300 });
    await expect(c.page.getByTestId('rating')).toBeVisible({ timeout: 20_000 });
    const matchId = ratedMatchId(tap.frames);
    await expect(c.page.getByTestId('xp-gain')).toContainText('경험치 +');
    expect(await c.page.locator('[data-testid="rate-account"]').count()).toBe(0);
    await expect.poll(async () => view(await readKey(c.page, PROGRESS_KEY))?.recent ?? []).toContain(matchId);
    // 결과 뒤에 받은 프레임이 있을 때까지 (서버는 결과를 보낸 바로 뒤에 적립한다 — 그 뒤에도 credit이 없다)
    const afterResult = tap.frames.length;
    await expect.poll(() => tap.frames.length, { timeout: 30_000 }).toBeGreaterThan(afterResult);
    expect(credits(tap.frames)).toEqual([]);
    expect((await srv.account('dave'))?.profile).toBe(account);
    await press(c.page.getByTestId('result-home'));

    // 새로고침해도 게스트 (표시가 없어 계정 요청도 없다)
    const statusReqs: string[] = [];
    c.page.on('request', (r) => {
      if (new URL(r.url()).pathname === '/api/account') statusReqs.push(r.url());
    });
    await home(c.page, srv.base);
    await expectStore(c.page, 'device');
    expect(statusReqs).toEqual([]);

    // 다시 로그인: 로그아웃이 표시를 지워 다시 첫 로그인이다. 이 기기에는 게스트 판 기록, 계정에는 첫 로그인 때 연 빈 기록(아무것도
    // 쌓지 않음)이 있어 묻지 않고 이 기기 기록을 올린다
    const deviceNow = view(await readKey(c.page, PROGRESS_KEY));
    expect(deviceNow?.xp ?? 0).toBeGreaterThan(0);
    await loginByUrl(c.page, srv.base, 'dave');
    await expectStore(c.page, 'server');
    await expectNotice(c.page, T.imported);
    expect(await c.page.getByTestId('account-choose').count()).toBe(0);
    expect(view((await srv.account('dave'))?.profile ?? null)?.xp).toBe(deviceNow?.xp);
    // 설정 › 계정 삭제: 첫 누름은 확인만, 취소하면 그대로, 두 번째 확인에서 지운다
    expect(await srv.account('dave')).not.toBeNull();
    await openAccountTab(c.page);
    await press(c.page.getByTestId('account-delete'));
    await expect(c.page.getByTestId('account-delete-yes')).toBeVisible();
    await press(c.page.getByTestId('account-delete-no'));
    await expect(c.page.getByTestId('account-signed-in')).toBeVisible();
    expect(await srv.account('dave')).not.toBeNull();
    await press(c.page.getByTestId('account-delete'));
    await press(c.page.getByTestId('account-delete-yes'));
    await expectStore(c.page, 'device');
    await expectNotice(c.page, T.removed);
    expect(await srv.accounts()).toEqual([]);
    await expect(c.page.getByTestId('account-page')).toHaveAttribute('data-view', 'out');
    expect(await readKey(c.page, MARK_KEY)).toBeNull();
    expect(await cookieNames(c.context)).not.toContain('decoy_sid');
    expect(issues(c)).toEqual([]);
  } finally {
    await c.context.close();
    await srv.stop();
  }
});

test('웹 삭제 페이지: 로그인 안 한 브라우저로 /account/delete → "로그인해 삭제하기" → 가짜 구글 → 삭제 폼 → 지웠어요 (계정 사라짐), 로그인 꺼진 서버는 안내만', async ({
  browser,
  baseURL,
}) => {
  const srv = await startLoginServer();
  const c = await newClient(browser);
  try {
    await c.page.goto(`${srv.base}/account/delete`);
    const link = c.page.getByTestId('delete-login');
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', '/auth/google/start?next=delete');
    await loginAs(c.page, 'erin');
    await press(link);
    // 로그인 뒤 삭제 페이지로 돌아온다 (next=delete)
    await expect(c.page.getByTestId('delete-account')).toBeVisible({ timeout: 15_000 });
    expect(new URL(c.page.url()).pathname).toBe('/account/delete');
    await expect(c.page.getByTestId('delete-account')).toContainText('레벨 1');
    expect(await srv.account('erin')).not.toBeNull();
    await press(c.page.getByTestId('delete-submit'));
    await expect(c.page.getByTestId('delete-done')).toBeVisible();
    await expect(c.page.getByTestId('delete-done')).toContainText('지웠습니다');
    expect(await srv.accounts()).toEqual([]);
    expect(await cookieNames(c.context)).not.toContain('decoy_sid');
    // 다시 열면 로그인 안 한 안내
    await c.page.goto(`${srv.base}/account/delete`);
    await expect(c.page.getByTestId('delete-login')).toBeVisible();

    // 로그인 꺼진 서버 (기본 E2E 서버): 여기서는 지울 수 없다는 안내만
    await c.page.goto(`${baseURL}/account/delete`);
    await expect(c.page.getByTestId('delete-off')).toBeVisible();
    expect(await c.page.locator('[data-testid="delete-login"]').count()).toBe(0);
    expect(issues(c)).toEqual([]);
  } finally {
    await c.context.close();
    await srv.stop();
  }
});

// ───────────────────────── 5. 로그인 꺼짐 ─────────────────────────

test('로그인 꺼짐(기본 서버): 첫 화면 · 봇과 연습에 계정 요청 · 계정 조각이 없고, 설정을 열면 상태 요청 한 번 뒤 계정 탭이 보이지 않는다', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  // 요청을 세려고 서비스 워커는 막는다 (lazy-chunks와 같다)
  const c = await newClient(browser, { serviceWorkers: 'block' });
  const chunks: string[] = [];
  const accountReqs: string[] = [];
  c.page.on('request', (r) => {
    const path = new URL(r.url()).pathname;
    const m = /\/assets\/([A-Za-z]+)-[\w-]+\.js$/.exec(path);
    if (m?.[1]) chunks.push(m[1]);
    if (path.startsWith('/api/') || path.startsWith('/auth/') || path.startsWith('/account/'))
      accountReqs.push(`${r.method()} ${path}`);
  });
  try {
    await c.page.goto(`/?${Q}`);
    await expect(c.page.getByTestId('practice')).toBeVisible();
    // 쉬는 시간 미리 받기(설정 화면까지)가 끝날 때까지
    await expect(c.page.getByTestId('settings-modal')).toBeAttached({ timeout: 15_000 });
    await expect.poll(() => chunks.includes('localServer'), { timeout: 15_000 }).toBe(true);
    await expectStore(c.page, 'device');
    expect(chunks).not.toContain('account');
    expect(accountReqs).toEqual([]);
    // 봇과 연습 한 판
    await playPractice(c.page);
    await press(c.page.getByTestId('result-home'));
    expect(chunks).not.toContain('account');
    expect(accountReqs).toEqual([]);
    // 설정을 연다: 계정 조각을 받고 상태 요청 한 번({on:false}) → 계정 탭은 숨긴 채
    const status = c.page.waitForResponse((r) => new URL(r.url()).pathname === '/api/account');
    await press(c.page.getByTestId('settings-button').first());
    await expect(c.page.getByTestId('settings-panel')).toBeVisible();
    expect(await (await status).json()).toEqual({ on: false });
    await expect.poll(() => chunks.includes('account')).toBe(true);
    await expect(c.page.getByTestId('settings-tab-graphics')).toBeVisible();
    await expect(c.page.getByTestId('settings-tab-account')).toBeHidden();
    // 다시 열어도 묻지 않는다 (꺼짐을 기억)
    await press(c.page.getByTestId('settings-close'));
    await press(c.page.getByTestId('settings-button').first());
    await expect(c.page.getByTestId('settings-panel')).toBeVisible();
    await expect(c.page.getByTestId('settings-tab-account')).toBeHidden();
    expect(accountReqs).toEqual(['GET /api/account']);
    expect(await notices(c.page)).toEqual([]);
    expect(issues(c).filter((p) => !SW_BLOCKED.test(p))).toEqual([]);
  } finally {
    await c.context.close();
  }
});

test('로그인 꺼짐: 예전에 로그인했던 기기(표시가 남음)는 부팅마다 상태를 읽어 "지금은 로그인을 쓸 수 없어요" 한 줄 · 게스트, 표시는 남긴다(다시 켜면 같은 계정으로)', async ({
  browser,
}) => {
  const c = await newClient(browser, { serviceWorkers: 'block' });
  await c.context.addInitScript((k) => {
    if (sessionStorage.getItem('e2e-marked') === null) {
      sessionStorage.setItem('e2e-marked', '1');
      localStorage.setItem(k, JSON.stringify({ v: 1, tag: 'oldtag0123456789' }));
    }
  }, MARK_KEY);
  const statusReqs: string[] = [];
  c.page.on('request', (r) => {
    if (new URL(r.url()).pathname === '/api/account') statusReqs.push(r.url());
  });
  try {
    await c.page.goto(`/?${Q}`);
    await expectNotice(c.page, T.results.off);
    await expectStore(c.page, 'device');
    expect(statusReqs).toHaveLength(1);
    // 표시는 남긴다: 지우면 다시 켰을 때 화면은 게스트인데 남은 쿠키로 서버가 계정에 적립한다(DECISIONS 15절)
    expect(JSON.parse((await readKey(c.page, MARK_KEY)) ?? 'null')).toEqual({
      v: 1,
      tag: 'oldtag0123456789',
    });
    await c.page.reload();
    await expect(c.page.getByTestId('practice')).toBeVisible();
    await expectNotice(c.page, T.results.off);
    await expectStore(c.page, 'device');
    expect(statusReqs).toHaveLength(2);
    expect(JSON.parse((await readKey(c.page, MARK_KEY)) ?? 'null')).toEqual({
      v: 1,
      tag: 'oldtag0123456789',
    });
    expect(issues(c).filter((p) => !SW_BLOCKED.test(p))).toEqual([]);
  } finally {
    await c.context.close();
  }
});

// ───────────────────────── 6. DB 장애 ─────────────────────────

test('DB 장애: 새로고침하면 "계정에 연결하지 못해 이 기기 기록으로 해요" · 이 기기 기록으로 봇과 연습 · 온라인 판이 끝까지, 되돌리면 다음 새로고침에 계정, 로그인 중 장애는 ?login=db', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const srv = await startLoginServer();
  const c = await newClient(browser);
  try {
    await home(c.page, srv.base);
    await loginByUrl(c.page, srv.base, 'frank');
    await expectStore(c.page, 'server');
    const account = (await srv.account('frank'))?.profile ?? null;
    expect(account).not.toBeNull();

    await srv.storeFail(true);
    await home(c.page, srv.base);
    await expectNotice(c.page, T.offline);
    await expectStore(c.page, 'device');
    // 표시는 남는다 (다음 접속에 다시 계정을 읽는다)
    expect(await markTag(c.page)).not.toBeNull();
    // 봇과 연습: 이 기기 기록에 적립
    await playPractice(c.page);
    await expect(c.page.getByTestId('xp-gain')).toContainText('경험치 +');
    expect(await c.page.locator('[data-testid="rate-practice"]').count()).toBe(0);
    await expect.poll(async () => view(await readKey(c.page, PROGRESS_KEY))?.recent.length ?? 0).toBe(1);
    await press(c.page.getByTestId('result-home'));

    // 온라인 판: 결과 화면이 뜨고 이번 접속은 게스트(이 기기 기록에 적립, 계정 저장 줄 없음).
    // 소켓은 세션 쿠키로 계정이 붙어 서버가 적립을 시도하지만 DB가 죽어 다시 시도 끝에 실패(ok:false) — 게스트 화면은 무시한다
    const tap = await tapSocket(c.page, false);
    await playOnline(c.page, srv.base, 'device');
    const matchId = ratedMatchId(tap.frames);
    await expect(c.page.getByTestId('xp-gain')).toContainText('경험치 +');
    expect(await c.page.locator('[data-testid="rate-account"]').count()).toBe(0);
    await expect.poll(async () => view(await readKey(c.page, PROGRESS_KEY))?.recent ?? []).toContain(matchId);
    await expect.poll(() => credits(tap.frames).length, { timeout: 30_000 }).toBe(1);
    expect(credits(tap.frames)[0]).toEqual({ t: 'credit', matchId, ok: false, profile: null });
    expect(await c.page.locator('[data-testid="rate-account"]').count()).toBe(0);
    await press(c.page.getByTestId('result-home'));
    await expect(c.page.getByTestId('practice')).toBeVisible();
    await expectStore(c.page, 'device');

    // 되돌리면 다음 새로고침에 계정 모드 (장애 중 판은 계정에 없다)
    await srv.storeFail(false);
    expect((await srv.account('frank'))?.profile).toBe(account);
    await home(c.page, srv.base);
    await expectStore(c.page, 'server');
    expect(await notices(c.page)).toEqual([]);

    // 로그인 화면으로 가는 중 장애 → /?login=db 안내 · 게스트
    await srv.storeFail(true);
    const cb = c.page.waitForResponse((r) => new URL(r.url()).pathname === '/auth/google/callback');
    await loginByUrl(c.page, srv.base, 'gina');
    expect((await cb).headers().location).toBe('/?login=db');
    await expectNotice(c.page, T.results.db);
    await expectStore(c.page, 'device');
    await srv.storeFail(false);
    expect(await srv.account('gina')).toBeNull();
    // 장애 중 계정 상태 읽기(GET /api/account → 503)마다 브라우저가 스스로 찍는 실패 로그만 있다 (앱 코드는 조용히 게스트로)
    const http503 = /Failed to load resource: the server responded with a status of 503/;
    expect(issues(c).filter((p) => http503.test(p)).length).toBeGreaterThan(0);
    expect(issues(c).filter((p) => !http503.test(p))).toEqual([]);
  } finally {
    await c.context.close();
    await srv.stop();
  }
});

// ───────────────────────── 7. 나쁜 토큰 · 취소 ─────────────────────────

test('나쁜 토큰(만료 · 가짜 서명 · 다른 aud · nonce)은 "로그인하지 못했어요", 취소는 "로그인을 취소했어요" — 세션 쿠키도 계정도 생기지 않는다', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const srv = await startLoginServer();
  const c = await newClient(browser);
  try {
    const cases: { extra: string; result: 'fail' | 'cancel'; text: string }[] = [
      ...['expired', 'badsig', 'wrongaud', 'nonce'].map((t) => ({
        extra: `&test_token=${t}`,
        result: 'fail' as const,
        text: T.results.fail,
      })),
      { extra: '&test_error=access_denied', result: 'cancel', text: T.results.cancel },
    ];
    for (const [i, k] of cases.entries()) {
      const cb = c.page.waitForResponse((r) => new URL(r.url()).pathname === '/auth/google/callback');
      await loginByUrl(c.page, srv.base, `mallory-${i}`, k.extra);
      const res = await cb;
      expect(res.status(), k.extra).toBe(303);
      expect(res.headers().location, k.extra).toBe(`/?login=${k.result}`);
      await expectNotice(c.page, k.text);
      expect(await notices(c.page), k.extra).not.toContain(T.results.ok);
      await expectStore(c.page, 'device');
      expect(await cookieNames(c.context), k.extra).not.toContain('decoy_sid');
      expect(await readKey(c.page, MARK_KEY)).toBeNull();
      expect(await srv.accounts(), k.extra).toEqual([]);
    }
    // 같은 흐름에서 나쁜 것만 빼면 로그인된다 (흉내가 실제로 실패를 만든 것)
    await loginByUrl(c.page, srv.base, 'mallory-ok');
    await expectNotice(c.page, T.results.ok);
    await expectStore(c.page, 'server');
    expect(await cookieNames(c.context)).toContain('decoy_sid');
    expect((await srv.accounts()).map((a) => a.sub)).toEqual(['mallory-ok']);
    expect(issues(c)).toEqual([]);
  } finally {
    await c.context.close();
    await srv.stop();
  }
});

// ───────────────────────── 8. 정보 숨김 ─────────────────────────

test('정보 숨김: 로그인한 생존자 셋 + 로그인 안 한 괴물의 친구 방 — 괴물이 받은 모든 원문에 계정 ID · tag · credit · account가 없고, credit은 그 생존자 연결에만 하나씩', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const srv = await startLoginServer();
  const survivors = [
    { role: 'runner', sub: 'sub-runner-7f3a' },
    { role: 'guard', sub: 'sub-guard-91bc' },
    { role: 'scout', sub: 'sub-scout-04de' },
  ] as const;
  const clients: (Client & { frames: CollectedFrames; role: string })[] = [];
  try {
    const monster = await newClient(browser);
    const mFrames = collectFrames(monster.page);
    clients.push({ ...monster, frames: mFrames, role: 'monster' });
    await home(monster.page, srv.base);
    await press(monster.page.getByTestId('create-room'));
    const code = (await monster.page.getByTestId('room-code').textContent()) ?? '';
    expect(code).toMatch(/^[A-Z]{4}$/);
    const tags: string[] = [];
    for (const s of survivors) {
      const c = await newClient(browser);
      const frames = collectFrames(c.page);
      clients.push({ ...c, frames, role: s.role });
      await home(c.page, srv.base);
      await loginByUrl(c.page, srv.base, s.sub);
      await expectStore(c.page, 'server');
      tags.push((await markTag(c.page)) ?? '');
      // 로그인한 쿠키로 새 소켓을 열고 방에 들어간다
      await c.page.goto(`${srv.base}/?room=${code}&${Q}`);
      await expect(c.page.getByTestId('room-code')).toHaveText(code);
    }
    const ids = (await srv.accounts()).map((a) => a.id);
    expect(ids).toHaveLength(3);
    expect(tags.every((t) => /^[\w-]{16}$/.test(t))).toBe(true);
    for (const c of clients) await pickRoleAndReady(c.page, c.role as 'monster');
    await press(monster.page.getByTestId('start-button'));
    for (const c of clients) await waitForSnapshots(c.page, 10);
    await sendTest(monster.page, { kind: 'setTime', timeLeft: 0.1, elapsed: 300 });
    for (const c of clients) await expect(c.page.getByTestId('rating')).toBeVisible({ timeout: 20_000 });
    // 생존자: 자기 credit 하나씩 → 저장했어요
    for (const c of clients.slice(1)) {
      await expect.poll(() => credits(c.frames.raw).length, { timeout: 15_000 }).toBe(1);
      await expect(c.page.getByTestId('rate-account')).toHaveAttribute('data-state', 'saved');
    }
    // 괴물: 생존자 credit이 모두 온 뒤에 받은 프레임이 있을 때까지 (그 뒤에도 credit이 없다)
    const seen = mFrames.raw.length;
    await expect.poll(() => mFrames.raw.length, { timeout: 30_000 }).toBeGreaterThan(seen);
    // 괴물(게스트)은 이 기기 기록에 적립하고 계정 저장 줄이 없다
    expect(await monster.page.locator('[data-testid="rate-account"]').count()).toBe(0);
    await expect(monster.page.getByTestId('xp-gain')).toContainText('경험치 +');

    const secrets = [...ids, ...tags, ...survivors.map((s) => s.sub)];
    const mRaw = mFrames.raw;
    expect(mRaw.some((t) => t.includes('"t":"match"')) && mRaw.some((t) => t.includes('"t":"result"'))).toBe(
      true,
    );
    expect(mRaw.length).toBeGreaterThan(20);
    for (const t of mRaw) {
      for (const s of secrets) expect(t.includes(s), `괴물 원문에 계정 단서 ${s}`).toBe(false);
      expect(t, '괴물 원문').not.toMatch(/credit|account/i);
    }
    // 생존자: credit은 자기 판 · 자기 계정 기록, 계정 ID · tag는 어떤 원문에도 없다
    const rows = await srv.accounts();
    for (const [i, c] of clients.slice(1).entries()) {
      const mine = credits(c.frames.raw);
      const matchId = ratedMatchId(c.frames.raw);
      expect(mine).toHaveLength(1);
      expect(mine[0]).toMatchObject({ matchId, ok: true });
      const row = rows.find((r) => r.sub === survivors[i]!.sub);
      expect(mine[0]!.profile).toBe(row?.profile);
      for (const t of c.frames.raw)
        for (const s of secrets) expect(t.includes(s), `${c.role} 원문 ${s}`).toBe(false);
      // credit 말고는 계정 낱말이 없다
      for (const t of c.frames.raw.filter((x) => !x.startsWith('{"t":"credit"')))
        expect(t, `${c.role} 원문`).not.toMatch(/credit|account/i);
    }
    for (const c of clients) expect(issues(c), c.role).toEqual([]);
  } finally {
    for (const c of clients) await c.context.close();
    await srv.stop();
  }
});

// ───────────────────────── 9. 서비스 워커 · 오프라인 ─────────────────────────

test('서비스 워커: 로그인 · 계정 요청은 워커 캐시를 거치지 않고(캐시에도 없음), 서버를 끄고 오프라인으로 다시 열어도 첫 화면 · 봇과 연습 (계정을 읽지 못해 게스트 안내)', async ({
  browser,
}) => {
  test.setTimeout(150_000);
  const srv = await startLoginServer();
  const c = await newClient(browser);
  const seen: { path: string; fromSw: boolean; status: number }[] = [];
  c.page.on('response', (r) => {
    const path = new URL(r.url()).pathname;
    if (/^\/(api|auth|account)\//.test(path))
      seen.push({ path, fromSw: r.fromServiceWorker(), status: r.status() });
  });
  try {
    await home(c.page, srv.base);
    // 앱 셸 캐시가 찰 때까지 (m13-offline과 같다)
    await c.page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
      timeout: 20_000,
    });
    await expect
      .poll(
        () =>
          c.page.evaluate(async () => {
            const shell = (await caches.keys()).find((k) => k.startsWith('decoy-shell-'));
            if (!shell) return false;
            return (
              (await (await caches.open(shell)).match(new URL('index.html', location.href).href)) !==
              undefined
            );
          }),
        { timeout: 20_000 },
      )
      .toBe(true);
    // 워커가 맡은 화면에서 로그인 (페이지 이동이 앱 셸 · 깨우기 화면으로 바뀌지 않고 서버로 간다)
    await loginByUrl(c.page, srv.base, 'hana');
    await expectNotice(c.page, T.results.ok);
    await expectStore(c.page, 'server');
    expect(await c.page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
    // 워커가 맡은 화면에서 연 삭제 페이지도 서버가 그린 것 (앱 셸이 아니다)
    await c.page.goto(`${srv.base}/account/delete`);
    await expect(c.page.getByTestId('delete-account')).toBeVisible();
    await home(c.page, srv.base);
    await expectStore(c.page, 'server');
    const paths = seen.map((s) => s.path);
    for (const p of ['/auth/google/start', '/auth/google/callback', '/api/account', '/account/delete'])
      expect(paths, p).toContain(p);
    expect(seen.filter((s) => s.fromSw)).toEqual([]);
    // 어떤 캐시에도 계정 · 로그인 주소가 없다
    const cached = await c.page.evaluate(async () => {
      const out: string[] = [];
      for (const k of await caches.keys())
        for (const r of await (await caches.open(k)).keys()) out.push(new URL(r.url).pathname);
      return out;
    });
    expect(cached.length).toBeGreaterThan(10);
    expect(cached.filter((p) => /^\/(api|auth|account)\//.test(p))).toEqual([]);

    // 서버를 끄고 오프라인으로 다시 연다: 앱 셸 첫 화면, 계정 상태를 읽지 못해 이번 접속은 게스트 + 안내, 봇과 연습 끝까지
    await c.context.setOffline(true);
    await srv.stop();
    await c.page.reload();
    await expect(c.page.getByTestId('server-status')).toHaveAttribute('data-state', 'offline');
    await expectNotice(c.page, T.offline);
    await expectStore(c.page, 'device');
    expect(await markTag(c.page)).not.toBeNull();
    await playPractice(c.page);
    await expect(c.page.getByTestId('xp-gain')).toContainText('경험치 +');
    expect(issues(c).filter((p) => !OFFLINE_NOISE.test(p))).toEqual([]);
  } finally {
    await c.context.close();
    await srv.stop();
  }
});

// E2E 공용 도우미: 여러 브라우저 컨텍스트로 방 만들기 · 입장 · 역할 · 시작.
// M11: 기기(휴대폰 · 태블릿 가로) 프리셋, 터치 기기는 로비를 탭으로, 입력 기록(getInputLog) 모으기 · 세기
import { closeSync, openSync, readSync, statSync } from 'node:fs';
import {
  devices as playwrightDevices,
  expect,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Locator,
  type Page,
} from '@playwright/test';
import type { InputFrame, InputLogEntry, Role, Snapshot, TestCommand } from '@decoy/shared';

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
  /** 터치 기기 컨텍스트 (hasTouch). 로비 조작을 탭으로 했다 (M11) */
  touch?: boolean;
}

// ───────────── 기기 (M11) ─────────────

/**
 * 기기 옵션: Playwright `devices` 항목 또는 `{ viewport, deviceScaleFactor, isMobile, hasTouch, screen, ... }`.
 * 터치 기기는 `hasTouch: true`(이것으로 (pointer: coarse) · (hover: none)이 참이 된다), 휴대폰은 `isMobile: true`(meta viewport를 따른다)
 */
export type DeviceOptions = BrowserContextOptions;

/** Playwright 기기 항목에서 컨텍스트 옵션만 (defaultBrowserType 빼기) + 덮어쓰기 */
function device(name: string, over: DeviceOptions = {}): DeviceOptions {
  const d = playwrightDevices[name];
  if (!d) throw new Error(`Playwright 기기 없음: ${name}`);
  const { defaultBrowserType: _browser, ...options } = d;
  return { ...options, ...over };
}

/** 휴대폰 가로, 전체 화면 (Pixel 7 915×412, 배율 2.625). 판은 전체 화면으로 한다 */
export const PHONE_LANDSCAPE = device('Pixel 7 landscape', {
  viewport: { width: 915, height: 412 },
  screen: { width: 915, height: 412 },
});
/** 휴대폰 가로, 브라우저 주소 표시줄이 있는 채 (Pixel 7 863×360) */
export const PHONE_BROWSER = device('Pixel 7 landscape');
/** 좁은 휴대폰 가로 (Galaxy S9+ 658×320, 배율 4.5) */
export const PHONE_NARROW = device('Galaxy S9+ landscape');
/** 가장 낮은 휴대폰 가로 (Pixel 5 802×293 — 주소 표시줄 · 내비게이션 막대가 있는 채) */
export const PHONE_SMALL = device('Pixel 5 landscape');
/** 태블릿 가로 (Galaxy Tab S9 1024×640, 배율 2.5) */
export const TABLET_LANDSCAPE = device('Galaxy Tab S9 landscape');
/** PC 좁은 창 (마우스, 세로로 긴 창 — 세로 안내가 뜨면 안 된다) */
export const PC_NARROW: DeviceOptions = { viewport: { width: 420, height: 820 } };

/** 크기 · 배치 검사를 돌릴 가로 터치 기기 (휴대폰 4종 · 태블릿) */
export const LANDSCAPE_DEVICES: readonly { name: string; device: DeviceOptions }[] = [
  { name: 'Pixel 7 전체 화면 915×412', device: PHONE_LANDSCAPE },
  { name: 'Pixel 7 브라우저 863×360', device: PHONE_BROWSER },
  { name: 'Galaxy S9+ 658×320', device: PHONE_NARROW },
  { name: 'Pixel 5 802×293', device: PHONE_SMALL },
  { name: 'Galaxy Tab S9 1024×640', device: TABLET_LANDSCAPE },
];

/** 기능 시험용: 기기 배율 1로 덮어써 렌더 부하를 줄인다 (CSS px 크기 · 배치 · 터치 좌표는 그대로) */
export function dpr1(d: DeviceOptions): DeviceOptions {
  return { ...d, deviceScaleFactor: 1 };
}

/** 같은 기기를 세로로 돌린 것 (viewport · screen의 짧은 변이 가로) */
export function portrait(d: DeviceOptions): DeviceOptions {
  const tall = (s: { width: number; height: number }) => ({
    width: Math.min(s.width, s.height),
    height: Math.max(s.width, s.height),
  });
  return { ...d, viewport: d.viewport ? tall(d.viewport) : d.viewport, screen: d.screen && tall(d.screen) };
}

const touchContexts = new WeakSet<BrowserContext>();

/** newPlayerPage로 만든 터치 기기(hasTouch) 페이지인가 */
export function isTouchPage(page: Page): boolean {
  return touchContexts.has(page.context());
}

/** 누르기: 터치 기기 페이지는 탭(locator.tap — 손가락 터치 이벤트 → 포인터 · click), 아니면 마우스 클릭 */
export async function press(locator: Locator): Promise<void> {
  if (isTouchPage(locator.page())) await locator.tap();
  else await locator.click();
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

/**
 * 플레이어 한 명의 브라우저 컨텍스트 · 페이지. device를 주지 않으면 PC(960×540, 마우스).
 * 페이지마다 포인터 이벤트 수를 센다(pointerCounts — 탭이 정말 터치로 들어갔는지, pointercancel이 났는지)
 */
export async function newPlayerPage(
  browser: Browser,
  device?: DeviceOptions,
): Promise<{ context: BrowserContext; page: Page; problems: string[]; touch: boolean }> {
  const context = await browser.newContext({ viewport: { width: 960, height: 540 }, ...device });
  const touch = device?.hasTouch === true;
  if (touch) touchContexts.add(context);
  await context.addInitScript(countPointerEvents);
  const page = await context.newPage();
  const problems: string[] = [];
  watchConsole(page, problems);
  return { context, page, problems, touch };
}

/** 페이지 안: 포인터 이벤트를 '종류:pointerType'별로 센다 (창 캡처 단계라 앱이 전파를 막아도 센다) */
function countPointerEvents(): void {
  const counts: Record<string, number> = {};
  (window as unknown as { __e2ePointerCounts: Record<string, number> }).__e2ePointerCounts = counts;
  for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) {
    window.addEventListener(
      type,
      (e) => {
        const key = `${type}:${(e as PointerEvent).pointerType}`;
        counts[key] = (counts[key] ?? 0) + 1;
      },
      { capture: true, passive: true },
    );
  }
}

/** 이 문서를 연 뒤 포인터 이벤트 수 (예: { 'pointerdown:touch': 3, 'pointercancel:touch': 0 }). newPlayerPage 페이지만 */
export async function pointerCounts(page: Page): Promise<Record<string, number>> {
  return page.evaluate(() => ({
    ...(window as unknown as { __e2ePointerCounts?: Record<string, number> }).__e2ePointerCounts,
  }));
}

export async function createRoom(page: Page, query = ''): Promise<string> {
  await page.goto(`/?${BASE_QUERY.slice(1)}${query}`);
  await press(page.getByTestId('create-room'));
  const code = page.getByTestId('room-code');
  await expect(code).toHaveText(/^[A-Z]{4}$/);
  return (await code.textContent()) ?? '';
}

export async function joinRoom(page: Page, code: string, query = ''): Promise<void> {
  await page.goto(`/?room=${code}${BASE_QUERY}${query}`);
  await expect(page.getByTestId('room-code')).toHaveText(code);
}

/** 역할을 고르고 준비한다. 터치 기기 페이지는 탭으로 */
export async function pickRoleAndReady(page: Page, role: Role): Promise<void> {
  await press(page.getByTestId(`role-${role}`));
  await expect(page.getByTestId(`role-${role}`)).toHaveClass(/mine/);
  await press(page.getByTestId('ready-button'));
  await expect(page.getByTestId('ready-button')).toHaveText('준비 취소');
}

export async function myId(page: Page): Promise<string> {
  return page.evaluate(() => window.__DECOY__?.you ?? '');
}

/**
 * 4명이 방에 들어가 역할을 고르고 시작한다. 첫 번째가 방장.
 * devices[i]로 플레이어마다 기기를 정한다(없으면 PC). 터치 기기는 방 만들기 · 역할 · 준비 · 시작을 탭으로 한다
 */
export async function startFourPlayerMatch(
  browser: Browser,
  roles: Role[] = ['monster', 'runner', 'guard', 'scout'],
  queries: string[] = ['', '', '', ''],
  devices: readonly (DeviceOptions | undefined)[] = [],
): Promise<{ code: string; players: Player[] }> {
  const players: Player[] = [];
  const first = await newPlayerPage(browser, devices[0]);
  const code = await createRoom(first.page, queries[0] ?? '');
  players.push({ ...first, role: roles[0] ?? 'monster', id: await myId(first.page) });
  for (let i = 1; i < roles.length; i += 1) {
    const p = await newPlayerPage(browser, devices[i]);
    await joinRoom(p.page, code, queries[i] ?? '');
    players.push({ ...p, role: roles[i] ?? 'runner', id: await myId(p.page) });
  }
  for (const p of players) await pickRoleAndReady(p.page, p.role);
  const host = players[0];
  if (!host) throw new Error('방장이 없습니다');
  await expect(host.page.getByTestId('start-button')).toBeEnabled();
  await press(host.page.getByTestId('start-button'));
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

/** 서버 정답 기록 (playwright.config.ts의 TRUTH_LOG, 저장소 루트 기준). 서버가 틱마다 한 줄씩 덧붙인다 */
const TRUTH_LOG_PATH = 'tests/e2e/.results/truth.jsonl';

/** 정답 기록의 지금 크기 (바이트). 어떤 일 직전에 재 두고 truthSince로 그 뒤 틱만 읽는다 */
export function truthLogSize(): number {
  return statSync(TRUTH_LOG_PATH).size;
}

/**
 * 정답 기록에서 offset 바이트 뒤에 쓰인 이 방의 틱들 (쓰는 중인 마지막 줄은 건너뛴다).
 * 시간이 걸리는 서버 상태 변화(전환 · 준비 등)를 고정 대기 뒤 한 번 읽지 않고 틱 단위로 확인한다(느린 러너에서도 같은 결과)
 */
export function truthSince(offset: number, room: string): TruthFrame[] {
  const size = truthLogSize();
  if (size <= offset) return [];
  const buf = Buffer.alloc(size - offset);
  const fd = openSync(TRUTH_LOG_PATH, 'r');
  try {
    readSync(fd, buf, 0, buf.length, offset);
  } finally {
    closeSync(fd);
  }
  const out: TruthFrame[] = [];
  for (const line of buf.toString('utf8').split('\n')) {
    if (!line.includes(`"room":"${room}"`)) continue;
    try {
      out.push(JSON.parse(line) as TruthFrame);
    } catch {
      // 아직 다 쓰지 않은 줄
    }
  }
  return out;
}

export async function closeAll(players: Player[]): Promise<void> {
  for (const p of players) await p.context.close();
}

// ───────────── 입력 기록 (M11) ─────────────

/** 최근 입력 프레임 (최대 120개 = 4초, 오래된 것부터). 판 장면이 없으면 빈 배열 */
export async function inputLog(page: Page): Promise<InputLogEntry[]> {
  return page.evaluate(() => window.__DECOY__?.getInputLog() ?? []);
}

/** pressed에 bit(BTN)가 켜진 프레임 수. pressed는 한 프레임만 살아서 이것이 누른 횟수다 */
export function countPressed(frames: readonly InputFrame[], bit: number): number {
  return frames.filter((f) => (f.pressed & bit) !== 0).length;
}

/** held에 bit가 켜진 프레임 수 */
export function countHeld(frames: readonly InputFrame[], bit: number): number {
  return frames.filter((f) => (f.held & bit) !== 0).length;
}

export interface InputRecorder {
  /** 지금까지 모은 프레임 (한 번 더 읽고 돌려준다, 오래된 것부터) */
  entries(): Promise<InputLogEntry[]>;
  /** 모으기를 멈추고 모은 프레임을 돌려준다 (그 뒤 entries()는 같은 목록) */
  stop(): Promise<InputLogEntry[]>;
}

interface InPageRecorder {
  timer: number;
  stopped: boolean;
  list: InputLogEntry[];
  pull: () => void;
}

/**
 * 입력 기록기: **시작한 뒤** 만든 입력 프레임을 빠짐없이 모은다. 링 버퍼(120개 = 4초)보다 긴 시험이나
 * "ATTACK이 정확히 1번"처럼 세는 시험에 쓴다. 페이지 안 타이머(pollMs)로 getInputLog()를 읽어
 * (시각 t, seq) 순서로 새 것만 붙인다(새 판에서 seq가 다시 시작해도 t는 계속 는다). 페이지를 다시 불러오면 기록기가 사라진다
 */
export async function recordInputs(page: Page, pollMs = 150): Promise<InputRecorder> {
  await page.evaluate((ms) => {
    const w = window as unknown as { __e2eInputRec?: InPageRecorder };
    if (w.__e2eInputRec) window.clearInterval(w.__e2eInputRec.timer);
    const start = window.__DECOY__?.getInputLog() ?? [];
    let lastT = start.at(-1)?.t ?? -Infinity;
    let lastSeq = start.at(-1)?.seq ?? -Infinity;
    const rec: InPageRecorder = { timer: 0, stopped: false, list: [], pull: () => {} };
    rec.pull = () => {
      for (const e of window.__DECOY__?.getInputLog() ?? []) {
        if (e.t < lastT || (e.t === lastT && e.seq <= lastSeq)) continue;
        rec.list.push(e);
        lastT = e.t;
        lastSeq = e.seq;
      }
    };
    rec.timer = window.setInterval(rec.pull, ms);
    w.__e2eInputRec = rec;
  }, pollMs);
  const read = (stop: boolean) =>
    page.evaluate((s) => {
      const rec = (window as unknown as { __e2eInputRec?: InPageRecorder }).__e2eInputRec;
      if (!rec) throw new Error('입력 기록기 없음 (페이지를 다시 불러왔다)');
      if (rec.stopped) return rec.list.slice();
      rec.pull();
      if (s) {
        window.clearInterval(rec.timer);
        rec.stopped = true;
      }
      return rec.list.slice();
    }, stop);
  return { entries: () => read(false), stop: () => read(true) };
}

/** 따라가는 카메라와 무관한 픽셀 · 조준 시험: 맵 전체 고정 화면(확대 1, 로컬 주소에서만 받는다) */
export const CAM1 = '&cam=1';

/**
 * 괴물 탭에서 마우스로 (x, y) 타일을 조준하고, 서버가 받은 조준(내 괴물 face)이 그 방향이 될 때까지 확인한다.
 * 조준 붙잡기(client/src/aimHold.ts)는 커서가 움직일 때만 그려진 괴물 → 커서 방향을 다시 잰다: 순간 이동 직후 그려진 괴물이
 * 아직 따라오는 중에 커서를 옮기면 틀린 방향이 붙잡힌다. 그러면 1px 비켰다 돌아와 다시 재게 한다. 괴물이 아니면 확인하지 않는다.
 * 끝나면 앞당김으로 다시 움직인 창이 멈출 때까지 기다린다
 */
export async function aimMonsterAt(page: Page, x: number, y: number): Promise<void> {
  await page.evaluate(() => window.__DECOY__?.setCameraShake(0));
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await waitCamera(page);
    const c = await page.evaluate(([tx, ty]) => window.__DECOY__?.tileToClient(tx!, ty!) ?? null, [x, y]);
    if (!c) throw new Error('tileToClient 없음');
    await page.mouse.move(c.x + 1, c.y);
    await page.mouse.move(c.x, c.y);
    const ok = await page
      .waitForFunction(
        ([tx, ty]) => {
          const s = window.__DECOY__?.getLastSnapshot();
          if (!s || s.you.role !== 'monster') return true;
          const m = s.you.move;
          let d = m.face - Math.atan2(ty! - m.y, tx! - m.x);
          while (d > Math.PI) d -= 2 * Math.PI;
          while (d < -Math.PI) d += 2 * Math.PI;
          return Math.abs(d) < 0.02;
        },
        [x, y],
        { timeout: 3000 },
      )
      .then(
        () => true,
        () => false,
      );
    if (ok) {
      // 조준이 바뀌면 괴물 앞당김으로 창이 다시 움직인다: 멈출 때까지 (화면 비네트 · 표본 자리가 측정 사이에 같게)
      await waitCamera(page);
      return;
    }
  }
  throw new Error(`괴물 조준을 (${x}, ${y})로 맞추지 못했다`);
}

/**
 * 따라가는 카메라가 자리 잡을 때까지: 그린 프레임 세 장 사이에 창이 그대로고 어두워짐 · 흔들림이 없다 (순간 이동 뒤 화면 좌표를
 * 읽기 전에). 시간 간격이 아니라 프레임으로 잰다: 확대 화면의 소프트웨어 렌더러(SwiftShader)는 프레임이 약 250ms라, 120ms
 * 간격으로 두 번 읽으면 같은 프레임을 두 번 읽어 아직 움직이는 창을 멈췄다고 본다
 */
export async function waitCamera(page: Page, timeout = 15_000): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const read = (): string | null => {
            const c = window.__DECOY__?.getCamera() ?? null;
            return c && c.dip === 0 && c.shakes === 0 ? `${c.view.x},${c.view.y}` : null;
          };
          const a = read();
          for (let i = 0; i < 3; i += 1) await new Promise<void>((r) => requestAnimationFrame(() => r()));
          const b = read();
          return a !== null && a === b;
        }),
      { intervals: [50], timeout },
    )
    .toBe(true);
}

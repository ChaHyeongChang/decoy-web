// 화면 확대 막기 · 감지 · 복구 (플레이테스트 a-1, client/src/zoomGuard.ts · ui/zoomNotice.ts · style.css)
// 아이폰은 viewport의 user-scalable=no를 무시한다. Chromium은 그 잠금을 지키고 전체 화면 중에는 배율을 1로 묶어서 그대로는
// 어디를 핀치해도 확대되지 않는다 → 아이폰 흉내(iosLike)를 건다: viewport meta를 **파싱 때** 연 값으로 바꾸고(불러온 뒤에 바꾸면
// 잠금이 풀리지 않는다. 응답을 route.fulfill로 바꾸면 그 문서의 서버 WebSocket이 막힌다), 전체 화면 API를 없애고, 아이폰 14 가로의
// 안전 영역(좌우 47 · 아래 21)을 준다. 기기는 844×340(주소창이 있는 가로).
//  ① 띠 핀치: 고치기 전에는 두 손가락이 모두 안전 영역 띠(body)에 닿으면 5배까지 확대됐다 → 배율 1
//  ② 구멍 훑기: 화면 격자의 점마다 실효 touch-action을 셈해 확대가 허용되는 점 0 (고치기 전 판 중 1,412점)
//  ③ 감지 · 복구: 배율 2(CDP) → 안내가 보이는 화면 안 · 조작 멈춤 → 안내 위에서 오므리면 1 → 안내 닫힘 · 다시 막음
//  ④ 방어가 스크롤 · 버튼 · 스틱을 깨지 않는다
// 자동으로 못 보는 것(실기기 HUMAN_CHECKS): 두 번 탭 확대(Chromium 흉내에서는 나지 않는다) · gesture* 이벤트(WebKit에만 있다) ·
// 아이폰의 실제 touch-action 해석과 핀치
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type CDPSession,
  type Page,
} from '@playwright/test';
import { TOUCH_TEXT, UI_TEXT } from '../../client/src/data/storyText';
import {
  PHONE_LANDSCAPE,
  dpr1,
  newPlayerPage,
  pointerCounts,
  press,
  recordInputs,
  waitForSnapshots,
  type DeviceOptions,
} from './helpers';
import { MultiTouch, centerOf, emulateSafeArea, touchTargets, waitForTouchTarget } from './touch';

/** 아이폰 14 가로 · 주소창이 있는 채 (CSS px). 화면 자체는 844×390 */
const IPHONE: DeviceOptions = {
  ...dpr1(PHONE_LANDSCAPE),
  viewport: { width: 844, height: 340 },
  screen: { width: 844, height: 390 },
};
const W = 844;
const H = 340;
/** 아이폰 14 가로의 안전 영역 (노치 쪽 · 반대쪽 · 홈 막대) */
const SAFE = { left: 47, right: 47, bottom: 21 };
const OPEN_META = 'width=device-width, initial-scale=1, viewport-fit=cover';
const QUERY = '/?bots=1&debug=hook&renderer=canvas&quality=low';
const POLL = { intervals: [50, 100, 200], timeout: 15_000 };

/** 페이지 안(문서를 만들 때마다): 아이폰처럼 — 확대 잠금 없음 · 전체 화면 API 없음 */
function iosLike(openMeta: string): void {
  new MutationObserver((_list, obs) => {
    const m = document.querySelector('meta[name="viewport"]');
    if (!m) return;
    m.setAttribute('content', openMeta);
    obs.disconnect();
  }).observe(document, { childList: true, subtree: true });
  Object.defineProperty(Document.prototype, 'fullscreenEnabled', { get: () => false });
  delete (Element.prototype as { requestFullscreen?: unknown }).requestFullscreen;
  // click을 누르는 것(button) 위 · 밖으로 나눠 세고, 손가락을 뗀 시각을 적는다 (창 캡처 단계: 앱이 전파를 막아도 센다)
  const clicks = { control: 0, plain: 0, ends: [] as number[] };
  (window as unknown as { __e2eClicks: typeof clicks }).__e2eClicks = clicks;
  window.addEventListener('touchend', (e) => clicks.ends.push(e.timeStamp), { capture: true, passive: true });
  window.addEventListener(
    'click',
    (e) => {
      const t = e.target instanceof Element ? e.target : null;
      clicks[t?.closest('button, a, input, select, textarea, label') ? 'control' : 'plain'] += 1;
    },
    true,
  );
}

interface Session {
  context: BrowserContext;
  page: Page;
  problems: string[];
  cdp: CDPSession;
  touch: MultiTouch;
}

async function openIphone(browser: Browser, extraQuery = ''): Promise<Session> {
  const { context, page, problems } = await newPlayerPage(browser, IPHONE);
  await context.addInitScript(iosLike, OPEN_META);
  await emulateSafeArea(page, SAFE);
  await page.goto(`${QUERY}${extraQuery}`);
  await expect(page.getByTestId('create-room')).toBeVisible();
  // 흉내가 걸렸는지: 연 meta · 터치 모드 · 전체 화면 버튼 없음 · 안전 영역
  const env = await page.evaluate(() => ({
    meta: document.querySelector('meta[name="viewport"]')?.getAttribute('content'),
    touch: document.documentElement.classList.contains('touch'),
    fs: document.fullscreenEnabled,
    gameLeft: document.getElementById('game-root')?.getBoundingClientRect().left,
    scale: window.visualViewport?.scale,
  }));
  expect(env).toEqual({ meta: OPEN_META, touch: true, fs: false, gameLeft: SAFE.left, scale: 1 });
  const cdp = await context.newCDPSession(page);
  return { context, page, problems, cdp, touch: await MultiTouch.attach(page) };
}

/** 혼자 봇 방에서 러너로 판을 시작한다 (터치 화면이 뜰 때까지) */
async function startMatch(page: Page): Promise<void> {
  await press(page.getByTestId('create-room'));
  await press(page.getByTestId('role-runner'));
  await press(page.getByTestId('ready-button'));
  const ok = page.getByTestId('touch-tutorial-ok');
  if (await ok.isVisible()) await press(ok);
  await press(page.getByTestId('start-button'));
  await waitForSnapshots(page, 3);
  await waitForTouchTarget(page, 'move-zone');
}

/** 그린 프레임 세 장 뒤의 배율 (핀치가 먹었다면 그 안에 반영된다) */
async function scaleNow(page: Page): Promise<number> {
  return page.evaluate(async () => {
    for (let i = 0; i < 3; i += 1) await new Promise<void>((r) => requestAnimationFrame(() => r()));
    return window.visualViewport?.scale ?? 1;
  });
}

/** 세로로 벌리는 핀치 (왼쪽 · 오른쪽 띠처럼 좁고 긴 곳) */
async function pinchVertical(t: MultiTouch, x: number, cy: number, from: number, to: number): Promise<void> {
  await t.down(111, x, cy - from / 2);
  await t.down(112, x, cy + from / 2);
  await t.moveMany(
    [
      { id: 111, x, y: cy - to / 2 },
      { id: 112, x, y: cy + to / 2 },
    ],
    { steps: 10, stepMs: 16 },
  );
  await t.up(111);
  await t.up(112);
}

/**
 * 안전 영역 띠 핀치 네 가지 — 고치기 전에는 모두 body(touch-action: auto)에 닿아 확대됐다:
 * 아래 띠(가로로 벌림) · 왼쪽 띠(세로로 벌림) · 오른쪽 띠(세로로 벌림) · 왼쪽 띠 + 오른쪽 띠(양 엄지를 좌우 끝에 걸침)
 */
async function pinchBands(s: Session, where: string): Promise<void> {
  const { page, touch } = s;
  await touch.pinch(W / 2, H - 6, 80, 260, { steps: 10, stepMs: 16 });
  expect(await scaleNow(page), `${where}: 아래 띠`).toBe(1);
  await pinchVertical(touch, 20, H / 2, 50, 280);
  expect(await scaleNow(page), `${where}: 왼쪽 띠`).toBe(1);
  await pinchVertical(touch, W - 20, H / 2, 50, 280);
  expect(await scaleNow(page), `${where}: 오른쪽 띠`).toBe(1);
  await touch.down(121, 20, 100);
  await touch.down(122, W - 20, 240);
  await touch.moveMany(
    [
      { id: 121, x: 30, y: 250 },
      { id: 122, x: W - 30, y: 90 },
    ],
    { steps: 10, stepMs: 16 },
  );
  await touch.up(121);
  await touch.up(122);
  expect(await scaleNow(page), `${where}: 왼쪽 + 오른쪽 띠`).toBe(1);
}

/** 한 손가락으로 끈다 (스크롤) */
async function drag(t: MultiTouch, x: number, y0: number, y1: number): Promise<void> {
  await t.down(131, x, y0);
  await t.move(131, x, y1, { steps: 10, stepMs: 16 });
  await t.up(131);
}

interface Holes {
  points: number;
  /** 확대(pinch-zoom)가 허용되는 점 수: 요소 이름표 → 점 수 */
  blink: Record<string, number>;
  webkit: Record<string, number>;
  /** 보이는 스크롤 컨테이너에서 세로 끌기가 허용되는가 (두 규칙 모두) */
  scroll: Record<string, boolean>;
}

/**
 * 페이지 안: step px 격자의 점마다 그 자리 요소의 실효 touch-action을 조상에서 셈한다.
 *  - blink: 조상 값의 교집합. 스크롤 컨테이너(overflow가 visible이 아님)는 끌기만 되살린다 (확대 금지는 이어받는다)
 *  - webkit: 스크롤 컨테이너(overflow auto · scroll)에서 실효값을 auto로 되돌린 뒤 자기 값만 적용한다(추정 — 그렇다면 컨테이너가
 *    자기 값을 적지 않은 곳이 구멍이 된다. 그래서 컨테이너마다 pan-y를 적었다)
 */
function scanHoles(step: number): Holes {
  interface Eff {
    py: boolean;
    pz: boolean;
  }
  const parse = (v: string): Eff => {
    if (v === 'auto' || v === 'manipulation') return { py: true, pz: true };
    if (v === 'none') return { py: false, pz: false };
    const t = v.split(/\s+/);
    return { py: t.includes('pan-y'), pz: t.includes('pinch-zoom') };
  };
  const and = (a: Eff, b: Eff): Eff => ({ py: a.py && b.py, pz: a.pz && b.pz });
  const scrolls = (cs: CSSStyleDeclaration, anyClip: boolean): boolean => {
    const s = (o: string): boolean => o === 'auto' || o === 'scroll' || (anyClip && o !== 'visible');
    return s(cs.overflowX) || s(cs.overflowY);
  };
  const eff = (el: Element, model: 'blink' | 'webkit'): Eff => {
    const chain: Element[] = [];
    for (let e: Element | null = el; e; e = e.parentElement) chain.unshift(e);
    let cur: Eff = { py: true, pz: true };
    for (const e of chain) {
      const cs = getComputedStyle(e);
      const own = parse(cs.touchAction);
      if (model === 'blink') cur = and(own, scrolls(cs, true) ? { ...cur, py: true } : cur);
      else cur = and(own, scrolls(cs, false) ? { py: true, pz: true } : cur);
    }
    return cur;
  };
  const label = (el: Element): string => {
    const parts: string[] = [];
    for (let e: Element | null = el, i = 0; e && i < 2; e = e.parentElement, i += 1) {
      const cls =
        typeof e.className === 'string' && e.className ? `.${e.className.trim().split(/\s+/)[0]}` : '';
      parts.push(`${e.tagName.toLowerCase()}${e.id ? `#${e.id}` : ''}${cls}`);
    }
    return parts.join(' < ');
  };
  const out: Holes = { points: 0, blink: {}, webkit: {}, scroll: {} };
  for (let y = step / 2; y < window.innerHeight; y += step)
    for (let x = step / 2; x < window.innerWidth; x += step) {
      const el = document.elementFromPoint(x, y);
      if (!el) continue;
      out.points += 1;
      for (const m of ['blink', 'webkit'] as const)
        if (eff(el, m).pz) out[m][label(el)] = (out[m][label(el)] ?? 0) + 1;
    }
  for (const sel of ['.lobby', '.set-body', '.set-tabs', '.life-tutorial', '.hub-card']) {
    const el = document.querySelector<HTMLElement>(sel);
    if (!el || !el.checkVisibility()) continue;
    out.scroll[sel] = eff(el, 'blink').py && eff(el, 'webkit').py;
  }
  return out;
}

/** 격자 간격 (CSS px). 844×340에서 8,037점 */
const GRID = 6;

async function expectNoHoles(page: Page, where: string, scrollers: string[]): Promise<void> {
  const h = await page.evaluate(scanHoles, GRID);
  // 화면 전체를 훑었다 (빈 통과 방지): 141 × 57 = 8,037점
  expect(h.points, `${where}: 훑은 점 수`).toBe(Math.ceil(W / GRID) * Math.ceil(H / GRID));
  expect(h.blink, `${where}: 확대가 허용되는 점 (Blink 규칙)`).toEqual({});
  expect(h.webkit, `${where}: 확대가 허용되는 점 (스크롤 컨테이너에서 다시 셈하는 규칙)`).toEqual({});
  expect(h.scroll, `${where}: 스크롤 컨테이너의 세로 끌기`).toEqual(
    Object.fromEntries(scrollers.map((s) => [s, true])),
  );
}

interface TapState {
  control: number;
  plain: number;
  /** touchend 시각들 (ms) */
  ends: number[];
}

async function clickCounts(page: Page): Promise<TapState> {
  return page.evaluate(() => {
    const c = (window as unknown as { __e2eClicks: TapState }).__e2eClicks;
    return { control: c.control, plain: c.plain, ends: [...c.ends] };
  });
}

/**
 * 누르는 것 밖의 자리 (x, y)를 빠르게 두 번 탭하고, 그 두 탭이 낸 click 수를 돌려준다.
 * 두 탭 뒤에 시험용 버튼(표지)을 한 번 더 누른다: 이벤트는 순서대로 오므로 표지의 click이 왔으면 앞 두 탭의 click은 이미 다 왔다
 * (없는 click을 기다릴 수는 없다). 느린 러너에서 두 탭 사이가 벌어져 두 번 탭 창(300ms) 밖이었으면 다시 한다
 */
async function quickDoubleTap(page: Page, touch: MultiTouch, x: number, y: number): Promise<number> {
  await page.evaluate(() => {
    const b = document.createElement('button');
    b.id = 'e2e-marker';
    b.style.cssText = 'position:fixed;left:60px;top:4px;width:48px;height:48px;z-index:99;opacity:0.01';
    document.body.append(b);
  });
  try {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const before = await clickCounts(page);
      await touch.tap(141, x, y, 30);
      await touch.tap(141, x + 4, y + 2, 30);
      await touch.tap(141, 84, 28, 30);
      await expect.poll(async () => (await clickCounts(page)).control - before.control, POLL).toBe(1);
      const after = await clickCounts(page);
      const ends = after.ends.slice(before.ends.length);
      if (ends.length >= 2 && ends[1]! - ends[0]! < 250) return after.plain - before.plain;
      // 앞 탭과 이어지지 않게 두 번 탭 창보다 길게 쉰 뒤 다시 누른다
      await page.waitForTimeout(400);
    }
    throw new Error('두 탭을 250ms 안에 넣지 못했다 (러너가 너무 느리다)');
  } finally {
    await page.evaluate(() => document.getElementById('e2e-marker')?.remove());
  }
}

test('로비: 안전 영역 띠를 핀치해도 확대되지 않고, 손가락 스크롤 · 버튼 연타는 그대로, 누르는 것 밖의 빠른 두 번째 탭만 막힌다', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const s = await openIphone(browser);
  const { page, touch } = s;

  // ① 띠 핀치 (고치기 전: 5배)
  await pinchBands(s, '첫 화면');
  const css = await page.evaluate(() => ({
    html: getComputedStyle(document.documentElement).touchAction,
    body: getComputedStyle(document.body).touchAction,
    lobby: getComputedStyle(document.querySelector('.lobby')!).touchAction,
    button: getComputedStyle(document.querySelector('[data-testid="create-room"]')!).touchAction,
  }));
  expect(css).toEqual({ html: 'none', body: 'none', lobby: 'pan-y', button: 'manipulation' });

  // ④ 누르는 것 밖(로고 글자)의 빠른 두 번 탭: 두 번째 탭의 click은 사라진다 (두 번 탭 확대 막기 — 고치기 전에는 click 2번)
  const mark = await page.locator('.wordmark').first().boundingBox();
  if (!mark) throw new Error('로고 글자 없음');
  const mx = mark.x + mark.width / 2;
  const my = mark.y + mark.height / 2;
  expect(await quickDoubleTap(page, touch, mx, my)).toBe(1);
  // 누르는 것(설정 화면의 탭)은 빠르게 두 번 눌러도 click이 두 번 다 간다
  await press(page.getByTestId('settings-button').first());
  await expect(page.getByTestId('settings-panel')).toBeVisible();
  const tab = await page.getByTestId('settings-tab-controls').boundingBox();
  if (!tab) throw new Error('조작 탭 없음');
  const c1 = await clickCounts(page);
  await touch.tap(141, tab.x + tab.width / 2, tab.y + tab.height / 2, 30);
  await touch.tap(141, tab.x + tab.width / 2 + 3, tab.y + tab.height / 2, 30);
  await expect.poll(async () => (await clickCounts(page)).control - c1.control, POLL).toBe(2);
  await expect(page.getByTestId('settings-tab-controls')).toHaveAttribute('aria-selected', 'true');

  // ④ 설정 본문(조작 탭은 줄이 많아 넘친다): 한 손가락으로 끌면 스크롤된다
  const body = await page.evaluate(() => {
    const b = document.querySelector<HTMLElement>('.set-body')!;
    const r = b.getBoundingClientRect();
    return {
      max: b.scrollHeight - b.clientHeight,
      x: r.left + r.width / 2,
      y0: r.top + r.height * 0.85,
      y1: r.top + r.height * 0.15,
      touchAction: getComputedStyle(b).touchAction,
    };
  });
  expect(body.max).toBeGreaterThan(40);
  expect(body.touchAction).toBe('pan-y');
  await drag(touch, body.x, body.y0, body.y1);
  await expect
    .poll(() => page.evaluate(() => document.querySelector('.set-body')!.scrollTop), POLL)
    .toBeGreaterThan(40);
  // 설정 화면 안에서 두 손가락을 벌려도 확대되지 않는다
  await touch.pinch(body.x, (body.y0 + body.y1) / 2, 60, 260, { steps: 10, stepMs: 16 });
  expect(await scaleNow(page)).toBe(1);
  await press(page.getByTestId('settings-close'));
  await expect(page.getByTestId('settings-panel')).toBeHidden();

  // ④ 방 화면: 로비 세로 스크롤 + 띠 핀치, 초대 링크 입력 칸 16px (작으면 아이폰이 포커스할 때 확대한다 — 고치기 전 13px)
  await press(page.getByTestId('create-room'));
  await expect(page.getByTestId('room-code')).toHaveText(/^[A-Z]{4}$/);
  const lobby = await page.evaluate(() => {
    const l = document.querySelector<HTMLElement>('.lobby')!;
    return { max: l.scrollHeight - l.clientHeight, top: l.scrollTop };
  });
  expect(lobby.max).toBeGreaterThan(40);
  await drag(touch, W / 2, H * 0.8, H * 0.2);
  await expect
    .poll(() => page.evaluate(() => document.querySelector('.lobby')!.scrollTop), POLL)
    .toBeGreaterThan(lobby.top + 40);
  expect(
    await page.evaluate(() =>
      Number.parseFloat(getComputedStyle(document.querySelector('[data-testid="room-link"]')!).fontSize),
    ),
  ).toBeGreaterThanOrEqual(16);
  await pinchBands(s, '방 화면');

  expect((await pointerCounts(page))['pointercancel:touch'] ?? 0).toBeGreaterThan(0); // 스크롤이 손가락을 가져갔다(끌기가 브라우저 스크롤이었다)
  expect(s.problems).toEqual([]);
  await touch.detach();
  await s.context.close();
});

test('구멍 훑기(로비): 첫 화면 · 설정 · 방 화면 · 판 직전 안내 어디에도 확대가 허용되는 점이 없고 스크롤 컨테이너는 세로 끌기가 된다', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const s = await openIphone(browser);
  const { page } = s;
  // 고치기 전: body(띠) 1,412점
  await expectNoHoles(page, '첫 화면', ['.lobby']);
  await press(page.getByTestId('settings-button').first());
  await expect(page.getByTestId('settings-panel')).toBeVisible();
  for (const tab of ['graphics', 'screen', 'sound', 'controls']) {
    await press(page.getByTestId(`settings-tab-${tab}`));
    await expect(page.getByTestId(`settings-tab-${tab}`)).toHaveAttribute('aria-selected', 'true');
    await expectNoHoles(page, `설정 ${tab}`, ['.lobby', '.set-body', '.set-tabs']);
  }
  await press(page.getByTestId('settings-close'));
  await expect(page.getByTestId('settings-panel')).toBeHidden();
  await press(page.getByTestId('create-room'));
  await expect(page.getByTestId('room-code')).toHaveText(/^[A-Z]{4}$/);
  await expectNoHoles(page, '방 화면', ['.lobby']);
  // 판 직전 터치 안내 카드(스크롤 컨테이너)가 뜬 방 화면
  await press(page.getByTestId('role-runner'));
  await press(page.getByTestId('ready-button'));
  await expect(page.getByTestId('touch-tutorial')).toBeVisible();
  await expectNoHoles(page, '판 직전 안내', ['.lobby', '.life-tutorial']);
  expect(s.problems).toEqual([]);
  await s.touch.detach();
  await s.context.close();
});

test('판 중: 띠 핀치 · 이동 스틱을 누른 채 띠를 문질러도 확대되지 않고 조작은 그대로다. 판 중 · 판 중 설정에도 구멍이 없다', async ({
  browser,
}) => {
  test.setTimeout(150_000);
  const s = await openIphone(browser);
  const { page, touch } = s;
  await startMatch(page);
  // 아이폰에는 전체 화면 API가 없다: 전체 화면이면 Chromium이 배율을 1로 묶어 이 시험이 헛돈다
  expect(await page.evaluate(() => document.fullscreenElement === null)).toBe(true);

  // ① 띠 핀치 (고치기 전: 아래 띠 · 왼쪽 띠 5배)
  await pinchBands(s, '판 중');
  // ② 구멍 훑기 (고치기 전: body 1,412점)
  await expectNoHoles(page, '판 중', []);

  // ④ 이동 스틱을 누르고 끈 채 다른 손가락으로 아래 띠를 문지르고, 띠 두 곳을 벌린다: 확대되지 않고 이동 입력은 이어진다
  const zone = await waitForTouchTarget(page, 'move-zone');
  const zc = centerOf(zone);
  const rec = await recordInputs(page, 100);
  await touch.down(1, zc.x, zc.y);
  await touch.move(1, zc.x + 50, zc.y, { steps: 5, stepMs: 20 });
  await touch.down(2, W - 120, H - 5);
  await touch.move(2, W - 300, H - 8, { steps: 8, stepMs: 16 });
  await touch.up(2);
  await touch.pinch(W / 2 + 120, H - 6, 60, 240, { steps: 10, stepMs: 16 });
  expect(await scaleNow(page)).toBe(1);
  // 스틱 손가락은 그대로 살아 있다: 지금부터 만든 입력 프레임도 오른쪽으로 간다
  const seq0 = await page.evaluate(() => window.__DECOY__?.getLastInput()?.seq ?? 0);
  await expect
    .poll(async () => {
      const f = await page.evaluate(() => window.__DECOY__?.getLastInput() ?? null);
      return f !== null && f.seq > seq0 + 3 && f.mx > 0.5;
    }, POLL)
    .toBe(true);
  await touch.up(1);
  const frames = await rec.stop();
  expect(frames.filter((f) => f.mx > 0.5).length).toBeGreaterThan(5);
  // 방어 리스너(두 손가락 touchstart · touchmove 막기)가 포인터 이벤트를 끊지 않았다
  expect((await pointerCounts(page))['pointercancel:touch'] ?? 0).toBe(0);

  // 판 중 설정: 구멍 없음, 창 안에서 벌려도 확대되지 않는다
  const menu = await waitForTouchTarget(page, 'menu');
  await page.touchscreen.tap(menu.x + menu.w / 2, menu.y + menu.h / 2);
  await expect(page.getByTestId('settings-panel')).toBeVisible();
  for (const tab of ['graphics', 'screen', 'sound']) {
    await press(page.getByTestId(`settings-tab-${tab}`));
    await expect(page.getByTestId(`settings-tab-${tab}`)).toHaveAttribute('aria-selected', 'true');
    await expectNoHoles(page, `판 중 설정 ${tab}`, ['.set-body', '.set-tabs']);
  }
  const card = await page.getByTestId('settings-panel').boundingBox();
  if (!card) throw new Error('설정 화면 없음');
  await touch.pinch(card.x + card.width * 0.6, card.y + card.height * 0.6, 60, 240, {
    steps: 10,
    stepMs: 16,
  });
  expect(await scaleNow(page)).toBe(1);
  // (카드 밖 막을 누르면 설정 화면이 닫힌다 — 띠 핀치는 카드가 닫힌 판 화면에서 위에서 봤다)
  await expect(page.getByTestId('settings-panel')).toBeVisible();
  await press(page.getByTestId('settings-close'));
  await expect(page.getByTestId('settings-panel')).toBeHidden();

  expect(s.problems).toEqual([]);
  await touch.detach();
  await s.context.close();
});

interface NoticeState {
  scale: number;
  zoomedClass: boolean;
  bodyTouch: string;
  noticeShown: boolean;
  /** 안내 카드가 보이는 화면(visualViewport) 안에 다 들어오는가 */
  cardInside: boolean | null;
  /** 화면에 보이는 카드 크기 (배치 px × 배율 = 확대 전 CSS px) */
  cardOnScreen: { w: number; h: number } | null;
  view: { left: number; top: number };
}

async function noticeState(page: Page): Promise<NoticeState> {
  return page.evaluate(() => {
    const v = window.visualViewport!;
    const notice = document.querySelector<HTMLElement>('[data-testid="zoom-notice"]');
    const r = document.querySelector('.zoom-card')?.getBoundingClientRect() ?? null;
    const EPS = 0.5;
    return {
      scale: Math.round(v.scale * 1000) / 1000,
      zoomedClass: document.documentElement.classList.contains('zoomed'),
      bodyTouch: getComputedStyle(document.body).touchAction,
      noticeShown: notice !== null && notice.checkVisibility(),
      cardInside: r
        ? r.left >= v.offsetLeft - EPS &&
          r.right <= v.offsetLeft + v.width + EPS &&
          r.top >= v.offsetTop - EPS &&
          r.bottom <= v.offsetTop + v.height + EPS
        : null,
      cardOnScreen: r ? { w: Math.round(r.width * v.scale), h: Math.round(r.height * v.scale) } : null,
      view: { left: Math.round(v.offsetLeft), top: Math.round(v.offsetTop) },
    };
  });
}

/** 이동 스틱을 오른쪽으로 끈 채 새 입력 프레임이 오른쪽으로 가는지 (조작이 살아 있다) */
async function stickMoves(page: Page, touch: MultiTouch): Promise<void> {
  const zone = await waitForTouchTarget(page, 'move-zone');
  const zc = centerOf(zone);
  const seq0 = await page.evaluate(() => window.__DECOY__?.getLastInput()?.seq ?? 0);
  await touch.down(1, zc.x, zc.y);
  await touch.move(1, zc.x + 50, zc.y, { steps: 5, stepMs: 20 });
  await expect
    .poll(async () => {
      const f = await page.evaluate(() => window.__DECOY__?.getLastInput() ?? null);
      return f !== null && f.seq > seq0 && f.mx > 0.5;
    }, POLL)
    .toBe(true);
}

test('확대 감지 · 복구: 배율 2가 되면 안내가 보이는 화면 안에 제 크기로 뜨고 조작이 멈춘다. 안내 위에서 오므리면 닫히고 다시 막는다', async ({
  browser,
}) => {
  test.setTimeout(150_000);
  const s = await openIphone(browser);
  const { page, touch, cdp } = s;
  await startMatch(page);
  // 스틱을 누르고 있는 중에 확대된다 (엄지가 닿아 있는 채)
  await stickMoves(page, touch);
  expect(await noticeState(page)).toMatchObject({ scale: 1, zoomedClass: false, noticeShown: false });

  // 구멍으로 확대된 상황 흉내: 배율 2 (손가락 방어는 켜져 있어 손가락으로는 만들 수 없다)
  await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 2 });
  await expect(page.getByTestId('zoom-notice')).toBeVisible();
  const z = await noticeState(page);
  // 방어를 풀었다(html.zoomed → 뿌리 touch-action 없음): 오므려 되돌릴 수 있어야 한다
  expect(z).toMatchObject({ scale: 2, zoomedClass: true, bodyTouch: 'auto', cardInside: true });
  // 확대 전과 같은 크기로 보인다: 패널 폭 440(안전 영역 안 750보다 작다), 한 줄 + 버튼
  expect(z.cardOnScreen?.w).toBe(440);
  expect(z.cardOnScreen?.h ?? 0).toBeGreaterThan(90);
  expect(z.cardOnScreen?.h ?? 0).toBeLessThan(170);
  await expect(page.locator('.zoom-text')).toHaveText(TOUCH_TEXT.zoomNotice);
  await expect(page.getByTestId('zoom-reload')).toHaveText(UI_TEXT.updateReload);

  // 조작이 멈춘다: 터치 대상이 사라지고, 누르고 있던 스틱도 버려져 입력을 보내지 않는다. 판은 흐른다(스냅샷은 계속 온다)
  await expect.poll(async () => (await touchTargets(page)).length, POLL).toBe(0);
  const seqStop = await page.evaluate(() => window.__DECOY__?.getLastInput()?.seq ?? 0);
  const snaps = await page.evaluate(() => window.__DECOY__?.snapCount ?? 0);
  await waitForSnapshots(page, snaps + 15);
  expect(await page.evaluate(() => window.__DECOY__?.getLastInput()?.seq ?? 0)).toBe(seqStop);
  await touch.up(1);

  // 보이는 화면을 한 손가락으로 끌어 옮겨도 안내가 따라온다 (좌표는 보이는 화면 기준)
  await touch.down(151, 300, 120);
  await touch.move(151, 140, 56, { steps: 8, stepMs: 16 });
  await touch.up(151);
  await expect.poll(async () => (await noticeState(page)).view.left, POLL).toBeGreaterThan(z.view.left + 50);
  await expect.poll(async () => (await noticeState(page)).cardInside, POLL).toBe(true);
  expect((await noticeState(page)).cardOnScreen?.w).toBe(440);

  // 안내 위에서 두 손가락을 오므린다 (보이는 화면 422×170 안) → 배율 1 → 안내가 스스로 닫히고 방어가 돌아온다
  await touch.pinch(211, 85, 300, 50, { steps: 12, stepMs: 16 });
  await expect(page.getByTestId('zoom-notice')).toBeHidden();
  expect(await noticeState(page)).toMatchObject({
    scale: 1,
    zoomedClass: false,
    bodyTouch: 'none',
    noticeShown: false,
  });
  // 바로 조작된다 · 다시 막는다
  await stickMoves(page, touch);
  await touch.up(1);
  await pinchBands(s, '복구 뒤');
  await expect(page.getByTestId('zoom-notice')).toBeHidden();

  expect(s.problems).toEqual([]);
  await touch.detach();
  await s.context.close();
});

test('?zoomguard=0(진단: 막기만 끔): 띠 핀치로 실제로 확대되고 안내가 뜬다 — 새로고침 버튼으로 같은 판에 돌아온다', async ({
  browser,
}) => {
  test.setTimeout(150_000);
  const s = await openIphone(browser, '&zoomguard=0');
  const { page, touch } = s;
  await startMatch(page);
  const room = await page.evaluate(() => window.__DECOY__?.room ?? '');
  expect(room).toMatch(/^[A-Z]{4}$/);

  // 대조: 막지 않으면 이 흉내에서 아래 띠 핀치가 확대된다 (위 시험들의 "배율 1"이 뜻이 있다)
  await touch.pinch(W / 2, H - 6, 80, 260, { steps: 10, stepMs: 16 });
  await expect.poll(() => scaleNow(page), POLL).toBeGreaterThan(1.5);
  // 감지 · 안내는 그대로다
  await expect(page.getByTestId('zoom-notice')).toBeVisible();
  await expect.poll(async () => (await noticeState(page)).cardInside, POLL).toBe(true);
  expect(await noticeState(page)).toMatchObject({ zoomedClass: true, noticeShown: true });
  await expect.poll(async () => (await touchTargets(page)).length, POLL).toBe(0);

  // 새로고침: 같은 주소를 새로 열어 배율이 처음으로 돌아가고, 자리 토큰으로 같은 판에 다시 들어온다
  // (location.reload()였다면 크롬은 확대 배율까지 되살려 여기서 그대로 확대돼 있다)
  await page.evaluate(() => {
    (window as unknown as { __e2eBeforeReload?: boolean }).__e2eBeforeReload = true;
  });
  await page.getByTestId('zoom-reload').tap();
  await expect
    .poll(
      () =>
        page
          .evaluate(() => (window as unknown as { __e2eBeforeReload?: boolean }).__e2eBeforeReload !== true)
          .catch(() => false),
      POLL,
    )
    .toBe(true);
  await waitForSnapshots(page, 3);
  expect(await page.evaluate(() => window.__DECOY__?.room ?? '')).toBe(room);
  expect(await scaleNow(page)).toBe(1);
  await expect(page.getByTestId('zoom-notice')).toHaveCount(0);
  await waitForTouchTarget(page, 'move-zone');

  expect(s.problems).toEqual([]);
  await touch.detach();
  await s.context.close();
});

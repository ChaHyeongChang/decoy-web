// M12 판 화면 배치 (MOBILE_PLAN M12 자동 검증 'E2E m12-screen'): 휴대폰 높이 293 · 320 · 360과 16:9 두 가지에서 HUD 글자
// (디버그 훅 getHudLayout — 표시 목록에서 잰 CSS px)가 모두 12px 이상이고 HUD와 터치 컨트롤이 겹치지 않고 화면 안, 세로로 열었다
// 돌려 시작해도 · 판 중 회전해도 가로 기준 논리 크기, 안전 영역(CDP setSafeAreaInsetsOverride) 안쪽, 로비 · 결과가 낮은 휴대폰에서
// 화면 안(또는 스크롤로 닿음)이고 가로 스크롤 없음, PC는 1920×1080 배치 그대로.
// 혼자 봇 방(?bots=1)에서 판을 시작한다. 기능 시험은 기기 배율 1. 느린 CI 대비: 간격 폴링(100~200ms)
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import type { HudLayout, HudLayoutItem, Role, TouchTarget } from '@decoy/shared';
import {
  PHONE_BROWSER,
  PHONE_LANDSCAPE,
  PHONE_NARROW,
  PHONE_SMALL,
  createRoom,
  dpr1,
  myId,
  newPlayerPage,
  pickRoleAndReady,
  portrait,
  press,
  sendTest,
  waitForSnapshots,
  type DeviceOptions,
} from './helpers';
import {
  centerOf,
  emulateSafeArea,
  measureTouchLayout,
  touchLayoutProblems,
  touchTargets,
  waitForTouchTarget,
} from './touch';

const POLL = { intervals: [100, 150, 200], timeout: 20_000 };
/** 터치 HUD 글자 하한 (CSS px, MOBILE_PLAN M12 2번) */
const MIN_FONT = 12;
/** 늘 떠 있는 HUD 부품 (이동 영역과도 겹치지 않는다). 그 밖(배너 · 메모)은 잠깐 뜨는 덮개라 보이는 버튼 · 스틱과만 본다 */
const PERSISTENT = /^(timer|gaugeA|gaugeB|card\d|minimap|hint)$/;

/** 16:9 휴대폰 (터치, 기기 배율 1) */
function touchDevice(width: number, height: number): DeviceOptions {
  return dpr1({ ...PHONE_BROWSER, viewport: { width, height }, screen: { width, height } });
}

interface Case {
  name: string;
  device: DeviceOptions;
  kind: 'touchWide' | 'touchNarrow';
}

/** 휴대폰 높이 293 · 320 · 360 + 16:9 두 가지 */
const CASES: Case[] = [
  { name: 'Pixel 5 802×293', device: dpr1(PHONE_SMALL), kind: 'touchWide' },
  { name: 'Galaxy S9+ 658×320', device: dpr1(PHONE_NARROW), kind: 'touchWide' },
  { name: 'Pixel 7 브라우저 863×360', device: dpr1(PHONE_BROWSER), kind: 'touchWide' },
  { name: '16:9 640×360', device: touchDevice(640, 360), kind: 'touchNarrow' },
  { name: '16:9 960×540', device: touchDevice(960, 540), kind: 'touchNarrow' },
];

/**
 * 가짜 전체 화면: 헤드리스 크롬에서도 진짜 requestFullscreen이 성공해 터치 HUD의 전체 화면 버튼이 숨고 창 크기가 바뀐다.
 * 버튼까지 든 더 빽빽한 배치를 보려고 아무것도 하지 않게 둔다 (m11-touch와 같다)
 */
function stubFullscreen(): void {
  Element.prototype.requestFullscreen = function () {
    return Promise.resolve();
  };
}

interface Solo {
  context: BrowserContext;
  page: Page;
  problems: string[];
  code: string;
  id: string;
}

/** 세로 화면에서는 세로 안내가 로비를 덮어 탭이 닿지 않는다: 버튼을 프로그램으로 누른다 */
async function clickJs(page: Page, testId: string): Promise<void> {
  await page.getByTestId(testId).evaluate((el) => (el as HTMLElement).click());
}

/**
 * 봇 방을 만들어 역할을 고르고 혼자 시작한다 (터치 기기는 로비를 탭으로, portraitLobby면 프로그램 클릭).
 * beforeStart = 시작 직전 (방 화면, 시작 버튼은 거기서 누른다)
 */
async function soloMatch(
  browser: Browser,
  device: DeviceOptions | undefined,
  role: Role,
  opts: {
    safeArea?: { left?: number; right?: number; bottom?: number };
    beforeStart?: (p: Page) => Promise<void>;
    portraitLobby?: boolean;
  } = {},
): Promise<Solo> {
  const { context, page, problems } = await newPlayerPage(browser, device);
  await context.addInitScript(stubFullscreen);
  if (opts.safeArea) await emulateSafeArea(page, opts.safeArea);
  let code: string;
  if (opts.portraitLobby) {
    await page.goto(`/?debug=hook&renderer=canvas&bots=1`);
    await clickJs(page, 'create-room');
    await expect(page.getByTestId('room-code')).toHaveText(/^[A-Z]{4}$/);
    code = (await page.getByTestId('room-code').textContent()) ?? '';
    await clickJs(page, `role-${role}`);
    await expect(page.getByTestId(`role-${role}`)).toHaveClass(/mine/);
    await clickJs(page, 'ready-button');
    await expect(page.getByTestId('ready-button')).toHaveText('준비 취소');
  } else {
    code = await createRoom(page, '&bots=1');
    await pickRoleAndReady(page, role);
  }
  if (opts.beforeStart) await opts.beforeStart(page);
  else await press(page.getByTestId('start-button'));
  await waitForSnapshots(page, 3);
  return { context, page, problems, code, id: await myId(page) };
}

/** 판 HUD 배치 (팀 카드까지 그려진 뒤) */
async function hudLayout(page: Page): Promise<HudLayout> {
  const handle = await page.waitForFunction(
    () => {
      const l = window.__DECOY__?.getHudLayout();
      return l && l.items.some((i) => i.id === 'card2') ? l : null;
    },
    null,
    { polling: 150, timeout: 20_000 },
  );
  const l = (await handle.jsonValue()) as HudLayout;
  await handle.dispose();
  return l;
}

function overlap(a: { x: number; y: number; w: number; h: number }, b: TouchTarget): number {
  const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return ox > 0.5 && oy > 0.5 ? Math.min(ox, oy) : 0;
}

/**
 * 글자 크기 · 겹침 · 화면 안 문제 (빈 배열이면 통과). 점수판(score)은 손으로 여는 덮개라 겹침에서 뺀다.
 * 늘 떠 있는 부품은 맵 사각형과도 겹치지 않는다
 */
function hudProblems(l: HudLayout, targets: TouchTarget[], vw: number, vh: number): string[] {
  const out: string[] = [];
  const f = (v: number): string => v.toFixed(1);
  const label = (i: HudLayoutItem): string => `${i.id}${i.text ? `「${i.text.slice(0, 12)}」` : ''}`;
  for (const i of l.items) {
    if (i.kind === 'text' && (i.fontPx ?? 0) < MIN_FONT - 0.05) out.push(`${label(i)} 글자 ${i.fontPx}px`);
    if (i.x < -0.5 || i.y < -0.5 || i.x + i.w > vw + 0.5 || i.y + i.h > vh + 0.5)
      out.push(`${label(i)} 화면 밖 (${f(i.x)}, ${f(i.y)}, ${f(i.w)}×${f(i.h)})`);
    if (i.id === 'score') continue;
    const persistent = PERSISTENT.test(i.id);
    for (const t of targets) {
      if (!persistent && t.kind === 'zone') continue;
      const o = overlap(i, t);
      if (o > 0) out.push(`${label(i)} ↔ ${t.id} ${f(o)}px`);
    }
    if (persistent && i.id !== 'hint') {
      const m = l.map;
      const ox = Math.min(i.x + i.w, m.x + m.w) - Math.max(i.x, m.x);
      const oy = Math.min(i.y + i.h, m.y + m.h) - Math.max(i.y, m.y);
      if (ox > 0.5 && oy > 0.5) out.push(`${label(i)} ↔ 맵`);
    }
  }
  return out;
}

/** 지금 화면의 HUD · 터치 대상 검사 (판 중, 점수판 닫힘) */
async function checkScreen(
  page: Page,
  label: string,
): Promise<{ layout: HudLayout; targets: TouchTarget[] }> {
  await waitForTouchTarget(page, 'move-zone');
  const layout = await hudLayout(page);
  const targets = await touchTargets(page);
  const vp = page.viewportSize()!;
  expect(hudProblems(layout, targets, vp.width, vp.height), label).toEqual([]);
  // M11 규칙(48px · 8px · 가장자리 띠)도 그대로
  expect(touchLayoutProblems(await measureTouchLayout(page)), label).toEqual([]);
  return { layout, targets };
}

const gfx = (page: Page) => page.evaluate(() => window.__DECOY__!.gfx);

// ───────────── 글자 크기 · 겹침 ─────────────

test('글자 · 겹침: 휴대폰 높이 293 · 320 · 360 · 16:9 두 가지에서 HUD 글자 12px 이상, HUD와 터치 컨트롤이 안 겹치고 화면 안', async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const report: string[] = [];
  const run = async (c: Case, role: Role): Promise<void> => {
    const label = `${c.name} ${role}`;
    const s = await soloMatch(browser, c.device, role);
    const { page } = s;
    const vp = page.viewportSize()!;
    const g = await gfx(page);
    expect(g.layout, label).toBe(c.kind);
    // 논리 크기 = 화면비 그대로 (가로 기준)
    expect(g.viewW / g.viewH, label).toBeCloseTo(vp.width / vp.height, 1);
    if (c.kind === 'touchWide') expect(Math.round(g.viewH), label).toBe(952);
    const { layout } = await checkScreen(page, label);
    expect(layout.layout, label).toBe(c.kind);
    const ids = new Set(layout.items.map((i) => i.id));
    for (const id of ['timer', 'gaugeA', 'gaugeB', 'card0', 'card1', 'card2'])
      expect(ids.has(id), `${label} ${id}`).toBe(true);
    const fonts = layout.items.filter((i) => i.kind === 'text').map((i) => i.fontPx ?? 0);
    report.push(
      `${label}: 논리 ${g.viewW}×${Math.round(g.viewH)} · 가장 작은 글자 ${Math.min(...fonts)}px · 미니맵 ${ids.has('minimap') ? '있음' : '없음'}`,
    );

    if (role === 'runner') {
      // 수감: 아래 안내 줄(터치 문구)이 가장자리 띠 안에서 버튼과 겹치지 않는다
      await sendTest(page, { kind: 'setSurvivor', target: s.id, status: 'imprisoned', imprisonCount: 1 });
      await page.waitForFunction(
        () => String(window.__DECOY__?.getHud().hint ?? '').includes('구조 버튼'),
        null,
        {
          polling: 150,
        },
      );
      const jailed = await checkScreen(page, `${label} 수감`);
      const hint = jailed.layout.items.find((i) => i.id === 'hint' && i.kind === 'text');
      expect(hint?.text, label).toBe('수감 중 — 동료가 감옥 문 앞에서 구조 버튼을 누르고 있으면 풀려난다');
    }
    // 점수판: 터치 문구 · 닫기 안내, 글자 12px 이상 · 화면 안, 화면 어디를 눌러도 닫힌다
    const board = centerOf(await waitForTouchTarget(page, 'scoreboard'));
    await page.touchscreen.tap(board.x, board.y);
    await page.waitForFunction(() => window.__DECOY__?.getHud().scoreboard === true, null, { polling: 150 });
    const open = await hudLayout(page);
    const score = open.items.filter((i) => i.id === 'score');
    expect(score.length, label).toBeGreaterThan(5);
    expect(hudProblems({ ...open, items: score }, [], vp.width, vp.height), `${label} 점수판`).toEqual([]);
    expect(score.map((i) => i.text ?? '').join(' '), label).toContain('화면을 누르면 닫힘');
    expect(
      score.some((i) => (i.text ?? '').includes('Tab') || (i.text ?? '').includes('Space')),
      label,
    ).toBe(false);
    await page.touchscreen.tap(vp.width * 0.5, vp.height * 0.5);
    await page.waitForFunction(() => window.__DECOY__?.getHud().scoreboard === false, null, { polling: 150 });
    expect(s.problems, label).toEqual([]);
    await s.context.close();
  };
  const all = CASES.flatMap((c) => (['monster', 'runner'] as const).map((r) => [c, r] as const));
  for (let i = 0; i < all.length; i += 2) await Promise.all(all.slice(i, i + 2).map(([c, r]) => run(c, r)));
  console.log(`[m12-screen] ${report.join(' / ')}`);
});

// ───────────── 회전 ─────────────

test('세로로 연 뒤 가로로 돌려 판 시작 · 세로인 채 시작해도 가로 기준 배치 · 판 중 회전(가로 → 세로 → 가로)에도 논리 크기 그대로', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const phone = dpr1(PHONE_LANDSCAPE);
  const land = phone.viewport!;
  const expectLandscape = async (page: Page, label: string): Promise<{ viewW: number; viewH: number }> => {
    // 터치는 판 장면을 만들기 전에 화면 크기가 자리 잡기를 최대 0.3초 기다린다 (세로면 그만큼)
    await hudLayout(page);
    const g = await gfx(page);
    expect(g.layout, label).toBe('touchWide');
    expect(g.viewW, label).toBeGreaterThan(g.viewH);
    expect(g.viewW / g.viewH, label).toBeCloseTo(land.width / land.height, 1);
    return { viewW: g.viewW, viewH: g.viewH };
  };

  // ① 세로로 열어 방을 만들고(세로 안내가 덮어 버튼은 프로그램 클릭) 가로로 돌린 뒤 시작
  const a = await soloMatch(browser, dpr1(portrait(PHONE_LANDSCAPE)), 'monster', {
    portraitLobby: true,
    beforeStart: async (page) => {
      await page.setViewportSize(land);
      await press(page.getByTestId('start-button'));
    },
  });
  const sizeA = await expectLandscape(a.page, '세로로 연 뒤 돌려 시작');
  await checkScreen(a.page, '세로로 연 뒤 돌려 시작');
  await a.context.close();

  // ② 세로인 채 시작(안내가 덮어 프로그램 클릭) → 긴 변을 폭으로. 돌리면 zoom만 다시 맞춘다
  const b = await soloMatch(browser, dpr1(portrait(PHONE_LANDSCAPE)), 'runner', {
    portraitLobby: true,
    beforeStart: (page) => clickJs(page, 'start-button'),
  });
  const sizeB = await expectLandscape(b.page, '세로인 채 시작');
  expect(sizeB).toEqual(sizeA);
  await b.page.setViewportSize(land);
  await b.page.waitForFunction((w) => Math.abs((window.__DECOY__?.gfx.cssW ?? 0) - w) < 2, land.width, {
    polling: 150,
    timeout: 10_000,
  });
  await checkScreen(b.page, '세로인 채 시작 → 가로');

  // ③ 판 중 회전: 가로 → 세로(터치 화면 꺼짐) → 가로. 논리 크기 그대로, 터치 대상 다시 배치 · 겹침 없음
  const before = await touchTargets(b.page);
  await b.page.setViewportSize({ width: land.height, height: land.width });
  await expect.poll(async () => (await touchTargets(b.page)).length, POLL).toBe(0);
  expect(await expectLandscape(b.page, '판 중 세로')).toEqual(sizeA);
  await b.page.setViewportSize(land);
  await b.page.waitForFunction((w) => Math.abs((window.__DECOY__?.gfx.cssW ?? 0) - w) < 2, land.width, {
    polling: 150,
    timeout: 10_000,
  });
  expect(await expectLandscape(b.page, '판 중 다시 가로')).toEqual(sizeA);
  const after = await checkScreen(b.page, '판 중 다시 가로');
  expect(after.targets.map((t) => [t.id, Math.round(t.x), Math.round(t.y)])).toEqual(
    before.map((t) => [t.id, Math.round(t.x), Math.round(t.y)]),
  );
  for (const s of [a, b]) expect(s.problems).toEqual([]);
  await b.context.close();
});

// ───────────── 안전 영역 ─────────────

test('안전 영역(왼쪽 48 · 오른쪽 40 · 아래 21): 캔버스 · 터치 대상 · 로비 버튼 · 토스트가 안쪽', async ({
  browser,
}) => {
  test.setTimeout(150_000);
  const insets = { left: 48, right: 40, bottom: 21 };
  for (const role of ['monster', 'runner'] as const) {
    const s = await soloMatch(browser, dpr1(PHONE_LANDSCAPE), role, {
      safeArea: insets,
      beforeStart: async (page) => {
        // 방 화면: 보이는 버튼 · 입력칸은 모두 안전 영역 안 (스크롤로 닿는 것은 스크롤해서)
        expect(
          await outsideSafe(page, '[data-testid="lobby"] button, [data-testid="lobby"] input', insets),
        ).toEqual([]);
        await press(page.getByTestId('start-button'));
      },
    });
    const { page } = s;
    const vp = page.viewportSize()!;
    const layout = await measureTouchLayout(page);
    expect(layout.insets).toEqual({ top: 0, ...insets });
    expect(touchLayoutProblems(layout), role).toEqual([]);
    for (const t of layout.targets) {
      expect(t.x, t.id).toBeGreaterThanOrEqual(insets.left);
      expect(t.x + t.w, t.id).toBeLessThanOrEqual(vp.width - insets.right);
      expect(t.y + t.h, t.id).toBeLessThanOrEqual(vp.height - insets.bottom);
    }
    const canvas = await page.evaluate(() => {
      const r = document.querySelector('#game-root canvas')!.getBoundingClientRect();
      return { x: r.left, y: r.top, r: r.right, b: r.bottom };
    });
    expect(canvas.x).toBeGreaterThanOrEqual(insets.left - 0.5);
    expect(canvas.r).toBeLessThanOrEqual(vp.width - insets.right + 0.5);
    expect(canvas.b).toBeLessThanOrEqual(vp.height - insets.bottom + 0.5);
    // 캔버스는 안전 영역을 가득 채운다 (판 배치를 안전 영역 크기로 정했다)
    expect(canvas.r - canvas.x).toBeGreaterThan(vp.width - insets.left - insets.right - 2);
    await checkScreen(page, `안전 영역 ${role}`);
    // 토스트 (app.ts showToast와 같은 요소, 긴 문구): 안전 영역 안
    const toast = await page.evaluate(() => {
      const el = document.createElement('div');
      el.className = 'toast';
      el.textContent =
        '다른 탭에서 같은 자리로 접속해 이 탭의 연결을 끊었습니다. 긴 안내 문구도 안전 영역 안에 머문다';
      document.body.appendChild(el);
      const r = el.getBoundingClientRect();
      el.remove();
      return { x: r.left, r: r.right, y: r.top };
    });
    expect(toast.x).toBeGreaterThanOrEqual(insets.left);
    expect(toast.r).toBeLessThanOrEqual(vp.width - insets.right);
    expect(s.problems).toEqual([]);
    await s.context.close();
  }
});

/** 보이는 요소 중 안전 영역 밖에 있는 것 (스크롤로 닿는 것은 그 자리로 스크롤해서 잰다) */
async function outsideSafe(
  page: Page,
  selector: string,
  insets: { left: number; right: number; bottom: number },
): Promise<string[]> {
  return page.evaluate(
    ({ sel, ins }) => {
      const out: string[] = [];
      for (const el of document.querySelectorAll<HTMLElement>(sel)) {
        if (!el.checkVisibility({ checkVisibilityCSS: true })) continue;
        el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        const r = el.getBoundingClientRect();
        if (r.width === 0) continue;
        const bad =
          r.left < ins.left - 0.5 ||
          r.right > window.innerWidth - ins.right + 0.5 ||
          r.bottom > window.innerHeight - ins.bottom + 0.5 ||
          r.top < -0.5;
        if (bad)
          out.push(
            `${el.dataset.testid ?? el.tagName} (${Math.round(r.left)}, ${Math.round(r.top)}, ${Math.round(r.right)}, ${Math.round(r.bottom)})`,
          );
      }
      return out;
    },
    { sel: selector, ins: insets },
  );
}

// ───────────── 로비 · 결과 ─────────────

test('로비 · 결과: 640×360 · 802×293에서 버튼이 화면 안(또는 스크롤로 닿음), 가로 스크롤 없음', async ({
  browser,
}) => {
  test.setTimeout(150_000);
  const none = { left: 0, right: 0, bottom: 0 };
  for (const [name, device] of [
    ['640×360', touchDevice(640, 360)],
    ['802×293', dpr1(PHONE_SMALL)],
  ] as const) {
    const s = await soloMatch(browser, device, 'runner', {
      beforeStart: async (page) => {
        expect(await outsideSafe(page, '[data-testid="lobby"] button', none), `${name} 로비`).toEqual([]);
        expect(await hScroll(page, '[data-testid="lobby"]'), `${name} 로비 가로 스크롤`).toBe(false);
        await press(page.getByTestId('start-button'));
      },
    });
    const { page } = s;
    await waitForTouchTarget(page, 'move-zone');
    await sendTest(page, { kind: 'setTime', timeLeft: 0.1 });
    await expect(page.getByTestId('result')).toBeVisible({ timeout: 15_000 });
    expect(await outsideSafe(page, '[data-testid="result"] button', none), `${name} 결과`).toEqual([]);
    expect(await hScroll(page, '[data-testid="result"]'), `${name} 결과 가로 스크롤`).toBe(false);
    // 결과 제목(위)이 잘리지 않는다: 맨 위로 스크롤하면 화면 안
    const top = await page.getByTestId('result-winner').evaluate((el) => {
      el.scrollIntoView({ block: 'nearest' });
      return el.getBoundingClientRect().top;
    });
    expect(top, name).toBeGreaterThanOrEqual(0);
    expect(s.problems).toEqual([]);
    await s.context.close();
  }
});

/** 가로 스크롤이 생기는가 (문서 · 그 상자) */
async function hScroll(page: Page, selector: string): Promise<boolean> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    const doc = document.scrollingElement;
    return (
      (el !== null && el.scrollWidth > el.clientWidth + 1) ||
      (doc !== null && doc.scrollWidth > doc.clientWidth + 1)
    );
  }, selector);
}

// ───────────── PC ─────────────

test('PC: 창 크기와 상관없이 1920×1080 배치 · gfx.layout pc · HUD 자리 M10c 그대로, 터치 대상 0개', async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const s = await soloMatch(browser, { viewport: { width: 1280, height: 720 } }, 'runner');
  const { page } = s;
  const g = await gfx(page);
  expect([g.layout, g.viewW, g.viewH]).toEqual(['pc', 1920, 1080]);
  const l = await hudLayout(page);
  expect([l.layout, l.viewW, l.viewH]).toEqual(['pc', 1920, 1080]);
  // 타이머 틀 가운데 = 논리 (960, 32) (VISUAL_SPEC 8.2)
  const timer = l.items.filter((i) => i.id === 'timer');
  const left = Math.min(...timer.map((i) => i.x));
  const right = Math.max(...timer.map((i) => i.x + i.w));
  const k = l.cssPerLogical;
  const rect = await page.evaluate(
    () => document.querySelector('#game-root canvas')!.getBoundingClientRect().left,
  );
  expect(((left + right) / 2 - rect) / k).toBeCloseTo(960, -1);
  expect(await touchTargets(page)).toEqual([]);
  // PC 글자는 M10c 그대로 (최소 15 논리 px)
  const fonts = l.items.filter((i) => i.kind === 'text').map((i) => (i.fontPx ?? 0) / k);
  expect(Math.min(...fonts)).toBeGreaterThanOrEqual(14.9);
  expect(s.problems).toEqual([]);
  await s.context.close();
});

// M12 판 화면 배치 (MOBILE_PLAN M12 자동 검증 'E2E m12-screen'): 휴대폰 높이 293 · 320 · 360과 16:9 두 가지에서 HUD 글자
// (디버그 훅 getHudLayout — 표시 목록에서 잰 CSS px)가 모두 12px 이상이고 HUD와 터치 컨트롤이 겹치지 않고 화면 안, 세로로 열었다
// 돌려 시작해도 · 세로인 채 시작하면 가로가 될 때까지 판 장면을 미뤄(세로 · 가로 크기가 비대칭이어도) · 판 중 회전해도 가로 기준
// 논리 크기, 안전 영역(CDP setSafeAreaInsetsOverride) 안쪽, 로비 · 결과가 낮은 휴대폰에서 화면 안(또는 스크롤로 닿음)이고 가로
// 스크롤 없음, 터치 로비가 판 배치로 미리 구움, PC는 1920×1080 배치 그대로.
// 검토 반영: 태블릿 가로 · 낮은 노트북 창에서 첫 화면 · 연습 역할 고르기 · 빠른 매칭 대기가 스크롤 없이 한 화면(F19), 결과 버튼이
// 아래 24px 띠 밖(1024×640 태블릿 포함), 처리방침 링크 48px(F20), 연습 역할 격자 arming 동안 탭이 버튼에 닿지 않음(F17).
// 혼자 봇 방(?bots=1)에서 판을 시작한다. 판 배치 · 캔버스는 판 장면이 생긴 뒤(배치 적용 뒤)에 읽는다. 기능 시험은 기기 배율 1.
// 느린 CI 대비: 간격 폴링(100~200ms)
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import type { HudLayout, HudLayoutItem, Role, TouchTarget } from '@decoy/shared';
import {
  BASE_QUERY,
  PHONE_BROWSER,
  PHONE_LANDSCAPE,
  PHONE_NARROW,
  PHONE_SMALL,
  TABLET_LANDSCAPE,
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
  TOUCH_LAYOUT,
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

/** 판 장면이 떴다 = 판 배치(gfx.layout · 논리 크기)와 캔버스 크기가 정해졌다 (main.ts가 배치를 적용한 바로 뒤에 시작한다) */
async function waitForScene(page: Page): Promise<void> {
  await page.waitForFunction(() => (window.__DECOY__?.getHudLayout() ?? null) !== null, null, {
    polling: 100,
    timeout: 20_000,
  });
}

/** 세로 화면에서는 세로 안내가 로비를 덮어 탭이 닿지 않는다: 버튼을 프로그램으로 누른다 */
async function clickJs(page: Page, testId: string): Promise<void> {
  // 첫 화면은 연결 전에도 그려지고 방 만들기는 연결될 때까지 꺼져 있다 (M13b)
  await expect(page.getByTestId(testId)).toBeEnabled();
  await page.getByTestId(testId).evaluate((el) => (el as HTMLElement).click());
}

/**
 * 봇 방을 만들어 역할을 고르고 혼자 시작한다 (터치 기기는 로비를 탭으로, portraitLobby면 프로그램 클릭).
 * beforeStart = 시작 직전 (방 화면, 시작 버튼은 거기서 누른다). 판 장면(판 배치 적용)까지 기다린다.
 * 세로인 채 시작하면(sceneLater) 가로가 될 때까지 장면이 생기지 않으므로 스냅샷까지만 기다린다
 */
async function soloMatch(
  browser: Browser,
  device: DeviceOptions | undefined,
  role: Role,
  opts: {
    safeArea?: { left?: number; right?: number; bottom?: number };
    beforeStart?: (p: Page) => Promise<void>;
    portraitLobby?: boolean;
    sceneLater?: boolean;
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
  if (!opts.sceneLater) await waitForScene(page);
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
 * 늘 떠 있는 부품은 맵 사각형과도 겹치지 않는다 (맵 안 미니맵만 예외: 맵 사각형 안에 다 들어간다)
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
    const m = l.map;
    if (i.id === 'minimap' && l.minimapInset) {
      // 따라가는 카메라: 옆 자리가 없는 배치(16:9 · 태블릿)는 미니맵을 맵 사각형 안 구석에 넣는다 — 맵 안에 다 들어가야 한다
      if (i.x < m.x - 0.5 || i.y < m.y - 0.5 || i.x + i.w > m.x + m.w + 0.5 || i.y + i.h > m.y + m.h + 0.5)
        out.push(`${label(i)} 맵 안 미니맵이 맵 밖으로`);
      continue;
    }
    if (persistent && i.id !== 'hint') {
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
      // 수감: 아래 안내 줄(터치 문구)이 가장자리 띠 안에서 버튼과 겹치지 않는다. 따라가는 카메라에서는 수감 중 관전을 알리는
      // 더 긴 문구다(팀 카드를 누르면 동료 화면, STORY_TEXT imprisonedWatchHintTouch)
      const jailText = '수감 중 — 동료가 구조해 주면 풀려난다 · 팀 카드를 누르면 동료 화면';
      await sendTest(page, { kind: 'setSurvivor', target: s.id, status: 'imprisoned', imprisonCount: 1 });
      await page.waitForFunction((want) => String(window.__DECOY__?.getHud().hint ?? '') === want, jailText, {
        polling: 150,
      });
      const jailed = await checkScreen(page, `${label} 수감`);
      const hint = jailed.layout.items.find((i) => i.id === 'hint' && i.kind === 'text');
      expect(hint?.text, label).toBe(jailText);
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

/**
 * 세로 안내가 덮는 동안은 판 장면을 만들지 않는다: 최대 대기(0.3초)를 넉넉히 넘긴 ms 동안 여러 번 봐도 장면이 없다.
 * (세로 크기로 판 배치를 정하면 돌린 뒤 화면비가 달라 판 내내 작게 그려진다, 검토 #3)
 */
async function noSceneWhilePortrait(page: Page, label: string, ms = 1500): Promise<void> {
  await expect(page.getByTestId('rotate-notice')).toBeVisible();
  const until = Date.now() + ms;
  while (Date.now() < until) {
    expect(await page.evaluate(() => window.__DECOY__?.getHudLayout() ?? null), label).toBeNull();
    await page.waitForTimeout(150);
  }
}

/**
 * 판 장면이 처음 보인 순간의 배율(gfx.zoom)을 적어 둔다 (__firstZoom). 돌린 직후 시작한 판이 크기 변경 디바운스(150ms)를
 * 기다리던 낡은 배율로 장면을 만들고 곧바로 다시 굽지 않는지 본다 (검토 #13). 타이머 틈마다 확인한다
 */
async function watchFirstZoom(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as Window & { __firstZoom?: number };
    delete w.__firstZoom;
    const look = (): void => {
      const d = window.__DECOY__;
      if (d?.getHudLayout()) w.__firstZoom = d.gfx.zoom;
      else window.setTimeout(look, 0);
    };
    look();
  });
}

async function firstZoom(page: Page): Promise<number> {
  const h = await page.waitForFunction(
    () => (window as Window & { __firstZoom?: number }).__firstZoom,
    null,
    {
      polling: 100,
      timeout: 20_000,
    },
  );
  const v = (await h.jsonValue()) as number;
  await h.dispose();
  return v;
}

test('세로로 연 뒤 가로로 돌려 판 시작 · 세로인 채 시작하면 가로가 될 때까지 판 장면을 미뤄 가로 기준 배치(세로 · 가로 크기가 비대칭이어도) · 판 중 회전(가로 → 세로 → 가로)에도 논리 크기 그대로', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const phone = dpr1(PHONE_LANDSCAPE);
  const land = phone.viewport!;
  const expectLandscape = async (
    page: Page,
    label: string,
    want: { width: number; height: number } = land,
  ): Promise<{ viewW: number; viewH: number }> => {
    await hudLayout(page);
    const g = await gfx(page);
    expect(g.layout, label).toBe('touchWide');
    expect(g.viewW, label).toBeGreaterThan(g.viewH);
    expect(g.viewW / g.viewH, label).toBeCloseTo(want.width / want.height, 1);
    return { viewW: g.viewW, viewH: g.viewH };
  };
  const waitCssW = (page: Page, w: number) =>
    page.waitForFunction((x) => Math.abs((window.__DECOY__?.gfx.cssW ?? 0) - x) < 2, w, {
      polling: 150,
      timeout: 10_000,
    });

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

  // ② 세로인 채 시작(안내가 덮어 프로그램 클릭): 가로가 될 때까지 판 장면을 만들지 않는다. 돌리면 그때 가로 크기로 배치하고,
  // 장면은 처음부터 지금 배율로 만든다(디바운스를 기다리던 낡은 배율로 만들고 다시 굽지 않는다)
  const b = await soloMatch(browser, dpr1(portrait(PHONE_LANDSCAPE)), 'runner', {
    portraitLobby: true,
    sceneLater: true,
    beforeStart: (page) => clickJs(page, 'start-button'),
  });
  await noSceneWhilePortrait(b.page, '세로인 채 시작');
  await watchFirstZoom(b.page);
  await b.page.setViewportSize(land);
  const sizeB = await expectLandscape(b.page, '세로인 채 시작 → 가로');
  expect(sizeB).toEqual(sizeA);
  await waitCssW(b.page, land.width);
  expect(await firstZoom(b.page), '판 장면을 만든 배율').toBe((await gfx(b.page)).zoom);
  await checkScreen(b.page, '세로인 채 시작 → 가로');

  // ③ 판 중 회전: 가로 → 세로(터치 화면 꺼짐) → 가로. 논리 크기 그대로, 터치 대상 다시 배치 · 겹침 없음
  const before = await touchTargets(b.page);
  await b.page.setViewportSize({ width: land.height, height: land.width });
  await expect.poll(async () => (await touchTargets(b.page)).length, POLL).toBe(0);
  expect(await expectLandscape(b.page, '판 중 세로')).toEqual(sizeA);
  await b.page.setViewportSize(land);
  await waitCssW(b.page, land.width);
  expect(await expectLandscape(b.page, '판 중 다시 가로')).toEqual(sizeA);
  const after = await checkScreen(b.page, '판 중 다시 가로');
  expect(after.targets.map((t) => [t.id, Math.round(t.x), Math.round(t.y)])).toEqual(
    before.map((t) => [t.id, Math.round(t.x), Math.round(t.y)]),
  );
  await b.context.close();

  // ④ 실제 휴대폰의 세로 크기는 가로를 뒤집은 값이 아니다(주소창 · 안전 영역이 다르게 빠진다): 세로 412×787로 시작 →
  // 가로 867×332. 세로 크기로 정했다면 touchNarrow(화면비 787:412)로 굳어 돌린 뒤 HUD 글자가 12px 아래였다
  const tall = { width: 412, height: 787 };
  const wide = { width: 867, height: 332 };
  const c = await soloMatch(browser, dpr1({ ...PHONE_LANDSCAPE, viewport: tall, screen: tall }), 'monster', {
    portraitLobby: true,
    sceneLater: true,
    beforeStart: (page) => clickJs(page, 'start-button'),
  });
  await noSceneWhilePortrait(c.page, '비대칭 세로로 시작');
  await c.page.setViewportSize(wide);
  await expectLandscape(c.page, '비대칭 세로 → 가로', wide);
  // 글자 12px 이상 · 겹침 없음 · 화면 안 (checkScreen의 hudProblems)
  const { layout } = await checkScreen(c.page, '비대칭 세로 → 가로');
  expect(layout.layout).toBe('touchWide');
  const fonts = layout.items.filter((i) => i.kind === 'text').map((i) => i.fontPx ?? 0);
  expect(fonts.length).toBeGreaterThan(0);
  expect(Math.min(...fonts)).toBeGreaterThanOrEqual(MIN_FONT - 0.05);
  console.log(`[m12-screen] 비대칭 412×787 → 867×332: 가장 작은 글자 ${Math.min(...fonts)}px`);
  for (const s of [a, b, c]) expect(s.problems).toEqual([]);
  await c.context.close();
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

test('로비 · 결과: 640×360 · 802×293 · 태블릿 1024×640에서 버튼이 화면 안(또는 스크롤로 닿음), 결과 버튼은 처음 뜬 화면에서 아래 24px 띠 밖, 가로 스크롤 없음', async ({
  browser,
}) => {
  test.setTimeout(210_000);
  const none = { left: 0, right: 0, bottom: 0 };
  for (const [name, device] of [
    ['640×360', touchDevice(640, 360)],
    ['802×293', dpr1(PHONE_SMALL)],
    // 태블릿 가로: 넓은 결과 배치에서는 버튼 아래끝(616.2)이 띠(616)에 걸렸다 (검토 반영, F18 후속)
    ['태블릿 1024×640', dpr1(TABLET_LANDSCAPE)],
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
    // 처음 뜬 화면(스크롤 전): 홈으로 · 다시 하기 아래끝이 아래 24px 띠(안드로이드 홈 제스처) 밖 — 판 터치 대상과 같은 규칙
    const feet = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('[data-testid="result"] .result-foot button')].map((b) => ({
        id: b.dataset.testid ?? '',
        bottom: b.getBoundingClientRect().bottom,
      })),
    );
    expect(feet.map((f) => f.id)).toEqual(['result-home', 'rematch']);
    const bandTop = page.viewportSize()!.height - TOUCH_LAYOUT.bottomBand;
    console.log(
      `[결과 버튼] ${name}: 아래끝 ${feet.map((f) => f.bottom.toFixed(1)).join(' · ')}, 띠 위 ${bandTop}`,
    );
    for (const f of feet)
      expect(f.bottom, `${name} 결과 ${f.id} 아래끝 (띠 위 ${bandTop})`).toBeLessThanOrEqual(bandTop + 0.05);
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

// ───────────── 로비: 태블릿 · 낮은 노트북 가로 (검토 반영 F19 · F20 · F17) ─────────────

/** 태블릿 가로 (Galaxy Tab S4 1138×712, 터치, 브라우저 안이라 전체 화면 버튼이 있다) */
const TABLET_WIDE: DeviceOptions = { ...TABLET_LANDSCAPE, viewport: { width: 1138, height: 712 } };

/**
 * 높이 501 ~ 860 가로 화면: 태블릿(브라우저 — 전체 화면 버튼 · 48px 처리방침 링크까지 든 가장 긴 로고 칸) · 16:9 손가락 화면 ·
 * 낮은 노트북 창(마우스). 예전에는 큰 로고가 위에 쌓여 연습 역할 아랫줄 · 취소 · 코드 입장이 첫 화면 밖이었다
 */
const LOW_WIDE: { name: string; device: DeviceOptions }[] = [
  { name: '태블릿 1024×640', device: dpr1(TABLET_LANDSCAPE) },
  { name: '태블릿 1138×712', device: dpr1(TABLET_WIDE) },
  { name: '손가락 16:9 960×540', device: touchDevice(960, 540) },
  { name: 'PC 1280×720', device: { viewport: { width: 1280, height: 720 } } },
  { name: 'PC 1366×768', device: { viewport: { width: 1366, height: 768 } } },
  { name: 'PC 960×540', device: { viewport: { width: 960, height: 540 } } },
];
const HOME_IDS = [
  'name-input',
  'server-status',
  'quick-match',
  'practice',
  'create-room',
  'room-code-input',
  'join-room',
  'quality-select',
  'privacy-link',
] as const;
/**
 * PC 첫 화면은 그래픽 줄 옆 프레임 제한 선택 상자(렌더링 최적화)와 그 아래 캐릭터 스타일 선택 상자(캐릭터 리디자인 2단계)까지
 * (터치는 둘 다 설정 판 안이라 첫 화면에 없다)
 */
const PC_HOME_IDS = [...HOME_IDS, 'frame-limit-select', 'char-style-select'] as const;
/** 터치 첫 화면은 그래픽 줄 옆 설정 단추(진동 · 프레임 제한 · 안내 다시 보기)와 로고 칸의 전체 화면 버튼까지 */
const TOUCH_HOME_IDS = [...HOME_IDS, 'settings-button', 'lobby-fullscreen'] as const;
const PICK_IDS = [
  'server-status',
  'practice-role-monster',
  'practice-role-runner',
  'practice-role-guard',
  'practice-role-scout',
  'practice-cancel',
] as const;
const QUICK_IDS = [
  'quick-count',
  'quick-countdown',
  'role-monster',
  'role-runner',
  'role-guard',
  'role-scout',
  'quick-cancel',
  'lobby-hint',
] as const;

/**
 * 스크롤하지 않은 첫 화면에 통째로 들어오는가 (toBeVisible · click은 스크롤해야 닿는 곳도 통과시킨다).
 * 한 화면의 어긋난 것을 모두 보이게 soft로 본다
 */
async function expectInFirstView(page: Page, ids: readonly string[], label: string): Promise<void> {
  expect(
    await page.getByTestId('lobby').evaluate((el) => el.scrollTop),
    `${label}: 로비가 스크롤되지 않은 채`,
  ).toBe(0);
  for (const id of ids)
    await expect.soft(page.getByTestId(id), `${label}: ${id}`).toBeInViewport({ ratio: 1, timeout: 3000 });
}

test('로비: 태블릿 가로 · 낮은 노트북 창(1024×640 · 1138×712 · 960×540 · 1280×720 · 1366×768)에서 첫 화면 · 연습 역할 고르기 · 빠른 매칭 대기의 버튼과 상태 줄이 스크롤 없이 한 화면, 휴대폰 연습 고르기는 4 × 1 그대로', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  for (const d of LOW_WIDE) {
    const { context, page, problems } = await newPlayerPage(browser, d.device);
    // 빠른 매칭 탭이 진짜 전체 화면을 켜면 전체 화면 버튼이 숨는다: 버튼이 든 브라우저 배치를 그대로 본다
    await context.addInitScript(stubFullscreen);
    await page.goto(`/?${BASE_QUERY.slice(1)}`);
    await expect(page.getByTestId('create-room')).toBeEnabled();
    const touch = (d.device.hasTouch ?? false) === true;
    // 첫 화면 (PC는 프레임 제한 선택 상자, 터치 기기는 설정 단추 · 로고 칸의 전체 화면 버튼까지)
    await expectInFirstView(page, touch ? TOUCH_HOME_IDS : PC_HOME_IDS, `${d.name} 첫 화면`);
    expect(await hScroll(page, '[data-testid="lobby"]'), `${d.name} 첫 화면 가로 스크롤`).toBe(false);
    // 봇과 연습 → 역할 고르기: 네 역할 · 취소 · 상태 줄
    await press(page.getByTestId('practice'));
    await expect(page.getByTestId('practice-picker')).toBeVisible();
    await expectInFirstView(page, PICK_IDS, `${d.name} 연습 고르기`);
    expect(await hScroll(page, '[data-testid="lobby"]'), `${d.name} 연습 고르기 가로 스크롤`).toBe(false);
    await press(page.getByTestId('practice-cancel'));
    // 빠른 매칭 대기: 인원 · 남은 시간 · 역할 카드 넷 · 취소 · 안내 (자동 시작 20초 전에 취소한다)
    await expect(page.getByTestId('quick-match')).toBeEnabled();
    await press(page.getByTestId('quick-match'));
    await expect(page.getByTestId('quick-cancel')).toBeVisible();
    await expect(page.getByTestId('quick-countdown')).not.toBeEmpty();
    await expectInFirstView(page, QUICK_IDS, `${d.name} 빠른 매칭 대기`);
    expect(await hScroll(page, '[data-testid="lobby"]'), `${d.name} 빠른 매칭 대기 가로 스크롤`).toBe(false);
    await press(page.getByTestId('quick-cancel'));
    await expect(page.getByTestId('quick-match')).toBeVisible();
    expect(problems, d.name).toEqual([]);
    await context.close();
  }
  // 휴대폰 가로(높이 500 이하): 연습 역할은 그대로 한 줄 4 × 1이고 취소까지 한 화면
  const { context, page, problems } = await newPlayerPage(browser, dpr1(PHONE_LANDSCAPE));
  await page.goto(`/?${BASE_QUERY.slice(1)}`);
  await press(page.getByTestId('practice'));
  await expect(page.getByTestId('practice-picker')).toBeVisible();
  await expectInFirstView(page, PICK_IDS, '휴대폰 915×412 연습 고르기');
  const tops = await page.evaluate(() =>
    [...document.querySelectorAll('.practice-role')].map((b) => Math.round(b.getBoundingClientRect().top)),
  );
  expect(tops).toHaveLength(4);
  expect(new Set(tops).size, `휴대폰 연습 역할 한 줄 (위 ${tops.join(', ')})`).toBe(1);
  expect(problems).toEqual([]);
  await context.close();
});

test('손가락 화면 첫 화면: 처리방침 링크가 48px 이상이고 전체 화면 버튼과 8px 이상 떨어져 있다 (휴대폰 · 태블릿)', async ({
  browser,
}) => {
  for (const [name, device] of [
    ['Pixel 7 브라우저 863×360', dpr1(PHONE_BROWSER)],
    ['Galaxy S9+ 658×320', dpr1(PHONE_NARROW)],
    ['태블릿 1024×640', dpr1(TABLET_LANDSCAPE)],
  ] as const) {
    const { context, page, problems } = await newPlayerPage(browser, device);
    await page.goto(`/?${BASE_QUERY.slice(1)}`);
    const link = page.getByTestId('privacy-link');
    const fs = page.getByTestId('lobby-fullscreen');
    await expect(link).toBeVisible();
    await expect(fs).toBeVisible();
    const [l, f] = [(await link.boundingBox())!, (await fs.boundingBox())!];
    console.log(
      `[처리방침 링크] ${name}: ${l.width.toFixed(1)}×${l.height.toFixed(1)} (${l.x.toFixed(1)}, ${l.y.toFixed(1)}), ` +
        `전체 화면 버튼 아래끝 ${(f.y + f.height).toFixed(1)}`,
    );
    expect(l.height, `${name} 링크 높이`).toBeGreaterThanOrEqual(TOUCH_LAYOUT.minSize);
    expect(l.width, `${name} 링크 폭`).toBeGreaterThanOrEqual(TOUCH_LAYOUT.minSize);
    // 두 대상 사이 (가로 · 세로 중 떨어진 쪽, 겹치면 음수)
    const gap = Math.max(
      l.y - (f.y + f.height),
      f.y - (l.y + l.height),
      l.x - (f.x + f.width),
      f.x - (l.x + l.width),
    );
    expect(gap, `${name} 링크 ↔ 전체 화면 버튼`).toBeGreaterThanOrEqual(TOUCH_LAYOUT.minGap);
    expect(problems).toEqual([]);
    await context.close();
  }
});

test('연습 역할 고르기: 격자에 arming이 붙어 있는 동안에는 그 자리 탭이 역할 버튼에 닿지 않아 판이 시작되지 않는다 (CSS, 검토 반영 F17)', async ({
  browser,
}) => {
  const { context, page, problems } = await newPlayerPage(browser, dpr1(TABLET_LANDSCAPE));
  await context.addInitScript(stubFullscreen);
  await page.goto(`/?${BASE_QUERY.slice(1)}`);
  await press(page.getByTestId('practice'));
  const grid = page.locator('.practice-roles');
  await expect(grid).toBeVisible();
  // 그린 직후 가드(lobby.ts가 잠깐 단다)가 풀린 뒤, 같은 클래스를 다시 달아 CSS만 본다
  await expect(grid).not.toHaveClass(/\barming\b/);
  await grid.evaluate((el) => el.classList.add('arming'));
  const box = (await page.getByTestId('practice-role-runner').boundingBox())!;
  const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
  await page.touchscreen.tap(x, y);
  // 버튼에 닿았으면 기기 안 연습 판이 바로 시작해 고르기 화면이 사라진다 (보통 0.1 ~ 0.4초)
  await page.waitForTimeout(1000);
  await expect(page.getByTestId('practice-picker')).toBeVisible();
  expect(await page.evaluate(() => window.__DECOY__?.phase ?? null), '판이 시작되지 않는다').toBeNull();
  // 가드가 풀리면 같은 자리가 역할 버튼이다 (위 탭이 빈 갈래가 아님)
  await grid.evaluate((el) => el.classList.remove('arming'));
  expect(
    await page.evaluate(
      ([px, py]) =>
        document.elementFromPoint(px!, py!)?.closest('[data-testid]')?.getAttribute('data-testid') ?? null,
      [x, y],
    ),
  ).toBe('practice-role-runner');
  expect(problems).toEqual([]);
  await context.close();
});

// ───────────── 미리 굽기 ─────────────

/**
 * 그래픽 굽기 기록 (HUD 아틀라스 굽기 횟수 · 정적 맵 캐시 바이트 — 다른 배율로 구우면 바뀐다).
 * 미리 굽기가 멈출 때까지(1.6초 그대로) 기다린 값
 */
async function quietBakes(page: Page): Promise<{ hud: number; map: number }> {
  const read = async () => {
    const f = (await gfx(page)).features;
    return { hud: Number(f.hudBakes ?? 0), map: Number(f.mapCacheBytes ?? 0) };
  };
  let v = await read();
  let since = Date.now();
  const deadline = since + 20_000;
  while (Date.now() - since < 1600) {
    expect(Date.now(), '로비 미리 굽기가 멈추지 않는다').toBeLessThan(deadline);
    await page.waitForTimeout(150);
    const n = await read();
    if (n.hud !== v.hud || n.map !== v.map) [v, since] = [n, Date.now()];
  }
  return v;
}

test('터치 로비는 판 배치로 미리 굽는다: 첫 판 시작 때 맵 · HUD 아틀라스를 다시 굽지 않는다', async ({
  browser,
}) => {
  test.setTimeout(90_000);
  let lobby = { hud: -1, map: -1 };
  const s = await soloMatch(browser, dpr1(PHONE_LANDSCAPE), 'runner', {
    beforeStart: async (page) => {
      // 판 배치는 로비에서 이미 판과 같다 (PC 1920×1080 배율로 구워 두면 판 시작 때 모두 버리고 다시 굽는다, 검토 #11)
      await expect.poll(async () => (await gfx(page)).layout, POLL).toBe('touchWide');
      lobby = await quietBakes(page);
      expect(lobby.hud).toBeGreaterThan(0);
      expect(lobby.map).toBeGreaterThan(0);
      await press(page.getByTestId('start-button'));
    },
  });
  await hudLayout(s.page);
  const g = await gfx(s.page);
  expect(g.layout).toBe('touchWide');
  expect({ hud: Number(g.features.hudBakes), map: Number(g.features.mapCacheBytes) }).toEqual(lobby);
  expect(s.problems).toEqual([]);
  await s.context.close();
});

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
  expect(fonts.length).toBeGreaterThan(0);
  expect(Math.min(...fonts)).toBeGreaterThanOrEqual(14.9);
  expect(s.problems).toEqual([]);
  await s.context.close();
});

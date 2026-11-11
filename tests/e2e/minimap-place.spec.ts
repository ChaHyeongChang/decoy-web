// 맵 창 안 미니맵 자리 (플레이테스트 a-5 — 괴물 화면 미니맵이 맵 위 가운데에서 시야를 가리던 것): 실제 판 화면에서 잰다.
//  - 옆 칸에 미니맵 자리가 없는 괴물 화면(아이폰 14 주소창 750×340 · 750×300, 16:9 667×375, 위 띠 배치 600×400)의 미니맵 틀이 맵
//    왼쪽 위 구석 — 맵 위 가운데 칸(가로 가운데 1/3 × 위 1/3) 밖이고 터치 대상(이동 영역 포함) · 다른 HUD 부품과 겹치지 않는다
//  - 틀을 누르면 지도 크게 보기가 열리고 이동 스틱은 생기지 않는다(이동 영역이 틀을 피한다), 아무 데나 누르면 닫히고 이동 영역은 그대로 쓴다
//  - 생존자는 그대로: 667×375는 맵 오른쪽(시스템 버튼 아래), 750×340은 옆 칸(맵 밖)
//  - 판 중 창이 낮아지면(750×369에서 시작 → 주소창이 나와 300): 옮긴 틀이 맵 왼쪽 위 구석, 크기가 돌아오면 처음 자리
//  - 조작 배치에서 지도만 옮겼으면 판 직전 터치 안내는 기본 그림 · 본문 그대로(안내 그림은 지도를 그리지 않는다)
// 틀은 디버그 훅 getMatchPrefs().minimapTap(미니맵 객체의 틀 사각형 — 누르는 자리)과 getHudLayout()(표시 목록에서 잰 그림)으로 본다.
// 혼자 봇 방(?bots=1). 기능 시험은 기기 배율 1. 느린 CI 대비: 조건을 간격 폴링으로 기다린다. 화면 사진은 artifacts/screens/
// (커밋하지 않음)에 남긴다
import { mkdirSync } from 'node:fs';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import type { HudLayout, MatchPrefsDebug, Role, TouchTarget } from '@decoy/shared';
import {
  PHONE_BROWSER,
  createRoom,
  dpr1,
  newPlayerPage,
  pickRoleAndReady,
  press,
  waitForSnapshots,
  type DeviceOptions,
} from './helpers';
import { TOUCH_TEXT } from '../../client/src/data/storyText';
import {
  MultiTouch,
  measureTouchLayout,
  touchLayoutProblems,
  touchTargets,
  waitForTouchTarget,
} from './touch';

const POLL = { intervals: [100, 150, 200], timeout: 20_000 };
const SHOTS = 'artifacts/screens';
/** 늘 떠 있는 HUD 부품 가운데 미니맵이 아닌 것 */
const OTHER_HUD = /^(timer|gauge[A-C]|card\d)$/;

type Rect = { x: number; y: number; w: number; h: number };

function phone(width: number, height: number): DeviceOptions {
  return dpr1({ ...PHONE_BROWSER, viewport: { width, height }, screen: { width, height } });
}

/** 가짜 전체 화면 (헤드리스 크롬의 진짜 전체 화면은 창 크기를 바꾼다 — m12-screen과 같다) */
function stubFullscreen(): void {
  Element.prototype.requestFullscreen = function () {
    return Promise.resolve();
  };
}

interface Solo {
  context: BrowserContext;
  page: Page;
  problems: string[];
}

/** 봇 방을 만들어 역할을 고르고 혼자 시작한다 (터치 화면까지 기다린다). mirror = 괴물 조작 배치 좌우 반전(왼손잡이)을 저장해 둔다 */
async function soloMatch(browser: Browser, device: DeviceOptions, role: Role, mirror = false): Promise<Solo> {
  const { context, page, problems } = await newPlayerPage(browser, device);
  await context.addInitScript(stubFullscreen);
  if (mirror)
    await context.addInitScript(() =>
      localStorage.setItem('decoy:controlLayout', '{"v":1,"monster":{"mirror":true,"items":{}}}'),
    );
  await createRoom(page, '&bots=1');
  await pickRoleAndReady(page, role);
  await press(page.getByTestId('start-button'));
  await waitForSnapshots(page, 3);
  await waitForTouchTarget(page, 'move-zone');
  return { context, page, problems };
}

async function prefs(page: Page): Promise<MatchPrefsDebug> {
  const p = await page.evaluate(() => window.__DECOY__?.getMatchPrefs() ?? null);
  if (!p) throw new Error('판 장면 없음');
  return p;
}

/** 판 HUD 배치 (팀 카드 · 미니맵까지 그려진 뒤) */
async function hudLayout(page: Page): Promise<HudLayout> {
  const handle = await page.waitForFunction(
    () => {
      const l = window.__DECOY__?.getHudLayout();
      return l && l.items.some((i) => i.id === 'card2') && l.items.some((i) => i.id === 'minimap') ? l : null;
    },
    null,
    { polling: 150, timeout: 20_000 },
  );
  const l = (await handle.jsonValue()) as HudLayout;
  await handle.dispose();
  return l;
}

/** 미니맵 틀 (누르는 자리, 창 CSS px) — 그릴 때까지 기다린다 */
async function minimapFrame(page: Page): Promise<Rect> {
  await expect.poll(async () => (await prefs(page)).minimapTap !== null, POLL).toBe(true);
  return (await prefs(page)).minimapTap!;
}

function overlapArea(a: Rect, b: Rect): number {
  const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return ox > 0.5 && oy > 0.5 ? ox * oy : 0;
}

/** 맵 창을 3 × 3으로 나눈 위 가운데 칸 (괴물이 위로 조준하면 시야 부채꼴 끝이 오는 자리) */
function topCenter(map: Rect): Rect {
  return { x: map.x + map.w / 3, y: map.y, w: map.w / 3, h: map.h / 3 };
}

/** 틀과 겹치는 터치 대상 · 다른 HUD 부품 (빈 배열이면 통과) */
function frameOverlaps(frame: Rect, l: HudLayout, targets: TouchTarget[]): string[] {
  const out: string[] = [];
  for (const t of targets) if (overlapArea(frame, t) > 0) out.push(`터치 대상 ${t.id}`);
  for (const i of l.items) if (OTHER_HUD.test(i.id) && overlapArea(frame, i) > 0) out.push(`HUD ${i.id}`);
  return out;
}

/** 이동 스틱이 살아 있는가 (이동 영역이 손가락을 붙잡았다) */
function stickState(page: Page): Promise<{ live: boolean; zoneDown: boolean }> {
  return page.evaluate(() => ({
    live: document.querySelector('.tc-move.live') !== null,
    zoneDown: document.querySelector('.tc-zone.down') !== null,
  }));
}

const r1 = (b: Rect): number[] => [b.x, b.y, b.w, b.h].map((v) => Math.round(v));

test.beforeAll(() => mkdirSync(SHOTS, { recursive: true }));

test('괴물 화면 맵 안 미니맵: 맵 왼쪽 위 구석 — 맵 위 가운데 칸 밖 · 터치 대상과 안 겹침, 틀을 누르면 지도 크게 보기(이동 스틱은 안 생김), 생존자 자리는 그대로', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const report: string[] = [];
  // want = 틀 (x, y, w, h — 창 CSS px, 1px 안). 예전 괴물 틀은 750×340 (366, 6) · 750×300 (381, 6) · 667×375 (283, 32) — 위 가운데
  const scenes: {
    w: number;
    h: number;
    role: Role;
    want?: number[];
    side?: 'left' | 'right';
    mirror?: boolean;
  }[] = [
    { w: 750, h: 340, role: 'monster', want: [126, 6, 100, 82], side: 'left' },
    { w: 750, h: 300, role: 'monster', want: [156, 6, 89, 74], side: 'left' },
    { w: 667, h: 375, role: 'monster', want: [97, 32, 115, 91], side: 'left' },
    // 위 띠 배치(HUD가 모두 위 띠): 이동 영역이 띠 바로 아래부터라 왼쪽 위 틀을 덮을 뻔한 화면. 600×400은 거점 셋 줄 게이지(b)
    // 뒤로 좌우 칸 배치가 되어(위 띠 두 줄 높이면 좌우 칸이 생긴다) 위 띠 두 줄인 520×380으로 본다 (단위 시험 minimap-place와 같다)
    { w: 520, h: 380, role: 'monster', side: 'left' },
    // 좌우 반전(왼손잡이): 통째로 뒤집혀 맵 오른쪽 위 구석 (시스템 버튼은 왼쪽 위, 이동 영역은 오른쪽)
    { w: 750, h: 340, role: 'monster', want: [524, 6, 100, 82], side: 'right', mirror: true },
    // 생존자는 그대로: 맵 오른쪽 · 시스템 버튼 아래
    { w: 667, h: 375, role: 'runner', want: [455, 65, 115, 91], side: 'right' },
  ];
  for (const c of scenes) {
    const label = `${c.w}×${c.h} ${c.role}${c.mirror ? ' 반전' : ''}`;
    const s = await soloMatch(browser, phone(c.w, c.h), c.role, c.mirror);
    const { page } = s;
    const frame = await minimapFrame(page);
    const l = await hudLayout(page);
    const targets = await touchTargets(page);
    const map = l.map;
    expect(l.minimapInset, `${label} 맵 안 미니맵`).toBe(true);
    // 틀까지 맵 창 안
    expect(frame.x, label).toBeGreaterThanOrEqual(map.x - 0.5);
    expect(frame.y, label).toBeGreaterThanOrEqual(map.y - 0.5);
    expect(frame.x + frame.w, label).toBeLessThanOrEqual(map.x + map.w + 0.5);
    expect(frame.y + frame.h, label).toBeLessThanOrEqual(map.y + map.h + 0.5);
    // 맵 위 가운데 칸을 가리지 않는다
    expect(overlapArea(frame, topCenter(map)), `${label} ↔ 맵 위 가운데 칸`).toBe(0);
    if (c.side === 'left') {
      // 맵 왼쪽 위 구석 (맵 끝에서 6px)
      expect(Math.abs(frame.x - (map.x + 6)), `${label} 왼쪽 끝`).toBeLessThanOrEqual(1);
      expect(Math.abs(frame.y - (map.y + 6)), `${label} 위 끝`).toBeLessThanOrEqual(1);
    } else
      expect(Math.abs(frame.x + frame.w - (map.x + map.w - 6)), `${label} 오른쪽 끝`).toBeLessThanOrEqual(1);
    if (c.want)
      for (const [i, v] of r1(frame).entries())
        expect(Math.abs(v - c.want[i]!), `${label} 틀`).toBeLessThanOrEqual(1);
    // 표시 목록에서 잰 미니맵 그림 · 틀 · 제목도 그 틀 자리다 (그린 자리 = 누르는 자리. 틀 그림의 번짐 · 가장자리 표시가 3px 안에서 나온다)
    for (const i of l.items.filter((x) => x.id === 'minimap')) {
      expect(i.x, `${label} 그림`).toBeGreaterThanOrEqual(frame.x - 3);
      expect(i.x + i.w, `${label} 그림`).toBeLessThanOrEqual(frame.x + frame.w + 3);
      expect(i.y + i.h, `${label} 그림`).toBeLessThanOrEqual(frame.y + frame.h + 3);
    }
    // 터치 대상(이동 영역 · 스틱 · 버튼) · 다른 HUD 부품과 겹치지 않는다. 48px · 8px · 가장자리 띠 규칙도 그대로
    expect(frameOverlaps(frame, l, targets), label).toEqual([]);
    expect(touchLayoutProblems(await measureTouchLayout(page)), label).toEqual([]);
    const zone = targets.find((t) => t.id === 'move-zone')!;
    report.push(`${label}: 틀 ${JSON.stringify(r1(frame))} · 이동 영역 위 끝 ${Math.round(zone.y)}`);
    await page.screenshot({
      path: `${SHOTS}/minimap-place-${c.w}x${c.h}-${c.role}${c.mirror ? '-mirror' : ''}.png`,
    });

    // FPS · 핑 칩(맵 왼쪽 위 안쪽이 제자리)은 왼쪽 위 미니맵을 비켜 놓인다 — 틀 · 터치 대상과 안 겹치고 맵 창 안
    if (c.side === 'left' && c.h === 340) {
      await page.evaluate(() => window.__DECOY__!.setMatchPref('perfChip', true));
      await expect.poll(async () => (await prefs(page)).perfChip?.visible === true, POLL).toBe(true);
      const chip = (await prefs(page)).perfChip!;
      expect(overlapArea(frame, chip), `${label} 미니맵 ↔ FPS 칩`).toBe(0);
      expect(chip.x, `${label} FPS 칩`).toBeGreaterThanOrEqual(map.x - 0.5);
      expect(chip.y + chip.h, `${label} FPS 칩`).toBeLessThanOrEqual(map.y + map.h + 0.5);
      for (const t of targets)
        if (t.kind !== 'zone') expect(overlapArea(chip, t), `${label} FPS 칩 ↔ ${t.id}`).toBe(0);
      report.push(`FPS 칩 ${JSON.stringify(r1(chip))}`);
      await page.evaluate(() => window.__DECOY__!.setMatchPref('perfChip', false));
    }

    // 틀 한가운데를 누르고 있는다: 지도 크게 보기가 열리고, 이동 스틱은 생기지 않는다
    const touch = await MultiTouch.attach(page);
    await touch.down(1, frame.x + frame.w / 2, frame.y + frame.h / 2);
    await expect.poll(async () => (await prefs(page)).minimapBig.open, POLL).toBe(true);
    expect(await stickState(page), `${label} 틀을 누른 동안`).toEqual({ live: false, zoneDown: false });
    await touch.up(1);
    // 큰 지도는 맵 창 가운데 (틀은 논리 px — 맵은 논리 화면 가운데에 있다)
    const big = (await prefs(page)).minimapBig.frame!;
    expect(Math.abs(big.x + big.w / 2 - l.viewW / 2), `${label} 큰 지도는 맵 가운데`).toBeLessThan(3);
    // 맵 아무 데나 누르면 닫힌다
    await touch.tap(1, map.x + map.w * 0.6, map.y + map.h * 0.7);
    await expect.poll(async () => (await prefs(page)).minimapBig.open, POLL).toBe(false);
    // 이동 영역은 그대로 쓴다: 영역 안을 누르면 이동 스틱이 생긴다
    await touch.down(2, zone.x + zone.w / 2, zone.y + zone.h / 2);
    await expect.poll(async () => (await stickState(page)).live, POLL).toBe(true);
    expect((await prefs(page)).minimapBig.open, `${label} 이동 영역을 눌러도 지도는 안 열림`).toBe(false);
    await touch.up(2);
    await touch.detach();
    expect(s.problems, label).toEqual([]);
    await s.context.close();
  }

  // 생존자 750×340: 옆 칸(맵 밖) 그대로
  const s = await soloMatch(browser, phone(750, 340), 'runner');
  const frame = await minimapFrame(s.page);
  const l = await hudLayout(s.page);
  expect(l.minimapInset, '750×340 runner 옆 칸').toBe(false);
  expect(frame.x, '750×340 runner 옆 칸').toBeGreaterThanOrEqual(l.map.x + l.map.w - 0.5);
  report.push(`750×340 runner: 옆 칸 ${JSON.stringify(r1(frame))}`);
  expect(s.problems).toEqual([]);
  await s.context.close();
  console.log(`[minimap-place] ${report.join(' / ')}`);
});

test('판 중 창이 낮아짐 (750×369에서 시작한 괴물 → 주소창이 나와 300): 덮인 옆 칸 미니맵은 맵 왼쪽 위 구석으로 — 맵 위 가운데 칸 · 터치 대상 밖, 크기가 돌아오면 처음 자리', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const s = await soloMatch(browser, phone(750, 369), 'monster');
  const { page } = s;
  const home = await minimapFrame(page);
  const start = await hudLayout(page);
  // 시작: 오른쪽 옆 칸 (맵 밖)
  expect(start.minimapInset).toBe(false);
  expect(home.x).toBeGreaterThanOrEqual(start.map.x + start.map.w - 0.5);

  await page.setViewportSize({ width: 750, height: 300 });
  await expect
    .poll(
      async () => (await page.evaluate(() => window.__DECOY__?.getHudLayout()?.minimapInset)) === true,
      POLL,
    )
    .toBe(true);
  // 캔버스가 새 창 높이를 따라온 뒤의 값으로 잰다
  await expect
    .poll(async () => {
      const m = (await page.evaluate(() => window.__DECOY__?.getHudLayout()?.map)) ?? null;
      return m ? Math.round(m.h) : 0;
    }, POLL)
    .toBe(300);
  const low = await hudLayout(page);
  const frame = await minimapFrame(page);
  const map = low.map;
  // 맵 왼쪽 위 구석 (예전: 시스템 버튼 왼쪽 · 맵 가운데에서 오른쪽으로 80px — 틀 (419, 4))
  expect(Math.abs(frame.x - (map.x + 6 * (300 / 369)))).toBeLessThanOrEqual(1.5);
  expect(Math.abs(frame.y - (map.y + 6 * (300 / 369)))).toBeLessThanOrEqual(1.5);
  expect(overlapArea(frame, topCenter(map))).toBe(0);
  expect(frameOverlaps(frame, low, await touchTargets(page))).toEqual([]);
  // 옮긴 미니맵도 누르면 크게 열린다
  const touch = await MultiTouch.attach(page);
  await touch.down(1, frame.x + frame.w / 2, frame.y + frame.h / 2);
  await expect.poll(async () => (await prefs(page)).minimapBig.open, POLL).toBe(true);
  expect(await stickState(page)).toEqual({ live: false, zoneDown: false });
  await touch.up(1);
  await touch.tap(1, map.x + map.w * 0.6, map.y + map.h * 0.7);
  await expect.poll(async () => (await prefs(page)).minimapBig.open, POLL).toBe(false);
  await touch.detach();
  console.log(`[minimap-place] 750×369 → 300: ${JSON.stringify(r1(home))} → ${JSON.stringify(r1(frame))}`);

  await page.setViewportSize({ width: 750, height: 369 });
  await expect
    .poll(async () => {
      const f = (await prefs(page)).minimapTap;
      return f !== null && Math.abs(f.x - home.x) + Math.abs(f.y - home.y) < 1;
    }, POLL)
    .toBe(true);
  expect(await page.evaluate(() => window.__DECOY__?.getHudLayout()?.minimapInset)).toBe(false);
  expect(s.problems).toEqual([]);
  await s.context.close();
});

test('지도만 옮긴 조작 배치(괴물 750×340)면 판 직전 터치 안내는 손으로 다듬은 기본 그림 · 본문 그대로 — 안내 그림은 지도를 그리지 않는다', async ({
  browser,
}) => {
  const { context, page, problems } = await newPlayerPage(browser, phone(750, 340));
  const place = { u: 0.5, v: 0.5, s: 1 };
  await context.addInitScript(
    (raw) => {
      if (localStorage.getItem('decoy:controlLayout') === null)
        localStorage.setItem('decoy:controlLayout', raw);
    },
    JSON.stringify({ v: 1, monster: { mirror: false, items: { minimap: place } } }),
  );
  await createRoom(page);
  await pickRoleAndReady(page, 'monster');
  const card = page.getByTestId('touch-tutorial');
  await expect(card).toBeVisible();
  // 바꾼 배치 그림(자동 그림 + '그림은 내가 바꾼 조작 배치예요')이 아니라 기본 그림(쉬는 이동 스틱 손잡이까지)과 자리 말이 있는 본문
  await expect(page.getByTestId('touch-tutorial-custom')).toHaveCount(0);
  await expect(card.locator('.tt-art .tt-knob')).toHaveCount(1);
  expect(await card.locator('li').allTextContents()).toEqual([...TOUCH_TEXT.tutorialMonster]);
  // 저장한 지도 자리는 그대로다
  const saved = await page.evaluate(() => localStorage.getItem('decoy:controlLayout'));
  expect(JSON.parse(saved ?? 'null')?.monster?.items).toEqual({ minimap: place });
  expect(problems).toEqual([]);
  await context.close();
});

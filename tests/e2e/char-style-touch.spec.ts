// 캐릭터 스타일 — 터치 설정 판 · 터치 조작 안내 카드 · PC 첫 판 조작 안내 (캐릭터 리디자인 2단계, client/src/ui/lifecycleUi.ts ·
// ui/overlays.ts · gfx/charStyle.ts):
//  - 터치 설정 판: 진동 · 프레임 제한 아래 '캐릭터 스타일' 줄(기존 · 새 캐릭터, 고른 칸 = ✓ + 바탕 · aria-pressed). 기본은 기존.
//    새 캐릭터를 누르면 decoy:charStyle = 'new'로 저장하고 바로 적용, 판을 다시 열어도 · 새로고침 뒤에도 그대로, 기존이면 저장값을
//    지운다. 저장소가 막히면 이번 접속에는 적용되고 설정 판에 '저장되지 않아요' 안내
//    (가장 낮은 휴대폰 802×293에서 새 단추까지 화면 안인지는 frame-limit.spec이 본다). 노치 휴대폰 가로(좌우 안전 영역)에서는
//    넓은 두 열 판도 첫 화면 · 방 화면 모두 안전 영역 안(.lobby 사각형 안)
//  - 판 직전 터치 안내 카드: 새 캐릭터면 제목 옆에 내 역할의 정면 그림(svg 하나, 44~56px, 제목과 한 줄), 기존이면 그림이 없다.
//    설정 판에서 바꾸면 카드를 바로 다시 그리고, 같은 팀 안에서 역할을 바꿔도 그 역할 그림으로 바뀐다. 가장 낮은 화면에서도 카드가
//    스크롤되지 않는다. 괴물을 고르면 괴물 그림 하나뿐(남의 역할 그림은 없다)
//  - PC 첫 판 조작 안내: 새 캐릭터면 역할 문양 자리에 내 역할 정면 그림(HUD 이미지 helpFigure, 64 논리 px, 이름 글자 왼쪽 ·
//    같은 높이), 안내가 닫히면 그림도 사라진다. 기존이면 helpFigure가 없다(문양 그대로)
import { expect, test, type Page } from '@playwright/test';
import type { HudLayoutItem, Role } from '@decoy/shared';
import { ROLE, hexCss } from '../../client/src/art/palette';
import { UI_TEXT } from '../../client/src/data/storyText';
import { STORAGE_KEYS } from '../../client/src/storageKeys';
import {
  BASE_QUERY,
  PHONE_LANDSCAPE,
  PHONE_SMALL,
  createRoom,
  dpr1,
  newPlayerPage,
  pickRoleAndReady,
  press,
  waitForSnapshots,
} from './helpers';
import { emulateSafeArea } from './touch';

const KEY = STORAGE_KEYS.charStyle.key;
const POLL = { intervals: [100, 150, 200], timeout: 10_000 };

/** 헤드리스 크롬의 진짜 전체 화면은 창 크기를 바꾼다: 아무것도 하지 않게 한다 (m12-screen과 같다) */
function stubFullscreen(): void {
  Element.prototype.requestFullscreen = function () {
    return Promise.resolve();
  };
}

async function stored(page: Page): Promise<string | null> {
  return page.evaluate((k) => localStorage.getItem(k), KEY);
}

/** 디버그 훅의 지금 스타일 (gfxState.charStyle) */
async function applied(page: Page): Promise<string | null> {
  return page.evaluate(() => window.__DECOY__?.gfx.charStyle ?? null);
}

/** 설정 판 캐릭터 스타일 단추의 aria-pressed [기존, 새 캐릭터] */
async function pressed(page: Page): Promise<(string | null)[]> {
  return Promise.all(
    ['char-style-classic', 'char-style-new'].map((id) => page.getByTestId(id).getAttribute('aria-pressed')),
  );
}

test('터치 설정 판: 캐릭터 스타일 줄(기존 · 새 캐릭터, 기본 기존) — 새 캐릭터를 누르면 저장 · 바로 적용, 다시 열어도 · 새로고침 뒤에도 그대로, 기존이면 저장값 삭제', async ({
  browser,
}) => {
  const { context, page, problems } = await newPlayerPage(browser, dpr1(PHONE_LANDSCAPE));
  await context.addInitScript(stubFullscreen);
  await page.goto(`/?${BASE_QUERY.slice(1)}`);
  const panel = page.getByTestId('settings-panel');
  await press(page.getByTestId('settings-button'));
  await expect(panel).toBeVisible();
  const row = panel.getByTestId('char-style-row');
  await expect(row).toBeVisible();
  await expect(row).toHaveAttribute('role', 'group');
  await expect(row).toHaveAttribute('aria-label', UI_TEXT.charStyle);
  await expect(row).toContainText(UI_TEXT.charStyle);
  await expect(page.getByTestId('char-style-classic')).toHaveText(UI_TEXT.charStyleClassic);
  await expect(page.getByTestId('char-style-new')).toHaveText(UI_TEXT.charStyleNew);
  // 기본 = 기존 (저장값 없음)
  expect(await pressed(page)).toEqual(['true', 'false']);
  expect(await stored(page)).toBeNull();
  expect(await applied(page)).toBe('classic');
  // 고른 칸만 ✓ 아이콘이 보인다 (색만으로 구분하지 않기)
  await expect(page.getByTestId('char-style-classic').locator('.seg-ico')).toBeVisible();
  await expect(page.getByTestId('char-style-new').locator('.seg-ico')).toBeHidden();
  // 새 캐릭터: 저장 + 바로 적용, 판은 열린 채
  await press(page.getByTestId('char-style-new'));
  expect(await pressed(page)).toEqual(['false', 'true']);
  await expect.poll(() => applied(page), POLL).toBe('new');
  expect(await stored(page)).toBe('new');
  await expect(panel).toBeVisible();
  await expect(page.getByTestId('char-style-new').locator('.seg-ico')).toBeVisible();
  await expect(panel.locator('.quality-note')).toBeHidden();
  // 닫았다 다시 열어도
  await press(page.getByTestId('settings-button'));
  await expect(panel).toBeHidden();
  await press(page.getByTestId('settings-button'));
  expect(await pressed(page)).toEqual(['false', 'true']);
  // 새로고침 뒤에도
  await page.reload();
  await expect.poll(() => applied(page), POLL).toBe('new');
  await press(page.getByTestId('settings-button'));
  expect(await pressed(page)).toEqual(['false', 'true']);
  // 기존: 저장값 삭제
  await press(page.getByTestId('char-style-classic'));
  expect(await pressed(page)).toEqual(['true', 'false']);
  await expect.poll(() => applied(page), POLL).toBe('classic');
  expect(await stored(page)).toBeNull();
  expect(problems).toEqual([]);
  await context.close();
});

test('터치 설정 판 · 저장소가 막힌 브라우저: 고른 캐릭터 스타일이 이번 접속에 적용되고 설정 판에 저장되지 않는다는 안내', async ({
  browser,
}) => {
  const { context, page, problems } = await newPlayerPage(browser, dpr1(PHONE_LANDSCAPE));
  await context.addInitScript(stubFullscreen);
  // 쿠키 · 사이트 데이터 차단: localStorage에 접근만 해도 SecurityError (frame-limit · char-style과 같은 흉내)
  await context.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('사이트 데이터 차단', 'SecurityError');
      },
    });
  });
  await page.goto(`/?${BASE_QUERY.slice(1)}`);
  const panel = page.getByTestId('settings-panel');
  await press(page.getByTestId('settings-button'));
  expect(await pressed(page)).toEqual(['true', 'false']);
  await expect(panel.locator('.quality-note')).toBeHidden();
  await press(page.getByTestId('char-style-new'));
  await expect.poll(() => applied(page), POLL).toBe('new');
  expect(await pressed(page)).toEqual(['false', 'true']);
  await expect(panel.locator('.quality-note')).toBeVisible();
  await expect(panel.locator('.quality-note')).toHaveText(UI_TEXT.qualityNotSaved);
  // 다시 열어도 이번 접속에서 고른 값
  await press(page.getByTestId('settings-button'));
  await press(page.getByTestId('settings-button'));
  expect(await pressed(page)).toEqual(['false', 'true']);
  expect(problems).toEqual([]);
  await context.close();
});

/** 설정 판과 판 안 단추 중 안전 영역 밖(.lobby 사각형 밖)인 것: 'testid(또는 글자) 왼,오,위,아래' */
async function outsideSafeArea(page: Page): Promise<{ lobby: number[]; two: boolean; out: string[] }> {
  return page.evaluate(() => {
    const lobby = document.querySelector('[data-testid="lobby"]')!.getBoundingClientRect();
    const panel = document.querySelector<HTMLElement>('[data-testid="settings-panel"]')!;
    const out: string[] = [];
    for (const el of [panel, ...panel.querySelectorAll<HTMLElement>('button')]) {
      const r = el.getBoundingClientRect();
      const tol = 0.5;
      if (
        r.left < lobby.left - tol ||
        r.right > lobby.right + tol ||
        r.top < lobby.top - tol ||
        r.bottom > lobby.bottom + tol
      )
        out.push(
          `${el.dataset.testid ?? el.textContent ?? ''} ${[r.left, r.right, r.top, r.bottom].map(Math.round).join(',')}`,
        );
    }
    return {
      lobby: [lobby.left, lobby.right, lobby.top, lobby.bottom].map(Math.round),
      two: getComputedStyle(panel).display === 'grid',
      out,
    };
  });
}

test('노치 휴대폰 가로(844×390, 좌우 안전 영역 47px): 첫 화면 · 방 화면 모두 두 열 설정 판과 단추가 안전 영역 안', async ({
  browser,
}) => {
  const { context, page, problems } = await newPlayerPage(
    browser,
    dpr1({
      ...PHONE_LANDSCAPE,
      viewport: { width: 844, height: 390 },
      screen: { width: 844, height: 390 },
    }),
  );
  await context.addInitScript(stubFullscreen);
  await emulateSafeArea(page, { left: 47, right: 47, bottom: 21 });
  await page.goto(`/?${BASE_QUERY.slice(1)}&bots=1`);
  const panel = page.getByTestId('settings-panel');
  // 첫 화면: 설정 단추가 오른쪽
  await press(page.getByTestId('settings-button'));
  await expect(panel).toBeVisible();
  const home = await outsideSafeArea(page);
  // 흉내가 들어갔는가 (로비가 안전 영역만큼 들어가 있다) · 넓은 두 열 판인가
  expect(home.lobby).toEqual([47, 797, 0, 369]);
  expect(home.two, '두 열').toBe(true);
  expect(home.out, '첫 화면').toEqual([]);
  await press(page.getByTestId('settings-button'));
  await expect(panel).toBeHidden();
  // 방 화면: 설정 단추가 왼쪽 반 — 판 왼쪽 끝을 단추에 맞추되 오른쪽 안전 영역을 넘지 않는다
  await press(page.getByTestId('create-room'));
  await expect(page.getByTestId('room-code')).toHaveText(/^[A-Z]{4}$/);
  await pickRoleAndReady(page, 'runner');
  await press(page.getByTestId('settings-button'));
  await expect(panel).toBeVisible();
  const room = await outsideSafeArea(page);
  expect(room.two, '두 열').toBe(true);
  expect(room.out, '방 화면').toEqual([]);
  // 새 캐릭터를 골라도(판이 열린 채 다시 그려진다) 그대로
  await press(page.getByTestId('char-style-new'));
  await expect.poll(() => applied(page), POLL).toBe('new');
  expect((await outsideSafeArea(page)).out, '새 캐릭터 고른 뒤').toEqual([]);
  expect(problems).toEqual([]);
  await context.close();
});

/** 방에서 준비를 풀고 다른 역할을 골라 다시 준비한다 (터치 안내 카드는 준비한 뒤에 보인다) */
async function switchRole(page: Page, role: Role): Promise<void> {
  await press(page.getByTestId('ready-button'));
  await expect(page.getByTestId('ready-button')).not.toHaveText('준비 취소');
  await pickRoleAndReady(page, role);
  await expect(page.getByTestId('touch-tutorial')).toBeVisible();
}

/** 터치 안내 카드의 정면 그림 상태: 그림 수, svg 수, 역할색이 든 그림인가, 제목과 한 줄인가, 카드가 스크롤되는가 */
async function cardFigure(page: Page, role: Role) {
  return page.evaluate((color) => {
    const card = document.querySelector<HTMLElement>('[data-testid="touch-tutorial"]');
    const figs = [...document.querySelectorAll<HTMLElement>('[data-testid="touch-tutorial-figure"]')];
    const fig = figs[0];
    const title = card?.querySelector('.tt-title')?.getBoundingClientRect();
    const r = fig?.getBoundingClientRect();
    return {
      count: figs.length,
      svgs: fig ? fig.querySelectorAll(':scope > svg').length : 0,
      hasRoleColor: fig ? fig.innerHTML.toLowerCase().includes(color) : false,
      ariaHidden: fig?.getAttribute('aria-hidden') ?? null,
      size: r ? [Math.round(r.width), Math.round(r.height)] : null,
      // 제목 글자 가운데가 그림 높이 안 (세로로 쌓지 않았다)
      sameLine:
        r && title ? title.top + title.height / 2 > r.top && title.top + title.height / 2 < r.bottom : false,
      leftOfTitle: r && title ? r.right <= title.left + 0.5 : false,
      inCard: (() => {
        const c = card?.getBoundingClientRect();
        return r && c
          ? r.left >= c.left && r.right <= c.right && r.top >= c.top && r.bottom <= c.bottom
          : false;
      })(),
      scrolls: card ? card.scrollHeight > card.clientHeight + 1 : true,
    };
  }, hexCss(ROLE[role]).toLowerCase());
}

test('터치 안내 카드: 기존이면 그림 없음, 설정 판에서 새 캐릭터로 바꾸면 제목 옆에 내 역할 정면 그림 — 역할을 바꾸면 그 역할 그림, 괴물은 괴물 그림 하나 (802×293에서 스크롤 없음)', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const { context, page, problems } = await newPlayerPage(browser, dpr1(PHONE_SMALL));
  await context.addInitScript(stubFullscreen);
  await createRoom(page, '&bots=1');
  await pickRoleAndReady(page, 'runner');
  const card = page.getByTestId('touch-tutorial');
  await expect(card).toBeVisible();
  // 기존: 그림 없음 (예전과 같은 카드)
  await expect(page.getByTestId('touch-tutorial-figure')).toHaveCount(0);
  await expect(card.locator('.tt-head')).toHaveCount(0);
  // 설정 판에서 새 캐릭터 → 카드를 바로 다시 그린다 (설정 판이 열린 동안 카드는 숨는다)
  await press(page.getByTestId('settings-button'));
  await press(page.getByTestId('char-style-new'));
  await expect.poll(() => applied(page), POLL).toBe('new');
  await press(page.getByTestId('settings-button'));
  await expect(page.getByTestId('settings-panel')).toBeHidden();
  await expect(card).toBeVisible();
  await expect(page.getByTestId('touch-tutorial-figure')).toHaveCount(1);
  const runner = await cardFigure(page, 'runner');
  expect(runner).toMatchObject({
    count: 1,
    svgs: 1,
    hasRoleColor: true,
    ariaHidden: 'true',
    sameLine: true,
    leftOfTitle: true,
    inCard: true,
    scrolls: false,
  });
  // 가장 낮은 화면: 44px (CSS)
  expect(runner.size).toEqual([44, 44]);
  // 같은 팀 안에서 역할을 바꾼다 (준비 취소 → 가드 → 준비): 본문은 그대로, 그림은 가드
  await switchRole(page, 'guard');
  await expect.poll(async () => (await cardFigure(page, 'guard')).hasRoleColor, POLL).toBe(true);
  expect(await cardFigure(page, 'guard')).toMatchObject({
    count: 1,
    svgs: 1,
    sameLine: true,
    scrolls: false,
  });
  expect((await cardFigure(page, 'runner')).hasRoleColor).toBe(false);
  // 괴물: 괴물 그림 하나뿐 (본문도 괴물 안내 4줄)
  await switchRole(page, 'monster');
  await expect(card.locator('li')).toHaveCount(4);
  await expect.poll(async () => (await cardFigure(page, 'monster')).hasRoleColor, POLL).toBe(true);
  expect(await cardFigure(page, 'monster')).toMatchObject({
    count: 1,
    svgs: 1,
    sameLine: true,
    inCard: true,
    scrolls: false,
  });
  for (const other of ['runner', 'guard', 'scout'] as const)
    expect((await cardFigure(page, other)).hasRoleColor, `괴물 카드에 ${other} 그림`).toBe(false);
  // 다시 기존: 그림이 빠지고 제목만
  await press(page.getByTestId('settings-button'));
  await press(page.getByTestId('char-style-classic'));
  await press(page.getByTestId('settings-button'));
  await expect(card).toBeVisible();
  await expect(page.getByTestId('touch-tutorial-figure')).toHaveCount(0);
  await expect(card.locator('.tt-head')).toHaveCount(0);
  await expect(card.locator('.tt-title')).toBeVisible();
  expect(problems).toEqual([]);
  await context.close();
});

/** 지금 보이는 첫 판 조작 안내의 HUD 항목 (helpFigure = 정면 그림, help = 패널 · 글자 · 문양) */
async function helpItems(page: Page): Promise<HudLayoutItem[]> {
  return page.evaluate(
    () =>
      window.__DECOY__?.getHudLayout()?.items.filter((i) => i.id === 'help' || i.id === 'helpFigure') ?? [],
  );
}

test('PC 첫 판 조작 안내: 새 캐릭터면 문양 자리에 내 역할 정면 그림(64px, 이름 왼쪽 · 같은 높이)이 있고 안내가 닫히면 사라진다, 기존이면 없다', async ({
  browser,
}) => {
  test.setTimeout(150_000);
  for (const style of ['new', 'classic'] as const) {
    const { context, page, problems } = await newPlayerPage(browser, {
      viewport: { width: 1280, height: 720 },
    });
    // 주소 ?chars (시험용, 저장하지 않는다)
    await createRoom(page, `&bots=1&chars=${style}`);
    expect(await applied(page)).toBe(style);
    await pickRoleAndReady(page, 'scout');
    await page.getByTestId('start-button').click();
    await waitForSnapshots(page, 3);
    await expect.poll(() => page.evaluate(() => window.__DECOY__?.getHud().help), POLL).toBe(true);
    const k = await page.evaluate(() => window.__DECOY__?.getHudLayout()?.cssPerLogical ?? 0);
    expect(k).toBeGreaterThan(0);
    const items = await helpItems(page);
    const figs = items.filter((i) => i.id === 'helpFigure');
    if (style === 'classic') {
      expect(figs, '기존: 정면 그림 없음').toHaveLength(0);
      expect(items.some((i) => i.kind === 'text' && i.text === '스카우트')).toBe(true);
    } else {
      expect(figs).toHaveLength(1);
      const fig = figs[0]!;
      expect(fig.kind).toBe('image');
      // 64 논리 px (getHudLayout은 CSS px. 기기 px 반올림 오차 1px 안)
      expect(Math.abs(fig.w - 64 * k), `폭 ${fig.w}`).toBeLessThanOrEqual(1);
      expect(Math.abs(fig.h - 64 * k), `높이 ${fig.h}`).toBeLessThanOrEqual(1);
      const name = items.find((i) => i.kind === 'text' && i.text === '스카우트');
      expect(name, '역할 이름 글자').toBeDefined();
      expect(name!.x).toBeGreaterThanOrEqual(fig.x + fig.w);
      const mid = name!.y + name!.h / 2;
      expect(mid).toBeGreaterThan(fig.y);
      expect(mid).toBeLessThan(fig.y + fig.h);
    }
    // 아무 키나 누르면 닫히고 그림도 사라진다
    await page.keyboard.press('KeyQ');
    await expect.poll(() => page.evaluate(() => window.__DECOY__?.getHud().help), POLL).toBe(false);
    expect((await helpItems(page)).filter((i) => i.id === 'helpFigure')).toHaveLength(0);
    expect(problems, style).toEqual([]);
    await context.close();
  }
});

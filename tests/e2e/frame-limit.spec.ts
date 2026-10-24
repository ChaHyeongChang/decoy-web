// 프레임 제한 설정 (렌더링 최적화 · 설정 화면 통합, client/src/ui/settingsPanel.ts · settingsModel.ts · gfx/framePacing.ts):
//  - 설정 화면 그래픽 탭 '프레임 제한'(자동 · 60 · 120 · 절반, 고른 칸 = ✓ + 바탕 · aria-pressed) — PC · 터치 같은 화면
//  - 고르면 decoy:frameLimit에 저장(자동이면 지움)하고 바로 적용한다. 적용 결과는 디버그 훅 gfx.frameLimit으로 본다
//    (main.ts가 pacingHooks.setLimit에서 pacer와 gfxState.frameLimit을 바꾸고, 시작할 때 저장값을 읽는다). 새로고침 뒤에도 고른 값
//  - 저장소가 막혀도 이번 접속에는 적용되고(첫 화면을 다시 그려도 고른 값), '저장되지 않아요' 안내는 하나
//  - 주소 ?fpsLimit이 있으면 그 값이 이번 접속에 우선한다: 줄이 잠기고 그 사실을 보이며, 기본값으로 되돌려도 저장값만 지운다
//  - 진동이 없는 기기에도 있고, 가장 낮은 휴대폰 가로(Pixel 5 802×293)에서도 설정 화면이 화면 안이고 단추가 모두 닿는다
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { UI_TEXT } from '../../client/src/data/storyText';
import { FRAME_LIMIT_STORAGE_KEY } from '../../client/src/gfx/framePacing';
import {
  BASE_QUERY,
  PHONE_LANDSCAPE,
  PHONE_SMALL,
  closeSettings,
  dpr1,
  newPlayerPage,
  openSettings,
  press,
} from './helpers';

const POLL = { intervals: [100, 150, 200], timeout: 10_000 };
const LIMITS = ['auto', '60', '120', 'half'] as const;

/** 디버그 훅의 지금 프레임 제한 (main.ts가 적용한 값) */
async function appliedLimit(page: Page): Promise<string | null> {
  return page.evaluate(() => window.__DECOY__?.gfx.frameLimit ?? null);
}

async function stored(page: Page): Promise<string | null> {
  return page.evaluate((k) => localStorage.getItem(k), FRAME_LIMIT_STORAGE_KEY);
}

/** 프레임 제한 칸의 aria-pressed [자동, 60, 120, 절반] */
function pressed(page: Page): Promise<(string | null)[]> {
  return Promise.all(LIMITS.map((l) => page.getByTestId(`frame-limit-${l}`).getAttribute('aria-pressed')));
}

/** 헤드리스에서 진짜 전체 화면이 되면 창 크기가 바뀐다: 요청만 받는다 */
async function stubFullscreen(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    Element.prototype.requestFullscreen = () => Promise.resolve();
  });
}

test('PC 설정 화면 그래픽 탭: 프레임 제한(자동 · 60 · 120 · 절반), 고르면 저장하고 바로 적용 · 새로고침 뒤 그대로 · 자동이면 저장값 삭제', async ({
  browser,
}) => {
  for (const viewport of [
    { width: 960, height: 540 },
    { width: 1280, height: 720 },
  ]) {
    const { context, page, problems } = await newPlayerPage(browser, { viewport });
    const label = `${viewport.width}×${viewport.height}`;
    await page.goto(`/?${BASE_QUERY.slice(1)}`);
    await openSettings(page, 'graphics');
    const row = page.getByTestId('row-frame-limit');
    await expect(row, label).toBeInViewport({ ratio: 1 });
    await expect(row).toHaveAttribute('role', 'group');
    await expect(row).toContainText(UI_TEXT.frameLimit);
    await expect(page.getByTestId('frame-limit-hint')).toHaveText(UI_TEXT.frameLimitHint);
    await expect(row.locator('.seg')).toHaveText([
      UI_TEXT.frameLimitAuto,
      UI_TEXT.frameLimit60,
      UI_TEXT.frameLimit120,
      UI_TEXT.frameLimitHalf,
    ]);
    // 네 칸이 한 줄
    const tops = await Promise.all(
      LIMITS.map(async (l) => Math.round((await page.getByTestId(`frame-limit-${l}`).boundingBox())!.y)),
    );
    expect(new Set(tops).size, label).toBe(1);
    expect(await pressed(page)).toEqual(['true', 'false', 'false', 'false']);
    expect(await stored(page)).toBeNull();
    expect(await appliedLimit(page)).toBe('auto');
    await expect(page.getByTestId('reset-frame-limit')).toBeDisabled();
    if (viewport.width !== 960) {
      expect(problems, label).toEqual([]);
      await context.close();
      continue;
    }
    // 60 → 저장 + 바로 적용
    await press(page.getByTestId('frame-limit-60'));
    await expect.poll(() => appliedLimit(page), POLL).toBe('60');
    expect(await stored(page)).toBe('60');
    await press(page.getByTestId('frame-limit-120'));
    await expect.poll(() => appliedLimit(page), POLL).toBe('120');
    expect(await stored(page)).toBe('120');
    // 고른 칸만 ✓ (색만으로 구분하지 않기)
    const checks = await Promise.all(
      LIMITS.map((l) => page.getByTestId(`frame-limit-${l}`).locator('.seg-ico').isVisible()),
    );
    expect(checks).toEqual([false, false, true, false]);
    // 새로고침: 저장값으로 시작한다
    await page.reload();
    expect(await appliedLimit(page)).toBe('120');
    await openSettings(page, 'graphics');
    expect(await pressed(page)).toEqual(['false', 'false', 'true', 'false']);
    // 절반 (PC 모니터: 화면 주사율의 절반 — 헤드리스 60Hz면 목표 30)
    await press(page.getByTestId('frame-limit-half'));
    await expect.poll(() => appliedLimit(page), POLL).toBe('half');
    expect(await stored(page)).toBe('half');
    expect(await pressed(page)).toEqual(['false', 'false', 'false', 'true']);
    await expect
      .poll(() => page.evaluate(() => window.__DECOY__?.gfx.targetHz), POLL)
      .toBe((await page.evaluate(() => window.__DECOY__?.gfx.displayHz ?? 60)) / 2);
    await press(page.getByTestId('frame-limit-120'));
    await expect.poll(() => appliedLimit(page), POLL).toBe('120');
    // 디버그 훅(같은 적용 경로, 저장하지 않음)
    await page.evaluate(() => window.__DECOY__?.setFrameLimit('60'));
    await expect.poll(() => appliedLimit(page), POLL).toBe('60');
    expect(await stored(page)).toBe('120');
    // 자동: 저장값을 지운다 ('기본값' 단추)
    await press(page.getByTestId('reset-frame-limit'));
    await expect.poll(() => appliedLimit(page), POLL).toBe('auto');
    expect(await stored(page)).toBeNull();
    await page.reload();
    expect(await appliedLimit(page)).toBe('auto');
    // 저장소가 정상이면 '저장되지 않음' 안내는 없다
    await openSettings(page, 'graphics');
    await expect(page.getByTestId('quality-note')).toBeHidden();
    expect(problems, label).toEqual([]);
    await context.close();
  }
});

test('저장소가 막힌 브라우저: 고른 프레임 제한이 이번 접속에 적용되고(첫 화면을 다시 그려도 그 값), 저장되지 않는다는 안내 하나', async ({
  browser,
}) => {
  const { context, page, problems } = await newPlayerPage(browser);
  // 쿠키 · 사이트 데이터 차단: localStorage에 접근만 해도 SecurityError (m10-quality와 같은 흉내)
  await context.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('사이트 데이터 차단', 'SecurityError');
      },
    });
  });
  await page.goto(`/?${BASE_QUERY.slice(1)}`);
  await openSettings(page, 'graphics');
  expect(await pressed(page)).toEqual(['true', 'false', 'false', 'false']);
  await expect(page.getByTestId('quality-note')).toBeHidden();
  await press(page.getByTestId('frame-limit-60'));
  await expect.poll(() => appliedLimit(page), POLL).toBe('60');
  await expect(page.getByTestId('quality-note')).toBeVisible();
  await expect(page.getByTestId('quality-note')).toContainText(UI_TEXT.qualityNotSaved);
  // 품질도 저장하지 못해도 안내는 하나
  await press(page.getByTestId('quality-high'));
  await expect(page.locator('[data-testid="quality-note"]:visible')).toHaveCount(1);
  await closeSettings(page);
  // 첫 화면을 다시 그려도(연습 고르기 → 취소) 이번 접속에서 고른 값
  await page.getByTestId('practice').click();
  await page.getByTestId('practice-cancel').click();
  await openSettings(page, 'graphics');
  expect(await pressed(page)).toEqual(['false', 'true', 'false', 'false']);
  expect(await appliedLimit(page)).toBe('60');
  expect(problems).toEqual([]);
  await context.close();
});

test('주소 ?fpsLimit이 우선: 저장값보다 먼저이고 설정 화면 줄이 잠기며 그 사실을 보인다 — 기본값으로 되돌려도 저장값만 지운다', async ({
  browser,
}) => {
  const { context, page, problems } = await newPlayerPage(browser);
  await page.goto(`/?${BASE_QUERY.slice(1)}`);
  await page.evaluate((k) => localStorage.setItem(k, '120'), FRAME_LIMIT_STORAGE_KEY);
  await page.goto(`/?${BASE_QUERY.slice(1)}&fpsLimit=60`);
  expect(await appliedLimit(page)).toBe('60');
  await openSettings(page, 'graphics');
  expect(await pressed(page)).toEqual(['false', 'true', 'false', 'false']);
  await expect(page.getByTestId('lock-frame-limit')).toBeVisible();
  await expect(page.getByTestId('lock-frame-limit')).toContainText('?fpsLimit=60');
  for (const l of LIMITS)
    await expect(page.getByTestId(`frame-limit-${l}`)).toHaveAttribute('aria-disabled', 'true');
  // 다른 줄은 잠기지 않는다
  await expect(page.getByTestId('lock-quality')).toBeHidden();
  await expect(page.getByTestId('quality-auto')).toHaveAttribute('aria-disabled', 'false');
  // 잠긴 줄은 눌러도 바뀌지 않는다
  await page.getByTestId('frame-limit-120').click({ force: true });
  expect(await appliedLimit(page)).toBe('60');
  expect(await stored(page)).toBe('120');
  // 기본값: 저장값만 지우고 이번 접속은 주소 값
  await expect(page.getByTestId('reset-frame-limit')).toBeEnabled();
  await press(page.getByTestId('reset-frame-limit'));
  await expect.poll(() => stored(page)).toBeNull();
  expect(await appliedLimit(page)).toBe('60');
  await expect(page.getByTestId('reset-frame-limit')).toBeDisabled();
  // 주소 없이 다시 열면 자동 (저장값을 지웠다)
  await page.goto(`/?${BASE_QUERY.slice(1)}`);
  expect(await appliedLimit(page)).toBe('auto');
  await openSettings(page, 'graphics');
  await expect(page.getByTestId('lock-frame-limit')).toBeHidden();
  expect(problems).toEqual([]);
  await context.close();
});

test('터치: PC와 같은 설정 화면에 프레임 제한(자동 · 60 · 120 · 절반, ✓ + 바탕) — 누르면 저장 · 바로 적용, 다시 열어도 · 새로고침 뒤에도 그 값', async ({
  browser,
}) => {
  const { context, page, problems } = await newPlayerPage(browser, dpr1(PHONE_LANDSCAPE));
  await stubFullscreen(context);
  await page.goto(`/?${BASE_QUERY.slice(1)}`);
  await expect(page.locator('select')).toHaveCount(0);
  await openSettings(page, 'graphics');
  const row = page.getByTestId('row-frame-limit');
  await expect(row).toBeVisible();
  await expect(row).toContainText(UI_TEXT.frameLimit);
  await expect(page.getByTestId('frame-limit-hint')).toHaveText(UI_TEXT.frameLimitHint);
  expect(await pressed(page)).toEqual(['true', 'false', 'false', 'false']);
  for (const l of LIMITS) {
    await expect(page.getByTestId(`frame-limit-${l}`)).toBeInViewport({ ratio: 1 });
    expect((await page.getByTestId(`frame-limit-${l}`).boundingBox())!.height).toBeGreaterThanOrEqual(48);
  }
  await press(page.getByTestId('frame-limit-60'));
  expect(await pressed(page)).toEqual(['false', 'true', 'false', 'false']);
  await expect.poll(() => appliedLimit(page), POLL).toBe('60');
  expect(await stored(page)).toBe('60');
  // 닫았다 다시 열어도 그 값
  await closeSettings(page);
  await openSettings(page, 'graphics');
  expect(await pressed(page)).toEqual(['false', 'true', 'false', 'false']);
  // 새로고침 뒤에도
  await page.reload();
  await expect.poll(() => appliedLimit(page), POLL).toBe('60');
  await openSettings(page, 'graphics');
  expect(await pressed(page)).toEqual(['false', 'true', 'false', 'false']);
  await press(page.getByTestId('frame-limit-120'));
  await expect.poll(() => appliedLimit(page), POLL).toBe('120');
  expect(await stored(page)).toBe('120');
  // 자동: 저장값 삭제
  await press(page.getByTestId('frame-limit-auto'));
  expect(await pressed(page)).toEqual(['true', 'false', 'false', 'false']);
  await expect.poll(() => appliedLimit(page), POLL).toBe('auto');
  expect(await stored(page)).toBeNull();
  expect(problems).toEqual([]);
  await context.close();
});

test('터치: 진동이 없는 기기에도 프레임 제한이 있고(진동 줄은 없다), 가장 낮은 휴대폰(802×293)에서도 설정 화면이 화면 안 · 탭 네 개가 스크롤 없이 보이고 단추가 모두 닿는다', async ({
  browser,
}) => {
  const { context, page, problems } = await newPlayerPage(browser, dpr1(PHONE_SMALL));
  await stubFullscreen(context);
  // 진동 API가 없는 기기 (아이폰 사파리 등)
  await context.addInitScript(() => {
    delete (Navigator.prototype as unknown as { vibrate?: unknown }).vibrate;
  });
  await page.goto(`/?${BASE_QUERY.slice(1)}`);
  await openSettings(page, 'graphics');
  const panel = page.getByTestId('settings-panel');
  await expect(panel).toBeInViewport({ ratio: 1 });
  for (const t of ['graphics', 'screen', 'sound', 'controls'])
    await expect(page.getByTestId(`settings-tab-${t}`), t).toBeInViewport({ ratio: 1 });
  await expect(page.getByTestId('row-frame-limit')).toBeVisible();
  await press(page.getByTestId('frame-limit-60'));
  await expect.poll(() => appliedLimit(page), POLL).toBe('60');
  expect(await stored(page)).toBe('60');
  // 본문은 카드 안에서 스크롤한다: 아래 줄 단추도 닿는다
  for (const id of ['char-style-classic', 'char-style-new', 'reset-char-style']) {
    await page.getByTestId(id).scrollIntoViewIfNeeded();
    await expect(page.getByTestId(id), id).toBeInViewport({ ratio: 0.98 });
  }
  await openSettings(page, 'controls');
  await expect(page.getByTestId('haptics-on')).toHaveCount(0);
  // 진동이 있는 같은 낮은 화면: 조작 탭에 진동 · 안내 다시 보기, 누르면 '다시 보여 드려요'
  const vib = await newPlayerPage(browser, dpr1(PHONE_SMALL));
  await stubFullscreen(vib.context);
  await vib.page.goto(`/?${BASE_QUERY.slice(1)}`);
  await openSettings(vib.page, 'controls');
  for (const id of ['haptics-on', 'haptics-off', 'tutorial-replay', 'layout-edit']) {
    await vib.page.getByTestId(id).scrollIntoViewIfNeeded();
    // 본문 스크롤 상자 안: 스크롤 위치의 소수점 반올림으로 1px 미만 잘릴 수 있다
    await expect(vib.page.getByTestId(id), `진동 있음 ${id}`).toBeInViewport({ ratio: 0.98 });
  }
  await press(vib.page.getByTestId('tutorial-replay'));
  const done = vib.page.getByTestId('settings-panel').locator('.life-done');
  await expect(done).toBeVisible();
  await done.scrollIntoViewIfNeeded();
  await expect(done).toBeInViewport({ ratio: 0.98 });
  await expect(vib.page.getByTestId('settings-panel')).toBeInViewport({ ratio: 1 });
  expect([...problems, ...vib.problems]).toEqual([]);
  await vib.context.close();
  await context.close();
});

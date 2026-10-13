// 프레임 제한 설정 (렌더링 최적화, client/src/ui/lobby.ts · ui/lifecycleUi.ts · gfx/framePacing.ts):
//  - PC 첫 화면: 그래픽 선택 상자 오른쪽 같은 줄에 '프레임 제한' 선택 상자(자동 · 60 · 120), 960×540 · 1280×720 첫 화면 안
//  - 고르면 decoy:frameLimit에 저장(자동이면 지움)하고 바로 적용한다. 적용 결과는 디버그 훅 gfx.frameLimit으로 본다
//    (main.ts가 pacingHooks.setLimit에서 pacer와 gfxState.frameLimit을 바꾸고, 시작할 때 저장값을 읽는다). 새로고침 뒤에도 고른 값
//  - 저장소가 막혀도 이번 접속에는 적용되고(첫 화면을 다시 그려도 고른 값), '저장되지 않아요' 안내는 그래픽 줄과 하나를 같이 쓴다
//  - 터치: 첫 화면에는 선택 상자가 없고 설정 판에 자동 · 60 · 120(고른 칸 = ✓ + 바탕, aria-pressed), 진동이 없는 기기에도 있고,
//    가장 낮은 휴대폰 가로(Pixel 5 802×293)에서도 설정 판의 단추가 모두 화면 안
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { UI_TEXT } from '../../client/src/data/storyText';
import { FRAME_LIMIT_STORAGE_KEY } from '../../client/src/gfx/framePacing';
import { BASE_QUERY, PHONE_LANDSCAPE, PHONE_SMALL, dpr1, newPlayerPage, press } from './helpers';

const POLL = { intervals: [100, 150, 200], timeout: 10_000 };
const LIMITS = ['auto', '60', '120'] as const;

/** 디버그 훅의 지금 프레임 제한 (main.ts가 적용한 값) */
async function appliedLimit(page: Page): Promise<string | null> {
  return page.evaluate(() => window.__DECOY__?.gfx.frameLimit ?? null);
}

async function stored(page: Page): Promise<string | null> {
  return page.evaluate((k) => localStorage.getItem(k), FRAME_LIMIT_STORAGE_KEY);
}

/** 헤드리스에서 진짜 전체 화면이 되면 창 크기가 바뀐다: 요청만 받는다 */
async function stubFullscreen(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    Element.prototype.requestFullscreen = () => Promise.resolve();
  });
}

test('PC 첫 화면: 그래픽 옆 같은 줄에 프레임 제한(자동 · 60 · 120), 고르면 저장하고 바로 적용 · 새로고침 뒤 그대로 · 자동이면 저장값 삭제', async ({
  browser,
}) => {
  for (const viewport of [
    { width: 960, height: 540 },
    { width: 1280, height: 720 },
  ]) {
    const { context, page, problems } = await newPlayerPage(browser, { viewport });
    const label = `${viewport.width}×${viewport.height}`;
    await page.goto(`/?${BASE_QUERY.slice(1)}`);
    const select = page.getByTestId('frame-limit-select');
    await expect(select, label).toBeInViewport({ ratio: 1 });
    // 그래픽 선택 상자와 한 줄, 그 오른쪽 (같은 선택 상자 모양)
    const q = (await page
      .locator('label.field-select', { has: page.getByTestId('quality-select') })
      .boundingBox())!;
    const f = (await page.locator('label.field-select', { has: select }).boundingBox())!;
    expect(Math.abs(q.y - f.y), `${label} 같은 줄`).toBeLessThan(1);
    expect(Math.abs(q.height - f.height), `${label} 같은 높이`).toBeLessThan(1);
    expect(f.x, `${label} 오른쪽`).toBeGreaterThanOrEqual(q.x + q.width);
    await expect(page.locator('label.field-select', { has: select })).toContainText(UI_TEXT.frameLimit);
    expect(
      await select.locator('option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value)),
    ).toEqual([...LIMITS]);
    await expect(select.locator('option')).toHaveText([
      UI_TEXT.frameLimitAuto,
      UI_TEXT.frameLimit60,
      UI_TEXT.frameLimit120,
    ]);
    await expect(select).toHaveValue('auto');
    expect(await stored(page)).toBeNull();
    expect(await appliedLimit(page)).toBe('auto');
    if (viewport.width !== 960) {
      expect(problems, label).toEqual([]);
      await context.close();
      continue;
    }
    // 60 → 저장 + 바로 적용
    await select.selectOption('60');
    await expect.poll(() => appliedLimit(page), POLL).toBe('60');
    expect(await stored(page)).toBe('60');
    await select.selectOption('120');
    await expect.poll(() => appliedLimit(page), POLL).toBe('120');
    expect(await stored(page)).toBe('120');
    // 새로고침: 저장값으로 시작한다
    await page.reload();
    await expect(page.getByTestId('frame-limit-select')).toHaveValue('120');
    expect(await appliedLimit(page)).toBe('120');
    // 디버그 훅(같은 적용 경로, 저장하지 않음)
    await page.evaluate(() => window.__DECOY__?.setFrameLimit('60'));
    await expect.poll(() => appliedLimit(page), POLL).toBe('60');
    expect(await stored(page)).toBe('120');
    // 자동: 저장값을 지운다
    await page.getByTestId('frame-limit-select').selectOption('auto');
    await expect.poll(() => appliedLimit(page), POLL).toBe('auto');
    expect(await stored(page)).toBeNull();
    await page.reload();
    await expect(page.getByTestId('frame-limit-select')).toHaveValue('auto');
    expect(await appliedLimit(page)).toBe('auto');
    // 저장소가 정상이면 '저장되지 않음' 안내는 없다
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
  const select = page.getByTestId('frame-limit-select');
  await expect(select).toHaveValue('auto');
  await expect(page.getByTestId('quality-note')).toBeHidden();
  await select.selectOption('60');
  await expect.poll(() => appliedLimit(page), POLL).toBe('60');
  await expect(page.getByTestId('quality-note')).toBeVisible();
  await expect(page.getByTestId('quality-note')).toContainText(UI_TEXT.qualityNotSaved);
  // 그래픽도 저장하지 못해도 안내는 하나
  await page.getByTestId('quality-select').selectOption('high');
  await expect(page.locator('[data-testid="quality-note"]:visible')).toHaveCount(1);
  // 첫 화면을 다시 그려도(연습 고르기 → 취소) 이번 접속에서 고른 값
  await page.getByTestId('practice').click();
  await page.getByTestId('practice-cancel').click();
  await expect(page.getByTestId('frame-limit-select')).toHaveValue('60');
  expect(await appliedLimit(page)).toBe('60');
  expect(problems).toEqual([]);
  await context.close();
});

test('터치: 첫 화면에 선택 상자 없이 설정 판에 프레임 제한(자동 · 60 · 120, ✓ + 바탕) — 누르면 저장 · 바로 적용, 다시 열어도 · 새로고침 뒤에도 그 값', async ({
  browser,
}) => {
  const { context, page, problems } = await newPlayerPage(browser, dpr1(PHONE_LANDSCAPE));
  await stubFullscreen(context);
  await page.goto(`/?${BASE_QUERY.slice(1)}`);
  await expect(page.getByTestId('quality-select')).toBeVisible();
  await expect(page.getByTestId('frame-limit-select')).toHaveCount(0);
  const panel = page.getByTestId('settings-panel');
  await press(page.getByTestId('settings-button'));
  await expect(panel).toBeVisible();
  const row = panel.getByTestId('frame-limit-row');
  await expect(row).toBeVisible();
  await expect(row).toHaveAttribute('role', 'group');
  await expect(row).toHaveAttribute('aria-label', UI_TEXT.frameLimit);
  await expect(row).toContainText(UI_TEXT.frameLimit);
  await expect(panel.getByTestId('frame-limit-hint')).toHaveText(UI_TEXT.frameLimitHint);
  const pressed = (): Promise<(string | null)[]> =>
    Promise.all(LIMITS.map((l) => page.getByTestId(`frame-limit-${l}`).getAttribute('aria-pressed')));
  await expect(page.getByTestId('frame-limit-60')).toHaveText(UI_TEXT.frameLimit60);
  expect(await pressed()).toEqual(['true', 'false', 'false']);
  // 고른 칸만 ✓ (색만으로 구분하지 않기)
  const checks = (): Promise<boolean[]> =>
    Promise.all(LIMITS.map((l) => page.getByTestId(`frame-limit-${l}`).locator('.seg-ico').isVisible()));
  expect(await checks()).toEqual([true, false, false]);
  // 세 칸이 '프레임 제한' 이름과 한 줄, 판 안
  const tops = await Promise.all(
    LIMITS.map(async (l) => Math.round((await page.getByTestId(`frame-limit-${l}`).boundingBox())!.y)),
  );
  expect(new Set(tops).size).toBe(1);
  for (const l of LIMITS) await expect(page.getByTestId(`frame-limit-${l}`)).toBeInViewport({ ratio: 1 });

  await press(page.getByTestId('frame-limit-60'));
  expect(await pressed()).toEqual(['false', 'true', 'false']);
  expect(await checks()).toEqual([false, true, false]);
  await expect.poll(() => appliedLimit(page), POLL).toBe('60');
  expect(await stored(page)).toBe('60');
  // 닫았다 다시 열어도 그 값
  await press(page.getByTestId('settings-button'));
  await expect(panel).toBeHidden();
  await press(page.getByTestId('settings-button'));
  expect(await pressed()).toEqual(['false', 'true', 'false']);
  // 새로고침 뒤에도
  await page.reload();
  await expect.poll(() => appliedLimit(page), POLL).toBe('60');
  await press(page.getByTestId('settings-button'));
  expect(await pressed()).toEqual(['false', 'true', 'false']);
  await press(page.getByTestId('frame-limit-120'));
  await expect.poll(() => appliedLimit(page), POLL).toBe('120');
  expect(await stored(page)).toBe('120');
  // 자동: 저장값 삭제
  await press(page.getByTestId('frame-limit-auto'));
  expect(await pressed()).toEqual(['true', 'false', 'false']);
  await expect.poll(() => appliedLimit(page), POLL).toBe('auto');
  expect(await stored(page)).toBeNull();
  expect(problems).toEqual([]);
  await context.close();
});

test('터치: 진동이 없는 기기에도 설정 판에 프레임 제한이 있고, 가장 낮은 휴대폰(802×293)에서도 설정 판 단추가 모두 화면 안', async ({
  browser,
}) => {
  const { context, page, problems } = await newPlayerPage(browser, dpr1(PHONE_SMALL));
  await stubFullscreen(context);
  // 진동 API가 없는 기기 (아이폰 사파리 등)
  await context.addInitScript(() => {
    delete (Navigator.prototype as unknown as { vibrate?: unknown }).vibrate;
  });
  await page.goto(`/?${BASE_QUERY.slice(1)}`);
  await press(page.getByTestId('settings-button'));
  const panel = page.getByTestId('settings-panel');
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId('haptics-on')).toHaveCount(0);
  await expect(panel.getByTestId('frame-limit-row')).toBeVisible();
  for (const id of ['frame-limit-auto', 'frame-limit-60', 'frame-limit-120', 'tutorial-replay'])
    await expect(page.getByTestId(id), id).toBeInViewport({ ratio: 1 });
  await press(page.getByTestId('frame-limit-60'));
  await expect.poll(() => appliedLimit(page), POLL).toBe('60');
  expect(await stored(page)).toBe('60');
  // 진동이 있는 같은 낮은 화면: 진동 줄까지 든 판도 화면 안
  const vib = await newPlayerPage(browser, dpr1(PHONE_SMALL));
  await stubFullscreen(vib.context);
  await vib.page.goto(`/?${BASE_QUERY.slice(1)}`);
  await press(vib.page.getByTestId('settings-button'));
  for (const id of [
    'haptics-on',
    'haptics-off',
    'frame-limit-auto',
    'frame-limit-60',
    'frame-limit-120',
    'tutorial-replay',
  ])
    await expect(vib.page.getByTestId(id), `진동 있음 ${id}`).toBeInViewport({ ratio: 1 });
  expect([...problems, ...vib.problems]).toEqual([]);
  await vib.context.close();
  await context.close();
});

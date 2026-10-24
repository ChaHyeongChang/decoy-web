// 설정 화면 통합 (client/src/ui/settingsPanel.ts · settingsModel.ts · prefs.ts):
//  - PC · 휴대폰이 같은 구성: 탭 그래픽 · 화면 · 소리 · 조작 (첫 화면 · 방 화면 · 빠른 매칭 대기의 '설정' 단추)
//  - 화면 · 소리 · 조작 설정은 'decoy:settings' 한 키에 저장(기본값이면 저장하지 않음), 새로 열면 복원. 항목별 '기본값' ·
//    '모두 기본값으로'(두 번 눌러 확인)
//  - UI 크기는 로비 · 설정 화면(DOM)에 바로 (--ui-zoom)
//  - 휴대폰 뷰포트(800×360 · 915×412 · 802×293 · 태블릿 1024×640): 설정 화면이 화면 안, 탭 넷이 스크롤 없이, 가로 스크롤 없음.
//    화면 그림은 artifacts/screens/settings-*.png (CI 기록)
// 판 중 설정(탭 셋 · 입력 멈춤 · 프레임)은 settings-match.spec.ts
import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { APP_TEXT, SETTINGS_TEXT } from '../../client/src/data/storyText';
import { STORAGE_KEYS } from '../../client/src/storageKeys';
import {
  BASE_QUERY,
  PHONE_BROWSER,
  PHONE_LANDSCAPE,
  PHONE_SMALL,
  TABLET_LANDSCAPE,
  closeSettings,
  createRoom,
  dpr1,
  newPlayerPage,
  openSettings,
  press,
  type DeviceOptions,
} from './helpers';

const SETTINGS_KEY = STORAGE_KEYS.settings.key;
const SHOTS = 'artifacts/screens';

async function storedPrefs(page: Page): Promise<Record<string, unknown> | null> {
  const raw = await page.evaluate((k) => localStorage.getItem(k), SETTINGS_KEY);
  return raw === null ? null : (JSON.parse(raw) as Record<string, unknown>);
}

function stubFullscreen(): void {
  Element.prototype.requestFullscreen = function () {
    return Promise.resolve();
  };
}

test('PC · 휴대폰 같은 구성: 탭 그래픽 · 화면 · 소리 · 조작, 첫 화면 · 방 화면에서 열고 닫는다 (Esc · 닫기 · 막)', async ({
  browser,
}) => {
  for (const dev of [undefined, dpr1(PHONE_LANDSCAPE)] as (DeviceOptions | undefined)[]) {
    const { context, page, problems, touch } = await newPlayerPage(browser, dev);
    const label = touch ? '휴대폰' : 'PC';
    await context.addInitScript(stubFullscreen);
    await page.goto(`/?${BASE_QUERY.slice(1)}`);
    await openSettings(page, 'graphics');
    await expect(page.getByTestId('settings-panel')).toHaveAttribute('aria-modal', 'true');
    await expect(page.locator('[role="tab"]:visible'), label).toHaveText([
      SETTINGS_TEXT.tabGraphics,
      SETTINGS_TEXT.tabScreen,
      SETTINGS_TEXT.tabSound,
      SETTINGS_TEXT.tabControls,
    ]);
    // 로비에서는 판 중 안내가 없다
    await expect(page.getByTestId('settings-inmatch')).toBeHidden();
    // 탭마다 그 탭 줄만 보인다
    const rowsOf = async (tab: string): Promise<string[]> =>
      page
        .getByTestId(`settings-page-${tab}`)
        .locator('[data-testid^="row-"]:visible')
        .evaluateAll((els) => els.map((e) => e.getAttribute('data-testid') ?? ''));
    expect(await rowsOf('graphics'), label).toEqual(['row-quality', 'row-frame-limit', 'row-char-style']);
    await openSettings(page, 'screen');
    expect(await rowsOf('screen'), label).toEqual([
      'row-ui-size',
      'row-reduce-shake',
      'row-reduce-flash',
      'row-perf-chip',
    ]);
    await openSettings(page, 'sound');
    expect(await rowsOf('sound'), label).toEqual([
      'row-vol-master',
      'row-vol-sfx',
      'row-vol-ui',
      'row-muted',
    ]);
    await openSettings(page, 'controls');
    // 조작 탭: 터치 기기는 조이스틱 · 진동 · 배치 편집 · 안내 다시 보기, PC는 키보드 · 마우스 조작. 둘 다 화면 밖 화살표 설명
    const controls = await rowsOf('controls');
    if (touch) expect(controls.slice(0, 2)).toEqual(['row-stick-size', 'row-stick-clear']);
    else expect(controls).toEqual(['row-controls-help', 'row-edge-help']);
    expect(controls).toContain('row-edge-help');
    // Esc · 닫기 · 막
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('settings-panel')).toBeHidden();
    await openSettings(page, 'graphics');
    await closeSettings(page);
    await openSettings(page, 'sound');
    await page.mouse.click(4, 200);
    await expect(page.getByTestId('settings-panel')).toBeHidden();
    // 다시 열면 지난 탭
    await press(page.getByTestId('settings-button'));
    await expect(page.getByTestId('settings-tab-sound')).toHaveAttribute('aria-selected', 'true');
    await closeSettings(page);
    // 방 화면에서도
    await press(page.getByTestId('create-room'));
    await expect(page.getByTestId('room-code')).toHaveText(/^[A-Z]{4}$/);
    await openSettings(page, 'graphics');
    await closeSettings(page);
    expect(problems, label).toEqual([]);
    await context.close();
  }
});

test('화면 · 소리 설정 저장 · 복원: 고르면 decoy:settings에 바꾼 칸만 적고, 새로 열면 그대로 — 항목별 기본값 · 모두 기본값으로(두 번 눌러 확인)', async ({
  browser,
}) => {
  const { context, page, problems } = await newPlayerPage(browser);
  await page.goto(`/?${BASE_QUERY.slice(1)}`);
  expect(await storedPrefs(page)).toBeNull();
  await openSettings(page, 'screen');
  await press(page.getByTestId('ui-size-large'));
  await press(page.getByTestId('reduce-shake-on'));
  await press(page.getByTestId('reduce-flash-on'));
  await press(page.getByTestId('perf-chip-on'));
  await openSettings(page, 'sound');
  await page.getByTestId('vol-master').fill('70');
  await page.getByTestId('vol-sfx').fill('40');
  await page.getByTestId('vol-ui').fill('0');
  await expect(page.getByTestId('vol-sfx-value')).toHaveText('40%');
  await press(page.getByTestId('muted-on'));
  expect(await storedPrefs(page)).toEqual({
    v: 1,
    uiSize: 'large',
    reduceShake: true,
    reduceFlash: true,
    perfChip: true,
    volMaster: 70,
    volSfx: 40,
    volUi: 0,
    muted: true,
  });
  // 새로 열면 복원
  await page.reload();
  await openSettings(page, 'screen');
  for (const id of ['ui-size-large', 'reduce-shake-on', 'reduce-flash-on', 'perf-chip-on'])
    await expect(page.getByTestId(id), id).toHaveAttribute('aria-pressed', 'true');
  await openSettings(page, 'sound');
  await expect(page.getByTestId('vol-master')).toHaveValue('70');
  await expect(page.getByTestId('vol-sfx')).toHaveValue('40');
  await expect(page.getByTestId('vol-ui')).toHaveValue('0');
  await expect(page.getByTestId('muted-on')).toHaveAttribute('aria-pressed', 'true');
  // 항목별 기본값: 그 칸만 지운다
  await press(page.getByTestId('reset-vol-sfx'));
  await expect(page.getByTestId('vol-sfx')).toHaveValue('100');
  await expect(page.getByTestId('reset-vol-sfx')).toBeDisabled();
  expect((await storedPrefs(page))?.volSfx).toBeUndefined();
  expect((await storedPrefs(page))?.volMaster).toBe(70);
  // 모두 기본값으로: 첫 누름은 확인 안내만, 두 번째에 되돌린다 (그래픽 저장값까지)
  await openSettings(page, 'graphics');
  await press(page.getByTestId('quality-high'));
  await press(page.getByTestId('settings-reset-all'));
  await expect(page.getByTestId('settings-reset-done')).toHaveText(SETTINGS_TEXT.resetAllConfirm);
  expect((await storedPrefs(page))?.volMaster).toBe(70);
  await press(page.getByTestId('settings-reset-all'));
  await expect(page.getByTestId('settings-reset-done')).toHaveText(SETTINGS_TEXT.resetAllDone);
  expect(await storedPrefs(page)).toBeNull();
  expect(await page.evaluate((k) => localStorage.getItem(k), STORAGE_KEYS.quality.key)).toBeNull();
  await expect(page.getByTestId('quality-auto')).toHaveAttribute('aria-pressed', 'true');
  await openSettings(page, 'screen');
  await expect(page.getByTestId('ui-size-normal')).toHaveAttribute('aria-pressed', 'true');
  for (const id of ['reset-ui-size', 'reset-reduce-shake', 'reset-reduce-flash', 'reset-perf-chip'])
    await expect(page.getByTestId(id), id).toBeDisabled();
  expect(problems).toEqual([]);
  await context.close();
});

test('UI 크기: 크게 · 아주 크게면 로비 · 설정 화면이 바로 커지고(--ui-zoom 1.15 · 1.3), 보통이면 그대로', async ({
  browser,
}) => {
  const { context, page, problems } = await newPlayerPage(browser, {
    viewport: { width: 1280, height: 720 },
  });
  await page.goto(`/?${BASE_QUERY.slice(1)}`);
  const zoomOf = (sel: string): Promise<number> =>
    page.evaluate((s) => Number(getComputedStyle(document.querySelector(s)!).zoom), sel);
  const buttonH = async (): Promise<number> => (await page.getByTestId('quick-match').boundingBox())!.height;
  expect(await zoomOf('.lobby-content')).toBe(1);
  const h0 = await buttonH();
  await openSettings(page, 'screen');
  const tabH0 = (await page.getByTestId('settings-tab-screen').boundingBox())!.height;
  await press(page.getByTestId('ui-size-xlarge'));
  await expect.poll(() => zoomOf('.lobby-content')).toBeCloseTo(1.3, 5);
  expect(await zoomOf('.set-card')).toBeCloseTo(1.3, 5);
  const tabH1 = (await page.getByTestId('settings-tab-screen').boundingBox())!.height;
  expect(tabH1 / tabH0).toBeGreaterThan(1.25);
  await closeSettings(page);
  expect((await buttonH()) / h0).toBeGreaterThan(1.25);
  // 첫 화면 패널은 가로로 넘치지 않는다 (세로는 스크롤)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await openSettings(page, 'screen');
  await press(page.getByTestId('ui-size-normal'));
  await expect.poll(() => zoomOf('.lobby-content')).toBe(1);
  expect(problems).toEqual([]);
  await context.close();
});

test('휴대폰 뷰포트: 800×360 · 915×412 · 802×293 · 태블릿 1024×640에서 설정 화면이 화면 안, 탭 넷이 스크롤 없이, 가로 스크롤 없음 (화면 그림 남김)', async ({
  browser,
}) => {
  test.setTimeout(150_000);
  mkdirSync(SHOTS, { recursive: true });
  const cases: [string, DeviceOptions][] = [
    ['800x360', { ...PHONE_BROWSER, viewport: { width: 800, height: 360 } }],
    ['915x412', PHONE_LANDSCAPE],
    ['802x293', PHONE_SMALL],
    ['1024x640', TABLET_LANDSCAPE],
  ];
  for (const [name, dev] of cases) {
    const { context, page, problems } = await newPlayerPage(browser, dpr1(dev));
    await context.addInitScript(stubFullscreen);
    await page.goto(`/?${BASE_QUERY.slice(1)}`);
    await expect(page.getByTestId('settings-button'), name).toBeInViewport({ ratio: 1 });
    for (const tab of ['graphics', 'screen', 'sound', 'controls'] as const) {
      await openSettings(page, tab);
      const panel = page.getByTestId('settings-panel');
      await expect(panel, `${name} ${tab}`).toBeInViewport({ ratio: 1 });
      for (const t of ['graphics', 'screen', 'sound', 'controls'])
        await expect(page.getByTestId(`settings-tab-${t}`), `${name} ${tab} 탭 ${t}`).toBeInViewport({
          ratio: 1,
        });
      await expect(page.getByTestId('settings-close'), name).toBeInViewport({ ratio: 1 });
      await expect(page.getByTestId('settings-reset-all'), name).toBeInViewport({ ratio: 1 });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        `${name} 가로 스크롤 없음`,
      ).toBe(true);
      // 손가락 대상 48px 이상 (탭 · 닫기 · 고르는 칸 · 기본값)
      const small = await panel.evaluate((el) =>
        [...el.querySelectorAll<HTMLElement>('button, input[type="range"]')]
          .filter((b) => b.offsetParent !== null)
          .map((b) => ({ id: b.dataset.testid ?? b.textContent ?? '', h: b.getBoundingClientRect().height }))
          .filter((b) => b.h < 47.5),
      );
      expect(small, `${name} ${tab} 48px 미만`).toEqual([]);
      await page.screenshot({ path: `${SHOTS}/settings-${name}-${tab}.png` });
    }
    // 방 화면 설정 단추도 닿는다
    await closeSettings(page);
    expect(problems, name).toEqual([]);
    await context.close();
  }
});

test('방 화면 (가장 낮은 휴대폰): 명령 줄의 설정 단추로 열고, 조작 탭에 배치 편집 단추가 있다', async ({
  browser,
}) => {
  const { context, page, problems } = await newPlayerPage(browser, dpr1(PHONE_SMALL));
  await context.addInitScript(stubFullscreen);
  await createRoom(page, '&bots=1');
  const b = page.getByTestId('settings-button');
  await expect(b).toBeVisible();
  await expect(b).toHaveText(APP_TEXT.settings);
  await openSettings(page, 'controls');
  await expect(page.getByTestId('layout-edit')).toBeVisible();
  await closeSettings(page);
  expect(problems).toEqual([]);
  await context.close();
});

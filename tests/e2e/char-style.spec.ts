// 캐릭터 스타일 설정 (캐릭터 리디자인 2단계, client/src/gfx/charStyle.ts · ui/lobby.ts · ui/result.ts):
//  - 설정 화면(설정 화면 통합) 그래픽 탭 '캐릭터 스타일'(새 캐릭터 · 기존), 960×540 · 1280×720 화면 안. 기본은 새 캐릭터.
//    고르면 decoy:charStyle에 저장하고 바로 적용, 새로고침 뒤에도 그대로, '기본값'으로 되돌리면 저장값을 지운다
//  - 저장소가 막혀도 이번 접속에는 적용되고, '저장되지 않아요' 안내 하나. 주소 ?chars가 있으면 그 값이 우선이고 줄이 잠긴다
//  - 방 역할 카드 · 연습 역할 고르기 · 빠른 매칭 대기의 역할 그림: 새 캐릭터면 정면 그림('front' 클래스, 그림 하나 = svg 하나),
//    기존이면 위에서 본 실루엣. 방 · 대기 화면에서 스타일이 바뀌면 카드를 바로 다시 그린다(대기 남은 시간 글자는 비지 않는다)
//  - 새 캐릭터 내 역할 카드: 좁은 휴대폰(658×320) · 좁은 창에서 '내 역할' 배지가 정면 그림 머리를 가리지 않는다(그림을 비켜 세움)
//  - 결과 화면 팀 문장: 새 캐릭터면 생존자 승리 = 정면 그림 svg 3개, 괴물 승리 = 괴물 정면 그림(기존은 문양). 결과 상자 높이는 그대로
// 스타일은 그림만 바꾼다(서버로 보내지 않는다) — 규칙 · 판정은 다른 시험이 본다
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { Role } from '@decoy/shared';
import { UI_TEXT } from '../../client/src/data/storyText';
import { STORAGE_KEYS } from '../../client/src/storageKeys';
import {
  BASE_QUERY,
  PC_NARROW,
  closeSettings,
  openSettings,
  PHONE_LANDSCAPE,
  PHONE_NARROW,
  PHONE_SMALL,
  TABLET_LANDSCAPE,
  createRoom,
  dpr1,
  newPlayerPage,
  pickRoleAndReady,
  press,
  sendTest,
  truth,
  waitForSnapshots,
  type DeviceOptions,
} from './helpers';

const KEY = STORAGE_KEYS.charStyle.key;

async function stored(page: Page): Promise<string | null> {
  return page.evaluate((k) => localStorage.getItem(k), KEY);
}

/** 디버그 훅의 지금 스타일 (gfxState.charStyle) */
async function applied(page: Page): Promise<string | null> {
  return page.evaluate(() => window.__DECOY__?.gfx.charStyle ?? null);
}

/**
 * 그림 상자들이 모두 한 스타일로 그려졌는가: 상자마다 svg 하나, 새 캐릭터면 상자에 'front' 클래스가 있고 svg 안에 정면 그림
 * (frontFigureSvg — 배율을 건 g 하나), 기존이면 둘 다 없다. 상자 수를 돌려준다
 */
async function expectFigures(boxes: Locator, front: boolean, label: string): Promise<number> {
  const info = await boxes.evaluateAll((els) =>
    els.map((el) => ({
      front: el.classList.contains('front'),
      // '내 역할' 배지의 ✓ 아이콘(svg)은 그림이 아니다: 바로 아래 svg만 센다
      svgs: el.querySelectorAll(':scope > svg').length,
      drawn: el.querySelectorAll(':scope > svg > g[transform*="scale("]').length,
    })),
  );
  for (const [i, f] of info.entries()) {
    expect(f.svgs, `${label} ${i}: svg 하나`).toBe(1);
    expect(f.front, `${label} ${i}: front 클래스`).toBe(front);
    expect(f.drawn, `${label} ${i}: 정면 그림`).toBe(front ? 1 : 0);
  }
  return info.length;
}

test('설정 화면 그래픽 탭: 캐릭터 스타일(새 캐릭터 · 기존), 기본 새 캐릭터 · 고르면 저장하고 바로 적용 · 새로고침 뒤 그대로 · 기본값으로 되돌리면 저장값 삭제', async ({
  browser,
}) => {
  for (const viewport of [
    { width: 960, height: 540 },
    { width: 1280, height: 720 },
  ]) {
    const { context, page, problems } = await newPlayerPage(browser, { viewport });
    const label = `${viewport.width}×${viewport.height}`;
    await page.goto(`/?${BASE_QUERY.slice(1)}`);
    // 예전 PC 첫 화면 선택 상자는 없다 (설정 화면 하나)
    await expect(page.locator('select')).toHaveCount(0);
    await page.getByTestId('name-input').fill('스타일');
    await openSettings(page, 'graphics');
    const row = page.getByTestId('row-char-style');
    await expect(row, label).toBeInViewport({ ratio: 1 });
    await expect(row).toContainText(UI_TEXT.charStyle);
    await expect(row.locator('.seg')).toHaveText([UI_TEXT.charStyleNew, UI_TEXT.charStyleClassic]);
    await expect(page.getByTestId('char-style-new')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('reset-char-style')).toBeDisabled();
    expect(await stored(page)).toBeNull();
    expect(await applied(page)).toBe('new');
    if (viewport.width !== 960) {
      expect(problems, label).toEqual([]);
      await context.close();
      continue;
    }
    // 기존 → 저장 + 바로 적용 (첫 화면은 다시 그리지 않는다: 입력한 이름이 남는다)
    await press(page.getByTestId('char-style-classic'));
    await expect.poll(() => applied(page)).toBe('classic');
    expect(await stored(page)).toBe('classic');
    await expect(page.getByTestId('char-style-classic')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('reset-char-style')).toBeEnabled();
    await expect(page.getByTestId('quality-note')).toBeHidden();
    await closeSettings(page);
    await expect(page.getByTestId('name-input')).toHaveValue('스타일');
    // 연습 역할 고르기: 위에서 본 실루엣 넷
    await page.getByTestId('practice').click();
    await expect(page.getByTestId('practice-picker')).toBeVisible();
    expect(await expectFigures(page.locator('.pr-figure'), false, '연습 고르기 (기존)')).toBe(4);
    // 고르기가 열린 채 바뀌어도(디버그 훅 — 저장하지 않음) 그림을 맞춘다
    await page.evaluate(() => window.__DECOY__?.setCharStyle('new'));
    expect(await expectFigures(page.locator('.pr-figure'), true, '연습 고르기')).toBe(4);
    expect(await stored(page)).toBe('classic');
    await page.evaluate(() => window.__DECOY__?.setCharStyle('classic'));
    await page.getByTestId('practice-cancel').click();
    // 새로고침: 저장값으로 시작한다
    await page.reload();
    expect(await applied(page)).toBe('classic');
    await openSettings(page, 'graphics');
    await expect(page.getByTestId('char-style-classic')).toHaveAttribute('aria-pressed', 'true');
    // 기본값: 저장값을 지우고 새 캐릭터
    await press(page.getByTestId('reset-char-style'));
    await expect.poll(() => applied(page)).toBe('new');
    expect(await stored(page)).toBeNull();
    await expect(page.getByTestId('char-style-new')).toHaveAttribute('aria-pressed', 'true');
    await page.reload();
    expect(await applied(page)).toBe('new');
    await expect(page.getByTestId('quality-note')).toBeHidden();
    expect(problems, label).toEqual([]);
    await context.close();
  }
});

test('터치: PC와 같은 설정 화면 (그래픽 탭에 품질 · 프레임 제한 · 캐릭터 스타일), 첫 화면에 선택 상자가 없다', async ({
  browser,
}) => {
  const { context, page, problems } = await newPlayerPage(browser, dpr1(PHONE_LANDSCAPE));
  await page.goto(`/?${BASE_QUERY.slice(1)}`);
  await expect(page.locator('select')).toHaveCount(0);
  await expect(page.getByTestId('settings-button')).toBeInViewport({ ratio: 1 });
  await openSettings(page, 'graphics');
  for (const id of ['row-quality', 'row-frame-limit', 'row-char-style'])
    await expect(page.getByTestId(id), id).toBeVisible();
  await expect(page.getByTestId('char-style-new')).toHaveAttribute('aria-pressed', 'true');
  expect(problems).toEqual([]);
  await context.close();
});

test('저장소가 막힌 브라우저: 고른 캐릭터 스타일이 이번 접속에 적용되고(첫 화면을 다시 그려도 그 값), 저장되지 않는다는 안내 하나', async ({
  browser,
}) => {
  const { context, page, problems } = await newPlayerPage(browser);
  // 쿠키 · 사이트 데이터 차단: localStorage에 접근만 해도 SecurityError (frame-limit · m10-quality와 같은 흉내)
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
  await expect(page.getByTestId('char-style-new')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('quality-note')).toBeHidden();
  await press(page.getByTestId('char-style-classic'));
  await expect.poll(() => applied(page)).toBe('classic');
  await expect(page.getByTestId('quality-note')).toBeVisible();
  await expect(page.getByTestId('quality-note')).toContainText(UI_TEXT.qualityNotSaved);
  // 프레임 제한도 저장하지 못해도 안내는 하나
  await press(page.getByTestId('frame-limit-60'));
  await expect(page.locator('[data-testid="quality-note"]:visible')).toHaveCount(1);
  await closeSettings(page);
  // 첫 화면을 다시 그려도(연습 고르기 → 취소) 이번 접속에서 고른 값, 연습 고르기 그림도 그 값
  await page.getByTestId('practice').click();
  expect(await expectFigures(page.locator('.pr-figure'), false, '연습 고르기')).toBe(4);
  await page.getByTestId('practice-cancel').click();
  await openSettings(page, 'graphics');
  await expect(page.getByTestId('char-style-classic')).toHaveAttribute('aria-pressed', 'true');
  expect(await applied(page)).toBe('classic');
  expect(problems).toEqual([]);
  await context.close();
});

test('주소 ?chars가 저장값보다 먼저이고(설정 화면 줄이 잠기고 그 사실을 보인다) 저장값을 바꾸지 않는다 (저장 기존 + ?chars=new → 새 캐릭터, 주소 없이 다시 열면 저장값)', async ({
  browser,
}) => {
  const { context, page, problems } = await newPlayerPage(browser);
  await page.goto(`/?${BASE_QUERY.slice(1)}`);
  await page.evaluate((k) => localStorage.setItem(k, 'classic'), KEY);
  await page.goto(`/?${BASE_QUERY.slice(1)}&chars=new`);
  await expect.poll(() => applied(page)).toBe('new');
  await openSettings(page, 'graphics');
  await expect(page.getByTestId('char-style-new')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('lock-char-style')).toBeVisible();
  await expect(page.getByTestId('lock-char-style')).toContainText('?chars=new');
  await expect(page.getByTestId('char-style-classic')).toHaveAttribute('aria-disabled', 'true');
  // 잠긴 줄은 눌러도 바뀌지 않는다
  await page.getByTestId('char-style-classic').click({ force: true });
  expect(await applied(page)).toBe('new');
  expect(await stored(page)).toBe('classic');
  // 주소 값 없이 다시 열면 저장값
  await page.goto(`/?${BASE_QUERY.slice(1)}`);
  await expect.poll(() => applied(page)).toBe('classic');
  expect(await stored(page)).toBe('classic');
  await openSettings(page, 'graphics');
  await expect(page.getByTestId('lock-char-style')).toBeHidden();
  expect(problems).toEqual([]);
  await context.close();
});

test('새 캐릭터: 봇과 연습 고르기 화면에서 미리 굽고(판 시작 전에 새 아틀라스), 판 중 창 크기가 바뀌어 다시 구워도 그림 명령은 다시 만들지 않는다', async ({
  browser,
}) => {
  const { context, page, problems } = await newPlayerPage(browser);
  await page.goto(`/?${BASE_QUERY.slice(1)}&chars=new`);
  await page.getByTestId('practice').click();
  await expect(page.getByTestId('practice-role-runner')).toBeVisible();
  // welcome 전(첫 화면 · 연습 고르기)에도 빌드 수치 반지름으로 미리 굽는다: 판 첫 프레임에서 굽지 않게
  const feat = (): Promise<Record<string, unknown>> =>
    page.evaluate(() => ({ ...(window.__DECOY__?.gfx.features ?? {}) }));
  await expect.poll(async () => (await feat()).atlasStyle).toBe('new');
  const before = await feat();
  const made = Number(before.atlasDrawingsMade);
  expect(made, '새 스타일 그림 명령을 만들었다').toBeGreaterThan(0);
  await page.getByTestId('practice-role-runner').click();
  await waitForSnapshots(page, 3);
  // 판을 시작해도 같은 배율 · 반지름이면 다시 굽지 않는다
  expect((await feat()).atlasDrawingsMade).toBe(made);
  // 판 중 창 크기 → 배율이 바뀌면 다시 굽지만 래스터만 한다 (그림 명령 수 그대로). 지금 크기와 다른 크기로
  const wide = (await page.evaluate(() => window.innerWidth)) >= 1200;
  await page.setViewportSize(wide ? { width: 960, height: 540 } : { width: 1280, height: 720 });
  await expect.poll(async () => (await feat()).atlasZoom).not.toBe(before.atlasZoom);
  const after = await feat();
  expect(after.atlasStyle).toBe('new');
  expect(after.atlasDrawingsMade, '배율만 바뀐 다시 굽기는 그림 명령을 다시 만들지 않는다').toBe(made);
  expect(problems).toEqual([]);
  await context.close();
});

test('방 역할 카드 · 빠른 매칭 대기: 새 캐릭터면 정면 그림(front), 기존이면 위에서 본 실루엣 — 방에서 바꾸면 카드를 바로 다시 그린다', async ({
  browser,
}) => {
  const { context, page, problems } = await newPlayerPage(browser);
  // 기본값(새 캐릭터)으로 방을 만든다
  await page.goto(`/?${BASE_QUERY.slice(1)}`);
  await page.getByTestId('create-room').click();
  await expect(page.getByTestId('room-code')).toHaveText(/^[A-Z]{4}$/);
  const figures = page.locator('.role-card .rc-figure');
  expect(await expectFigures(figures, true, '방 카드')).toBe(4);
  // 내 역할 카드: 그림 + '내 역할' 배지 (그림은 여전히 svg 하나)
  await page.getByTestId('role-runner').click();
  await expect(page.getByTestId('role-runner')).toHaveClass(/mine/);
  await expect(page.getByTestId('role-runner').locator('.rc-tag')).toContainText(UI_TEXT.myRole);
  expect(await expectFigures(figures, true, '방 카드 (내 역할)')).toBe(4);
  // 방 화면에서 바꾼다 (디버그 훅: 휴대폰 설정 판과 같은 적용 경로, 저장하지 않음) → 바로 다시 그린다, 고른 역할 · 포커스 그대로
  await page.getByTestId('role-guard').focus();
  await page.evaluate(() => window.__DECOY__?.setCharStyle('classic'));
  expect(await expectFigures(figures, false, '방 카드 (기존)')).toBe(4);
  await expect(page.getByTestId('role-runner')).toHaveClass(/mine/);
  await expect(page.getByTestId('role-runner').locator('.rc-tag')).toBeVisible();
  await expect(page.getByTestId('role-guard')).toBeFocused();
  // 디버그 훅은 저장하지 않는다 (기본값이라 처음부터 저장값 없음)
  expect(await stored(page)).toBeNull();
  await page.evaluate(() => window.__DECOY__?.setCharStyle('new'));
  expect(await expectFigures(figures, true, '방 카드 (다시 새 캐릭터)')).toBe(4);

  // 빠른 매칭 대기 화면 (자동 시작 전에 취소한다)
  await page.getByTestId('room-leave').click();
  await expect(page.getByTestId('quick-match')).toBeEnabled();
  await page.getByTestId('quick-match').click();
  await expect(page.getByTestId('quick-count')).toBeVisible();
  expect(await expectFigures(figures, true, '대기 카드')).toBe(4);
  // 남은 시간 글자가 채워진 뒤 바꾼다: 다시 그려도 그 글자가 비지 않는다(다음 tick을 기다리지 않는다)
  await expect(page.getByTestId('quick-countdown')).not.toHaveText('');
  const countdown = await page.evaluate(() => {
    window.__DECOY__?.setCharStyle('classic');
    return document.querySelector('[data-testid="quick-countdown"]')?.textContent ?? '';
  });
  expect(countdown, '다시 그린 직후 남은 시간').not.toBe('');
  expect(await expectFigures(figures, false, '대기 카드 (기존)')).toBe(4);
  await page.getByTestId('quick-cancel').click();
  await expect(page.getByTestId('quick-match')).toBeVisible();
  // 설정 화면도 지금 값 (디버그 훅으로 바꾼 값)
  await openSettings(page, 'graphics');
  await expect(page.getByTestId('char-style-classic')).toHaveAttribute('aria-pressed', 'true');
  expect(problems).toEqual([]);
  await context.close();
});

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 두 사각형이 겹치는 넓이 (px²) */
function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return Math.max(0, w) * Math.max(0, h);
}

test("새 캐릭터 내 역할 카드: 좁은 휴대폰 · 좁은 창에서도 '내 역할' 배지가 정면 그림 머리를 가리지 않는다 (그림을 배지 왼쪽으로 비켜 세운다, 넓은 카드는 가운데 그대로)", async ({
  browser,
}) => {
  const ROLES: readonly Role[] = ['monster', 'runner', 'guard', 'scout'];
  // centered: 카드가 넉넉해 그림을 비키지 않는다 (가운데 그대로)
  const cases: readonly { label: string; device: DeviceOptions; centered?: boolean }[] = [
    { label: 'Galaxy S9+ 658×320', device: dpr1(PHONE_NARROW) },
    { label: 'Pixel 5 802×293', device: dpr1(PHONE_SMALL) },
    { label: 'Galaxy Tab S9 1024×640', device: dpr1(TABLET_LANDSCAPE) },
    { label: 'PC 420×820', device: PC_NARROW },
    { label: 'PC 1280×720', device: { viewport: { width: 1280, height: 720 } }, centered: true },
  ];
  for (const { label, device, centered } of cases) {
    const { context, page, problems } = await newPlayerPage(browser, device);
    await createRoom(page, '&chars=new');
    for (const role of ROLES) {
      const card = page.getByTestId(`role-${role}`);
      await press(card);
      await expect(card).toHaveClass(/mine/);
      await expect(card.locator('.rc-figure.front .rc-tag')).toBeVisible();
      const m = await card.evaluate((el) => {
        const box = (r: DOMRect): Rect => ({ x: r.x, y: r.y, width: r.width, height: r.height });
        const fig = el.querySelector('.rc-figure')!;
        const svg = fig.querySelector(':scope > svg')!;
        // 정면 그림 본체 (frontFigureSvg의 배율을 건 g — 무대 빛 · 그림자 타원은 빼고): getBBox를 화면 좌표로
        const g = svg.querySelector<SVGGraphicsElement>(':scope > g[transform*="scale("]')!;
        const bb = g.getBBox();
        const ctm = g.getScreenCTM()!;
        const p1 = new DOMPoint(bb.x, bb.y).matrixTransform(ctm);
        const p2 = new DOMPoint(bb.x + bb.width, bb.y + bb.height).matrixTransform(ctm);
        return {
          card: box(el.getBoundingClientRect()),
          svg: box(svg.getBoundingClientRect()),
          tag: box(fig.querySelector('.rc-tag')!.getBoundingClientRect()),
          figure: { x: p1.x, y: p1.y, width: p2.x - p1.x, height: p2.y - p1.y },
        };
      });
      const head: Rect = { ...m.figure, height: m.figure.height * 0.4 };
      expect(overlapArea(m.tag, head), `${label} ${role}: 배지 ∩ 그림 위 40%(머리)`).toBe(0);
      // 비켜 세워도 그림은 카드 안
      expect(m.figure.x, `${label} ${role}: 그림 왼쪽이 카드 안`).toBeGreaterThanOrEqual(m.card.x);
      expect(m.figure.x + m.figure.width, `${label} ${role}: 그림 오른쪽이 카드 안`).toBeLessThanOrEqual(
        m.card.x + m.card.width,
      );
      if (centered)
        expect(
          Math.abs(m.svg.x + m.svg.width / 2 - (m.card.x + m.card.width / 2)),
          `${label} ${role}: 가운데`,
        ).toBeLessThan(1);
      // 내 역할을 풀면 배지가 없다
      await press(card);
      await expect(card).not.toHaveClass(/mine/);
      await expect(card.locator('.rc-tag')).toHaveCount(0);
    }
    expect(problems, label).toEqual([]);
    await context.close();
  }
});

test('결과 화면: 새 캐릭터면 팀 문장이 정면 그림(괴물 승리 svg 1개 · 생존자 승리 svg 3개), 기존이면 괴물 문양 — 결과 상자 높이는 그대로', async ({
  browser,
}) => {
  const { context, page, problems } = await newPlayerPage(browser);
  // ?chars=new: 이번 접속에만 (저장하지 않는다)
  const code = await createRoom(page, '&bots=1&chars=new');
  expect(await applied(page)).toBe('new');
  expect(await stored(page), '?chars는 저장하지 않는다').toBeNull();
  await pickRoleAndReady(page, 'runner');
  await page.getByTestId('start-button').click();
  await waitForSnapshots(page, 3);
  // 시간 초과 → 괴물 승리
  await sendTest(page, { kind: 'setTime', timeLeft: 0.1 });
  await expect(page.getByTestId('result-winner')).toHaveText(UI_TEXT.winMonster, { timeout: 10_000 });
  const emblem = page.locator('.result-hero .emblem');
  await expect(emblem).toHaveClass(/\bmonster\b/);
  await expect(emblem).toHaveClass(/\bfront\b/);
  await expect(emblem.locator('svg')).toHaveCount(1);
  await expect(emblem.locator('svg')).toHaveAttribute('viewBox', '-80 -80 160 160');
  // 결과 화면이 떠 있는 동안 바뀌면 팀 문장만 바꾼다 (기존 = 괴물 문양, 버튼은 그대로 켜져 있다)
  await page.evaluate(() => window.__DECOY__?.setCharStyle('classic'));
  await expect(emblem).not.toHaveClass(/\bfront\b/);
  await expect(emblem.locator('svg')).toHaveCount(1);
  await expect(emblem.locator('svg')).toHaveAttribute('viewBox', '-22 -22 44 44');
  await expect(page.getByTestId('rematch')).toBeEnabled();
  await page.evaluate(() => window.__DECOY__?.setCharStyle('new'));
  await expect(emblem).toHaveClass(/\bfront\b/);
  await expectResultFits(page, '괴물 승리');

  // 다시 하기 → 둘이 탈출 · 하나 사망 → 생존자 승리
  await page.getByTestId('rematch').click();
  await expect(page.getByTestId('role-runner')).toHaveClass(/mine/);
  expect(await expectFigures(page.locator('.role-card .rc-figure'), true, '다시 하기 방 카드')).toBe(4);
  await page.getByTestId('ready-button').click();
  await page.getByTestId('start-button').click();
  await expect(page.getByTestId('result')).toBeHidden();
  await page.waitForFunction(() => window.__DECOY__?.phase === 'playing');
  await waitForSnapshots(page, 3);
  const t = await truth(page, code);
  const id = (r: string): string => t.players.find((p) => p.role === r)!.id;
  await sendTest(page, { kind: 'setSurvivor', target: id('scout'), status: 'dead' });
  await sendTest(page, { kind: 'setSurvivor', target: id('runner'), status: 'escaped' });
  await sendTest(page, { kind: 'setSurvivor', target: id('guard'), status: 'escaped' });
  await expect(page.getByTestId('result-winner')).toHaveText(UI_TEXT.winSurvivors, { timeout: 10_000 });
  await expect(page.locator('.emblem.survivors.front svg')).toHaveCount(3);
  for (const fig of await page.locator('.emblem.survivors.front .fig').all())
    await expect(fig.locator(':scope > svg > g[transform*="scale("]')).toHaveCount(1);
  await expectResultFits(page, '생존자 승리');
  // 기존으로 바꾸면 셋의 위에서 본 실루엣 (svg 3개 그대로)
  await page.evaluate(() => window.__DECOY__?.setCharStyle('classic'));
  await expect(page.locator('.emblem.survivors:not(.front) svg')).toHaveCount(3);
  expect(problems).toEqual([]);
  await context.close();
});

/**
 * 결과 화면 크기 검사: 팀 문장(정면 그림)이 옆 승리 글자 칸보다 높지 않아 결과 상자 높이가 기존과 같고,
 * 960×540 · 1366×768에서 상자가 화면 안, 960×400에서는 위가 잘리지 않는다
 */
async function expectResultFits(page: Page, label: string): Promise<void> {
  for (const [w, h] of [
    [960, 540],
    [1366, 768],
    [960, 400],
  ] as const) {
    await page.setViewportSize({ width: w, height: h });
    const m = await page.evaluate(() => {
      const root = document.querySelector('[data-testid="result"]')!;
      root.scrollTop = 0;
      const box = root.querySelector('.result-box')!.getBoundingClientRect();
      const emblem = root.querySelector('.result-hero .emblem')!.getBoundingClientRect();
      const title = root.querySelector('.result-hero .result-title')!.getBoundingClientRect();
      return { top: box.top, bottom: box.bottom, emblem: emblem.height, title: title.height };
    });
    expect(m.emblem, `${label} ${w}×${h} 팀 문장 높이 ≤ 글자 칸`).toBeLessThanOrEqual(m.title + 0.5);
    expect(m.top, `${label} ${w}×${h} 위`).toBeGreaterThanOrEqual(0);
    if (h >= 540) expect(m.bottom, `${label} ${w}×${h} 아래`).toBeLessThanOrEqual(h);
  }
  await page.setViewportSize({ width: 960, height: 540 });
}

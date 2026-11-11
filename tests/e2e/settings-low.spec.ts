// 낮은 휴대폰 가로의 설정 화면 (플레이테스트 a-6, client/src/ui/settings.css의 (max-height: 420px) 블록 · style.css):
// 아이폰 14 가로 · 주소창이 있는 채(844×300 · 844×340)와 좁은 휴대폰(667×330), 안전 영역 좌우 47 · 아래 21 흉내.
//  - 설명 글씨 12px(글자 하한), 카드 안 글자는 모두 12px 이상
//  - 판 중 그래픽 탭 세 줄이 스크롤 없이 다 보인다 (고치기 전 844×300: 1.9줄, 667×330: 1.4줄)
//  - '닫기' · '모두 기본값으로' · '기본값'은 보이는 면만 34 · 34 · 30px, 누르는 자리(요소 상자)는 48px 그대로 — 면 밖 가장자리를
//    눌러도 그 버튼이 눌린다
//  - 탭 칸 · 본문이 넘치지 않고(가로 스크롤 없음 · 탭 글자가 칸 안), 판 중 '판은 멈추지 않아요'는 머리 줄에 있다(폭 600 이상)
//  - 좁은 화면(폭 739 이하)은 고르는 칸 넷이 한 줄
//  - 조작 탭의 '공격 버튼' 줄(a-2: 6자 선택지 둘 + 긴 설명)도 고르는 칸이 한 줄이고 넘치지 않는다 — 그 줄이 있으면 실제 줄, 없으면
//    a-2와 같은 글의 흉내
//  - 높이 420 초과는 그대로다 (설명 13px · 면 = 상자)
import { expect, test, type Browser, type Page } from '@playwright/test';
import { SETTINGS_TEXT } from '../../client/src/data/storyText';
import { PHONE_BROWSER, dpr1, newPlayerPage, press, waitForSnapshots, type DeviceOptions } from './helpers';
import { emulateSafeArea, waitForTouchTarget } from './touch';

/** 아이폰 14 가로의 안전 영역 */
const SAFE = { left: 47, right: 47, bottom: 21 };
/** quality 주소 옵션은 주지 않는다 — 품질 줄에 잠금 안내 한 줄이 더 붙어 줄 높이가 달라진다 */
const QUERY = '/?bots=1&debug=hook&renderer=canvas';
/** 손가락 대상 하한 (CSS px, layout.MIN_TARGET). 부동소수 0.5px는 봐준다 */
const MIN_TARGET = 48;

function phone(width: number, height: number): DeviceOptions {
  return dpr1({ ...PHONE_BROWSER, viewport: { width, height }, screen: { width, height } });
}

function stubFullscreen(): void {
  Element.prototype.requestFullscreen = function () {
    return Promise.resolve();
  };
}

async function open(browser: Browser, width: number, height: number) {
  const s = await newPlayerPage(browser, phone(width, height));
  await s.context.addInitScript(stubFullscreen);
  await emulateSafeArea(s.page, SAFE);
  await s.page.goto(QUERY);
  await expect(s.page.getByTestId('create-room')).toBeVisible();
  // 글자 폭이 글꼴에 달려 있다: UI 글꼴을 받은 뒤 잰다
  await s.page.evaluate(() => document.fonts.ready);
  return s;
}

async function openSettingsTab(page: Page, tab: string): Promise<void> {
  const panel = page.getByTestId('settings-panel');
  if (!(await panel.isVisible())) await press(page.getByTestId('settings-button').first());
  await expect(panel).toBeVisible();
  await press(page.getByTestId(`settings-tab-${tab}`));
  await expect(page.getByTestId(`settings-tab-${tab}`)).toHaveAttribute('aria-selected', 'true');
}

/** 혼자 봇 방에서 러너로 판을 시작하고 판 중 설정을 연다 */
async function openMatchSettings(page: Page): Promise<void> {
  await press(page.getByTestId('create-room'));
  await press(page.getByTestId('role-runner'));
  await press(page.getByTestId('ready-button'));
  const ok = page.getByTestId('touch-tutorial-ok');
  if (await ok.isVisible()) await press(ok);
  await press(page.getByTestId('start-button'));
  await waitForSnapshots(page, 3);
  const menu = await waitForTouchTarget(page, 'menu');
  await page.touchscreen.tap(menu.x + menu.w / 2, menu.y + menu.h / 2);
  await expect(page.getByTestId('settings-panel')).toBeVisible();
  await expect(page.getByTestId('settings-inmatch')).toBeVisible();
}

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

interface Measured {
  /** 본문 스크롤 양 (0 = 줄이 다 보인다) */
  bodyScroll: number;
  body: Box;
  /** 보이는 줄: id · 높이 · 본문 안에 온전히 들어오는가 */
  rows: { id: string; h: number; inside: boolean }[];
  hintPx: number[];
  /** 카드 안 보이는 글자 요소 중 12px 미만인 것 */
  tinyText: string[];
  /** 카드 안 보이는 button · range 중 누르는 자리가 48px 미만인 것 */
  smallTargets: string[];
  card: Box;
  safe: Box;
  tabsScroll: number;
  /** 글자가 탭 상자 밖으로 넘친 탭 */
  tabOverflow: string[];
  /** 가로로 넘친 곳 (본문 · 카드 · 문서) */
  overflowX: string[];
  note: Box | null;
  close: Box;
  resetAll: Box;
}

async function measure(page: Page): Promise<Measured> {
  return page.evaluate(() => {
    const box = (el: Element): Box => {
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    };
    const q = <T extends HTMLElement = HTMLElement>(sel: string): T => {
      const el = document.querySelector<T>(sel);
      if (!el) throw new Error(`없음: ${sel}`);
      return el;
    };
    const card = q('[data-testid="settings-panel"]');
    const body = q('.set-body');
    const tabs = q('.set-tabs');
    const bb = body.getBoundingClientRect();
    const page_ = [...document.querySelectorAll<HTMLElement>('.set-page')].find((p) => !p.hidden);
    const rows = page_
      ? [...page_.querySelectorAll<HTMLElement>(':scope > .set-row')].filter((r) => r.offsetParent !== null)
      : [];
    const visible = (el: HTMLElement): boolean => el.offsetParent !== null && el.checkVisibility();
    const px = (el: Element): number => Number.parseFloat(getComputedStyle(el).fontSize);
    // 자기 글자 노드가 있는 요소만 (글자를 직접 그리는 요소)
    const texts = [...card.querySelectorAll<HTMLElement>('*')].filter(
      (el) =>
        visible(el) &&
        [...el.childNodes].some((n) => n.nodeType === 3 && (n.textContent ?? '').trim() !== ''),
    );
    const probe = document.createElement('div');
    probe.style.cssText =
      'position:fixed;visibility:hidden;pointer-events:none;top:env(safe-area-inset-top);right:env(safe-area-inset-right);bottom:env(safe-area-inset-bottom);left:env(safe-area-inset-left)';
    document.body.appendChild(probe);
    const safe = box(probe);
    probe.remove();
    const note = document.querySelector<HTMLElement>('[data-testid="settings-inmatch"]');
    return {
      bodyScroll: body.scrollHeight - body.clientHeight,
      body: box(body),
      rows: rows.map((r) => {
        const b = r.getBoundingClientRect();
        return {
          id: (r.dataset.testid ?? '').replace('row-', ''),
          h: Math.round(b.height * 10) / 10,
          inside: b.top >= bb.top - 0.5 && b.bottom <= bb.bottom + 0.5,
        };
      }),
      hintPx: [...card.querySelectorAll<HTMLElement>('.set-hint')].filter(visible).map(px),
      tinyText: texts.filter((el) => px(el) < 12).map((el) => `${el.className}: ${px(el)}px`),
      smallTargets: [...card.querySelectorAll<HTMLElement>('button, input[type="range"]')]
        .filter((b) => b.offsetParent !== null)
        .filter((b) => b.getBoundingClientRect().height < 47.5)
        .map((b) => `${b.dataset.testid ?? b.textContent ?? ''}: ${b.getBoundingClientRect().height}`),
      card: box(card),
      safe,
      tabsScroll: tabs.scrollHeight - tabs.clientHeight,
      tabOverflow: [...tabs.querySelectorAll<HTMLElement>('.set-tab')]
        .filter((t) => !t.hidden && t.scrollWidth > t.clientWidth)
        .map((t) => t.dataset.testid ?? ''),
      overflowX: [
        body.scrollWidth > body.clientWidth ? '본문' : '',
        card.scrollWidth > card.clientWidth ? '카드' : '',
        document.documentElement.scrollWidth > window.innerWidth ? '문서' : '',
      ].filter((s) => s !== ''),
      note: note && visible(note) ? box(note) : null,
      close: box(q('[data-testid="settings-close"]')),
      resetAll: box(q('[data-testid="settings-reset-all"]')),
    };
  });
}

/** 낮은 화면 공통: 설명 12px · 글자 하한 · 누르는 자리 48px · 카드가 안전 영역 안 · 탭 칸 · 가로 넘침 없음 */
function expectCompact(m: Measured, where: string, hints = true): void {
  // 소리 탭에는 설명이 없다
  if (hints) expect(m.hintPx.length, `${where}: 보이는 설명`).toBeGreaterThan(0);
  expect([...new Set(m.hintPx)], `${where}: 설명 글씨`).toEqual(hints ? [12] : []);
  expect(m.tinyText, `${where}: 12px 미만 글자`).toEqual([]);
  expect(m.smallTargets, `${where}: 48px 미만 누르는 자리`).toEqual([]);
  expect(m.card.left, `${where}: 카드 왼쪽`).toBeGreaterThanOrEqual(m.safe.left - 0.5);
  expect(m.card.right, `${where}: 카드 오른쪽`).toBeLessThanOrEqual(m.safe.right + 0.5);
  expect(m.card.top, `${where}: 카드 위`).toBeGreaterThanOrEqual(m.safe.top - 0.5);
  expect(m.card.bottom, `${where}: 카드 아래`).toBeLessThanOrEqual(m.safe.bottom + 0.5);
  expect(m.tabsScroll, `${where}: 탭 칸 스크롤`).toBe(0);
  expect(m.tabOverflow, `${where}: 글자가 넘친 탭`).toEqual([]);
  expect(m.overflowX, `${where}: 가로 넘침`).toEqual([]);
}

interface Face {
  /** 누르는 자리 (요소 상자) */
  box: Box;
  /** 보이는 면 (::before) 높이 · content */
  faceHeight: string;
  faceContent: string;
  /** 버튼 자신의 바탕 (면을 따로 그리면 비어 있다) */
  ownBg: string;
  ownClip: string;
}

async function face(page: Page, testid: string): Promise<Face> {
  return page.getByTestId(testid).evaluate((el) => {
    const r = el.getBoundingClientRect();
    const before = getComputedStyle(el, '::before');
    const own = getComputedStyle(el);
    return {
      box: { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height },
      faceHeight: before.height,
      faceContent: before.content,
      ownBg: own.backgroundColor,
      ownClip: own.clipPath,
    };
  });
}

const CLEAR = 'rgba(0, 0, 0, 0)';

/** 보이는 면은 facePx, 누르는 자리는 48px 이상 — 면 위 · 아래 가장자리(면 밖)의 점도 그 버튼이다 */
async function expectSmallFace(page: Page, testid: string, facePx: number): Promise<Face> {
  const f = await face(page, testid);
  expect(f.box.height, `${testid}: 누르는 자리`).toBeGreaterThanOrEqual(MIN_TARGET - 0.5);
  expect(f.faceContent, `${testid}: 면(::before)`).toBe('""');
  expect(f.faceHeight, `${testid}: 보이는 면`).toBe(`${facePx}px`);
  expect(f.ownBg, `${testid}: 버튼 자신의 바탕`).toBe(CLEAR);
  expect(f.ownClip, `${testid}: 버튼 자신의 깎기`).toBe('none');
  // 면 밖 띠: 위 · 아래로 (상자 − 면) / 2 — 그 한가운데쯤과 상자 끝 2px 안쪽
  const margin = (f.box.height - facePx) / 2;
  expect(margin, `${testid}: 면 밖 띠`).toBeGreaterThanOrEqual(6);
  const cx = f.box.left + f.box.width / 2;
  const hits = await page.evaluate(
    ({ id, x, ys }) =>
      ys.map((y) => {
        const el = document.elementFromPoint(x, y);
        return el?.closest('[data-testid]')?.getAttribute('data-testid') === id;
      }),
    {
      id: testid,
      x: cx,
      ys: [f.box.top + 2, f.box.top + margin / 2, f.box.bottom - margin / 2, f.box.bottom - 2],
    },
  );
  expect(hits, `${testid}: 면 밖 가장자리가 그 버튼`).toEqual([true, true, true, true]);
  return f;
}

/** 버튼 상자의 위 끝 2px 안쪽(보이는 면 밖)을 손가락으로 누른다 */
async function tapTopEdge(page: Page, f: Face): Promise<void> {
  await page.touchscreen.tap(f.box.left + f.box.width / 2, f.box.top + 2);
}

/**
 * a-2(괴물 공격 버튼 방식)의 설명 — a-2의 `SETTINGS_TEXT.attackButtonHint`와 같은 글이다. 이 브랜치에는 그 줄이 아직 없어 흉내에 쓴다
 * (a-2를 합친 뒤에는 실제 줄을 잰다 — attackRowFit)
 */
const ATTACK_HINT =
  '괴물 공격 버튼 — 끌어서 조준은 짧게 누르면 보는 방향, 끌면 그쪽으로 공격해요. 누르면 바로는 닿자마자 공격해요. 다음 판부터 적용돼요';

interface AttackRow {
  /** 실제 줄(row-attack-button)을 쟀는가 (거짓 = 흉내) */
  real: boolean;
  /** 고르는 칸 둘이 한 줄 */
  oneLine: boolean;
  /** 줄 높이 (px) */
  h: number;
  /** 설명 줄 수 */
  hintLines: number;
  /** 설명이 이름 아래 왼쪽 칸(고르는 칸 옆)에 있다 — 폭 740 이상 배치 */
  hintBeside: boolean;
  /** 본문 가로 넘침 */
  overflow: boolean;
}

/**
 * 조작 탭의 '공격 버튼' 줄(a-2, 6자 선택지 둘 + 긴 설명)을 잰다. 그 줄이 있으면 실제 줄을 재고, 없으면 진동 줄을 베껴 이름 ·
 * 선택지 · 설명을 a-2와 같은 글('끌어서 조준' · '누르면 바로' · ATTACK_HINT)로 바꿔 그 줄 다음에 넣고 잰 뒤 지운다
 */
async function attackRowFit(page: Page): Promise<AttackRow> {
  return page.evaluate((hintText) => {
    const real = document.querySelector<HTMLElement>('[data-testid="row-attack-button"]');
    const isReal = real !== null && real.offsetParent !== null;
    let row: HTMLElement;
    if (real && isReal) row = real;
    else {
      const src = document.querySelector<HTMLElement>('[data-testid="row-haptics"]');
      if (!src || src.offsetParent === null) throw new Error('진동 줄 없음');
      row = src.cloneNode(true) as HTMLElement;
      row.dataset.testid = 'row-e2e-attack';
      row.querySelector('.field-label')!.textContent = '공격 버튼';
      const names = ['끌어서 조준', '누르면 바로'];
      [...row.querySelectorAll<HTMLElement>('.seg')].forEach((s, i) => {
        for (const n of [...s.childNodes]) if (n.nodeType === 3) n.textContent = names[i] ?? '';
      });
      let made = row.querySelector<HTMLElement>('.set-hint');
      if (!made) {
        made = document.createElement('div');
        made.className = 'set-hint';
        row.append(made);
      }
      made.hidden = false;
      made.textContent = hintText;
      src.after(row);
    }
    const segs = [...row.querySelectorAll<HTMLElement>('.seg')];
    const hint = row.querySelector<HTMLElement>('.set-hint');
    if (!hint || segs.length === 0) throw new Error('공격 버튼 줄의 칸 · 설명 없음');
    const tops = segs.map((s) => Math.round(s.getBoundingClientRect().top));
    const hb = hint.getBoundingClientRect();
    const sb = segs[0]!.getBoundingClientRect();
    const body = document.querySelector<HTMLElement>('.set-body')!;
    const out = {
      real: isReal,
      oneLine: tops.length === 2 && tops[0] === tops[1],
      h: Math.round(row.getBoundingClientRect().height * 10) / 10,
      hintLines: Math.round(hb.height / Number.parseFloat(getComputedStyle(hint).lineHeight)),
      hintBeside: hb.right <= sb.left && hb.top < sb.bottom,
      overflow: body.scrollWidth > body.clientWidth,
    };
    if (!isReal) row.remove();
    return out;
  }, ATTACK_HINT);
}

for (const [width, height] of [
  [844, 300],
  [844, 340],
] as const) {
  test(`아이폰 가로 ${width}×${height}(안전 영역): 설명 12px · 판 중 그래픽 네 줄(입체감 포함)이 스크롤 없이 · 버튼은 작게 보이고 48px로 눌린다`, async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const name = `${width}x${height}`;
    const { context, page, problems } = await open(browser, width, height);

    // 로비: 탭 넷 모두 촘촘한 배치, 그래픽 세 줄은 스크롤 없이
    for (const tab of ['graphics', 'screen', 'sound', 'controls']) {
      await openSettingsTab(page, tab);
      const m = await measure(page);
      expectCompact(m, `${name} 로비 ${tab}`, tab !== 'sound');
      if (tab === 'graphics') {
        expect(m.rows.map((r) => r.id)).toEqual(['quality', 'frame-limit', 'char-style', 'depth']);
        // 그래픽 네 줄(입체감 포함)이 스크롤 없이 — 높이 320 이하 넓은 화면은 줄 여백을 뗀다(settings.css)
        expect(m.bodyScroll, `${name} 로비 그래픽 스크롤`).toBe(0);
        expect(m.rows.every((r) => r.inside)).toBe(true);
        // 설명이 이름 아래 왼쪽 칸에 있어 줄 높이를 더하지 않는다: 고르는 칸(52px) + 여백
        for (const r of m.rows) expect(r.h, `${name} ${r.id} 줄 높이`).toBeLessThanOrEqual(64);
      }
    }
    // 조작 탭: '공격 버튼' 줄(6자 선택지 둘 + 77자 설명)도 고르는 칸이 한 줄 · 가로 넘침 없음. 설명은 이름 아래 왼쪽 칸에 세 줄로
    // 접혀(12px) 줄 높이 = 이름 + 설명 세 줄 + 여백 76.8px — 설명이 전체 폭 줄로 내려가면(폭 739 이하 배치) 칸 52px 아래에 붙는다
    const attack = await attackRowFit(page);
    expect(attack, `${name} 공격 버튼 줄`).toMatchObject({
      oneLine: true,
      overflow: false,
      hintBeside: true,
    });
    expect(attack.hintLines, `${name} 공격 버튼 설명 줄 수`).toBeLessThanOrEqual(3);
    expect(attack.h, `${name} 공격 버튼 줄 높이`).toBeLessThanOrEqual(80);

    // 보이는 면: '닫기' · '모두 기본값으로' 34px, '기본값' 30px (누르는 자리 48px)
    await openSettingsTab(page, 'screen');
    await press(page.getByTestId('reduce-shake-on'));
    await expect(page.getByTestId('reduce-shake-on')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('reset-reduce-shake')).toBeEnabled();
    const resetAll = await expectSmallFace(page, 'settings-reset-all', 34);
    const close = await expectSmallFace(page, 'settings-close', 34);
    const reset = await expectSmallFace(page, 'reset-reduce-shake', 30);
    // 꺼진 '기본값'(이미 기본값)도 같은 면 · 같은 누르는 자리
    await expectSmallFace(page, 'reset-ui-size', 30);
    // 두 머리 버튼 사이는 8px 이상 (터치 대상 간격)
    expect(close.box.left - resetAll.box.right).toBeGreaterThanOrEqual(8 - 0.5);

    // 면 밖 위 가장자리를 눌러도 그 버튼이 눌린다: '기본값' → 꺼짐으로 돌아간다
    await tapTopEdge(page, reset);
    await expect(page.getByTestId('reduce-shake-off')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('reset-reduce-shake')).toBeDisabled();
    // '모두 기본값으로' → 확인 문구 (닫기가 대신 눌리지 않았다)
    await tapTopEdge(page, resetAll);
    await expect(page.getByTestId('settings-reset-done')).toHaveText(SETTINGS_TEXT.resetAllConfirm);
    await expect(page.getByTestId('settings-panel')).toBeVisible();
    // '닫기'
    await tapTopEdge(page, close);
    await expect(page.getByTestId('settings-panel')).toBeHidden();

    // 판 중: 그래픽 세 줄이 스크롤 없이 다 보이고(고치기 전 844×300: 1.9줄), '판은 멈추지 않아요'는 머리 줄 안
    await openMatchSettings(page);
    await openSettingsTab(page, 'graphics');
    const g = await measure(page);
    expectCompact(g, `${name} 판 중 graphics`);
    expect(g.rows.map((r) => r.id)).toEqual(['quality', 'frame-limit', 'char-style', 'depth']);
    expect(g.bodyScroll, `${name} 판 중 그래픽 스크롤`).toBe(0);
    expect(
      g.rows.every((r) => r.inside),
      `${name} 판 중 그래픽 세 줄`,
    ).toBe(true);
    if (!g.note) throw new Error('판 중 안내 없음');
    expect(g.note.bottom, `${name} 판 중 안내가 머리 줄 안`).toBeLessThanOrEqual(g.close.bottom + 0.5);
    expect(g.note.top).toBeGreaterThanOrEqual(g.close.top - 0.5);
    expect(g.note.right).toBeLessThanOrEqual(g.resetAll.left);
    // 본문이 머리 줄 바로 아래에서 시작한다 (안내 줄이 따로 높이를 쓰지 않는다)
    expect(g.body.top - g.close.bottom).toBeLessThanOrEqual(4);
    for (const tab of ['screen', 'sound']) {
      await openSettingsTab(page, tab);
      const m = await measure(page);
      expectCompact(m, `${name} 판 중 ${tab}`, tab !== 'sound');
      // 화면 · 소리 네 줄: 세 줄 넘게 보인다 (높이 340이면 네 줄 다)
      expect(m.rows.filter((r) => r.inside).length, `${name} 판 중 ${tab} 보이는 줄`).toBeGreaterThanOrEqual(
        height >= 340 ? 4 : 3,
      );
    }
    // 판 중에도 닫기의 면 밖 가장자리가 눌린다
    await tapTopEdge(page, await expectSmallFace(page, 'settings-close', 34));
    await expect(page.getByTestId('settings-panel')).toBeHidden();

    if (height === 340) {
      // 높이 420 초과는 그대로: 설명 13px, 면을 따로 그리지 않는다 (같은 판 중 화면에서 창만 키운다)
      await page.setViewportSize({ width, height: 430 });
      const menu = await waitForTouchTarget(page, 'menu');
      await page.touchscreen.tap(menu.x + menu.w / 2, menu.y + menu.h / 2);
      await expect(page.getByTestId('settings-panel')).toBeVisible();
      await openSettingsTab(page, 'graphics');
      const tall = await measure(page);
      expect([...new Set(tall.hintPx)]).toEqual([13]);
      expect(tall.smallTargets).toEqual([]);
      const f = await face(page, 'settings-close');
      expect(f.faceContent).toBe('none');
      expect(f.ownBg).not.toBe(CLEAR);
      expect(f.box.height).toBeGreaterThanOrEqual(MIN_TARGET - 0.5);
    }
    expect(problems).toEqual([]);
    await context.close();
  });
}

test('좁은 휴대폰 가로 667×330(안전 영역): 설명 12px · 고르는 칸 넷이 한 줄 · 로비 그래픽 앞 세 줄이 다 보이고(넷째 줄은 짧은 스크롤) · 버튼은 작게 보이고 48px로 눌린다', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const { context, page, problems } = await open(browser, 667, 330);
  for (const tab of ['graphics', 'screen', 'sound', 'controls']) {
    await openSettingsTab(page, tab);
    const m = await measure(page);
    expectCompact(m, `667x330 로비 ${tab}`, tab !== 'sound');
    if (tab === 'graphics') {
      // 고치기 전: 품질 · 프레임 제한의 네 칸이 두 줄로 접혀 1.6줄만 보였다. 앞 세 줄이 본문 안에 온전히 보인다.
      // 넷째 줄 '입체감'(입체감 작업에서 더함)은 이 좁고 낮은 화면에서만 짧게 스크롤해서 본다 — 폭 739 이하는 설명이 칸 아래 전체 폭
      // 줄이라 네 줄이 본문(249px)에 다 들지 않는다(DECISIONS 17절 '설정 줄'). 스크롤하면 온전히 보인다
      expect(m.rows.map((r) => r.id)).toEqual(['quality', 'frame-limit', 'char-style', 'depth']);
      expect(
        m.rows.slice(0, 3).every((r) => r.inside),
        '667x330 로비 그래픽 앞 세 줄',
      ).toBe(true);
      await page.getByTestId('row-depth').scrollIntoViewIfNeeded();
      const after = await measure(page);
      expect(after.rows.find((r) => r.id === 'depth')?.inside, '667x330 입체감 줄 (스크롤 뒤)').toBe(true);
      expect(after.bodyScroll, '667x330 로비 그래픽 스크롤 (넷째 줄 몫)').toBeLessThanOrEqual(96);
      for (const id of ['quality', 'frame-limit']) {
        const tops = await page
          .getByTestId(`row-${id}`)
          .locator('.seg')
          .evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
        expect(tops.length, `${id} 칸 수`).toBe(4);
        expect(new Set(tops).size, `${id} 네 칸이 한 줄`).toBe(1);
      }
    }
  }
  // '공격 버튼' 줄: 고르는 칸 한 줄 · 넘침 없음. 설명은 전체 폭으로 칸 아래 두 줄 (줄 높이 = 칸 52 + 설명 두 줄 + 여백 93.2px)
  const attack = await attackRowFit(page);
  expect(attack, '667x330 공격 버튼 줄').toMatchObject({ oneLine: true, overflow: false, hintBeside: false });
  expect(attack.hintLines, '667x330 공격 버튼 설명 줄 수').toBeLessThanOrEqual(2);
  expect(attack.h, '667x330 공격 버튼 줄 높이').toBeLessThanOrEqual(96);

  await openSettingsTab(page, 'screen');
  await press(page.getByTestId('reduce-shake-on'));
  await expect(page.getByTestId('reset-reduce-shake')).toBeEnabled();
  const resetAll = await expectSmallFace(page, 'settings-reset-all', 34);
  const close = await expectSmallFace(page, 'settings-close', 34);
  const reset = await expectSmallFace(page, 'reset-reduce-shake', 30);
  expect(close.box.left - resetAll.box.right).toBeGreaterThanOrEqual(8 - 0.5);
  await tapTopEdge(page, reset);
  await expect(page.getByTestId('reduce-shake-off')).toHaveAttribute('aria-pressed', 'true');
  await tapTopEdge(page, close);
  await expect(page.getByTestId('settings-panel')).toBeHidden();

  // 판 중: 그래픽 세 줄이 본문 안에 온전히 보인다 (고치기 전 1.4줄. 안내를 머리 줄 아래에 두면 2.7줄 — 폭 600 이상은 머리 줄로 올린다).
  // 안내는 제목 · '모두 기본값으로' 사이 칸(233px)에 12px 두 줄로 머리 줄 안에 든다
  await openMatchSettings(page);
  await openSettingsTab(page, 'graphics');
  const g = await measure(page);
  expectCompact(g, '667x330 판 중 graphics');
  expect(g.rows.map((r) => r.id)).toEqual(['quality', 'frame-limit', 'char-style', 'depth']);
  // 앞 세 줄이 온전히 보이고, 넷째 줄 '입체감'은 짧게 스크롤해서 본다 (로비와 같다 — DECISIONS 17절 '설정 줄')
  expect(
    g.rows.slice(0, 3).every((r) => r.inside),
    '667x330 판 중 그래픽 앞 세 줄',
  ).toBe(true);
  expect(g.bodyScroll, '667x330 판 중 그래픽 스크롤 (넷째 줄 몫)').toBeLessThanOrEqual(96);
  if (!g.note) throw new Error('판 중 안내 없음');
  expect(g.note.top, '667x330 판 중 안내가 머리 줄 안').toBeGreaterThanOrEqual(g.close.top - 0.5);
  expect(g.note.bottom, '667x330 판 중 안내가 머리 줄 안').toBeLessThanOrEqual(g.close.bottom + 0.5);
  expect(g.note.right).toBeLessThanOrEqual(g.resetAll.left);
  expect(g.body.top - g.close.bottom).toBeLessThanOrEqual(4);
  expect(problems).toEqual([]);
  await context.close();
});

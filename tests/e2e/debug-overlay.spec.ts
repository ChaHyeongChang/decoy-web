// ?debug=1 오버레이 (렌더링 최적화): 배포 빌드(서버가 주는 client/dist)에서 ?debug=1만으로 뜨는 측정 표시.
//  - PC 1280×720 연습 판: 펼친 채 시작, 한 화면에 FPS · 프레임 · 작업 · 그리기 · 핑 · 서버 틱 · 예측 · 품질 · 제한 · DPR,
//    값이 1초 사이에 바뀐다(서버 틱이 늘고, 측정 값이 '-'가 아니다). 칩을 눌러 접고 펼친다. 칩 클릭은 괴물 공격이 아니고,
//    펼친 표는 마우스가 통과한다
//  - 휴대폰 가로 · 태블릿(helpers LANDSCAPE_DEVICES, 기기 배율 1): 접은 칩으로 시작, 칩(보이는 한 줄)은 판 HUD 부품 ·
//    터치 대상과 겹치지 않고, 누르는 자리(44px 높이)는 터치 대상 · 늘 떠 있는 HUD와 겹치지 않는다. 탭으로 펼치고 접으며
//    그동안 판 입력 기록(getInputLog)에 이동 · 버튼 · 조준이 생기지 않는다. 바깥을 누르면 닫히는 것(로비 설정 메뉴 · 판 점수판,
//    문서 캡처 단계 리스너)은 칩을 눌러도 닫히지 않고, 칩 밖을 누르면 그대로 닫힌다
//  - ?debug=hook(시험 훅만) · 아무것도 없으면 오버레이가 없다
// 프레임 측정 값(FPS · 프레임 · 작업)은 main.ts가 Phaser 한 걸음마다 sessionFrameStats.begin/end를 부를 때 채워진다
import { expect, test, type Page } from '@playwright/test';
import { BTN, type HudLayoutItem, type InputLogEntry, type TouchTarget } from '@decoy/shared';
import {
  LANDSCAPE_DEVICES,
  PHONE_LANDSCAPE,
  PHONE_SMALL,
  dpr1,
  newPlayerPage,
  press,
  recordInputs,
  type DeviceOptions,
} from './helpers';
import { waitForTouchTarget } from './touch';

const QUERY = '/?debug=1&renderer=canvas';
const POLL = { intervals: [100, 150, 200], timeout: 20_000 };
/** 늘 떠 있는 HUD 부품 (m12-screen과 같다) */
const PERSISTENT = /^(timer|gaugeA|gaugeB|card\d|minimap)$/;
/** 펼친 표에 있어야 하는 이름표 */
const PANEL_LABELS = ['FPS', '프레임', '작업', '그리기', '핑', '서버 틱', '예측', '품질', '제한', 'DPR'];

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface OverlayState {
  expanded: string | null;
  chip: Box | null;
  toggle: Box | null;
  panel: Box | null;
  panelHidden: boolean;
  chipText: string;
  panelText: string;
}

/** 헤드리스 크롬의 진짜 전체 화면은 창 크기를 바꾼다 (m12-screen과 같다) */
function stubFullscreen(): void {
  Element.prototype.requestFullscreen = function () {
    return Promise.resolve();
  };
}

async function overlayState(page: Page): Promise<OverlayState | null> {
  return page.evaluate(() => {
    const root = document.getElementById('debug-overlay');
    if (!root) return null;
    const box = (sel: string): { x: number; y: number; w: number; h: number } | null => {
      const el = root.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    };
    const panel = root.querySelector<HTMLElement>('.dbg-panel');
    return {
      expanded: root.querySelector('.dbg-toggle')?.getAttribute('aria-expanded') ?? null,
      chip: box('.dbg-chip'),
      toggle: box('.dbg-toggle'),
      panel: box('.dbg-panel'),
      panelHidden: panel?.hidden ?? true,
      chipText: root.querySelector('.dbg-chip')?.textContent ?? '',
      panelText: panel?.textContent ?? '',
    };
  });
}

/** 겹친 길이 (0.5px 이하 닿음은 겹침이 아니다, m12-screen과 같다) */
function overlap(a: Box, b: Box): number {
  const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return ox > 0.5 && oy > 0.5 ? Math.min(ox, oy) : 0;
}

/** 연습 판을 시작하고 판 HUD(팀 카드까지)가 그려질 때까지 기다린다 */
async function startPractice(page: Page, role: 'runner' | 'monster'): Promise<void> {
  await press(page.getByTestId('practice'));
  await press(page.getByTestId(`practice-role-${role}`));
  await page.waitForFunction(
    () => window.__DECOY__?.getHudLayout()?.items.some((i) => i.id === 'card2'),
    null,
    {
      polling: 150,
      timeout: 30_000,
    },
  );
}

/** 칩을 눌러 펼치거나(true) 접고(false) 그렇게 됐는지 본다 */
async function tapChip(page: Page, expand: boolean): Promise<void> {
  await press(page.getByTestId('debug-overlay-toggle'));
  if (expand) await expect(page.getByTestId('debug-overlay-panel')).toBeVisible();
  else await expect(page.getByTestId('debug-overlay-panel')).toBeHidden();
}

/** 펼친 표의 숫자 하나 */
function num(text: string, re: RegExp): number {
  const m = re.exec(text);
  return m ? Number(m[1]) : Number.NaN;
}

/** 이동 · 버튼이 없고 조준이 처음과 같은 프레임인가 (가만히 있는 판) */
function idle(frames: readonly InputLogEntry[]): string[] {
  const aim0 = frames[0]?.aim;
  const same = (a: number, b: number | undefined): boolean =>
    (Number.isNaN(a) && b !== undefined && Number.isNaN(b)) || a === b;
  return frames
    .filter((f) => f.mx !== 0 || f.my !== 0 || f.held !== 0 || f.pressed !== 0 || !same(f.aim, aim0))
    .map((f) => `seq ${f.seq}: mx ${f.mx} my ${f.my} held ${f.held} pressed ${f.pressed} aim ${f.aim}`);
}

test('PC 1280×720: 펼친 채 시작, 한 화면에 모든 항목 · 값이 바뀐다, 칩으로 접고 펼친다 (클릭은 공격이 아니다)', async ({
  browser,
}) => {
  const { context, page, problems } = await newPlayerPage(browser, {
    viewport: { width: 1280, height: 720 },
  });
  await page.goto(QUERY);
  await expect(page.getByTestId('debug-overlay')).toBeVisible();
  // 로비에서도 PC는 펼친 표
  expect((await overlayState(page))?.expanded).toBe('true');
  await startPractice(page, 'monster');
  await expect(page.getByTestId('debug-overlay-panel')).toBeVisible();

  // 측정이 찰 때까지 (판 시작 직후 첫 프레임들). FPS · 그린 객체 수 · 서버 틱이 모두 찰 때까지 기다린다: 첫 화면에서 그림을
  // 미리 구워 두면 판 장면이 빨리 떠서, 첫 스냅샷 전 프레임(그린 객체 0개 · 서버 틱 없음)에 FPS가 먼저 찰 수 있다
  await expect
    .poll(async () => {
      const t = (await overlayState(page))?.panelText ?? '';
      return Math.min(num(t, /FPS ([\d.]+)/), num(t, /그리기 객체 (\d+)개/), num(t, /서버 틱 (\d+)/));
    }, POLL)
    .toBeGreaterThan(0);
  const a = (await overlayState(page))!;
  for (const label of PANEL_LABELS) expect(a.panelText, label).toContain(label);
  const lines = a.panelText.split('\n');
  expect(lines.length).toBeLessThanOrEqual(8);
  expect(a.panelText).toMatch(/프레임 [\d.]+ms · p95 [\d.]+ms · 늦음 \d+% · 넘김 \d+%/);
  // 판 중이라 안개 주기 프레임이 있다: 그 프레임만의 작업 p95 (잔렉 고치기)
  expect(a.panelText).toMatch(/작업 [\d.]+ms · p95 [\d.]+ms · 안개 p95 [\d.]+ms/);
  // Canvas 렌더러: 그린 객체 수 (오버레이를 켰을 때만 센다)
  expect(num(a.panelText, /그리기 객체 (\d+)개/)).toBeGreaterThan(0);
  expect(a.panelText).toMatch(/렌더러 canvas/);
  expect(a.panelText).toMatch(/제한 (자동|60|120|절반)/);
  expect(a.panelText).toMatch(/DPR 1\.00 · \d+×\d+/);
  expect(a.chipText).toMatch(/^▾ \d+fps [\d.]+ms$/);
  // 한 화면: 표 전체가 창 안
  expect(a.panel!.x).toBeGreaterThanOrEqual(0);
  expect(a.panel!.y).toBeGreaterThanOrEqual(0);
  expect(a.panel!.x + a.panel!.w).toBeLessThanOrEqual(1280);
  expect(a.panel!.y + a.panel!.h).toBeLessThanOrEqual(720);
  console.log(`[디버그 오버레이 PC]\n${a.panelText}\n칩 ${a.chipText}`);

  // 1초 사이에 값이 바뀐다 (서버 틱은 판 중 늘 늘어난다)
  await page.waitForTimeout(1200);
  const b = (await overlayState(page))!;
  expect(num(b.panelText, /서버 틱 (\d+)/)).toBeGreaterThan(num(a.panelText, /서버 틱 (\d+)/));
  expect(b.panelText).not.toBe(a.panelText);
  expect(await page.evaluate(() => window.__DECOY__?.getFrameStats()?.frames ?? 0)).toBeGreaterThan(30);

  // 펼친 표는 마우스가 통과한다: 표 가운데 점의 맨 위 요소가 오버레이가 아니다
  const through = await page.evaluate(
    ({ x, y }) => document.elementFromPoint(x, y)?.closest('#debug-overlay') === null,
    { x: b.panel!.x + b.panel!.w / 2, y: b.panel!.y + b.panel!.h / 2 },
  );
  expect(through).toBe(true);

  // 칩 클릭: 접고 펼친다. 그동안 공격(왼쪽 클릭)이 나가지 않는다
  const rec = await recordInputs(page);
  await page.getByTestId('debug-overlay-toggle').click();
  await expect(page.getByTestId('debug-overlay-panel')).toBeHidden();
  expect((await overlayState(page))?.chipText).toMatch(/^▸ /);
  await page.getByTestId('debug-overlay-toggle').click();
  await expect(page.getByTestId('debug-overlay-panel')).toBeVisible();
  await page.waitForTimeout(300);
  const frames = await rec.stop();
  expect(frames.length).toBeGreaterThan(5);
  expect(frames.filter((f) => (f.pressed & BTN.ATTACK) !== 0 || (f.held & BTN.ATTACK) !== 0)).toEqual([]);
  expect(problems).toEqual([]);
  await context.close();
});

test('?debug=1이 아니면 오버레이가 없다 (?debug=hook은 시험 훅만)', async ({ browser }) => {
  const { context, page, problems } = await newPlayerPage(browser);
  await page.goto('/?debug=hook&renderer=canvas');
  await expect(page.getByTestId('practice')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__DECOY__ !== undefined)).toBe(true);
  expect(await page.locator('#debug-overlay').count()).toBe(0);
  await page.goto('/?renderer=canvas');
  await expect(page.getByTestId('practice')).toBeVisible();
  expect(await page.locator('#debug-overlay').count()).toBe(0);
  expect(await page.evaluate(() => window.__DECOY__ === undefined)).toBe(true);
  expect(problems).toEqual([]);
  await context.close();
});

/** 가로 터치 기기 · 역할 (모든 기기는 생존자, 엄지 버튼이 많은 괴물은 가장 넓은 · 가장 낮은 휴대폰) */
const TOUCH_CASES: { name: string; device: DeviceOptions; role: 'runner' | 'monster' }[] = [
  ...LANDSCAPE_DEVICES.map((d) => ({ name: d.name, device: d.device, role: 'runner' as const })),
  { name: 'Pixel 7 전체 화면 915×412', device: PHONE_LANDSCAPE, role: 'monster' },
  { name: 'Pixel 5 802×293', device: PHONE_SMALL, role: 'monster' },
];

/** 칩 · 누르는 자리와 HUD · 터치 대상의 겹침 (빈 배열이면 통과) */
function chipProblems(chip: Box, toggle: Box, items: HudLayoutItem[], targets: TouchTarget[]): string[] {
  const out: string[] = [];
  const f = (v: number): string => v.toFixed(1);
  const label = (i: HudLayoutItem): string => `${i.id}${i.text ? `「${i.text.slice(0, 12)}」` : ''}`;
  // 보이는 칩: 지금 보이는 모든 HUD 부품(배너 · 메모 포함) · 모든 터치 대상과 겹치지 않는다
  for (const i of items) if (overlap(chip, i) > 0) out.push(`칩 ↔ ${label(i)} ${f(overlap(chip, i))}px`);
  // 누르는 자리(투명, 44px 높이): 터치 대상(이동 영역 포함)과 늘 떠 있는 HUD를 덮지 않는다
  for (const t of targets) {
    if (overlap(chip, t) > 0) out.push(`칩 ↔ ${t.id} ${f(overlap(chip, t))}px`);
    if (overlap(toggle, t) > 0) out.push(`누르는 자리 ↔ ${t.id} ${f(overlap(toggle, t))}px`);
  }
  for (const i of items)
    if (PERSISTENT.test(i.id) && overlap(toggle, i) > 0)
      out.push(`누르는 자리 ↔ ${label(i)} ${f(overlap(toggle, i))}px`);
  return out;
}

for (const c of TOUCH_CASES) {
  test(`[${c.name} · ${c.role}] 접은 칩으로 시작, HUD · 터치 대상과 겹치지 않는다, 탭으로 펼치고 접어도 판 입력이 없다`, async ({
    browser,
  }) => {
    const { context, page, problems } = await newPlayerPage(browser, dpr1(c.device));
    await context.addInitScript(stubFullscreen);
    await page.goto(QUERY);
    await expect(page.getByTestId('debug-overlay-chip')).toBeVisible();
    const lobby = (await overlayState(page))!;
    expect(lobby.expanded).toBe('false');
    expect(lobby.panelHidden).toBe(true);
    // 칩은 로비에서 눌러 펼치고 접는다 (판 입력 · 설정 단추로 가지 않는다)
    const settings = page.getByTestId('settings-panel');
    await tapChip(page, true);
    await tapChip(page, false);
    await expect(settings).toBeHidden();
    // 설정 화면(덮개)은 막(카드 바깥)을 누르면 닫힌다
    await press(page.getByTestId('settings-button'));
    await expect(settings).toBeVisible();
    const vp0 = page.viewportSize()!;
    await page.touchscreen.tap(3, Math.round(vp0.height / 2));
    await expect(settings).toBeHidden();
    await startPractice(page, c.role);
    await waitForTouchTarget(page, 'move-zone');
    const vp = page.viewportSize()!;

    // 판 시작 직후(메모 · 안내가 떠 있다)와 조금 뒤 두 번 본다
    for (const when of ['시작', '2초 뒤']) {
      if (when !== '시작') await page.waitForTimeout(2000);
      const s = (await overlayState(page))!;
      expect(s.expanded, when).toBe('false');
      expect(s.panelHidden, when).toBe(true);
      expect(s.chipText, when).toMatch(/^▸ /);
      const chip = s.chip!;
      const toggle = s.toggle!;
      // 누르는 자리는 손가락 크기(높이 44px 이상), 보이는 칩은 작다
      expect(toggle.h, when).toBeGreaterThanOrEqual(44);
      expect(chip.h, when).toBeLessThanOrEqual(24);
      // 창 안
      expect(chip.x, when).toBeGreaterThanOrEqual(0);
      expect(chip.y, when).toBeGreaterThanOrEqual(0);
      expect(toggle.x + toggle.w, when).toBeLessThanOrEqual(vp.width);
      expect(toggle.y + toggle.h, when).toBeLessThanOrEqual(vp.height);
      const { items, targets } = await page.evaluate(() => ({
        items: window.__DECOY__?.getHudLayout()?.items ?? [],
        targets: window.__DECOY__?.getTouchTargets() ?? [],
      }));
      expect(items.length, when).toBeGreaterThan(5);
      expect(targets.length, when).toBeGreaterThan(2);
      expect(chipProblems(chip, toggle, items, targets), `${c.name} ${when}`).toEqual([]);
      if (when === '시작')
        console.log(
          `[디버그 오버레이 ${c.name} · ${c.role}] 칩 (${chip.x.toFixed(0)}, ${chip.y.toFixed(0)}) ` +
            `${chip.w.toFixed(0)}×${chip.h.toFixed(0)} · 누르는 자리 ${toggle.w.toFixed(0)}×${toggle.h.toFixed(0)}`,
        );
    }

    // 탭으로 펼치고 접는다. 그동안 판 입력(이동 · 버튼 · 조준)이 생기지 않는다
    const rec = await recordInputs(page);
    await press(page.getByTestId('debug-overlay-toggle'));
    await expect(page.getByTestId('debug-overlay-panel')).toBeVisible();
    const open = (await overlayState(page))!;
    for (const label of PANEL_LABELS) expect(open.panelText, label).toContain(label);
    expect(open.chipText).toMatch(/^▾ /);
    expect(open.panelText).toContain('입력 touch');
    // 펼친 표는 손가락이 통과한다
    const through = await page.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.closest('#debug-overlay') === null,
      { x: open.panel!.x + open.panel!.w / 2, y: open.panel!.y + open.panel!.h / 2 },
    );
    expect(through).toBe(true);
    await press(page.getByTestId('debug-overlay-toggle'));
    await expect(page.getByTestId('debug-overlay-panel')).toBeHidden();
    await press(page.getByTestId('debug-overlay-toggle'));
    await expect(page.getByTestId('debug-overlay-panel')).toBeVisible();
    await press(page.getByTestId('debug-overlay-toggle'));
    await expect(page.getByTestId('debug-overlay-panel')).toBeHidden();
    await page.waitForTimeout(300);
    const frames = await rec.stop();
    expect(frames.length).toBeGreaterThan(5);
    expect(frames.every((f) => f.mode === 'touch')).toBe(true);
    expect(idle(frames)).toEqual([]);

    // 점수판은 화면 어디를 눌러도 닫힌다(문서 캡처 리스너) — 칩은 예외: 펼치고 접어도 열린 채
    const board = page.locator('[data-touch-target="scoreboard"]');
    await press(board);
    await expect(board).toHaveAttribute('aria-pressed', 'true');
    await tapChip(page, true);
    await page.waitForTimeout(200);
    await expect(board).toHaveAttribute('aria-pressed', 'true');
    await tapChip(page, false);
    await page.waitForTimeout(200);
    await expect(board).toHaveAttribute('aria-pressed', 'true');
    // 칩 밖(맵 가운데)을 누르면 예전처럼 닫힌다 (칩만 예외다)
    const map = await page.evaluate(() => window.__DECOY__?.getHudLayout()?.map ?? null);
    expect(map).not.toBeNull();
    await page.touchscreen.tap(map!.x + map!.w / 2, map!.y + map!.h / 2);
    await expect(board).toHaveAttribute('aria-pressed', 'false');
    expect(problems).toEqual([]);
    await context.close();
  });
}

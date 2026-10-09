// M11 검증 도구 자체 시험: CDP 멀티터치(tests/e2e/touch.ts)의 의미, 브라우저 제스처 대조(pointercancel · 핀치),
// 기기 감지 근거(matchMedia), 사용자 활성화, 디버그 훅(getTouchTargets · getInputLog · inputMode), 입력 기록기,
// 터치 대상 배치 검사, 기기를 섞은 4인 판 시작(휴대폰은 탭). 게임 기능 시험(m11-touch · m11-mixed)이 이 도구들 위에 선다
import { expect, test, type Browser, type Page } from '@playwright/test';
import { BTN, type InputLogEntry, type TouchTarget } from '@decoy/shared';
import {
  BASE_QUERY,
  LANDSCAPE_DEVICES,
  PC_NARROW,
  PHONE_LANDSCAPE,
  PHONE_SMALL,
  closeAll,
  countHeld,
  countPressed,
  dpr1,
  newPlayerPage,
  pointerCounts,
  portrait,
  recordInputs,
  startFourPlayerMatch,
  type DeviceOptions,
} from './helpers';
import {
  MultiTouch,
  emulateSafeArea,
  measureTouchLayout,
  synthesizePinch,
  touchLayoutProblems,
  touchTargets,
  viewportScale,
  type MeasuredTarget,
  type TouchLayout,
} from './touch';

/** 시험 페이지 주소 (route로 응답한다 — setContent · evaluate 없이 열어야 사용자 활성화가 생기지 않는다) */
const TEST_URL = 'http://m11-tools.test/';

/** 시험 페이지를 연다. 서버 없이 route로 html을 돌려준다 */
async function openHtml(page: Page, html: string): Promise<void> {
  await page.route(TEST_URL, (route) =>
    route.fulfill({ contentType: 'text/html; charset=utf-8', body: html }),
  );
  await page.goto(TEST_URL);
}

const newPage = (browser: Browser, device?: DeviceOptions) => newPlayerPage(browser, device);

const VIEWPORT_OPEN = 'width=device-width, initial-scale=1';
const VIEWPORT_LOCKED = 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no';

/** 포인터 이벤트를 [종류, pointerId, pointerType, x, y, isPrimary]로 기록하는 시험 페이지 */
function pointerPage(opts: { meta?: string; body?: string; css?: string } = {}): string {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="${opts.meta ?? VIEWPORT_OPEN}">
<style>html,body{margin:0;background:#0b1622} ${opts.css ?? '#pad{position:fixed;inset:0;touch-action:none}'}</style>
${opts.body ?? '<div id="pad"></div>'}
<script>
window.log = [];
for (const t of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'])
  addEventListener(t, (e) => log.push([e.type, e.pointerId, e.pointerType, e.clientX, e.clientY, e.isPrimary, e.target.id]), true);
</script>`;
}

type PointerRow = [string, number, string, number, number, boolean, string];

const pointerLog = (page: Page): Promise<PointerRow[]> =>
  page.evaluate(() => (window as unknown as { log: PointerRow[] }).log);

test('CDP 멀티터치: 손가락마다 pointerId가 다르고, 하나만 떼도 다른 손가락은 계속 눌려 움직인다', async ({
  browser,
}) => {
  // 기기 배율 2.625 그대로: 좌표가 기기 픽셀이 아니라 CSS px인지 함께 본다
  const { context, page, problems } = await newPage(browser, PHONE_LANDSCAPE);
  await openHtml(page, pointerPage());
  const t = await MultiTouch.attach(page);

  await t.down(1, 100, 120);
  await t.down(2, 700, 300);
  await t.move(1, 160, 120, { steps: 3 });
  await t.move(2, 700, 240, { steps: 3 });
  expect(t.active.sort()).toEqual([1, 2]);
  await t.up(1);
  await t.move(2, 640, 240, { steps: 2 });
  // 1번을 뗀 뒤에도 2번은 눌린 채(손가락이 하나 남음)
  expect(await page.evaluate(() => (window as unknown as { log: PointerRow[] }).log.at(-1)?.[0])).toBe(
    'pointermove',
  );
  await t.up(2);
  expect(t.active).toEqual([]);

  const log = await pointerLog(page);
  const ids = [...new Set(log.map((r) => r[1]))];
  expect(ids).toHaveLength(2);
  const [idA, idB] = ids as [number, number];
  expect(log.every((r) => r[2] === 'touch')).toBe(true);
  expect(log.some((r) => r[0] === 'pointercancel')).toBe(false);
  // 처음 손가락만 isPrimary
  expect(log.filter((r) => r[1] === idA).every((r) => r[5])).toBe(true);
  expect(log.filter((r) => r[1] === idB).every((r) => !r[5])).toBe(true);

  // 순서: A 누름 → B 누름 → A 끌기 → B 끌기 → A 뗌 → B 끌기(계속) → B 뗌
  const seq = log.map((r) => `${r[0].slice(7)}:${r[1] === idA ? 'A' : 'B'}`);
  const compact = seq.filter((s, i) => s !== seq[i - 1]);
  expect(compact).toEqual(['down:A', 'down:B', 'move:A', 'move:B', 'up:A', 'move:B', 'up:B']);

  // 좌표는 CSS px (창 기준)
  const lastA = log.filter((r) => r[1] === idA && r[0] === 'pointermove').at(-1);
  const lastB = log.filter((r) => r[1] === idB && r[0] === 'pointermove').at(-1);
  expect(lastA?.[3]).toBeCloseTo(160, 0);
  expect(lastA?.[4]).toBeCloseTo(120, 0);
  expect(lastB?.[3]).toBeCloseTo(640, 0);
  expect(lastB?.[4]).toBeCloseTo(240, 0);

  // 잘못 쓰면 막는다 (CDP는 모르는 id의 touchMove · touchEnd로 새 손가락을 만든다)
  await expect(t.move(9, 10, 10)).rejects.toThrow('눌려 있지 않습니다');
  await expect(t.up(9)).rejects.toThrow('눌려 있지 않습니다');
  await t.down(3, 300, 200);
  await expect(t.down(3, 300, 200)).rejects.toThrow('이미 눌려 있습니다');

  // cancel = 모든 손가락 취소 (pointercancel), detach = 남은 손가락 떼기
  await t.down(4, 500, 200);
  await t.cancel();
  const cancels = (await pointerLog(page)).filter((r) => r[0] === 'pointercancel');
  expect(cancels).toHaveLength(2);
  await t.detach();
  expect(problems).toEqual([]);
  await context.close();
});

test('제스처 대조: 보호하지 않은 곳을 끌면 스크롤되고 pointercancel, touch-action: none이면 끝까지 받는다', async ({
  browser,
}) => {
  const { context, page } = await newPage(browser, dpr1(PHONE_LANDSCAPE));
  await openHtml(
    page,
    pointerPage({
      css: '#free{height:2000px;touch-action:auto} #locked{position:fixed;left:0;top:0;width:400px;height:300px;touch-action:none;background:#123}',
      body: '<div id="free"></div><div id="locked"></div>',
    }),
  );
  const t = await MultiTouch.attach(page);
  const drag = async (x: number) => {
    await t.down(1, x, 280);
    await t.move(1, x, 80, { steps: 8 });
    await t.up(1);
  };
  await drag(200); // touch-action: none
  const locked = await pointerLog(page);
  expect(locked.map((r) => r[0])).not.toContain('pointercancel');
  expect(locked.at(-1)?.[0]).toBe('pointerup');
  expect(await page.evaluate(() => window.scrollY)).toBe(0);

  await page.evaluate(() => ((window as unknown as { log: PointerRow[] }).log = []));
  await drag(700); // touch-action: auto → 브라우저가 스크롤로 가져간다
  await expect.poll(() => page.evaluate(() => window.scrollY), { intervals: [100] }).toBeGreaterThan(50);
  const free = await pointerLog(page);
  expect(free.filter((r) => r[0] === 'pointercancel')).toHaveLength(1);
  expect(free.map((r) => r[0])).not.toContain('pointerup');
  await t.detach();
  await context.close();
});

test('핀치 대조: 두 손가락 핀치로 보호하지 않은 페이지는 확대되고, meta viewport 잠금 · touch-action: none이면 그대로', async ({
  browser,
}) => {
  const { context } = await newPage(browser, dpr1(PHONE_LANDSCAPE));
  // 확대 상태가 페이지에 남으므로 경우마다 새 페이지
  const fingerPinch = async (meta: string, css: string) => {
    const page = await context.newPage();
    await openHtml(page, pointerPage({ meta, css }));
    const t = await MultiTouch.attach(page);
    await t.pinch(450, 200, 80, 380);
    await t.detach();
    await page.waitForTimeout(200);
    const s = await viewportScale(page);
    await page.close();
    return s;
  };
  const OPEN_PAD = '#pad{height:1200px;touch-action:auto}';
  const NONE_PAD = '#pad{position:fixed;inset:0;touch-action:none}';
  expect(await fingerPinch(VIEWPORT_OPEN, OPEN_PAD)).toBeGreaterThan(1.5);
  expect(await fingerPinch(VIEWPORT_LOCKED, OPEN_PAD)).toBe(1);
  expect(await fingerPinch(VIEWPORT_OPEN, NONE_PAD)).toBe(1);

  // CDP synthesizePinchGesture: 'mouse'(터치패드 핀치)만 확대된다. meta 잠금은 따르고 touch-action은 무시한다
  // ('touch' 원천은 손가락 이벤트만 나고 확대되지 않는다 — 그래서 손가락 핀치는 MultiTouch.pinch를 쓴다)
  const synth = async (meta: string, css: string) => {
    const page = await context.newPage();
    await openHtml(page, pointerPage({ meta, css }));
    await synthesizePinch(page, { x: 450, y: 200, scale: 2 });
    await page.waitForTimeout(200);
    const s = await viewportScale(page);
    await page.close();
    return s;
  };
  expect(await synth(VIEWPORT_OPEN, OPEN_PAD)).toBeGreaterThan(1.5);
  expect(await synth(VIEWPORT_LOCKED, OPEN_PAD)).toBe(1);
  expect(await synth(VIEWPORT_OPEN, NONE_PAD)).toBeGreaterThan(1.5);
  await context.close();
});

test('기기 감지 근거: 터치 기기는 (pointer: coarse) · (hover: none), PC는 아니다', async ({ browser }) => {
  const cases: { name: string; device: DeviceOptions | undefined; touch: boolean; portrait: boolean }[] = [
    ...LANDSCAPE_DEVICES.map((d) => ({ name: d.name, device: dpr1(d.device), touch: true, portrait: false })),
    { name: '휴대폰 세로', device: dpr1(portrait(PHONE_LANDSCAPE)), touch: true, portrait: true },
    { name: 'PC 960×540', device: undefined, touch: false, portrait: false },
    { name: 'PC 좁은 창', device: PC_NARROW, touch: false, portrait: true },
  ];
  const report: Record<string, Record<string, boolean | number>> = {};
  for (const c of cases) {
    const { context, page } = await newPage(browser, c.device);
    await openHtml(page, pointerPage());
    const m = await page.evaluate(() => {
      const q = (s: string) => window.matchMedia(s).matches;
      return {
        coarse: q('(pointer: coarse)'),
        hoverNone: q('(hover: none)'),
        anyFine: q('(any-pointer: fine)'),
        portrait: q('(orientation: portrait)'),
        maxTouchPoints: navigator.maxTouchPoints,
        w: window.innerWidth,
        h: window.innerHeight,
      };
    });
    report[c.name] = m;
    expect(m.coarse, c.name).toBe(c.touch);
    expect(m.hoverNone, c.name).toBe(c.touch);
    expect(m.anyFine, c.name).toBe(!c.touch);
    expect(m.portrait, c.name).toBe(c.portrait);
    // 헤드리스 에뮬레이션의 maxTouchPoints는 1이라 감지에 쓰지 않는다 (MOBILE_PLAN M11 3번)
    expect(m.maxTouchPoints, c.name).toBe(c.touch ? 1 : 0);
    const vp = c.device?.viewport ?? { width: 960, height: 540 };
    expect([m.w, m.h], c.name).toEqual([vp.width, vp.height]);
    await context.close();
  }
  await test
    .info()
    .attach('matchMedia.json', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
});

test('사용자 활성화: 터치 pointerdown은 활성화가 아니고 pointerup부터, page.evaluate는 활성화를 만든다', async ({
  browser,
}) => {
  // 오디오(M11 9번) 시험 설계 근거: 터치 pointerdown에서 만든 AudioContext는 멈춰 있다. evaluate를 한 번이라도 부르면
  // 문서가 활성화되어(Playwright가 사용자 제스처로 실행) 그 뒤로는 구분할 수 없다
  const { context, page } = await newPage(browser, dpr1(PHONE_LANDSCAPE));
  await openHtml(
    page,
    pointerPage({
      body: `<div id="pad"></div><script>
window.act = [];
for (const t of ['pointerdown', 'pointerup']) addEventListener(t, () => {
  const ac = new AudioContext();
  act.push([t, navigator.userActivation.hasBeenActive, ac.state]);
  ac.close();
});
</script>`,
    }),
  );
  const t = await MultiTouch.attach(page);
  await t.down(1, 200, 200);
  await t.up(1);
  await t.detach();
  const act = await page.evaluate(() => (window as unknown as { act: [string, boolean, string][] }).act);
  expect(act).toEqual([
    ['pointerdown', false, 'suspended'],
    ['pointerup', true, 'running'],
  ]);

  const fresh = await context.newPage();
  await openHtml(fresh, pointerPage());
  expect(await fresh.evaluate(() => navigator.userActivation.hasBeenActive)).toBe(true);
  await context.close();
});

test('디버그 훅: 판 장면이 없으면 빈 입력 기록 · keyboard, 터치 대상은 #ui-root 안 보이고 입력을 받는 것만', async ({
  browser,
}) => {
  const { context, page, problems } = await newPage(browser);
  await page.goto(`/?${BASE_QUERY.slice(1)}`);
  await expect(page.getByTestId('create-room')).toBeVisible();
  expect(await page.evaluate(() => window.__DECOY__?.getInputLog())).toEqual([]);
  expect(await page.evaluate(() => window.__DECOY__?.inputMode)).toBe('keyboard');
  // PC 로비에는 터치 대상이 없다
  expect(await touchTargets(page)).toEqual([]);

  // 터치 화면처럼 꾸민 요소: 컨테이너는 pointer-events: none, 받는 요소만 auto
  await page.evaluate(() => {
    const layer = document.createElement('div');
    layer.id = 'tools-layer';
    layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:50';
    const add = (parent: HTMLElement, id: string, kind: string | null, css: string) => {
      const el = document.createElement('div');
      el.dataset.touchTarget = id;
      if (kind) el.dataset.touchKind = kind;
      el.style.cssText = `position:fixed;pointer-events:auto;${css}`;
      parent.appendChild(el);
      return el;
    };
    add(layer, 'btn', 'button', 'left:600px;top:40px;width:60px;height:56px');
    add(layer, 'zone', 'zone', 'left:40px;top:120px;width:300px;height:200px');
    add(layer, 'round', 'stick', 'left:700px;top:300px;width:120px;height:120px;border-radius:50%');
    add(layer, 'nokind', null, 'left:600px;top:120px;width:50px;height:50px');
    add(layer, 'nokind-bad', 'circle', 'left:660px;top:120px;width:50px;height:50px');
    // 빠져야 하는 것
    add(layer, 'gone', 'button', 'left:10px;top:10px;width:50px;height:50px;display:none');
    add(layer, 'invisible', 'button', 'left:10px;top:10px;width:50px;height:50px;visibility:hidden');
    add(layer, 'ghost', 'button', 'left:10px;top:10px;width:50px;height:50px;pointer-events:none');
    add(layer, 'empty', 'button', 'left:10px;top:10px;width:0;height:50px');
    const faded = document.createElement('div');
    faded.style.opacity = '0';
    layer.appendChild(faded);
    add(faded, 'faded', 'button', 'left:10px;top:10px;width:50px;height:50px');
    const inert = document.createElement('div');
    inert.inert = true;
    layer.appendChild(inert);
    add(inert, 'inert', 'button', 'left:10px;top:10px;width:50px;height:50px');
    document.getElementById('ui-root')?.appendChild(layer);
    add(document.body, 'outside', 'button', 'left:10px;top:10px;width:50px;height:50px');
  });
  const want: TouchTarget[] = [
    { id: 'btn', kind: 'button', x: 600, y: 40, w: 60, h: 56 },
    { id: 'zone', kind: 'zone', x: 40, y: 120, w: 300, h: 200 },
    { id: 'round', kind: 'stick', x: 700, y: 300, w: 120, h: 120 },
    { id: 'nokind', kind: 'button', x: 600, y: 120, w: 50, h: 50 },
    { id: 'nokind-bad', kind: 'button', x: 660, y: 120, w: 50, h: 50 },
  ];
  expect(await touchTargets(page)).toEqual(want);

  // 배치 측정: 둥근 대상 판별 · 안전 영역 흉내
  const layout = await measureTouchLayout(page);
  expect(layout.viewport).toEqual({ w: 960, h: 540 });
  expect(layout.insets).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  expect(Object.fromEntries(layout.targets.map((t) => [t.id, t.round]))).toEqual({
    btn: false,
    zone: false,
    round: true,
    nokind: false,
    'nokind-bad': false,
  });
  await emulateSafeArea(page, { left: 40, bottom: 20 });
  const inset = await measureTouchLayout(page);
  expect(inset.insets).toEqual({ top: 0, right: 0, bottom: 20, left: 40 });
  // zone(x 40)은 안전 영역 40 + 띠 32 = 72 안쪽이어야 한다
  expect(touchLayoutProblems(inset).filter((p) => p.startsWith('zone:'))).toEqual([
    'zone: 왼쪽 띠 안 (x 40.0 < 72)',
  ]);
  await emulateSafeArea(page, {});

  await page.evaluate(() => document.getElementById('tools-layer')?.remove());
  expect(await touchTargets(page)).toEqual([]);
  expect(problems).toEqual([]);
  await context.close();
});

test('배치 검사: 크기 · 간격(원은 원으로) · 화면 밖 · 가장자리 띠 · 안전 영역', () => {
  const t = (id: string, x: number, y: number, w: number, h: number, round = false): MeasuredTarget => ({
    id,
    kind: 'button',
    x,
    y,
    w,
    h,
    round,
  });
  const base = (
    targets: MeasuredTarget[],
    insets = { top: 0, right: 0, bottom: 0, left: 0 },
  ): TouchLayout => ({
    viewport: { w: 915, h: 412 },
    insets,
    targets,
  });
  // 통과: 띠 바로 안쪽 · 간격 정확히 8
  expect(
    touchLayoutProblems(
      base([t('a', 32, 300, 48, 48), t('b', 88, 300, 48, 48), t('c', 915 - 32 - 56, 412 - 24 - 56, 56, 56)]),
    ),
  ).toEqual([]);
  // 크기 · 화면 밖 · 띠
  expect(touchLayoutProblems(base([t('small', 100, 100, 47.5, 60)]))).toEqual(['small: 크기 47.5×60.0 < 48']);
  expect(touchLayoutProblems(base([t('left', 31, 100, 48, 48)]))).toEqual(['left: 왼쪽 띠 안 (x 31.0 < 32)']);
  expect(touchLayoutProblems(base([t('right', 915 - 32 - 47, 100, 48, 48)]))).toEqual([
    'right: 오른쪽 띠 안 (끝 884.0 > 883)',
  ]);
  expect(touchLayoutProblems(base([t('bottom', 300, 412 - 24 - 47, 48, 48)]))).toEqual([
    'bottom: 아래 띠 안 (끝 389.0 > 388)',
  ]);
  expect(touchLayoutProblems(base([t('off', 300, -10, 48, 48)]))).toEqual([
    'off: 화면 밖 (300.0, -10.0, 48.0×48.0 / 915×412)',
    'off: 위 안전 영역 안 (y -10.0 < 0)',
  ]);
  // 안전 영역만큼 띠가 안으로 온다
  expect(
    touchLayoutProblems(base([t('notch', 50, 100, 48, 48)], { top: 0, right: 0, bottom: 0, left: 30 })),
  ).toEqual(['notch: 왼쪽 띠 안 (x 50.0 < 62)']);
  // 사각형끼리: 7px → 걸림, 겹침 → 음수
  expect(touchLayoutProblems(base([t('a', 100, 100, 48, 48), t('b', 155, 100, 48, 48)]))).toEqual([
    'a↔b: 간격 7.0 < 8',
  ]);
  expect(touchLayoutProblems(base([t('a', 100, 100, 48, 48), t('b', 140, 140, 48, 48)]))).toEqual([
    'a↔b: 간격 -8.0 < 8',
  ]);
  // 대각선 원 두 개: 상자는 겹쳐도 원 사이가 8px 이상이면 통과 (적중 판정이 border-radius를 따른다)
  const r = 28;
  const d = 2 * r + 9; // 가운데 거리 = 지름 + 9
  const k = d / Math.SQRT2;
  const circles = [t('c1', 300, 200, 2 * r, 2 * r, true), t('c2', 300 + k, 200 - k, 2 * r, 2 * r, true)];
  expect(touchLayoutProblems(base(circles))).toEqual([]);
  // 같은 자리 사각형이면 걸린다
  expect(touchLayoutProblems(base(circles.map((c) => ({ ...c, round: false })))).length).toBe(1);
});

test('입력 기록기: 시작한 뒤 프레임만, 링 버퍼(120개)를 넘어도 빠짐없이, 새 판에서 seq가 다시 시작해도', async ({
  browser,
}) => {
  const { context, page } = await newPage(browser);
  // 가짜 디버그 훅: 링 버퍼 120개, t가 같은 프레임도 있다
  await openHtml(
    page,
    `<!doctype html><script>
window.fake = { log: [], seq: 0, t: 1000 };
window.__DECOY__ = { getInputLog: () => fake.log.map((e) => ({ ...e })) };
window.pushFrames = (n, opts) => {
  for (let i = 0; i < n; i++) {
    if (opts.resetSeq && i === 0) fake.seq = 0;
    fake.seq += 1;
    if (!(opts.sameT && i % 2 === 1)) fake.t += 33.3;
    const pressed = fake.seq % 7 === 0 ? 1 : 0;
    fake.log.push({ seq: fake.seq, mx: 0, my: -1, aim: 0, held: fake.seq % 5 === 0 ? 4 : 0, pressed, t: fake.t, mode: 'touch' });
    if (fake.log.length > 120) fake.log.shift();
  }
};
</script>`,
  );
  type Push = (n: number, opts: { resetSeq?: boolean; sameT?: boolean }) => void;
  const push = (n: number, opts: { resetSeq?: boolean; sameT?: boolean } = {}) =>
    page.evaluate(([k, o]) => (window as unknown as { pushFrames: Push }).pushFrames(k, o), [
      n,
      opts,
    ] as const);
  await push(50); // 시작 전 프레임은 세지 않는다
  const rec = await recordInputs(page, 40);
  // 1/30초 입력 프레임처럼 조금씩: 기록기가 읽기 전에 링 버퍼가 한 바퀴 돌면 놓친다(실제로는 4초)
  const batches: { resetSeq?: boolean; sameT?: boolean }[] = [
    ...Array.from({ length: 20 }, (_, i) => ({ sameT: i % 4 === 0 })), // 200개 (링 버퍼보다 많다)
    { resetSeq: true }, // 새 판: seq 1부터
    ...Array.from({ length: 9 }, () => ({})),
  ];
  for (const b of batches) {
    await push(10, b);
    await page.waitForTimeout(30);
  }
  const got: InputLogEntry[] = await rec.stop();
  expect(got).toHaveLength(300);
  expect(got[0]?.seq).toBe(51);
  expect(got[199]?.seq).toBe(250);
  expect(got[200]?.seq).toBe(1);
  expect(got.at(-1)?.seq).toBe(100);
  for (let i = 1; i < got.length; i += 1) expect(got[i]!.t).toBeGreaterThanOrEqual(got[i - 1]!.t);
  const sevens = (from: number, to: number) => Math.floor(to / 7) - Math.floor((from - 1) / 7);
  expect(countPressed(got, BTN.ATTACK)).toBe(sevens(51, 250) + sevens(1, 100));
  expect(countPressed(got, BTN.MODE)).toBe(0);
  expect(countHeld(got, BTN.RESCUE)).toBe(40 + 20);
  // 멈춘 뒤 프레임은 붙지 않는다
  await push(10);
  expect(await rec.entries()).toHaveLength(300);
  await context.close();
});

test('기기를 섞은 4인 판: 휴대폰은 로비를 탭으로, PC는 마우스로 시작하고 디버그 훅이 모두 응답한다', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const devices = [dpr1(PHONE_LANDSCAPE), undefined, undefined, dpr1(PHONE_SMALL)];
  const { players } = await startFourPlayerMatch(browser, undefined, undefined, devices);
  const report: Record<string, Record<string, number>> = {};
  for (const [i, p] of players.entries()) {
    const phone = devices[i] !== undefined;
    expect(p.touch, p.role).toBe(phone);
    const counts = await pointerCounts(p.page);
    report[p.role] = counts;
    const touchDowns = counts['pointerdown:touch'] ?? 0;
    const mouseDowns = counts['pointerdown:mouse'] ?? 0;
    // 방장(괴물): 방 만들기 · 역할 · 준비 · 시작 = 4번, 나머지: 역할 · 준비 = 2번 (방 만들기 문서는 입장 뒤 그대로)
    const want = i === 0 ? 4 : 2;
    expect(phone ? touchDowns : mouseDowns, p.role).toBeGreaterThanOrEqual(want);
    expect(phone ? mouseDowns : touchDowns, p.role).toBe(0);
    expect(counts['pointercancel:touch'] ?? 0, p.role).toBe(0);

    const hook = await p.page.evaluate(() => {
      const d = window.__DECOY__;
      return {
        coarse: window.matchMedia('(pointer: coarse)').matches,
        mode: d?.inputMode,
        log: d?.getInputLog() ?? null,
        targets: d?.getTouchTargets() ?? null,
      };
    });
    expect(hook.coarse, p.role).toBe(phone);
    expect(['keyboard', 'touch'], p.role).toContain(hook.mode);
    expect(Array.isArray(hook.log)).toBe(true);
    // 입력 기록이 있으면(갈래 A) InputFrame + t · mode 모양. PC 프레임은 모두 keyboard
    for (const e of hook.log ?? []) {
      expect(Object.keys(e)).toEqual(
        expect.arrayContaining(['seq', 'mx', 'my', 'aim', 'held', 'pressed', 't', 'mode']),
      );
      expect(phone ? ['keyboard', 'touch'] : ['keyboard'], p.role).toContain(e.mode);
    }
    for (const t of hook.targets ?? []) {
      expect(t.id.length, p.role).toBeGreaterThan(0);
      expect(['zone', 'stick', 'button']).toContain(t.kind);
      expect(t.w * t.h).toBeGreaterThan(0);
    }
    // PC는 터치 화면을 만들지 않는다 (MOBILE_PLAN M11 3번)
    if (!phone) {
      expect(hook.mode, p.role).toBe('keyboard');
      expect(hook.targets, p.role).toEqual([]);
    }
    expect(p.problems, p.role).toEqual([]);
  }
  await test.info().attach('pointer-counts.json', {
    body: JSON.stringify(report, null, 2),
    contentType: 'application/json',
  });
  await closeAll(players);
});

// M12 검토 반영 (터치 판 HUD): ⑦ 판 중 창이 낮아지면 오른쪽 엄지 버튼과 겹치는 미니맵을 숨기고 크기가 돌아오면 다시 보인다,
// ⑧ 판 직전 터치 안내 카드(그림 번호 · 목록 번호)와 판 중 터치 레이어의 보이는 글자가 모두 CSS 12px 이상,
// ⑨ 낮은 화면에서 배너를 쌓아도 메모 상자가 감옥(맵 14~18타일)을 덮지 않고, 알림이 빠지면 메모가 뜬다,
// ⑩ 가로 180° 뒤집기(창 크기는 그대로, 안전 영역 좌우만 바뀜)에서 터치 화면을 새 안전 영역에 맞춰 다시 배치한다.
// 혼자 봇 방(?bots=1)에서 판을 시작한다. 기기 배율 1. 느린 CI 대비: 간격 폴링(100~200ms) · 서버 정답으로 상태 확인
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import type { HudLayout, HudLayoutItem, Role, TestCommand, TouchTarget } from '@decoy/shared';
import {
  PHONE_BROWSER,
  PHONE_LANDSCAPE,
  PHONE_NARROW,
  PHONE_SMALL,
  createRoom,
  dpr1,
  myId,
  newPlayerPage,
  pickRoleAndReady,
  press,
  sendTest,
  truth,
  waitForSnapshots,
  type DeviceOptions,
} from './helpers';
import {
  emulateSafeArea,
  measureTouchLayout,
  touchLayoutProblems,
  touchTargets,
  waitForTouchTarget,
} from './touch';

const POLL = { intervals: [100, 150, 200], timeout: 20_000 };
/** 글자 하한 (CSS px, MOBILE_PLAN M12 2번) */
const MIN_FONT = 12;
/** 늘 떠 있는 HUD 부품 */
const PERSISTENT = /^(timer|gaugeA|gaugeB|card\d|minimap)$/;

/** 터치 기기 (기기 배율 1, 창 크기 지정) */
function touchDevice(width: number, height: number): DeviceOptions {
  return dpr1({ ...PHONE_BROWSER, viewport: { width, height }, screen: { width, height } });
}

/** 헤드리스 크롬의 진짜 전체 화면은 창 크기를 바꾼다: 아무것도 하지 않게 해 전체 화면 버튼까지 든 배치를 본다 (m12-screen과 같다) */
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

/** 봇 방을 만들어 역할을 고르고 혼자 시작한다. beforeStart = 준비 뒤 · 시작 직전 */
async function soloMatch(
  browser: Browser,
  device: DeviceOptions,
  role: Role,
  opts: {
    safeArea?: { left?: number; right?: number };
    beforeStart?: (p: Page) => Promise<void>;
    /** 주소에 더 붙일 값 (예: &cam=1) */
    query?: string;
  } = {},
): Promise<Solo> {
  const { context, page, problems } = await newPlayerPage(browser, device);
  await context.addInitScript(stubFullscreen);
  if (opts.safeArea) await emulateSafeArea(page, opts.safeArea);
  const code = await createRoom(page, `&bots=1${opts.query ?? ''}`);
  await pickRoleAndReady(page, role);
  if (opts.beforeStart) await opts.beforeStart(page);
  await press(page.getByTestId('start-button'));
  await waitForSnapshots(page, 3);
  await waitForTouchTarget(page, 'move-zone');
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

/** 늘 떠 있는 HUD 부품이 터치 대상(이동 영역 · 스틱 · 버튼)과 겹치는 것 */
function coveredHud(l: HudLayout, targets: TouchTarget[]): string[] {
  const out: string[] = [];
  for (const i of l.items) {
    if (!PERSISTENT.test(i.id)) continue;
    for (const t of targets) {
      const o = overlap(i, t);
      if (o > 0) out.push(`${i.id} ↔ ${t.id} ${o.toFixed(1)}px`);
    }
  }
  return out;
}

const hasMinimap = (l: HudLayout): boolean => l.items.some((i: HudLayoutItem) => i.id === 'minimap');

/** 창 크기를 바꾸고 캔버스 표시 높이가 따라올 때까지 기다린다 (시험 화면은 모두 높이에 맞춰 줄어든다) */
async function resizeTo(page: Page, width: number, height: number): Promise<void> {
  await page.setViewportSize({ width, height });
  await page.waitForFunction(
    (h) => {
      const c = document.querySelector('#game-root canvas')?.getBoundingClientRect();
      return !!c && Math.abs(c.height - h) < 2;
    },
    height,
    { polling: 150, timeout: 10_000 },
  );
}

// ───────────── ⑦ 판 중 창이 낮아짐 ─────────────

/** 미니맵 틀 (HUD 배치의 미니맵 부품을 모두 덮는 사각형) */
function minimapBox(l: HudLayout): { x: number; y: number; w: number; h: number } | null {
  const items = l.items.filter((i) => i.id === 'minimap');
  if (items.length === 0) return null;
  const x0 = Math.min(...items.map((i) => i.x));
  const y0 = Math.min(...items.map((i) => i.y));
  const x1 = Math.max(...items.map((i) => i.x + i.w));
  const y1 = Math.max(...items.map((i) => i.y + i.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

test('판 중 창이 낮아져 엄지 버튼이 미니맵을 덮으면: 확대 화면은 맵 창 안 빈 구석으로 옮기고(확대 1은 숨기고), 크기가 돌아오면 처음 자리 (HUD 부품 ↔ 터치 대상 겹침 없음)', async ({
  browser,
}) => {
  test.setTimeout(200_000);
  const report: string[] = [];
  // 안드로이드 전체 화면이 꺼져 주소창만큼 낮아짐(괴물) · 가장 낮은 휴대폰에서 도구 막대가 나옴(생존자). 마지막은 확대 1(맵 전체 화면)
  const cases: { name: string; device: DeviceOptions; role: Role; low: number; query: string }[] = [
    { name: 'Pixel 7 915×412 → 330', device: dpr1(PHONE_LANDSCAPE), role: 'monster', low: 330, query: '' },
    { name: 'Pixel 5 802×293 → 250', device: dpr1(PHONE_SMALL), role: 'runner', low: 250, query: '' },
    {
      name: 'Pixel 7 915×412 → 330 (확대 1)',
      device: dpr1(PHONE_LANDSCAPE),
      role: 'monster',
      low: 330,
      query: '&cam=1',
    },
  ];
  for (const c of cases) {
    const zoomed = c.query === '';
    const s = await soloMatch(browser, c.device, c.role, { query: c.query });
    const { page } = s;
    const vp = page.viewportSize()!;
    const start = await hudLayout(page);
    expect(hasMinimap(start), `${c.name} 시작`).toBe(true);
    expect(coveredHud(start, await touchTargets(page)), `${c.name} 시작`).toEqual([]);
    const home = minimapBox(start)!;
    const sizeAtStart = [start.viewW, start.viewH];

    await resizeTo(page, vp.width, c.low);
    if (zoomed) {
      // 미니맵이 맵 창 안으로 옮겨진다 (처음 자리가 아니고, 틀까지 맵 사각형 안)
      await expect
        .poll(async () => {
          const b = minimapBox(await hudLayout(page));
          return b !== null && Math.abs(b.x - home.x) + Math.abs(b.y - home.y) > 1;
        }, POLL)
        .toBe(true);
    } else {
      // 확대 1: 미니맵이 숨는다 (표시 목록에서 잰 HUD에 미니맵 그림 · 틀 · 제목이 없다)
      await expect.poll(async () => hasMinimap(await hudLayout(page)), POLL).toBe(false);
    }
    const low = await hudLayout(page);
    const targets = await touchTargets(page);
    // 판 중에는 논리 크기가 그대로다 (글자는 캔버스와 같은 비율로 작아진다 — HUMAN_CHECKS)
    expect([low.viewW, low.viewH], c.name).toEqual(sizeAtStart);
    expect(coveredHud(low, targets), `${c.name} 낮아진 뒤`).toEqual([]);
    expect(touchLayoutProblems(await measureTouchLayout(page)), c.name).toEqual([]);
    if (zoomed) {
      const b = minimapBox(low)!;
      const m = low.map;
      expect(b.x, c.name).toBeGreaterThanOrEqual(m.x - 0.5);
      expect(b.y, c.name).toBeGreaterThanOrEqual(m.y - 0.5);
      expect(b.x + b.w, c.name).toBeLessThanOrEqual(m.x + m.w + 0.5);
      expect(b.y + b.h, c.name).toBeLessThanOrEqual(m.y + m.h + 0.5);
      // 옮긴 미니맵도 메인 화면 그림을 다시 찍는다 (같은 정보 규칙)
      await expect
        .poll(() => page.evaluate(() => window.__DECOY__?.getDrawnMinimap().length ?? -1), POLL)
        .toBeGreaterThan(0);
    } else
      expect(await page.evaluate(() => window.__DECOY__?.getDrawnMinimap().length ?? -1), c.name).toBe(0);
    report.push(
      `${c.name}: ${zoomed ? '옮김' : '숨김'} 뒤 가장 작은 글자 ${Math.min(...low.items.map((i) => i.fontPx ?? 99))}px`,
    );

    await resizeTo(page, vp.width, vp.height);
    await expect
      .poll(async () => {
        const b = minimapBox(await hudLayout(page));
        return b !== null && Math.abs(b.x - home.x) + Math.abs(b.y - home.y) < 1;
      }, POLL)
      .toBe(true);
    expect(coveredHud(await hudLayout(page), await touchTargets(page)), `${c.name} 돌아온 뒤`).toEqual([]);
    expect(s.problems, c.name).toEqual([]);
    await s.context.close();
  }
  console.log(`[m12-hud] ${report.join(' / ')}`);
});

// ───────────── ⑧ 글자 하한 (DOM) ─────────────

/** 보이는 글자가 있는 요소 · ::before 번호의 글자 크기 중 하한 미달 (CSS px) */
async function smallTexts(page: Page, selector: string): Promise<string[]> {
  return page.evaluate(
    ({ sel, min }) => {
      const out: string[] = [];
      for (const root of document.querySelectorAll<HTMLElement>(sel)) {
        for (const el of [root, ...root.querySelectorAll<Element>('*')]) {
          const own = [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim());
          if (own && el.checkVisibility({ checkVisibilityCSS: true, opacityProperty: false })) {
            const px = parseFloat(getComputedStyle(el).fontSize);
            if (!(px >= min - 0.01))
              out.push(
                `${el.tagName.toLowerCase()}.${el.getAttribute('class') ?? ''}「${el.textContent?.trim().slice(0, 10)}」 ${px}px`,
              );
          }
          // 목록 번호 (CSS counter)
          const before = getComputedStyle(el, '::before');
          if (before.content.startsWith('counter') && el.checkVisibility()) {
            const px = parseFloat(before.fontSize);
            if (!(px >= min - 0.01)) out.push(`${el.tagName.toLowerCase()}::before ${px}px`);
          }
        }
      }
      return out;
    },
    { sel: selector, min: MIN_FONT },
  );
}

test('글자 하한: 판 직전 터치 안내(그림 번호 · 목록 번호)와 판 중 터치 레이어의 보이는 글자가 모두 12px 이상 (802×293 · 658×320 · 640×360)', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const cases: [string, DeviceOptions][] = [
    ['802×293', dpr1(PHONE_SMALL)],
    ['658×320', dpr1(PHONE_NARROW)],
    ['640×360', touchDevice(640, 360)],
  ];
  const run = async (name: string, device: DeviceOptions, role: Role): Promise<void> => {
    const label = `${name} ${role}`;
    const s = await soloMatch(browser, device, role, {
      beforeStart: async (page) => {
        const card = page.getByTestId('touch-tutorial');
        await expect(card, label).toBeVisible();
        // 그림의 번호는 목록 번호와 같은 수 (숫자로 잇는다)
        expect(await smallTexts(page, '[data-testid="touch-tutorial"]'), `${label} 안내 카드`).toEqual([]);
        const n = role === 'monster' ? 4 : 3;
        await expect(card.locator('li')).toHaveCount(n);
        await expect(card.locator('.tt-badge')).toHaveCount(n);
        // 그림 번호 배지는 그림 안
        const out = await page.evaluate(() => {
          const art = document.querySelector('.tt-art')!.getBoundingClientRect();
          return [...document.querySelectorAll('.tt-badge')]
            .map((b) => b.getBoundingClientRect())
            .filter(
              (r) =>
                r.left < art.left - 0.5 ||
                r.right > art.right + 0.5 ||
                r.top < art.top - 0.5 ||
                r.bottom > art.bottom + 0.5,
            ).length;
        });
        expect(out, `${label} 배지가 그림 밖`).toBe(0);
      },
    });
    // 판 중: 이름표 · 남은 초 · 점수판 · 전체 화면 · 첫 판 위치 표시 이름표
    await waitForTouchTarget(s.page, 'scoreboard');
    await expect
      .poll(() => s.page.evaluate(() => document.querySelectorAll('.tc-hint-cap').length), POLL)
      .toBe(1);
    expect(await smallTexts(s.page, '.touch-layer'), `${label} 터치 레이어`).toEqual([]);
    expect(s.problems, label).toEqual([]);
    await s.context.close();
  };
  const all = cases.flatMap(([n, d]) => (['monster', 'runner'] as const).map((r) => [n, d, r] as const));
  for (let i = 0; i < all.length; i += 2)
    await Promise.all(all.slice(i, i + 2).map(([n, d, r]) => run(n, d, r)));
});

// ───────────── ⑨ 메모 상자 · 감옥 ─────────────

interface NoteWatch {
  /** 메모가 감옥과 겹친 프레임 수 · 가장 큰 겹침 (CSS px) */
  overlapFrames: number;
  worst: number;
  /** 메모 아래 끝과 감옥 위 끝 사이 가장 좁은 간격 (CSS px, 측정 기록) */
  minGap: number;
  /** 지속 배너 + 알림 두 줄이 함께 보인 프레임 수 (시험 상황이 실제로 생겼는가) */
  stackFrames: number;
  /** 보이는 메모가 바뀐 차례 (first = 앞자리, second = 뒷자리, '' = 메모 없음) */
  runs: string[];
  /** 두 번째 메모가 보인 프레임 수 */
  secondFrames: number;
  done: boolean;
}

test('낮은 화면: 지속 배너 + 알림 두 줄 + 거점 메모를 쌓아도 메모 상자가 감옥을 덮지 않는다 (새 메모는 알림이 빠질 때까지 미루고, 떠 있던 메모는 숨겼다가 남은 시간만큼 다시)', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const report: string[] = [];
  for (const [name, device] of [
    ['802×293', dpr1(PHONE_SMALL)],
    ['640×360', touchDevice(640, 360)],
  ] as const) {
    const s = await soloMatch(browser, device, 'runner');
    const { page } = s;
    const send = (cmd: TestCommand): Promise<void> => sendTest(page, cmd);
    const ids = (await truth(page, s.code)).players;
    const idOf = (role: string): string => ids.find((p) => p.role === role)?.id ?? '';
    // 괴물 봇은 멀리 멈추고, 다른 생존자 봇도 멈춘다
    await send({ kind: 'teleport', target: idOf('monster'), x: 45, y: 2, face: 0 });
    for (const r of ['monster', 'guard', 'scout'])
      await send({ kind: 'freeze', target: idOf(r), frozen: true });
    const banners = (): Promise<string[]> => page.evaluate(() => window.__DECOY__?.getBanners() ?? []);
    // 시작 문구가 사라진 뒤 다른 두 생존자 탈출 → 최후의 30초 (지속 배너)
    await expect.poll(async () => (await banners()).length, POLL).toBe(0);
    await send({ kind: 'setSurvivor', target: idOf('guard'), status: 'escaped' });
    await send({ kind: 'setSurvivor', target: idOf('scout'), status: 'escaped' });
    await expect.poll(async () => (await banners()).some((b) => b.startsWith('30초')), POLL).toBe(true);
    // 프레임마다 메모 상자(표시 목록에서 잰 'note' 그림 · 글자)와 감옥 사각형(맵 22~26 × 14~18타일)을 대조한다
    await page.evaluate(() => {
      const r: NoteWatch = {
        overlapFrames: 0,
        worst: 0,
        minGap: 999,
        stackFrames: 0,
        runs: [],
        secondFrames: 0,
        done: false,
      };
      (window as unknown as { __noteWatch: NoteWatch }).__noteWatch = r;
      const until = performance.now() + 25_000;
      const tick = (): void => {
        const l = window.__DECOY__?.getHudLayout();
        const b = window.__DECOY__?.getBanners() ?? [];
        if (l) {
          const m = l.map;
          const jail = {
            x0: m.x + (22 / 48) * m.w,
            x1: m.x + (26 / 48) * m.w,
            y0: m.y + (14 / 32) * m.h,
            y1: m.y + (18 / 32) * m.h,
          };
          const alerts = b.filter((t) => t.includes('해독 완료') || t.startsWith('탈출구가 깨어났다')).length;
          if (alerts === 2 && b.some((t) => t.startsWith('30초'))) r.stackFrames += 1;
          const key = b.some((t) => t.includes('뒷자리'))
            ? 'second'
            : b.some((t) => t.includes('앞자리'))
              ? 'first'
              : '';
          if (r.runs[r.runs.length - 1] !== key) r.runs.push(key);
          if (key === 'second') r.secondFrames += 1;
          const note = l.items.filter((i) => i.id === 'note');
          if (note.length > 0) {
            const y0 = Math.min(...note.map((i) => i.y));
            const y1 = Math.max(...note.map((i) => i.y + i.h));
            const x0 = Math.min(...note.map((i) => i.x));
            const x1 = Math.max(...note.map((i) => i.x + i.w));
            r.minGap = Math.min(r.minGap, Math.round((jail.y0 - y1) * 10) / 10);
            const o = Math.min(
              Math.min(y1, jail.y1) - Math.max(y0, jail.y0),
              Math.min(x1, jail.x1) - Math.max(x0, jail.x0),
            );
            if (o > 0.5) {
              r.overlapFrames += 1;
              r.worst = Math.max(r.worst, o);
            }
          }
        }
        if (r.secondFrames > 10 || performance.now() > until) r.done = true;
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    // 거점 A 해독: 알림 한 줄 + 메모 1 (지속 + 알림 + 메모는 감옥에 닿아 알림이 빠진 뒤에 뜬다)
    await send({ kind: 'setPoint', point: 'A', progress: 1 });
    await send({ kind: 'teleport', target: s.id, x: 8, y: 16 });
    await expect.poll(async () => (await banners()).some((b) => b.includes('앞자리')), POLL).toBe(true);
    // 메모 1이 떠 있는 동안 거점 B 해독: 알림 두 줄(해독 완료 · 탈출구)이 메모 1을 밀어 내린다 → 숨겼다가 다시, 그 뒤 메모 2
    await send({ kind: 'setPoint', point: 'B', progress: 1 });
    await send({ kind: 'teleport', target: s.id, x: 40, y: 16 });
    await page.waitForFunction(
      () => (window as unknown as { __noteWatch?: NoteWatch }).__noteWatch?.done === true,
      null,
      { polling: 200, timeout: 40_000 },
    );
    const w = await page.evaluate(() => (window as unknown as { __noteWatch: NoteWatch }).__noteWatch);
    report.push(`${name}: ${JSON.stringify(w)}`);
    expect(w.stackFrames, `${name} 지속 + 알림 두 줄이 함께 보인 적이 있다`).toBeGreaterThan(0);
    // 메모 1은 알림에 밀려 숨었다가 다시 뜨고(두 번), 메모 2도 결국 뜬다
    expect(w.runs.filter((k) => k === 'first').length, `${name} ${w.runs.join(' → ')}`).toBe(2);
    expect(w.secondFrames, name).toBeGreaterThan(10);
    expect([w.overlapFrames, w.worst], `${name} 메모 ↔ 감옥`).toEqual([0, 0]);
    expect(s.problems, name).toEqual([]);
    await s.context.close();
  }
  console.log(`[m12-hud] 메모 ${report.join(' / ')}`);
});

// ───────────── ⑩ 가로 180° 뒤집기 ─────────────

test('가로 180° 뒤집기: 창 크기는 그대로 안전 영역 좌우만 바뀌어도(방향 change) 터치 대상을 새 안전 영역 + 32px 안쪽에 다시 놓는다', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  for (const role of ['monster', 'runner'] as const) {
    const s = await soloMatch(browser, dpr1(PHONE_LANDSCAPE), role, { safeArea: { left: 48 } });
    const { page } = s;
    const before = await measureTouchLayout(page);
    expect(before.insets.left, role).toBe(48);
    expect(touchLayoutProblems(before), role).toEqual([]);
    // 뒤집기: 카메라 구멍이 오른쪽으로 (창 크기 · resize 없음, 방향 change만)
    await emulateSafeArea(page, { right: 48 });
    await page.evaluate(() => screen.orientation.dispatchEvent(new Event('change')));
    await expect.poll(async () => touchLayoutProblems(await measureTouchLayout(page)), POLL).toEqual([]);
    const after = await measureTouchLayout(page);
    expect([after.insets.left, after.insets.right], role).toEqual([0, 48]);
    // 오른쪽 엄지 무리가 48px 왼쪽으로, 이동 영역은 왼쪽 띠(32px)까지 넓어진다
    const at = (l: typeof before, id: string): TouchTarget => l.targets.find((t) => t.id === id)!;
    const thumb = role === 'monster' ? 'aim-stick' : 'ability';
    expect(at(before, thumb).x - at(after, thumb).x, role).toBeCloseTo(48, 0);
    expect(at(after, 'move-zone').x, role).toBeCloseTo(32, 0);
    expect(s.problems, role).toEqual([]);
    await s.context.close();
  }
});

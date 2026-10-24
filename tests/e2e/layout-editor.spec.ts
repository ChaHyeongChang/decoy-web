// 조작 배치 편집 (설정 화면 통합): 터치 휴대폰 창에서 편집 화면을 열어(디버그 훅 — 설정 화면 단추와 같은 화면) 손가락으로 끌어
// 옮기고, 안전 영역 밖 · 다른 조작 · 판 HUD 위에는 못 놓고(경고 표시), 저장 → 새로고침해도 그대로 → 봇과 연습 판의 터치 버튼이
// 저장한 비율 자리(800×360 시작 → 판 중 915×412 → 1024×768), 두 역할의 고친 배치는 저장 · 취소까지 남고 취소는 버린다, 작게 ·
// 크게(48px 하한), 좌우 반전이면 판에서 이동 영역이 오른쪽 · HUD도 뒤집혀 안 겹침. 편집 화면 휴대폰 화면 사진은
// artifacts/screens/(커밋하지 않음)에 남긴다. 기능 시험은 기기 배율 1
import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import type { ControlLayoutInfo, HudLayout, TouchTarget } from '@decoy/shared';
import { CAP_BELOW, boxAt, ratioOf } from '../../client/src/controlLayout';
import { EDITOR_TEXT } from '../../client/src/data/storyText';
import { PHONE_BROWSER, dpr1, newPlayerPage, press, type DeviceOptions } from './helpers';
import { MultiTouch, centerOf, measureTouchLayout, touchLayoutProblems, touchTargets } from './touch';

const QUERY = '/?debug=hook&renderer=canvas';
const SHOTS = 'artifacts/screens';
const POLL = { intervals: [100, 150, 200], timeout: 20_000 };
/** 늘 떠 있는 HUD 부품 (m12-screen과 같다) */
const PERSISTENT = /^(timer|gaugeA|gaugeB|card\d|minimap)$/;

type Rect = { x: number; y: number; w: number; h: number };

function phone(width: number, height: number): DeviceOptions {
  return dpr1({ ...PHONE_BROWSER, viewport: { width, height }, screen: { width, height } });
}

/** 가짜 전체 화면 (헤드리스 크롬에서도 진짜 전체 화면이 되어 창 크기가 바뀌지 않게, m12-screen과 같다) */
function stubFullscreen(): void {
  Element.prototype.requestFullscreen = function () {
    return Promise.resolve();
  };
}

async function controlLayout(page: Page): Promise<ControlLayoutInfo> {
  const handle = await page.waitForFunction(() => window.__DECOY__?.getControlLayout() ?? null, null, {
    polling: 100,
    timeout: 20_000,
  });
  const v = (await handle.jsonValue()) as ControlLayoutInfo;
  await handle.dispose();
  return v;
}

function ctl(L: ControlLayoutInfo, id: string): Rect {
  const c = L.controls.find((x) => x.id === id);
  if (!c) throw new Error(`조작 ${id} 없음: ${L.controls.map((x) => x.id).join(',')}`);
  return c;
}

const mid = (b: Rect): { x: number; y: number } => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
const SYS = new Set(['scoreboard', 'menu', 'fullscreen']);
/** 이름표까지 차지하는 사각형 */
const occ = (id: string, b: Rect): Rect => (SYS.has(id) ? b : { ...b, h: b.h + CAP_BELOW });
/** 두 사각형 사이 간격 (겹치면 음수) */
function gapOf(a: Rect, b: Rect): number {
  return Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w), b.y - (a.y + a.h), a.y - (b.y + b.h));
}

/** 편집 화면 배치 규칙: 범위 안 · 조작끼리 8px(이름표까지) · HUD와 8px · 이동 고리는 이동 영역 안 */
function editorProblems(L: ControlLayoutInfo): string[] {
  const out: string[] = [];
  const r = L.range;
  for (const c of L.controls) {
    if (c.x < r.x - 0.5 || c.y < r.y - 0.5 || c.x + c.w > r.x + r.w + 0.5 || c.y + c.h > r.y + r.h + 0.5)
      out.push(`${c.id} 범위 밖`);
    for (const o of L.controls)
      if (o.id > c.id && gapOf(occ(c.id, c), occ(o.id, o)) < 8 - 0.5) out.push(`${c.id} ↔ ${o.id}`);
    for (const hb of L.hud) if (gapOf(occ(c.id, c), hb) < 8 - 0.5) out.push(`${c.id} ↔ HUD ${hb.id}`);
  }
  const m = ctl(L, 'move');
  const z = L.zone;
  if (m.x < z.x - 0.5 || m.y < z.y - 0.5 || m.x + m.w > z.x + z.w + 0.5) out.push('이동 고리 ↔ 이동 영역');
  return out;
}

/**
 * 손가락으로 조작을 끈다 (가운데에서 to까지, via를 차례로 지나). 끄는 중에 확인할 것이 있으면 during.
 * 다른 조작에 막히는 길은 미끄러지는 자리가 포인터 이벤트 묶음(프레임마다 합쳐짐)에 따라 달라지므로, 정확한 끝자리를 보는 끌기는
 * 막히지 않는 길(via)로 간다
 */
async function dragTo(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  during?: () => Promise<void>,
  via: { x: number; y: number }[] = [],
): Promise<void> {
  const t = await MultiTouch.attach(page);
  await t.down(1, from.x, from.y);
  for (const p of [...via, to]) await t.move(1, p.x, p.y, { steps: 10, stepMs: 16 });
  if (during) await during();
  await t.up(1);
  await t.detach();
}

async function openEditor(page: Page, team: 'survivor' | 'monster'): Promise<ControlLayoutInfo> {
  await page.evaluate((t) => window.__DECOY__?.openLayoutEditor(t), team);
  await expect(page.getByTestId('layout-editor')).toBeVisible();
  const L = await controlLayout(page);
  expect(L.source).toBe('editor');
  expect(L.team).toBe(team);
  return L;
}

async function savedLayout(page: Page): Promise<unknown> {
  return page.evaluate(() => {
    const raw = localStorage.getItem('decoy:controlLayout');
    return raw === null ? null : (JSON.parse(raw) as unknown);
  });
}

/** 봇과 연습 판을 시작하고 판 중 터치 화면까지 기다린다 */
async function practice(page: Page, role: 'runner' | 'monster'): Promise<ControlLayoutInfo> {
  await press(page.getByTestId('practice'));
  await press(page.getByTestId(`practice-role-${role}`));
  await expect.poll(() => page.evaluate(() => window.__DECOY__?.phase), POLL).toBe('playing');
  await page.waitForFunction(() => window.__DECOY__?.getControlLayout()?.source === 'match', null, {
    polling: 100,
    timeout: 20_000,
  });
  await page.waitForFunction(() => (window.__DECOY__?.getHudLayout()?.items.length ?? 0) > 5, null, {
    polling: 150,
    timeout: 20_000,
  });
  return controlLayout(page);
}

/** 판 HUD (늘 떠 있는 부품)와 터치 대상이 겹치는 것 (m12-screen hudProblems의 겹침 부분) */
function hudOverlaps(l: HudLayout, targets: TouchTarget[]): string[] {
  const out: string[] = [];
  for (const i of l.items) {
    if (!PERSISTENT.test(i.id)) continue;
    for (const t of targets) {
      const ox = Math.min(i.x + i.w, t.x + t.w) - Math.max(i.x, t.x);
      const oy = Math.min(i.y + i.h, t.y + t.h) - Math.max(i.y, t.y);
      if (ox > 0.5 && oy > 0.5) out.push(`${i.id} ↔ ${t.id}`);
    }
  }
  return out;
}

async function hudLayout(page: Page): Promise<HudLayout> {
  const v = await page.evaluate(() => window.__DECOY__?.getHudLayout() ?? null);
  if (!v) throw new Error('판 HUD 없음');
  return v;
}

/** 창 크기를 바꾸고 판 중 터치 화면이 그 크기로 다시 배치될 때까지 */
async function resizeTo(page: Page, width: number, height: number): Promise<ControlLayoutInfo> {
  await page.setViewportSize({ width, height });
  await page.waitForFunction(
    (w) => {
      const L = window.__DECOY__?.getControlLayout();
      return L?.source === 'match' && L.safe.x + L.safe.w > w - 40;
    },
    width,
    { polling: 100, timeout: 20_000 },
  );
  await page.waitForTimeout(400);
  return controlLayout(page);
}

test.beforeAll(() => mkdirSync(SHOTS, { recursive: true }));

test('끌어 옮기기: 안전 영역 밖 · 다른 조작 · HUD 위에는 못 놓고, 저장 → 새로고침 뒤 그대로 → 연습 판(800×360 → 915×412 → 1024×768)에서 같은 비율 자리', async ({
  browser,
}) => {
  test.setTimeout(150_000);
  const { context, page, problems } = await newPlayerPage(browser, phone(800, 360));
  await context.addInitScript(stubFullscreen);
  await page.goto(QUERY);
  await expect(page.getByTestId('practice')).toBeVisible();
  const L0 = await openEditor(page, 'survivor');
  expect(L0.mirror).toBe(false);
  expect(editorProblems(L0)).toEqual([]);
  expect(L0.controls.map((c) => c.id).sort()).toEqual(
    ['ability', 'fullscreen', 'menu', 'move', 'rescue', 'scoreboard'].sort(),
  );
  // HUD 미리보기: 타이머 · 게이지 · 팀 카드 (이름표)
  for (const id of ['timer', 'gaugeA', 'gaugeB', 'card0', 'card1', 'card2'])
    expect(
      L0.hud.some((b) => b.id === id),
      id,
    ).toBe(true);
  await expect(page.locator('[data-hud="timer"]')).toContainText(EDITOR_TEXT.timer);

  // 1) 능력 버튼을 왼쪽 위로 끈다
  const a0 = ctl(L0, 'ability');
  const c0 = mid(a0);
  await dragTo(page, c0, { x: c0.x - 160, y: c0.y - 40 }, undefined, [{ x: c0.x, y: c0.y - 120 }]);
  const L1 = await controlLayout(page);
  const a1 = ctl(L1, 'ability');
  expect(Math.abs(a1.x - (a0.x - 160))).toBeLessThanOrEqual(1);
  expect(Math.abs(a1.y - (a0.y - 40))).toBeLessThanOrEqual(1);
  expect(L1.selected).toBe('ability');
  await expect(page.getByTestId('le-selected')).toContainText(EDITOR_TEXT.ability);
  expect(editorProblems(L1)).toEqual([]);
  await expect(page.getByTestId('le-msg')).toBeHidden();
  await page.screenshot({ path: `${SHOTS}/layout-editor-800x360.png` });

  // 2) 화면 오른쪽 끝 · 아래 끝 밖으로 끌어도 범위 안 (가장자리 띠 + 6px)
  await dragTo(page, mid(a1), { x: 799, y: 200 }, async () => {
    await expect(page.getByTestId('le-msg')).toContainText(EDITOR_TEXT.blocked);
  });
  const L2 = await controlLayout(page);
  const a2 = ctl(L2, 'ability');
  expect(a2.x + a2.w).toBeLessThanOrEqual(L2.range.x + L2.range.w + 0.5);
  expect(a2.x + a2.w).toBeGreaterThan(L2.range.x + L2.range.w - 20);
  expect(editorProblems(L2)).toEqual([]);

  // 3) 구조 버튼 위로: 놓을 수 없다 — 구조 버튼에 경고 표시, 끝나도 겹치지 않는다
  const rs = ctl(L2, 'rescue');
  await dragTo(page, mid(a2), mid(rs), async () => {
    await expect(page.locator('[data-ctl="rescue"]')).toHaveClass(/blocked/);
    await expect(page.getByTestId('le-msg')).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/layout-editor-800x360-blocked.png` });
  });
  const L3 = await controlLayout(page);
  expect(gapOf(occ('ability', ctl(L3, 'ability')), occ('rescue', ctl(L3, 'rescue')))).toBeGreaterThanOrEqual(
    7.5,
  );
  expect(ctl(L3, 'rescue')).toEqual(rs);
  expect(editorProblems(L3)).toEqual([]);

  // 4) 판 HUD(팀 카드) 위로: 놓을 수 없다 — HUD 미리보기에 경고 표시
  const card = L3.hud.find((b) => b.id === 'card0')!;
  await dragTo(page, mid(ctl(L3, 'ability')), mid(card), async () => {
    await expect(page.locator('[data-hud].blocked').first()).toBeVisible();
  });
  const L4 = await controlLayout(page);
  expect(editorProblems(L4)).toEqual([]);

  // 5) 오른쪽 가운데 빈 곳으로 옮겨 두고 저장
  const a4 = ctl(L4, 'ability');
  await dragTo(page, mid(a4), { x: 560, y: 200 });
  const L5 = await controlLayout(page);
  const a5 = ctl(L5, 'ability');
  expect(Math.abs(mid(a5).x - 560)).toBeLessThanOrEqual(1);
  expect(editorProblems(L5)).toEqual([]);
  const ratio = ratioOf(a5, L5.range);
  await press(page.getByTestId('le-save'));
  await expect(page.getByTestId('le-msg')).toContainText(EDITOR_TEXT.saved);
  await expect(page.getByTestId('layout-editor')).toHaveCount(0);
  const saved = (await savedLayout(page)) as { v: number; survivor: { items: Record<string, unknown> } };
  expect(saved.v).toBe(1);
  expect(Object.keys(saved.survivor.items)).toEqual(['ability']);

  // 새로고침해도 그대로
  await page.reload();
  await expect(page.getByTestId('practice')).toBeVisible();
  const R = await openEditor(page, 'survivor');
  expect(ctl(R, 'ability')).toEqual(a5);
  await press(page.getByTestId('le-cancel'));
  await expect(page.getByTestId('layout-editor')).toHaveCount(0);

  // 연습 판: 터치 버튼이 저장한 비율 자리 (창 크기가 바뀌어도 비율 그대로)
  const check = async (M: ControlLayoutInfo, label: string): Promise<void> => {
    expect(M.source, label).toBe('match');
    expect(M.fallback, label).toBe(false);
    const a = ctl(M, 'ability');
    const want = boxAt(ratio.u, ratio.v, a.w, a.h, M.range);
    expect(Math.abs(a.x - want.x), `${label} x`).toBeLessThanOrEqual(1);
    expect(Math.abs(a.y - want.y), `${label} y`).toBeLessThanOrEqual(1);
    const t = (await touchTargets(page)).find((x) => x.id === 'ability')!;
    expect(Math.abs(t.x - a.x) + Math.abs(t.y - a.y), label).toBeLessThanOrEqual(1);
    // 옮기지 않은 조작 · HUD와 겹치지 않고, 48px · 8px · 가장자리 띠 규칙
    expect(touchLayoutProblems(await measureTouchLayout(page)), label).toEqual([]);
    expect(hudOverlaps(await hudLayout(page), await touchTargets(page)), label).toEqual([]);
  };
  const M1 = await practice(page, 'runner');
  await check(M1, '800×360');
  // 판 중 설정 버튼 자리(시스템 버튼 세 칸)를 HUD가 비워 두었다: 점수판 왼쪽 두 칸에 HUD 없음
  const sb = ctl(M1, 'scoreboard');
  const sysRow = { x: sb.x - (sb.w + 13) * 2, y: sb.y, w: sb.w * 3 + 26, h: sb.h };
  const hud1 = await hudLayout(page);
  for (const i of hud1.items)
    if (PERSISTENT.test(i.id)) expect(gapOf(sysRow, i), `${i.id} ↔ 시스템 버튼 줄`).toBeGreaterThan(0);
  await check(await resizeTo(page, 915, 412), '915×412');
  await check(await resizeTo(page, 1024, 768), '1024×768');
  expect(problems).toEqual([]);
  await context.close();
});

test('두 역할의 고친 배치는 저장 · 취소까지 남고 취소는 버린다, 작게 · 크게 (48px 하한), 화살표 키', async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const { context, page, problems } = await newPlayerPage(browser, phone(800, 360));
  await page.goto(QUERY);
  await expect(page.getByTestId('practice')).toBeVisible();
  const S0 = await openEditor(page, 'survivor');
  const ab = ctl(S0, 'ability');
  // 위로 먼저 (왼쪽 구조 버튼에 막히지 않게) 그다음 왼쪽으로
  await dragTo(page, mid(ab), { x: mid(ab).x - 200, y: mid(ab).y - 120 }, undefined, [
    { x: mid(ab).x, y: mid(ab).y - 120 },
  ]);
  const S1 = await controlLayout(page);
  // 크게: 10%씩, 가운데 그대로
  await press(page.getByTestId('le-bigger'));
  const S2 = await controlLayout(page);
  const big = ctl(S2, 'ability');
  expect(big.w).toBe(Math.round(ab.w * 1.1));
  expect(Math.abs(mid(big).x - mid(ctl(S1, 'ability')).x)).toBeLessThanOrEqual(1);
  await expect(page.getByTestId('le-selected')).toContainText('110%');
  // 괴물로 바꿔 포효를 옮긴다
  await press(page.getByTestId('le-team-monster'));
  const M0 = await controlLayout(page);
  expect(M0.team).toBe('monster');
  expect(M0.controls.map((c) => c.id)).toContain('attack');
  const roar = ctl(M0, 'roar');
  await dragTo(page, mid(roar), { x: mid(roar).x - 100, y: mid(roar).y + 20 });
  const M1 = await controlLayout(page);
  expect(ctl(M1, 'roar').x).toBeLessThan(roar.x - 50);
  expect(editorProblems(M1)).toEqual([]);
  // 작게: 하한(짧은 변 48px) 아래로는 안 줄어든다
  for (let i = 0; i < 4; i += 1)
    if (await page.getByTestId('le-smaller').isEnabled()) await press(page.getByTestId('le-smaller'));
  const small = ctl(await controlLayout(page), 'roar');
  expect(Math.min(small.w, small.h)).toBeGreaterThanOrEqual(48);
  await expect(page.getByTestId('le-smaller')).toBeDisabled();
  // 화살표 키: 고른 조작을 4px씩
  const before = ctl(await controlLayout(page), 'roar');
  await page.keyboard.press('ArrowLeft');
  const after = ctl(await controlLayout(page), 'roar');
  expect(after.x).toBe(before.x - 4);
  // 생존자로 돌아오면 고친 것이 그대로
  await press(page.getByTestId('le-team-survivor'));
  expect(ctl(await controlLayout(page), 'ability')).toEqual(big);
  // 취소: 저장하지 않는다 → 다시 열면 기본 배치
  await press(page.getByTestId('le-cancel'));
  await expect(page.getByTestId('layout-editor')).toHaveCount(0);
  expect(await savedLayout(page)).toBeNull();
  const again = await openEditor(page, 'survivor');
  expect(ctl(again, 'ability')).toEqual(ab);
  await press(page.getByTestId('le-cancel'));
  expect(problems).toEqual([]);
  await context.close();
});

test('좌우 반전 (괴물): 편집 화면 · 연습 판 모두 이동 영역 오른쪽 · 엄지 버튼 왼쪽 아래 · 시스템 버튼 왼쪽 위, HUD도 뒤집혀 안 겹침', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const { context, page, problems } = await newPlayerPage(browser, phone(800, 360));
  await context.addInitScript(stubFullscreen);
  await page.goto(QUERY);
  await expect(page.getByTestId('practice')).toBeVisible();
  const E0 = await openEditor(page, 'monster');
  await press(page.getByTestId('le-mirror'));
  await expect(page.getByTestId('le-mirror')).toHaveAttribute('aria-pressed', 'true');
  const E1 = await controlLayout(page);
  expect(E1.mirror).toBe(true);
  expect(mid(ctl(E1, 'move')).x).toBeGreaterThan(400);
  expect(mid(ctl(E1, 'attack')).x).toBeLessThan(400);
  expect(ctl(E1, 'scoreboard').x).toBeLessThan(ctl(E0, 'scoreboard').x);
  expect(E1.zone.x).toBeGreaterThan(400);
  // HUD 미리보기도 뒤집힌다 (타이머 · 팀 카드가 오른쪽)
  const timer = E1.hud.find((b) => b.id === 'timer')!;
  expect(mid(timer).x).toBeGreaterThan(400);
  expect(editorProblems(E1)).toEqual([]);
  await page.screenshot({ path: `${SHOTS}/layout-editor-800x360-mirror.png` });
  await press(page.getByTestId('le-save'));
  await expect(page.getByTestId('layout-editor')).toHaveCount(0);

  const M = await practice(page, 'monster');
  expect(M.mirror).toBe(true);
  expect(M.fallback).toBe(false);
  const targets = await touchTargets(page);
  const zone = targets.find((t) => t.id === 'move-zone')!;
  expect(zone.x).toBeGreaterThan(400);
  expect(centerOf(targets.find((t) => t.id === 'aim-stick')!).x).toBeLessThan(400);
  expect(targets.find((t) => t.id === 'scoreboard')!.x).toBeLessThan(400);
  const hud = await hudLayout(page);
  const ht = hud.items.find((i) => i.id === 'timer')!;
  expect(ht.x + ht.w / 2).toBeGreaterThan(400);
  expect(hudOverlaps(hud, targets)).toEqual([]);
  expect(touchLayoutProblems(await measureTouchLayout(page))).toEqual([]);
  expect(problems).toEqual([]);
  await context.close();
});

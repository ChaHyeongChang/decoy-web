// 판 중 설정 효과 (설정 화면 통합, Canvas 렌더러 · 봇 방 탭 하나):
//  - PC 판 중 메뉴 버튼(위 띠 왼쪽) · Esc가 판 중 메뉴를 열고 닫고, 열린 동안 입력이 멈춘다(누르던 키를 떼고 판은 계속) — 진짜 설정 화면은
//    진입점(main.ts)이 채우므로 디버그 fakeMatchMenu로 연결점을 가짜로 바꿔 본다. 첫 판 조작 안내에 화면 밖 화살표 · 지도 줄
//  - 지도 크게 보기: PC 클릭 · 터치 탭으로 열고 어디든 누르면 닫힘, 크게 본 지도의 엔티티 ⊆ 메인 화면(작은 지도와 같다), 괴물 화면은
//    흰 공통 실루엣만, 지도를 눌러도 공격이 나가지 않음, 바닥은 작은 지도와 같은 때에만 다시 그림, 열 때 긴 작업(50ms 넘게) 없음
//  - FPS · 핑 칩: 설정을 켜고 끄면 판 중에도 바로, 맵 왼쪽 위 · 누를 수 없음 · ?debug=1 칩과 겹치지 않음, 화면 밖 화살표가 피함
//  - 흔들림 · 번쩍임 줄이기: 포효해도 창에 흔들림이 더해지지 않음, 먼 이동은 어두워지지 않고 바로 옮김
import { expect, test, type Page } from '@playwright/test';
import { BTN, type DrawnEntity, type MatchPrefsDebug } from '@decoy/shared';
import { HELP_TEXT } from '../../client/src/data/storyText';
import { MAP_RECT } from '../../client/src/ui/layout';
import {
  PHONE_LANDSCAPE,
  aimMonsterAt,
  countPressed,
  dpr1,
  inputLog,
  newPlayerPage,
  press,
  waitCamera,
  waitForSnapshots,
} from './helpers';
import { settle, startBotRoom } from './m10-map.shared';
import { waitForTouchTarget } from './touch';

const QUERY = '&renderer=canvas&quality=low';

async function prefs(page: Page): Promise<MatchPrefsDebug> {
  const p = await page.evaluate(() => window.__DECOY__?.getMatchPrefs() ?? null);
  if (!p) throw new Error('판 장면 없음');
  return p;
}

const center = (b: { x: number; y: number; w: number; h: number }): { x: number; y: number } => ({
  x: b.x + b.w / 2,
  y: b.y + b.h / 2,
});

/** 같은 프레임의 메인 그림 · 작은 지도 · 크게 본 지도 (한 번의 evaluate) */
async function threeLists(
  page: Page,
): Promise<{ main: DrawnEntity[]; mini: DrawnEntity[]; big: DrawnEntity[]; frames: string[] }> {
  return page.evaluate(() => {
    const d = window.__DECOY__!;
    return {
      main: d.getDrawn(),
      mini: d.getDrawnMinimap(),
      big: d.getDrawnMinimapBig(),
      frames: d.getMatchPrefs()?.minimapBig.frames ?? [],
    };
  });
}

/** 크게 본 지도 = 작은 지도 (같은 엔티티 · 같은 자리) ⊆ 메인 화면에 그린 것 */
function expectBigSubsetOfMain(l: { main: DrawnEntity[]; mini: DrawnEntity[]; big: DrawnEntity[] }): void {
  expect(l.big.length).toBe(l.mini.length);
  expect(l.big.length).toBe(l.main.length);
  for (const b of l.big) {
    expect(b.layer).toBe('minimap');
    expect(
      l.main.some((d) => d.id === b.id && Math.abs(d.x - b.x) < 1e-6 && Math.abs(d.y - b.y) < 1e-6),
      `${b.kind} ${b.id}가 메인 화면에 없다`,
    ).toBe(true);
    expect(l.mini.some((m) => m.id === b.id && m.x === b.x && m.y === b.y)).toBe(true);
  }
}

/** 이 페이지에서 긴 작업(longtask) 기록을 시작한다 */
async function watchLongTasks(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __e2eLong?: { start: number; dur: number }[] };
    w.__e2eLong = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) w.__e2eLong?.push({ start: e.startTime, dur: e.duration });
    }).observe({ type: 'longtask', buffered: false });
  });
}

async function longTasks(page: Page): Promise<{ start: number; dur: number }[]> {
  return page.evaluate(
    () => (window as unknown as { __e2eLong?: { start: number; dur: number }[] }).__e2eLong ?? [],
  );
}

/** 그린 프레임 n장 동안 매 프레임 값을 모은다 */
async function perFrame<T>(page: Page, n: number, fn: string): Promise<T[]> {
  return page.evaluate(
    async ([count, body]) => {
      const read = new Function(`return (${body})();`) as () => unknown;
      const out: unknown[] = [];
      for (let i = 0; i < (count as number); i += 1) {
        await new Promise<void>((r) => requestAnimationFrame(() => r()));
        out.push(read());
      }
      return out;
    },
    [n, fn] as const,
  ) as Promise<T[]>;
}

test('PC 판 중 메뉴: 위 띠 왼쪽 버튼 · Esc로 열고 닫고, 여는 동안 입력이 멈추며 판은 계속 · 첫 판 안내에 화살표 · 지도 줄', async ({
  browser,
}) => {
  const s = await startBotRoom(browser, QUERY, 'runner');
  const { page } = s;
  // 첫 판 조작 안내 (5초): 화면 밖 화살표 · 지도 누르기 줄이 있고, 패널이 맵 창 안이다
  const help = await page.evaluate(() => ({
    on: window.__DECOY__!.getHud().help,
    layout: window.__DECOY__!.getHudLayout()!,
  }));
  if (help.on) {
    const items = help.layout.items.filter((i) => i.id === 'help');
    const texts = items.map((i) => i.text ?? '');
    expect(texts).toContain('가장자리 화살표');
    expect(texts.some((t) => t.includes('화면 밖 팀원'))).toBe(true);
    expect(texts).toContain(HELP_TEXT.minimapTap);
    const m = help.layout.map;
    for (const i of items) {
      expect(i.x).toBeGreaterThanOrEqual(m.x - 0.5);
      expect(i.y).toBeGreaterThanOrEqual(m.y - 0.5);
      expect(i.x + i.w).toBeLessThanOrEqual(m.x + m.w + 0.5);
      expect(i.y + i.h).toBeLessThanOrEqual(m.y + m.h + 0.5);
    }
  } else console.log('[play-settings] 조작 안내가 이미 닫혔다 (느린 시작) — 안내 줄 검사는 건너뜀');

  // 연결점이 없으면(설정 화면 전) 버튼을 보이지 않는다
  expect((await prefs(page)).menuButton?.visible).toBe(false);
  await page.evaluate(() => window.__DECOY__!.fakeMatchMenu(true));
  await expect.poll(async () => (await prefs(page)).menuButton?.visible).toBe(true);
  const btn = (await prefs(page)).menuButton!;
  const canvas = await page.evaluate(() => {
    const r = document.querySelector('canvas')!.getBoundingClientRect();
    return { x: r.left, y: r.top, k: r.height / 1080 };
  });
  console.log(`[play-settings] 메뉴 버튼 ${JSON.stringify(btn)} (캔버스 ${JSON.stringify(canvas)})`);
  // 위 띠(64) 안 · 거점 A 게이지(x 292) 왼쪽 · 선명도 탐침 자리(x 1490 이후) 밖, 44px 이상
  expect(btn.h).toBeGreaterThanOrEqual(44);
  expect(btn.y).toBeGreaterThanOrEqual(canvas.y - 0.5);
  expect(btn.y + btn.h).toBeLessThanOrEqual(canvas.y + 64 * canvas.k + 0.5);
  expect(btn.x + btn.w).toBeLessThanOrEqual(canvas.x + 292 * canvas.k);
  await expect(page.getByTestId('match-menu')).toContainText('설정');
  await expect(page.getByTestId('match-menu')).toContainText(HELP_TEXT.menuKey);

  // W를 누르고 있다가 버튼으로 연다 → 누르던 키는 뗀 것으로, 여는 동안 키 · Tab · Space를 받지 않는다
  await page.keyboard.down('KeyW');
  await expect.poll(async () => (await inputLog(page)).at(-1)?.my).toBe(-1);
  await page.getByTestId('match-menu').click();
  await expect.poll(async () => (await prefs(page)).menu.open).toBe(true);
  const p1 = await prefs(page);
  expect(p1.inputSuspended).toBe(true);
  expect(p1.menu.opens).toBe(1);
  const tOpen = await page.evaluate(() => performance.now());
  await page.keyboard.down('KeyD');
  await page.keyboard.press('Space');
  await page.keyboard.down('Tab');
  await page.waitForTimeout(400);
  expect((await page.evaluate(() => window.__DECOY__!.getHud())).scoreboard).toBe(false);
  await page.keyboard.up('Tab');
  const during = (await inputLog(page)).filter((f) => f.t > tOpen + 40);
  expect(during.length).toBeGreaterThan(5);
  for (const f of during) expect([f.mx, f.my, f.held, f.pressed]).toEqual([0, 0, 0, 0]);
  // 판은 계속 흐른다 (스냅샷 · 그리기)
  const snaps0 = await page.evaluate(() => window.__DECOY__!.snapCount);
  const frames0 = (await page.evaluate(() => window.__DECOY__!.getAnimState()?.frames)) ?? 0;
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__DECOY__!.snapCount)).toBeGreaterThan(snaps0);
  expect((await page.evaluate(() => window.__DECOY__!.getAnimState()?.frames)) ?? 0).toBeGreaterThan(frames0);

  // Esc로 닫는다: 다시 받지만, 여는 동안 · 그 전부터 누르던 키는 눌린 채 남지 않는다
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await prefs(page)).menu.open).toBe(false);
  const p2 = await prefs(page);
  expect([p2.inputSuspended, p2.menu.closes]).toEqual([false, 1]);
  const tClose = await page.evaluate(() => performance.now());
  await page.waitForTimeout(300);
  const after = (await inputLog(page)).filter((f) => f.t > tClose + 40);
  expect(after.length).toBeGreaterThan(3);
  for (const f of after) expect([f.mx, f.my]).toEqual([0, 0]);
  await page.keyboard.up('KeyW');
  await page.keyboard.up('KeyD');
  await page.keyboard.down('KeyS');
  await expect.poll(async () => (await inputLog(page)).at(-1)?.my).toBe(1);
  await page.keyboard.up('KeyS');

  // Esc 다시: 열고 · 닫는다
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await prefs(page)).menu.open).toBe(true);
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await prefs(page)).menu.open).toBe(false);
  // 설정 화면이 제 안에서 이미 처리한 Esc(defaultPrevented)는 다시 열지 않는다
  await page.evaluate(() => {
    document.body.addEventListener('keydown', (e) => e.preventDefault(), { once: true });
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }),
    );
  });
  await page.waitForTimeout(100);
  const p3 = await prefs(page);
  expect([p3.menu.open, p3.menu.opens, p3.menu.closes]).toEqual([false, 2, 2]);

  // 연결점을 되돌리면 버튼이 사라진다
  await page.evaluate(() => window.__DECOY__!.fakeMatchMenu(false));
  await expect.poll(async () => (await prefs(page)).menuButton?.visible).toBe(false);
  expect(s.problems).toEqual([]);
  await s.context.close();
});

test('PC 960×540: 메뉴 버튼은 띠 왼쪽 빈 자리 (팀 카드 · 게이지 · 선명도 탐침 자리를 덮지 않음), 창 크기를 바꾸면 다시 놓는다', async ({
  browser,
}) => {
  const s = await startBotRoom(browser, QUERY, 'runner');
  const { page } = s;
  await page.setViewportSize({ width: 960, height: 540 });
  await page.evaluate(() => window.__DECOY__!.fakeMatchMenu(true));
  await expect
    .poll(async () => {
      const b = (await prefs(page)).menuButton;
      return b && b.visible ? Math.round(b.x) : null;
    })
    .toBe(7);
  const b = (await prefs(page)).menuButton!;
  expect(b.y).toBe(0);
  expect(b.h).toBeGreaterThanOrEqual(44);
  // 거점 A 게이지(논리 292 = 146 CSS px) 왼쪽
  expect(b.x + b.w).toBeLessThanOrEqual(146);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await expect.poll(async () => Math.round((await prefs(page)).menuButton?.y ?? -1)).toBe(10);
  expect(s.problems).toEqual([]);
  await s.context.close();
});

test('지도 크게 보기 (PC 생존자): 지도를 누르면 맵 창 가운데에 크게, 엔티티 ⊆ 메인 화면, 어디든 누르면 닫힘, 긴 작업 없음 · FPS 칩', async ({
  browser,
}) => {
  const s = await startBotRoom(browser, QUERY, 'runner');
  const { page } = s;
  await settle(page);
  await waitCamera(page);
  const tap = (await prefs(page)).minimapTap!;
  expect(tap).not.toBeNull();
  await watchLongTasks(page);
  await page.waitForTimeout(1000);
  const tClick = await page.evaluate(() => performance.now());
  await page.mouse.click(center(tap).x, center(tap).y);
  await expect.poll(async () => (await prefs(page)).minimapBig.open).toBe(true);
  await page.waitForTimeout(1000);
  const long = await longTasks(page);
  const before = long.filter((t) => t.start < tClick - 20);
  const onOpen = long.filter((t) => t.start >= tClick - 20 && t.dur > 50);
  console.log(
    `[play-settings] 긴 작업: 열기 전 1초 ${JSON.stringify(before)} · 연 뒤 1초 ${JSON.stringify(long.filter((t) => t.start >= tClick - 20))}`,
  );
  expect(onOpen, '지도를 크게 열 때 50ms 넘는 긴 작업').toEqual([]);

  const big = (await prefs(page)).minimapBig;
  // 맵 창 가운데, 틀 높이 ≈ 맵 창 높이 × 0.66
  const f = big.frame!;
  expect(f.x).toBeGreaterThanOrEqual(MAP_RECT.x);
  expect(f.y).toBeGreaterThanOrEqual(MAP_RECT.y);
  expect(f.x + f.w).toBeLessThanOrEqual(MAP_RECT.x + MAP_RECT.w);
  expect(f.y + f.h).toBeLessThanOrEqual(MAP_RECT.y + MAP_RECT.h);
  expect(Math.abs(f.x + f.w / 2 - (MAP_RECT.x + MAP_RECT.w / 2))).toBeLessThan(2);
  expect(f.h / MAP_RECT.h).toBeGreaterThan(0.6);
  expectBigSubsetOfMain(await threeLists(page));
  // 바닥: 작은 지도가 다시 그리는 때에만 같이 (같은 간격, 더 자주 그리지 않는다)
  const b0 = (await prefs(page)).minimapBig;
  await page.evaluate(() => window.__DECOY__?.freezeClock(null));
  const me = await page.evaluate(() => window.__DECOY__!.you ?? '');
  await s.send({ kind: 'freeze', target: me, frozen: false });
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(1500);
  await page.keyboard.up('KeyD');
  const b1 = (await prefs(page)).minimapBig;
  console.log(
    `[play-settings] 바닥 다시 그림: 큰 지도 ${b1.bakes - b0.bakes} · 작은 지도 ${b1.smallBakes - b0.smallBakes}`,
  );
  expect(b1.bakes - b0.bakes).toBe(b1.smallBakes - b0.smallBakes);
  expect(b1.bakes - b0.bakes).toBeGreaterThan(0);
  expectBigSubsetOfMain(await threeLists(page));

  // 맵 창 아무 곳이나 누르면 닫힌다 (그 누르기는 닫기로만)
  await page.mouse.click(MAP_RECT.x + 60, MAP_RECT.y + MAP_RECT.h - 60);
  await expect.poll(async () => (await prefs(page)).minimapBig.open).toBe(false);
  expect(await page.evaluate(() => window.__DECOY__!.getDrawnMinimapBig().length)).toBe(0);
  // 다시 열고 Esc로 닫는다 (같은 큰 지도를 다시 쓴다)
  await page.mouse.click(center(tap).x, center(tap).y);
  await expect.poll(async () => (await prefs(page)).minimapBig.opens).toBe(2);
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await prefs(page)).minimapBig.open).toBe(false);
  // Tab 점수판이 열려 있으면 지도를 눌러도 열리지 않는다
  await page.keyboard.down('Tab');
  await page.waitForFunction(() => window.__DECOY__?.getHud().scoreboard === true);
  await page.mouse.click(center(tap).x, center(tap).y);
  await page.waitForTimeout(200);
  expect((await prefs(page)).minimapBig.opens).toBe(2);
  await page.keyboard.up('Tab');

  // FPS · 핑 칩: 켜면 맵 왼쪽 위 안쪽 · 누를 수 없음 · 화면 밖 화살표가 피함, 끄면 바로 숨김
  expect((await prefs(page)).perfChip).toBeNull();
  await page.evaluate(() => window.__DECOY__!.setMatchPref('perfChip', true));
  await expect.poll(async () => (await prefs(page)).perfChip?.visible ?? false).toBe(true);
  const chip = (await prefs(page)).perfChip!;
  console.log(`[play-settings] FPS 칩 ${JSON.stringify(chip)}`);
  expect(chip.text).toMatch(/^\d+ FPS · 핑 (\d+|-)ms$/);
  expect(chip.text.startsWith('60 FPS')).toBe(true); // startBotRoom이 FPS를 60으로 덮어썼다
  expect(chip.x).toBeGreaterThanOrEqual(MAP_RECT.x);
  expect(chip.x).toBeLessThan(MAP_RECT.x + 20);
  expect(chip.y).toBeGreaterThanOrEqual(MAP_RECT.y);
  expect(chip.y).toBeLessThan(MAP_RECT.y + 20);
  expect(chip.h).toBeLessThan(30);
  const hit = await page.evaluate(
    ([x, y]) => document.elementFromPoint(x!, y!)?.tagName ?? '',
    [chip.x + chip.w / 2, chip.y + chip.h / 2],
  );
  expect(hit).toBe('CANVAS');
  const avoid = (await prefs(page)).perfChipAvoid!;
  expect(avoid.x).toBeCloseTo(chip.x, 0);
  expect(avoid.w).toBeCloseTo(chip.w, 0);
  // 끄면 같은 순간에 숨는다 (다음 프레임을 기다리지 않는다)
  const off = await page.evaluate(() => {
    window.__DECOY__!.setMatchPref('perfChip', false);
    return window.__DECOY__!.getMatchPrefs()!;
  });
  expect(off.perfChip?.visible).toBe(false);
  expect(off.perfChipAvoid).toBeNull();
  expect(s.problems).toEqual([]);
  await s.context.close();
});

test('지도 크게 보기 (PC 괴물): 생존자는 흰 공통 실루엣만, 지도를 누르거나 닫아도 공격이 나가지 않음 · 흔들림 줄이기면 포효에도 흔들림 0', async ({
  browser,
}) => {
  const s = await startBotRoom(browser, QUERY, 'monster');
  const { page } = s;
  const me = s.id('monster');
  await s.send({ kind: 'teleport', target: me, x: 18, y: 16, face: 0 });
  // 근접 원(1.5타일) 안: 조준 방향과 상관없이 괴물에게 보인다
  await s.send({ kind: 'teleport', target: s.id('runner'), x: 19.1, y: 16 });
  await s.send({ kind: 'teleport', target: s.id('guard'), x: 18, y: 17.1 });
  await settle(page);
  await waitCamera(page);
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.__DECOY__!.getDrawn())).filter((d) => d.kind === 'survivor').length,
    )
    .toBeGreaterThanOrEqual(1);
  const tap = (await prefs(page)).minimapTap!;
  const log0 = (await inputLog(page)).at(-1)?.t ?? 0;
  await page.mouse.click(center(tap).x, center(tap).y);
  await expect.poll(async () => (await prefs(page)).minimapBig.open).toBe(true);
  await page.waitForTimeout(200);
  const l = await threeLists(page);
  expectBigSubsetOfMain(l);
  const survivors = l.big.map((d, i) => ({ d, f: l.frames[i] })).filter((x) => x.d.kind === 'survivor');
  expect(survivors.length).toBeGreaterThanOrEqual(1);
  for (const x of survivors) expect(x.f).toBe('m:hidden');
  // 생존자를 구별하는 그림(역할 실루엣)이 하나도 없다
  for (const f of l.frames) expect(['m:runner', 'm:guard', 'm:scout']).not.toContain(f);
  // 닫기도 캔버스 클릭: 공격으로 가지 않는다
  await page.mouse.click(MAP_RECT.x + MAP_RECT.w / 2 + 200, MAP_RECT.y + 100);
  await expect.poll(async () => (await prefs(page)).minimapBig.open).toBe(false);
  await page.waitForTimeout(300);
  const frames = (await inputLog(page)).filter((f) => f.t > log0);
  expect(countPressed(frames, BTN.ATTACK)).toBe(0);

  // 흔들림 줄이기: 포효해도 창이 흔들리지 않는다 (배율 0, 창 자리 그대로)
  await s.send({ kind: 'freeze', target: me, frozen: false });
  // 조준을 지금 방향(동쪽)에 붙잡아 둔다: 커서가 다른 곳에 있으면 풀린 괴물이 돌아 앞당김으로 창이 천천히 움직인다
  await aimMonsterAt(page, 22, 16);
  // 대조: 흔들림 배율 1이면 내 공격이 맞을 때(동쪽 1.1타일 러너) 창에 흔들림이 더해진다 (판 시작 대기 동안은 공격이 나가지 않아 다시 누른다)
  await page.evaluate(() => window.__DECOY__!.setCameraShake(1));
  const hits = async (): Promise<number> =>
    (await page.evaluate(() => window.__DECOY__!.getSounds())).filter((x) => x === 'hit').length;
  let struck: number[] = [];
  let hit = false;
  for (let attempt = 0; attempt < 14 && !hit; attempt += 1) {
    const h0 = await hits();
    await page.mouse.down({ button: 'left' });
    await page.mouse.up({ button: 'left' });
    struck = await perFrame<number>(page, 50, '() => window.__DECOY__.getMatchPrefs().shakeOffset');
    hit = (await hits()) > h0;
    if (!hit) await page.waitForTimeout(400);
  }
  expect(hit, '공격이 러너에게 맞았다').toBe(true);
  expect(Math.max(...struck), '흔들림 배율 1: 맞힌 순간 창에 흔들림').toBeGreaterThan(0);
  await page.evaluate(() => window.__DECOY__!.setCameraShake(0.5));
  expect((await prefs(page)).shakeScale).toBe(0.5);
  await page.evaluate(() => window.__DECOY__!.setMatchPref('reduceShake', true));
  expect((await prefs(page)).shakeScale).toBe(0);
  await waitCamera(page);
  const roars = async (): Promise<number> =>
    (await page.evaluate(() => window.__DECOY__!.getSounds())).filter((x) => x === 'roar').length;
  // 판 시작 대기(괴물 5초) 동안에는 포효가 나가지 않는다: 나갈 때까지 다시 누른다
  let views: number[] = [];
  let roared = false;
  for (let attempt = 0; attempt < 12 && !roared; attempt += 1) {
    const r0 = await roars();
    await page.keyboard.press('KeyQ');
    views = await perFrame<number>(page, 30, '() => window.__DECOY__.getMatchPrefs().shakeOffset');
    roared = (await roars()) > r0;
    if (!roared) await page.waitForTimeout(500);
  }
  expect(roared, '포효가 나갔다 (빈 통과가 아님)').toBe(true);
  expect(Math.max(...views), '포효 동안 창에 더한 흔들림 (타일)').toBe(0);
  await page.evaluate(() => window.__DECOY__!.setMatchPref('reduceShake', false));
  expect((await prefs(page)).shakeScale).toBe(1);
  expect(s.problems).toEqual([]);
  await s.context.close();
});

test('번쩍임 줄이기 (PC 생존자): 먼 이동은 어두워지지 않고 바로 옮긴다, 끄면 예전처럼 어두워졌다 밝아진다', async ({
  browser,
}) => {
  const s = await startBotRoom(browser, QUERY, 'runner');
  const { page } = s;
  const me = s.id('runner');
  await settle(page);
  const jump = async (x: number, y: number): Promise<{ cuts: number; dips: number[] }> => {
    const c0 = (await page.evaluate(() => window.__DECOY__!.getCamera()!.cuts)) ?? 0;
    const sample = perFrame<number>(page, 45, '() => window.__DECOY__.getCamera().dip');
    await page.evaluate((c) => window.__DECOY__!.sendTest(c), {
      kind: 'teleport',
      target: me,
      x,
      y,
    } as const);
    const dips = await sample;
    const cuts = (await page.evaluate(() => window.__DECOY__!.getCamera()!.cuts)) - c0;
    return { cuts, dips };
  };
  await page.evaluate(() => window.__DECOY__!.setMatchPref('reduceFlash', true));
  expect((await prefs(page)).reduceFlash).toBe(true);
  const reduced = await jump(44, 28);
  expect(reduced.cuts).toBe(1);
  expect(Math.max(...reduced.dips)).toBe(0);
  await page.evaluate(() => window.__DECOY__!.setMatchPref('reduceFlash', false));
  await waitCamera(page);
  const normal = await jump(4, 4);
  console.log(
    `[play-settings] 잘라 옮김 어두워짐 최대: 줄이기 ${Math.max(...reduced.dips)} · 보통 ${Math.max(...normal.dips)}`,
  );
  expect(normal.cuts).toBe(1);
  expect(Math.max(...normal.dips)).toBeGreaterThan(0.2);
  expect(s.problems).toEqual([]);
  await s.context.close();
});

test('터치: 지도를 탭하면 크게 · 다른 곳을 탭하면 닫힘, ?debug=1 칩이 있으면 FPS 칩은 그 아래', async ({
  browser,
}) => {
  const { context, page, problems } = await newPlayerPage(browser, dpr1(PHONE_LANDSCAPE));
  await page.goto('/?bots=1&debug=1&renderer=canvas&quality=low');
  await press(page.getByTestId('create-room'));
  await press(page.getByTestId('role-runner'));
  await press(page.getByTestId('ready-button'));
  await press(page.getByTestId('start-button'));
  await waitForSnapshots(page, 3);
  await waitForTouchTarget(page, 'move-zone');
  // 판 직전 안내 · 위치 표시가 닫힐 때까지
  await page.waitForTimeout(500);
  const tap = (await prefs(page)).minimapTap;
  expect(tap, '확대 화면 터치에도 지도가 있다').not.toBeNull();
  await page.touchscreen.tap(center(tap!).x, center(tap!).y);
  await expect.poll(async () => (await prefs(page)).minimapBig.open).toBe(true);
  expectBigSubsetOfMain(await threeLists(page));
  const layout = await page.evaluate(() => window.__DECOY__!.getHudLayout()!);
  const m = layout.map;
  // 맵 가운데를 탭하면 닫힌다
  await page.touchscreen.tap(m.x + m.w / 2, m.y + m.h * 0.15);
  await expect.poll(async () => (await prefs(page)).minimapBig.open).toBe(false);

  // FPS 칩: ?debug=1 칩(맵 왼쪽 위)과 겹치지 않게 그 아래
  await page.evaluate(() => window.__DECOY__!.setMatchPref('perfChip', true));
  await expect.poll(async () => (await prefs(page)).perfChip?.visible ?? false).toBe(true);
  await page.waitForTimeout(700);
  const chip = (await prefs(page)).perfChip!;
  const dbg = await page.evaluate(() => {
    const r = document.querySelector('#debug-overlay .dbg-chip')!.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  console.log(`[play-settings] 터치 FPS 칩 ${JSON.stringify(chip)} · 디버그 칩 ${JSON.stringify(dbg)}`);
  const overlap =
    chip.x < dbg.x + dbg.w && dbg.x < chip.x + chip.w && chip.y < dbg.y + dbg.h && dbg.y < chip.y + chip.h;
  expect(overlap).toBe(false);
  expect(chip.y).toBeGreaterThanOrEqual(dbg.y + dbg.h);
  expect(chip.x).toBeGreaterThanOrEqual(m.x);
  expect(chip.x + chip.w).toBeLessThan(m.x + m.w / 2);
  expect(chip.text).toMatch(/^\d+ FPS · 핑 (\d+|-)ms$/);
  expect(problems).toEqual([]);
  await context.close();
});

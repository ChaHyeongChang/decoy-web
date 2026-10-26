// 작은 화면 HUD 겹침 없음 (남은 문제 정리): 작은 PC 창(960×540 · 1024×576 · 800×600 · 640×360)과 큰 창(1280×720), 휴대폰 가로
// (800×360 · 915×412)에서 괴물 · 생존자 화면 모두 늘 떠 있는 HUD 부품(타이머 · 거점 게이지 · 팀 카드 · 미니맵 · 행동 칸 · 안내 줄),
// PC 판 중 메뉴 버튼, FPS · 핑 칩, 터치 버튼(설정 · 점수판 · 엄지 버튼 · 스틱)이 서로 겹치지 않고 화면 안이다.
// 예전에는 PC 메뉴 버튼(44 CSS px)이 위 띠(960×540에서 32px)보다 커 팀 카드 위 테두리에 약 5px(800×600은 11px, 맵 왼쪽 끝 ·
// FPS 칩까지) 걸쳤다. 터치 HUD와 터치 대상의 겹침 · 글자 크기는 m12-screen이 더 많은 기기에서 본다
import { expect, test, type Browser, type BrowserContextOptions } from '@playwright/test';
import { PHONE_LANDSCAPE, newPlayerPage, press, waitForSnapshots } from './helpers';
import { touchTargets, waitForTouchTarget } from './touch';

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const PC = (w: number, h: number): BrowserContextOptions => ({ viewport: { width: w, height: h } });
/** 휴대폰 가로 전체 화면 (터치, 기기 배율 1 — 배치는 CSS px로 정해진다) */
const PHONE = (w: number, h: number): BrowserContextOptions => ({
  ...PHONE_LANDSCAPE,
  viewport: { width: w, height: h },
  screen: { width: w, height: h },
  deviceScaleFactor: 1,
});

const CASES: { name: string; dev: BrowserContextOptions; touch: boolean }[] = [
  { name: 'PC 960×540', dev: PC(960, 540), touch: false },
  { name: 'PC 1024×576', dev: PC(1024, 576), touch: false },
  { name: 'PC 800×600', dev: PC(800, 600), touch: false },
  { name: 'PC 640×360', dev: PC(640, 360), touch: false },
  { name: 'PC 1280×720', dev: PC(1280, 720), touch: false },
  { name: '휴대폰 800×360', dev: PHONE(800, 360), touch: true },
  { name: '휴대폰 915×412', dev: PHONE(915, 412), touch: true },
];

/** 잠깐 뜨는 덮개 (배너 · 메모 · 조작 안내 · 점수판)는 겹침에서 뺀다 — 맵 위에 탈출구 · 감옥을 비켜 뜬다(VISUAL_SPEC 8.1) */
const TRANSIENT = new Set(['score', 'help', 'helpFigure', 'banner', 'note']);

function overlap(a: Box, b: Box): number {
  const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return ox > 0.5 && oy > 0.5 ? Math.min(ox, oy) : 0;
}

/** 판을 시작해 HUD 부품 사각형(창 CSS px)을 모은다: 캔버스 HUD는 부품마다 그린 것을 모두 감싼 사각형 */
async function hudBoxes(
  browser: Browser,
  c: (typeof CASES)[number],
  role: 'runner' | 'monster',
): Promise<{
  boxes: Map<string, Box>;
  map: Box;
  vw: number;
  vh: number;
  problems: string[];
  close: () => Promise<void>;
}> {
  const { context, page, problems } = await newPlayerPage(browser, c.dev);
  await page.goto('/?bots=1&debug=hook&renderer=canvas&quality=low');
  await page.waitForFunction(() => window.__DECOY__ !== undefined);
  await press(page.getByTestId('create-room'));
  await press(page.getByTestId(`role-${role}`));
  await press(page.getByTestId('ready-button'));
  const ok = page.getByTestId('touch-tutorial-ok');
  if (c.touch && (await ok.isVisible())) await press(ok);
  await press(page.getByTestId('start-button'));
  await waitForSnapshots(page, 3);
  if (c.touch) await waitForTouchTarget(page, 'move-zone');
  await page.waitForFunction(() => window.__DECOY__?.getHudLayout()?.items.some((i) => i.id === 'card2'));
  // FPS · 핑 칩을 켠다 (맵 왼쪽 위 — 메뉴 버튼 · 시스템 버튼 가까이)
  await page.evaluate(() => window.__DECOY__!.setMatchPref('perfChip', true));
  await expect
    .poll(async () => (await page.evaluate(() => window.__DECOY__!.getMatchPrefs()))?.perfChip?.visible)
    .toBe(true);
  if (!c.touch)
    await expect
      .poll(async () => (await page.evaluate(() => window.__DECOY__!.getMatchPrefs()))?.menuButton?.visible)
      .toBe(true);
  // 칩 글자 · 자리가 한 번 더 갱신될 때까지 (초당 2번)
  await page.waitForTimeout(700);
  const l = (await page.evaluate(() => window.__DECOY__!.getHudLayout()))!;
  const p = (await page.evaluate(() => window.__DECOY__!.getMatchPrefs()))!;
  const boxes = new Map<string, Box>();
  for (const i of l.items) {
    if (TRANSIENT.has(i.id)) continue;
    const b = boxes.get(i.id);
    if (!b) boxes.set(i.id, { x: i.x, y: i.y, w: i.w, h: i.h });
    else {
      const x0 = Math.min(b.x, i.x);
      const y0 = Math.min(b.y, i.y);
      boxes.set(i.id, {
        x: x0,
        y: y0,
        w: Math.max(b.x + b.w, i.x + i.w) - x0,
        h: Math.max(b.y + b.h, i.y + i.h) - y0,
      });
    }
  }
  if (p.menuButton?.visible) boxes.set('menuButton', p.menuButton);
  if (p.perfChip?.visible) boxes.set('perfChip', p.perfChip);
  if (c.touch) for (const t of await touchTargets(page)) if (t.kind !== 'zone') boxes.set(`터치:${t.id}`, t);
  const vp = page.viewportSize()!;
  return {
    boxes,
    map: l.map,
    vw: vp.width,
    vh: vp.height,
    problems,
    close: () => context.close(),
  };
}

test('작은 화면 HUD 겹침 없음: 작은 PC 창 · 휴대폰 가로 × 괴물 · 생존자 — HUD 부품 · 메뉴 버튼 · FPS 칩 · 터치 버튼이 서로 겹치지 않고 화면 안', async ({
  browser,
}) => {
  test.setTimeout(400_000);
  const report: string[] = [];
  for (const c of CASES)
    for (const role of ['runner', 'monster'] as const) {
      const label = `${c.name} ${role}`;
      const r = await hudBoxes(browser, c, role);
      const list = [...r.boxes.entries()];
      const bad: string[] = [];
      for (let i = 0; i < list.length; i += 1) {
        const [a, A] = list[i]!;
        if (A.x < -0.5 || A.y < -0.5 || A.x + A.w > r.vw + 0.5 || A.y + A.h > r.vh + 0.5)
          bad.push(`${a} 화면 밖`);
        for (let j = i + 1; j < list.length; j += 1) {
          const [b, B] = list[j]!;
          // 터치 버튼끼리 간격은 m11 규칙(48px · 8px)이 따로 본다
          if (a.startsWith('터치:') && b.startsWith('터치:')) continue;
          const o = overlap(A, B);
          if (o > 0) bad.push(`${a} ↔ ${b} ${o.toFixed(1)}px`);
        }
      }
      // PC 메뉴 버튼은 맵 사각형에도 걸치지 않는다 (FPS 칩 · 화면 밖 화살표 · 캐릭터를 덮지 않게)
      const mb = r.boxes.get('menuButton');
      if (mb) {
        const o = overlap(mb, r.map);
        if (o > 0) bad.push(`menuButton ↔ 맵 ${o.toFixed(1)}px`);
      }
      report.push(
        `${label}: ${bad.length ? bad.join(' / ') : '겹침 없음'}${mb ? ` (메뉴 버튼 ${Math.round(mb.w)}×${Math.round(mb.h)})` : ''}`,
      );
      expect(bad, label).toEqual([]);
      expect(r.problems, label).toEqual([]);
      await r.close();
    }
  console.log(`[hud-fit] ${report.join('\n[hud-fit] ')}`);
});

// 따라가는 카메라 (Canvas · 품질 낮음 · 1920×1080, 봇 방 탭 하나, 기본 확대 = ② 중간 3)
//  - 조준 안정: 괴물이 마우스를 가만히 둔 채 걸으면 카메라가 따라가고 앞당겨져도 보내는 조준 각도가 그대로다
//  - 따라가기: 창이 나를 따라가고 맵 안, 먼 순간 이동은 잘라 옮긴다
//  - 화면 밖 화살표 정보 규칙: 생존자 화면은 메인 그림 · 고정 자리에서만, 괴물 화면은 점령 알림 · 포효 자리만(생존자 id 없음)
//  - 관전: PC 키 · 카드 클릭, 터치 카드 탭, 탈출 뒤 자동 관전
import { expect, test, type Page } from '@playwright/test';
import type { CameraDebug } from '@decoy/shared';
import {
  PHONE_LANDSCAPE,
  createRoom,
  dpr1,
  myId,
  newPlayerPage,
  pickRoleAndReady,
  press,
  sendTest,
  waitCamera,
  waitForSnapshots,
} from './helpers';
import { expectHiddenOpponentHasNoPixels } from './camera.shared';
import { startBotRoom, settle, type Session } from './m10-map.shared';
import { touchTargets, waitForTouchTarget } from './touch';

const QUERY = '&renderer=canvas&quality=low';

/** 내 캐릭터를 순간 이동하고, 내 자리가 거기 온 뒤 카메라가 멈출 때까지 (서버가 반영하기 전의 멈춘 창을 읽지 않게) */
async function teleportSelf(s: Session, you: string, x: number, y: number, face: number): Promise<void> {
  await s.send({ kind: 'teleport', target: you, x, y, face });
  await s.page.waitForFunction(
    ([tx, ty]) => {
      const st = window.__DECOY__?.getLocalState();
      return st !== null && st !== undefined && Math.hypot(st.x - tx!, st.y - ty!) < 0.05;
    },
    [x, y],
    { timeout: 10_000 },
  );
  await waitCamera(s.page);
}

test('괴물: 마우스를 가만히 두고 걸으면 화면이 움직여도 조준이 흔들리지 않는다', async ({ browser }) => {
  const s = await startBotRoom(browser, QUERY, 'monster');
  const { page } = s;
  const you = (await page.evaluate(() => window.__DECOY__!.you)) ?? '';
  // 맵 가운데 근처 넓은 복도에서 동쪽을 본다
  await s.send({ kind: 'teleport', target: you, x: 18, y: 16, face: 0 });
  await s.send({ kind: 'freeze', target: you, frozen: false });
  await settle(page);
  await page.evaluate(() => window.__DECOY__?.freezeClock(null));
  // 커서를 괴물 오른쪽 위에 두고 한 번 움직여 조준을 정한다
  // 보이는 창(맵 사각형)의 브라우저 좌표와 괴물 자리
  const { rect, at } = await page.evaluate(() => {
    const d = window.__DECOY__!;
    const v = d.getCamera()!.view;
    const tl = d.tileToClient(v.x, v.y)!;
    const br = d.tileToClient(v.x + v.w, v.y + v.h)!;
    const st = d.getLocalState()!;
    return { rect: { x: tl.x, y: tl.y, w: br.x - tl.x, h: br.y - tl.y }, at: d.tileToClient(st.x, st.y)! };
  });
  const cx = Math.min(rect.x + rect.w - 20, at.x + 260);
  const cy = Math.max(rect.y + 20, at.y - 140);
  await page.mouse.move(cx - 10, cy);
  await page.mouse.move(cx, cy);
  await page.waitForTimeout(400);
  const aim0 = await page.evaluate(() => window.__DECOY__!.getLastInput()?.aim ?? Number.NaN);
  expect(Number.isFinite(aim0)).toBe(true);
  const view0 = await page.evaluate(() => window.__DECOY__!.getCamera()!.view);
  // 마우스는 그대로, 아래(남쪽)로 1.5초 걷는다: 카메라가 따라 내려간다
  const aims: number[] = [];
  await page.keyboard.down('KeyS');
  for (let i = 0; i < 15; i += 1) {
    await page.waitForTimeout(100);
    aims.push(await page.evaluate(() => window.__DECOY__!.getLastInput()?.aim ?? Number.NaN));
  }
  await page.keyboard.up('KeyS');
  const view1 = await page.evaluate(() => window.__DECOY__!.getCamera()!.view);
  console.log(
    `[camera] 조준 ${aim0.toFixed(4)} → ${JSON.stringify(aims.map((a) => Number(a.toFixed(4))))}, 창 y ${view0.y} → ${view1.y}`,
  );
  // 카메라는 움직였다 (빈 통과가 아님)
  expect(Math.abs(view1.y - view0.y)).toBeGreaterThan(1);
  for (const a of aims) expect(a).toBe(aim0);
  expect(s.problems).toEqual([]);
  await s.context.close();
});

/** 화살표와 같은 프레임의 메인 그림 (한 번의 evaluate) */
async function markersAndDrawn(page: Page): Promise<{
  markers: { kind: string; id: string; tx: number; ty: number }[];
  drawn: { id: string; kind: string; x: number; y: number; tag?: string }[];
  view: { x: number; y: number; w: number; h: number };
}> {
  return page.evaluate(() => {
    const d = window.__DECOY__!;
    const c = d.getCamera()!;
    return {
      markers: c.markers.map((m) => ({ kind: m.kind, id: m.id, tx: m.tx, ty: m.ty })),
      drawn: d
        .getDrawn()
        .map((e) => ({ id: e.id, kind: e.kind, x: e.x, y: e.y, ...(e.tag ? { tag: e.tag } : {}) })),
      view: c.view,
    };
  });
}

/** 고정 맵 자리 (거점 · 탈출구 · 감옥 구조 자리) */
const FIXED: Readonly<Record<string, [number, number]>> = {
  A: [8, 16],
  B: [40, 16],
  N: [24, 1.5],
  S: [24, 30.5],
  prison: [24, 18.5],
};

test('따라가기: 창이 내 캐릭터를 따라가고 맵 밖을 보이지 않는다, 먼 이동은 잘라 옮긴다', async ({
  browser,
}) => {
  const s = await startBotRoom(browser, QUERY, 'runner');
  const { page } = s;
  const you = (await page.evaluate(() => window.__DECOY__!.you)) ?? '';
  const c0 = (await page.evaluate(() => window.__DECOY__!.getCamera()))!;
  expect(c0.zoom).toBe(3);
  // 보이는 타일 수: 16 × 10.67 (맵 사각형 3:2, 모든 화면 같다)
  expect(c0.view.w).toBeCloseTo(16, 2);
  expect(c0.view.h).toBeCloseTo(32 / 3, 2);
  // 마지막 값 = 먼 이동(창 폭 0.6배 넘게)이라 잘라 옮겨야 하는가
  for (const [x, y, far] of [
    [24.5, 18.6, false],
    [3.5, 3.5, true],
    [44.5, 28.5, true],
  ] as const) {
    const cuts0 = (await page.evaluate(() => window.__DECOY__!.getCamera()))!.cuts;
    await teleportSelf(s, you, x, y, 0);
    const c = (await page.evaluate(() => window.__DECOY__!.getCamera()))!;
    // 맵 안
    expect(c.view.x).toBeGreaterThanOrEqual(0);
    expect(c.view.y).toBeGreaterThanOrEqual(0);
    expect(c.view.x + c.view.w).toBeLessThanOrEqual(48 + 1e-6);
    expect(c.view.y + c.view.h).toBeLessThanOrEqual(32 + 1e-6);
    // 내 캐릭터는 창 안, 가장자리 여유(맵 끝에 붙은 축은 맵 끝까지)
    const me = (await page.evaluate(() => window.__DECOY__!.getLocalState()))!;
    expect(me.x).toBeGreaterThan(c.view.x);
    expect(me.x).toBeLessThan(c.view.x + c.view.w);
    expect(me.y).toBeGreaterThan(c.view.y);
    expect(me.y).toBeLessThan(c.view.y + c.view.h);
    // 맵 끝이 아니면 가운데 (따라가기가 끝나면)
    const cx = Math.min(Math.max(me.x, c.view.w / 2), 48 - c.view.w / 2);
    const cy = Math.min(Math.max(me.y, c.view.h / 2), 32 - c.view.h / 2);
    expect(Math.abs(c.view.x + c.view.w / 2 - cx)).toBeLessThan(0.05);
    expect(Math.abs(c.view.y + c.view.h / 2 - cy)).toBeLessThan(0.05);
    expect(c.follow).toBe(you);
    // 먼 순간 이동은 미끄러지지 않고 잘라 옮긴다
    if (far) expect(c.cuts).toBeGreaterThan(cuts0);
  }
  expect(s.problems).toEqual([]);
  await s.context.close();
});

test('화면 밖 화살표 (생존자): 창 밖 팀원 · 보이는 괴물 · 거점만, 모두 메인 그림 또는 고정 맵 자리에서', async ({
  browser,
}) => {
  const s = await startBotRoom(browser, QUERY, 'runner');
  const { page } = s;
  const you = (await page.evaluate(() => window.__DECOY__!.you)) ?? '';
  // 러너는 거점 A 방. 가드는 거점 B, 그 시야 안에 괴물(공유 시야), 스카우트는 북쪽
  await s.send({ kind: 'teleport', target: s.id('guard'), x: 40.5, y: 15.2, face: Math.PI });
  await s.send({ kind: 'teleport', target: s.id('monster'), x: 37.6, y: 18.4, face: -0.6 });
  await s.send({ kind: 'teleport', target: s.id('scout'), x: 25.5, y: 4.5, face: 0.3 });
  await teleportSelf(s, you, 9.5, 17, 0);
  await expect
    .poll(async () => (await markersAndDrawn(page)).markers.map((m) => m.kind).sort(), { timeout: 15_000 })
    .toEqual(expect.arrayContaining(['monster', 'point', 'teammate', 'teammate']));
  for (let i = 0; i < 6; i += 1) {
    const { markers, drawn, view } = await markersAndDrawn(page);
    for (const m of markers) {
      // 창 밖 대상만
      const inside =
        m.tx > view.x + 0.15 &&
        m.tx < view.x + view.w - 0.15 &&
        m.ty > view.y + 0.15 &&
        m.ty < view.y + view.h - 0.15;
      expect(inside, `${m.kind} ${m.id}는 창 안`).toBe(false);
      if (m.kind === 'point' || m.kind === 'exit' || m.kind === 'prison') {
        const f = FIXED[m.kind === 'prison' ? 'prison' : m.id];
        expect(f, `${m.kind} ${m.id}`).toBeDefined();
        expect([m.tx, m.ty]).toEqual(f);
      } else {
        // 팀원 · 괴물 · 탐지 · 포효: 같은 프레임 메인 그림에 그 자리
        const src = drawn.find((d) => Math.abs(d.x - m.tx) < 1e-6 && Math.abs(d.y - m.ty) < 1e-6);
        expect(src, `${m.kind} ${m.id}의 출처가 메인 그림에 없다`).toBeDefined();
      }
    }
    await page.waitForTimeout(150);
  }
  // 괴물을 모두의 시야 밖으로 보내면 괴물 화살표도 없다 (서버가 보내지 않는다)
  await s.send({ kind: 'teleport', target: s.id('monster'), x: 24, y: 29, face: 0 });
  await expect
    .poll(async () => (await markersAndDrawn(page)).markers.some((m) => m.kind === 'monster'), {
      timeout: 10_000,
    })
    .toBe(false);
  expect(await page.evaluate(() => window.__DECOY__!.getLastSnapshot()?.monster ?? null)).toBeNull();
  expect(s.problems).toEqual([]);
  await s.context.close();
});

test('화면 밖 화살표 (괴물): 생존자 화살표는 없고 점령 알림 · 포효로 드러난 자리만, 역할 · id 없음', async ({
  browser,
}) => {
  const s = await startBotRoom(browser, QUERY, 'monster');
  const { page } = s;
  const you = (await page.evaluate(() => window.__DECOY__!.you)) ?? '';
  const survivors = ['runner', 'guard', 'scout'].map((r) => s.id(r));
  await s.send({ kind: 'teleport', target: s.id('runner'), x: 8.4, y: 16.2, face: 0 });
  await s.send({ kind: 'teleport', target: s.id('scout'), x: 19.5, y: 16.5, face: -1.2 });
  await s.send({ kind: 'teleport', target: s.id('guard'), x: 29.5, y: 25.5, face: 0.4 });
  await s.send({ kind: 'freeze', target: you, frozen: false });
  await page.waitForFunction(() => (window.__DECOY__?.getLastSnapshot()?.you.move.frozen ?? 1) <= 0, null, {
    timeout: 20_000,
  });
  await s.send({ kind: 'teleport', target: you, x: 20.5, y: 24.5, face: Math.PI / 2 });
  await s.send({ kind: 'freeze', target: you, frozen: false });
  await settle(page);
  await expect
    .poll(() =>
      page.evaluate(() => window.__DECOY__?.getLastSnapshot()?.world.points.find((p) => p.id === 'A')?.state),
    )
    .toBe('capturing');
  await expect.poll(async () => (await markersAndDrawn(page)).markers.map((m) => m.kind)).toEqual(['point']);
  // 포효: 반지름 안 생존자 둘(창 밖)이 흰 화살표로, 1.5초 뒤 사라진다
  await page.keyboard.press('KeyQ');
  await page.waitForFunction(
    () => (window.__DECOY__?.getCamera()?.markers ?? []).filter((m) => m.kind === 'roarPing').length >= 2,
    null,
    { timeout: 5_000, polling: 'raf' },
  );
  const { markers, drawn } = await markersAndDrawn(page);
  for (const m of markers) {
    expect(['point', 'roarPing']).toContain(m.kind);
    expect(survivors).not.toContain(m.id);
    if (m.kind === 'roarPing')
      expect(
        drawn.some((d) => d.tag === 'roarPing' && Math.abs(d.x - m.tx) < 1e-6 && Math.abs(d.y - m.ty) < 1e-6),
      ).toBe(true);
  }
  await expect
    .poll(async () => (await markersAndDrawn(page)).markers.some((m) => m.kind === 'roarPing'), {
      timeout: 5_000,
    })
    .toBe(false);
  expect(s.problems).toEqual([]);
  await s.context.close();
});

test('관전 (PC): 수감 중 1 2 3 키 · 카드 클릭으로 동료 화면, 내 번호로 돌아오고, 탈출하면 자동으로 동료를 따라간다', async ({
  browser,
}) => {
  const s = await startBotRoom(browser, QUERY, 'scout');
  const { page } = s;
  const you = (await page.evaluate(() => window.__DECOY__!.you)) ?? '';
  await s.send({ kind: 'teleport', target: s.id('runner'), x: 40.4, y: 15.6, face: 2.4 });
  await s.send({ kind: 'teleport', target: s.id('guard'), x: 9.5, y: 16.5, face: 0 });
  await s.send({ kind: 'teleport', target: s.id('monster'), x: 30.5, y: 9.5, face: 0.5 });
  await s.send({ kind: 'teleport', target: you, x: 23.5, y: 15.5, face: 0 });
  await s.send({ kind: 'setSurvivor', target: you, status: 'imprisoned', imprisonCount: 1 });
  await settle(page);
  const cam = (): Promise<CameraDebug> => page.evaluate(() => window.__DECOY__!.getCamera()!);
  await expect.poll(async () => (await cam()).canSpectate).toBe(true);
  expect((await cam()).spectating).toBeNull();
  // 카드 순서: 러너(1) · 가드(2) · 스카우트(3, 나)
  const cuts0 = (await cam()).cuts;
  await page.keyboard.press('Digit2');
  await expect.poll(async () => (await cam()).spectating).toBe(s.id('guard'));
  await waitCamera(page);
  const c = await cam();
  expect(c.follow).toBe(s.id('guard'));
  expect(Math.abs(c.view.x + c.view.w / 2 - 9.5)).toBeLessThan(0.5);
  expect(c.cuts).toBeGreaterThan(cuts0);
  expect((await page.evaluate(() => window.__DECOY__!.getHud())).hint).toContain('동료 화면 보는 중');
  // 내 번호 → 감옥으로
  await page.keyboard.press('Digit3');
  await expect.poll(async () => (await cam()).spectating).toBeNull();
  // 카드 클릭 → 러너
  const cards = await page.evaluate(() => window.__DECOY__!.getSpectateCards());
  const runnerCard = cards.find((x) => x.index === 0)!;
  expect(runnerCard.id).toBe(s.id('runner'));
  await page.mouse.click(runnerCard.x + runnerCard.w / 2, runnerCard.y + runnerCard.h / 2);
  await expect.poll(async () => (await cam()).spectating).toBe(s.id('runner'));
  // 탈출: 동료를 자동으로 따라간다 (자유인 동료 먼저)
  await page.keyboard.press('Digit3');
  await expect.poll(async () => (await cam()).spectating).toBeNull();
  await s.send({ kind: 'setSurvivor', target: you, status: 'escaped' });
  await expect.poll(async () => (await cam()).spectating).toBe(s.id('runner'));
  expect((await page.evaluate(() => window.__DECOY__!.getHud())).hint).toContain('관전 중');
  expect(s.problems).toEqual([]);
  await s.context.close();
});

test('관전 (터치): 수감 · 탈출 중 팀 카드를 탭하면 동료 화면, 탈출한 생존자의 터치 대상은 여전히 0개', async ({
  browser,
}) => {
  const { context, page, problems } = await newPlayerPage(browser, dpr1(PHONE_LANDSCAPE));
  const code = await createRoom(page, '&bots=1');
  await pickRoleAndReady(page, 'guard');
  await press(page.getByTestId('start-button'));
  await waitForSnapshots(page, 3);
  await waitForTouchTarget(page, 'move-zone');
  const you = await myId(page);
  await sendTest(page, { kind: 'setSurvivor', target: you, status: 'imprisoned', imprisonCount: 1 });
  const cam = (): Promise<CameraDebug> => page.evaluate(() => window.__DECOY__!.getCamera()!);
  await expect.poll(async () => (await cam()).canSpectate).toBe(true);
  const tapCard = async (index: number): Promise<string | null> => {
    const cards = await page.evaluate(() => window.__DECOY__!.getSpectateCards());
    const c = cards.find((x) => x.index === index)!;
    await page.touchscreen.tap(c.x + c.w / 2, c.y + c.h / 2);
    return c.id;
  };
  // 카드 순서: 러너(0) · 가드(1, 나) · 스카우트(2)
  const runner = await tapCard(0);
  await expect.poll(async () => (await cam()).spectating).toBe(runner);
  await tapCard(1);
  await expect.poll(async () => (await cam()).spectating).toBeNull();
  await sendTest(page, { kind: 'setSurvivor', target: you, status: 'escaped' });
  await expect.poll(async () => (await cam()).spectating).not.toBeNull();
  await expect.poll(async () => (await touchTargets(page)).length).toBe(0);
  const scout = await tapCard(2);
  await expect.poll(async () => (await cam()).spectating).toBe(scout);
  void code;
  expect(problems).toEqual([]);
  await context.close();
});

test('확대 화면 숨은 상대 (Canvas 낮음): 창 안 · 팀 시야 밖에서 걷는 괴물 자리 픽셀 = 빈 바닥, 텍스처 예산 8MiB', async ({
  browser,
}) => {
  const s = await startBotRoom(browser, QUERY, 'runner');
  await expectHiddenOpponentHasNoPixels(s, 'Canvas 낮음');
  const g = await s.page.evaluate(() => window.__DECOY__!.gfx);
  expect(g.quality).toBe('low');
  expect(Number(g.features.textureBytes ?? 0)).toBeGreaterThan(0);
  expect(Number(g.features.textureBytes ?? 0)).toBeLessThanOrEqual(8 * 1024 * 1024);
  expect(s.problems).toEqual([]);
  await s.context.close();
});

test('괴물 조준 (확대 화면): 창이 자리 잡은 뒤 보이는 타일을 가리키면 그 방향, 앞당김으로 창이 움직여도 그대로', async ({
  browser,
}) => {
  const s = await startBotRoom(browser, QUERY, 'monster');
  const { page } = s;
  const you = (await page.evaluate(() => window.__DECOY__!.you)) ?? '';
  await s.send({ kind: 'teleport', target: you, x: 18, y: 16, face: 0 });
  await s.send({ kind: 'freeze', target: you, frozen: true });
  await settle(page);
  await page.evaluate(() => window.__DECOY__?.setCameraShake(0));
  await waitCamera(page);
  const target: [number, number] = [21, 13.5];
  const expected = Math.atan2(target[1] - 16, target[0] - 18);
  const at = (await page.evaluate(([x, y]) => window.__DECOY__!.tileToClient(x!, y!), target))!;
  await page.mouse.move(at.x - 6, at.y + 4);
  await page.mouse.move(at.x, at.y);
  await page.waitForTimeout(300);
  const aim0 = await page.evaluate(() => window.__DECOY__!.getLastInput()?.aim ?? Number.NaN);
  // 앞당김으로 창이 조준 쪽으로 움직인다 (빈 통과가 아님)
  await expect
    .poll(async () => {
      const c = (await page.evaluate(() => window.__DECOY__!.getCamera()))!;
      return Math.hypot(c.lookApplied.x, c.lookApplied.y);
    })
    .toBeGreaterThan(0.5);
  await page.waitForTimeout(600);
  const aim1 = await page.evaluate(() => window.__DECOY__!.getLastInput()?.aim ?? Number.NaN);
  const d = (a: number, b: number): number => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
  console.log(`[camera] 조준 목표 ${expected.toFixed(4)}, 보낸 조준 ${aim0.toFixed(4)} → ${aim1.toFixed(4)}`);
  expect(d(aim0, expected)).toBeLessThan((2 * Math.PI) / 180);
  expect(aim1).toBe(aim0);
  expect(s.problems).toEqual([]);
  await s.context.close();
});

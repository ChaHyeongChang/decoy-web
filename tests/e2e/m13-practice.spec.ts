// M13b 봇과 연습 · 로비 홈 (MOBILE_PLAN M13b 검증):
//  - 서버 연결이 막혀도 첫 화면은 바로 그려지고, 상태 줄과 "봇과 연습"으로 탭 두 번 만에 기기 안 판이 시작된다
//  - 연습 중에는 새 WebSocket을 열지 않고, 봇이 움직이고, 기기 안 테스트 훅으로 판을 끝까지 → 결과 → 다시 하기 → 홈으로
//  - 연습 중 숨김 → 복귀하면 같은 판(정지 · 다른 탭 안내 없음), 주소에 room이 없고 새로고침하면 첫 화면
//  - 괴물로 연습할 때 받은 스냅샷을 독립 판정기와 기기 안 정답으로 대조: 시야 밖 생존자 0
//  - 서버 방 결과 화면의 "홈으로"는 자리를 비우고 같은 연결로 첫 화면에서 다시 방을 만든다
//  - (검토 반영) 첫 화면 상태 줄 · 오류 줄이 낮은 휴대폰 · PC 창에서 화면 안, 친구 방 로비 "나가기",
//    ?practice=1은 마지막 방보다 우선하고 주소에서 지운다, 판 중 body.in-match(새 버전 띠 숨김),
//    터치 연습 판의 뒤로 가기 확인(연습 문구 → 첫 화면) · 새로고침 뒤 남은 항목 걷기(F16), '봇과 연습' 연타 가드(F17)
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { validateBalance, type Balance, type Snapshot } from '@decoy/shared';
import type { TruthFrame } from '@decoy/shared/sim';
import { APP_TEXT } from '../../client/src/data/storyText';
import { monsterVerdict } from './infoCheck';
import { PHONE_LANDSCAPE, dpr1, newPlayerPage, press, type DeviceOptions } from './helpers';
import { MultiTouch, centerOf, waitForTouchTarget } from './touch';

const balance: Balance = validateBalance(JSON.parse(readFileSync('config/balance.json', 'utf8')));
const QUERY = '/?debug=hook&renderer=canvas';
/** 설치 앱(TWA · 홈 화면 앱)의 시작 주소 (manifest start_url) + 시험 훅 */
const APP_START = '/?source=pwa&debug=hook&renderer=canvas';
const POLL = { intervals: [100, 150, 200], timeout: 20_000 };
/**
 * 연습 역할 격자의 연타 가드 시간. client/src/ui/lobby.ts PRACTICE_ARM_MS와 같다 (단위 시험 client-flow가 그 값을 본다).
 * lobby.ts는 CSS를 불러 Playwright 쪽에서 import할 수 없다
 */
const PRACTICE_ARM_MS = 400;

/** 서버 WebSocket을 모두 막는다 (연결 실패처럼 열리지 않고 닫힘). 막힌 시도 수를 센다 */
async function blockServer(page: Page): Promise<{ attempts: () => number }> {
  let n = 0;
  await page.routeWebSocket(/\/ws$/, (ws) => {
    n += 1;
    ws.close({ code: 1011, reason: 'blocked' });
  });
  return { attempts: () => n };
}

/** 페이지가 연 WebSocket 수 (막힌 것 포함) */
function countSockets(page: Page): () => number {
  let n = 0;
  page.on('websocket', () => {
    n += 1;
  });
  return () => n;
}

async function practiceState(page: Page): Promise<{
  transport: string | undefined;
  practiceRoom: string | null | undefined;
  phase: string | null | undefined;
  role: string | null | undefined;
  snapCount: number | undefined;
}> {
  return page.evaluate(() => ({
    transport: window.__DECOY__?.transport,
    practiceRoom: window.__DECOY__?.practiceRoom,
    phase: window.__DECOY__?.phase,
    role: window.__DECOY__?.role,
    snapCount: window.__DECOY__?.snapCount,
  }));
}

/** 판 중 표시 (body.in-match: 새 버전 띠를 숨긴다) */
async function inMatch(page: Page): Promise<boolean> {
  return page.evaluate(() => document.body.classList.contains('in-match'));
}

interface LifeState {
  guarding: boolean;
  link: string;
  lifeApp: boolean;
}

/** 생명주기 시험 훅 (?debug): 뒤로 가기 항목이 들어 있는가 · 서버 연결 상태 · 터치/설치 앱인가 */
async function lifeState(page: Page): Promise<LifeState | null> {
  return page.evaluate(() => {
    const h = (window as unknown as { __DECOY_LIFE__?: LifeState }).__DECOY_LIFE__;
    return h ? { guarding: h.guarding, link: h.link, lifeApp: h.lifeApp } : null;
  });
}

/** 판 안(이동 영역)을 손가락으로 한 번 탭한다 — 사용자 활성화 안에서 뒤로 가기 항목을 넣는 자리 */
async function tapInMatch(page: Page): Promise<void> {
  const t = await MultiTouch.attach(page);
  const zone = centerOf(await waitForTouchTarget(page, 'move-zone'));
  await t.tap(1, zone.x, zone.y);
  await t.detach();
}

async function localTruth(page: Page): Promise<TruthFrame> {
  const t = await page.evaluate(() => window.__DECOY__?.getTruth() ?? null);
  if (!t) throw new Error('기기 안 정답 없음');
  return t;
}

test('서버 연결이 막혀도 3초 안에 상태 줄 · 봇과 연습이 보이고, 탭 두 번으로 기기 안 판을 끝까지 → 다시 하기 → 홈으로', async ({
  browser,
}) => {
  const { context, page, problems } = await newPlayerPage(browser, dpr1(PHONE_LANDSCAPE));
  // 막힌 시도는 route 처리기로 센다 (가로챈 WebSocket은 page 'websocket' 이벤트를 내지 않는다)
  const blocked = await blockServer(page);
  const t0 = Date.now();
  await page.goto(QUERY);
  const status = page.getByTestId('server-status');
  await expect(status).toBeVisible({ timeout: 3000 });
  await expect(page.getByTestId('practice')).toBeVisible({ timeout: 3000 });
  expect(Date.now() - t0).toBeLessThan(3000 + 1500);
  await expect(status).toHaveAttribute('data-state', 'waking');
  await expect(status).toContainText('서버를 깨우는 중');
  await expect(status).toContainText('봇과 연습');
  // 연결이 필요한 버튼은 꺼져 있고, 첫 화면에서는 가운데 깨우기 패널 대신 상태 줄
  await expect(page.getByTestId('create-room')).toBeDisabled();
  await expect(page.getByTestId('join-room')).toBeDisabled();
  await expect(page.getByTestId('server-waking')).toBeHidden();
  await page.waitForTimeout(2800);
  await expect(page.getByTestId('server-waking')).toBeHidden();
  expect(blocked.attempts()).toBeGreaterThan(0);

  // 탭 두 번: 봇과 연습 → 역할
  await press(page.getByTestId('practice'));
  await press(page.getByTestId('practice-role-runner'));
  const tapAt = blocked.attempts();
  await expect.poll(async () => (await practiceState(page)).phase, { timeout: 10_000 }).toBe('playing');
  // 판 중에는 body에 in-match (새 버전 띠를 숨긴다, 검토 반영)
  expect(await inMatch(page)).toBe(true);
  const st = await practiceState(page);
  expect(st.transport).toBe('local');
  expect(st.role).toBe('runner');
  expect(st.practiceRoom).toMatch(/^P-[A-Z]{4}$/);
  await expect.poll(async () => (await practiceState(page)).snapCount ?? 0).toBeGreaterThan(20);

  // 봇이 움직인다 (기기 안 정답에서 봇 자리 위치가 바뀜, 괴물 대기 5초 뒤)
  const me = await page.evaluate(() => window.__DECOY__?.you ?? '');
  const first = await localTruth(page);
  await page.waitForTimeout(6500);
  const later = await localTruth(page);
  const moved = later.players.filter((p) => {
    const q = first.players.find((x) => x.id === p.id);
    return p.id !== me && q !== undefined && Math.hypot(p.x - q.x, p.y - q.y) > 1;
  });
  expect(moved.length).toBeGreaterThanOrEqual(2);
  expect(later.tick - first.tick).toBeGreaterThan(150);

  // 기기 안 테스트 훅으로 판을 끝까지 → 결과
  await page.evaluate(() => window.__DECOY__?.sendTest({ kind: 'setTime', timeLeft: 0.1 }));
  await expect(page.getByTestId('result')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('result-home')).toBeVisible();
  expect(await inMatch(page)).toBe(false);
  // 다시 하기 → 같은 역할로 바로 두 번째 판
  await press(page.getByTestId('rematch'));
  await expect.poll(async () => (await practiceState(page)).phase, { timeout: 10_000 }).toBe('playing');
  await expect(page.getByTestId('result')).toBeHidden();
  expect((await practiceState(page)).role).toBe('runner');
  await expect.poll(async () => (await practiceState(page)).snapCount ?? 0).toBeGreaterThan(10);
  // 연습을 시작한 뒤로 새 WebSocket을 열지 않았다 (막히기 전 재연결 간격 1 · 2 · 4초가 몇 번 지났는데도)
  expect(blocked.attempts()).toBe(tapAt);
  expect(page.url()).not.toContain('room=');

  // 끝내고 홈으로: 첫 화면 · 상태 줄, 서버 연결을 다시 시도한다
  await page.evaluate(() => window.__DECOY__?.sendTest({ kind: 'setTime', timeLeft: 0.1 }));
  await expect(page.getByTestId('result')).toBeVisible({ timeout: 10_000 });
  await press(page.getByTestId('result-home'));
  await expect(page.getByTestId('practice')).toBeVisible();
  await expect(page.getByTestId('server-status')).toBeVisible();
  expect(await page.evaluate(() => window.__DECOY__?.transport)).toBe('net');
  await expect.poll(() => blocked.attempts(), { timeout: 8000 }).toBeGreaterThan(tapAt);
  expect(problems).toEqual([]);
  await context.close();
});

test('연습 중 10초 숨겼다 돌아오면 같은 판이 그대로 이어지고(정지 · 다른 탭 안내 없음), 새로고침하면 첫 화면', async ({
  browser,
}) => {
  const { context, page, problems } = await newPlayerPage(browser);
  await context.addInitScript(() => {
    let vis: DocumentVisibilityState = 'visible';
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => vis });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => vis === 'hidden' });
    (window as unknown as { __e2eSetVisible: (on: boolean) => void }).__e2eSetVisible = (on) => {
      vis = on ? 'visible' : 'hidden';
      document.dispatchEvent(new Event('visibilitychange'));
    };
  });
  await page.goto(QUERY);
  await page.getByTestId('practice').click();
  await page.getByTestId('practice-role-guard').click();
  await expect.poll(async () => (await practiceState(page)).phase, { timeout: 10_000 }).toBe('playing');
  await expect.poll(async () => (await practiceState(page)).snapCount ?? 0).toBeGreaterThan(30);
  const room = (await practiceState(page)).practiceRoom;
  const before = await localTruth(page);
  await page.evaluate(() =>
    (window as unknown as { __e2eSetVisible: (on: boolean) => void }).__e2eSetVisible(false),
  );
  await page.waitForTimeout(10_000);
  const hidden = await localTruth(page);
  // 숨긴 동안 기기 안 판은 멈춰 있다 (틱이 거의 오르지 않음)
  expect(hidden.tick - before.tick).toBeLessThan(10);
  await page.evaluate(() =>
    (window as unknown as { __e2eSetVisible: (on: boolean) => void }).__e2eSetVisible(true),
  );
  const back = await localTruth(page);
  await page.waitForTimeout(1000);
  const after = await localTruth(page);
  // 돌아온 뒤 따라잡기 없이 이어 간다: 1초에 약 30틱 (몰아서 수백 틱을 돌리지 않음)
  expect(after.tick - back.tick).toBeGreaterThan(15);
  expect(after.tick - back.tick).toBeLessThan(45);
  const st = await practiceState(page);
  expect(st.phase).toBe('playing');
  expect(st.practiceRoom).toBe(room);
  const snap = (await page.evaluate(() => window.__DECOY__?.getLastSnapshot() ?? null)) as Snapshot | null;
  expect(snap?.world.paused).toBeNull();
  await expect(page.getByTestId('replaced-notice')).toBeHidden();
  expect(page.url()).not.toContain('room=');
  // 새로고침하면 연습은 사라지고 첫 화면
  await page.reload();
  await expect(page.getByTestId('practice')).toBeVisible();
  await expect(page.getByTestId('create-room')).toBeVisible();
  expect(await page.evaluate(() => window.__DECOY__?.transport)).toBe('net');
  expect(problems).toEqual([]);
  await context.close();
});

test('괴물로 연습할 때 받은 스냅샷에 시야 밖 생존자가 0명이다 (독립 판정기 · 기기 안 정답 대조)', async ({
  browser,
}) => {
  const { context, page, problems } = await newPlayerPage(browser);
  await page.goto(QUERY);
  await page.getByTestId('practice').click();
  await page.getByTestId('practice-role-monster').click();
  await expect.poll(async () => (await practiceState(page)).phase, { timeout: 10_000 }).toBe('playing');
  // 생존자 봇 하나를 괴물 앞에, 하나를 벽 뒤에, 하나를 멀리 세우고 멈춘다. 실전 봇은 괴물을 보면 바로 달아나서
  // 멈추지 않으면 부하가 걸린 러너에서 '보인 생존자' 표본이 몇 개밖에 안 남는다 (시야 안팎 대조가 비지 않게)
  const t = await localTruth(page);
  const mon = t.players.find((p) => p.role === 'monster');
  const survivors = t.players.filter((p) => p.role !== 'monster');
  if (!mon) throw new Error('괴물 없음');
  await page.evaluate(
    ([m, s]) => {
      const d = window.__DECOY__;
      if (!d) return;
      d.sendTest({ kind: 'teleport', target: m, x: 24, y: 23, face: -Math.PI / 2 });
      d.sendTest({ kind: 'teleport', target: s[0] ?? '', x: 24, y: 20.5 });
      d.sendTest({ kind: 'teleport', target: s[1] ?? '', x: 8, y: 16 });
      d.sendTest({ kind: 'teleport', target: s[2] ?? '', x: 31, y: 21 });
      for (const id of s) d.sendTest({ kind: 'freeze', target: id, frozen: true });
    },
    [mon.id, survivors.map((p) => p.id)] as const,
  );
  // PC 괴물의 조준은 마우스를 따른다: 마우스가 역할 버튼 자리에 남아 있으면 엉뚱한 쪽을 봐서 '보인 생존자' 표본이
  // 거의 안 생긴다. 내 화면이 새 자리로 옮겨 간 뒤 마우스를 북쪽 생존자 위로 옮기고, 조준이 북쪽이 될 때까지 기다린다
  await page.waitForFunction(() => {
    const r = window.__DECOY__?.getRenderPos();
    return r !== null && r !== undefined && Math.hypot(r.x - 24, r.y - 23) < 0.05;
  });
  const north = await page.evaluate(() => window.__DECOY__?.tileToClient(24, 20.5) ?? null);
  if (!north) throw new Error('tileToClient 없음');
  await page.mouse.move(north.x, north.y);
  await expect
    .poll(async () => Math.abs(((await localTruth(page)).monster?.aim ?? 0) + Math.PI / 2), {
      timeout: 10_000,
    })
    .toBeLessThan(0.1);
  // 같은 틱의 (스냅샷, 기기 안 정답) 쌍을 모은다: 기기 안 서버는 틱 사이에 메시지를 마이크로태스크로 넘기므로
  // 스냅샷을 받은 프레임의 정답 틱이 스냅샷 틱과 같으면 같은 순간이다
  const pairs = await page.evaluate(async () => {
    const out: { snap: Snapshot; truth: TruthFrame }[] = [];
    const end = performance.now() + 12_000;
    let last = -1;
    while (performance.now() < end) {
      await new Promise((r) => requestAnimationFrame(r));
      const d = window.__DECOY__;
      const snap = d?.getLastSnapshot() ?? null;
      const truth = d?.getTruth() ?? null;
      if (!snap || !truth || snap.tick === last || snap.tick !== truth.tick) continue;
      last = snap.tick;
      out.push({ snap: JSON.parse(JSON.stringify(snap)) as Snapshot, truth });
    }
    return out;
  });
  expect(pairs.length).toBeGreaterThan(40);
  let seen = 0;
  let hiddenTruth = 0;
  for (const { snap, truth } of pairs) {
    const m = truth.players.find((p) => p.role === 'monster');
    if (!m || !truth.monster) continue;
    for (const v of snap.survivors) {
      // 스냅샷의 생존자(임시 ID)는 그 틱 정답의 어느 생존자 자리와 같고, 그 자리는 괴물 시야에서 '안 보임'이 아니다
      const real = truth.players.find((p) => p.role !== 'monster' && Math.hypot(p.x - v.x, p.y - v.y) < 0.01);
      expect(real, `틱 ${snap.tick} 스냅샷 생존자 (${v.x}, ${v.y})`).toBeDefined();
      if (!real) continue;
      expect(
        monsterVerdict(balance, m.x, m.y, truth.monster.aim, truth.monster.blend, real.x, real.y),
      ).not.toBe('hidden');
      expect(survivors.some((s) => s.id === v.id)).toBe(false);
      seen += 1;
    }
    for (const p of truth.players)
      if (
        p.role !== 'monster' &&
        p.status === 'free' &&
        monsterVerdict(balance, m.x, m.y, truth.monster.aim, truth.monster.blend, p.x, p.y) === 'hidden'
      )
        hiddenTruth += 1;
  }
  // 대조가 비지 않았다: 보이는 생존자도, 시야 밖 생존자도 있었다
  expect(seen).toBeGreaterThan(10);
  expect(hiddenTruth).toBeGreaterThan(10);
  expect(problems).toEqual([]);
  await context.close();
});

test('서버 방 결과 화면의 "홈으로"는 자리를 비우고, 같은 연결로 첫 화면에서 새 방을 만든다', async ({
  browser,
}) => {
  const { context, page, problems } = await newPlayerPage(browser);
  // 친구 한 명이 같은 방에 있다: 사람이 남은 방은 결과 단계에서도 남는다 (사람이 모두 나간 방은 바로 정리된다 — 검토 반영,
  // RoomManager.dropIfAbandoned. 혼자 봇과 한 방이면 '홈으로' 순간 방이 사라져 아래 '진행 중' 거절을 볼 수 없다)
  const friend = await newPlayerPage(browser);
  const sockets = countSockets(page);
  await page.goto(`${QUERY}&bots=1`);
  await page.getByTestId('create-room').click();
  await expect(page.getByTestId('room-code')).toHaveText(/^[A-Z]{4}$/);
  const code = (await page.getByTestId('room-code').textContent()) ?? '';
  await friend.page.goto(`${QUERY}&room=${code}`);
  await expect(friend.page.getByTestId('room-code')).toHaveText(code);
  await page.getByTestId('role-runner').click();
  await page.getByTestId('ready-button').click();
  await friend.page.getByTestId('role-guard').click();
  await friend.page.getByTestId('ready-button').click();
  await expect(page.getByTestId('start-button')).toBeEnabled();
  await page.getByTestId('start-button').click();
  await expect.poll(async () => (await practiceState(page)).phase, { timeout: 10_000 }).toBe('playing');
  expect((await practiceState(page)).transport).toBe('net');
  await page.evaluate(() => window.__DECOY__?.sendTest({ kind: 'setTime', timeLeft: 0.1 }));
  await expect(page.getByTestId('result')).toBeVisible({ timeout: 10_000 });
  await expect(friend.page.getByTestId('result')).toBeVisible({ timeout: 10_000 });
  const opened = sockets();
  expect(opened).toBeGreaterThan(0);
  await page.getByTestId('result-home').click();
  await expect(page.getByTestId('create-room')).toBeEnabled();
  expect(page.url()).not.toContain('room=');
  // 친구 방이면 코드 칸에 방 코드를 남긴다(검토 반영). 결과 단계 방에 다시 들어가려다 거절돼도 친 코드는 남는다
  await expect(page.getByTestId('room-code-input')).toHaveValue(code);
  await page.getByTestId('join-room').click();
  await expect(page.getByTestId('lobby-error')).toContainText('이미 진행 중인 방입니다');
  await expect(page.getByTestId('room-code-input')).toHaveValue(code);
  // 친구도 나가면 사람이 남지 않은 방은 바로 정리된다: 같은 코드로는 '찾을 수 없음'
  await friend.page.getByTestId('result-home').click();
  await expect(friend.page.getByTestId('create-room')).toBeEnabled();
  await expect
    .poll(
      async () => {
        await page.getByTestId('join-room').click();
        return (await page.getByTestId('lobby-error').textContent()) ?? '';
      },
      { intervals: [200, 300, 500], timeout: 10_000 },
    )
    .toContain('찾을 수 없습니다');
  await page.getByTestId('create-room').click();
  await expect(page.getByTestId('room-code')).not.toHaveText(code);
  await expect(page.getByTestId('room-code')).toHaveText(/^[A-Z]{4}$/);
  // 같은 연결로 (새 WebSocket 없이)
  expect(sockets()).toBe(opened);
  expect(problems).toEqual([]);
  expect(friend.problems).toEqual([]);
  await friend.context.close();
  await context.close();
});

/** 갤럭시 S 계열 가로(높이 360) · 낮은 PC 창 (검토 반영: 상태 줄 · 오류 줄이 첫 화면 밖이던 크기) */
const LOW_SCREENS: { name: string; device: DeviceOptions }[] = [
  {
    name: '휴대폰 740×360',
    device: dpr1({
      ...PHONE_LANDSCAPE,
      viewport: { width: 740, height: 360 },
      screen: { width: 740, height: 360 },
    }),
  },
  { name: 'PC 1366×657', device: { viewport: { width: 1366, height: 657 } } },
];

for (const d of LOW_SCREENS) {
  test(`첫 화면 · 연습 고르기의 서버 상태 줄과 입장 실패 오류 줄이 스크롤 없이 화면 안에 있다 (${d.name})`, async ({
    browser,
  }) => {
    // 연결이 막힘: 꺼진 버튼의 이유(상태 줄)가 첫 화면 안
    const blocked = await newPlayerPage(browser, d.device);
    await blockServer(blocked.page);
    await blocked.page.goto(QUERY);
    const status = blocked.page.getByTestId('server-status');
    await expect(status).toHaveAttribute('data-state', 'waking');
    await expect(blocked.page.getByTestId('quick-match')).toBeDisabled();
    await expect(status).toBeInViewport({ ratio: 1 });
    await press(blocked.page.getByTestId('practice'));
    await expect(blocked.page.getByTestId('practice-picker')).toBeVisible();
    await expect(status).toBeInViewport({ ratio: 1 });
    expect(blocked.problems).toEqual([]);
    await blocked.context.close();
    // 서버 연결: 없는 방 코드로 입장 → 오류 줄이 첫 화면 안
    const { context, page, problems } = await newPlayerPage(browser, d.device);
    await page.goto(QUERY);
    await expect(page.getByTestId('server-status')).toHaveAttribute('data-state', 'connected');
    await expect(page.getByTestId('server-status')).toBeInViewport({ ratio: 1 });
    await page.getByTestId('room-code-input').fill('ZZZZ');
    await press(page.getByTestId('join-room'));
    await expect(page.getByTestId('lobby-error')).toContainText('찾을 수 없습니다');
    await expect(page.getByTestId('lobby-error')).toBeInViewport({ ratio: 1 });
    expect(problems).toEqual([]);
    await context.close();
  });
}

test('친구 방 로비의 "나가기": 자리를 비우고(방장 넘김) 첫 화면, 코드 칸에 방 코드 · 주소와 마지막 방은 지워 다시 열어도 첫 화면', async ({
  browser,
}) => {
  const phone = await newPlayerPage(browser, dpr1(PHONE_LANDSCAPE));
  const pc = await newPlayerPage(browser);
  await phone.page.goto(QUERY);
  await press(phone.page.getByTestId('create-room'));
  await expect(phone.page.getByTestId('room-code')).toHaveText(/^[A-Z]{4}$/);
  const code = (await phone.page.getByTestId('room-code').textContent()) ?? '';
  await pc.page.goto(`${QUERY}&room=${code}`);
  const pcPlayers = pc.page.getByTestId('player-list').locator('.player');
  await expect(pcPlayers).toHaveCount(2);
  await expect(phone.page.getByTestId('player-list').locator('.player')).toHaveCount(2);
  // 터치 기기: 방에 들어가면 마지막 방(30초 복귀)을 적는다
  expect(await phone.page.evaluate(() => localStorage.getItem('decoy:lastRoom'))).not.toBeNull();
  const leave = phone.page.getByTestId('room-leave');
  await expect(leave).toBeVisible();
  expect((await leave.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(48);
  await press(leave);
  await expect(phone.page.getByTestId('create-room')).toBeVisible();
  await expect(phone.page.getByTestId('room-code')).toHaveCount(0);
  await expect(phone.page.getByTestId('room-code-input')).toHaveValue(code);
  expect(phone.page.url()).not.toContain('room=');
  expect(await phone.page.evaluate(() => localStorage.getItem('decoy:lastRoom'))).toBeNull();
  // 서버: 자리를 지우고 방장을 남은 사람에게
  await expect(pcPlayers).toHaveCount(1);
  await expect(pc.page.getByTestId('start-button')).toBeVisible();
  // 곧바로 다시 열어도(설치 앱 시작 주소) 같은 방으로 돌아가지 않는다
  await phone.page.goto(`/?source=pwa&debug=hook&renderer=canvas`);
  await expect(phone.page.getByTestId('create-room')).toBeVisible();
  await phone.page.waitForTimeout(1500);
  await expect(phone.page.getByTestId('room-code')).toHaveCount(0);
  await expect(pcPlayers).toHaveCount(1);
  expect(phone.problems).toEqual([]);
  expect(pc.problems).toEqual([]);
  await phone.context.close();
  await pc.context.close();
});

test('?practice=1(방 링크 없이)은 30초 안 마지막 방 복귀보다 우선하고, 읽은 뒤 주소에서 지운다 — 연습 중 새로고침은 첫 화면', async ({
  browser,
}) => {
  const { context, page, problems } = await newPlayerPage(browser, dpr1(PHONE_LANDSCAPE));
  await page.goto(QUERY);
  await press(page.getByTestId('create-room'));
  await expect(page.getByTestId('room-code')).toHaveText(/^[A-Z]{4}$/);
  expect(await page.evaluate(() => localStorage.getItem('decoy:lastRoom'))).not.toBeNull();
  // 깨우기 화면의 "기다리는 동안 봇과 연습"과 같은 주소 (방 코드 없이 practice=1)
  await page.goto(`${QUERY}&practice=1`);
  await expect(page.getByTestId('practice-picker')).toBeVisible();
  await expect(page.getByTestId('room-code')).toHaveCount(0);
  await expect(page.getByTestId('server-waking')).toBeHidden();
  expect(page.url()).not.toContain('practice=');
  expect(page.url()).not.toContain('room=');
  expect(page.url()).toContain('debug=hook');
  expect(await page.evaluate(() => localStorage.getItem('decoy:lastRoom'))).toBeNull();
  await press(page.getByTestId('practice-role-runner'));
  await expect.poll(async () => (await practiceState(page)).phase, { timeout: 10_000 }).toBe('playing');
  // 새로고침 → 첫 화면 (역할 고르기가 다시 열리지 않는다)
  await page.reload();
  await expect(page.getByTestId('create-room')).toBeVisible();
  await expect(page.getByTestId('practice-picker')).toHaveCount(0);
  expect(problems).toEqual([]);
  await context.close();
});

// ───────────── 연습 판 뒤로 가기 (검토 반영 F16) ─────────────

test('터치 연습 판 중 뒤로 가기 → 연습 문구 확인 창: "계속"이면 판 유지, "나가기"면 첫 화면 — 앞 문서가 없는 설치 앱에서도 문서를 떠나지 않는다 (검토 반영 F16)', async ({
  browser,
}) => {
  const { context, page, problems } = await newPlayerPage(browser, dpr1(PHONE_LANDSCAPE));
  // 설치 앱 시작 주소. 앞 기록은 Playwright의 about:blank뿐이다 — 실기기 TWA라면 이 자리의 뒤로 가기가 곧 앱 종료다
  await page.goto(APP_START);
  const appUrl = page.url();
  await press(page.getByTestId('practice'));
  await press(page.getByTestId('practice-role-runner'));
  await expect.poll(async () => (await practiceState(page)).phase, { timeout: 10_000 }).toBe('playing');
  expect((await practiceState(page)).transport).toBe('local');
  expect((await lifeState(page))?.lifeApp).toBe(true);
  // 판 안 탭(사용자 활성화)에서 뒤로 가기 항목을 넣는다. 옛 코드는 연습 판에서 넣지 않아(guarding false) 뒤로 가기가
  // 확인 없이 about:blank(앱 종료)로 떠났다
  await tapInMatch(page);
  await expect.poll(async () => (await lifeState(page))?.guarding, POLL).toBe(true);

  // 뒤로 가기 → 연습 문구 확인 창, 같은 문서에서 판이 계속 흐른다
  await page.goBack({ waitUntil: 'commit' });
  const dialog = page.getByTestId('leave-dialog');
  await expect(dialog).toBeVisible();
  expect(page.url()).toBe(appUrl);
  await expect(dialog).toContainText(APP_TEXT.leaveTitlePractice);
  await expect(dialog).toContainText(APP_TEXT.leaveBodyPractice);
  // 친구 방(30초 유예) · 빠른 매칭(바로 판정) 문구가 섞이지 않는다
  await expect(dialog).not.toContainText(APP_TEXT.leaveTitle);
  await expect(dialog).not.toContainText('30초');
  await expect(dialog).not.toContainText(APP_TEXT.leaveBodyQuick);
  expect((await practiceState(page)).phase).toBe('playing');
  // "계속" → 닫히고 그 탭에서 항목을 다시 넣는다
  await press(page.getByTestId('leave-stay'));
  await expect(dialog).toBeHidden();
  await expect.poll(async () => (await lifeState(page))?.guarding, POLL).toBe(true);
  expect((await practiceState(page)).phase).toBe('playing');

  // 다시 뒤로 가기 → "나가기" → 첫 화면: 기기 안 판을 닫고 서버 연결을 다시 연다
  await page.goBack({ waitUntil: 'commit' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(APP_TEXT.leaveTitlePractice);
  await press(page.getByTestId('leave-go'));
  await expect(page.getByTestId('practice')).toBeVisible();
  await expect(page.getByTestId('create-room')).toBeVisible();
  await expect(dialog).toBeHidden();
  const st = await practiceState(page);
  expect(st.transport).toBe('net');
  expect(st.practiceRoom ?? null).toBeNull();
  expect(st.phase ?? null).toBeNull();
  await expect.poll(() => page.evaluate(() => window.__DECOY__?.getHudLayout() ?? null), POLL).toBeNull();
  expect(await inMatch(page)).toBe(false);
  expect((await lifeState(page))?.guarding).toBe(false);
  expect(page.url()).toBe(appUrl);
  await expect.poll(async () => (await lifeState(page))?.link, POLL).toBe('open');
  // 친구 방 나가기 경로(코드 칸 · 마지막 방)를 타지 않았다
  await expect(page.getByTestId('room-code-input')).toHaveValue('');
  expect(await page.evaluate(() => localStorage.getItem('decoy:lastRoom'))).toBeNull();
  expect(problems).toEqual([]);
  // 첫 화면의 뒤로 가기는 브라우저 동작 그대로 (남은 항목이 없어 한 번에 앞 문서로)
  await page.goBack({ waitUntil: 'commit' });
  expect(page.url()).toBe('about:blank');
  await context.close();
});

test('터치 연습 판 중 새로고침(탭 폐기 뒤 복원과 같다)이면 남은 뒤로 가기 항목을 첫 화면을 그리기 전에 걷는다: 첫 화면의 첫 뒤로 가기가 먹히지 않는다 (검토 반영 F16)', async ({
  browser,
}) => {
  const { context, page, problems } = await newPlayerPage(browser, dpr1(PHONE_LANDSCAPE));
  await page.goto(APP_START);
  const appUrl = page.url();
  await press(page.getByTestId('practice'));
  await press(page.getByTestId('practice-role-guard'));
  await expect.poll(async () => (await practiceState(page)).phase, { timeout: 10_000 }).toBe('playing');
  await tapInMatch(page);
  await expect.poll(async () => (await lifeState(page))?.guarding, POLL).toBe(true);
  expect(await page.evaluate(() => JSON.stringify(history.state))).toBe('{"decoyGuard":1}');
  // 연습은 주소에 남지 않으므로 새로고침하면 첫 화면이다. 그 항목은 판 전 항목과 같은 문서라 걷어도 문서를 떠나지 않는다
  await page.reload();
  await expect(page.getByTestId('practice')).toBeVisible();
  await expect(page.getByTestId('create-room')).toBeVisible();
  await expect.poll(() => page.evaluate(() => JSON.stringify(history.state)), POLL).toBe('null');
  expect((await lifeState(page))?.guarding).toBe(false);
  expect(page.url()).toBe(appUrl);
  expect(await page.evaluate(() => window.__DECOY__?.transport)).toBe('net');
  expect(problems).toEqual([]);
  // 첫 화면에서 뒤로 가기 한 번이면 앞 문서로 (항목이 남아 있으면 같은 주소에 머문다)
  await page.goBack({ waitUntil: 'commit' });
  expect(page.url()).toBe('about:blank');
  await context.close();
});

// ───────────── '봇과 연습' 연타 가드 (검토 반영 F17) ─────────────

test("'봇과 연습'을 누르면 역할 격자가 PRACTICE_ARM_MS 동안 arming(포인터 막음)이었다가 풀린다 — 키보드로는 가드 중에도 고른다 (검토 반영 F17)", async ({
  browser,
}) => {
  const { context, page, problems } = await newPlayerPage(browser, dpr1(PHONE_LANDSCAPE));
  await page.goto(QUERY);
  await expect(page.getByTestId('practice')).toBeVisible();
  // 누른 순간부터 클래스가 떨어질 때까지를 페이지 안에서 잰다 (Playwright 왕복 지연 없이)
  const r = await page.evaluate(async () => {
    document.querySelector<HTMLButtonElement>('[data-testid="practice"]')?.click();
    const grid = document.querySelector('[data-testid="practice-picker"] .practice-roles');
    const armed = grid?.classList.contains('arming') ?? false;
    const t0 = performance.now();
    while (grid?.classList.contains('arming') && performance.now() - t0 < 3000)
      await new Promise((res) => setTimeout(res, 5));
    return { found: grid !== null, armed, ms: performance.now() - t0, after: grid?.className ?? '' };
  });
  expect(r.found).toBe(true);
  expect(r.armed, '그린 순간 역할 격자에 arming').toBe(true);
  expect(r.ms).toBeGreaterThanOrEqual(PRACTICE_ARM_MS - 20);
  expect(r.ms).toBeLessThan(PRACTICE_ARM_MS + 600);
  expect(r.after).not.toContain('arming');
  expect(r.after).toContain('practice-roles');
  // 키보드는 막지 않는다: 다시 그린 고르기 화면에서 가드 중에도 Enter로 고른다 (Enter를 누른 순간 가드 중이었는지 기록)
  await press(page.getByTestId('practice-cancel'));
  await expect(page.getByTestId('practice')).toBeVisible();
  await page.getByTestId('practice').focus();
  await page.keyboard.press('Enter');
  await page.evaluate(() => {
    const w = window as unknown as { __e2eArmedAtKey?: boolean };
    const b = document.querySelector<HTMLButtonElement>('[data-testid="practice-role-scout"]');
    b?.addEventListener(
      'keydown',
      () => {
        w.__e2eArmedAtKey = document.querySelector('.practice-roles')?.classList.contains('arming') ?? false;
      },
      { once: true },
    );
    b?.focus();
  });
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await practiceState(page)).phase, { timeout: 10_000 }).toBe('playing');
  expect((await practiceState(page)).role).toBe('scout');
  expect(
    await page.evaluate(() => (window as unknown as { __e2eArmedAtKey?: boolean }).__e2eArmedAtKey),
    'Enter를 누를 때 가드 중이었다',
  ).toBe(true);
  expect(problems).toEqual([]);
  await context.close();
});

/**
 * 손가락으로 '봇과 연습'을 빠르게 두 번 탭한다 (같은 자리, 100ms 간격). 두 번째 탭 자리가 역할 버튼 위인지는 시험 안에서
 * 확인한다(빈 통과 방지). 막는 것은 style.css '.practice-roles.arming { pointer-events: none }'이다
 */
const DOUBLE_TAP_SCREENS: { name: string; device: DeviceOptions }[] = [
  { name: '휴대폰 915×412', device: dpr1(PHONE_LANDSCAPE) },
  { name: '휴대폰 740×360', device: LOW_SCREENS[0]!.device },
];

for (const d of DOUBLE_TAP_SCREENS) {
  test(`터치: '봇과 연습'을 빠르게 두 번 탭해도 판이 시작되지 않고 역할 고르기가 남는다 (${d.name}, 검토 반영 F17)`, async ({
    browser,
  }) => {
    const { context, page, problems } = await newPlayerPage(browser, d.device);
    await page.goto(QUERY);
    const btn = page.getByTestId('practice');
    await expect(btn).toBeVisible();
    // 고르기 화면을 한 번 그려 역할 버튼 자리를 재고 돌아온다: '봇과 연습' 버튼과 역할 버튼이 겹치는 자리를 탭한다
    // (버튼 가운데는 역할 버튼 사이 틈일 수 있다 — 크롬의 터치 보정이 옆 버튼으로 붙여 옛 코드에서는 그래도 판이 시작됐다)
    await press(btn);
    const roles = await page.locator('[data-testid^="practice-role-"]').evaluateAll((els) =>
      els.map((e) => {
        const r = e.getBoundingClientRect();
        return { id: e.getAttribute('data-testid') ?? '', x: r.x, y: r.y, w: r.width, h: r.height };
      }),
    );
    await press(page.getByTestId('practice-cancel'));
    await expect(btn).toBeVisible();
    const box = await btn.boundingBox();
    if (!box) throw new Error('봇과 연습 버튼 자리 없음');
    let target: { id: string; x: number; y: number; area: number } | null = null;
    for (const r of roles) {
      const x0 = Math.max(box.x, r.x);
      const x1 = Math.min(box.x + box.width, r.x + r.w);
      const y0 = Math.max(box.y, r.y);
      const y1 = Math.min(box.y + box.height, r.y + r.h);
      const area = (x1 - x0) * (y1 - y0);
      if (x1 - x0 > 8 && y1 - y0 > 8 && area > (target?.area ?? 0))
        target = { id: r.id, x: (x0 + x1) / 2, y: (y0 + y1) / 2, area };
    }
    if (!target)
      throw new Error(`봇과 연습 버튼과 겹치는 역할 버튼이 없다: ${JSON.stringify({ box, roles })}`);
    await page.touchscreen.tap(target.x, target.y);
    await page.waitForTimeout(100);
    await page.touchscreen.tap(target.x, target.y);
    await page.waitForTimeout(1000);
    const st = await practiceState(page);
    expect(
      st.phase ?? null,
      `두 번째 탭이 ${target.id}에 떨어져 판이 시작됐다 (style.css .practice-roles.arming이 포인터를 막는가)`,
    ).toBeNull();
    expect(st.transport).toBe('net');
    await expect(page.getByTestId('practice-picker')).toBeVisible();
    // 빈 통과 방지: 탭한 자리는 가드가 풀린 지금 그 역할 버튼 위다 (가드가 없으면 두 번째 탭이 이 버튼을 눌렀다)
    const under = await page.evaluate(
      ([px, py]) =>
        document
          .elementFromPoint(px, py)
          ?.closest('[data-testid^="practice-role-"]')
          ?.getAttribute('data-testid') ?? null,
      [target.x, target.y] as const,
    );
    expect(under).toBe(target.id);
    // 가드가 풀리면 탭 한 번으로 고른다
    await press(page.getByTestId('practice-role-runner'));
    await expect.poll(async () => (await practiceState(page)).phase, { timeout: 10_000 }).toBe('playing');
    expect((await practiceState(page)).role).toBe('runner');
    expect(problems).toEqual([]);
    await context.close();
  });
}

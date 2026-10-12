// M13c 빠른 매칭 E2E (MOBILE_PLAN M13c 검증): 대기 시간 2초짜리 balance 파일로 전용 서버를 띄운다
//  - PC 1명 + 휴대폰 1명이 빠른 매칭 → 같은 방 → 약 2초 뒤 봇 2명과 시작 → 테스트 훅으로 끝 → 두 화면 결과(봇 표시) → 홈으로
//  - 대기 중 화면을 숨기면 대기열에서 빠지고, 돌아오면 "대기열에서 빠졌어요 — 다시 찾기"로 다시 들어간다
//  - (검토 반영) 판 중 뒤로 가기 확인 본문은 '바로 판에서 빠져요'(30초 유예 안내 없음)
//  - (검토 반영) 대기 취소 직후 늦게 온 떠난 방 갱신은 버린다(유령 대기 화면 없음)
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { APP_TEXT } from '../../client/src/data/storyText';
import { startServer, type RunningServer } from '../helpers/serverProcess';
import { PHONE_LANDSCAPE, dpr1, newPlayerPage, press } from './helpers';
import { MultiTouch, centerOf, waitForTouchTarget } from './touch';

const WAIT_S = 2;

let server: RunningServer;
let base = '';

test.beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'decoy-quick-'));
  const balance = JSON.parse(readFileSync('config/balance.json', 'utf8')) as {
    matchmaking: { quickMatchWait: number };
  };
  balance.matchmaking.quickMatchWait = WAIT_S;
  const path = join(dir, 'balance.json');
  writeFileSync(path, JSON.stringify(balance));
  server = await startServer([`--balance=${path}`, '--test-hooks', '--seed=77']);
  base = `http://127.0.0.1:${server.port}`;
});

test.afterAll(async () => {
  await server.stop();
});

async function state(
  page: Page,
): Promise<{ room: string | null; phase: string | null; role: string | null }> {
  return page.evaluate(() => ({
    room: window.__DECOY__?.room ?? null,
    phase: window.__DECOY__?.phase ?? null,
    role: window.__DECOY__?.role ?? null,
  }));
}

test('PC 1명 + 휴대폰 1명이 빠른 매칭 → 같은 방 → 약 2초 뒤 봇 2명과 시작 → 테스트 훅으로 끝 → 두 화면 결과 → 홈으로', async ({
  browser,
}) => {
  const pc = await newPlayerPage(browser);
  const phone = await newPlayerPage(browser, dpr1(PHONE_LANDSCAPE));
  await pc.page.goto(`${base}/?debug=hook&renderer=canvas&name=${encodeURIComponent('컴퓨터')}`);
  await phone.page.goto(`${base}/?debug=hook&renderer=canvas&name=${encodeURIComponent('휴대폰')}`);
  await expect(pc.page.getByTestId('quick-match')).toBeEnabled();
  await expect(phone.page.getByTestId('quick-match')).toBeEnabled();
  const t0 = Date.now();
  await press(pc.page.getByTestId('quick-match'));
  await expect(pc.page.getByTestId('quick-count')).toContainText('1/4');
  // PC는 괴물을 고르고, 휴대폰은 고르지 않는다 → 남은 역할 중 하나
  await press(pc.page.getByTestId('role-monster'));
  await expect(pc.page.getByTestId('role-monster')).toHaveClass(/mine/);
  await press(phone.page.getByTestId('quick-match'));
  await expect(pc.page.getByTestId('quick-count')).toContainText('2/4');
  await expect(phone.page.getByTestId('quick-count')).toContainText('2/4');
  await expect(pc.page.getByTestId('quick-countdown')).toContainText(/초 뒤 빈자리를 봇으로|곧 시작해요/);
  const a = await state(pc.page);
  const b = await state(phone.page);
  expect(a.room).toMatch(/^[A-Z]{4}$/);
  expect(b.room).toBe(a.room);
  // 휴대폰 화면에 PC 사람 이름이 보이지 않는다 (익명 "플레이어 n")
  await expect(phone.page.getByTestId('lobby')).not.toContainText('컴퓨터');
  await expect(phone.page.getByTestId('quick-people')).toContainText(/플레이어 [1-4]/);
  await expect(phone.page.getByTestId('quick-people')).toContainText('휴대폰');
  // 약 2초 뒤 자동 시작
  await expect.poll(async () => (await state(pc.page)).phase, { timeout: 8000 }).toBe('playing');
  await expect.poll(async () => (await state(phone.page)).phase, { timeout: 8000 }).toBe('playing');
  const waited = (Date.now() - t0) / 1000;
  expect(waited).toBeGreaterThan(WAIT_S - 0.5);
  expect(waited).toBeLessThan(WAIT_S + 6);
  expect((await state(pc.page)).role).toBe('monster');
  expect(['runner', 'guard', 'scout']).toContain((await state(phone.page)).role);
  // 서버 정답: 4자리 중 봇 2
  const res = await pc.page.request.get(`${base}/test/state?room=${a.room}`);
  const truth = (await res.json()) as { players: { id: string; role: string }[] };
  expect(truth.players).toHaveLength(4);
  // 판을 끝낸다 → 두 화면 결과, 봇 표시는 결과에서만
  await pc.page.evaluate(() => window.__DECOY__?.sendTest({ kind: 'setTime', timeLeft: 0.1 }));
  await expect(pc.page.getByTestId('result')).toBeVisible({ timeout: 10_000 });
  await expect(phone.page.getByTestId('result')).toBeVisible({ timeout: 10_000 });
  await expect(pc.page.getByTestId('result-bot')).toHaveCount(2);
  await expect(phone.page.getByTestId('result-bot')).toHaveCount(2);
  await expect(phone.page.getByTestId('result')).not.toContainText('컴퓨터');
  await expect(pc.page.getByTestId('result')).toContainText('컴퓨터');
  // 홈으로: 두 화면 모두 첫 화면 (자리를 비우고 같은 연결로)
  await press(pc.page.getByTestId('result-home'));
  await press(phone.page.getByTestId('result-home'));
  await expect(pc.page.getByTestId('quick-match')).toBeEnabled();
  await expect(phone.page.getByTestId('quick-match')).toBeEnabled();
  expect(pc.page.url()).not.toContain('room=');
  expect(pc.problems).toEqual([]);
  expect(phone.problems).toEqual([]);
  await pc.context.close();
  await phone.context.close();
  // 서버 로그에 닉네임이 없다
  const log = server.output.join('');
  expect(log).toContain('판 시작 (quick, 사람 2 · 봇 2)');
  expect(log).not.toContain('컴퓨터');
  expect(log).not.toContain('휴대폰');
});

test('대기 중 화면을 숨기면 대기열에서 빠지고, 돌아오면 "대기열에서 빠졌어요 — 다시 찾기"로 다시 들어간다', async ({
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
  await page.goto(`${base}/?debug=hook&renderer=canvas`);
  await page.getByTestId('quick-match').click();
  await expect(page.getByTestId('quick-count')).toContainText('1/4');
  const first = (await state(page)).room;
  const setVisible = (on: boolean): Promise<void> =>
    page.evaluate(
      (v) => (window as unknown as { __e2eSetVisible: (on: boolean) => void }).__e2eSetVisible(v),
      on,
    );
  await setVisible(false);
  // 숨긴 동안 대기 시간이 지나도 이 자리로 판이 시작되지 않는다 (서버에서 자리가 지워졌다)
  await page.waitForTimeout((WAIT_S + 1) * 1000);
  await setVisible(true);
  await expect(page.getByTestId('quick-dropped')).toBeVisible();
  await expect(page.getByTestId('quick-dropped')).toContainText('대기열에서 빠졌어요');
  expect((await state(page)).phase).toBeNull();
  // 그 방에서는 판이 시작되지 않았다 (정답 상태 없음)
  const res = await page.request.get(`${base}/test/state?room=${first}`);
  expect(await res.json()).toBeNull();
  // 다시 찾기 → 새 대기 방, 혼자면 2초 뒤 봇 셋과 시작
  await page.getByTestId('quick-retry').click();
  await expect(page.getByTestId('quick-count')).toContainText('1/4');
  await expect.poll(async () => (await state(page)).phase, { timeout: 8000 }).toBe('playing');
  expect(problems).toEqual([]);
  await context.close();
});

test('휴대폰 빠른 매칭 판의 뒤로 가기 확인은 "바로 판에서 빠져요"(30초 유예 안내 없음), 나가기면 첫 화면', async ({
  browser,
}) => {
  const { context, page, problems } = await newPlayerPage(browser, dpr1(PHONE_LANDSCAPE));
  await page.goto(`${base}/?debug=hook&renderer=canvas`);
  await press(page.getByTestId('quick-match'));
  await expect.poll(async () => (await state(page)).phase, { timeout: 10_000 }).toBe('playing');
  // 뒤로 가기 항목은 판 안 첫 탭(사용자 활성화)에서 넣는다
  const zone = centerOf(await waitForTouchTarget(page, 'move-zone'));
  const t = await MultiTouch.attach(page);
  await t.tap(1, zone.x, zone.y);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __DECOY_LIFE__?: { guarding: boolean } }).__DECOY_LIFE__?.guarding ?? false,
      ),
    )
    .toBe(true);
  await page.goBack({ waitUntil: 'commit' });
  const dialog = page.getByTestId('leave-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(APP_TEXT.leaveBodyQuick);
  await expect(dialog).not.toContainText('30초');
  await press(page.getByTestId('leave-go'));
  await expect(page.getByTestId('quick-match')).toBeVisible();
  expect((await state(page)).phase).toBeNull();
  expect(page.url()).not.toContain('room=');
  await t.detach();
  expect(problems).toEqual([]);
  await context.close();
});

test('빠른 매칭 대기 취소 직후 늦게 온 대기 화면 갱신(떠난 방)은 버린다: 첫 화면 그대로, 유령 대기 화면 없음', async ({
  browser,
}) => {
  // 대기 시간이 긴 기본 balance(자동 시작이 끼지 않게)
  const slow = await startServer(['--test-hooks']);
  const slowBase = `http://127.0.0.1:${slow.port}`;
  const a = await newPlayerPage(browser);
  const b = await newPlayerPage(browser);
  try {
    // A는 왕복 2초 지연(받는 쪽 1초): 서버가 A의 나가기를 받기 전에 보낸 갱신이 A의 취소 뒤에 처리된다
    await a.page.goto(`${slowBase}/?debug=hook&renderer=canvas&lag=2000`);
    await b.page.goto(`${slowBase}/?debug=hook&renderer=canvas`);
    await expect(a.page.getByTestId('quick-match')).toBeEnabled();
    await expect(b.page.getByTestId('quick-match')).toBeEnabled();
    await a.page.getByTestId('quick-match').click();
    await expect(a.page.getByTestId('quick-count')).toContainText('1/4');
    await b.page.getByTestId('quick-match').click();
    await expect(a.page.getByTestId('quick-count')).toContainText('2/4');
    // B가 역할을 고르고 곧바로 A가 취소: B의 역할 갱신(2/4)이 A에게 가는 중에 A는 첫 화면으로 간다
    await b.page.getByTestId('role-runner').click();
    await a.page.getByTestId('quick-cancel').click();
    await expect(a.page.getByTestId('quick-match')).toBeVisible();
    // 받는 지연(1초)이 지나 늦은 갱신이 처리된 뒤에도 첫 화면이다 (옛 코드: 떠난 방 대기 화면 '2/4명'이 다시 그려졌다)
    await a.page.waitForTimeout(2500);
    await expect(a.page.getByTestId('quick-count')).toHaveCount(0);
    await expect(a.page.getByTestId('quick-match')).toBeVisible();
    expect((await state(a.page)).phase).toBeNull();
    // 서버에서는 A의 자리가 지워졌다
    await expect(b.page.getByTestId('quick-count')).toContainText('1/4');
    expect(a.problems).toEqual([]);
    expect(b.problems).toEqual([]);
  } finally {
    await a.context.close();
    await b.context.close();
    await slow.stop();
  }
});

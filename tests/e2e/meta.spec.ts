// 판 밖 성장 · 보상 (GAME_DESIGN 12장, docs/META_PLAN.md): 판 평가 · 경험치 · 레벨 · 기기 저장 · 정보 숨김 · 결과 조각 나눠 받기
import { expect, test, type Page } from '@playwright/test';
import {
  MONSTER_EMBLEMS,
  SURVIVOR_EMBLEMS,
  type MatchRating,
  type Role,
  type ServerMessage,
} from '@decoy/shared';
import { collectFrames } from './frames';
import {
  BASE_QUERY,
  closeAll,
  createRoom,
  joinRoom,
  myId,
  newPlayerPage,
  pickRoleAndReady,
  press,
  sendTest,
  waitForSnapshots,
  type Player,
} from './helpers';

const KEY = 'decoy:progress';

/** 봇과 연습을 그 역할로 시작해 첫 스냅샷까지 */
async function startPractice(page: Page, role: Role, query = ''): Promise<void> {
  await page.goto(`/?${BASE_QUERY.slice(1)}${query}`);
  await page.getByTestId('practice').click();
  await page.getByTestId(`practice-role-${role}`).click();
  await waitForSnapshots(page, 3);
}

/** 연습 판을 생존자 승리로 끝낸다 (나 · 하나 탈출, 하나 사망, 판 길이 5분) */
async function survivorsWin(page: Page): Promise<void> {
  const ids = await page.evaluate(() => {
    const t = window.__DECOY__!.getTruth!();
    return t ? t.players.filter((p) => p.role !== 'monster').map((p) => p.id) : [];
  });
  const me = await myId(page);
  const others = ids.filter((i) => i !== me);
  await sendTest(page, { kind: 'setTime', timeLeft: 400, elapsed: 300 });
  await sendTest(page, { kind: 'setSurvivor', target: me, status: 'escaped' });
  await sendTest(page, { kind: 'setSurvivor', target: others[0]!, status: 'escaped' });
  await sendTest(page, { kind: 'setSurvivor', target: others[1]!, status: 'dead' });
}

async function storedXp(page: Page): Promise<number | null> {
  return page.evaluate((k) => {
    const t = localStorage.getItem(k);
    return t ? (JSON.parse(t) as { xp: number }).xp : null;
  }, KEY);
}

test('봇과 연습: 판이 끝나면 내 평가 넷 · 경험치 · 레벨 업, 기기에 저장되고 첫 화면 레벨 칩이 다시 열어도 그대로', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const { context, page, problems } = await newPlayerPage(browser);
  await page.goto(`/?${BASE_QUERY.slice(1)}`);
  await expect(page.getByTestId('level-num')).toHaveText('1');
  await startPractice(page, 'runner');
  await survivorsWin(page);
  await expect(page.getByTestId('result')).toBeVisible({ timeout: 15_000 });
  const rating = page.getByTestId('rating');
  await expect(rating).toBeVisible({ timeout: 15_000 });
  for (const id of SURVIVOR_EMBLEMS) await expect(page.getByTestId(`rate-${id}`)).toBeVisible();
  // 탈출 + 판 내내 자유 → 생존 단계가 있다 (모양 · 칸 수 · 글자)
  const survive = page.getByTestId('rate-survive');
  expect(Number(await survive.getAttribute('data-tier'))).toBeGreaterThanOrEqual(3);
  await expect(survive.locator('.pip.on')).toHaveCount(Number(await survive.getAttribute('data-tier')));
  await expect(page.getByTestId('xp-gain')).toContainText('경험치 +');
  await expect(page.getByTestId('level-up')).toContainText('Lv 2');
  const xp = await storedXp(page);
  expect(xp).toBeGreaterThan(100);
  // 결과 화면을 다시 받아도(재접속 등) 두 번 주지 않는다: 같은 판 ID는 저장 기록에 하나
  const recent = await page.evaluate(
    (k) => (JSON.parse(localStorage.getItem(k) ?? '{}') as { recent: string[] }).recent,
    KEY,
  );
  expect(recent).toHaveLength(1);
  await press(page.getByTestId('result-home'));
  await expect(page.getByTestId('level-num')).toHaveText('2');
  await page.reload();
  await expect(page.getByTestId('level-num')).toHaveText('2');
  expect(await storedXp(page)).toBe(xp);
  expect(problems).toEqual([]);
  await context.close();
});

test('저장소가 막혀도(쓰기 실패) 판 · 결과는 그대로이고 "저장하지 못했어요" 한 줄, 콘솔 오류 없음', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const { context, page, problems } = await newPlayerPage(browser);
  // 성장 기록 쓰기만 막는다 (가득 찬 저장소와 같다)
  await context.addInitScript((k) => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string): void {
      if (key === k) throw new DOMException('quota', 'QuotaExceededError');
      set.call(this, key, value);
    };
  }, KEY);
  await startPractice(page, 'guard');
  await survivorsWin(page);
  await expect(page.getByTestId('rating')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('rate-not-saved')).toBeVisible();
  expect(await storedXp(page)).toBeNull();
  // 이번 접속 동안은 레벨이 오른다
  await press(page.getByTestId('result-home'));
  await expect(page.getByTestId('level-num')).toHaveText('2');
  expect(problems).toEqual([]);
  await context.close();
});

test('결과 화면 조각을 받지 못해도(배포 직후 옛 화면) 승리 팀 · 홈으로 · 다시 하기가 있고 "새 버전이 있어요"', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const { context, page, problems } = await newPlayerPage(browser, { serviceWorkers: 'block' });
  await page.route(/\/assets\/result-[^/]*\.js$/, (route) => route.abort());
  await startPractice(page, 'scout');
  await survivorsWin(page);
  await expect(page.getByTestId('result-winner')).toHaveText('생존자 승리', { timeout: 15_000 });
  await expect(page.getByTestId('update-available')).toBeVisible();
  // 평가는 받지 못한 조각과 무관하게 적립된다
  await expect.poll(() => storedXp(page)).toBeGreaterThan(0);
  await press(page.getByTestId('result-home'));
  await expect(page.getByTestId('practice')).toBeVisible();
  // 막은 조각의 실패 기록 · 서비스 워커를 막은 경고(이 시험이 막았다)만 있다
  const expected =
    /Failed to load resource|dynamically imported module|result-|Service Worker registration blocked/;
  expect(problems.filter((p) => !expected.test(p))).toEqual([]);
  await context.close();
});

test('정보 숨김: 판 중 괴물이 받은 모든 메시지(로비 · 판 시작 · 스냅샷)에 평가 · 레벨 칸이 없고, 결과에는 받는 사람 자기 평가만', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const roles: Role[] = ['monster', 'runner', 'guard', 'scout'];
  const players: Player[] = [];
  const frames: ReturnType<typeof collectFrames>[] = [];
  const first = await newPlayerPage(browser);
  frames.push(collectFrames(first.page));
  const code = await createRoom(first.page);
  players.push({ ...first, role: 'monster', id: await myId(first.page) });
  for (let i = 1; i < 4; i += 1) {
    const p = await newPlayerPage(browser);
    frames.push(collectFrames(p.page));
    await joinRoom(p.page, code);
    players.push({ ...p, role: roles[i]!, id: await myId(p.page) });
  }
  for (const p of players) await pickRoleAndReady(p.page, p.role);
  await press(players[0]!.page.getByTestId('start-button'));
  for (const p of players) await waitForSnapshots(p.page, 10);
  await sendTest(players[0]!.page, { kind: 'setTime', timeLeft: 0.1 });
  for (const p of players) await expect(p.page.getByTestId('rating')).toBeVisible({ timeout: 20_000 });

  const META = /"(rating|emblems|xp|level|matchId|stats)"\s*:/;
  players.forEach((p, i) => {
    const raw = frames[i]!.raw;
    const cut = raw.findIndex((t) => (JSON.parse(t) as ServerMessage).t === 'result');
    expect(cut, `${p.role} 결과 받음`).toBeGreaterThan(20);
    const before = raw.slice(0, cut);
    expect(
      before.some((t) => t.includes('"t":"lobby"')) && before.some((t) => t.includes('"t":"match"')),
    ).toBe(true);
    for (const t of before) expect(t, `${p.role} 판 중 메시지`).not.toMatch(META);
    const res = JSON.parse(raw[cut]!) as Extract<ServerMessage, { t: 'result' }>;
    const r = res.rating as MatchRating;
    expect(r.role).toBe(p.role);
    expect(r.emblems.map((e) => e.id)).toEqual(
      p.role === 'monster' ? [...MONSTER_EMBLEMS] : [...SURVIVOR_EMBLEMS],
    );
    // 남의 평가는 결과에도 없다 (평가 칸은 하나)
    expect(raw[cut]!.match(/"emblems"/g)).toHaveLength(1);
  });
  await closeAll(players);
});

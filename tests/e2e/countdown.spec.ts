// 판 시작 카운트다운 (플레이테스트 a-8, GAME_DESIGN 1장): 3 · 2 · 1 → "시작!" 동안 모두 정지, 12분 시계와 괴물 5초 정지는 그 뒤부터.
// 시험 서버(--test-hooks) 방은 카운트다운이 기본 0이라 로비에서 시험 명령 startCountdown으로 켠다. 연습은 ?countdown=1.
//  - 서버 방 4명: 네 화면에 숫자 → 시작!, 그동안 키를 누르고 있어도 서버 자리 불변 · 시계 12:00 · 입력 0, 끝나면 누르고 있던 키로
//    바로 움직이고 괴물은 5초 더 서 있다. 시작 문구는 "시작!" 뒤, 소리는 숫자마다 하나 + 시작 소리
//  - 휴대폰: 누르고 있던 이동 스틱이 "시작!"에 손을 떼지 않고 이어지고, 그사이 탭한 능력은 나가지 않는다. 숫자가 내 캐릭터 ·
//    버튼 · HUD와 겹치지 않는다 (가장 낮은 화면 포함)
//  - 연습 ?countdown=1: 봇이 카운트다운 동안 서 있다 움직이고, 다시 하기 판도 카운트다운. ?debug만 있으면 카운트다운 없음
//  - 카운트다운 중 새로고침: 남은 숫자부터 이어진다
//  - 카운트다운 중 괴물이 끊기면: 남은 값이 멈추고 숫자를 숨긴 채 재접속 대기가 뜬다. 돌아오면 이어서 내려가 시작!
// 숫자가 바뀌는 순간은 시간에 달려 있어 고정 대기 뒤 한 번 읽지 않는다: 페이지 안 기록기(25ms마다 표본)와 서버 정답 기록(틱마다)으로 본다
import { readFileSync } from 'node:fs';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import {
  BTN,
  validateBalance,
  type Balance,
  type HudLayout,
  type Role,
  type TouchTarget,
} from '@decoy/shared';
import { STORY_TEXT, UI_TEXT } from '../../client/src/data/storyText';
import {
  PHONE_LANDSCAPE,
  PHONE_SMALL,
  countPressed,
  createRoom,
  dpr1,
  inputLog,
  joinRoom,
  lastSnapshot,
  myId,
  newPlayerPage,
  pickRoleAndReady,
  press,
  sendTest,
  truthLogSize,
  truthSince,
  type Player,
  type TruthFrame,
} from './helpers';
import { MultiTouch, waitForTouchTarget } from './touch';

const balance: Balance = validateBalance(JSON.parse(readFileSync('config/balance.json', 'utf8')));
const HZ = balance.network.serverTickHz;
const GO = UI_TEXT.countdownGo;
const INTRO = { monster: STORY_TEXT.INTRO_MONSTER.text, survivor: STORY_TEXT.INTRO_WALL.text };
const CLOCK_FULL = `${Math.floor(balance.match.timeLimit / 60)}:00`;
const POLL = { intervals: [100, 150, 200], timeout: 25_000 };

interface CountSample {
  t: number;
  /** 화면의 카운트다운 글자 ('' = 없음) */
  label: string;
  /** 마지막 스냅샷 */
  cd: number;
  timeLeft: number;
  wait: number;
  /** 판 정지(괴물 재접속 대기) 남은 초 (아니면 null) */
  paused: number | null;
  /** HUD: 타이머 글자 · 아래 띠 안내 줄 · 행동 칸 상태 */
  timer: string;
  hint: string;
  slots: string;
  /** 내 예측 자리 */
  pos: string;
  /** 이 판에서 만든 입력 프레임 수 */
  inputs: number;
  banners: string[];
  /** PC 첫 판 조작 안내가 떠 있다 */
  help: boolean;
  /** 기기 안 연습: 모든 자리의 정답 위치 */
  truth: string;
}

/** 페이지 안 기록기 (문서를 열 때마다 새로): 판 스냅샷이 있는 동안 25ms마다 화면 · 스냅샷 · 예측 상태를 적는다 */
function countRecorder(): void {
  const list: unknown[] = [];
  (window as unknown as { __e2eCount: unknown[] }).__e2eCount = list;
  window.setInterval(() => {
    const d = window.__DECOY__;
    const snap = d?.getLastSnapshot();
    if (!d || !snap) return;
    const hud = d.getHud();
    const me = d.getLocalState();
    const truth = d.getTruth();
    const str = (v: unknown): string => (typeof v === 'string' ? v : '');
    list.push({
      t: performance.now(),
      label: str(hud.countdown),
      cd: snap.world.countdown,
      timeLeft: snap.world.timeLeft,
      wait: snap.world.monsterWait,
      paused: snap.world.paused,
      timer: str(hud.timerText),
      hint: str(hud.hint),
      slots: str(hud.slots),
      pos: me ? `${me.x.toFixed(4)},${me.y.toFixed(4)},${me.face.toFixed(4)}` : '',
      inputs: d.getInputLog().length,
      banners: d.getBanners(),
      help: hud.help === true,
      truth: truth ? truth.players.map((p) => `${p.id}:${p.x.toFixed(3)},${p.y.toFixed(3)}`).join(' ') : '',
    });
  }, 25);
}

async function samples(page: Page): Promise<CountSample[]> {
  return page.evaluate(() => (window as unknown as { __e2eCount?: CountSample[] }).__e2eCount?.slice() ?? []);
}

async function clearSamples(page: Page): Promise<void> {
  await page.evaluate(() => {
    const list = (window as unknown as { __e2eCount?: unknown[] }).__e2eCount;
    if (list) list.length = 0;
  });
}

/** 화면에 숫자가 뜰 때까지 (판 장면이 생겨 그리기 시작했다 — 이제 키 · 터치를 받는다). 그 숫자를 돌려준다 */
async function waitDigit(page: Page): Promise<number> {
  const h = await page.waitForFunction(
    () => {
      const v = window.__DECOY__?.getHud().countdown;
      return typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : null;
    },
    null,
    { polling: 30, timeout: 20_000 },
  );
  const n = (await h.jsonValue()) as number;
  await h.dispose();
  return n;
}

/** 기록기가 이 판의 카운트다운(남은 값 > 0인 표본) 뒤에 "시작!"을 볼 때까지 */
async function waitGo(page: Page): Promise<void> {
  await page.waitForFunction(
    (go) => {
      const list = (window as unknown as { __e2eCount?: { label: string; cd: number }[] }).__e2eCount ?? [];
      const from = list.findIndex((s) => s.cd > 0);
      return from >= 0 && list.slice(from).some((s) => s.label === go);
    },
    GO,
    { polling: 50, timeout: 30_000 },
  );
}

/** 이어진 같은 글자를 하나로 (빈 글자 제외) */
function labelsOf(list: readonly CountSample[]): string[] {
  const out: string[] = [];
  for (const s of list) if (s.label !== '' && out.at(-1) !== s.label) out.push(s.label);
  return out;
}

/** seconds초 카운트다운의 온전한 글자 차례: n … 2 · 1 · 시작! */
function fullRun(seconds: number): string[] {
  const out: string[] = [];
  for (let n = seconds; n >= 1; n -= 1) out.push(String(n));
  out.push(GO);
  return out;
}

/**
 * 본 글자 차례가 온전한 차례의 뒷부분이고 적어도 need개(뒤에서부터)를 담고 있는가. 판 장면이 늦게 뜬 탭은 앞 숫자를 놓칠 수 있다
 * (느린 러너) — 빠진 것 없이 이어서 내려가 "시작!"으로 끝나는지를 본다
 */
function expectTail(seen: string[], seconds: number, need: number, label: string): void {
  const full = fullRun(seconds);
  expect(seen.length, `${label}: 본 글자 ${seen.join(' ')}`).toBeGreaterThanOrEqual(need);
  expect(seen, label).toEqual(full.slice(full.length - seen.length));
}

/**
 * 카운트다운 중 표본(스냅샷의 남은 값 > 0)에서: 12분 시계 그대로 · 괴물 대기 그대로 · 내 예측 자리 그대로. 숫자가 보이는 표본(이 판의
 * 장면이 그리고 있다)에서는 타이머 글자 12:00 · 만든 입력 0 · 메모 없음 · 숫자가 남은 초와 맞음. 숫자가 뜬 뒤에는 끝까지 떠 있다
 */
function expectFrozen(list: readonly CountSample[], label: string): CountSample[] {
  const counting = list.filter((s) => s.cd > 0);
  expect(counting.length, `${label}: 카운트다운 표본 수`).toBeGreaterThan(20);
  const pos0 = counting.find((s) => s.pos !== '')?.pos;
  expect(pos0, label).toBeTruthy();
  let digits = 0;
  for (const s of counting) {
    expect(s.timeLeft, label).toBe(balance.match.timeLimit);
    expect(s.wait, label).toBe(balance.match.monsterStartDelay);
    if (s.pos !== '') expect(s.pos, `${label}: 예측 자리`).toBe(pos0);
    if (/^\d+$/.test(s.label)) {
      digits += 1;
      // 숫자 = 남은 초 올림. 표본은 마지막으로 그린 프레임의 글자와 가장 새 스냅샷을 읽으므로 한 칸까지 어긋날 수 있다
      expect(
        Math.abs(Number(s.label) - Math.ceil(s.cd)),
        `${label}: 숫자 ${s.label} · 남은 ${s.cd}`,
      ).toBeLessThanOrEqual(1);
      expect(s.timer, `${label}: 타이머 글자`).toBe(CLOCK_FULL);
      expect(s.inputs, `${label}: 카운트다운 중 만든 입력`).toBe(0);
      // 시작 문구(메모) · 알림은 숫자와 같이 뜨지 않는다
      expect(s.banners, label).toEqual([]);
    } else {
      // 판 장면이 그리기 전에만 비어 있다: "시작!"이 먼저 뜨거나, 숫자가 떴다가 빠지지 않는다 (판 정지 없음)
      expect(s.label, label).toBe('');
      expect(digits, `${label}: 숫자가 뜬 뒤 빈 표본`).toBe(0);
    }
  }
  expect(digits, `${label}: 숫자가 보인 표본 수`).toBeGreaterThan(20);
  return counting;
}

/** 소리 기록: 본 숫자마다 count 하나(장면이 뜬 직후 바뀐 숫자는 표본이 놓칠 수 있어 하나 더까지) 뒤에 go 하나 */
async function expectSounds(page: Page, seenLabels: readonly string[], label: string): Promise<void> {
  const sounds = (await page.evaluate(() => window.__DECOY__?.getSounds() ?? [])).filter(
    (s) => s === 'count' || s === 'go',
  );
  const digits = seenLabels.length - 1;
  expect(sounds.at(-1), `${label}: ${sounds.join(' ')}`).toBe('go');
  expect(sounds.filter((s) => s === 'go').length, label).toBe(1);
  expect([digits, digits + 1], `${label}: count ${sounds.length - 1}번`).toContain(sounds.length - 1);
}

async function addRecorder(context: BrowserContext): Promise<void> {
  await context.addInitScript(countRecorder);
}

const moved = (f: TruthFrame, base: TruthFrame, id: string): boolean => {
  const a = f.players.find((p) => p.id === id);
  const b = base.players.find((p) => p.id === id);
  return a !== undefined && b !== undefined && Math.hypot(a.x - b.x, a.y - b.y) > 1e-6;
};

test('서버 방 4명: 숫자 → 시작! 동안 키를 눌러도 모두 정지 · 12:00 유지, 끝나면 누르던 키로 바로 움직이고 괴물은 5초 더 서 있다', async ({
  browser,
}) => {
  test.setTimeout(150_000);
  // 탭 4개가 판 장면을 만드는 시간을 넉넉히: 5초로 켜고 끝의 3 · 2 · 1 · 시작!을 본다
  const SECONDS = 5;
  const COUNT_TICKS = SECONDS * HZ;
  const WAIT_TICKS = Math.round(balance.match.monsterStartDelay * HZ);
  const roles: Role[] = ['monster', 'runner', 'guard', 'scout'];
  const KEY: Record<string, string> = { monster: 'KeyW', runner: 'KeyS', guard: 'KeyS', scout: 'KeyS' };
  const players: Player[] = [];
  const first = await newPlayerPage(browser);
  await addRecorder(first.context);
  const code = await createRoom(first.page);
  players.push({ ...first, role: 'monster', id: await myId(first.page) });
  for (let i = 1; i < roles.length; i += 1) {
    const p = await newPlayerPage(browser);
    await addRecorder(p.context);
    await joinRoom(p.page, code);
    players.push({ ...p, role: roles[i]!, id: await myId(p.page) });
  }
  for (const p of players) await pickRoleAndReady(p.page, p.role);
  const host = players[0]!;
  // 로비에서 시험 명령 (방장이 아닌 사람이 보내도 된다): 다음 판 하나의 카운트다운
  await sendTest(players[2]!.page, { kind: 'startCountdown', seconds: SECONDS });
  await expect(host.page.getByTestId('start-button')).toBeEnabled();
  const offset = truthLogSize();
  await press(host.page.getByTestId('start-button'));

  // 판 장면이 뜨는 대로(숫자가 보인다) 모두 이동 키를 누르고 있는다 — 끝까지 떼지 않는다
  await Promise.all(
    players.map(async (p) => {
      await waitDigit(p.page);
      await p.page.keyboard.down(KEY[p.role]!);
    }),
  );
  // 생존자 하나는 능력도 눌러 둔다 (카운트다운 중 누른 능력은 시작 순간 나가지 않는다)
  const runner = players.find((p) => p.role === 'runner')!;
  await runner.page.keyboard.press('Space');
  // 전제: 키를 누른 뒤에도 카운트다운이 1초 넘게 남았다 (아니면 '눌러도 정지'를 본 것이 아니다)
  for (const p of players)
    expect(
      (await lastSnapshot(p.page))?.world.countdown,
      `${p.role}: 키를 누른 뒤 남은 카운트다운`,
    ).toBeGreaterThan(1);

  // 첫 판 조작 안내: "시작!" 뒤에는 새로 누른 키 하나에 닫힌다 (가드만, 시작! 직후 — 아무 동작이 없는 키. 나머지 셋은 누르지 않고 시간을 본다)
  const guard = players.find((p) => p.role === 'guard')!;
  let keyAt = Number.NaN;
  await Promise.all(
    players.map(async (p) => {
      await waitGo(p.page);
      if (p !== guard) return;
      keyAt = await p.page.evaluate(() => performance.now());
      await p.page.keyboard.press('KeyZ');
    }),
  );
  // "시작!" 직후: 첫 입력 프레임(seq 1)부터 누르고 있던 방향이다 (다시 누르지 않았다)
  for (const p of players) {
    const log = await inputLog(p.page);
    const f1 = log.find((e) => e.seq === 1);
    expect(f1, `${p.role}: 첫 입력 프레임`).toBeDefined();
    expect(f1!.my, `${p.role}: 첫 입력의 이동`).toBe(p.role === 'monster' ? -1 : 1);
    expect(countPressed(log, BTN.ABILITY), `${p.role}: 능력 누름`).toBe(0);
  }

  // 서버 정답 (틱마다): 괴물이 움직일 때까지 기다린 뒤 판 시작부터 읽는다
  await expect
    .poll(() => {
      const fr = truthSince(offset, code);
      const base = fr[0];
      const last = fr.at(-1);
      return base !== undefined && last !== undefined && moved(last, base, host.id);
    }, POLL)
    .toBe(true);
  const frames = truthSince(offset, code);
  const base = frames[0]!;
  expect(base.tick).toBe(1);
  // 카운트다운 150틱 동안 네 사람 모두 자리 · 방향이 그대로다
  const still = (f: TruthFrame): string =>
    f.players.map((p) => `${p.id}:${p.x},${p.y},${p.face},${p.status}`).join(' ');
  const during = frames.filter((f) => f.tick <= COUNT_TICKS);
  expect(during.length).toBe(COUNT_TICKS);
  for (const f of during) expect(still(f), `틱 ${f.tick}`).toBe(still(base));
  const firstMove = (id: string): number => frames.find((f) => moved(f, base, id))?.tick ?? -1;
  for (const p of players.filter((q) => q.role !== 'monster')) {
    const tick = firstMove(p.id);
    // 끝난 뒤 곧 (입력이 닿는 왕복 지연 + 느린 러너 여유 3초), 키를 다시 누르지 않고
    expect(tick, `${p.role}: 서버에서 처음 움직인 틱`).toBeGreaterThan(COUNT_TICKS);
    expect(tick, `${p.role}: 서버에서 처음 움직인 틱`).toBeLessThanOrEqual(COUNT_TICKS + 3 * HZ);
  }
  // 괴물 시작 정지 5초는 카운트다운 뒤부터 그대로: 판이 흐른 150틱이 지나야 움직인다
  expect(firstMove(host.id), '괴물이 서버에서 처음 움직인 틱').toBeGreaterThan(COUNT_TICKS + WAIT_TICKS);

  for (const p of players) {
    const list = await samples(p.page);
    const label = p.role;
    expectFrozen(list, label);
    expectTail(labelsOf(list), SECONDS, 4, label);
    // 숫자마다 소리 하나 + 시작 소리 하나
    await expectSounds(p.page, labelsOf(list), label);
    // 시작 문구는 "시작!"이 사라진 뒤에 뜬다 (같은 자리)
    const intro = p.role === 'monster' ? INTRO.monster : INTRO.survivor;
    await expect
      .poll(async () => (await samples(p.page)).some((s) => s.banners.includes(intro)), POLL)
      .toBe(true);
    // 첫 판 조작 안내 (PC 첫 판): 카운트다운 중에는 이동 키 · 능력 키를 눌러도 닫히지 않고 표시 시간도 세지 않는다 → "시작!"부터 5초
    await p.page.waitForFunction(() => window.__DECOY__?.getHud().help === false, null, {
      polling: 50,
      timeout: 15_000,
    });
    const all = await samples(p.page);
    const firstGo = all.find((s) => s.label === GO)!.t;
    const lastGo = all.filter((s) => s.label === GO).at(-1)!.t;
    const digitSamples = all.filter((s) => /^\d+$/.test(s.label));
    expect(digitSamples[0]?.help, `${label}: 판 장면이 숫자를 처음 그린 때 조작 안내`).toBe(true);
    expect(
      digitSamples.filter((s) => !s.help).length,
      `${label}: 카운트다운 중 조작 안내가 닫힌 표본 (키를 누른 뒤)`,
    ).toBe(0);
    const closedAt = all.find((s) => s.t > firstGo && !s.help)!.t;
    if (p === guard) {
      // "시작!" 뒤 새 키에 닫힌다 (5초가 다 되기 전에)
      expect(closedAt, `${label}: 키를 누른 뒤 조작 안내가 닫힌 때`).toBeGreaterThanOrEqual(keyAt);
      expect(closedAt - firstGo, `${label}: "시작!"부터 조작 안내가 닫힌 때 (ms)`).toBeLessThan(4000);
    } else {
      // 판 장면을 만든 때부터 셌으면(숫자 3을 본 장면은 "시작!" 2초 넘게 전에 생겼다) 시작 뒤 3초 안에 닫힌다
      expect(closedAt - firstGo, `${label}: "시작!"부터 조작 안내가 닫힌 때 (ms)`).toBeGreaterThan(3500);
    }
    const firstIntro = all.find((s) => s.banners.includes(intro))!.t;
    expect(firstIntro, `${label}: 시작 문구가 뜬 때`).toBeGreaterThan(lastGo);
    expect(
      all.filter((s) => s.label !== '' && s.banners.length > 0),
      `${label}: 글자와 메모가 같이 뜬 표본`,
    ).toEqual([]);
    // 카운트다운이 끝나면 시계가 줄고 입력이 나간다
    const after = all.at(-1)!;
    expect(after.cd).toBe(0);
    expect(after.timeLeft).toBeLessThan(balance.match.timeLimit);
    expect(after.inputs).toBeGreaterThan(0);
  }
  // 괴물 화면: 카운트다운 동안 행동 칸은 모두 못 씀 · 대기 안내 줄 없음, "시작!" 뒤에 "괴물이 깨어나기까지 n초"
  const mon = await samples(host.page);
  for (const s of mon.filter((q) => q.cd > 0 && /^\d+$/.test(q.label))) {
    expect(s.hint, '괴물 대기 안내 (카운트다운 중)').toBe('');
    expect(s.slots.split(',').map((x) => x.split(':')[1])).toEqual([
      'blocked',
      'blocked',
      'blocked',
      'blocked',
    ]);
  }
  expect(mon.some((s) => s.cd === 0 && s.wait > 0 && s.hint.startsWith(UI_TEXT.monsterWait))).toBe(true);
  // 러너: 카운트다운 중 누른 능력이 시작 뒤에도 나가지 않았다
  const rs = (await lastSnapshot(runner.page))!;
  expect(rs.you.surv?.abilityCd).toBe(0);
  expect(rs.you.surv?.abilityActive).toBe(0);
  for (const p of players) {
    await p.page.keyboard.up(KEY[p.role]!);
    expect(p.problems, p.role).toEqual([]);
    await p.context.close();
  }
});

/** 사각형 겹침 (CSS px) */
function overlaps(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

interface ScreenProbe {
  layout: HudLayout | null;
  targets: TouchTarget[];
  me: { x: number; y: number } | null;
  label: string;
}

/** 화면에 want 글자가 뜬 그 프레임의 HUD 배치 · 터치 대상 · 내 캐릭터 화면 자리 (want = null이면 아무 숫자) */
async function probeAt(page: Page, want: string | null): Promise<ScreenProbe> {
  return page.evaluate(
    (w) =>
      new Promise<ScreenProbe>((resolve, reject) => {
        const until = performance.now() + 20_000;
        const tick = (): void => {
          const d = window.__DECOY__;
          const label = d?.getHud().countdown;
          if (d && typeof label === 'string' && (w === null ? /^\d+$/.test(label) : label === w)) {
            const st = d.getLocalState();
            resolve({
              layout: d.getHudLayout(),
              targets: d.getTouchTargets(),
              me: st ? d.tileToClient(st.x, st.y) : null,
              label,
            });
          } else if (performance.now() > until)
            reject(new Error(`카운트다운 글자 ${w ?? '숫자'}가 뜨지 않았다`));
          else requestAnimationFrame(tick);
        };
        tick();
      }),
    want,
  );
}

/** 카운트다운 글자가 맵 안 · 읽히는 크기이고 내 캐릭터 · 터치 버튼 · 다른 HUD 부품과 겹치지 않는다 */
function expectClear(p: ScreenProbe, label: string): void {
  const layout = p.layout;
  expect(layout, label).not.toBeNull();
  const cd = layout!.items.find((i) => i.id === 'countdown');
  expect(cd, `${label}: 카운트다운 글자`).toBeDefined();
  expect(cd!.text, label).toBe(p.label);
  // 글자 크기: 터치 CSS 40px 이상 (메모 글자 14px의 3.4배)
  expect(cd!.fontPx ?? 0, `${label}: 글자 크기`).toBeGreaterThanOrEqual(40);
  const map = layout!.map;
  expect(cd!.x, label).toBeGreaterThanOrEqual(map.x);
  expect(cd!.x + cd!.w, label).toBeLessThanOrEqual(map.x + map.w);
  expect(cd!.y, label).toBeGreaterThanOrEqual(map.y);
  // 내 캐릭터 (몸 반지름쯤 여유 12px)
  expect(p.me, label).not.toBeNull();
  const body = { x: p.me!.x - 12, y: p.me!.y - 12, w: 24, h: 24 };
  expect(overlaps(cd!, body), `${label}: 내 캐릭터와 겹침 ${JSON.stringify([cd, p.me])}`).toBe(false);
  // 터치 버튼 · 스틱 (이동 영역은 화면 왼쪽을 덮는 입력 영역이라 뺀다)
  for (const t of p.targets.filter((q) => q.id !== 'move-zone'))
    expect(overlaps(cd!, t), `${label}: ${t.id}와 겹침`).toBe(false);
  for (const i of layout!.items.filter((q) => q !== cd))
    expect(overlaps(cd!, i), `${label}: HUD ${i.id}(${i.text ?? ''})와 겹침`).toBe(false);
}

test('휴대폰: 누르고 있던 이동 스틱이 "시작!"에 손을 떼지 않고 이어지고, 그사이 탭한 능력은 나가지 않는다. 숫자는 캐릭터 · 버튼 · HUD와 겹치지 않는다', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const SECONDS = 5;
  const COUNT_TICKS = SECONDS * HZ;
  const { context, page, problems } = await newPlayerPage(browser, dpr1(PHONE_LANDSCAPE));
  await addRecorder(context);
  const code = await createRoom(page, '&bots=1');
  await pickRoleAndReady(page, 'runner');
  await sendTest(page, { kind: 'startCountdown', seconds: SECONDS });
  const me = await myId(page);
  const offset = truthLogSize();
  await press(page.getByTestId('start-button'));
  await waitDigit(page);
  // 숫자가 뜬 화면: 겹침 없음
  expectClear(await probeAt(page, null), '숫자');
  const zone = await waitForTouchTarget(page, 'move-zone');
  const ability = await waitForTouchTarget(page, 'ability');
  const t = await MultiTouch.attach(page);
  // 왼손: 이동 스틱을 아래로 끌어 누르고 있는다 (감옥 문 쪽)
  const z = { x: zone.x + zone.w * 0.5, y: zone.y + zone.h * 0.35 };
  await t.down(1, z.x, z.y);
  await t.move(1, z.x, z.y + 90, { steps: 5, stepMs: 20 });
  // 오른손: 능력 버튼을 탭 (카운트다운 중이라 나가지 않아야 한다)
  await t.tap(2, ability.x + ability.w / 2, ability.y + ability.h / 2, 60);
  expect((await lastSnapshot(page))?.world.countdown, '스틱을 누른 뒤 남은 카운트다운').toBeGreaterThan(1);

  // "시작!"이 뜬 프레임(튐 연출로 가장 클 때)에도 겹침 없음
  expectClear(await probeAt(page, GO), '시작!');
  await waitGo(page);
  // 손을 떼지 않았는데 서버에서 아래로 걷는다
  await expect
    .poll(() => {
      const fr = truthSince(offset, code);
      const a = fr[0]?.players.find((p) => p.id === me);
      const b = fr.at(-1)?.players.find((p) => p.id === me);
      return a !== undefined && b !== undefined ? b.y - a.y : 0;
    }, POLL)
    .toBeGreaterThan(1);
  expect(t.active).toEqual([1]);
  const log = await inputLog(page);
  const f1 = log.find((e) => e.seq === 1);
  expect(f1, '첫 입력 프레임').toBeDefined();
  expect(f1).toMatchObject({ mx: 0, my: 1, mode: 'touch', pressed: 0 });
  expect(countPressed(log, BTN.ABILITY)).toBe(0);
  const snap = (await lastSnapshot(page))!;
  expect(snap.you.surv?.abilityCd).toBe(0);
  expect(snap.you.surv?.abilityActive).toBe(0);

  // 서버 정답: 카운트다운 틱 동안 나도 봇 셋도 제자리 (봇은 입력을 보내지 않는다)
  const frames = truthSince(offset, code);
  const base = frames[0]!;
  const during = frames.filter((f) => f.tick <= COUNT_TICKS);
  expect(during.length).toBe(COUNT_TICKS);
  for (const f of during)
    for (const p of f.players) expect(moved(f, base, p.id), `틱 ${f.tick} ${p.id}`).toBe(false);
  const list = await samples(page);
  expectFrozen(list, '휴대폰');
  expectTail(labelsOf(list), SECONDS, 4, '휴대폰');
  await t.detach();
  expect(problems).toEqual([]);
  await context.close();
});

test('가장 낮은 휴대폰 화면(802×293) 괴물: 숫자와 "시작!"이 캐릭터 · 버튼 · 미니맵 · HUD와 겹치지 않는다', async ({
  browser,
}) => {
  const { context, page, problems } = await newPlayerPage(browser, dpr1(PHONE_SMALL));
  await addRecorder(context);
  await createRoom(page, '&bots=1');
  await pickRoleAndReady(page, 'monster');
  await sendTest(page, { kind: 'startCountdown', seconds: 4 });
  await press(page.getByTestId('start-button'));
  expectClear(await probeAt(page, null), '숫자');
  expectClear(await probeAt(page, GO), '시작!');
  await waitGo(page);
  expectTail(labelsOf(await samples(page)), 4, 3, '낮은 화면');
  expect(problems).toEqual([]);
  await context.close();
});

/** 기기 안 연습을 시작한다 (첫 화면 → 봇과 연습 → 역할) */
async function startPractice(page: Page, query: string, role: Role): Promise<void> {
  await page.goto(`/?debug=hook&renderer=canvas${query}`);
  await press(page.getByTestId('practice'));
  await press(page.getByTestId(`practice-role-${role}`));
  await expect.poll(() => page.evaluate(() => window.__DECOY__?.phase), POLL).toBe('playing');
}

/** 정답 글자("id:x,y …")에서 base보다 dist타일 넘게 움직인 자리 수 (me 제외) */
function movedSeats(now: string, base: string, me: string, dist: number): number {
  const parse = (s: string): Map<string, [number, number]> =>
    new Map(
      s.split(' ').map((e) => {
        const [id, xy] = e.split(':');
        const [x, y] = (xy ?? '').split(',').map(Number);
        return [id ?? '', [x ?? 0, y ?? 0]];
      }),
    );
  const a = parse(base);
  let n = 0;
  for (const [id, [x, y]] of parse(now)) {
    const o = a.get(id);
    if (id !== me && o && Math.hypot(x - o[0], y - o[1]) > dist) n += 1;
  }
  return n;
}

test('연습 ?countdown=1: 3 · 2 · 1 · 시작! 동안 봇이 서 있다가 움직이고, 다시 하기 판도 카운트다운을 한다', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const SECONDS = balance.match.startCountdown;
  const { context, page, problems } = await newPlayerPage(browser);
  await addRecorder(context);
  await startPractice(page, '&countdown=1', 'runner');
  expect(await page.evaluate(() => window.__DECOY__?.transport)).toBe('local');
  const me = await myId(page);
  await waitGo(page);
  const list = await samples(page);
  const counting = expectFrozen(list, '연습');
  // 수치 그대로 3초: 3 · 2 · 1 · 시작! (판 장면이 늦게 뜨면 3은 놓칠 수 있다 — 2부터는 반드시)
  expectTail(labelsOf(list), SECONDS, 3, '연습');
  expect(list.find((s) => s.cd > 0)!.cd).toBeGreaterThan(SECONDS - 1.5);
  // 기기 안 정답: 카운트다운 동안 봇 셋 · 나 모두 제자리
  const base = counting[0]!.truth;
  expect(base.split(' ').length).toBe(balance.match.players);
  for (const s of counting) expect(s.truth, '카운트다운 중 정답 자리').toBe(base);
  // 끝나면 생존자 봇 둘이 움직인다 (괴물 봇은 5초 더 대기)
  await expect
    .poll(async () => movedSeats((await samples(page)).at(-1)!.truth, base, me, 1), POLL)
    .toBeGreaterThanOrEqual(2);

  // 판을 끝내고 다시 하기: 두 번째 판도 카운트다운. "시작!"이 사라진 뒤에 끝낸다 (결과 화면에서는 판 장면이 그리지 않아
  // 떠 있던 글자가 그대로 읽힌다)
  await expect.poll(() => page.evaluate(() => window.__DECOY__?.getHud().countdown), POLL).toBe('');
  await sendTest(page, { kind: 'setTime', timeLeft: 0.1 });
  await expect(page.getByTestId('result')).toBeVisible({ timeout: 15_000 });
  await clearSamples(page);
  await press(page.getByTestId('rematch'));
  await expect(page.getByTestId('result')).toBeHidden();
  await waitGo(page);
  const second = await samples(page);
  expectFrozen(second, '다시 하기');
  expectTail(labelsOf(second), SECONDS, 3, '다시 하기');
  expect(problems).toEqual([]);
  await context.close();
});

test('연습 ?debug만 있으면 카운트다운이 없다 (기존 시험이 가정하는 판 시작 직후)', async ({ browser }) => {
  const { context, page, problems } = await newPlayerPage(browser);
  await addRecorder(context);
  await startPractice(page, '', 'runner');
  await expect.poll(async () => (await samples(page)).length, POLL).toBeGreaterThan(40);
  const list = await samples(page);
  for (const s of list) {
    expect(s.cd).toBe(0);
    expect(s.label).toBe('');
  }
  // 첫 표본부터 시계가 흐른다
  expect(list.at(-1)!.timeLeft).toBeLessThan(balance.match.timeLimit - 0.5);
  expect(
    (await page.evaluate(() => window.__DECOY__?.getSounds() ?? [])).filter((s) => s === 'count'),
  ).toEqual([]);
  expect(problems).toEqual([]);
  await context.close();
});

test('카운트다운 중 새로고침: 같은 자리로 돌아와 남은 숫자부터 이어진다', async ({ browser }) => {
  test.setTimeout(120_000);
  const SECONDS = 9;
  const { context, page, problems } = await newPlayerPage(browser);
  await addRecorder(context);
  await createRoom(page, '&bots=1');
  await pickRoleAndReady(page, 'guard');
  await sendTest(page, { kind: 'startCountdown', seconds: SECONDS });
  const me = await myId(page);
  await press(page.getByTestId('start-button'));
  const seenBefore = await waitDigit(page);
  const before = (await lastSnapshot(page))!.world.countdown;
  expect(before).toBeGreaterThan(3);
  await page.reload();
  // 돌아온 첫 표본: 남은 값이 0보다 크고 떠나기 전보다 작다 (처음부터 다시 세지 않는다)
  await expect.poll(async () => (await samples(page)).length, POLL).toBeGreaterThan(0);
  expect(await myId(page)).toBe(me);
  const firstBack = (await samples(page))[0]!;
  expect(firstBack.cd).toBeGreaterThan(0);
  expect(firstBack.cd).toBeLessThan(before);
  expect(firstBack.timeLeft).toBe(balance.match.timeLimit);
  const digit = await waitDigit(page);
  expect(digit).toBeLessThanOrEqual(seenBefore);
  await waitGo(page);
  const list = await samples(page);
  expectFrozen(list, '재접속');
  // 돌아온 화면의 글자: 남은 숫자부터 빠짐없이 내려가 시작!
  const seen = labelsOf(list);
  expectTail(seen, SECONDS, 2, '재접속');
  expect(Number(seen[0])).toBeLessThanOrEqual(seenBefore);
  // 소리도 돌아온 뒤 본 숫자만큼만 (지난 숫자의 소리를 몰아서 내지 않는다)
  await expectSounds(page, seen, '재접속');
  expect(problems).toEqual([]);
  await context.close();
});

test('카운트다운 중 괴물이 끊기면 남은 값이 멈추고 숫자 대신 재접속 대기가 뜬다. 돌아오면 남은 숫자부터 이어져 시작!', async ({
  browser,
}) => {
  test.setTimeout(150_000);
  const SECONDS = 8;
  const m = await newPlayerPage(browser);
  await addRecorder(m.context);
  const code = await createRoom(m.page, '&bots=1');
  const r = await newPlayerPage(browser);
  await addRecorder(r.context);
  await joinRoom(r.page, code);
  await pickRoleAndReady(m.page, 'monster');
  await pickRoleAndReady(r.page, 'runner');
  await sendTest(m.page, { kind: 'startCountdown', seconds: SECONDS });
  await expect(m.page.getByTestId('start-button')).toBeEnabled();
  await press(m.page.getByTestId('start-button'));
  await Promise.all([waitDigit(m.page), waitDigit(r.page)]);
  const url = m.page.url();
  // 괴물 탭이 떠난다 → 판 정지
  await m.page.goto('about:blank');
  await r.page.waitForFunction(() => (window.__DECOY__?.getLastSnapshot()?.world.paused ?? null) !== null);
  await expect
    .poll(async () => (await samples(r.page)).filter((s) => s.paused !== null).length, POLL)
    .toBeGreaterThan(30);
  const held = (await samples(r.page)).filter((s) => s.paused !== null);
  // 정지 중: 남은 값이 그대로 (0보다 크다), 12분 시계 그대로
  const frozenAt = held[0]!.cd;
  expect(frozenAt).toBeGreaterThan(1);
  for (const s of held) {
    expect(s.cd, '정지 중 남은 카운트다운').toBe(frozenAt);
    expect(s.timeLeft).toBe(balance.match.timeLimit);
  }
  // 화면: 숫자는 숨고 "괴물 재접속 대기 n초" 줄만 (시작 문구는 여전히 미룬다)
  for (const s of held.slice(-10)) {
    expect(s.label, '정지 중 카운트다운 글자').toBe('');
    expect(s.banners.length).toBe(1);
    expect(s.banners[0]).toMatch(new RegExp(`^${UI_TEXT.monsterReconnect} \\d+초$`));
  }
  // 괴물이 같은 탭으로 돌아온다 → 이어서 센다
  await m.page.goto(url);
  await r.page.waitForFunction(() => window.__DECOY__?.getLastSnapshot()?.world.paused === null);
  await Promise.all([waitGo(r.page), waitGo(m.page)]);
  const all = await samples(r.page);
  const lastHeld = all.map((s) => s.paused !== null).lastIndexOf(true);
  const resumed = all.slice(lastHeld + 1).filter((s) => s.cd > 0);
  expect(resumed.length).toBeGreaterThan(20);
  // 멈췄던 값에서 이어 내려간다 (처음부터 다시 세지 않고, 정지한 동안 줄지도 않았다)
  expect(resumed[0]!.cd).toBeLessThanOrEqual(frozenAt);
  expect(resumed[0]!.cd).toBeGreaterThan(frozenAt - 0.5);
  for (const s of resumed) expect(s.timeLeft).toBe(balance.match.timeLimit);
  // 글자: 정지 전후를 이어 빠짐없이 내려가 시작! (숨은 동안은 빈 글자)
  expectTail(labelsOf(all), SECONDS, 3, '러너');
  // 돌아온 괴물 화면도 남은 숫자부터
  const back = await samples(m.page);
  expect(back.find((s) => s.cd > 0)!.cd).toBeLessThanOrEqual(frozenAt);
  expectTail(labelsOf(back), SECONDS, 2, '괴물');
  // 시작 문구는 끝난 뒤에
  await expect
    .poll(async () => (await samples(r.page)).some((s) => s.banners.includes(INTRO.survivor)), POLL)
    .toBe(true);
  expect((await samples(r.page)).filter((s) => s.cd > 0 && s.banners.includes(INTRO.survivor))).toEqual([]);
  expect(m.problems).toEqual([]);
  expect(r.problems).toEqual([]);
  await m.context.close();
  await r.context.close();
});

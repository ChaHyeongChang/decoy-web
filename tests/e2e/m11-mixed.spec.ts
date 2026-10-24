// M11 PC와 휴대폰이 같은 방에서 한 판 (MOBILE_PLAN M11 자동 검증 "m11-mixed").
// 휴대폰은 로비부터 결과 · 다시 하기까지 손가락(탭 · CDP 멀티터치)만, PC는 키보드 · 마우스만 쓴다.
// 터치 입력이 실제로 판정에 들어갔는지는 서버 정답(/test/state: 위치 · 상태 · 괴물 조준 · 공격 준비)으로 확인한다.
// 정답에는 체력이 없어서 체력은 맞은 사람에게 서버가 보낸 자기 상태(you.surv.hp)로 본다.
// 느린 CI 러너(탭 4개가 CPU를 나눠 쓴다) 대비: 서버 정답 · 스냅샷은 간격 폴링으로 기다리고 고정 대기는 쓰지 않는다
import { readFileSync } from 'node:fs';
import { expect, test, type Browser, type Page } from '@playwright/test';
import {
  BTN,
  EXITS,
  angleDiff,
  inRect,
  validateBalance,
  type InputLogEntry,
  type Role,
  type TouchTarget,
} from '@decoy/shared';
import {
  PHONE_LANDSCAPE,
  PHONE_NARROW,
  PHONE_SMALL,
  closeAll,
  countPressed,
  createRoom,
  dpr1,
  joinRoom,
  myId,
  newPlayerPage,
  pickRoleAndReady,
  pointerCounts,
  press,
  recordInputs,
  sendTest,
  truth,
  waitForSnapshots,
  type DeviceOptions,
  type Player,
  type TruthFrame,
  type TruthPlayer,
} from './helpers';
import { MultiTouch, centerOf, stickPoint, touchTargets, waitForTouchTarget } from './touch';

const balance = validateBalance(JSON.parse(readFileSync('config/balance.json', 'utf8')));
const EXIT_N = EXITS.N;
/** 문 개방 판정 반경 안쪽 여유 (반경 경계에서 서버 · 폴링 시점이 어긋나도 안에 있게) */
const INSIDE = balance.exit.radius - 0.15;
/** 조준 각도 비교 허용 (터치 발사 대기와 같은 ±10°) */
const AIM_TOL = (10 * Math.PI) / 180;

/** 폴링 간격 (ms). rAF 폴링은 느린 러너에서 프레임이 몰려 와 쓰지 않는다 */
const POLL = 150;

// ───────────── WebSocket 원문 기록 ─────────────

/** 이 페이지가 서버로 보낸 `input` 메시지 원문 (JSON 문자열). 페이지를 열기 전에 붙여야 첫 연결부터 잡힌다 */
function recordSentInputs(page: Page): string[] {
  const sent: string[] = [];
  page.on('websocket', (ws) => {
    ws.on('framesent', (f) => {
      const text = typeof f.payload === 'string' ? f.payload : f.payload.toString('utf8');
      try {
        const msg = JSON.parse(text) as { t?: unknown };
        if (msg.t === 'input') sent.push(text);
      } catch {
        // JSON이 아닌 프레임은 이 게임에 없다 (있으면 아래 형식 검사에서 메시지 수로 드러난다)
      }
    });
  });
  return sent;
}

/** 값의 JSON 형식 이름 (NaN은 JSON으로 null이 된다 — 생존자 aim) */
const jsonType = (v: unknown): string => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);

/**
 * 보낸 input 원문들의 형식: 메시지 키(순서 포함) · 프레임 키(순서 포함) · 값 형식을 한 줄로.
 * 같은 형식이면 같은 줄 하나만 나온다
 */
function inputShapes(sent: readonly string[]): string[] {
  const shapes = new Set<string>();
  for (const text of sent) {
    const msg = JSON.parse(text) as Record<string, unknown>;
    const head = Object.keys(msg)
      .map((k) => `${k}:${jsonType(msg[k])}`)
      .join(',');
    const frames = Array.isArray(msg.frames) ? (msg.frames as Record<string, unknown>[]) : [];
    for (const f of frames)
      shapes.add(
        `${head} | ${Object.keys(f)
          .map((k) => `${k}:${jsonType(f[k])}`)
          .join(',')}`,
      );
  }
  return [...shapes];
}

/** 보낸 input 프레임 전부 (원문을 풀어서) */
function sentFrames(sent: readonly string[]): Record<string, unknown>[] {
  return sent.flatMap((text) => (JSON.parse(text) as { frames: Record<string, unknown>[] }).frames);
}

/** PC든 휴대폰이든 생존자 · 괴물이 보내는 input 원문 형식 (키 순서 · 값 형식). 두 시험이 같은 기준으로 대조한다 */
const SURVIVOR_SHAPE =
  't:string,frames:array | seq:number,mx:number,my:number,aim:null,held:number,pressed:number';
const MONSTER_SHAPE =
  't:string,frames:array | seq:number,mx:number,my:number,aim:number,held:number,pressed:number';

/** 4개 컨텍스트의 input 원문: 키 · 값 형식이 기기와 상관없이 역할(진영)별로 같고, 값 범위도 같다 */
function expectSameInputFormat(players: readonly MixedPlayer[]): void {
  const report: Record<string, { device: string; messages: number; frames: number; shapes: string[] }> = {};
  for (const p of players) {
    const shapes = inputShapes(p.sent);
    const frames = sentFrames(p.sent);
    report[p.role] = {
      device: p.touch ? 'phone' : 'pc',
      messages: p.sent.length,
      frames: frames.length,
      shapes,
    };
    expect(p.sent.length, `${p.role}: 보낸 input 메시지`).toBeGreaterThan(10);
    expect(shapes, `${p.role} (${p.touch ? '휴대폰' : 'PC'}) input 형식`).toEqual([
      p.role === 'monster' ? MONSTER_SHAPE : SURVIVOR_SHAPE,
    ]);
    for (const f of frames) {
      expect(Number.isInteger(f.seq) && Number.isInteger(f.held) && Number.isInteger(f.pressed), p.role).toBe(
        true,
      );
      const mx = f.mx as number;
      const my = f.my as number;
      // 이동은 정지(0) 또는 길이 1 (터치 스틱도 PC와 같은 최고 속도)
      const len = Math.hypot(mx, my);
      expect(len === 0 || Math.abs(len - 1) < 1e-9, `${p.role}: 이동 길이 ${len}`).toBe(true);
      if (p.role === 'monster') expect(Number.isFinite(f.aim), p.role).toBe(true);
    }
  }
  // 같은 진영이면 PC와 휴대폰의 형식이 한 글자도 다르지 않다
  const survivors = players.filter((p) => p.role !== 'monster');
  const survivorShapes = new Set(survivors.flatMap((p) => inputShapes(p.sent)));
  expect([...survivorShapes]).toEqual([SURVIVOR_SHAPE]);
  expect(new Set(survivors.map((p) => p.touch)).size, '생존자에 PC와 휴대폰이 섞여 있다').toBe(2);
  test.info().annotations.push({ type: 'input-format', description: JSON.stringify(report) });
}

// ───────────── 기기를 섞은 판 시작 ─────────────

interface MixedPlayer extends Player {
  /** 이 컨텍스트가 보낸 WebSocket input 원문 */
  sent: string[];
}

interface Seat {
  role: Role;
  /** 없으면 PC (960×540, 마우스 · 키보드) */
  device?: DeviceOptions;
}

/**
 * startFourPlayerMatch와 같은 흐름(첫 자리가 방장, 터치 기기는 탭)이지만 페이지를 열기 전에 WebSocket 기록을 붙인다
 */
async function startMixedMatch(
  browser: Browser,
  seats: readonly Seat[],
): Promise<{ code: string; players: MixedPlayer[] }> {
  const players: MixedPlayer[] = [];
  let code = '';
  for (const [i, seat] of seats.entries()) {
    const p = await newPlayerPage(browser, seat.device);
    const sent = recordSentInputs(p.page);
    if (i === 0) code = await createRoom(p.page);
    else await joinRoom(p.page, code);
    players.push({ ...p, role: seat.role, id: await myId(p.page), sent });
  }
  for (const p of players) await pickRoleAndReady(p.page, p.role);
  const host = players[0];
  if (!host) throw new Error('방장이 없습니다');
  await expect(host.page.getByTestId('start-button')).toBeEnabled();
  await press(host.page.getByTestId('start-button'));
  for (const p of players) await waitForSnapshots(p.page, 3);
  return { code, players };
}

function byRole(players: readonly MixedPlayer[], role: Role): MixedPlayer {
  const p = players.find((q) => q.role === role);
  if (!p) throw new Error(`${role} 없음`);
  return p;
}

// ───────────── 서버 정답 · 스냅샷 기다리기 ─────────────

/** 서버 정답이 조건을 만족할 때까지 간격 폴링한다. 만족한 정답을 돌려준다 */
async function waitTruth(
  page: Page,
  code: string,
  what: string,
  ok: (t: TruthFrame) => boolean,
  timeout = 20_000,
): Promise<TruthFrame> {
  let last: TruthFrame | null = null;
  await expect
    .poll(
      async () => {
        last = await truth(page, code);
        return ok(last);
      },
      { message: `서버 정답: ${what}`, timeout, intervals: [100, POLL] },
    )
    .toBe(true);
  if (!last) throw new Error('정답 없음');
  return last;
}

function who(t: TruthFrame, id: string): TruthPlayer {
  const p = t.players.find((q) => q.id === id);
  if (!p) throw new Error(`정답에 ${id} 없음`);
  return p;
}

const distToExit = (p: { x: number; y: number }): number =>
  Math.hypot(p.x - EXIT_N.center.x, p.y - EXIT_N.center.y);

/** 북문 칸 안 (서버 탈출 판정과 같은 식) */
const inDoor = (p: { x: number; y: number }): boolean => inRect(p, EXIT_N.door);

/** 페이지 안 조건이 참이 될 때까지 (간격 폴링) */
async function waitPage(page: Page, fn: () => boolean, timeout = 20_000): Promise<void> {
  await page.waitForFunction(fn, undefined, { polling: POLL, timeout });
}

const exitState = (page: Page): Promise<string | null> =>
  page.evaluate(
    () => window.__DECOY__?.getLastSnapshot()?.world.exits.find((e) => e.id === 'N')?.state ?? null,
  );

/**
 * 휴대폰 왼쪽 이동 스틱: 이동 영역 가운데를 누르고 angle(라디안, 화면 y 아래 +) 쪽으로 스틱 반지름보다 멀리 끌어 누르고 있는다.
 * 누른 자리와 끄는 단계마다 정수 px만 쓴다 (45°면 가로 · 세로가 언제나 같은 거리 — 키보드 W+D와 같은 값이 나오는지 본다)
 */
async function holdStick(t: MultiTouch, zone: TouchTarget, id: number, angle = -Math.PI / 2): Promise<void> {
  const STEPS = 4;
  const c = centerOf(zone);
  const x = Math.round(c.x);
  const y = Math.round(c.y);
  const dx = STEPS * Math.round((Math.cos(angle) * 112) / STEPS);
  const dy = STEPS * Math.round((Math.sin(angle) * 112) / STEPS);
  await t.down(id, x, y);
  await t.move(id, x + dx, y + dy, { steps: STEPS, stepMs: 20 });
}

test('PC 괴물 · 휴대폰 러너 · PC 가드 · 휴대폰 스카우트: 스틱과 W로 북문을 열고 탈출 → 결과 → 휴대폰에서 다시 하기 → 같은 방 두 번째 판', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const { code, players } = await startMixedMatch(browser, [
    { role: 'monster' },
    { role: 'runner', device: dpr1(PHONE_LANDSCAPE) },
    { role: 'guard' },
    { role: 'scout', device: dpr1(PHONE_SMALL) },
  ]);
  const monster = byRole(players, 'monster');
  const runner = byRole(players, 'runner');
  const guard = byRole(players, 'guard');
  const scout = byRole(players, 'scout');
  const host = monster.page;

  // 휴대폰은 로비(역할 · 준비)를 손가락으로 눌렀다. PC는 마우스만
  for (const p of players) {
    const counts = await pointerCounts(p.page);
    const touchDowns = counts['pointerdown:touch'] ?? 0;
    const mouseDowns = counts['pointerdown:mouse'] ?? 0;
    expect(p.touch ? touchDowns : mouseDowns, `${p.role} 로비 누름`).toBeGreaterThanOrEqual(2);
    expect(p.touch ? mouseDowns : touchDowns, `${p.role} 다른 방식 누름`).toBe(0);
  }
  // 판: 휴대폰은 터치 화면, PC는 터치 대상 0개
  const zone = await waitForTouchTarget(runner.page, 'move-zone');
  await waitForTouchTarget(scout.page, 'move-zone');
  for (const p of [monster, guard]) {
    expect(await touchTargets(p.page), p.role).toEqual([]);
    expect(await p.page.evaluate(() => window.__DECOY__?.inputMode), p.role).toBe('keyboard');
  }
  for (const p of [runner, scout])
    expect(await p.page.evaluate(() => window.__DECOY__?.inputMode), p.role).toBe('touch');

  // 거점 두 곳을 시험 명령으로 0.99까지 → 러너 · 가드를 거점에 두어 끝낸다 (탈출구 활성)
  await sendTest(host, { kind: 'teleport', target: monster.id, x: 45, y: 28 });
  await sendTest(host, { kind: 'teleport', target: runner.id, x: 8, y: 16 });
  await sendTest(host, { kind: 'teleport', target: guard.id, x: 40, y: 16 });
  await sendTest(host, { kind: 'setPoint', point: 'A', progress: 0.99 });
  await sendTest(host, { kind: 'setPoint', point: 'B', progress: 0.99 });
  await waitPage(runner.page, () => {
    const exits = window.__DECOY__?.getLastSnapshot()?.world.exits ?? [];
    return exits.length > 0 && exits.every((e) => e.state === 'active');
  });

  // 북문 반경 밖 바로 아래에 둔다 (문은 아직 닫혀 있다)
  const start = { runner: { x: 23.5, y: 5 }, guard: { x: 24.5, y: 5 } };
  await sendTest(host, { kind: 'teleport', target: runner.id, ...start.runner });
  await sendTest(host, { kind: 'teleport', target: guard.id, ...start.guard });
  const before = await waitTruth(
    host,
    code,
    '러너 · 가드가 북문 반경 밖 출발점',
    (t) =>
      Math.hypot(who(t, runner.id).x - start.runner.x, who(t, runner.id).y - start.runner.y) < 0.05 &&
      Math.hypot(who(t, guard.id).x - start.guard.x, who(t, guard.id).y - start.guard.y) < 0.05,
  );
  expect(distToExit(who(before, runner.id))).toBeGreaterThan(balance.exit.radius);
  expect(distToExit(who(before, guard.id))).toBeGreaterThan(balance.exit.radius);
  expect(await exitState(runner.page)).toBe('active');

  // ① 휴대폰 러너는 왼쪽 스틱, PC 가드는 W로 북문 반경 안까지 걸어간다
  const runnerRec = await recordInputs(runner.page);
  const guardRec = await recordInputs(guard.page);
  const touch = await MultiTouch.attach(runner.page);
  await Promise.all([holdStick(touch, zone, 1), guard.page.keyboard.down('KeyW')]);
  await waitTruth(
    host,
    code,
    '러너 · 가드가 걸어서 북문 반경 안',
    (t) => distToExit(who(t, runner.id)) <= INSIDE && distToExit(who(t, guard.id)) <= INSIDE,
    20_000,
  );
  await Promise.all([touch.up(1), guard.page.keyboard.up('KeyW')]);
  // 손가락을 떼면 이동 입력이 0이 되고(입력 기록), 서버 정답 위치도 더 바뀌지 않는다 (두 번 연속 같은 자리)
  await waitPage(runner.page, () => {
    const last = window.__DECOY__?.getInputLog().at(-1);
    return last !== undefined && last.mx === 0 && last.my === 0;
  });
  let prev: TruthPlayer | null = null;
  await expect
    .poll(
      async () => {
        const r = who(await truth(host, code), runner.id);
        const still = prev !== null && Math.hypot(r.x - prev.x, r.y - prev.y) < 1e-6;
        prev = r;
        return still;
      },
      { message: '러너가 손가락을 떼면 멈춘다', timeout: 15_000, intervals: [250] },
    )
    .toBe(true);

  // ② 둘 다 반경 안에 머물러 3초 → 북문이 열린다 (그동안 아무 입력 없음)
  await waitPage(
    runner.page,
    () => window.__DECOY__?.getLastSnapshot()?.world.exits.find((e) => e.id === 'N')?.state === 'open',
  );
  const opened = await truth(host, code);
  for (const p of [runner, guard]) {
    const t = who(opened, p.id);
    expect(t.status, p.role).toBe('free');
    expect(distToExit(t), `${p.role}: 문이 열릴 때 반경 안`).toBeLessThanOrEqual(balance.exit.radius);
    expect(inDoor(t), `${p.role}: 아직 문 칸 밖`).toBe(false);
  }
  // 스카우트는 감옥 쪽 시작 자리에 있다: 문은 러너(터치) + 가드(키보드) 두 사람으로 열렸다
  expect(distToExit(who(opened, scout.id)), '스카우트는 반경 밖').toBeGreaterThan(balance.exit.radius);
  const stage1 = who(opened, runner.id);
  // 러너가 반경 안으로 간 것은 터치 스틱 입력이다 (모든 프레임 touch, 위로 길이 1)
  const runnerWalk = await runnerRec.entries();
  expect(runnerWalk.length).toBeGreaterThan(5);
  expect(runnerWalk.every((e) => e.mode === 'touch')).toBe(true);
  expect(runnerWalk.filter((e) => e.mx === 0 && e.my === -1).length).toBeGreaterThan(3);
  const guardWalk = await guardRec.entries();
  expect(guardWalk.every((e) => e.mode === 'keyboard')).toBe(true);
  expect(guardWalk.filter((e) => e.mx === 0 && e.my === -1).length).toBeGreaterThan(3);

  // ③ 둘 다 걸어 들어가 탈출 (러너는 다시 스틱, 가드는 W)
  await Promise.all([holdStick(touch, zone, 2), guard.page.keyboard.down('KeyW')]);
  const escaped = await waitTruth(
    host,
    code,
    '러너 · 가드 탈출',
    (t) => who(t, runner.id).status === 'escaped' && who(t, guard.id).status === 'escaped',
    20_000,
  );
  await Promise.all([touch.up(2), guard.page.keyboard.up('KeyW')]);
  await touch.detach();
  const out = who(escaped, runner.id);
  expect(inDoor(out), `러너가 문 칸으로 걸어 들어갔다 (${out.x.toFixed(2)}, ${out.y.toFixed(2)})`).toBe(true);
  expect(out.y).toBeLessThan(stage1.y);
  expect(inDoor(who(escaped, guard.id))).toBe(true);
  const runnerFrames: InputLogEntry[] = await runnerRec.stop();
  const guardFrames: InputLogEntry[] = await guardRec.stop();
  expect(runnerFrames.every((e) => e.mode === 'touch')).toBe(true);
  expect(guardFrames.every((e) => e.mode === 'keyboard')).toBe(true);
  // 걷기만 했다: 누른 버튼 없음
  for (const bit of Object.values(BTN)) {
    expect(countPressed(runnerFrames, bit), `러너 pressed ${bit}`).toBe(0);
    expect(countPressed(guardFrames, bit), `가드 pressed ${bit}`).toBe(0);
  }
  // 탈출한 러너는 관전: 터치 화면이 입력을 받지 않는다 (판 중 '설정' 버튼만 남는다 — PC 메뉴 버튼과 같다)
  await expect
    .poll(async () => (await touchTargets(runner.page)).map((t) => t.id), { intervals: [POLL] })
    .toEqual(['menu']);

  // ④ 남은 휴대폰 스카우트: 최후의 30초 안에 사망 처리
  await waitPage(scout.page, () => (window.__DECOY__?.getLastSnapshot()?.world.grace ?? null) !== null);
  await sendTest(host, { kind: 'setSurvivor', target: scout.id, status: 'dead' });

  // ⑤ 4명 모두 생존자 승리, 생존자는 등급 (2명 탈출 = 탈출 성공)
  for (const p of players) {
    await expect(p.page.getByTestId('result'), p.role).toBeVisible({ timeout: 20_000 });
    await expect(p.page.getByTestId('result-winner'), p.role).toHaveText('생존자 승리');
    if (p.role === 'monster') await expect(p.page.getByTestId('result-grade')).toHaveCount(0);
    else await expect(p.page.getByTestId('result-grade'), p.role).toHaveText(/탈출 성공 · 2명 탈출/);
  }
  for (const p of [runner, scout]) expect(await touchTargets(p.page), `${p.role} 결과 화면`).toEqual([]);

  // ⑥ 휴대폰(스카우트)에서 다시 하기를 손가락으로 → 모두 같은 역할로 로비
  const beforeTap = await pointerCounts(scout.page);
  await press(scout.page.getByTestId('rematch'));
  const afterTap = await pointerCounts(scout.page);
  expect((afterTap['pointerdown:touch'] ?? 0) - (beforeTap['pointerdown:touch'] ?? 0)).toBe(1);
  for (const p of players) {
    await expect(p.page.getByTestId('room-code'), p.role).toHaveText(code);
    await expect(p.page.getByTestId(`role-${p.role}`), p.role).toHaveClass(/mine/);
  }
  // 로비에는 터치 화면이 없다 (판이 끝나면 지운다)
  for (const p of players) {
    expect(await touchTargets(p.page), `${p.role} 로비`).toEqual([]);
    expect(await p.page.evaluate(() => window.__DECOY__?.role ?? null), `${p.role} 로비`).toBeNull();
  }

  // ⑦ 같은 방 두 번째 판: 휴대폰은 준비를 탭, 터치 화면이 새로 하나만 생기고 새 판의 스틱 입력이 서버에 들어간다
  for (const p of players) {
    await press(p.page.getByTestId('ready-button'));
    await expect(p.page.getByTestId('ready-button'), p.role).toHaveText('준비 취소');
  }
  await expect(host.getByTestId('start-button')).toBeEnabled();
  await press(host.getByTestId('start-button'));
  for (const p of players)
    await waitPage(p.page, () => {
      const d = window.__DECOY__;
      return d !== undefined && d.role !== null && d.snapCount >= 3 && d.getResult() === null;
    });
  const zone2 = await waitForTouchTarget(runner.page, 'move-zone');
  for (const p of [runner, scout]) {
    await waitForTouchTarget(p.page, 'move-zone');
    const ids = (await touchTargets(p.page)).map((x) => x.id);
    expect(new Set(ids).size, `${p.role} 터치 대상 중복 없음: ${ids.join(',')}`).toBe(ids.length);
    await expect(p.page.locator('.touch-layer'), p.role).toHaveCount(1);
  }
  for (const p of [monster, guard]) expect(await touchTargets(p.page), p.role).toEqual([]);

  // 대각선(오른쪽 위 45°): 휴대폰 러너는 스틱, PC 가드는 W+D. 서버 정답에서 둘 다 45°로 움직이고 보낸 값이 같다
  const diag = { runner: { x: 36, y: 18 }, guard: { x: 36, y: 20 } };
  await sendTest(host, { kind: 'teleport', target: monster.id, x: 8, y: 28 });
  await sendTest(host, { kind: 'teleport', target: runner.id, ...diag.runner });
  await sendTest(host, { kind: 'teleport', target: guard.id, ...diag.guard });
  await waitTruth(
    host,
    code,
    '두 번째 판 출발점',
    (t) =>
      Math.hypot(who(t, runner.id).x - diag.runner.x, who(t, runner.id).y - diag.runner.y) < 0.05 &&
      Math.hypot(who(t, guard.id).x - diag.guard.x, who(t, guard.id).y - diag.guard.y) < 0.05,
  );
  const touch2 = await MultiTouch.attach(runner.page);
  await Promise.all([
    holdStick(touch2, zone2, 3, -Math.PI / 4),
    guard.page.keyboard.down('KeyW').then(() => guard.page.keyboard.down('KeyD')),
  ]);
  // 방향은 둘 다 움직이기 시작한 뒤 구간으로 잰다 (가드는 W 다음 D를 누르므로 첫 몇 프레임은 위로만 간다)
  const gone = (t: TruthFrame, p: MixedPlayer, from: { x: number; y: number }, d: number) =>
    who(t, p.id).x - from.x > d && from.y - who(t, p.id).y > d;
  const pA = await waitTruth(
    host,
    code,
    '러너 · 가드가 오른쪽 위로 움직이기 시작',
    (t) => gone(t, runner, diag.runner, 0.3) && gone(t, guard, diag.guard, 0.3),
  );
  const from = { runner: who(pA, runner.id), guard: who(pA, guard.id) };
  const pB = await waitTruth(
    host,
    code,
    '러너 · 가드가 오른쪽 위로 1타일 더',
    (t) => gone(t, runner, from.runner, 1) && gone(t, guard, from.guard, 1),
  );
  await Promise.all([
    touch2.up(3),
    guard.page.keyboard.up('KeyW').then(() => guard.page.keyboard.up('KeyD')),
  ]);
  await touch2.detach();
  for (const p of [runner, guard]) {
    const a = p === runner ? from.runner : from.guard;
    const b = who(pB, p.id);
    const dir = Math.atan2(b.y - a.y, b.x - a.x);
    expect(Math.abs(angleDiff(dir, -Math.PI / 4)), `${p.role} 이동 방향 ${dir.toFixed(3)}`).toBeLessThan(
      0.05,
    );
  }
  // 원문: 휴대폰 스틱 45°와 PC W+D가 같은 {mx, my} (길이 1)
  const diagFrames = (p: MixedPlayer) =>
    sentFrames(p.sent).filter((f) => (f.mx as number) > 0 && (f.my as number) < 0);
  for (const p of [runner, guard]) {
    const fs = diagFrames(p);
    expect(fs.length, `${p.role} 대각선 프레임`).toBeGreaterThan(3);
    for (const f of fs) {
      expect(f.mx as number, p.role).toBeCloseTo(Math.SQRT1_2, 12);
      expect(f.my as number, p.role).toBeCloseTo(-Math.SQRT1_2, 12);
    }
  }

  // 휴대폰은 손가락만, 끄는 중 브라우저가 가져간 손가락(pointercancel)이 없다
  for (const p of players) {
    const c = await pointerCounts(p.page);
    if (p.touch) {
      expect(c['pointerdown:mouse'] ?? 0, p.role).toBe(0);
      expect(c['pointercancel:touch'] ?? 0, p.role).toBe(0);
    } else expect(c['pointerdown:touch'] ?? 0, p.role).toBe(0);
  }
  expectSameInputFormat(players);
  // PC와 휴대폰 생존자가 같은 걷기(위로)를 같은 값으로 보냈다
  const up = (p: MixedPlayer) => sentFrames(p.sent).filter((f) => f.mx === 0 && f.my === -1).length;
  expect(up(runner), '휴대폰 러너 원문 {mx:0, my:-1}').toBeGreaterThan(3);
  expect(up(guard), 'PC 가드 원문 {mx:0, my:-1}').toBeGreaterThan(3);
  for (const p of players) expect(p.problems, p.role).toEqual([]);
  await closeAll(players);
});

test('휴대폰 괴물이 오른쪽 조준 스틱으로 PC 러너를 겨누고 놓아서 맞힌다 (반대편 휴대폰 가드는 안 맞음)', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const { code, players } = await startMixedMatch(browser, [
    { role: 'monster', device: dpr1(PHONE_LANDSCAPE) },
    { role: 'runner' },
    { role: 'guard', device: dpr1(PHONE_NARROW) },
    { role: 'scout' },
  ]);
  const monster = byRole(players, 'monster');
  const runner = byRole(players, 'runner');
  const guard = byRole(players, 'guard');
  const scout = byRole(players, 'scout');
  const host = monster.page;
  expect(monster.touch).toBe(true);
  const aimStick = await waitForTouchTarget(monster.page, 'aim-stick');

  // 괴물을 트인 방에 둔다 (순간이동은 시작 대기도 푼다). 터치 괴물은 스틱을 잡기 전까지 지금 방향을 본다
  const M = { x: 39, y: 13 };
  await sendTest(host, { kind: 'teleport', target: scout.id, x: 8, y: 16 });
  await sendTest(host, { kind: 'teleport', target: monster.id, ...M });
  // 방향이 자리 잡을 때까지 (두 번 연속 같은 face)
  let face0 = Number.NaN;
  await expect
    .poll(
      async () => {
        const t = await truth(host, code);
        const m = who(t, monster.id);
        const still = Math.hypot(m.x - M.x, m.y - M.y) < 0.05 && Math.abs(angleDiff(face0, m.face)) < 1e-6;
        face0 = m.face;
        return still;
      },
      { message: '괴물 자리 · 방향 고정', timeout: 15_000, intervals: [250] },
    )
    .toBe(true);
  // 러너는 지금 방향에서 135° 돌아간 쪽, 가드는 그 반대편(지금 방향에서 -45°, 처음 방향으로 치면 부채꼴 안).
  // 조준이 스틱을 따르지 않고 처음 방향으로 공격하면 가드가 맞는다
  const theta = face0 + (3 * Math.PI) / 4;
  const D = 0.9;
  const at = (a: number) => ({ x: M.x + Math.cos(a) * D, y: M.y + Math.sin(a) * D });
  await sendTest(host, { kind: 'teleport', target: runner.id, ...at(theta) });
  await sendTest(host, { kind: 'teleport', target: guard.id, ...at(theta + Math.PI) });
  await waitTruth(host, code, '러너 · 가드 자리', (t) => {
    const r = who(t, runner.id);
    const g = who(t, guard.id);
    return (
      Math.hypot(r.x - at(theta).x, r.y - at(theta).y) < 0.05 &&
      Math.hypot(g.x - at(theta + Math.PI).x, g.y - at(theta + Math.PI).y) < 0.05
    );
  });
  // 괴물 화면: 공격할 수 있는 상태 (예측 상태도 시작 대기가 풀림, 쿨타임 0)
  await monster.page.waitForFunction(
    () => {
      const d = window.__DECOY__;
      const s = d?.getLastSnapshot();
      return (d?.getLocalState()?.frozen ?? 1) <= 0 && s?.you.mon?.attackCd === 0 && s.you.mon.windup === 0;
    },
    undefined,
    { polling: POLL, timeout: 15_000 },
  );
  const hp = (p: Page) => p.evaluate(() => window.__DECOY__?.getLastSnapshot()?.you.surv?.hp ?? null);
  expect(await hp(runner.page)).toBe(balance.survivor.maxHp);
  expect(await hp(guard.page)).toBe(balance.survivor.maxHp);

  // 오른손: 조준 스틱을 θ로 끌고 있는다 → 입력 aim = θ, 서버 face가 θ로 돈다. 아직 공격 없음, 이동 없음
  const rec = await recordInputs(monster.page);
  const t = await MultiTouch.attach(monster.page);
  const c = centerOf(aimStick);
  await t.down(1, c.x, c.y);
  const p = stickPoint(aimStick, theta, 0.9);
  await t.move(1, p.x, p.y, { steps: 5, stepMs: 20 });
  const aimed = await waitTruth(host, code, '괴물 face가 θ로 수렴', (tr) => {
    const m = tr.monster;
    return m !== null && Math.abs(angleDiff(m.aim, theta)) <= AIM_TOL;
  });
  expect(Math.hypot(who(aimed, monster.id).x - M.x, who(aimed, monster.id).y - M.y)).toBeLessThan(0.05);
  const holding = await rec.entries();
  expect(holding.length).toBeGreaterThan(3);
  expect(holding.every((e) => e.mode === 'touch')).toBe(true);
  expect(Math.abs(angleDiff(holding.at(-1)!.aim, theta))).toBeLessThan(0.02);
  expect(countPressed(holding, BTN.ATTACK)).toBe(0);
  expect(holding.every((e) => e.mx === 0 && e.my === 0)).toBe(true);

  // 놓는다 → 공격 1번 (θ 방향 준비) → 러너 체력 2 → 1, 가드는 그대로
  await t.up(1);
  // 공격 준비(0.4초)를 놓치지 않게 서버 정답을 따로 촘촘히 읽는다 (브라우저 탭 부하와 상관없는 HTTP)
  const windups: { windup: number; aim: number }[] = [];
  let watching = true;
  const watcher = (async () => {
    while (watching) {
      const tr = await truth(host, code);
      if (tr.monster && tr.monster.windup > 0)
        windups.push({ windup: tr.monster.windup, aim: tr.monster.aim });
      await new Promise((r) => setTimeout(r, 20));
    }
  })();
  try {
    await expect
      .poll(() => hp(runner.page), {
        message: '러너 체력 1 (서버가 러너에게 보낸 자기 상태)',
        timeout: 15_000,
        intervals: [100],
      })
      .toBe(balance.survivor.maxHp - 1);
  } finally {
    watching = false;
    await watcher;
  }
  await t.detach();
  const frames = await rec.stop();
  expect(countPressed(frames, BTN.ATTACK), '공격 정확히 1번').toBe(1);
  expect(countPressed(frames, BTN.MODE | BTN.DASH | BTN.ROAR)).toBe(0);
  const fired = frames.find((e) => (e.pressed & BTN.ATTACK) !== 0)!;
  expect(Math.abs(angleDiff(fired.aim, theta)), '공격 프레임 aim = θ').toBeLessThan(0.02);
  // 서버 정답: 공격 준비 중 조준이 θ로 고정
  expect(windups.length, '서버 정답에서 공격 준비를 봤다').toBeGreaterThan(0);
  for (const w of windups) expect(Math.abs(angleDiff(w.aim, theta))).toBeLessThanOrEqual(AIM_TOL);
  const after = await truth(host, code);
  expect(who(after, runner.id).status).toBe('free');
  expect(await hp(guard.page), '반대편 가드는 맞지 않았다').toBe(balance.survivor.maxHp);

  for (const q of players) {
    const counts = await pointerCounts(q.page);
    if (q.touch) {
      expect(counts['pointerdown:mouse'] ?? 0, q.role).toBe(0);
      expect(counts['pointercancel:touch'] ?? 0, q.role).toBe(0);
    } else expect(counts['pointerdown:touch'] ?? 0, q.role).toBe(0);
  }
  expectSameInputFormat(players);
  for (const q of players) expect(q.problems, q.role).toEqual([]);
  await closeAll(players);
});

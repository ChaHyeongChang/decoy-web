// 플레이테스트 반영 a-2 (괴물 공격 조준 · 터치): 휴대폰 가로 에뮬레이션에서 실제 터치 화면으로
//  1. 끌어서 조준(기본): 가운데를 비켜 누른 짧은 탭 · 탭하다 밀린 손가락은 이동 방향으로 공격한다(조준이 손가락 쪽으로 돌지 않는다),
//     끌어 놓으면 끈 방향(누른 자리가 중심) · 누른 자리로 되돌리면 취소 표시
//  2. 탭 공격 조준 보정: 화면에 보이는 생존자 쪽으로 12°까지만, 같은 자리라도 시야 밖(추적 모드 부채꼴 밖)이면 0
//  3. 설정 조작 탭 '공격 버튼' 줄: 기본 끌어서 조준, 고르면 그 칸만 저장 · 새로고침 뒤에도 그대로 · 기본값으로 되돌리기
//  4. '누르면 바로'로 바꾼 판: 판 직전 안내가 바뀌고, 닿는 순간 공격 · 끌기 무시 · 뗄 때 아무것도 없음 · 보이는 생존자 쪽 보정
//  5. PC 클릭에는 보정이 없다
//  6. 점수판 조작 안내: 끌어서 조준 줄이 점수판 폭을 늘리지 않는다(작은 휴대폰 + UI 크기를 키워도 화면 안), '누르면 바로' 판은 그 방식 줄
// 판정은 서버 정답(틱마다 쓰는 truth.jsonl의 공격 준비 방향)으로 본다. 시간 창은 입력 프레임 수 · 서버 상태로 잰다.
// 봇을 옮겨 세워 둘 때는 placeFrozen을 쓴다 — 시험 명령 teleport는 freeze를 풀어, 옮기기만 하면 봇이 다시 걸어 나간다
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { BTN, DEG, angleDiff, type InputLogEntry, type Role } from '@decoy/shared';
import { ASSIST } from '../../client/src/aimAssist';
import {
  CONTROLS_TOUCH,
  CONTROLS_TOUCH_INSTANT,
  HUD_TEXT,
  SETTINGS_TEXT,
  tutorialLines,
} from '../../client/src/data/storyText';
import { TOUCH, aimStartOf } from '../../client/src/touchInput';
import { TOUCH_BOARD_W, TOUCH_UI } from '../../client/src/ui/layout';
import {
  BASE_QUERY,
  PHONE_LANDSCAPE,
  PHONE_NARROW,
  aimMonsterAt,
  chooseSetting,
  closeSettings,
  countPressed,
  createRoom,
  dpr1,
  inputLog,
  myId,
  newPlayerPage,
  openSettings,
  pickRoleAndReady,
  pointerCounts,
  press,
  recordInputs,
  sendTest,
  truth,
  truthLogSize,
  truthSince,
  waitForSnapshots,
  type DeviceOptions,
  type InputRecorder,
  type TruthFrame,
} from './helpers';
import { MultiTouch, centerOf, waitForTouchTarget } from './touch';

/** Pixel 7 가로 전체 화면 915×412, 기기 배율 1 (조준 스틱 반지름 63px → 조준 시작 문턱 18.9px, 예전 데드존 9.45px) */
const PHONE = dpr1(PHONE_LANDSCAPE);
const POLL = { intervals: [100, 150, 200], timeout: 20_000 };
/** 입력 프레임 aim 허용 오차 (손가락 좌표 반올림) */
const AIM_EPS = 0.03;
const UP = -Math.PI / 2;
/** 위로 곧게 트인 줄: x 41.5, y 22 → 1 */
const UP_LANE = { x: 41.5, y: 21.5 };
/** 오른쪽으로 곧게 트인 줄: y 24.5, x 1 → 22 */
const RIGHT_LANE = { x: 4.5, y: 24.5 };
/** 둘레 2타일이 모두 바닥인 자리 (오른쪽 방) */
const OPEN = { x: 38, y: 14 };

const angleGap = (a: number, b: number): number => Math.abs(angleDiff(a, b));

interface Solo {
  context: BrowserContext;
  page: Page;
  problems: string[];
  code: string;
  id: string;
}

/**
 * 가짜 전체 화면 · 가로 고정 (m11-touch와 같다): 헤드리스 크롬에서는 첫 탭의 진짜 requestFullscreen이 성공해 창 크기가 바뀌고
 * 손가락이 취소된다. 아무것도 하지 않게 한다
 */
function stubFullscreen(): void {
  Element.prototype.requestFullscreen = function () {
    return Promise.resolve();
  };
  if (typeof ScreenOrientation !== 'undefined')
    (ScreenOrientation.prototype as unknown as { lock: () => Promise<void> }).lock = () => Promise.resolve();
}

/** 봇 방을 만들어 역할을 고르고 혼자 시작한다 (빈 역할은 서버 봇) */
async function soloMatch(
  browser: Browser,
  device: DeviceOptions | undefined,
  role: Role,
  inLobby?: (page: Page) => Promise<void>,
): Promise<Solo> {
  const { context, page, problems } = await newPlayerPage(browser, device);
  await context.addInitScript(stubFullscreen);
  const code = await createRoom(page, '&bots=1');
  await pickRoleAndReady(page, role);
  await inLobby?.(page);
  await press(page.getByTestId('start-button'));
  await waitForSnapshots(page, 3);
  return { context, page, problems, code, id: await myId(page) };
}

/** 나 말고 모두(봇) 멈추고 생존자 ID를 돌려준다 */
async function freezeOthers(s: Solo): Promise<string[]> {
  const tr = await truth(s.page, s.code);
  const others = tr.players.filter((p) => p.id !== s.id).map((p) => p.id);
  for (const id of others) await sendTest(s.page, { kind: 'freeze', target: id, frozen: true });
  return others;
}

/**
 * 봇 하나를 (x, y)에 세워 둔다. 순간 이동은 멈춤(freeze)을 풀기 때문에 옮긴 바로 뒤에 다시 멈춘다(같은 작업에서 두 명령을 보낸다).
 * 그 사이 서버 틱이 끼어 봇이 한 걸음 움직였으면 다시 한다 — 몇 틱 뒤 정답 자리가 정확히 그 자리일 때까지
 */
async function placeFrozen(s: Solo, id: string, x: number, y: number): Promise<void> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const from = (await truth(s.page, s.code)).tick;
    await s.page.evaluate(
      ([target, tx, ty]) => {
        const d = window.__DECOY__;
        d?.sendTest({ kind: 'teleport', target, x: tx, y: ty });
        d?.sendTest({ kind: 'freeze', target, frozen: true });
      },
      [id, x, y] as const,
    );
    await expect.poll(async () => (await truth(s.page, s.code)).tick, POLL).toBeGreaterThanOrEqual(from + 4);
    const p = (await truth(s.page, s.code)).players.find((q) => q.id === id);
    if (p && Math.hypot(p.x - x, p.y - y) < 0.005) return;
  }
  throw new Error(`봇 ${id}를 (${x}, ${y})에 세우지 못했다`);
}

async function selfTruth(s: Solo): Promise<{ x: number; y: number; face: number }> {
  const me = (await truth(s.page, s.code)).players.find((p) => p.id === s.id);
  if (!me) throw new Error('정답에 내가 없음');
  return me;
}

/** 내 캐릭터를 (x, y)로 옮기고 방향을 정한다: 서버 정답 · 내 예측이 그 자리에 오고 시작 대기가 풀릴 때까지 */
async function placeSelf(s: Solo, x: number, y: number, face: number): Promise<void> {
  await sendTest(s.page, { kind: 'teleport', target: s.id, x, y, face });
  await expect
    .poll(async () => {
      const me = await selfTruth(s);
      return Math.hypot(me.x - x, me.y - y) < 0.05;
    }, POLL)
    .toBe(true);
  await s.page.waitForFunction(
    ([tx, ty]) => {
      const d = window.__DECOY__;
      const st = d?.getLocalState();
      const snap = d?.getLastSnapshot();
      return (
        st !== null &&
        st !== undefined &&
        Math.hypot(st.x - tx!, st.y - ty!) < 0.05 &&
        (snap?.you.move.frozen ?? 1) <= 0
      );
    },
    [x, y],
    { polling: 100, timeout: 20_000 },
  );
}

/**
 * 스틱을 잡고 (x, y)에서 멀어지는 중에 내 캐릭터를 (x, y)로 되돌린다 (m11-touch와 같다): 정답 기록에서 '보내기 전보다 1타일 넘게
 * 가까워진' 틱이 보일 때까지 — 멀어지는 움직임으로는 생길 수 없다
 */
async function teleportWhileMoving(s: Solo, x: number, y: number, face: number): Promise<void> {
  const now = await selfTruth(s);
  const away = Math.hypot(now.x - x, now.y - y);
  expect(away, '되돌릴 거리').toBeGreaterThan(2);
  const offset = truthLogSize();
  await sendTest(s.page, { kind: 'teleport', target: s.id, x, y, face });
  await expect
    .poll(
      () =>
        truthSince(offset, s.code).some((f) => {
          const me = f.players.find((p) => p.id === s.id);
          return me !== undefined && Math.hypot(me.x - x, me.y - y) < away - 1;
        }),
      POLL,
    )
    .toBe(true);
}

/**
 * 이동 스틱을 오른쪽으로 잠깐 끌어 터치 조준을 동쪽(0)으로 정하고 at으로 되돌린다. 터치 조준은 스틱을 떼어도 마지막 방향을 계속
 * 보내므로, 되돌린 뒤에도 보내는 aim이 0이라 서버 방향이 흐르지 않는다 (순간 이동의 face만으로는 이미 보낸 입력의 조준이 덮어쓴다)
 */
async function standFacingEast(s: Solo, t: MultiTouch, at: { x: number; y: number }): Promise<void> {
  const { page } = s;
  await placeSelf(s, at.x, at.y, 0);
  const z = centerOf(await waitForTouchTarget(page, 'move-zone'));
  await t.down(1, z.x, z.y);
  await t.move(1, z.x + 90, z.y, { steps: 6, stepMs: 20 });
  await expect
    .poll(async () => {
      const e = (await inputLog(page)).at(-1);
      return e ? `${e.mx},${e.my},${e.aim}` : null;
    }, POLL)
    .toBe('1,0,0');
  await t.up(1);
  // 서버가 움직이는 입력을 다 처리한 뒤에 되돌린다 (밀린 입력이 순간 이동 뒤에 처리되면 다시 걸어 나간다)
  await page.waitForFunction(
    () => {
      const d = window.__DECOY__;
      const log = d?.getInputLog() ?? [];
      const last = log.at(-1);
      if (!last || last.mx !== 0 || last.my !== 0) return false;
      const moving = log.filter((f) => f.mx !== 0 || f.my !== 0).at(-1);
      return (d?.getLastSnapshot()?.ack ?? -1) >= (moving?.seq ?? 0);
    },
    null,
    { polling: 100, timeout: 20_000 },
  );
  await placeSelf(s, at.x, at.y, 0);
  await expect.poll(async () => angleGap((await selfTruth(s)).face, 0), POLL).toBeLessThan(1e-6);
}

/** from번째 뒤 프레임들: bit가 눌린 프레임이 나오고 그 뒤로 more개 더 쌓일 때까지 */
async function framesAfterPress(
  rec: InputRecorder,
  from: number,
  bit: number,
  more = 10,
): Promise<InputLogEntry[]> {
  let out: InputLogEntry[] = [];
  await expect
    .poll(async () => {
      out = (await rec.entries()).slice(from);
      const i = out.findIndex((f) => (f.pressed & bit) !== 0);
      return i >= 0 && out.length - i > more;
    }, POLL)
    .toBe(true);
  return out;
}

/** from번째 뒤로 프레임이 n개 더 쌓일 때까지 */
async function moreFrames(rec: InputRecorder, from: number, n: number): Promise<InputLogEntry[]> {
  let out: InputLogEntry[] = [];
  await expect
    .poll(async () => {
      out = (await rec.entries()).slice(from);
      return out.length;
    }, POLL)
    .toBeGreaterThanOrEqual(n);
  return out;
}

/** 서버 정답(offset 뒤)에서 공격 준비가 시작된 첫 틱 — 그 틱의 조준 = 공격 방향 (준비 중에는 조준이 고정된다) */
async function windupSince(s: Solo, offset: number): Promise<TruthFrame> {
  const find = (): TruthFrame | undefined =>
    truthSince(offset, s.code).find((f) => (f.monster?.windup ?? 0) > 0);
  await expect.poll(() => find() !== undefined, POLL).toBe(true);
  return find()!;
}

/** 서버가 보낸 내 상태에서 공격을 다시 시작할 수 있다 (쿨타임 0 · 준비 중 아님) */
async function waitAttackReady(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const mon = window.__DECOY__?.getLastSnapshot()?.you.mon;
      return mon !== null && mon !== undefined && mon.attackCd <= 0 && mon.windup <= 0;
    },
    null,
    { polling: 100, timeout: 20_000 },
  );
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 작은 휴대폰 가로 전체 화면 w×h (기기 배율 1) */
const smallPhone = (w: number, h: number): DeviceOptions =>
  dpr1({ ...PHONE_NARROW, viewport: { width: w, height: h }, screen: { width: w, height: h } });

/**
 * 점수판 버튼을 탭해 점수판을 열고, 점수판 부품(HUD 이름 'score' — 판 · 제목 · 행 · 조작 안내 · 닫기 안내)을 모두 감싼 상자(CSS px),
 * 보이는 글자, 적용된 UI 크기 배율(제목 글자 = 주요 글자 + 1 CSS px × 배율)을 돌려준다
 */
async function openScoreboard(
  page: Page,
  t: MultiTouch,
): Promise<{ box: Box; texts: string[]; ui: number; ctrlShown: boolean }> {
  const c = centerOf(await waitForTouchTarget(page, 'scoreboard'));
  await t.tap(5, c.x, c.y, 60);
  await page.waitForFunction(() => window.__DECOY__?.getHud().scoreboard === true, null, {
    polling: 100,
    timeout: 20_000,
  });
  // 행(스냅샷의 익명 상태 목록)까지 놓였을 때
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.__DECOY__!.getHudLayout()))?.items.some(
          (i) => i.id === 'score' && i.text?.startsWith('생존자 '),
        ) ?? false,
      POLL,
    )
    .toBe(true);
  const items = (await page.evaluate(() => window.__DECOY__!.getHudLayout()))!.items.filter(
    (i) => i.id === 'score',
  );
  const x0 = Math.min(...items.map((i) => i.x));
  const y0 = Math.min(...items.map((i) => i.y));
  const x1 = Math.max(...items.map((i) => i.x + i.w));
  const y1 = Math.max(...items.map((i) => i.y + i.h));
  const title = items.find((i) => i.text === HUD_TEXT.scoreboard);
  expect(title?.fontPx, '점수판 제목').toBeDefined();
  const texts = items.flatMap((i) => (i.text === undefined ? [] : [i.text]));
  return {
    box: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 },
    texts,
    ui: title!.fontPx! / (TOUCH_UI.font.main + 1),
    // 낮은 화면은 조작 안내 줄을 뺀다 (목표 문장 = 마지막 줄)
    ctrlShown: texts.includes(CONTROLS_TOUCH.monster.at(-1)!),
  };
}

/** 괴물 화면: 스냅샷에 온 생존자 수 = want이고, 그린 생존자 수도 같다 (보간 지연 뒤 화면까지 반영됨) */
async function waitSeen(page: Page, want: number): Promise<void> {
  await page.waitForFunction(
    (n) => {
      const d = window.__DECOY__;
      const snap = d?.getLastSnapshot();
      if (!d || !snap) return false;
      const drawn = d.getDrawn().filter((e) => e.kind === 'survivor' && e.layer !== 'minimap');
      return snap.survivors.length === n && drawn.length === n;
    },
    want,
    { polling: 100, timeout: 20_000 },
  );
}

test('끌어서 조준(기본): 가운데를 비켜 누른 짧은 탭 · 탭하다 밀린 손가락은 이동 방향으로 공격하고, 끌어 놓으면 끈 방향(누른 자리가 중심) · 되돌리면 취소 표시', async ({
  browser,
}) => {
  test.setTimeout(150_000);
  const s = await soloMatch(browser, PHONE, 'monster');
  const { page } = s;
  await freezeOthers(s);
  await placeSelf(s, UP_LANE.x, UP_LANE.y, Math.PI);
  const zone = await waitForTouchTarget(page, 'move-zone');
  const aim = await waitForTouchTarget(page, 'aim-stick');
  const aimEl = page.locator('[data-touch-target="aim-stick"]');
  const r = Math.min(aim.w, aim.h) / 2;
  const startPx = aimStartOf(r) * r;
  const t = await MultiTouch.attach(page);
  const rec = await recordInputs(page, 100);

  // 왼손: 이동 스틱을 위로 — 조준은 이동 방향(위)을 따른다
  const z = { x: zone.x + zone.w * 0.5, y: zone.y + zone.h * 0.65 };
  await t.down(1, z.x, z.y);
  await t.move(1, z.x, z.y - 90, { steps: 6, stepMs: 20 });
  await expect
    .poll(async () => {
      const me = await selfTruth(s);
      return UP_LANE.y - me.y > 2 && angleGap(me.face, UP) < 0.01;
    }, POLL)
    .toBe(true);
  const c = centerOf(aim);

  /** 탭 하나를 하고: ATTACK 1번, 누른 뒤 어느 프레임도 이동 방향(위)에서 벗어나지 않음, 서버 공격 방향 = 위 */
  const tapKeepsDirection = async (name: string, tap: () => Promise<void>): Promise<void> => {
    await waitAttackReady(page);
    await teleportWhileMoving(s, UP_LANE.x, UP_LANE.y, UP);
    const off = truthLogSize();
    const n = (await rec.entries()).length;
    await tap();
    const frames = await framesAfterPress(rec, n, BTN.ATTACK, 12);
    expect(countPressed(frames, BTN.ATTACK), name).toBe(1);
    expect(
      frames.filter((f) => angleGap(f.aim, UP) >= AIM_EPS).map((f) => f.aim.toFixed(3)),
      `${name}: 조준이 이동 방향을 떠난 프레임`,
    ).toEqual([]);
    const w = await windupSince(s, off);
    expect(angleGap(w.monster!.aim, UP), `${name}: 서버 공격 방향 ${w.monster!.aim.toFixed(3)}`).toBeLessThan(
      1 * DEG,
    );
  };

  // ① 가운데에서 (−20, +15)px 비켜 누른 0.1초 탭. 요소 가운데가 중심이면 25px = 데드존 밖이라 그쪽(143°)으로 돌아 공격했다
  expect(Math.hypot(20, 15), '비켜 누른 거리가 예전 데드존 · 새 문턱보다 크다').toBeGreaterThan(startPx);
  expect(Math.hypot(20, 15), '비켜 누른 자리가 스틱 안').toBeLessThan(r - 4);
  await tapKeepsDirection('비켜 누른 탭', () => t.tap(2, c.x - 20, c.y + 15, 100));

  // ② 가운데를 누르고 12px 밀린 채 뗀 탭: 예전 데드존(0.15r)보다 멀고 조준 시작 문턱보다 가깝다 → 조준 표시도 뜨지 않는다
  const drift = Math.hypot(11, 5);
  expect(drift).toBeGreaterThan(TOUCH.deadZone * r + 1);
  expect(drift).toBeLessThan(startPx - 2);
  await tapKeepsDirection('밀린 탭', async () => {
    await t.down(2, c.x, c.y);
    await t.move(2, c.x - 11, c.y + 5, { steps: 2, stepMs: 20 });
    await expect(aimEl).not.toHaveClass(/aiming/);
    await t.up(2);
  });

  // ③ 끌어서 조준: 가운데 아래 0.4r을 누르고 오른쪽으로 45px 끈다 → 끈 방향(동쪽 0°). 요소 가운데가 중심이면 '가운데 → 손가락'
  // 방향(약 29°)이 된다. 끄는 동안 서버 face가 동쪽으로 돌고, 놓으면 그 방향으로 공격
  await waitAttackReady(page);
  await teleportWhileMoving(s, UP_LANE.x, UP_LANE.y, UP);
  const press0 = { x: c.x, y: c.y + Math.round(r * 0.4) };
  expect(45).toBeGreaterThan(startPx + 4);
  await t.down(3, press0.x, press0.y);
  await t.move(3, press0.x + 45, press0.y, { steps: 5, stepMs: 20 });
  await expect(aimEl).toHaveClass(/aiming/);
  await expect
    .poll(async () => {
      const e = (await rec.entries()).at(-1);
      return e !== undefined && angleGap(e.aim, 0) < AIM_EPS;
    }, POLL)
    .toBe(true);
  // 누른 자리 쪽으로 12px 안까지 되돌리면 취소 표시(조준 시작과 같은 문턱), 다시 끌면 조준
  await t.move(3, press0.x + 12, press0.y, { steps: 3, stepMs: 20 });
  await expect(aimEl).toHaveClass(/cancel/);
  await expect(aimEl).not.toHaveClass(/aiming/);
  await t.move(3, press0.x + 45, press0.y, { steps: 3, stepMs: 20 });
  await expect(aimEl).toHaveClass(/aiming/);
  await expect(aimEl).not.toHaveClass(/cancel/);
  await expect.poll(async () => angleGap((await selfTruth(s)).face, 0), POLL).toBeLessThan(0.03);
  const off3 = truthLogSize();
  const n3 = (await rec.entries()).length;
  await t.up(3);
  const dragFrames = await framesAfterPress(rec, n3, BTN.ATTACK, 12);
  expect(countPressed(dragFrames, BTN.ATTACK)).toBe(1);
  const fired = dragFrames.find((f) => (f.pressed & BTN.ATTACK) !== 0)!;
  expect(angleGap(fired.aim, 0), '끌어 놓은 공격 프레임 aim = 끈 방향').toBeLessThan(AIM_EPS);
  const w3 = await windupSince(s, off3);
  expect(angleGap(w3.monster!.aim, 0), `서버 공격 방향 ${w3.monster!.aim.toFixed(3)}`).toBeLessThan(0.06);

  await t.up(1);
  await t.detach();
  expect((await pointerCounts(page))['pointercancel:touch'] ?? 0).toBe(0);
  expect(s.problems).toEqual([]);
  await s.context.close();
});

test('탭 공격 조준 보정: 화면에 보이는 생존자 쪽으로 12°까지만 돌고, 같은 자리라도 시야 밖(추적 모드 부채꼴 밖)이면 돌지 않는다', async ({
  browser,
}) => {
  test.setTimeout(150_000);
  const s = await soloMatch(browser, PHONE, 'monster');
  const { page } = s;
  const others = await freezeOthers(s);
  // 생존자 하나만 가까이: 지금 방향(동쪽)에서 28° · 1.6타일 — 탐색 부채꼴(±55°) 안, 추적 부채꼴(±25°) · 근접 원(1.5) 밖
  const target = {
    x: OPEN.x + Math.cos(28 * DEG) * 1.6,
    y: OPEN.y + Math.sin(28 * DEG) * 1.6,
  };
  for (const [i, id] of others.entries())
    await placeFrozen(s, id, i === 0 ? target.x : 4 + i, i === 0 ? target.y : 28);
  const t = await MultiTouch.attach(page);
  // 동쪽(0)을 보고 선다: 이동 스틱을 놓고 있으면 마지막 이동 방향을 계속 조준한다
  await standFacingEast(s, t, OPEN);
  const aim = await waitForTouchTarget(page, 'aim-stick');
  const mode = await waitForTouchTarget(page, 'mode');
  const c = centerOf(aim);
  const mc = centerOf(mode);
  const rec = await recordInputs(page, 100);

  // ① 추적 모드: 그 생존자는 스냅샷에 오지 않고 화면에도 없다 → 탭 공격은 지금 방향 그대로
  await t.tap(4, mc.x, mc.y);
  await expect
    .poll(async () => {
      const m = (await truth(page, s.code)).monster;
      return m?.mode === 'hunt' && m.blend === 1;
    }, POLL)
    .toBe(true);
  await waitSeen(page, 0);
  expect((await truth(page, s.code)).players.find((p) => p.id === others[0])).toMatchObject({
    status: 'free',
  });
  await waitAttackReady(page);
  const off1 = truthLogSize();
  const n1 = (await rec.entries()).length;
  await t.tap(2, c.x, c.y, 60);
  const hidden = await framesAfterPress(rec, n1, BTN.ATTACK, 12);
  expect(countPressed(hidden, BTN.ATTACK)).toBe(1);
  expect(hidden.filter((f) => angleGap(f.aim, 0) > 1e-6).map((f) => f.aim)).toEqual([]);
  const w1 = await windupSince(s, off1);
  expect(angleGap(w1.monster!.aim, 0), `시야 밖: 서버 공격 방향 ${w1.monster!.aim}`).toBeLessThan(0.002);

  // ② 탐색 모드로 돌아오면 같은 자리의 생존자가 보인다 → 탭 공격이 그쪽으로 12°(상한)만 돈다: 보정한 aim을 한 프레임 먼저 보내고 공격
  await t.tap(4, mc.x, mc.y);
  await expect
    .poll(async () => {
      const m = (await truth(page, s.code)).monster;
      return m?.mode === 'search' && m.blend === 0;
    }, POLL)
    .toBe(true);
  await waitSeen(page, 1);
  await waitAttackReady(page);
  const off2 = truthLogSize();
  const n2 = (await rec.entries()).length;
  await t.tap(2, c.x, c.y, 60);
  const seen = await framesAfterPress(rec, n2, BTN.ATTACK, 12);
  expect(countPressed(seen, BTN.ATTACK)).toBe(1);
  const k = seen.findIndex((f) => (f.pressed & BTN.ATTACK) !== 0);
  const want = ASSIST.maxTurnDeg * DEG;
  expect(k, '보정한 aim을 보낸 프레임이 공격 프레임 앞에 있다').toBeGreaterThan(0);
  expect(seen[k - 1]!.pressed & BTN.ATTACK).toBe(0);
  expect(angleGap(seen[k - 1]!.aim, want), `앞 프레임 aim ${seen[k - 1]!.aim}`).toBeLessThan(0.5 * DEG);
  expect(angleGap(seen[k]!.aim, want)).toBeLessThan(0.5 * DEG);
  // 보정하기 전 프레임들은 지금 방향 그대로였다 (탭 전에 미리 돌지 않는다)
  expect(seen.slice(0, k - 1).filter((f) => angleGap(f.aim, 0) > 1e-6)).toEqual([]);
  const w2 = await windupSince(s, off2);
  expect(angleGap(w2.monster!.aim, want), `보이는 생존자: 서버 공격 방향 ${w2.monster!.aim}`).toBeLessThan(
    1 * DEG,
  );
  // 생존자 쪽(28°)을 다 맞추지는 않는다
  expect(angleGap(w2.monster!.aim, 28 * DEG)).toBeGreaterThan(15 * DEG);

  await t.detach();
  expect((await pointerCounts(page))['pointercancel:touch'] ?? 0).toBe(0);
  expect(s.problems).toEqual([]);
  await s.context.close();
});

/** 저장한 설정 (decoy:settings 원문) */
const settingsOf = (page: Page): Promise<string | null> =>
  page.evaluate(() => localStorage.getItem('decoy:settings'));

test("설정 조작 탭 '공격 버튼': 조이스틱 줄 뒤에 있고 기본은 끌어서 조준, 누르면 바로를 고르면 그 칸만 저장 · 새로고침 뒤에도 그대로 · 기본값이면 저장값 삭제", async ({
  browser,
}) => {
  const { context, page, problems } = await newPlayerPage(browser, PHONE);
  await context.addInitScript(stubFullscreen);
  const pressedSeg = async (): Promise<string> =>
    (await page.getByTestId('attack-button-instant').getAttribute('aria-pressed')) === 'true'
      ? 'instant'
      : (await page.getByTestId('attack-button-drag').getAttribute('aria-pressed')) === 'true'
        ? 'drag'
        : 'none';

  // ── 첫 화면 설정 → 조작 탭: 조이스틱 투명도 바로 뒤 줄, 기본은 끌어서 조준 ──
  await page.goto(`/?${BASE_QUERY.slice(1)}`);
  await openSettings(page, 'controls');
  const rows = await page
    .getByTestId('settings-page-controls')
    .locator('[data-testid^="row-"]:visible')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
  expect(rows.slice(0, 3)).toEqual(['row-stick-size', 'row-stick-clear', 'row-attack-button']);
  const row = page.getByTestId('row-attack-button');
  await expect(row).toContainText(SETTINGS_TEXT.attackButton);
  await expect(row).toContainText(SETTINGS_TEXT.attackButtonHint);
  await expect(page.getByTestId('attack-button-drag')).toHaveText(SETTINGS_TEXT.attackButtonDrag);
  await expect(page.getByTestId('attack-button-instant')).toHaveText(SETTINGS_TEXT.attackButtonInstant);
  expect(await pressedSeg()).toBe('drag');
  await expect(page.getByTestId('reset-attack-button')).toBeDisabled();
  expect(await settingsOf(page)).toBeNull();
  // 터치 대상 48px 이상
  for (const id of ['attack-button-drag', 'attack-button-instant', 'reset-attack-button'])
    expect((await page.getByTestId(id).boundingBox())!.height, id).toBeGreaterThanOrEqual(48);
  // 누르면 바로: 이 칸만 저장된다
  await chooseSetting(page, 'controls', 'attack-button-instant');
  expect(await pressedSeg()).toBe('instant');
  expect(JSON.parse((await settingsOf(page)) ?? 'null')).toEqual({ v: 1, attackButton: 'instant' });
  // 닫았다 다시 열어도 그대로
  await closeSettings(page);
  await openSettings(page, 'controls');
  expect(await pressedSeg()).toBe('instant');
  // 새로고침(새 접속) 뒤에도 그대로, 줄의 '기본값'은 끌어서 조준으로 되돌리고 저장값을 지운다
  await page.reload();
  await openSettings(page, 'controls');
  expect(await pressedSeg()).toBe('instant');
  await press(page.getByTestId('reset-attack-button'));
  await expect(page.getByTestId('attack-button-drag')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('reset-attack-button')).toBeDisabled();
  expect(await settingsOf(page)).toBeNull();
  expect(problems).toEqual([]);
  await context.close();
});

test("'누르면 바로'로 바꾼 뒤의 판: 판 직전 안내가 바뀌고, 닿는 순간 공격 · 끌기는 무시 · 뗄 때 아무것도 없음 · 보이는 생존자 쪽 보정", async ({
  browser,
}) => {
  test.setTimeout(150_000);
  const s = await soloMatch(browser, PHONE, 'monster', async (lobby) => {
    // 준비한 채 기다리는 방 화면: 판 직전 터치 안내는 끌어서 조준 문구. 떠 있는 동안 설정에서 바꾸면 둘째 줄이 바로 바뀐다
    const lines = lobby.getByTestId('touch-tutorial').locator('li');
    await expect(lines).toHaveText([...tutorialLines('monster', false, 'drag')]);
    await chooseSetting(lobby, 'controls', 'attack-button-instant');
    expect(JSON.parse((await settingsOf(lobby)) ?? 'null')).toEqual({ v: 1, attackButton: 'instant' });
    await closeSettings(lobby);
    await expect(lines).toHaveText([...tutorialLines('monster', false, 'instant')]);
  });
  const { page } = s;
  const others = await freezeOthers(s);
  for (const [i, id] of others.entries()) await placeFrozen(s, id, 30 + i, 2);
  const t = await MultiTouch.attach(page);
  // 동쪽(0)을 보고 선다: 조준 = 마지막 이동 방향
  await standFacingEast(s, t, RIGHT_LANE);
  await waitSeen(page, 0);
  const aim = await waitForTouchTarget(page, 'aim-stick');
  const aimEl = page.locator('[data-touch-target="aim-stick"]');
  // 방향 표시가 없다 (끌어서 조준하는 버튼이 아니다)
  await expect(aimEl.locator('.tc-dir')).toBeHidden();
  const c = centerOf(aim);
  const rec = await recordInputs(page, 100);

  // ① 가운데를 비켜 누른 채로 있는다: 떼지 않아도 공격이 나간다, 지금 방향(동쪽)으로
  await waitAttackReady(page);
  const off1 = truthLogSize();
  const n1 = (await rec.entries()).length;
  await t.down(2, c.x - 20, c.y + 15);
  const held = await framesAfterPress(rec, n1, BTN.ATTACK, 4);
  expect(t.active, '아직 누르고 있다').toContain(2);
  expect(countPressed(held, BTN.ATTACK)).toBe(1);
  const w1 = await windupSince(s, off1);
  expect(angleGap(w1.monster!.aim, 0), `서버 공격 방향 ${w1.monster!.aim}`).toBeLessThan(0.002);
  // ② 누른 채 45px 끌어도 조준은 그대로 (조준 표시도 없다)
  const n2 = (await rec.entries()).length;
  await t.move(2, c.x - 20, c.y + 60, { steps: 5, stepMs: 20 });
  await expect(aimEl).not.toHaveClass(/aiming/);
  await moreFrames(rec, n2, 12);
  // ③ 쿨타임이 끝난 뒤에 뗀다: 떼는 동작은 아무것도 내지 않는다 (쿨타임이라 안 나간 것이 아니다)
  await waitAttackReady(page);
  const n3 = (await rec.entries()).length;
  await t.up(2);
  await moreFrames(rec, n3, 15);
  const all = (await rec.entries()).slice(n1);
  expect(countPressed(all, BTN.ATTACK), '누른 한 번만').toBe(1);
  expect(all.filter((f) => angleGap(f.aim, 0) > 1e-6).map((f) => f.aim)).toEqual([]);
  expect(all.filter((f) => f.mx !== 0 || f.my !== 0)).toEqual([]);

  // ④ 보이는 생존자가 20° 옆 1.2타일: 누르는 순간의 공격이 그쪽으로 절반(10°)만 돈다
  await placeFrozen(
    s,
    others[0]!,
    RIGHT_LANE.x + Math.cos(20 * DEG) * 1.2,
    RIGHT_LANE.y + Math.sin(20 * DEG) * 1.2,
  );
  await waitSeen(page, 1);
  await waitAttackReady(page);
  const off4 = truthLogSize();
  const n4 = (await rec.entries()).length;
  await t.down(2, c.x, c.y);
  const assisted = await framesAfterPress(rec, n4, BTN.ATTACK, 4);
  expect(t.active).toContain(2);
  expect(countPressed(assisted, BTN.ATTACK)).toBe(1);
  const w4 = await windupSince(s, off4);
  expect(angleGap(w4.monster!.aim, 10 * DEG), `보정한 서버 공격 방향 ${w4.monster!.aim}`).toBeLessThan(
    1 * DEG,
  );
  await t.up(2);

  // ⑤ 점수판 조작 안내도 판 시작 때 읽은 방식('누르면 바로')의 줄이다: 공격 버튼 줄이 있고, 끌어서 조준 줄(놓으면 · 취소)은 없다
  const board = await openScoreboard(page, t);
  expect(board.ctrlShown, '915×412는 조작 안내 줄을 보인다').toBe(true);
  expect(board.texts).toContain('공격 버튼');
  expect(board.texts).toContain(CONTROLS_TOUCH_INSTANT[1]!.split('  ')[1]);
  expect(board.texts.filter((x) => /놓으면|취소|짧게 탭/.test(x))).toEqual([]);
  await t.detach();
  expect((await pointerCounts(page))['pointercancel:touch'] ?? 0).toBe(0);
  expect(s.problems).toEqual([]);

  await s.context.close();
});

test('PC 클릭에는 보정이 없다: 보이는 생존자가 20° 옆에 있어도 마우스가 가리키는 방향 그대로 공격', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const s = await soloMatch(browser, undefined, 'monster');
  const { page } = s;
  const others = await freezeOthers(s);
  for (const [i, id] of others.entries())
    await placeFrozen(
      s,
      id,
      i === 0 ? OPEN.x + Math.cos(20 * DEG) * 1.2 : 4 + i,
      i === 0 ? OPEN.y + Math.sin(20 * DEG) * 1.2 : 28,
    );
  await placeSelf(s, OPEN.x, OPEN.y, 0);
  await waitSeen(page, 1);
  // 마우스를 정동쪽 4타일 앞에 둔다 (조준 0°). 터치 탭이면 10° 돌았을 배치다
  await aimMonsterAt(page, OPEN.x + 4, OPEN.y);
  await waitAttackReady(page);
  const rec = await recordInputs(page, 100);
  const off = truthLogSize();
  await page.mouse.down();
  await page.mouse.up();
  const frames = await framesAfterPress(rec, 0, BTN.ATTACK, 6);
  expect(countPressed(frames, BTN.ATTACK)).toBe(1);
  const w = await windupSince(s, off);
  expect(angleGap(w.monster!.aim, 0), `PC 공격 방향 ${w.monster!.aim}`).toBeLessThan(1 * DEG);
  expect(frames.filter((f) => angleGap(f.aim, 0) > 1 * DEG).map((f) => f.aim)).toEqual([]);
  expect(s.problems).toEqual([]);
  await s.context.close();
});

test('점수판 조작 안내(터치 괴물, 끌어서 조준): 작은 휴대폰 가로에서 UI 크기를 키워도 점수판이 화면 안이고 폭이 TOUCH_BOARD_W × 배율 이하', async ({
  browser,
}) => {
  test.setTimeout(150_000);
  // 조작 안내 블록은 열 단위로 폭을 잰다(첫 열 최대 폭 + 둘째 열) — 둘째 줄 첫 칸이 길어지면 첫 줄 둘째 칸이 밀려 패널 전체가
  // 넓어진다. layout.touchHudFits는 점수판 최대 폭을 TOUCH_BOARD_W로 보고 UI 크기를 고르므로 그보다 넓으면 화면 밖으로 나간다
  // (667×375 = 아이폰 8 · SE 2/3 가로, 568×320 = 가장 좁은 가로)
  for (const c of [
    { w: 667, h: 375, ui: 'xlarge' },
    { w: 568, h: 320, ui: 'large' },
  ] as const) {
    const name = `${c.w}×${c.h} UI ${c.ui}`;
    const s = await soloMatch(browser, smallPhone(c.w, c.h), 'monster', async (lobby) => {
      await chooseSetting(lobby, 'screen', `ui-size-${c.ui}`);
      await closeSettings(lobby);
    });
    const t = await MultiTouch.attach(s.page);
    const b = await openScoreboard(s.page, t);
    expect(b.ui, `${name}: UI 크기를 키운 배치가 적용됐다`).toBeGreaterThan(1.05);
    expect(b.box.x, `${name}: 점수판 왼쪽 끝`).toBeGreaterThanOrEqual(0);
    expect(b.box.x + b.box.w, `${name}: 점수판 오른쪽 끝`).toBeLessThanOrEqual(c.w);
    // 그림 단위 × (CSS px / 그림 단위). 글자 크기 반올림(0.1 논리 px) 여유 1%
    expect(b.box.w, `${name}: 점수판 폭`).toBeLessThanOrEqual(TOUCH_BOARD_W * TOUCH_UI.art * b.ui * 1.01);
    if (b.ctrlShown) expect(b.texts, `${name}: 끌어서 조준 줄`).toContain('오른쪽 스틱을 놓으면');
    await t.detach();
    expect(s.problems, name).toEqual([]);
    await s.context.close();
  }
});

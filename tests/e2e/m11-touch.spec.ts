// M11 터치 기능 시험 (MOBILE_PLAN M11 자동 검증 'E2E m11-touch'): 휴대폰 가로 에뮬레이션(기능 시험은 기기 배율 1)에서
// 감지 · 멀티터치(왼쪽 이동 + 오른쪽 조준, 조준 스틱만 떼면 공격 1번) · 오입력 회귀 · 터치 대상 크기와 자리 ·
// 브라우저 기본 동작 막기 · 세로 안내 · 전체 화면 호출 시점 · 결과 화면 레이어 · 오디오 열기.
// 혼자 봇 방(?bots=1)에서 판을 시작해 빠르게 돈다. 판정은 서버 정답(/test/state, 틱마다 쓰는 정답 기록 truth.jsonl)으로 본다.
// 느린 CI 대비: 간격 폴링(100~200ms), 시간 창은 고정 sleep 대신 입력 프레임 수 · 서버 틱 수로 재고, 시간이 지나 바뀌는 판 상태
// (괴물 위치 · 대기)는 시험 동작 직전에 시험 명령으로 다시 맞춘다
import { closeSync, openSync, readSync, statSync } from 'node:fs';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { BTN, angleDiff, type InputLogEntry, type Role } from '@decoy/shared';
import { TOUCH } from '../../client/src/touchInput';
import {
  LANDSCAPE_DEVICES,
  PC_NARROW,
  PHONE_LANDSCAPE,
  PHONE_SMALL,
  TABLET_LANDSCAPE,
  countPressed,
  createRoom,
  dpr1,
  inputLog,
  myId,
  newPlayerPage,
  pickRoleAndReady,
  pointerCounts,
  portrait,
  press,
  recordInputs,
  sendTest,
  truth,
  waitForSnapshots,
  type DeviceOptions,
  type TruthFrame,
} from './helpers';
import {
  MultiTouch,
  centerOf,
  emulateSafeArea,
  measureTouchLayout,
  stickPoint,
  touchLayoutProblems,
  touchTargets,
  viewportScale,
  waitForTouchTarget,
  type TouchLayout,
} from './touch';

/** 기능 시험 기기: Pixel 7 가로 전체 화면 915×412, 기기 배율 1 */
const PHONE = dpr1(PHONE_LANDSCAPE);
/** 간격 폴링 (느린 CI에서 rAF 폴링 · 촘촘한 폴링을 피한다) */
const POLL = { intervals: [100, 150, 200], timeout: 20_000 };
/** 조준 스틱으로 겨누는 각도: 오른쪽 아래 45° (이동 방향 위 = -90°와 135° 다르다) */
const THETA = Math.PI / 4;
/** 입력 프레임 aim 허용 오차 (손가락 좌표가 정수 px로 반올림되어 스틱 반지름 57px에서 약 0.01rad 흔들린다) */
const AIM_EPS = 0.03;
/** 위로 곧게 트인 줄: x 41.5, y 22 → 1 (오른쪽 방 가장자리, 기둥 · 벽 없음) */
const UP_LANE = { x: 41.5, y: 21.5 };
/** 아래로 곧게 트인 줄: x 40.5, y 10 → 30 */
const DOWN_LANE = { x: 40.5, y: 10.5 };
/** 오른쪽으로 곧게 트인 줄: y 24.5, x 1 → 22 */
const RIGHT_LANE = { x: 4.5, y: 24.5 };

const MONSTER_TARGETS = ['move-zone', 'aim-stick', 'dash', 'roar', 'mode', 'scoreboard'];
const SURVIVOR_TARGETS = ['move-zone', 'ability', 'rescue', 'scoreboard'];
/** 브라우저 안 · 전체 화면 API가 있으면 터치 HUD에 더 생긴다 (전체 화면 중에는 숨는다) */
const OPTIONAL_TARGETS = ['fullscreen'];

// ───────────── 정답 기록 (truth.jsonl, 서버가 틱마다 한 줄씩 덧붙인다) ─────────────

/** playwright.config.ts의 TRUTH_LOG (m3-info와 같은 경로, 저장소 루트 기준) */
const TRUTH_LOG = 'tests/e2e/.results/truth.jsonl';

function truthLogSize(): number {
  return statSync(TRUTH_LOG).size;
}

/** 정답 기록에서 offset 바이트 뒤에 쓰인 이 방의 틱들 (쓰는 중인 마지막 줄은 건너뛴다) */
function truthSince(offset: number, room: string): TruthFrame[] {
  const size = truthLogSize();
  if (size <= offset) return [];
  const buf = Buffer.alloc(size - offset);
  const fd = openSync(TRUTH_LOG, 'r');
  try {
    readSync(fd, buf, 0, buf.length, offset);
  } finally {
    closeSync(fd);
  }
  const out: TruthFrame[] = [];
  for (const line of buf.toString('utf8').split('\n')) {
    if (!line.includes(`"room":"${room}"`)) continue;
    try {
      out.push(JSON.parse(line) as TruthFrame);
    } catch {
      // 아직 다 쓰지 않은 줄
    }
  }
  return out;
}

// ───────────── 혼자 봇 방에서 판 시작 ─────────────

interface Solo {
  context: BrowserContext;
  page: Page;
  problems: string[];
  code: string;
  id: string;
}

interface SoloOptions {
  /** 주소에 덧붙일 것 (예: '&touch=0') */
  query?: string;
  /** 안전 영역 흉내 (CSS px). 터치 화면은 만들 때 안전 영역을 읽으므로 판 시작 전(방 화면)에 정한다 */
  safeArea?: { top?: number; right?: number; bottom?: number; left?: number };
  /** 페이지 스크립트보다 먼저 돌릴 기록 스크립트 */
  inits?: (() => void)[];
  /** 방 화면(역할 · 준비 뒤)에서 시작 전에 */
  inLobby?: (page: Page) => Promise<void>;
}

type FsCall = {
  kind: string;
  ev: string | null;
  pointer: string | null;
  phase: string | null;
  inGame: boolean;
};

/**
 * 가짜 전체 화면 · 가로 고정: 부른 때를 기록하고 아무것도 하지 않는다. 헤드리스 크롬에서도 진짜 requestFullscreen이
 * 성공해(로비 준비 탭에서, html.fs) 터치 HUD의 전체 화면 버튼이 숨고, 실기기처럼 창 크기가 바뀌면 손가락이 취소되어 시험마다
 * 상태가 달라진다. 그래서 모든 판에서 쓴다(배치 검사는 전체 화면 버튼까지 있는 더 빽빽한 배치를 본다).
 * 그때의 이벤트 종류(window.event)로 사용자 탭 핸들러 안인지, 서버 메시지 핸들러('message')인지 가린다
 */
function stubFullscreen(): void {
  const calls: FsCall[] = [];
  (window as unknown as { __e2eFs: FsCall[] }).__e2eFs = calls;
  const rec = (kind: string): void => {
    const ev = window.event as (Event & { pointerType?: string }) | undefined;
    calls.push({
      kind,
      ev: ev?.type ?? null,
      pointer: ev?.pointerType ?? null,
      phase: window.__DECOY__?.phase ?? null,
      inGame: document.querySelector('.touch-layer') !== null,
    });
  };
  Element.prototype.requestFullscreen = function () {
    rec('fullscreen');
    return Promise.resolve();
  };
  if (typeof ScreenOrientation !== 'undefined') {
    (ScreenOrientation.prototype as unknown as { lock: () => Promise<void> }).lock = () => {
      rec('lock');
      return Promise.resolve();
    };
  }
}

async function fsCalls(page: Page): Promise<FsCall[]> {
  return page.evaluate(() => (window as unknown as { __e2eFs: FsCall[] }).__e2eFs.slice());
}

/** 봇 방을 만들어 역할을 고르고 혼자 시작한다 (빈 역할은 서버 봇). 터치 기기는 로비를 탭으로 */
async function soloMatch(
  browser: Browser,
  device: DeviceOptions | undefined,
  role: Role,
  opts: SoloOptions = {},
): Promise<Solo> {
  const { context, page, problems } = await newPlayerPage(browser, device);
  for (const init of [stubFullscreen, ...(opts.inits ?? [])]) await context.addInitScript(init);
  const code = await createRoom(page, `&bots=1${opts.query ?? ''}`);
  await pickRoleAndReady(page, role);
  if (opts.safeArea) await emulateSafeArea(page, opts.safeArea);
  await opts.inLobby?.(page);
  await press(page.getByTestId('start-button'));
  await waitForSnapshots(page, 3);
  return { context, page, problems, code, id: await myId(page) };
}

/** 나 말고 모두(봇) 멈춘다: 순찰 봇이 시험하는 줄에 들어오지 않게 */
async function freezeOthers(s: Solo): Promise<void> {
  const tr = await truth(s.page, s.code);
  for (const p of tr.players)
    if (p.id !== s.id) await sendTest(s.page, { kind: 'freeze', target: p.id, frozen: true });
}

/**
 * 스틱을 잡고 (x, y)에서 멀어지는 중에 내 캐릭터를 (x, y)로 되돌린다. 서버는 밀린 입력을 한 틱에 최대 4개까지 처리하므로
 * (부하가 걸린 러너) 되돌린 첫 틱에도 이미 몇 걸음 가 있을 수 있다. 그래서 틱마다 쓰는 정답 기록에서 '보내기 전보다 1타일 넘게
 * 가까워진' 틱을 찾는다 — 멀어지는 움직임으로는 생길 수 없다. 보내기 전 자리가 2타일 넘게 떨어져 있어야 한다
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
 * 내 캐릭터를 (x, y)로 옮기고 바라보는 방향을 정한다. 서버 정답과 내 예측이 그 자리에 오고 시작 대기(괴물 5초)가
 * 풀릴 때까지 기다린다 (teleport는 시작 대기를 푼다)
 */
async function placeSelf(s: Solo, x: number, y: number, face: number): Promise<void> {
  await sendTest(s.page, { kind: 'teleport', target: s.id, x, y, face });
  await expect
    .poll(async () => {
      const me = (await truth(s.page, s.code)).players.find((p) => p.id === s.id);
      return me !== undefined && Math.hypot(me.x - x, me.y - y) < 0.05;
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

async function selfTruth(s: Solo): Promise<{ x: number; y: number; face: number; tick: number }> {
  const tr = await truth(s.page, s.code);
  const me = tr.players.find((p) => p.id === s.id);
  if (!me) throw new Error('정답에 내가 없음');
  return { x: me.x, y: me.y, face: me.face, tick: tr.tick };
}

/** 서버가 n틱 더 돌 때까지 (시간 창을 서버 시계로 잰다 — 느린 러너에서도 같은 양) */
async function waitServerTicks(s: Solo, n: number): Promise<void> {
  const from = (await truth(s.page, s.code)).tick;
  await expect.poll(async () => (await truth(s.page, s.code)).tick - from, POLL).toBeGreaterThanOrEqual(n);
}

const angleGap = (a: number, b: number): number => Math.abs(angleDiff(a, b));

/** 입력 프레임이 '위로 최고 속도'인가 (mx 0 · my -1) */
const isUp = (f: InputLogEntry): boolean => Math.abs(f.mx) < 1e-9 && Math.abs(f.my + 1) < 1e-9;

// ───────────── 감지 ─────────────

test('감지: 휴대폰은 터치 화면, PC는 터치 대상 0개, ?touch=1 · ?touch=0으로 강제', async ({ browser }) => {
  test.setTimeout(150_000);
  const cases: { name: string; device: DeviceOptions | undefined; query: string; touch: boolean }[] = [
    { name: '휴대폰', device: PHONE, query: '', touch: true },
    { name: 'PC', device: undefined, query: '', touch: false },
    { name: 'PC ?touch=1', device: undefined, query: '&touch=1', touch: true },
    { name: '휴대폰 ?touch=0', device: PHONE, query: '&touch=0', touch: false },
  ];
  for (const c of cases) {
    const s = await soloMatch(browser, c.device, 'runner', {
      query: c.query,
      // 로비에는 터치 대상이 없다 (전체 화면 버튼은 data-touch-target이 없다)
      inLobby: async (page) => expect(await touchTargets(page), c.name).toEqual([]),
    });
    const { page } = s;
    if (c.touch) await waitForTouchTarget(page, 'move-zone');
    const state = await page.evaluate(() => ({
      mode: window.__DECOY__?.inputMode,
      layers: document.querySelectorAll('.touch-layer').length,
      htmlTouch: document.documentElement.classList.contains('touch'),
    }));
    expect(state, c.name).toEqual({
      mode: c.touch ? 'touch' : 'keyboard',
      layers: c.touch ? 1 : 0,
      htmlTouch: c.touch,
    });
    const ids = (await touchTargets(page)).map((t) => t.id);
    if (c.touch) expect(ids, c.name).toEqual(expect.arrayContaining(SURVIVOR_TARGETS));
    else expect(ids, c.name).toEqual([]);
    if (!c.touch) {
      // 터치 화면이 없어도(휴대폰 ?touch=0 포함) 키보드는 그대로
      await placeSelf(s, RIGHT_LANE.x, RIGHT_LANE.y, 0);
      await page.keyboard.down('KeyD');
      await expect
        .poll(async () => {
          const e = (await inputLog(page)).at(-1);
          return e ? `${e.mx},${e.my},${e.mode}` : null;
        }, POLL)
        .toBe('1,0,keyboard');
      await page.keyboard.up('KeyD');
    }
    expect(s.problems, c.name).toEqual([]);
    await s.context.close();
  }
});

// ───────────── 멀티터치 ─────────────

test('멀티터치: 괴물이 왼쪽 스틱 위 + 조준 스틱 θ → my -1 · aim θ, 서버에서 위로 가며 face가 θ로, 조준 스틱만 떼면 ATTACK 1번 · 공격 준비 · 이동은 계속', async ({
  browser,
}) => {
  test.setTimeout(150_000);
  const s = await soloMatch(browser, PHONE, 'monster');
  const { page } = s;
  await freezeOthers(s);
  // 서쪽을 보게 두고(θ와 135° 차이) 위로 트인 줄에 둔다. 시작 대기 5초도 이것으로 풀린다
  await placeSelf(s, UP_LANE.x, UP_LANE.y, Math.PI);
  const zone = await waitForTouchTarget(page, 'move-zone');
  const aim = await waitForTouchTarget(page, 'aim-stick');
  const t = await MultiTouch.attach(page);
  const rec = await recordInputs(page, 100);

  // 왼손: 이동 스틱을 위로 (스틱 반지름 63px보다 멀리 = 길이 1)
  const z = { x: zone.x + zone.w * 0.5, y: zone.y + zone.h * 0.65 };
  await t.down(1, z.x, z.y);
  await t.move(1, z.x, z.y - 90, { steps: 6, stepMs: 20 });
  // 오른손: 조준 스틱을 θ로 (반지름의 0.9 = 데드존 밖)
  const c = centerOf(aim);
  await t.down(2, c.x, c.y);
  const p = stickPoint(aim, THETA, 0.9);
  await t.move(2, p.x, p.y, { steps: 5, stepMs: 20 });

  // 입력 로그: 두 손이 같은 프레임에 (my -1, aim θ)
  await expect
    .poll(async () => {
      const e = (await inputLog(page)).at(-1);
      return e !== undefined && isUp(e) && angleGap(e.aim, THETA) < AIM_EPS;
    }, POLL)
    .toBe(true);
  const both = (await inputLog(page)).at(-1)!;
  expect(both.mode).toBe('touch');
  // 서버 정답: 위로 곧게 움직이고(되돌리기를 알아볼 수 있게 2타일 넘게) face가 θ로 수렴
  await expect
    .poll(async () => {
      const me = await selfTruth(s);
      return UP_LANE.y - me.y > 2 && Math.abs(me.x - UP_LANE.x) < 0.1 && angleGap(me.face, THETA) < 0.03;
    }, POLL)
    .toBe(true);

  // 오른손만 떼기 직전에 줄 아래로 다시 맞춘다 (느린 러너에서 그 사이 위쪽 벽에 닿지 않게). 방향은 θ 그대로
  await teleportWhileMoving(s, UP_LANE.x, UP_LANE.y, THETA);
  const truthOffset = truthLogSize();
  const before = (await rec.entries()).length;
  const releasedAt = await page.evaluate(() => performance.now());
  await t.up(2);

  // ATTACK이 나가고 그 뒤로 프레임이 20개(약 0.7초) 더 쌓일 때까지: 두 번 나가지 않는지 볼 창을 프레임 수로 잰다
  let frames: InputLogEntry[] = [];
  await expect
    .poll(async () => {
      frames = await rec.entries();
      const after = frames.slice(before);
      const i = after.findIndex((f) => (f.pressed & BTN.ATTACK) !== 0);
      return i >= 0 && after.length - i > 20;
    }, POLL)
    .toBe(true);
  expect(countPressed(frames, BTN.ATTACK)).toBe(1);
  for (const bit of [BTN.DASH, BTN.MODE, BTN.ROAR]) expect(countPressed(frames, bit)).toBe(0);
  const fire = frames.find((f) => (f.pressed & BTN.ATTACK) !== 0)!;
  // 낸 프레임까지 aim = θ, 이동은 그대로 위
  expect(angleGap(fire.aim, THETA)).toBeLessThan(AIM_EPS);
  const afterRelease = frames.slice(before);
  expect(afterRelease.filter((f) => !isUp(f))).toEqual([]);

  // 서버 정답: 공격 준비(windup)가 한 번, θ 쪽으로(±10°), 준비가 시작된 뒤에도 계속 위로 움직인다
  const myY = (f: TruthFrame): number => f.players.find((q) => q.id === s.id)!.y;
  await expect
    .poll(() => truthSince(truthOffset, s.code).filter((f) => (f.monster?.windup ?? 0) > 0).length, POLL)
    .toBeGreaterThanOrEqual(10);
  const windup = truthSince(truthOffset, s.code).filter((f) => (f.monster?.windup ?? 0) > 0);
  const ticks = windup.map((f) => f.tick);
  expect(ticks.at(-1)! - ticks[0]!, '공격 준비 구간이 하나').toBe(ticks.length - 1);
  expect(angleGap(windup[0]!.monster!.aim, THETA)).toBeLessThanOrEqual(TOUCH.aimTolerance + 0.01);
  const windupY = myY(windup[0]!);
  await expect
    .poll(
      () => truthSince(truthOffset, s.code).some((f) => f.tick > ticks[0]! && myY(f) < windupY - 1.5),
      POLL,
    )
    .toBe(true);

  await t.up(1);
  await t.detach();
  const counts = await pointerCounts(page);
  expect(counts['pointercancel:touch'] ?? 0).toBe(0);
  console.log(
    `[m11-touch] 멀티터치: 두 손 프레임 mx ${both.mx} my ${both.my} aim ${both.aim.toFixed(3)} (θ ${THETA.toFixed(3)}), ` +
      `뗀 뒤 ATTACK까지 ${(fire.t - releasedAt).toFixed(0)}ms, 서버 windup ${windup.length}틱 · aim ${windup[0]!.monster!.aim.toFixed(3)}`,
  );
  expect(s.problems).toEqual([]);
  await s.context.close();
});

test('오입력 회귀: 왼쪽 스틱만 2초 끌어도 ATTACK · MODE 0, 조준은 이동 방향을 따르고 손가락 자리를 따라가지 않음', async ({
  browser,
}) => {
  test.setTimeout(150_000);
  const s = await soloMatch(browser, PHONE, 'monster');
  const { page } = s;
  await freezeOthers(s);
  await placeSelf(s, DOWN_LANE.x, DOWN_LANE.y, 0);
  const zone = await waitForTouchTarget(page, 'move-zone');
  const t = await MultiTouch.attach(page);
  const rec = await recordInputs(page, 100);
  const z = { x: zone.x + zone.w * 0.5, y: zone.y + zone.h * 0.3 };
  await t.down(1, z.x, z.y);
  const start = (await rec.entries()).length;
  // 아래로 끌고 좌우로 흔든다 (남남서 ↔ 남남동, 모두 데드존 밖)
  await t.move(1, z.x, z.y + 90, { steps: 6, stepMs: 20 });
  for (const dx of [-45, 45, -45, 45, 0]) await t.move(1, z.x + dx, z.y + 90, { steps: 4, stepMs: 30 });
  // 2초 = 입력 프레임 60개 (느린 러너에서도 프레임 수로 잰다)
  await expect.poll(async () => (await rec.entries()).length - start, POLL).toBeGreaterThanOrEqual(60);
  const finger = t.position(1)!;
  const me = await selfTruth(s);
  const meOnScreen = await page.evaluate(
    ([x, y]) => window.__DECOY__?.tileToClient(x!, y!) ?? null,
    [me.x, me.y],
  );
  await t.up(1);
  // 뗀 뒤에도 10프레임: 늦게 나가는 공격이 없는지
  const upAt = (await rec.entries()).length;
  await expect.poll(async () => (await rec.entries()).length - upAt, POLL).toBeGreaterThanOrEqual(10);
  const frames = (await rec.stop()).slice(start);
  await t.detach();

  expect(frames.length).toBeGreaterThanOrEqual(70);
  for (const bit of [BTN.ATTACK, BTN.MODE, BTN.DASH, BTN.ROAR]) expect(countPressed(frames, bit)).toBe(0);
  const moving = frames.filter((f) => f.mx !== 0 || f.my !== 0);
  expect(moving.length).toBeGreaterThanOrEqual(55);
  // 조준 = 이동 방향 (프레임마다)
  for (const f of moving) expect(angleGap(f.aim, Math.atan2(f.my, f.mx))).toBeLessThan(1e-6);
  // 손가락 자리 쪽 방향(괴물 → 왼손)과 이동 방향(아래)이 충분히 달라서 '따라감'을 가릴 수 있다
  expect(meOnScreen).not.toBeNull();
  const fingerBearing = Math.atan2(finger.y - meOnScreen!.y, finger.x - meOnScreen!.x);
  expect(angleGap(fingerBearing, Math.PI / 2)).toBeGreaterThan(0.6);
  const last = moving.at(-1)!;
  expect(angleGap(last.aim, Math.PI / 2)).toBeLessThan(0.01);
  expect(angleGap(last.aim, fingerBearing)).toBeGreaterThan(0.5);
  // 서버: 아래로 움직였고 face도 아래
  expect(me.y - DOWN_LANE.y).toBeGreaterThan(3);
  expect(angleGap(me.face, Math.PI / 2)).toBeLessThan(0.6);
  // 멈춘 뒤에는 마지막 방향(아래)을 계속 본다 (서버가 밀린 입력을 다 처리할 때까지)
  await expect.poll(async () => angleGap((await selfTruth(s)).face, Math.PI / 2), POLL).toBeLessThan(0.05);
  expect((await pointerCounts(page))['pointercancel:touch'] ?? 0).toBe(0);
  expect(s.problems).toEqual([]);
  await s.context.close();
});

// ───────────── 크기 · 위치 ─────────────

test('크기 · 위치: 휴대폰 4종 · 태블릿 가로에서 모든 터치 대상 48px 이상 · 8px 간격 · 화면 안 · 가장자리 띠 밖 (안전 영역 포함)', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  type Case = {
    name: string;
    device: DeviceOptions;
    role: Role;
    safeArea?: { left?: number; right?: number; bottom?: number };
  };
  const cases: Case[] = [];
  for (const d of LANDSCAPE_DEVICES)
    for (const role of ['monster', 'runner'] as const)
      cases.push({ name: d.name, device: dpr1(d.device), role });
  // 가장 낮은 휴대폰에 안전 영역 (펀치홀 쪽 44px + 제스처 막대 16px): 띠가 안으로 들어온다
  for (const role of ['monster', 'runner'] as const)
    for (const safeArea of [
      { left: 44, bottom: 16 },
      { right: 44, bottom: 16 },
    ])
      cases.push({ name: 'Pixel 5 802×293 + 안전 영역', device: dpr1(PHONE_SMALL), role, safeArea });

  const report: Record<string, unknown>[] = [];
  const check = async (c: Case): Promise<void> => {
    const label = `${c.name} ${c.role}${c.safeArea ? ` ${JSON.stringify(c.safeArea)}` : ''}`;
    const s = await soloMatch(browser, c.device, c.role, { safeArea: c.safeArea });
    await waitForTouchTarget(s.page, 'move-zone');
    const layout: TouchLayout = await measureTouchLayout(s.page);
    expect(layout.insets, label).toEqual({ top: 0, right: 0, bottom: 0, left: 0, ...c.safeArea });
    expect(touchLayoutProblems(layout), label).toEqual([]);
    const ids = layout.targets.map((t) => t.id);
    const want = c.role === 'monster' ? MONSTER_TARGETS : SURVIVOR_TARGETS;
    expect(ids, label).toEqual(expect.arrayContaining(want));
    for (const id of ids) expect([...want, ...OPTIONAL_TARGETS], `${label}: ${id}`).toContain(id);
    // 생존자는 조준 스틱이 없다 (스틱은 괴물 조준 스틱 하나뿐)
    const sticks = layout.targets.filter((t) => t.kind === 'stick').map((t) => t.id);
    expect(sticks, label).toEqual(c.role === 'monster' ? ['aim-stick'] : []);
    // 이동 스틱 영역은 화면 왼쪽 40% 안
    const zone = layout.targets.find((t) => t.id === 'move-zone')!;
    expect(zone.x + zone.w, label).toBeLessThanOrEqual(layout.viewport.w * 0.4 + 0.5);
    const small = layout.targets.filter((t) => t.kind !== 'zone');
    report.push({
      case: label,
      viewport: layout.viewport,
      minSide: Math.min(...small.map((t) => Math.min(t.w, t.h))),
      targets: Object.fromEntries(
        layout.targets.map((t) => [t.id, [t.x, t.y, t.w, t.h].map((v) => +v.toFixed(1))]),
      ),
    });
    expect(s.problems, label).toEqual([]);
    await s.context.close();
  };
  // 두 판씩 나란히 (느린 러너에서 CPU를 너무 나눠 쓰지 않게)
  for (let i = 0; i < cases.length; i += 2) await Promise.all(cases.slice(i, i + 2).map(check));
  console.log(
    `[m11-touch] 가장 작은 버튼 변: ${report.map((r) => `${String(r.case)} ${String(r.minSide)}`).join(' / ')}`,
  );
  await test.info().attach('touch-layout.json', {
    body: JSON.stringify(report, null, 2),
    contentType: 'application/json',
  });
});

// ───────────── 브라우저 기본 동작 ─────────────

type CtxMenu = { target: string; prevented: boolean };

/** 문서에 올라온 contextmenu가 막혔는지 (창 버블 단계 = 앱의 문서 리스너 뒤) */
function recordContextMenu(): void {
  const log: CtxMenu[] = [];
  (window as unknown as { __e2eCtx: CtxMenu[] }).__e2eCtx = log;
  window.addEventListener('contextmenu', (e) => {
    const t = e.target as Element | null;
    log.push({
      target: t?.getAttribute?.('data-touch-target') ?? t?.tagName?.toLowerCase() ?? 'none',
      prevented: e.defaultPrevented,
    });
  });
}

const VIEWPORT_OPEN = 'width=device-width, initial-scale=1';

test('기본 동작: meta viewport · 계산된 CSS, 스틱을 끌어도 pointercancel 0, 길게 눌러도 선택 없음, contextmenu 막힘, 핀치해도 확대 안 됨', async ({
  browser,
}) => {
  test.setTimeout(150_000);
  const s = await soloMatch(browser, PHONE, 'monster', {
    inits: [recordContextMenu],
    inLobby: async (page) => {
      // 로비(방 화면)는 세로 스크롤만, 입력칸(초대 링크)은 글자를 고를 수 있다
      const lobby = await page.evaluate(() => {
        const cs = (sel: string) => {
          const el = document.querySelector(sel);
          return el ? getComputedStyle(el) : null;
        };
        return {
          touchAction: cs('.lobby')?.touchAction,
          linkSelect: cs('[data-testid="room-link"]')?.userSelect,
        };
      });
      expect(lobby).toEqual({ touchAction: 'pan-y', linkSelect: 'text' });
    },
  });
  const { page } = s;
  await freezeOthers(s);
  await placeSelf(s, UP_LANE.x, UP_LANE.y, Math.PI);
  const zone = await waitForTouchTarget(page, 'move-zone');
  const aim = await waitForTouchTarget(page, 'aim-stick');

  // meta viewport: 핀치 · 더블탭 확대 막기
  const meta = await page.evaluate(
    () => document.querySelector('meta[name="viewport"]')?.getAttribute('content') ?? '',
  );
  expect(meta.split(',').map((v) => v.trim())).toEqual(
    expect.arrayContaining(['width=device-width', 'initial-scale=1', 'maximum-scale=1', 'user-scalable=no']),
  );
  // 계산된 CSS: 당겨서 새로고침 · 끝 튕김 없음, 글자 선택 없음, 탭 강조 없음, 게임 영역 · 터치 대상은 브라우저 제스처 없음.
  // (-webkit-touch-callout은 크롬이 모르는 속성이라 계산값이 없다 — iOS용. 단위 시험 device.test가 CSS 원문을 본다)
  const css = await page.evaluate(() => {
    const pick = (el: Element) => {
      const c = getComputedStyle(el);
      return {
        touchAction: c.touchAction,
        userSelect: c.userSelect,
        overscroll: `${c.overscrollBehaviorX} ${c.overscrollBehaviorY}`,
        tapHighlight: c.getPropertyValue('-webkit-tap-highlight-color'),
      };
    };
    const one = (sel: string) => {
      const el = document.querySelector(sel);
      return el ? pick(el) : null;
    };
    return {
      html: one('html'),
      body: one('body'),
      game: one('#game-root'),
      layer: one('.touch-layer'),
      targets: [...document.querySelectorAll('#ui-root [data-touch-target]')].map((el) => ({
        id: el.getAttribute('data-touch-target'),
        ...pick(el),
      })),
    };
  });
  const NO_TAP = 'rgba(0, 0, 0, 0)';
  for (const k of ['html', 'body'] as const)
    expect(css[k], k).toMatchObject({ userSelect: 'none', overscroll: 'none none', tapHighlight: NO_TAP });
  expect(css.game).toMatchObject({ touchAction: 'none', userSelect: 'none' });
  expect(css.layer).toMatchObject({ touchAction: 'none', userSelect: 'none', tapHighlight: NO_TAP });
  expect(css.targets.length).toBeGreaterThanOrEqual(MONSTER_TARGETS.length);
  for (const tc of css.targets)
    expect(tc, String(tc.id)).toMatchObject({ touchAction: 'none', userSelect: 'none' });

  // 핀치: 같은 컨텍스트의 보호하지 않은 대조 페이지는 실제로 확대된다(헤드리스에서 검사가 의미 있음) → 게임 페이지는 그대로
  const control = await s.context.newPage();
  await control.route('http://m11-touch.test/', (route) =>
    route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: `<!doctype html><meta name="viewport" content="${VIEWPORT_OPEN}"><style>body{margin:0;height:1200px;background:#0b1622}</style>`,
    }),
  );
  await control.goto('http://m11-touch.test/');
  const tc = await MultiTouch.attach(control);
  await tc.pinch(450, 200, 80, 380);
  await tc.detach();
  await expect.poll(() => viewportScale(control), POLL).toBeGreaterThan(1.5);
  await control.close();

  const t = await MultiTouch.attach(page);
  const rec = await recordInputs(page, 100);
  const zc = centerOf(zone);
  for (const [cx, cy] of [
    [457, 206], // 판 화면 가운데 (캔버스)
    [zc.x, zc.y], // 이동 스틱 영역
  ] as const) {
    await t.pinch(cx, cy, 60, 300, { steps: 10, stepMs: 16 });
  }
  // 확대가 일어났다면 몇 프레임 안에 반영된다: 서버 틱으로 잠깐 기다린 뒤 본다
  await waitServerTicks(s, 6);
  expect(await viewportScale(page)).toBe(1);

  // 스틱 끌기: 이동 · 조준(가운데로 되돌려 취소) · 돌진 버튼 끌기, 모두 pointercancel 없이 pointerup까지
  const before = await pointerCounts(page);
  await t.down(1, zc.x, zc.y);
  await t.move(1, zc.x + 80, zc.y - 60, { steps: 10, stepMs: 16 });
  await t.move(1, zc.x - 60, zc.y + 40, { steps: 10, stepMs: 16 });
  await t.up(1);
  const ac = centerOf(aim);
  await t.down(2, ac.x, ac.y);
  await t.move(2, ac.x - 50, ac.y - 20, { steps: 8, stepMs: 16 });
  await t.move(2, ac.x, ac.y, { steps: 4, stepMs: 16 });
  await t.up(2);
  const dash = await waitForTouchTarget(page, 'dash');
  const dc = centerOf(dash);
  await t.down(3, dc.x, dc.y);
  await t.move(3, dc.x - 40, dc.y - 30, { steps: 8, stepMs: 16 });
  await t.up(3);

  // 길게 누르기 (1.2초): 조준 스틱 가운데(데드존 안 → 공격 없음) · 이동 영역 · 캔버스. 선택 문자열은 비어 있다
  for (const [id, x, y] of [
    [4, ac.x, ac.y],
    [5, zc.x, zc.y],
    [6, 457, 120],
  ] as const) {
    await t.down(id, x, y);
    await page.waitForTimeout(1200); // 길게 누르는 손가락 동작 자체의 길이
    await t.up(id);
  }
  const after = await pointerCounts(page);
  expect(after['pointercancel:touch'] ?? 0).toBe(before['pointercancel:touch'] ?? 0);
  expect((after['pointerup:touch'] ?? 0) - (before['pointerup:touch'] ?? 0)).toBeGreaterThanOrEqual(6);
  expect(await page.evaluate(() => String(document.getSelection() ?? ''))).toBe('');
  // 조준 스틱: 가운데로 되돌려 뗌(취소) · 길게 누름(0.25초 넘음) → 공격 0번
  await expect.poll(async () => (await rec.entries()).length, POLL).toBeGreaterThan(0);
  const frames = await rec.stop();
  expect(countPressed(frames, BTN.ATTACK)).toBe(0);

  // contextmenu: 터치 대상 · 캔버스 · 문서 어디서 올라와도 막힘 (길게 누르기 메뉴), 실제 우클릭도
  const synthetic = await page.evaluate(() => {
    const els = [
      document.querySelector('[data-touch-target="move-zone"]'),
      document.querySelector('[data-touch-target="aim-stick"]'),
      document.querySelector('[data-touch-target="roar"]'),
      document.querySelector('#game-root canvas'),
      document.body,
    ];
    return els.map((el) => {
      const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      el?.dispatchEvent(ev);
      return {
        target: el?.getAttribute('data-touch-target') ?? el?.tagName.toLowerCase() ?? 'none',
        prevented: ev.defaultPrevented,
      };
    });
  });
  expect(synthetic).toEqual([
    { target: 'move-zone', prevented: true },
    { target: 'aim-stick', prevented: true },
    { target: 'roar', prevented: true },
    { target: 'canvas', prevented: true },
    { target: 'body', prevented: true },
  ]);
  await page.mouse.click(457, 120, { button: 'right' });
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __e2eCtx: CtxMenu[] }).__e2eCtx.slice()), POLL)
    .toEqual(expect.arrayContaining([{ target: 'canvas', prevented: true }]));
  const ctx = await page.evaluate(() => (window as unknown as { __e2eCtx: CtxMenu[] }).__e2eCtx.slice());
  expect(ctx.every((c) => c.prevented)).toBe(true);

  await t.detach();
  expect(s.problems).toEqual([]);
  await s.context.close();
});

// ───────────── 세로 안내 ─────────────

test('세로 안내: 휴대폰 · 태블릿 세로에서 보이고(JS를 꺼도), 가로 · PC 좁은 창에서는 안 뜸', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const NOTICE = '가로로 돌려 주세요';
  // JS를 끈 세로 휴대폰: 정적 마크업 + CSS만으로
  const nojs = await browser.newContext({ ...dpr1(portrait(PHONE_LANDSCAPE)), javaScriptEnabled: false });
  const np = await nojs.newPage();
  await np.goto('/');
  await expect(np.getByTestId('rotate-notice')).toBeVisible();
  await expect(np.getByTestId('rotate-notice')).toContainText(NOTICE);
  await nojs.close();

  const cases: { name: string; device: DeviceOptions | undefined; shown: boolean }[] = [
    { name: '휴대폰 세로', device: dpr1(portrait(PHONE_LANDSCAPE)), shown: true },
    { name: '태블릿 세로', device: dpr1(portrait(TABLET_LANDSCAPE)), shown: true },
    { name: '휴대폰 가로', device: PHONE, shown: false },
    { name: '태블릿 가로', device: dpr1(TABLET_LANDSCAPE), shown: false },
    { name: 'PC 좁은 창', device: PC_NARROW, shown: false },
  ];
  for (const c of cases) {
    const { context, page, problems } = await newPlayerPage(browser, c.device);
    await page.goto('/?debug=hook&renderer=canvas');
    await expect(page.getByTestId('create-room')).toBeAttached();
    if (c.shown) {
      await expect(page.getByTestId('rotate-notice'), c.name).toBeVisible();
      await expect(page.getByTestId('rotate-notice'), c.name).toContainText(NOTICE);
    } else await expect(page.getByTestId('rotate-notice'), c.name).toBeHidden();
    expect(problems, c.name).toEqual([]);
    await context.close();
  }

  // PC 좁은 창: 판 중에도 세로로 막지 않는다 (키보드 입력이 그대로 나간다)
  const pc = await soloMatch(browser, PC_NARROW, 'runner');
  await placeSelf(pc, RIGHT_LANE.x, RIGHT_LANE.y, 0);
  await pc.page.keyboard.down('KeyD');
  await expect.poll(async () => (await selfTruth(pc)).x - RIGHT_LANE.x, POLL).toBeGreaterThan(1);
  await pc.page.keyboard.up('KeyD');
  await expect(pc.page.getByTestId('rotate-notice')).toBeHidden();
  expect(pc.problems).toEqual([]);
  await pc.context.close();
});

for (const dev of [
  { name: '휴대폰', device: PHONE },
  { name: '태블릿', device: dpr1(TABLET_LANDSCAPE) },
]) {
  test(`세로로 돌리면(${dev.name}) 판 중 입력을 보내지 않고 터치 화면이 꺼지며, 가로로 돌아오면 다시 된다`, async ({
    browser,
  }) => {
    test.setTimeout(150_000);
    const s = await soloMatch(browser, dev.device, 'runner');
    const { page } = s;
    await freezeOthers(s);
    await placeSelf(s, RIGHT_LANE.x, RIGHT_LANE.y, 0);
    await waitForTouchTarget(page, 'move-zone');
    await expect.poll(async () => (await inputLog(page)).length, POLL).toBeGreaterThan(5);
    const land = page.viewportSize()!;
    await page.setViewportSize({ width: land.height, height: land.width });
    await expect(page.getByTestId('rotate-notice')).toBeVisible();
    await expect.poll(async () => (await touchTargets(page)).length, POLL).toBe(0);
    await expect(page.locator('.touch-layer.off')).toHaveCount(1);
    const stopAt = (await inputLog(page)).at(-1)?.t ?? 0;
    const pos = await selfTruth(s);
    // 세로 화면에서 끌어 봐도(안내가 덮는다) 아무것도 나가지 않는다
    const t = await MultiTouch.attach(page);
    await t.down(1, 120, land.width * 0.6);
    await t.move(1, 220, land.width * 0.6, { steps: 8, stepMs: 20 });
    await waitServerTicks(s, 45); // 1.5초 (서버 시계)
    await t.up(1);
    const sent = (await inputLog(page)).filter((e) => e.t > stopAt);
    expect(sent, '세로 동안 보낸 입력 프레임').toEqual([]);
    const still = await selfTruth(s);
    expect(Math.hypot(still.x - pos.x, still.y - pos.y)).toBeLessThan(0.01);

    // 가로로 돌아오면 안내가 사라지고 터치 화면 · 입력이 돌아온다
    await page.setViewportSize(land);
    await expect(page.getByTestId('rotate-notice')).toBeHidden();
    const zone = await waitForTouchTarget(page, 'move-zone');
    const z = centerOf(zone);
    await t.down(2, z.x, z.y);
    await t.move(2, z.x + 90, z.y, { steps: 6, stepMs: 20 });
    await expect
      .poll(async () => {
        const e = (await inputLog(page)).at(-1);
        return e ? `${e.mx},${e.my},${e.mode}` : null;
      }, POLL)
      .toBe('1,0,touch');
    await expect.poll(async () => (await selfTruth(s)).x - still.x, POLL).toBeGreaterThan(1);
    await t.up(2);
    await t.detach();
    expect(s.problems).toEqual([]);
    await s.context.close();
  });
}

// ───────────── 전체 화면 ─────────────

test('전체 화면 + 가로 고정: 서버 match를 받을 때는 부르지 않고, 판 안 첫 탭에서 1번 (그 뒤 탭은 아님, 전체 화면 버튼은 누를 때마다)', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const USER_EVENTS = ['click', 'pointerup', 'keydown'];
  const isRequest = (c: FsCall): boolean => c.kind === 'fullscreen';
  let lobbyCalls: FsCall[] = [];
  const s = await soloMatch(browser, PHONE, 'runner', {
    inLobby: async (page) => {
      // 전체 화면이 된 뒤 가로 고정을 부른다 (약속 다음 단계): 둘이 짝이 될 때까지
      await expect
        .poll(async () => {
          const calls = await fsCalls(page);
          return calls.filter(isRequest).length * 2 === calls.length;
        }, POLL)
        .toBe(true);
      lobbyCalls = await fsCalls(page);
    },
  });
  const { page } = s;
  // 로비: 준비 탭(사용자 탭 핸들러 안)에서 부른다
  expect(lobbyCalls.filter(isRequest).length).toBeGreaterThanOrEqual(1);
  for (const c of lobbyCalls.filter(isRequest)) expect(c).toMatchObject({ phase: 'lobby', inGame: false });
  for (const c of lobbyCalls.filter(isRequest)) expect(USER_EVENTS).toContain(c.ev);
  // 판 시작(서버 match 수신 · 판 장면 · 터치 화면 생성) 때 부르지 않았다. 시작 탭(사용자 탭)에서 부른 것은 괜찮다
  const zone = await waitForTouchTarget(page, 'move-zone');
  await waitServerTicks(s, 15);
  const atStart = await fsCalls(page);
  const sinceLobby = atStart.slice(lobbyCalls.length).filter(isRequest);
  expect(
    sinceLobby.filter((c) => c.inGame || c.phase !== 'lobby' || !USER_EVENTS.includes(c.ev ?? '')),
    '판 시작 때 부름',
  ).toEqual([]);
  expect(atStart.filter((c) => c.ev === 'message')).toEqual([]);

  // 판 안 첫 탭 → 1번 (손을 뗄 때, 터치 pointerup = 사용자 활성화)
  const t = await MultiTouch.attach(page);
  const z = centerOf(zone);
  await t.tap(1, z.x, z.y);
  await expect.poll(async () => (await fsCalls(page)).length - atStart.length, POLL).toBe(2);
  const first = (await fsCalls(page)).slice(atStart.length);
  expect(first[0]).toMatchObject({
    kind: 'fullscreen',
    ev: 'pointerup',
    pointer: 'touch',
    phase: 'playing',
    inGame: true,
  });
  expect(first[1]).toMatchObject({ kind: 'lock' });

  // 두 번째 탭: 부르지 않는다. 점수판 버튼 탭(켜짐 확인)을 뒤따르는 표시로 써서 앞의 탭이 다 처리된 뒤에 센다
  await t.tap(2, z.x, z.y);
  const board = centerOf(await waitForTouchTarget(page, 'scoreboard'));
  await t.tap(3, board.x, board.y);
  await page.waitForFunction(() => window.__DECOY__?.getHud().scoreboard === true, null, { polling: 100 });
  expect((await fsCalls(page)).length - atStart.length).toBe(2);

  // 터치 HUD의 전체 화면 버튼(브라우저 안 · 전체 화면이 아닐 때만 보임): 누를 때마다
  const fsButton = (await touchTargets(page)).find((q) => q.id === 'fullscreen');
  if (fsButton) {
    const f = centerOf(fsButton);
    await t.tap(4, f.x, f.y);
    await expect.poll(async () => (await fsCalls(page)).length - atStart.length, POLL).toBe(4);
    expect((await fsCalls(page)).at(-2)).toMatchObject({ kind: 'fullscreen', ev: 'pointerup', inGame: true });
  }
  console.log(
    `[m11-touch] 전체 화면 호출: 로비 ${lobbyCalls.length}개 (${lobbyCalls.map((c) => `${c.kind}@${c.ev}`).join(', ')}), ` +
      `판 시작 0개, 첫 탭 ${first.length}개, 전체 화면 버튼 ${fsButton ? '있음' : '없음'}`,
  );
  await t.detach();
  expect(s.problems).toEqual([]);
  await s.context.close();
});

// ───────────── 결과 화면 레이어 ─────────────

test('결과 화면: 터치 화면이 꺼지고 입력이 없으며, 버튼(왼쪽 40% 안 포함)을 탭하면 동작하고 왼쪽 영역에서 스크롤된다', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const s = await soloMatch(browser, PHONE, 'runner');
  const { page } = s;
  await waitForTouchTarget(page, 'move-zone');
  await sendTest(page, { kind: 'setTime', timeLeft: 0.1 });
  const result = page.getByTestId('result');
  await expect(result).toBeVisible();
  await expect(page.getByTestId('result-winner')).toHaveText('괴물 승리');
  const shownAt = await page.evaluate(() => performance.now());
  await expect.poll(async () => (await touchTargets(page)).length, POLL).toBe(0);
  const vp = page.viewportSize()!;
  const leftW = vp.width * 0.4;

  const layer = await page.evaluate(
    ({ lx, h }) => {
      const res = document.querySelector('[data-testid="result"]')!;
      // 왼쪽 40%(이동 스틱 영역 자리)의 점들이 결과 화면에 닿는다 (터치 레이어 · 이동 영역이 아니라)
      const pts = [
        [lx * 0.5, h * 0.25],
        [lx * 0.5, h * 0.7],
        [lx - 4, h * 0.92],
      ].map(([x, y]) => res.contains(document.elementFromPoint(x!, y!)));
      const buttons = [...res.querySelectorAll('button')]
        .filter((b) => b.checkVisibility({ checkVisibilityCSS: true }))
        .map((b) => b.getAttribute('data-testid'));
      return {
        pts,
        buttons,
        touchAction: getComputedStyle(res).touchAction,
        layerVisibility: getComputedStyle(document.querySelector('.touch-layer')!).visibility,
        scrollable: res.scrollHeight - res.clientHeight,
      };
    },
    { lx: leftW, h: vp.height },
  );
  expect(layer).toMatchObject({
    pts: [true, true, true],
    buttons: ['rematch'],
    touchAction: 'pan-y',
    layerVisibility: 'hidden',
  });
  expect(layer.scrollable, '결과 화면이 휴대폰 높이보다 길다(스크롤 시험이 의미 있음)').toBeGreaterThan(20);

  // 글자 선택: 결과 글(결말 메모)을 끌어도 선택되지 않는다 (헤드리스는 길게 누르기로 선택을 만들지 못해 마우스 끌기로 본다).
  // 대조: 같은 자리에서 막기(user-select: none)를 잠시 풀면 선택된다
  const memo = (await page.getByTestId('result-ending').boundingBox())!;
  expect(memo.y + memo.height).toBeLessThan(vp.height * 0.75);
  const dragSelect = async (): Promise<string> => {
    await page.mouse.move(memo.x + 2, memo.y + memo.height / 2);
    await page.mouse.down();
    await page.mouse.move(memo.x + memo.width - 2, memo.y + memo.height / 2, { steps: 8 });
    await page.mouse.up();
    return page.evaluate(() => String(document.getSelection() ?? ''));
  };
  expect(await dragSelect()).toBe('');
  await page.evaluate(() => {
    for (const el of [document.documentElement, document.body]) el.style.userSelect = 'text';
  });
  expect((await dragSelect()).length, '대조: 막기를 풀면 선택된다').toBeGreaterThan(3);
  await page.evaluate(() => {
    for (const el of [document.documentElement, document.body]) el.style.userSelect = '';
    document.getSelection()?.removeAllRanges();
  });

  // 왼쪽 영역에서 위로 끌면 결과가 스크롤된다 (브라우저 팬이 가져가므로 pointercancel은 정상)
  const t = await MultiTouch.attach(page);
  await t.down(1, leftW * 0.5, vp.height * 0.8);
  await t.move(1, leftW * 0.5, vp.height * 0.2, { steps: 12, stepMs: 16 });
  await t.up(1);
  await expect
    .poll(() => page.evaluate(() => document.querySelector('[data-testid="result"]')!.scrollTop), POLL)
    .toBeGreaterThan(10);
  // 결과 중에는 터치가 판 입력으로 가지 않는다
  const during = (await inputLog(page)).filter((e) => e.t > shownAt);
  expect(during.filter((e) => e.mx !== 0 || e.my !== 0 || e.pressed !== 0 || e.held !== 0)).toEqual([]);

  // 다시 하기: 왼쪽 40% 안에 걸친 부분을 탭한다 (안 걸치면 가운데)
  const box = (await page.getByTestId('rematch').boundingBox())!;
  const x = box.x < leftW ? (box.x + Math.min(box.x + box.width, leftW)) / 2 : box.x + box.width / 2;
  const y = box.y + box.height / 2;
  expect(
    await page.evaluate(
      ([px, py]) =>
        document.elementFromPoint(px!, py!)?.closest('[data-testid]')?.getAttribute('data-testid'),
      [x, y],
    ),
  ).toBe('rematch');
  const ups = (await pointerCounts(page))['pointerup:touch'] ?? 0;
  await page.touchscreen.tap(x, y);
  await expect(page.getByTestId('ready-button')).toBeVisible();
  expect((await pointerCounts(page))['pointerup:touch'] ?? 0).toBeGreaterThan(ups);
  console.log(
    `[m11-touch] 결과 화면: 다시 하기 [${[box.x, box.y, box.width, box.height].map((v) => v.toFixed(1)).join(', ')}], ` +
      `탭 (${x.toFixed(1)}, ${y.toFixed(1)}), 왼쪽 40% = ${leftW.toFixed(1)}px, 스크롤 가능 ${layer.scrollable}px`,
  );
  await t.detach();
  expect(s.problems).toEqual([]);
  await s.context.close();
});

// ───────────── 오디오 ─────────────

type AudioMade = { ev: string | null; pointer: string | null };
type Activation = { type: string; active: boolean; lobby: boolean };
/** 로비가 그려지면 페이지가 콘솔에 남기는 표시 (evaluate · 로케이터 없이 기다리려고 — 둘 다 사용자 활성화를 만든다) */
const LOBBY_READY = 'e2e:lobby-ready';

/**
 * AudioContext를 만든 순간의 이벤트를 기록하고, 포인터 이벤트 때 문서가 사용자 활성화 상태였는지 · 로비가 있었는지 적는다.
 * 로비(방 만들기 버튼)가 생기면 콘솔에 LOBBY_READY를 남긴다
 */
function recordAudio(): void {
  const made: AudioMade[] = [];
  const acts: Activation[] = [];
  const w = window as unknown as { __e2eAudio: AudioMade[]; __e2eAct: Activation[] };
  w.__e2eAudio = made;
  w.__e2eAct = acts;
  const Orig = window.AudioContext;
  window.AudioContext = class extends Orig {
    constructor(opts?: AudioContextOptions) {
      super(opts);
      const ev = window.event as (Event & { pointerType?: string }) | undefined;
      made.push({ ev: ev?.type ?? null, pointer: ev?.pointerType ?? null });
    }
  };
  const lobby = (): boolean => document.querySelector('[data-testid="create-room"]') !== null;
  for (const type of ['pointerdown', 'pointerup'])
    window.addEventListener(
      type,
      () => acts.push({ type, active: navigator.userActivation.hasBeenActive, lobby: lobby() }),
      true,
    );
  const watch = new MutationObserver(() => {
    if (!lobby()) return;
    watch.disconnect();
    console.log('e2e:lobby-ready');
  });
  document.addEventListener('DOMContentLoaded', () => {
    watch.observe(document.body, { childList: true, subtree: true });
    if (lobby()) {
      watch.disconnect();
      console.log('e2e:lobby-ready');
    }
  });
}

/** 오디오 기록을 단 페이지를 열고 로비가 그려질 때까지 기다린다 (evaluate · 로케이터를 쓰지 않아 사용자 활성화가 없다) */
async function openForAudio(browser: Browser, device?: DeviceOptions) {
  const p = await newPlayerPage(browser, device);
  await p.context.addInitScript(recordAudio);
  const ready = p.page.waitForEvent('console', {
    predicate: (m) => m.text() === LOBBY_READY,
    timeout: 20_000,
  });
  await p.page.goto('/?debug=hook&renderer=canvas');
  await ready;
  return p;
}

test('오디오: 터치 pointerdown에서는 AudioContext를 만들지 않고 pointerup에서 만든다 (경고 0), 마우스는 pointerdown', async ({
  browser,
}) => {
  // 휴대폰: 사용자 활성화가 없는 페이지에서 시작한다 (pointerdown에서 만들면 크롬이 경고를 낸다)
  const phone = await openForAudio(browser, PHONE);
  const t = await MultiTouch.attach(phone.page);
  // 로비 왼쪽 위 빈 곳
  await t.down(1, 6, 6);
  const atDown = await phone.page.evaluate(() => {
    const w = window as unknown as { __e2eAudio: AudioMade[]; __e2eAct: Activation[] };
    return { made: w.__e2eAudio.slice(), acts: w.__e2eAct.slice(), ready: window.__DECOY__?.audioReady };
  });
  // 누른 순간에는 활성화가 없었고(시험 조건) 로비가 있었다
  expect(atDown.acts).toEqual([{ type: 'pointerdown', active: false, lobby: true }]);
  expect(atDown.made).toEqual([]);
  expect(atDown.ready).toBe(false);
  await t.up(1);
  await expect.poll(() => phone.page.evaluate(() => window.__DECOY__?.audioReady), POLL).toBe(true);
  const made = await phone.page.evaluate(() =>
    (window as unknown as { __e2eAudio: AudioMade[] }).__e2eAudio.slice(),
  );
  expect(made).toEqual([{ ev: 'pointerup', pointer: 'touch' }]);
  // 누른 곳이 버튼 · 입력칸이 아니었다 (오디오는 문서 어디서나 연다)
  expect(
    await phone.page.evaluate(
      () => (document.elementFromPoint(6, 6)?.closest('button, input, select') ?? null) !== null,
    ),
  ).toBe(false);
  await t.detach();
  expect(phone.problems).toEqual([]);
  await phone.context.close();

  // PC 마우스: 예전처럼 누르는 순간
  const pc = await openForAudio(browser);
  await pc.page.mouse.move(6, 6);
  await pc.page.mouse.down();
  const pcMade = await pc.page.evaluate(() =>
    (window as unknown as { __e2eAudio: AudioMade[] }).__e2eAudio.slice(),
  );
  await pc.page.mouse.up();
  expect(pcMade).toEqual([{ ev: 'pointerdown', pointer: 'mouse' }]);
  expect(pc.problems).toEqual([]);
  await pc.context.close();
});

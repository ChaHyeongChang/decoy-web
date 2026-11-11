// M8: 연출과 소리 — VISUAL_SPEC 6.2 연출이 실제로 그려지고, 효과음이 맞는 사람에게 울리고, 콘솔 에러가 없다
// 플레이테스트 반영 a-4 (맨 아래): 왕복 200ms에서 쿨타임이 끝나는 무렵의 공격도 누른 입력 틱에 준비가 보이고, 타격 결과까지
// 이어지며(끝에서 대기), 서버가 거절한 누름은 꺼진다
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { validateBalance } from '@decoy/shared';
import {
  aimMonsterAt,
  closeAll,
  createRoom,
  lastSnapshot,
  myId,
  newPlayerPage,
  pickRoleAndReady,
  press,
  sendTest,
  startFourPlayerMatch,
  truth,
  truthLogSize,
  truthSince,
  waitForSnapshots,
} from './helpers';

async function effects(page: Page): Promise<Record<string, number | boolean>> {
  return page.evaluate(() => window.__DECOY__?.getEffects() ?? {});
}

async function sounds(page: Page): Promise<string[]> {
  return page.evaluate(() => window.__DECOY__?.getSounds() ?? []);
}

async function waitEffect(page: Page, key: string): Promise<void> {
  try {
    await page.waitForFunction(
      (k) => {
        const v = window.__DECOY__?.getEffects()[k];
        return v === true || (typeof v === 'number' && v > 0);
      },
      key,
      { timeout: 8_000 },
    );
  } catch (e) {
    const st = await page.evaluate(() => ({
      fx: window.__DECOY__?.getEffects(),
      mon: window.__DECOY__?.getLastSnapshot()?.you.mon,
      surv: window.__DECOY__?.getLastSnapshot()?.you.surv,
      move: window.__DECOY__?.getLocalState(),
      monster: window.__DECOY__?.getLastSnapshot()?.monster,
    }));
    throw new Error(`연출 ${key}가 나오지 않음: ${JSON.stringify(st)} / ${String(e)}`);
  }
}

test('공격 준비는 누른 순간 보이고, 피격 플래시 · 수감 페이드 · 기절 별 · 채도 감소 · 돌진 잔상 · 효과음이 나온다', async ({
  browser,
}) => {
  // 괴물만 왕복 400ms 지연: 서버 확인 전에 내 화면에 공격 범위가 먼저 떠야 한다
  const { players } = await startFourPlayerMatch(
    browser,
    ['monster', 'runner', 'guard', 'scout'],
    ['&lag=400', '', '', ''],
  );
  const monster = players.find((p) => p.role === 'monster')!;
  const runner = players.find((p) => p.role === 'runner')!;
  const guard = players.find((p) => p.role === 'guard')!;
  const scout = players.find((p) => p.role === 'scout')!;
  // 첫 사용자 입력에서 오디오가 열린다 (괴물 화면 클릭은 공격이 되므로 키로)
  for (const p of players) {
    await p.page.keyboard.press('KeyX');
    await p.page.waitForFunction(() => window.__DECOY__?.audioReady === true);
  }

  // 1) 공격: 즉시 피드백 → 피격 플래시 + 소리, 두 번째에 수감 페이드
  for (let hit = 1; hit <= 2; hit += 1) {
    await sendTest(scout.page, { kind: 'teleport', target: runner.id, x: 31, y: 21 });
    await sendTest(scout.page, { kind: 'teleport', target: monster.id, x: 30, y: 21, face: 0 });
    // 조준을 먼저 러너 쪽(동쪽)으로 돌려 두고 서버 조준까지 확인한 뒤 그 자리에서 누른다 (helpers.aimMonsterAt).
    // 따라가는 카메라: 순간 이동 뒤 창이 따라가는 동안 화면 좌표를 재면 커서가 엉뚱한 타일을 가리켜 조준이 돌다가 준비가
    // 시작된다 — 느린 러너(CI 전체 검사, CPU 6배 느림으로 재현)에서 준비가 북동(−0.89rad)으로 시작해 러너를 빗나갔다
    await aimMonsterAt(monster.page, 33, 21);
    await monster.page.mouse.down({ button: 'left' });
    await monster.page.mouse.up({ button: 'left' });
    // 누른 직후(서버 확인 전, 왕복 400ms): 내 화면에 공격 범위 + 준비 소리
    const t0 = Date.now();
    await waitEffect(monster.page, 'attackRange');
    const early = Date.now() - t0;
    const snapWindup = (await lastSnapshot(monster.page))!.you.mon!.windup;
    if (hit === 1) {
      expect(early).toBeLessThan(250);
      expect(snapWindup).toBe(0);
    }
    expect(await sounds(monster.page)).toContain('windup');
    if (hit === 1) {
      await waitEffect(runner.page, 'hitFlash');
      expect(await sounds(runner.page)).toContain('hit');
      // 팀원도 작게 듣는다
      await guard.page.waitForFunction(() => (window.__DECOY__?.getSounds() ?? []).includes('hit'));
      // 0.2초 뒤 사라진다
      await runner.page.waitForTimeout(400);
      expect((await effects(runner.page)).hitFlash).toBe(0);
    } else {
      await waitEffect(runner.page, 'fade');
      await runner.page.waitForTimeout(700);
      expect((await effects(runner.page)).fade).toBe(0);
      expect((await lastSnapshot(runner.page))!.you.surv!.status).toBe('imprisoned');
    }
    // 괴물 쪽도 타격음
    await monster.page.waitForFunction(
      () => (window.__DECOY__?.getSounds() ?? []).filter((s) => s === 'hit').length >= 1,
    );
    await monster.page.waitForTimeout(1600);
  }

  // 2) 가드 밀치기 → 괴물 기절: 양쪽 화면 기절 별, 괴물 화면 채도 감소
  await sendTest(scout.page, { kind: 'teleport', target: monster.id, x: 40, y: 16, face: Math.PI });
  await sendTest(scout.page, { kind: 'teleport', target: guard.id, x: 38.5, y: 16 });
  await guard.page.waitForTimeout(700);
  await guard.page.keyboard.press('Space');
  await waitEffect(monster.page, 'desaturate');
  await waitEffect(monster.page, 'stunStars');
  await waitEffect(guard.page, 'stunStars');
  await monster.page.waitForTimeout(2200);
  const after = await effects(monster.page);
  expect(after.desaturate).toBe(false);
  expect(after.stunStars).toBe(false);

  // 3) 돌진 잔상: 괴물 화면 + 괴물이 보이는 생존자 화면
  await sendTest(scout.page, { kind: 'teleport', target: monster.id, x: 36, y: 13, face: 0 });
  await sendTest(scout.page, { kind: 'teleport', target: guard.id, x: 38, y: 15.5 });
  // 돌진 방향(동쪽)도 창이 자리 잡은 뒤 조준하고 서버 조준까지 확인한다 (위 공격과 같은 까닭)
  await aimMonsterAt(monster.page, 42, 13);
  for (const p of [monster, guard])
    expect(await p.page.evaluate(() => window.__DECOY__?.getSounds() ?? [])).not.toContain('dash');
  await monster.page.keyboard.press('Shift');
  await waitEffect(monster.page, 'dashGhosts');
  await waitEffect(guard.page, 'dashGhosts');
  // 돌진 소리 (플레이테스트 반영 c 손맛 P10): 괴물은 누른 순간(예측 — 서버 dash 이벤트로는 내지 않는다), 괴물이 보이는 생존자는
  // 서버가 보낸 dash 이벤트로
  for (const p of [monster, guard])
    await p.page.waitForFunction(() => (window.__DECOY__?.getSounds() ?? []).includes('dash'), null, {
      timeout: 5_000,
    });

  // 4) 포효: 괴물과 생존자 모두 포효 소리
  await monster.page.waitForTimeout(500);
  await monster.page.keyboard.press('KeyQ');
  await monster.page.waitForFunction(() => (window.__DECOY__?.getSounds() ?? []).includes('roar'));
  for (const p of [runner, guard, scout])
    await p.page.waitForFunction(() => (window.__DECOY__?.getSounds() ?? []).includes('roar'));

  for (const p of players) expect(p.problems).toEqual([]);
  await closeAll(players);
});

test('점령 시작은 괴물에게만, 점령 완료 · 문 열림은 양쪽에 소리가 난다', async ({ browser }) => {
  const { players } = await startFourPlayerMatch(browser);
  const monster = players.find((p) => p.role === 'monster')!;
  const runner = players.find((p) => p.role === 'runner')!;
  const guard = players.find((p) => p.role === 'guard')!;
  for (const p of players) await p.page.keyboard.press('KeyX');
  // 두 거점을 거의 다 채워 두고 한 명씩 넣는다
  await sendTest(runner.page, { kind: 'setPoint', point: 'A', progress: 0.96 });
  await sendTest(runner.page, { kind: 'setPoint', point: 'B', progress: 0.97 });
  await sendTest(runner.page, { kind: 'teleport', target: runner.id, x: 8, y: 16 });
  await sendTest(runner.page, { kind: 'teleport', target: guard.id, x: 40, y: 16 });
  await monster.page.waitForFunction(() => (window.__DECOY__?.getSounds() ?? []).includes('captureStart'));
  for (const p of [monster, runner])
    await p.page.waitForFunction(() => (window.__DECOY__?.getSounds() ?? []).includes('captureDone'), null, {
      timeout: 10_000,
    });
  expect(await sounds(runner.page)).not.toContain('captureStart');
  // 두 거점이 모두 끝나 탈출구가 켜질 때까지
  await runner.page.waitForFunction(
    () => (window.__DECOY__?.getLastSnapshot()?.world.exits ?? []).every((e) => e.state === 'active'),
    null,
    { timeout: 10_000 },
  );
  // 탈출구: 두 명이 북쪽 문 앞에 3초
  await sendTest(runner.page, { kind: 'teleport', target: runner.id, x: 23.6, y: 1.6 });
  await sendTest(runner.page, { kind: 'teleport', target: guard.id, x: 24.4, y: 1.6 });
  for (const p of [monster, runner, guard])
    await p.page.waitForFunction(() => (window.__DECOY__?.getSounds() ?? []).includes('doorOpen'), null, {
      timeout: 10_000,
    });
  for (const p of players) expect(p.problems).toEqual([]);
  await closeAll(players);
});

// ───── 플레이테스트 반영 a-4: 지연이 있을 때 공격 준비 표시 ─────

const balance = validateBalance(JSON.parse(readFileSync('config/balance.json', 'utf8')));
const LAG = 200;
const WINDUP_MS = balance.monster.attack.windup * 1000;

/** 도착한 스냅샷 하나 (받는 쪽 지연 큐를 지나 앱에 전달된 순간) */
interface ProbeSnap {
  t: number;
  ack: number;
  windup: number;
  cd: number;
  kinds: string[];
}

/** 누름 하나의 경과 */
interface Trial {
  kind: 'fresh' | 'edge' | 'frozen';
  /** pointerdown을 보낸 시각 (performance.now) */
  press: number;
  /** 누르는 순간 본 값: 마지막 스냅샷의 쿨타임 · 서버가 아직 처리하지 않은 내 입력 수 · 핑 */
  cd: number;
  pending: number;
  ping: number;
  /** 눌림이 실린 입력 프레임 (못 찾으면 seq −1) */
  seq: number;
  inputAt: number;
  /** 누른 뒤 rAF마다 본 화면 (범위 표시 · 채움) */
  frames: { t: number; range: boolean; fill: number }[];
  /** 누른 뒤 도착한 스냅샷 */
  snaps: ProbeSnap[];
  /** 누른 뒤 늘어난 준비 소리 수 */
  sounds: number;
}

interface WindupProbe {
  snaps: ProbeSnap[];
  onSnap: (() => void) | null;
  /** 지금 한 번 누르고 그 결과(타격 또는 거절)가 올 때까지 적는다. frozen이면 '괴물 정지'를 같은 길로 먼저 보낸다 */
  press(kind: Trial['kind']): Promise<Trial>;
  /**
   * 쿨타임이 끝나는 무렵: '옛 어림(스냅샷을 받은 뒤 흐른 시간 + 왕복 / 2)은 아직 쿨타임, 새 어림(입력 줄)은 끝남'인 스냅샷이
   * 오는 순간 누른다. 그런 스냅샷 없이 쿨타임이 끝나면 null
   */
  edge(dtS: number): Promise<Trial | null>;
}

/** 페이지 안 (초기화 스크립트): 스냅샷 도착 기록 + 누르고 적는 도구. 바깥 변수를 쓰지 않는다 */
function installWindupProbe(): void {
  interface Hook {
    you: string;
    ping: number;
    pendingInputs: number;
    getEffects(): Record<string, number | boolean>;
    getSounds(): string[];
    getInputLog(): { seq: number; t: number; pressed: number }[];
    getLastSnapshot(): { you: { mon: { windup: number; attackCd: number } | null } } | null;
    sendTest(cmd: { kind: 'freeze'; target: string; frozen: boolean }): void;
  }
  const hook = (): Hook => (window as unknown as { __DECOY__: Hook }).__DECOY__;
  const ATTACK = 1;
  const probe: WindupProbe = {
    snaps: [],
    onSnap: null,
    press(kind) {
      const d = hook();
      const windups = (): number => d.getSounds().filter((x) => x === 'windup').length;
      const trial: Trial = {
        kind,
        press: performance.now(),
        cd: d.getLastSnapshot()?.you.mon?.attackCd ?? -1,
        pending: d.pendingInputs,
        ping: d.ping,
        seq: -1,
        inputAt: -1,
        frames: [],
        snaps: [],
        sounds: 0,
      };
      const snapFrom = probe.snaps.length;
      const soundsBefore = windups();
      // 거절 만들기: 서버에 '괴물 정지'를 먼저 보낸다. 입력과 같은 지연 큐를 순서대로 지나므로 서버는 이 누름을 정지 상태에서 받고,
      // 내 화면은 그 사실을 왕복 뒤에야 안다 (그 사이 예측한 준비가 떠 있다)
      if (kind === 'frozen') d.sendTest({ kind: 'freeze', target: d.you, frozen: true });
      const canvas = document.querySelector('canvas');
      if (!canvas) throw new Error('캔버스 없음');
      const r = canvas.getBoundingClientRect();
      const init: PointerEventInit = {
        bubbles: true,
        cancelable: true,
        button: 0,
        buttons: 1,
        pointerType: 'mouse',
        pointerId: 1,
        isPrimary: true,
        clientX: r.left + r.width / 2 + 120,
        clientY: r.top + r.height / 2,
      };
      canvas.dispatchEvent(new PointerEvent('pointerdown', init));
      setTimeout(() => window.dispatchEvent(new PointerEvent('pointerup', { ...init, buttons: 0 })), 25);
      return new Promise<Trial>((resolve) => {
        const limit = trial.press + 3000;
        let tail = -1;
        const frame = (): void => {
          const t = performance.now();
          const fx = d.getEffects();
          trial.frames.push({ t, range: fx.attackRange === true, fill: Number(fx.attackFill ?? 0) });
          if (trial.seq < 0) {
            const e = d.getInputLog().find((x) => x.t >= trial.press - 0.5 && (x.pressed & ATTACK) !== 0);
            if (e) {
              trial.seq = e.seq;
              trial.inputAt = e.t;
            }
          }
          trial.snaps = probe.snaps.slice(snapFrom);
          // 끝: 타격 결과가 왔거나, 서버가 이 입력을 처리했는데 준비가 없다(거절). 그 뒤 화면이 따라올 몇 프레임을 더 적는다
          if (tail < 0 && trial.seq >= 0) {
            const acked = trial.snaps.filter((x) => x.ack >= trial.seq);
            const started = trial.snaps.some((x) => x.windup > 0 || x.kinds.includes('attackStart'));
            if (trial.snaps.some((x) => x.kinds.includes('attackHit')) || (acked.length >= 2 && !started))
              tail = 6;
          }
          if (tail > 0) tail -= 1;
          if (tail === 0 || t > limit) {
            trial.sounds = windups() - soundsBefore;
            resolve(trial);
            return;
          }
          requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      });
    },
    edge(dtS) {
      const d = hook();
      return new Promise<Trial | null>((resolve) => {
        const finish = (v: Promise<Trial> | null): void => {
          probe.onSnap = null;
          if (v) void v.then(resolve);
          else resolve(null);
        };
        probe.onSnap = () => {
          const mon = d.getLastSnapshot()?.you.mon;
          const last = probe.snaps[probe.snaps.length - 1];
          if (!mon || !last) return;
          // 쿨타임이 끝났거나 이미 준비 중이면 이번 쿨타임에는 기회가 없었다
          if (mon.windup > 0 || mon.attackCd <= 0) {
            finish(null);
            return;
          }
          // 다음 입력 틱(한 틱 안)의 어림: 새 식 = 쿨타임 − 대기 입력 × 틱 (한 틱 가까이 넘게 끝남), 옛 식 = 쿨타임 −
          // (스냅샷 뒤 흐른 시간 + 왕복 / 2) (틱까지 한 틱이 더 흘러도 20ms 넘게 남음)
          const now = performance.now();
          const newLeft = mon.attackCd - d.pendingInputs * dtS;
          const oldLeft = mon.attackCd - (now - last.t) / 1000 - dtS - d.ping / 2000;
          if (newLeft <= -0.03 && oldLeft >= 0.02) finish(probe.press('edge'));
        };
      });
    },
  };
  (window as unknown as { __WPROBE__: WindupProbe }).__WPROBE__ = probe;
  const parse = JSON.parse.bind(JSON);
  JSON.parse = function (text: string, ...rest: unknown[]): unknown {
    const v = (parse as (...a: unknown[]) => unknown)(text, ...rest);
    if (v !== null && typeof v === 'object' && (v as { t?: unknown }).t === 'snap') {
      const s = (
        v as {
          s: {
            ack: number;
            you: { mon: { windup: number; attackCd: number } | null };
            events: { k: string }[];
          };
        }
      ).s;
      if (s.you.mon) {
        probe.snaps.push({
          t: performance.now(),
          ack: s.ack,
          windup: s.you.mon.windup,
          cd: s.you.mon.attackCd,
          kinds: s.events.map((e) => e.k),
        });
        if (probe.snaps.length > 600) probe.snaps.splice(0, 300);
        // 앱이 이 스냅샷을 다 처리한 뒤에 (같은 태스크의 끝)
        queueMicrotask(() => probe.onSnap?.());
      }
    }
    return v;
  } as typeof JSON.parse;
}

/** 서버가 이 누름으로 준비를 시작했는가 · 타격 결과 · 서버가 이 입력을 처리했다는 스냅샷이 도착한 시각 (없으면 null) */
function outcome(t: Trial): { accepted: boolean; hitAt: number | null; ackAt: number | null } {
  const accepted = t.snaps.some((s) => s.windup > 0 || s.kinds.includes('attackStart'));
  return {
    accepted,
    hitAt: t.snaps.find((s) => s.kinds.includes('attackHit'))?.t ?? null,
    ackAt: t.snaps.find((s) => s.ack >= t.seq)?.t ?? null,
  };
}

/** 받아들여진 누름: 누른 입력 틱에 예측으로 켜지고, 타격 결과가 올 때까지 꺼지지 않으며, 다 찬 채 기다렸다가, 결과에서 꺼진다 */
function expectPredictedAndHeld(t: Trial, label: string): void {
  const o = outcome(t);
  expect(t.seq, `${label}: 눌림이 실린 입력`).toBeGreaterThan(0);
  expect(o.accepted, `${label}: 서버가 받아들임`).toBe(true);
  if (o.hitAt === null || o.ackAt === null) throw new Error(`${label}: 타격 결과가 오지 않았다`);
  const hitAt = o.hitAt;
  const firstOn = t.frames.find((f) => f.range);
  if (!firstOn) throw new Error(`${label}: 범위 표시가 켜지지 않았다`);
  // ① 서버가 이 입력을 처리했다는 스냅샷이 오기 전에 켜졌다 = 예측 (서버를 기다렸다면 그 스냅샷 뒤에야 켜진다)
  expect(
    firstOn.t,
    `${label}: 범위가 켜진 시각이 서버 확인(누른 뒤 ${(o.ackAt - t.press).toFixed(0)}ms)보다 앞`,
  ).toBeLessThan(o.ackAt);
  // 그리고 그 입력 틱 뒤 두 프레임 안이다
  const waited = t.frames.filter((f) => f.t > t.inputAt && f.t < firstOn.t).length;
  expect(waited, `${label}: 입력 틱 뒤 범위가 켜지기까지 지난 프레임`).toBeLessThanOrEqual(1);
  // ② 켜진 뒤 타격 결과가 올 때까지 한 프레임도 꺼지지 않는다 (고치기 전: 0.4초에 꺼지고 결과까지 비었다)
  const shown = t.frames.filter((f) => f.t >= firstOn.t && f.t < hitAt);
  expect(
    shown.filter((f) => !f.range).map((f) => Math.round(f.t - t.press)),
    `${label}: 타격 결과(누른 뒤 ${(hitAt - t.press).toFixed(0)}ms) 전에 범위가 꺼진 프레임 (누른 뒤 ms)`,
  ).toEqual([]);
  // 채움은 줄지 않고(서버 확인으로 다시 시작하지 않는다) 준비 시간 뒤에는 다 찬 채 기다린다
  for (let i = 1; i < shown.length; i += 1)
    expect(shown[i]!.fill, `${label}: 채움이 줄었다`).toBeGreaterThanOrEqual(shown[i - 1]!.fill);
  expect(hitAt - t.inputAt, `${label}: 타격 결과는 준비 시간 + 왕복쯤 뒤`).toBeGreaterThan(
    WINDUP_MS + LAG / 2,
  );
  const held = shown.filter((f) => f.t > t.inputAt + WINDUP_MS + 20);
  expect(held.length, `${label}: 끝에서 대기한 프레임`).toBeGreaterThanOrEqual(2);
  expect(
    held.every((f) => f.fill === 1),
    `${label}: 대기 중 채움 1`,
  ).toBe(true);
  // ③ 타격 결과가 오면 꺼진다 · 준비 소리는 누를 때 한 번
  expect(t.frames[t.frames.length - 1]?.range, `${label}: 타격 결과 뒤`).toBe(false);
  expect(t.sounds, `${label}: 준비 소리`).toBe(1);
}

/**
 * 서버가 받지 않은 누름: 예측으로 범위가 켜졌다면(헛 준비) 서버 확인 전에 켜졌고, 서버 확인 스냅샷 뒤 두 프레임 안에 꺼져 다시
 * 켜지지 않으며 다 차지 않는다(준비 시간을 다 채우거나 끝에서 기다리지 않는다). 켜졌는가(헛 준비였는가)를 돌려준다
 */
function expectOffWhenRejected(t: Trial, label: string): boolean {
  const o = outcome(t);
  expect(o.accepted, `${label}: 서버가 받지 않음`).toBe(false);
  if (o.ackAt === null) throw new Error(`${label}: 서버 확인 스냅샷이 오지 않았다`);
  const ackAt = o.ackAt;
  const on = t.frames.filter((f) => f.range);
  if (on.length === 0) return false;
  expect(on[0]!.t, `${label}: 범위가 서버 확인 뒤에 켜졌다`).toBeLessThan(ackAt);
  const after = t.frames.filter((f) => f.t > ackAt);
  expect(after.length, `${label}: 서버 확인 뒤 프레임`).toBeGreaterThanOrEqual(4);
  expect(
    after.slice(2).some((f) => f.range),
    `${label}: 서버 확인 뒤에도 범위가 남았다`,
  ).toBe(false);
  expect(
    on.every((f) => f.fill < 1),
    `${label}: 다 차지 않는다`,
  ).toBe(true);
  expect(t.sounds, `${label}: 준비 소리`).toBeLessThanOrEqual(1);
  return true;
}

test(`왕복 ${LAG}ms: 쿨타임이 끝나는 무렵의 공격도 누른 입력 틱에 준비가 보이고, 타격 결과까지 이어지며, 서버가 거절한 누름은 꺼진다`, async ({
  browser,
}) => {
  const { context, page, problems } = await newPlayerPage(browser);
  await context.addInitScript(installWindupProbe);
  const code = await createRoom(page, `&bots=1&lag=${LAG}`);
  await pickRoleAndReady(page, 'monster');
  await press(page.getByTestId('start-button'));
  await waitForSnapshots(page, 3);
  const you = await myId(page);
  // 봇 셋을 시작 자리에 세운다 (괴물 시작 자리에서 20타일 넘게 멀다 — 밀치기 · 시야에 닿지 않는다)
  for (const p of (await truth(page, code)).players)
    if (p.id !== you) await sendTest(page, { kind: 'freeze', target: p.id, frozen: true });
  // 오디오 열기 (괴물 화면 클릭은 공격이 되므로 키로) + 시작 대기가 끝날 때까지
  await page.keyboard.press('KeyX');
  await page.waitForFunction(() => window.__DECOY__?.audioReady === true);
  await page.waitForFunction(() => window.__DECOY__?.getLastSnapshot()?.world.monsterWait === 0, undefined, {
    timeout: 20_000,
  });
  const ready = (): Promise<unknown> =>
    page.waitForFunction(() => {
      const mon = window.__DECOY__?.getLastSnapshot()?.you.mon;
      return mon?.attackCd === 0 && mon.windup === 0 && window.__DECOY__?.getEffects().attackRange === false;
    });
  const probePress = (kind: Trial['kind']): Promise<Trial> =>
    page.evaluate((k) => (window as unknown as { __WPROBE__: WindupProbe }).__WPROBE__.press(k), kind);
  const truthFrom = truthLogSize();
  let attacks = 0;

  // 1) 쿨타임이 다 찬 뒤: 누른 입력 틱에 예측 (지금도 되는 것 — 끝에서 대기 · 소리 한 번은 새 동작)
  await ready();
  const first = await probePress('fresh');
  expectPredictedAndHeld(first, '첫 공격');
  attacks += 1;

  // 2) 쿨타임이 끝나는 무렵: 옛 어림으로는 아직 쿨타임인 순간(서버는 받아들인다)에 누른다
  const edges: Trial[] = [];
  const skipped: string[] = [];
  /** 끝 무렵 누름 가운데 서버가 받지 않은 것 · 그중 예측으로 범위가 켜졌던 것(헛 준비) */
  let edgeRejected = 0;
  let edgeFalse = 0;
  for (let cycle = 0; cycle < 14 && edges.length < 2; cycle += 1) {
    const t = await page.evaluate(
      (dtS) => (window as unknown as { __WPROBE__: WindupProbe }).__WPROBE__.edge(dtS),
      1 / balance.network.serverTickHz,
    );
    if (t !== null) {
      const o = outcome(t);
      if (o.accepted) attacks += 1;
      // 누른 것이 그 스냅샷을 본 채로 입력 틱에 실렸을 때만 센다 (그 사이 새 스냅샷이 오면 어림이 달라진다)
      const sameSnap = t.seq > 0 && !t.snaps.some((s) => s.t <= t.inputAt);
      if (o.accepted && sameSnap) {
        edges.push(t);
        continue;
      }
      if (o.accepted) {
        skipped.push('누른 뒤 입력 틱 전에 새 스냅샷');
        continue;
      }
      // 서버가 받지 않은 끝 무렵 누름: 헛 준비였다면 서버 확인에서 바로 꺼져야 한다 (건너뛰기만 하지 않는다 — 검토)
      edgeRejected += 1;
      const falsePredicted = expectOffWhenRejected(t, `쿨타임 끝 무렵 (서버가 받지 않음 ${edgeRejected})`);
      if (falsePredicted) edgeFalse += 1;
      skipped.push(
        falsePredicted ? '서버가 받지 않음(헛 준비 — 서버 확인에서 꺼짐)' : '서버가 받지 않음(예측 안 함)',
      );
    } else skipped.push('조건에 맞는 스냅샷 없음');
    // 공격이 나가지 않았다: 쿨타임이 끝난 뒤 한 번 눌러 다음 쿨타임을 시작한다
    await ready();
    expect(outcome(await probePress('fresh')).accepted).toBe(true);
    attacks += 1;
  }
  expect(edges.length, `쿨타임 끝 무렵 누름 2번 (건너뜀: ${skipped.join(' · ')})`).toBe(2);
  for (const [i, t] of edges.entries()) {
    // 누른 순간: 서버 쿨타임이 스냅샷에는 아직 남아 있다 (옛 식으로는 예측하지 않던 창)
    expect(t.cd, `쿨타임 끝 무렵 ${i + 1}: 스냅샷의 쿨타임`).toBeGreaterThan(0.1);
    expectPredictedAndHeld(t, `쿨타임 끝 무렵 ${i + 1} (스냅샷 쿨타임 ${t.cd}초 · 대기 입력 ${t.pending}개)`);
  }
  console.log(
    `[a-4] 왕복 ${LAG}ms (핑 ${first.ping.toFixed(0)}ms): ` +
      [first, ...edges]
        .map((t) => {
          const o = outcome(t);
          const on = t.frames.find((f) => f.range);
          return `${t.kind} 누름 → 범위 ${((on?.t ?? NaN) - t.press).toFixed(0)}ms · 서버 확인 ${((o.ackAt ?? NaN) - t.press).toFixed(0)}ms · 타격 결과 ${((o.hitAt ?? NaN) - t.press).toFixed(0)}ms`;
        })
        .join(' / ') +
      ` · 끝 무렵 누름 중 서버가 받지 않음 ${edgeRejected} (그중 헛 준비 ${edgeFalse})` +
      (skipped.length > 0 ? ` (건너뜀: ${skipped.join(' · ')})` : ''),
  );

  // 3) 거절: 서버는 받지 않는데 내 화면은 모르는 누름 — 예측한 준비가 떴다가, 서버가 그 입력을 처리했다는 스냅샷에서 꺼진다
  await ready();
  const rejectFrom = truthLogSize();
  const rejected = await probePress('frozen');
  // 서버 확인 전에 떴다가 서버 확인이 온 뒤 두 프레임 안에 꺼지고 다시 켜지지 않는다 (준비 시간을 다 채우거나 끝에서 기다리지 않는다)
  expect(expectOffWhenRejected(rejected, '거절'), '거절: 예측한 준비가 떴다').toBe(true);
  const on = rejected.frames.filter((f) => f.range);
  expect(on.length, '거절: 예측한 준비가 떴다').toBeGreaterThanOrEqual(2);
  expect(on[on.length - 1]!.t - rejected.inputAt, '거절: 준비 시간보다 먼저 꺼진다').toBeLessThan(WINDUP_MS);
  expect(rejected.sounds, '거절: 준비 소리 (누를 때 한 번)').toBe(1);
  // 서버 정답 기록: 그 누름 뒤 준비가 시작된 틱이 없다
  expect(truthSince(rejectFrom, code).filter((f) => (f.monster?.windup ?? 0) > 0)).toEqual([]);
  await sendTest(page, { kind: 'freeze', target: you, frozen: false });

  // 판정은 그대로: 서버가 시작한 준비 수 = 받아들여진 누름 수 (정답 기록에서 준비가 0 → 양수로 바뀐 틱)
  await expect
    .poll(() => {
      const frames = truthSince(truthFrom, code);
      return frames.filter(
        (f, i) => (f.monster?.windup ?? 0) > 0 && (frames[i - 1]?.monster?.windup ?? 0) === 0,
      ).length;
    })
    .toBe(attacks);
  expect(problems).toEqual([]);
  await context.close();
});

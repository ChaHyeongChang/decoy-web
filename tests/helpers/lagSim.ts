// 지연 가짜 연결 (플레이테스트 반영 a-4): 가상 시계 위에서 괴물 한 명의 "누름 → 입력 틱 → 서버 준비 시작 틱 → 타격 틱 →
// 그 상태를 담은 스냅샷 도착"을 1ms 단위로 돌린다. 화면(Phaser)은 없다.
//  - 서버 = 실제 판정 코드(Game), 스냅샷은 20Hz · 값은 interest.ts와 같은 반올림(0.001초), 이벤트는 스냅샷에 실려 온다
//  - 지연 = 실제 LagQueue 둘(보낼 때 · 받을 때 왕복의 절반씩, 방향마다 ± 지터, 순서 보존)
//  - 클라이언트 = 실제 Predictor · predictMonsterPress · cooldownAheadSec · WindupShow · TouchInput, 순서는 GameScene.stepInput과 같다
// 부르는 시험은 vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance', 'Date'] })를 켜 둔다
import { vi } from 'vitest';
import {
  BTN,
  LagQueue,
  Rng,
  cloneMoveState,
  type GameEvent,
  type InputFrame,
  type MonsterSelf,
  type MoveEnv,
  type MoveState,
} from '@decoy/shared';
import { Game } from '@decoy/shared/sim';
import { applyWindupLock, cooldownAheadSec, predictMonsterPress } from '../../client/src/localActions';
import { Predictor } from '../../client/src/sync';
import { TouchInput } from '../../client/src/touchInput';
import { WindupShow } from '../../client/src/windupShow';
import { loadTestBalance, setup4 } from './fixtures';

const balance = loadTestBalance();
/** 틱 길이 (ms · 초) */
export const SIM_DT_MS = 1000 / balance.network.serverTickHz;
const DT_S = 1 / balance.network.serverTickHz;
const round3 = (v: number): number => Math.round(v * 1000) / 1000;

interface SimSnap {
  ack: number;
  move: MoveState;
  attackCd: number;
  windup: number;
  events: GameEvent[];
}

export interface SimPress {
  /** 누른 시각 (ms) */
  at: number;
  /** 터치 조준 스틱 짧은 탭: 지금 공격을 시작할 수 없다고 어림하면 보내지 않는다 (TouchInput.takePressed) */
  touch?: boolean;
}

/** 누름 하나의 경과 (시각은 모두 판 시작부터 ms, 없으면 null) */
export interface AttackTrace {
  press: number;
  /** 눌림을 실은 입력 프레임을 만든 입력 틱. 터치에서 버려졌으면 null */
  input: number | null;
  seq: number | null;
  /** 그 입력 틱에서 준비를 예측했는가 (WindupShow.press) */
  predicted: boolean;
  /** 서버가 이 입력으로 준비를 시작한 틱 (받아들이지 않았으면 null) */
  srvStart: number | null;
  /** 그 준비의 타격 틱 */
  srvStrike: number | null;
  /** 준비 시작(attackStart)을 실은 스냅샷이 도착한 시각 */
  startSeen: number | null;
  /** 타격(attackHit)을 실은 스냅샷이 도착한 시각 */
  hitSeen: number | null;
}

/** 1ms마다 본 표시 상태 (sample을 켰을 때) */
export interface ViewSample {
  t: number;
  on: boolean;
  fill: number;
  hold: boolean;
  startAt: number;
  /** 대기 중 세워 둔 자리 (없으면 null) */
  anchor: { x: number; y: number } | null;
  /** 그 시각 예측기의 자리 */
  me: { x: number; y: number };
}

export interface LagSimOptions {
  /** 왕복 지연 (?lag=N) */
  lag: number;
  jitter: number;
  seed: number;
  /** 서버 틱 · 클라이언트 입력 틱 위상 (0 ~ 틱 길이) */
  serverPhase: number;
  clientPhase: number;
  presses: SimPress[];
  until: number;
  /** 쿨타임 어림 바꿔 끼우기 (초). 없으면 제품 식 cooldownAheadSec(새 입력 seq, 스냅샷 ack, 틱, 스냅샷 뒤 흐른 시간, 왕복) */
  ageSec?: (c: { nowMs: number; lastSnapAt: number; lag: number; seq: number; ack: number }) => number;
  /** 서버 틱마다 game.step() 바로 앞에서 (판 상태를 직접 바꿔 거절 · 기절을 만든다) */
  beforeServerTick?: (game: Game, nowMs: number) => void;
  /** 1ms마다 표시 상태를 적는다 */
  sample?: boolean;
  /** 괴물이 계속 누르고 있는 이동 입력 (기본 0, 0) */
  move?: { mx: number; my: number };
  /** 괴물 시작 자리 (기본 시작 자리는 동쪽 벽 가까이라 걷는 시험은 열린 바닥으로 옮긴다) */
  start?: { x: number; y: number };
}

export interface LagSimResult {
  traces: AttackTrace[];
  /** 서버 타격 틱 시각들 */
  strikes: number[];
  /** 서버 쿨타임이 0이 된 틱 시각들 */
  cdEnds: number[];
  /** 준비 소리를 낸 시각들 (예측한 누름 · 예측하지 못한 attackStart) */
  sounds: number[];
  /** 예측한 준비가 서버 거절로 꺼진 시각들 (헛 준비 표시: 예측 → 그 입력을 처리한 스냅샷에 준비 없음) */
  rejects: number[];
  views: ViewSample[];
  /** 타격 이벤트(attackHit)가 알려 준 타격 자리 (도착 순서) */
  hitAt: { x: number; y: number }[];
  /** 도착한 스냅샷들 (sample을 켰을 때): 도착 시각 · ack · 준비 남은 시간 · 실린 이벤트 종류 */
  snaps: { t: number; ack: number; windup: number; kinds: string[] }[];
}

/** 판 하나를 0ms부터 until까지 돌린다. 괴물은 시작 대기 없이, 생존자는 입력 없이 서 있다 */
export function simulateLag(o: LagSimOptions): LagSimResult {
  const game = new Game(setup4(), balance, { seed: 1 });
  game.monster.move.frozen = 0;
  const mon = game.monster;
  if (o.start) {
    mon.move.x = o.start.x;
    mon.move.y = o.start.y;
  }
  const rng = new Rng(o.seed);
  const env: MoveEnv = {
    kind: 'monster',
    role: null,
    mover: { kind: 'monster', imprisoned: false, openExits: { N: false, S: false } },
    campActive: false,
    obstacles: [],
  };
  // 판마다 0에서 시작하는 시계 (가상 시계는 시험 안에서 계속 흐른다)
  const origin = performance.now();
  const now = (): number => performance.now() - origin;
  const half = o.lag / 2;
  const jitter = o.lag > 0 ? o.jitter : 0;
  const strikes: number[] = [];
  const cdEnds: number[] = [];
  const sounds: number[] = [];
  const rejects: number[] = [];
  const views: ViewSample[] = [];
  const hitAt: { x: number; y: number }[] = [];
  const snaps: LagSimResult['snaps'] = [];
  let lastWindup = 0;
  let lastCd = 0;
  // 클라이언트
  const predictor = new Predictor(balance, DT_S, now);
  const show = new WindupShow(balance.monster.attack.windup * 1000, SIM_DT_MS);
  const touch = new TouchInput();
  let lastSnap: SimSnap | null = null;
  let lastSnapAt = 0;
  const traces: AttackTrace[] = [];
  let pendingStart: AttackTrace | null = null;

  const toClient = new LagQueue<SimSnap>(
    half,
    jitter,
    (snap) => {
      lastSnap = snap;
      lastSnapAt = now();
      predictor.reconcile(snap.move, snap.ack, env);
      const before = show.phase;
      if (show.snapshot(snap.ack, snap.windup, snap.events, lastSnapAt, o.lag)) sounds.push(lastSnapAt);
      if (before === 'predicted' && show.phase === 'idle' && !snap.events.some((e) => e.k === 'stunned'))
        rejects.push(lastSnapAt);
      if (o.sample)
        snaps.push({ t: lastSnapAt, ack: snap.ack, windup: snap.windup, kinds: snap.events.map((e) => e.k) });
      for (const ev of snap.events) {
        if (ev.k === 'attackStart') {
          // 이 준비를 일으킨 입력: ack 이하에서 서버가 받아들인 가장 늦은 것
          const t = [...traces]
            .reverse()
            .find((x) => x.seq !== null && x.seq <= snap.ack && x.srvStart !== null);
          if (t && t.startSeen === null) {
            t.startSeen = lastSnapAt;
            pendingStart = t;
          }
        }
        if (ev.k === 'attackHit') {
          hitAt.push({ x: ev.x, y: ev.y });
          if (pendingStart) pendingStart.hitSeen = lastSnapAt;
          pendingStart = null;
        }
      }
    },
    () => rng.next(),
    now,
  );
  const toServer = new LagQueue<InputFrame>(
    half,
    jitter,
    (f) => game.queueInput(mon.id, [f]),
    () => rng.next(),
    now,
  );

  let seq = 0;
  let heldPress: SimPress | null = null;
  const pressQueue = [...o.presses].sort((a, b) => a.at - b.at);

  const serverTick = (): void => {
    const t = now();
    o.beforeServerTick?.(game, t);
    const ackBefore = mon.ack;
    const windupBefore = mon.windupLeft;
    game.step();
    // 이 틱에 준비가 시작됐는가 (입력 처리 → 같은 틱 combatTick이 한 번 줄인다)
    if (windupBefore <= 0 && mon.windupLeft > 0) {
      for (const tr of traces)
        if (tr.seq !== null && tr.seq > ackBefore && tr.seq <= mon.ack && tr.srvStart === null)
          tr.srvStart = t;
    }
    if (lastWindup > 0 && mon.windupLeft <= 0 && mon.attackCd > 0 && mon.move.stun <= 0) {
      strikes.push(t);
      for (const tr of traces) if (tr.srvStart !== null && tr.srvStrike === null) tr.srvStrike = t;
    }
    if (lastCd > 0 && mon.attackCd <= 0) cdEnds.push(t);
    lastWindup = mon.windupLeft;
    lastCd = mon.attackCd;
    const n = balance.network;
    const isSnap =
      Math.floor((game.tick * n.snapshotHz) / n.serverTickHz) !==
      Math.floor(((game.tick - 1) * n.snapshotHz) / n.serverTickHz);
    if (isSnap)
      toClient.push({
        ack: mon.ack,
        move: cloneMoveState(mon.move),
        attackCd: round3(mon.attackCd),
        windup: round3(mon.windupLeft),
        events: game.drainOutbox(mon.id),
      });
  };

  const clientTick = (at: number): void => {
    // 첫 스냅샷 없이는 입력을 보내지 않는다 (GameScene.stepInput: 예측 상태가 있어야 한다)
    const snap = lastSnap as SimSnap | null;
    const st = predictor.state;
    if (!snap || !st) return;
    const t = now();
    seq += 1;
    const monSelf: MonsterSelf = {
      attackCd: snap.attackCd,
      windup: snap.windup,
      dashCd: 0,
      roarCd: 0,
      mode: 'search',
      blend: 0,
      camp: 0,
      blockWarn: null,
    };
    // GameScene.predictMonster · touchCtx와 같은 어림
    const base = {
      move: st,
      mon: monSelf,
      balance,
      ageSec: o.ageSec
        ? o.ageSec({ nowMs: t, lastSnapAt, lag: o.lag, seq, ack: snap.ack })
        : cooldownAheadSec(seq, snap.ack, DT_S, t - lastSnapAt, o.lag),
      localWindupActive: show.active,
    };
    let pressed = 0;
    let trace: AttackTrace | null = null;
    if (heldPress) {
      const p = heldPress;
      heldPress = null;
      trace = {
        press: p.at,
        input: null,
        seq: null,
        predicted: false,
        srvStart: null,
        srvStrike: null,
        startSeen: null,
        hitSeen: null,
      };
      traces.push(trace);
      if (p.touch) {
        // 조준 스틱 짧은 탭: 손가락을 뗀 다음 입력 프레임에서 나간다 — 할 수 없다고 어림하면 버린다
        touch.stickStart(1, 'aim', p.at - 60);
        touch.stickEnd(1, p.at);
        const canAttack = predictMonsterPress({ ...base, pressed: BTN.ATTACK }).attack;
        pressed = touch.takePressed({ nowMs: t, face: st.face, canAttack, canDash: false });
      } else pressed = BTN.ATTACK;
    }
    const frame: InputFrame = {
      seq,
      mx: o.move?.mx ?? 0,
      my: o.move?.my ?? 0,
      aim: st.face,
      held: pressed,
      pressed,
    };
    if (trace && pressed !== 0) {
      trace.input = t;
      trace.seq = seq;
      if (predictMonsterPress({ ...base, pressed }).attack) {
        predictor.predictAction(seq, applyWindupLock(balance));
        show.press(seq, at, st.face, o.lag);
        sounds.push(t);
        trace.predicted = true;
      } else show.notePress(seq);
    }
    predictor.applyLocal(frame, env, at);
    show.noteStep(seq, st.x, st.y);
    toServer.push(frame);
  };

  // 가상 시간을 정수 ms로 흘린다: 서버 틱 · 입력 틱 · 누름은 그 시각을 지난 첫 정수 ms에 처리한다. 표본을 적을 때는 1ms씩,
  // 아니면 다음 일이 있는 ms로 건너뛴다 (지연 큐의 타이머는 그 사이 제 시각에 돈다 — 결과는 1ms씩 흘린 것과 같다)
  let nextServer = o.serverPhase;
  let nextClient = o.clientPhase;
  let t = 0;
  while (t <= o.until) {
    const due = Math.min(nextServer, nextClient, pressQueue[0]?.at ?? Infinity);
    const step = o.sample ? 1 : Math.max(1, Math.ceil(due) - t);
    vi.advanceTimersByTime(step);
    t = now();
    while (pressQueue.length > 0 && (pressQueue[0]?.at ?? Infinity) <= t)
      heldPress = pressQueue.shift() ?? null;
    while (nextServer <= t) {
      serverTick();
      nextServer += SIM_DT_MS;
    }
    while (nextClient <= t) {
      clientTick(nextClient);
      nextClient += SIM_DT_MS;
    }
    if (o.sample) {
      const v = show.view(t);
      const me = predictor.renderPos(0, undefined, t);
      views.push({
        t,
        on: v !== null,
        fill: v?.fill ?? 0,
        hold: v?.hold ?? false,
        startAt: v?.startAt ?? Number.NaN,
        anchor: v?.anchor ? { x: v.anchor.x, y: v.anchor.y } : null,
        me: { x: me?.x ?? Number.NaN, y: me?.y ?? Number.NaN },
      });
    }
  }
  return { traces, strikes, cdEnds, sounds, rejects, views, hitAt, snaps };
}

/** 가상 시계 켜기 옵션 (시험의 beforeEach에서 vi.useFakeTimers에 준다) */
export const LAG_SIM_TIMERS = {
  toFake: ['setTimeout', 'clearTimeout', 'performance', 'Date'] as (
    'setTimeout' | 'clearTimeout' | 'performance' | 'Date'
  )[],
  now: 0,
};

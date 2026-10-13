// 애니메이션 곡선 (M10b, VISUAL_SPEC 6장). 순수 함수: DOM · Phaser 없음.
//
// 규칙 시간(공격 준비 · 돌진 · 기절 · 보호 · 구조 · 능력 지속 · 노출)은 호출하는 쪽이 balance에서 읽어 넘긴다.
// 여기 상수는 장식 연출 시간뿐이다(ANIM). 시간은 초 단위이고 장식 시계(gfxNow)에서 온다.
import type { RoleId } from '@decoy/shared';
import type { CloakPose } from './shapes';

/** 장식 연출 상수 (그래픽 값, 판정과 무관) */
export const ANIM = {
  /** 대기 숨쉬기: 주기 · 크기 (2% 이내) */
  breathPeriodS: 2.6,
  breathAmp: 0.016,
  /** 걷기: 한 주기(두 발)에 가는 거리 (타일). 이동 거리로 위상을 정한다 → 멈추면 그 자세로 정지 */
  strideTiles: 1.1,
  /** 걷기 기울기 (도) */
  leanDeg: 4,
  /** 발: 앞뒤로 나가는 거리 · 옆 간격 (몸 반지름 배수) */
  footReach: 0.62,
  footSide: 0.5,
  /** 피격: 흰 번쩍 · 찌그러짐 */
  hitFlashMs: 80,
  squashMs: 120,
  squashAmt: 0.16,
  /** 수감: 보이던 자리에서 흩어짐 → 감옥에서 나타남 */
  imprisonDissolveMs: 300,
  imprisonAppearMs: 300,
  /** 탈출 페이드 · 사망(회색 → 페이드) */
  escapeFadeMs: 400,
  deathGrayMs: 100,
  deathFadeMs: 300,
  /** 괴물 타격 베기 호 */
  slashMs: 120,
  /** 괴물 망토 물결 주기 (대기 · 걷기) */
  cloakIdlePeriodS: 1.9,
  cloakWalkPeriodS: 0.75,
  /** 망토 물결 프레임 수 (품질 낮음은 절반) */
  cloakFrames: 8,
  /** 눈 깜빡임 */
  blinkPeriodS: 3.4,
  blinkMs: 130,
  /** 빨강 부채꼴 해치 펄스 주기 */
  hatchPulseS: 0.6,
  /** 보호 깜빡임 간격 (지금 규칙) */
  protectBlinkMs: 150,
  /**
   * 걷기 판단: 60fps 한 프레임(WALK_REF_MS) 동안 이보다 많이 움직이는 빠르기면 걷는 중 (타일).
   * 프레임 사이 거리가 아니라 시간당 빠르기로 비교한다(isWalking): 120fps에서도 같은 빠르기에서 걷기 시작 · 멈춤
   */
  walkEpsilon: 0.002,
  /** 걷기 자세 섞기(stepping 0 → 1)에 걸리는 시간 · 멈춤 자세로 돌아오는 시간 (ms) */
  stepInMs: 120,
  stepOutMs: 160,
} as const;

/** 걷기 판단 기준 시간 (ms): walkEpsilon은 60fps 한 프레임 동안의 거리다 */
export const WALK_REF_MS = 1000 / 60;

const TAU = Math.PI * 2;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** 대기 숨쉬기 크기 배율 (1 ± breathAmp) */
export function breathScale(tS: number, seed: number): number {
  return 1 + ANIM.breathAmp * Math.sin((TAU * tS) / ANIM.breathPeriodS + seed);
}

/** 이동 거리만큼 걷기 위상을 진행 (라디안). 시간과 무관해서 멈추면 그대로 */
export function advanceWalk(phase: number, distTiles: number): number {
  if (!(distTiles > 0)) return phase;
  return (phase + (TAU * distTiles) / ANIM.strideTiles) % TAU;
}

/**
 * ms 동안 distTiles를 움직였으면 걷는 중인가: 빠르기가 walkEpsilon / WALK_REF_MS보다 크고 1타일 / WALK_REF_MS보다 작다
 * (그보다 빠른 것은 순간이동 — 수감 · 스폰 · 다시 나타남). 60fps 한 프레임이면 예전 판단(거리 0.002 초과 · 1 미만)과 같다
 */
export function isWalking(distTiles: number, ms: number): boolean {
  if (!(ms > 0) || !(distTiles > 0)) return false;
  const perRef = (distTiles * WALK_REF_MS) / ms;
  return perRef > ANIM.walkEpsilon && perRef < 1;
}

/**
 * 한 프레임 사이 이동의 한 조각 (시간 순서): ms 동안 dist타일. 보간 경로의 꺾인 점에서 나눈다.
 * walk를 주면 걷는 중인지를 그것으로 정한다(내 캐릭터: 입력 틱에서 정한 값). 그래도 순간이동 빠르기면 걷지 않는다
 */
export interface TravelPiece {
  ms: number;
  dist: number;
  walk?: boolean;
}

/**
 * out[i]에 조각을 쓴다: 있는 객체를 다시 쓰고 없을 때만 만든다 (프레임마다 새 객체를 만들지 않게). 조각을 만드는 함수들은
 * out을 줄이지 않고 쓴 수를 돌려준다 — 뒤에 남은 객체는 다음에 다시 쓴다
 */
export function writePiece(out: TravelPiece[], i: number, ms: number, dist: number, walk?: boolean): void {
  const p = out[i];
  if (p) {
    p.ms = ms;
    p.dist = dist;
    p.walk = walk;
  } else out.push({ ms, dist, walk });
}

/** 이 조각 동안 걷는 중인가 */
function pieceWalks(p: TravelPiece, ms: number): boolean {
  if (p.walk === undefined) return isWalking(p.dist, ms);
  if (!p.walk || !(ms > 0)) return false;
  return (p.dist * WALK_REF_MS) / ms < 1;
}

/** 걷기 위상 · 걷기 자세 섞기 (엔티티마다 하나) */
export interface GaitState {
  phase: number;
  stepping: number;
}

/** 위상 prev에서 진행하다 처음 발이 닿는(π/2 + kπ) 곳까지 가는 비율 (0~1, 이번 진행 delta 라디안 안) */
function footfallFraction(prev: number, delta: number): number {
  if (!(delta > 0)) return 0;
  const level = (Math.floor((prev + Math.PI / 2) / Math.PI) + 1) * Math.PI - Math.PI / 2;
  return clamp01((level - prev) / delta);
}

/**
 * 내 캐릭터의 그린 자리가 틱 사이에 가는 빠르기 기록 하나 (입력 틱 · 스냅샷 보정마다): t부터 until까지 speed(타일/ms)로
 * 직선(예측 보간: 직전 틱 상태 → 지금 틱 상태)을 가고 그 뒤는 멈춘다. walk = 그 입력 틱에 예측 상태가 걸을 만큼 움직였는가
 */
export interface SelfStep {
  t: number;
  speed: number;
  until: number;
  walk: boolean;
}

/**
 * 내 캐릭터의 프레임 사이(from → to) 조각들: 기록이 바뀐 순간 · 보간이 다 간 순간(until)에서 나눈다. 거리는 예측 보간의
 * 빠르기로 잰다(보정 어긋남 · 보정 순간의 건너뜀은 걷기로 치지 않는다): 그린 자리의 프레임 사이 직선으로 재면 틱 · 보정이
 * 프레임 사이에 있어 fps마다 모퉁이 · 되돌림을 다르게 잰다 (렌더링 최적화). 쓴 조각 수를 돌려준다 (out 앞에서부터, writePiece).
 * 첫 기록 전 구간은 서 있던 것으로 본다. 기록이 없거나 이 구간 안에 아직 없으면 −1 (프레임 사이 직선으로 대신)
 */
export function selfPieces(steps: readonly SelfStep[], from: number, to: number, out: TravelPiece[]): number {
  if (!(to > from)) return -1;
  let i = -1;
  for (let k = 0; k < steps.length; k += 1) if ((steps[k]?.t ?? Infinity) <= from) i = k;
  const first = steps[0];
  if (!first) return -1;
  let n = 0;
  let t = from;
  if (i < 0) {
    // 첫 기록(판 시작 뒤 첫 입력 틱) 전에는 예측 보간이 없었다: 서 있던 것으로 본다
    if (first.t >= to) return -1;
    writePiece(out, n++, first.t - from, 0, false);
    t = first.t;
    i = 0;
  }
  for (;;) {
    const cur = steps[i];
    if (!cur) break;
    const next = steps[i + 1];
    const end = next && next.t <= to ? Math.max(t, next.t) : to;
    // 보간이 이 구간 안에서 다 가면 거기서 나눈다 (그 뒤는 멈춤)
    const split = cur.until > t && cur.until < end ? cur.until : end;
    const speed = cur.until > t ? cur.speed : 0;
    if (split > t) writePiece(out, n++, split - t, speed * (split - t), cur.walk);
    if (end > split) writePiece(out, n++, end - split, 0, cur.walk);
    t = end;
    if (!next || next.t > to) break;
    i += 1;
  }
  return n;
}

/**
 * 걷기 상태를 이동 조각들만큼 진행한다. 조각마다 걷는 중이면(isWalking) 그 거리만큼 위상을 돌리고, 걷기 자세 섞기는
 * 걷는 동안 stepInMs, 멈춘 동안 stepOutMs에 걸쳐 시간으로 바뀐다. 같은 경로를 몇 조각(프레임)으로 나눠도 결과가 같다
 * (렌더링 최적화: 60 · 120fps 같음). 돌려주는 값: 이번에 처음 발이 닿은 순간 (첫 조각 시작부터 ms, 없으면 null)
 */
export function stepGait(g: GaitState, pieces: readonly TravelPiece[], n = pieces.length): number | null {
  let t = 0;
  let fall: number | null = null;
  for (let i = 0; i < n; i += 1) {
    const p = pieces[i];
    if (!p) break;
    const ms = Math.max(0, p.ms);
    const moving = pieceWalks(p, ms);
    if (moving && p.dist > 0) {
      const prev = g.phase;
      const next = advanceWalk(prev, p.dist);
      if (fall === null && footfall(prev, next))
        fall = t + ms * footfallFraction(prev, (TAU * p.dist) / ANIM.strideTiles);
      g.phase = next;
    }
    g.stepping = moving
      ? Math.min(1, g.stepping + ms / ANIM.stepInMs)
      : Math.max(0, g.stepping - ms / ANIM.stepOutMs);
    t += ms;
  }
  return fall;
}

/**
 * 시간에 대해 일정한 빠르기로 목표를 따라가는 값 (0 → 1을 upMs, 1 → 0을 downMs에). 프레임마다 더하지 않고
 * 목표가 바뀐 순간(이벤트 · 스냅샷을 받은 시각)부터 잰다: 몇 fps로 읽어도 같은 시각에는 같은 값이다 (렌더링 최적화)
 */
export class LinearRamp {
  private from: number;
  private at = 0;
  private target: number;

  constructor(
    value: number,
    private readonly upMs: number,
    private readonly downMs: number = upMs,
  ) {
    this.from = value;
    this.target = value;
  }

  get goal(): number {
    return this.target;
  }

  /** 시각 t의 값 (마지막으로 정한 순간보다 앞이면 그 순간 값) */
  valueAt(t: number): number {
    const dt = Math.max(0, t - this.at);
    if (this.target > this.from) return Math.min(this.target, this.from + dt / Math.max(1e-6, this.upMs));
    if (this.target < this.from) return Math.max(this.target, this.from - dt / Math.max(1e-6, this.downMs));
    return this.from;
  }

  /** 목표를 시각 t부터 바꾼다 (값은 그 순간 값에서 이어 간다) */
  setTarget(target: number, t: number): void {
    if (target === this.target) return;
    this.from = this.valueAt(t);
    this.at = t;
    this.target = target;
  }

  /** 시각 t에 값을 바로 정한다 (목표는 그대로) */
  jump(value: number, t: number): void {
    this.from = value;
    this.at = t;
  }
}

/** 프레임 수를 품질에 맞춘다 (품질 낮음 = 절반) */
export function frameCount(full: number, half: boolean): number {
  return half ? Math.max(1, Math.floor(full / 2)) : full;
}

/** 위상을 frames 단계로 끊는다 (구운 프레임 · 절반 프레임 애니메이션) */
export function quantizePhase(phase: number, frames: number): number {
  const step = TAU / Math.max(1, frames);
  return Math.round(phase / step) * step;
}

export interface WalkPose {
  /** 두 발의 몸 기준 위치 (몸 반지름 배수, +x = 앞) */
  feet: readonly [{ x: number; y: number }, { x: number; y: number }];
  /** 몸 기울기 (라디안) */
  lean: number;
}

/** 걷기 자세: 발 교차 + 기울기. stepping 0~1 (멈춰 있으면 0 → 두 발 나란히) */
export function walkPose(phase: number, stepping: number): WalkPose {
  const k = clamp01(stepping);
  const s = Math.sin(phase);
  return {
    feet: [
      { x: ANIM.footReach * s * k, y: -ANIM.footSide },
      { x: -ANIM.footReach * s * k, y: ANIM.footSide },
    ],
    lean: ((ANIM.leanDeg * Math.PI) / 180) * Math.sin(phase) * k,
  };
}

/**
 * 발이 땅에 닿는 순간인가 (발이 가장 멀리 나간 위상 π/2 · 3π/2를 지났는가) — 발먼지. 한 걸음 주기(2π)에 정확히 두 번.
 * 위상은 advanceWalk가 [0, 2π)로 감싸므로 phase < prevPhase면 한 바퀴 넘어간 것으로 펴서 비교한다
 * (감싼 값을 그대로 비교하면 2π → 0 넘김에서 한 번 더 생긴다). 한 프레임 진행은 한 바퀴 미만(이동 1타일 미만)이다
 */
export function footfall(prevPhase: number, phase: number): boolean {
  const next = phase < prevPhase ? phase + TAU : phase;
  const a = Math.floor((prevPhase + Math.PI / 2) / Math.PI);
  const b = Math.floor((next + Math.PI / 2) / Math.PI);
  return a !== b;
}

/** 공격 준비 범위 채움 (0~1): 준비 시작 뒤 지난 시간 / attack.windup. 정확히 windup에 1 */
export function windupFill(elapsedS: number, windupS: number): number {
  if (!(windupS > 0)) return 1;
  return clamp01(elapsedS / windupS);
}

/** 서버 값(준비 남은 시간)으로 채움: 1 − 남은 / windup */
export function windupFillFromRemaining(remainingS: number, windupS: number): number {
  if (!(windupS > 0)) return 1;
  return clamp01(1 - remainingS / windupS);
}

/** 돌진 늘어남 (0~1): dash.duration 동안 1에서 0으로 (끝나면 0) */
export function dashStretch(elapsedS: number, durationS: number): number {
  if (!(durationS > 0) || elapsedS < 0) return 0;
  return clamp01(1 - elapsedS / durationS);
}

/** 피격 반응: 흰 번쩍(80ms) · 찌그러짐(120ms) 세기 0~1 */
export function hitReact(elapsedMs: number): { flash: number; squash: number } {
  if (elapsedMs < 0) return { flash: 0, squash: 0 };
  return {
    flash: clamp01(1 - elapsedMs / ANIM.hitFlashMs),
    squash: elapsedMs >= ANIM.squashMs ? 0 : Math.sin((Math.PI * elapsedMs) / ANIM.squashMs),
  };
}

/** 선형 페이드 (1 → 0) */
export function fadeOut(elapsedMs: number, durMs: number): number {
  return clamp01(1 - elapsedMs / Math.max(1, durMs));
}

/** 보호 깜빡임 (지금 규칙: 150ms마다 흰 테두리 켜짐/꺼짐) */
export function protectBlink(tMs: number): boolean {
  return Math.floor(tMs / ANIM.protectBlinkMs) % 2 === 0;
}

/** 괴물 눈 깜빡임 (주기마다 blinkMs 동안 감음) */
export function eyeBlink(tS: number, seed: number): boolean {
  const p = (((tS + seed) % ANIM.blinkPeriodS) + ANIM.blinkPeriodS) % ANIM.blinkPeriodS;
  return p < ANIM.blinkMs / 1000;
}

/** 망토 물결 프레임 번호 (0 ~ frames−1). 걷는 중이면 더 빠르다 */
export function cloakFrame(tS: number, moving: boolean, frames: number): number {
  const period = moving ? ANIM.cloakWalkPeriodS : ANIM.cloakIdlePeriodS;
  const f = Math.floor((((tS / period) % 1) + 1) * frames) % frames;
  return f;
}

/** 망토 물결 프레임 i의 자세 (굽는 쪽이 쓴다) */
export function cloakPoseFor(kind: 'idle' | 'move' | 'dash' | 'stun', i: number, frames: number): CloakPose {
  const phase = (TAU * i) / Math.max(1, frames);
  switch (kind) {
    case 'idle':
      return { phase, sway: 0.4, stretch: 0, droop: 0 };
    case 'move':
      return { phase, sway: 1, stretch: 0.12, droop: 0 };
    case 'dash':
      return { phase, sway: 0.5, stretch: 1, droop: 0 };
    case 'stun':
      return { phase, sway: 0.15, stretch: 0, droop: 1 };
    default:
      return { phase, sway: 0.4, stretch: 0, droop: 0 };
  }
}

/** 빨강 부채꼴 해치 펄스 (0~1, 주기 hatchPulseS) */
export function hatchPulse(tS: number): number {
  return 0.5 - 0.5 * Math.cos((TAU * tS) / ANIM.hatchPulseS);
}

/** 문자열 → 0~2π 위상 (같은 id면 같은 값) */
export function seedOf(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i += 1) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) / 4294967296) * TAU;
}

/**
 * 괴물 화면의 생존자 그리기 값 (흰색 위장 보호, R7). 역할 · 체력 · 능력 상태를 **인자로 받지 않는다**:
 * 모든 생존자가 같은 그림 키 · 같은 크기 · 같은 숨쉬기 위상 · 같은 걷기 곡선 · 같은 그림자를 쓴다.
 * reveal은 서버가 능력 노출 창(abilityRevealDuration) 동안 보낸 역할뿐이다(테두리 + 머리 위 문양)
 */
export interface HiddenSurvivorPose {
  /** 몸 그림 키 (역할과 무관하게 하나) */
  readonly sprite: 'survivor-hidden';
  readonly foot: 'foot-hidden';
  readonly shadow: 'shadow-survivor';
  readonly x: number;
  readonly y: number;
  /** 몸 회전 (바라보는 방향 + 걷기 기울기) */
  readonly rotation: number;
  readonly scale: number;
  readonly feet: WalkPose['feet'];
  readonly alpha: number;
  /** 보호 깜빡임 흰 테두리 */
  readonly blinkOutline: boolean;
  readonly reveal: RoleId | null;
}

/** 숨은 생존자 공통 숨쉬기 위상 (모두 같은 값: 위상 차이로도 구분되지 않게) */
export const HIDDEN_BREATH_SEED = 0;

export function hiddenSurvivorPose(
  x: number,
  y: number,
  face: number,
  walkPhase: number,
  stepping: number,
  protectedFlag: boolean,
  reveal: RoleId | null,
  clockMs: number,
  protectedAlpha: number,
): HiddenSurvivorPose {
  const w = walkPose(walkPhase, stepping);
  return {
    sprite: 'survivor-hidden',
    foot: 'foot-hidden',
    shadow: 'shadow-survivor',
    x,
    y,
    rotation: face + w.lean,
    scale: breathScale(clockMs / 1000, HIDDEN_BREATH_SEED),
    feet: w.feet,
    alpha: protectedFlag ? protectedAlpha : 1,
    blinkOutline: protectedFlag && protectBlink(clockMs),
    reveal,
  };
}

// 새 캐릭터 스타일의 아틀라스 프레임 (캐릭터 리디자인 2단계). 순수 데이터 + 고르기 함수 — Phaser · DOM을 import하지 않는다
// (단위 시험이 node에서 프레임 정의 · 이름 고르기를 그대로 본다).
//
// 굽기(art/atlas.ts bakeAtlas, style = 'new')는 아래 frameSpecs의 그림(client/src/art/chars/*)을 자세마다 한 칸씩 굽는다.
// 쉬는 자세는 옛 몸 그림 이름 그대로다('survivor-hidden', 'survivor-runner', 'monster-idle-0' …): 리그 · 디버그 sprite ·
// 정지 상태 시험이 두 스타일에서 같은 이름을 본다. 자세 프레임은 옛 이름 + '~' 꼬리표다('survivor-hidden~w3').
// 새 그림은 신발 · 팔 · 발톱 · 눈 · 눈빛을 몸 그림 안에 담는다: 옛 리그의 발 · 윤기 · 발톱 · 눈 · 눈빛 이미지는 새 스타일에서
// 빈 칸(EMPTY_ALIASES)을 가리키고 알파 0으로 둔다 — 캐릭터마다 이미지 2장(그림자 + 몸)만 그린다.
//
// 괴물 화면의 생존자(흰색 위장, VISUAL_SPEC 0장 ③): hiddenFrameNew는 걷기 위상 · 걷기 세기만 받는다 — 역할 · 체력 · 능력 ·
// 구조 · 수감 인자가 없다. 그림은 COMMON_ART(HiddenPose)의 쉬기 · 걷기뿐이다. 수감 자세도 쓰지 않는다: 기존 스타일은 수감자와
// 자유 생존자를 같은 흰 몸으로 그리므로(감옥 문은 수감자만 막아 자유 생존자도 감옥 안에 설 수 있다), 새 스타일만 수감 자세를
// 그리면 괴물이 고른 그림 설정에 따라 읽을 수 있는 판 정보가 달라진다(검토 반영).
import { COMMON_ART, MONSTER_ART, SURVIVOR_ART } from './chars/index';
import type { Drawing } from './chars/kit';
import {
  HIDDEN_REST,
  MONSTER_REST,
  SURVIVOR_REST,
  type HiddenPose,
  type MonsterPose,
  type RoleCharId,
  type SurvivorPose,
} from './chars/types';

const TAU = Math.PI * 2;

/** 걷기 한 주기를 끊는 프레임 수 (품질 낮음은 걷기 위상이 4단계로 끊겨 와서 짝수 번호만 쓴다) */
export const WALK_FRAMES = 8;
/** 수감 중 걷기 프레임 수 */
export const CAPTIVE_WALK_FRAMES = 4;
/** 괴물 망토 물결 프레임 수 (anim.ts ANIM.cloakFrames와 같다) */
export const CLOAK_FRAMES = 8;
/** 이보다 걷기 세기가 크면 걷기 프레임 (괴물 망토 '움직임'과 같은 기준) */
export const STEP_MIN = 0.3;

/**
 * 새 스타일 동작 길이 (ms, 장식 값 — 판정과 무관). 서버 이벤트를 받은 순간부터 이만큼 그 자세를 보인다.
 * 타격 = 괴물 베기 호(ANIM.slashMs)와 같은 길이, 포효 · 밀치기 · 탐지 = 그림 동작이 읽힐 만큼
 */
export const NEW_POSE_MS = {
  /** 피격 젖힘 (흰 번쩍 80ms보다 조금 길게) */
  hit: 220,
  strike: 120,
  roar: 650,
  shove: 380,
  scan: 600,
} as const;

/** 그림 상자 (단위 = 몸 반지름 1, +x = 바라보는 방향). 굽기 칸은 이 상자 + 외곽선 여백이다 */
export interface FrameBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * 생존자 · 괴물 그림이 들어가는 상자 (모든 자세 · 역할). 앞이 길고(얼굴 · 방패 · 망원경) 뒤 · 옆이 짧아 직사각 칸으로 굽는다.
 * 모든 프레임이 이 상자 안인지 단위 시험이 그림 경로를 표본으로 재서 본다(tests/unit/char-frames.test.ts)
 */
export const SURVIVOR_BOX: FrameBox = { x0: -1.08, y0: -1.12, x1: 1.22, y1: 1.12 };
export const MONSTER_BOX: FrameBox = { x0: -1.22, y0: -1.2, x1: 1.22, y1: 1.2 };

/** 프레임 하나: 이름 · 단위(s = 생존자 반지름, m = 괴물 반지름) · 상자 · 그림 (w = 외곽선 두께, 그림 단위) */
export interface CharFrameSpec {
  readonly name: string;
  readonly unit: 's' | 'm';
  readonly box: FrameBox;
  draw(w: number): Drawing;
}

/**
 * 그림 명령 기억 (이름 → Drawing). 외곽선 두께 w는 반지름만의 함수라 배율(zoom)과 무관하다: 판 중에 배율이 바뀌어
 * (자동 품질 하향 · 되돌림, 창 크기 · DPR · 회전) 다시 구울 때 그림 명령을 다시 만들지 않고 래스터만 한다.
 * 이름마다 하나만 들고, w가 다르면(반지름이 바뀌면) 그 자리를 바꾼다 — 많아야 프레임 수만큼이다
 */
export class DrawingMemo {
  private readonly map = new Map<string, { w: number; d: Drawing }>();
  /** 새로 만든 횟수 (시험 · 디버그) */
  made = 0;

  get(spec: CharFrameSpec, w: number): Drawing {
    const hit = this.map.get(spec.name);
    if (hit && hit.w === w) return hit.d;
    const d = spec.draw(w);
    this.made += 1;
    this.map.set(spec.name, { w, d });
    return d;
  }

  get size(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }
}

/** 새 스타일에서도 옛 그림 그대로 굽는 프레임 (그림자 · 나 표시 링 · 노출 링 · 문양 · 거품 · 먼지 — 작은 곳은 문양 유지) */
export const SHARED_FRAMES: readonly string[] = [
  'shadow-survivor',
  'shadow-monster',
  'ring-self',
  'ring-reveal-runner',
  'ring-reveal-guard',
  'ring-reveal-scout',
  'glyph-runner',
  'glyph-guard',
  'glyph-scout',
  'bubble',
  'mote',
];

/** 새 스타일에서 쓰지 않는 옛 부품 이름 (빈 칸 하나를 가리킨다. 리그가 만들 때 쓰는 이름이라 텍스처에 있어야 한다) */
export const EMPTY_ALIASES: readonly string[] = [
  'foot-runner',
  'foot-guard',
  'foot-scout',
  'foot-hidden',
  'gloss',
  'claw',
  'eyes-open',
  'eyes-blink',
  'eyes-stun',
  'eye-glow',
];

// ───────────────────────── 이름 표 (프레임마다 문자열을 만들지 않게 미리) ─────────────────────────

function series(base: string, tag: string, n: number): readonly string[] {
  return Array.from({ length: n }, (_, i) => `${base}~${tag}${i}`);
}

/** 역할 생존자 프레임 이름 (생존자 화면) */
export interface RoleFrameNames {
  /** 쉬기 (옛 이름) */
  readonly rest: string;
  readonly walk: readonly string[];
  /** 능력 동작 서 있는 자세 (action 값 순서대로: 가드는 0.5 · 1, 나머지는 1) */
  readonly action: readonly string[];
  /** 러너 질주 걷기 (action 1 + 걷기). 다른 역할은 빈 배열 */
  readonly sprint: readonly string[];
  readonly captive: string;
  readonly captiveWalk: readonly string[];
  /** 구조 중 (두 손을 앞으로) */
  readonly reach: string;
  /** 피격 자세 · 그 흰 번쩍 실루엣 */
  readonly hit: string;
  readonly hitFlash: string;
  /** 쉬기 흰 번쩍 · 사망 회색 (옛 이름) */
  readonly flash: string;
  readonly gray: string;
}

/** 역할별 능력 동작 세기 (서 있는 자세로 굽는 값) */
const ACTION_STEPS: Readonly<Record<RoleCharId, readonly number[]>> = {
  runner: [1],
  guard: [0.5, 1],
  scout: [1],
};

function roleNames(role: RoleCharId): RoleFrameNames {
  const base = `survivor-${role}`;
  return {
    rest: base,
    walk: series(base, 'w', WALK_FRAMES),
    action: ACTION_STEPS[role].map((_, i) => `${base}~a${i}`),
    sprint: role === 'runner' ? series(base, 's', WALK_FRAMES) : [],
    captive: `${base}~c`,
    captiveWalk: series(base, 'cw', CAPTIVE_WALK_FRAMES),
    reach: `${base}~r`,
    hit: `${base}~h`,
    hitFlash: `${base}~hf`,
    flash: `${base}-flash`,
    gray: `${base}-gray`,
  };
}

export const ROLE_FRAME_NAMES: Readonly<Record<RoleCharId, RoleFrameNames>> = {
  runner: roleNames('runner'),
  guard: roleNames('guard'),
  scout: roleNames('scout'),
};

/** 공통 생존자 프레임 이름 (괴물 화면) */
export const HIDDEN_FRAME_NAMES = {
  rest: 'survivor-hidden',
  walk: series('survivor-hidden', 'w', WALK_FRAMES),
  flash: 'survivor-hidden-flash',
} as const;

/** 괴물 프레임 이름 (대기 · 걷기 망토는 옛 이름) */
export const MONSTER_FRAME_NAMES = {
  idle: Array.from({ length: CLOAK_FRAMES }, (_, i) => `monster-idle-${i}`),
  move: Array.from({ length: CLOAK_FRAMES }, (_, i) => `monster-move-${i}`),
  dash: 'monster-dash',
  stun: 'monster-stun',
  windup: 'monster~wu',
  strike: 'monster~st',
  roar: 'monster~ro',
} as const;

// ───────────────────────── 고르기 (순수 함수) ─────────────────────────

/** 걷기 위상(라디안, 크기 제한 없음) → 0..n−1 칸 번호 (가장 가까운 칸) */
export function phaseIndex(phase: number, n: number): number {
  if (!Number.isFinite(phase) || n <= 0) return 0;
  const i = Math.round((phase / TAU) * n) % n;
  return i < 0 ? i + n : i;
}

/**
 * 괴물 화면 생존자의 프레임 (흰색 위장). 역할 · 체력 · 능력 · 구조 · 수감 인자를 받지 않는다 — 걷기 위상 · 걷기 세기뿐.
 * 같은 값이면 누구든 같은 이름이고, 멈춰 있으면 기존 스타일과 같은 'survivor-hidden'이다
 */
export function hiddenFrameNew(walkPhase: number, stepping: number): string {
  const N = HIDDEN_FRAME_NAMES;
  return stepping > STEP_MIN ? (N.walk[phaseIndex(walkPhase, WALK_FRAMES)] ?? N.rest) : N.rest;
}

/** 생존자 화면 팀원 · 나의 자세 입력 (그리는 쪽이 아는 값) */
export interface TeamFrameInput {
  walkPhase: number;
  stepping: number;
  /** 능력 동작 0~1 (러너 질주 중이면 1, 가드 밀치기 · 스카우트 탐지는 이벤트 뒤 시간으로) */
  action: number;
  captive: boolean;
  /** 구조 중 (구조 진행 > 0) */
  reach: boolean;
  /** 피격 반응 중 (흰 번쩍 · 젖힘) */
  hit: boolean;
  gray: boolean;
}

/** 팀원 · 나의 몸 프레임 (생존자 화면). 우선순위: 사망 회색 > 피격 > 수감 > 구조 > 능력 > 걷기 > 쉬기 */
export function teamFrameNew(role: RoleCharId, p: TeamFrameInput): string {
  const N = ROLE_FRAME_NAMES[role];
  if (p.gray) return N.gray;
  if (p.hit) return N.hit;
  const moving = p.stepping > STEP_MIN;
  if (p.captive)
    return moving ? (N.captiveWalk[phaseIndex(p.walkPhase, CAPTIVE_WALK_FRAMES)] ?? N.captive) : N.captive;
  if (p.reach) return N.reach;
  if (p.action > 0.05) {
    if (moving && N.sprint.length > 0) return N.sprint[phaseIndex(p.walkPhase, WALK_FRAMES)] ?? N.rest;
    const steps = ACTION_STEPS[role];
    // 가장 가까운 세기 (가드 0.5 · 1)
    let best = 0;
    for (let i = 1; i < steps.length; i += 1)
      if (Math.abs((steps[i] ?? 0) - p.action) < Math.abs((steps[best] ?? 0) - p.action)) best = i;
    return N.action[best] ?? N.rest;
  }
  return moving ? (N.walk[phaseIndex(p.walkPhase, WALK_FRAMES)] ?? N.rest) : N.rest;
}

/** 팀원 피격 흰 번쩍 프레임 (몸 프레임에 맞춘 실루엣) */
export function teamFlashNew(role: RoleCharId, hit: boolean): string {
  const N = ROLE_FRAME_NAMES[role];
  return hit ? N.hitFlash : N.flash;
}

/** 괴물 자세 입력 */
export interface MonsterFrameInput {
  stunned: boolean;
  dashing: boolean;
  /** 공격 준비 중 */
  windup: boolean;
  /** 타격 직후 (NEW_POSE_MS.strike 동안) */
  strike: boolean;
  /** 포효 직후 (NEW_POSE_MS.roar 동안) */
  roar: boolean;
  moving: boolean;
  /** 망토 프레임 번호 (0..CLOAK_FRAMES−1, anim cloakFrame) */
  cloak: number;
}

/** 괴물 몸 프레임. 우선순위: 기절 > 돌진 > 타격 > 공격 준비 > 포효 > 걷기 · 대기 망토 */
export function monsterFrameNew(p: MonsterFrameInput): string {
  const N = MONSTER_FRAME_NAMES;
  if (p.stunned) return N.stun;
  if (p.dashing) return N.dash;
  if (p.strike) return N.strike;
  if (p.windup) return N.windup;
  if (p.roar) return N.roar;
  const i = Math.max(0, Math.min(CLOAK_FRAMES - 1, Math.floor(p.cloak)));
  return (p.moving ? N.move[i] : N.idle[i]) ?? N.idle[0] ?? 'monster-idle-0';
}

// ───────────────────────── 굽기 정의 ─────────────────────────

const phaseAt = (i: number, n: number): number => (i / n) * TAU;

function survivorSpec(name: string, role: RoleCharId, pose: Partial<SurvivorPose>): CharFrameSpec {
  const p: SurvivorPose = { ...SURVIVOR_REST, ...pose };
  return { name, unit: 's', box: SURVIVOR_BOX, draw: (w) => SURVIVOR_ART[role].top(p, { w }) };
}

function hiddenSpec(name: string, pose: Partial<HiddenPose>): CharFrameSpec {
  const p: HiddenPose = { ...HIDDEN_REST, ...pose };
  return { name, unit: 's', box: SURVIVOR_BOX, draw: (w) => COMMON_ART.top(p, { w }) };
}

function monsterSpec(name: string, pose: Partial<MonsterPose>): CharFrameSpec {
  const p: MonsterPose = { ...MONSTER_REST, ...pose };
  return { name, unit: 'm', box: MONSTER_BOX, draw: (w) => MONSTER_ART.top(p, { w }) };
}

/** 새 스타일 캐릭터 프레임 전부 (역할 · 공통 생존자 · 괴물). 그림자 · 링 · 문양 · 거품 · 먼지는 atlas.ts가 옛 그림 그대로 굽는다 */
export function newStyleFrameSpecs(): CharFrameSpec[] {
  const out: CharFrameSpec[] = [];
  for (const role of ['runner', 'guard', 'scout'] as const) {
    const N = ROLE_FRAME_NAMES[role];
    out.push(survivorSpec(N.rest, role, {}));
    N.walk.forEach((n, i) => out.push(survivorSpec(n, role, { walk: phaseAt(i, WALK_FRAMES), stride: 1 })));
    ACTION_STEPS[role].forEach((a, i) => {
      const n = N.action[i];
      if (n) out.push(survivorSpec(n, role, { action: a }));
    });
    N.sprint.forEach((n, i) =>
      out.push(survivorSpec(n, role, { walk: phaseAt(i, WALK_FRAMES), stride: 1, action: 1 })),
    );
    out.push(survivorSpec(N.captive, role, { mode: 'captive' }));
    N.captiveWalk.forEach((n, i) =>
      out.push(survivorSpec(n, role, { mode: 'captive', walk: phaseAt(i, CAPTIVE_WALK_FRAMES), stride: 1 })),
    );
    out.push(survivorSpec(N.reach, role, { mode: 'reach' }));
    out.push(survivorSpec(N.hit, role, { hit: 1 }));
    out.push(survivorSpec(N.hitFlash, role, { hit: 1, tone: 'flash' }));
    out.push(survivorSpec(N.flash, role, { tone: 'flash' }));
    out.push(survivorSpec(N.gray, role, { tone: 'gray' }));
  }
  const H = HIDDEN_FRAME_NAMES;
  out.push(hiddenSpec(H.rest, {}));
  H.walk.forEach((n, i) => out.push(hiddenSpec(n, { walk: phaseAt(i, WALK_FRAMES), stride: 1 })));
  out.push(hiddenSpec(H.flash, { tone: 'flash' }));
  const M = MONSTER_FRAME_NAMES;
  M.idle.forEach((n, i) => out.push(monsterSpec(n, { cloak: phaseAt(i, CLOAK_FRAMES) })));
  M.move.forEach((n, i) => {
    const ph = phaseAt(i, CLOAK_FRAMES);
    out.push(monsterSpec(n, { cloak: ph, walk: ph, stride: 1 }));
  });
  out.push(monsterSpec(M.dash, { dash: 1 }));
  out.push(monsterSpec(M.stun, { stun: 1, eyes: 'stun' }));
  out.push(monsterSpec(M.windup, { windup: 1 }));
  out.push(monsterSpec(M.strike, { strike: 1 }));
  out.push(monsterSpec(M.roar, { roar: 1 }));
  return out;
}

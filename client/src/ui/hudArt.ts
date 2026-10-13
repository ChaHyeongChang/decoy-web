// HUD 그림 (M10c, VISUAL_SPEC 8 · 10장): 깎은 모서리 유리 패널 · 게이지 · 아이콘 타일 · 리본 · 눈금 링 · 실루엣을 그리는 함수와
// HUD가 보여 줄 값을 정하는 순수 함수(행동 칸 · 팀 카드 · 거점 게이지 · 타이머). DOM · Phaser를 쓰지 않는다(단위 테스트).
// 그림은 모두 아틀라스 한 장(ui/hudKit.ts)에 판 시작 · 백버퍼 배율이 바뀔 때만 굽고, 판 중 상태가 바뀌면 프레임만 바꾼다
// (매 프레임 Graphics · 텍스처 다시 올리기 없음). 크기가 바뀌는 패널은 9조각(가운데가 균일해 늘려도 같은 그림)으로 굽는다.
// 색만으로 구분하지 않기: 거점 상태 = 색 + 칩 아이콘, 생존자 상태 = 아이콘 + 글자 + 색, 배너 = 아이콘 + 색, 역할 = 실루엣 + 색.
import {
  RESCUE_POINT,
  type Balance,
  type PointState,
  type Role,
  type RoleId,
  type RosterEntry,
  type Snapshot,
  type SurvivorStatus,
} from '@decoy/shared';
import { HUD_TEXT, ROLE_CARDS, UI_TEXT } from '../data/storyText';
import { drawIcon, type IconId } from '../art/icons';
import {
  CLOAK_REST,
  GLYPHS,
  MONSTER_GLYPH_EYES,
  SURVIVOR_SHAPES,
  cloakOutline,
  tracePolys,
  type Poly,
  type Shape,
  type SurvivorShapeId,
} from '../art/shapes';
import {
  CONE,
  DANGER_BANNER,
  EXIT_GO,
  HIDDEN_SURVIVOR,
  INFO_BANNER,
  NEON,
  NEON_DIM,
  OUTLINE,
  PRISON_RED,
  ROLE,
  ROLE_TEXT,
  UI,
  WARN,
  WARN_TEXT,
  blendOver,
  type ContrastPair,
} from '../art/palette';
import { HUD, type HudLayoutSpec } from './layout';

type Ctx = CanvasRenderingContext2D;

// ───────────────────────── 색 ─────────────────────────

/** HUD 전용 색 (palette.ts에 더한 것). 글자에 쓰는 색은 HUD_TEXT_PAIRS가 대비를 고정한다 */
export const HC = {
  /** 실루엣 · 아이콘 우물 (패널보다 어두운 원판) */
  well: 0x060c13,
  /** 꺼진 아이콘 · 칸 (그래픽, 글자가 아님) */
  off: 0x3b4b5c,
  /** 꺼진 눈금 */
  tickOff: 0x1d3243,
  /** 키캡 */
  keycap: 0x172736,
  keycapEdge: 0x3d566b,
  /** 글자 · 아이콘용 밝은 빨강 (수감 · 1분 미만 · 괴물 행동) */
  red: ROLE_TEXT.monster,
  /** 탈출 (EXIT_GO의 글자용 밝은 변형) */
  green: 0x34d399,
  /** 시야 모드 (부채꼴 노랑) */
  cone: CONE.idle,
  /** 메모 상자 (벽 글씨): 알파 0.85 */
  note: 0x0c1620,
} as const;

export const NOTE_ALPHA = 0.85;

/** 강조색 (타일 테두리 · 눈금 링). line = 그래픽, text = 글자 · 아이콘. warn은 터치 거점 링 게이지의 정지 눈금만 */
export type Accent = 'runner' | 'guard' | 'scout' | 'monster' | 'neon' | 'cone' | 'warn';
/** 행동 타일 · 눈금 링을 굽는 강조색 (warn은 터치 배치에서만 링을 굽는다) */
export const ACCENTS: readonly Accent[] = ['runner', 'guard', 'scout', 'monster', 'neon', 'cone'];
export const ACCENT: Readonly<Record<Accent, { line: number; text: number }>> = {
  runner: { line: ROLE.runner, text: ROLE_TEXT.runner },
  guard: { line: ROLE.guard, text: ROLE_TEXT.guard },
  scout: { line: ROLE.scout, text: ROLE_TEXT.scout },
  monster: { line: ROLE.monster, text: ROLE_TEXT.monster },
  neon: { line: NEON, text: NEON },
  cone: { line: CONE.idle, text: CONE.idle },
  warn: { line: WARN, text: WARN },
};

/** HUD에서 새로 쓰는 글자 / 바탕 쌍 (palette.TEXT_PAIRS에 없는 것). tests/unit/hud.test.ts가 고정한다 */
export const HUD_TEXT_PAIRS: readonly ContrastPair[] = [
  { name: '부상 · 경고 글자 / 패널', fg: WARN, bg: UI.panel, min: 4.5 },
  { name: '수감 · 1분 미만 글자 / 패널', fg: HC.red, bg: UI.panel, min: 4.5 },
  { name: '탈출 글자 / 패널', fg: HC.green, bg: UI.panel, min: 4.5 },
  { name: '시야 모드 글자 / 띠', fg: HC.cone, bg: UI.background, min: 4.5 },
  { name: '거점 · 지도 글자 / 패널', fg: NEON, bg: UI.panel, min: 4.5 },
  { name: '본문 / 띠 바탕', fg: UI.text, bg: UI.background, min: 4.5 },
  { name: '흐린 글자 / 띠 바탕', fg: UI.textDim, bg: UI.background, min: 4.5 },
  { name: '행동 이름 (역할색 글자) / 띠', fg: ROLE_TEXT.guard, bg: UI.background, min: 4.5 },
  { name: '괴물 행동 글자 / 띠', fg: HC.red, bg: UI.background, min: 4.5 },
  { name: '키캡 글자 / 키캡', fg: UI.text, bg: HC.keycap, min: 4.5 },
  { name: "'나' 태그 글자 / 태그", fg: UI.background, bg: UI.text, min: 4.5 },
  { name: '쿨타임 초 / 꺼진 타일', fg: UI.white, bg: UI.panel, min: 4.5 },
  // 메모 상자는 알파 0.85: 그 아래가 가장 밝은 색(흰색)이어도 4.5:1
  {
    name: '메모 글자 / 메모 상자 (아래가 흰색일 때)',
    fg: UI.text,
    bg: blendOver(HC.note, 0xffffff, NOTE_ALPHA),
    min: 4.5,
  },
  { name: '정지 칩 아이콘 / 패널', fg: WARN, bg: UI.panel, min: 3 },
];

// ───────────────────────── 값 (순수 함수) ─────────────────────────

/** 남은 시간 m:ss (올림) */
export function fmtTime(sec: number): string {
  const t = Math.max(0, Math.ceil(sec));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

export type TimerMode = 'normal' | 'low' | 'grace';

/** 타이머: 최후의 30초 > 1분 미만 > 보통. 색과 함께 아이콘이 바뀐다 (색만으로 구분하지 않기) */
export function timerView(w: { timeLeft: number; grace: number | null }): { mode: TimerMode; text: string } {
  if (w.grace !== null) return { mode: 'grace', text: fmtTime(w.grace) };
  return { mode: w.timeLeft < 60 ? 'low' : 'normal', text: fmtTime(w.timeLeft) };
}

export const TIMER_LOOK: Readonly<Record<TimerMode, { icon: IconId; color: number; text: number }>> = {
  normal: { icon: 'timer', color: NEON_DIM, text: UI.text },
  low: { icon: 'warn', color: HC.red, text: HC.red },
  grace: { icon: 'exit', color: WARN, text: WARN },
};

/** 거점 게이지 상태 (서버 'blocked' = 정지) */
export type GaugeState = 'idle' | 'capturing' | 'paused' | 'done';
export const GAUGE_STATES: readonly GaugeState[] = ['idle', 'capturing', 'paused', 'done'];

export function gaugeState(s: PointState): GaugeState {
  return s === 'blocked' ? 'paused' : s;
}

/** 상태 칩 아이콘: 점령 중 ▶ · 정지 ‖ · 완료 ✓ (대기는 칩 없음) */
export const GAUGE_ICON: Readonly<Record<GaugeState, IconId | null>> = {
  idle: null,
  capturing: 'play',
  paused: 'pause',
  done: 'check',
};

export function gaugeColor(s: GaugeState): number {
  return s === 'paused' ? WARN : s === 'idle' ? UI.textDim : NEON;
}

export type StatusKey = keyof typeof HUD_TEXT.status;

export function statusKey(s: { status: SurvivorStatus; hp: number | null }, maxHp: number): StatusKey {
  if (s.status === 'dead') return 'dead';
  if (s.status === 'escaped') return 'escaped';
  if (s.status === 'imprisoned') return 'imprisoned';
  return (s.hp ?? maxHp) < maxHp ? 'injured' : 'normal';
}

/** 생존자 상태 = 아이콘 + 글자 + 색 */
export const STATUS_LOOK: Readonly<Record<StatusKey, { icon: IconId; color: number }>> = {
  normal: { icon: 'heart', color: UI.text },
  injured: { icon: 'injured', color: WARN },
  imprisoned: { icon: 'prison', color: HC.red },
  dead: { icon: 'dead', color: UI.textDim },
  escaped: { icon: 'escaped', color: HC.green },
};

/** 생존자 화면 팀 카드 한 장 (역할 순서: 러너 · 가드 · 스카우트) */
export interface TeamCard {
  id: string;
  role: RoleId;
  me: boolean;
  name: string;
  status: StatusKey;
  hp: number;
  jail: number;
  cd: number;
  connected: boolean;
}

const ROLE_ORDER: readonly RoleId[] = ['runner', 'guard', 'scout'];

/** 팀 카드 값: 나(예측 전 서버 값) + 팀원. 생존자 화면에서만 쓴다 (괴물 화면은 익명 statusList) */
export function teamCards(snap: Snapshot, roster: readonly RosterEntry[], balance: Balance): TeamCard[] {
  const me = snap.you;
  const out: TeamCard[] = [];
  const maxHp = balance.survivor.maxHp;
  if (me.role !== 'monster' && me.surv)
    out.push({
      id: me.id,
      role: me.role,
      me: true,
      name: '',
      status: statusKey({ status: me.surv.status, hp: me.surv.hp }, maxHp),
      hp: me.surv.status === 'free' ? me.surv.hp : 0,
      jail: me.surv.imprisonCount,
      cd: me.surv.abilityCd,
      connected: true,
    });
  for (const s of snap.survivors) {
    if (!s.role) continue;
    out.push({
      id: s.id,
      role: s.role,
      me: false,
      name: '',
      status: statusKey(s, maxHp),
      hp: s.status === 'free' ? (s.hp ?? 0) : 0,
      jail: s.imprisonCount ?? 0,
      cd: s.abilityCd ?? 0,
      connected: s.connected !== false,
    });
  }
  for (const c of out) c.name = roster.find((r) => r.id === c.id)?.name ?? '';
  return out.sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role));
}

// ───────────────────────── 행동 칸 (M11 터치 버튼과 같이 쓴다) ─────────────────────────

export type SlotId = 'ability' | 'rescue' | 'attack' | 'dash' | 'roar' | 'mode';
/** ready = 지금 쓸 수 있음, cooldown = 쿨타임, active = 효과 중(질주 · 탐지 · 공격 준비 · 돌진 · 추적 모드 · 구조 중), blocked = 지금은 못 씀 */
export type SlotState = 'ready' | 'cooldown' | 'active' | 'blocked';

export interface ActionSlot {
  id: SlotId;
  icon: IconId;
  label: string;
  /** 키캡 글자 (지금 조작 안내 문구 그대로) */
  key: string;
  accent: Accent;
  state: SlotState;
  /** 남은 쿨타임 (초, 0이면 없음) */
  cd: number;
  /** 링 채움 0~1: 쿨타임이면 지난 비율, 구조 중이면 진행, 준비 · 효과 중이면 1, 못 쓰면 0 */
  fill: number;
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

function slot(
  id: SlotId,
  icon: IconId,
  label: string,
  key: string,
  accent: Accent,
  cd: number,
  total: number,
  active: boolean,
  blocked: boolean,
): ActionSlot {
  const state: SlotState = active ? 'active' : cd > 0 ? 'cooldown' : blocked ? 'blocked' : 'ready';
  const fill = state === 'cooldown' ? clamp01(1 - cd / Math.max(1e-6, total)) : state === 'blocked' ? 0 : 1;
  return { id, icon, label, key, accent, state, cd: Math.max(0, cd), fill };
}

export const ABILITY_ICON: Readonly<Record<RoleId, IconId>> = {
  runner: 'sprint',
  guard: 'shove',
  scout: 'track',
};

/** 능력 이름 ('Space 질주 — …' → '질주') */
export function abilityName(role: RoleId): string {
  return ROLE_CARDS[role].ability.split(' — ')[0]?.replace('Space ', '') ?? '';
}

/**
 * 역할별 행동 칸 (순수 함수, 서버 스냅샷만 본다). 생존자: 능력(Space) · 구조(E), 괴물: 공격 · 돌진 · 포효 · 시야 모드.
 * 판이 멈췄으면(괴물 재접속 대기) 모두 못 씀. 생존자는 자유 상태일 때만, 괴물은 대기 · 기절 · 돌진 · 공격 준비 중이 아닐 때만 쓸 수 있다
 * (서버 monsterCanAct · survivorAbilityInput과 같은 조건). 구조는 팀원이 수감 중이고 내가 구조 구역 안일 때 ready
 */
export function actionSlots(snap: Snapshot, balance: Balance, role: Role): ActionSlot[] {
  const paused = snap.world.paused !== null;
  const mv = snap.you.move;
  if (role !== 'monster') {
    const s = snap.you.surv;
    if (!s) return [];
    const free = s.status === 'free';
    const cfg = balance.roles[role];
    const jailed = snap.survivors.some((o) => o.status === 'imprisoned');
    const inZone =
      Math.hypot(mv.x - RESCUE_POINT.x, mv.y - RESCUE_POINT.y) <= balance.prison.rescueRadius + 1e-9;
    const rescuing = s.rescue > 0;
    const rescue = slot(
      'rescue',
      'rescue',
      rescuing ? `${HUD_TEXT.rescuing} ${Math.round(s.rescue * 100)}%` : '구조',
      'E',
      'neon',
      0,
      1,
      rescuing,
      paused || !free || !jailed || !inZone,
    );
    if (rescuing) rescue.fill = clamp01(s.rescue);
    return [
      slot(
        'ability',
        ABILITY_ICON[role],
        abilityName(role),
        'Space',
        role,
        s.abilityCd,
        cfg.cooldown,
        s.abilityActive > 0,
        paused || !free,
      ),
      rescue,
    ];
  }
  const m = snap.you.mon;
  if (!m) return [];
  const b = balance.monster;
  const cant = paused || mv.frozen > 0 || mv.stun > 0 || mv.dash > 0 || m.windup > 0;
  const hunt = m.mode === 'hunt';
  return [
    slot(
      'attack',
      'attack',
      HUD_TEXT.attack,
      '좌클릭',
      'monster',
      m.attackCd,
      b.attack.cooldown,
      m.windup > 0,
      cant,
    ),
    slot('dash', 'dash', HUD_TEXT.dash, 'Shift', 'monster', m.dashCd, b.dash.cooldown, mv.dash > 0, cant),
    slot('roar', 'roar', HUD_TEXT.roar, 'Q', 'monster', m.roarCd, b.roar.cooldown, false, cant),
    slot(
      'mode',
      hunt ? 'visionHunt' : 'visionSearch',
      hunt ? UI_TEXT.modeHunt : UI_TEXT.modeSearch,
      '우클릭',
      'cone',
      0,
      1,
      hunt,
      paused || mv.stun > 0,
    ),
  ];
}

// ───────────────────────── 눈금 링 ─────────────────────────

/** 쿨타임 링 눈금 수 (맵 거점 눈금 링과 같은 언어) */
export const TICKS = 24;
/** 링 반지름 · 눈금 두께 (논리 px). 행동 타일(56)과 팀 카드 원판이 같은 링을 쓴다 */
export const RING = { r0: 19.5, r1: 24, w: 2.6 } as const;

/** 눈금 i의 각도: 12시에서 시계 방향, 칸 가운데 */
export function tickAngle(i: number): number {
  return -Math.PI / 2 + ((i + 0.5) / TICKS) * Math.PI * 2;
}

/** 채움 비율 → 켜진 눈금 수 */
export function litTicks(fill: number): number {
  return Math.max(0, Math.min(TICKS, Math.floor(clamp01(fill) * TICKS + 1e-9)));
}

// ───────────────────────── 9조각 · 아틀라스 배치 (순수) ─────────────────────────

/**
 * 한 축의 9조각 구간 (기기 픽셀 정수): 시작 a · 끝 b, 양 끝 조각 l · r. 가운데가 음수가 되면 0으로 둔다.
 * 반환: [[시작, 길이] × 3]
 */
export function sliceSpans(a: number, b: number, l: number, r: number): [number, number][] {
  const mid = Math.max(0, b - a - l - r);
  return [
    [a, l],
    [a + l, mid],
    [a + l + mid, r],
  ];
}

/**
 * 아틀라스 배치 (스카이라인 아래-왼쪽): 높은 것부터, 지금 쌓인 윤곽선 위에서 가장 낮게(같으면 왼쪽) 놓이는 자리에 둔다
 * (간격 pad). 줄 단위 선반보다 빈자리가 적다. 반환 = 같은 순서의 자리와 전체 크기
 */
export function packShelves(
  sizes: readonly { w: number; h: number }[],
  maxW: number,
  pad = 2,
): { at: { x: number; y: number }[]; w: number; h: number } {
  const order = sizes.map((_, i) => i).sort((i, j) => (sizes[j]?.h ?? 0) - (sizes[i]?.h ?? 0));
  const at: { x: number; y: number }[] = sizes.map(() => ({ x: 0, y: 0 }));
  /** 윤곽선: x 오름차순 구간들 (시작 x, 폭, 높이) */
  let sky: { x: number; w: number; y: number }[] = [{ x: 0, w: maxW, y: 0 }];
  let w = 0;
  let h = 0;
  for (const i of order) {
    const s = sizes[i];
    if (!s) continue;
    const rw = s.w + pad;
    let best: { x: number; y: number } | null = null;
    for (const seg of sky) {
      if (seg.x + rw + pad > maxW) break;
      let y = 0;
      for (const q of sky) if (q.x < seg.x + rw && q.x + q.w > seg.x) y = Math.max(y, q.y);
      if (!best || y < best.y) best = { x: seg.x, y };
    }
    const p = best ?? { x: 0, y: h };
    at[i] = { x: p.x + pad, y: p.y + pad };
    const top = p.y + s.h + pad;
    // 윤곽선 갱신: [p.x, p.x + rw)를 top으로 덮는다
    const next: { x: number; w: number; y: number }[] = [];
    for (const q of sky) {
      if (q.x + q.w <= p.x || q.x >= p.x + rw) next.push(q);
      else {
        if (q.x < p.x) next.push({ x: q.x, w: p.x - q.x, y: q.y });
        if (q.x + q.w > p.x + rw) next.push({ x: p.x + rw, w: q.x + q.w - p.x - rw, y: q.y });
      }
    }
    next.push({ x: p.x, w: rw, y: top });
    sky = next.sort((a, b) => a.x - b.x);
    w = Math.max(w, p.x + rw + pad);
    h = Math.max(h, top + pad);
  }
  return { at, w, h };
}

// ───────────────────────── 그리기 ─────────────────────────

export function rgba(c: number, a = 1): string {
  return `rgba(${(c >> 16) & 255},${(c >> 8) & 255},${c & 255},${a})`;
}

/** 두 색 섞기 (k = b 쪽 비율) */
export function mix(a: number, b: number, k: number): number {
  return blendOver(b, a, k);
}

/** 경로에 쓰는 부분 (단위 테스트는 기록용 가짜) */
export type PathLike = Pick<Ctx, 'moveTo' | 'lineTo' | 'closePath'>;

/** 모서리를 45°로 깎은 사각형 경로 (k = [왼위, 오른위, 오른아래, 왼아래] 깎은 길이). beginPath는 부르는 쪽이 */
export function chamfer(
  c: PathLike,
  x: number,
  y: number,
  w: number,
  h: number,
  k: readonly [number, number, number, number],
): void {
  const [a, b, d, e] = k;
  c.moveTo(x + a, y);
  c.lineTo(x + w - b, y);
  c.lineTo(x + w, y + b);
  c.lineTo(x + w, y + h - d);
  c.lineTo(x + w - d, y + h);
  c.lineTo(x + e, y + h);
  c.lineTo(x, y + h - e);
  c.lineTo(x, y + a);
  c.closePath();
}

/** 양 끝이 뾰족한 육각 막대 경로 (거점 게이지 · 타이머 틀, concept_06 게이지 언어). s = 끝 뾰족한 길이 */
export function hexBar(c: PathLike, x: number, y: number, w: number, h: number, s: number): void {
  c.moveTo(x, y + h / 2);
  c.lineTo(x + s, y);
  c.lineTo(x + w - s, y);
  c.lineTo(x + w, y + h / 2);
  c.lineTo(x + w - s, y + h);
  c.lineTo(x + s, y + h);
  c.closePath();
}

/** 기기 픽셀 한 줄 두께 (논리 px) */
const hair = (z: number, n = 1): number => Math.max(1, Math.round(z * n)) / z;

export interface PlateLook {
  fill: number;
  alpha: number;
  edge: number;
  edgeA: number;
  /** 테두리 두께 (기기 픽셀 배수, 기본 1) */
  edgeW?: number;
  cut: readonly [number, number, number, number];
  /** 안쪽 빛 (테두리에서 안으로 옅어짐) */
  glow?: number;
  glowA?: number;
  /** 왼위 모서리 강조 선 (청록 35% 등) */
  accent?: number;
  accentA?: number;
  /** 왼쪽 세로 띠 (메모 상자) */
  bar?: number;
  /** 아래 그림자 줄 (키캡) */
  shade?: boolean;
}

/** 깎은 모서리 유리 패널 (9조각: 모서리 밖은 균일) */
export function paintPlate(c: Ctx, w: number, h: number, z: number, p: PlateLook): void {
  const hl = hair(z, p.edgeW ?? 1);
  c.beginPath();
  chamfer(c, 0, 0, w, h, p.cut);
  c.fillStyle = rgba(p.fill, p.alpha);
  c.fill();
  if (p.shade) {
    c.save();
    c.clip();
    c.fillStyle = rgba(0x000000, 0.45);
    c.fillRect(0, h - hair(z, 2), w, h);
    c.restore();
  }
  if (p.glow !== undefined) {
    for (let i = 0; i < 6; i += 1) {
      const d = hl + i * 1.4;
      c.beginPath();
      chamfer(c, d, d, w - 2 * d, h - 2 * d, insetCut(p.cut, d));
      c.lineWidth = 1.4;
      c.strokeStyle = rgba(p.glow, (p.glowA ?? 0.2) * (1 - i / 6));
      c.stroke();
    }
  }
  if (p.bar !== undefined) {
    c.fillStyle = rgba(p.bar, 0.9);
    c.fillRect(hl, p.cut[0] + 2, hair(z, 3), h - p.cut[0] - p.cut[3] - 4);
  }
  c.beginPath();
  chamfer(c, hl / 2, hl / 2, w - hl, h - hl, insetCut(p.cut, hl / 2));
  c.lineWidth = hl;
  c.strokeStyle = rgba(p.edge, p.edgeA);
  c.stroke();
  if (p.accent !== undefined) {
    // 깎은 왼위 모서리를 따라 짧은 강조 선 (모서리 조각 안에만)
    const a = p.cut[0];
    const t = hair(z, 2);
    c.beginPath();
    c.moveTo(t / 2, a + 5);
    c.lineTo(t / 2, a);
    c.lineTo(a, t / 2);
    c.lineTo(a + 8, t / 2);
    c.lineWidth = t;
    c.lineCap = 'butt';
    c.lineJoin = 'miter';
    c.strokeStyle = rgba(p.accent, p.accentA ?? 0.35);
    c.stroke();
  }
}

function insetCut(k: readonly [number, number, number, number], d: number): [number, number, number, number] {
  const f = (v: number): number => (v > 0 ? Math.max(0, v - d * 0.41) : 0);
  return [f(k[0]), f(k[1]), f(k[2]), f(k[3])];
}

/** 양 끝 뾰족한 막대 틀 (게이지 · 타이머) */
export function paintHexFrame(
  c: Ctx,
  w: number,
  h: number,
  z: number,
  s: number,
  edge: number,
  glowA: number,
): void {
  const hl = hair(z);
  c.beginPath();
  hexBar(c, 0, 0, w, h, s);
  const g = c.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, rgba(0x13222f, 0.95));
  g.addColorStop(1, rgba(0x09131c, 0.95));
  c.fillStyle = g;
  c.fill();
  if (glowA > 0) {
    c.save();
    c.shadowColor = rgba(edge, glowA);
    c.shadowBlur = 6 * z;
    c.lineWidth = hl;
    c.strokeStyle = rgba(edge, 0.9);
    c.stroke();
    c.restore();
  }
  c.beginPath();
  hexBar(c, hl / 2, hl / 2, w - hl, h - hl, s - hl * 0.2);
  c.lineWidth = hl;
  c.strokeStyle = rgba(edge, 0.85);
  c.stroke();
}

/** 리본 (배너): 양 끝 제비꼬리 홈 + 왼쪽 아이콘 칸(더 어둡게) + 위 밝은 줄 */
export function paintRibbon(
  c: Ctx,
  w: number,
  h: number,
  z: number,
  color: number,
  notch: number,
  block: number,
): void {
  const body = (): void => {
    c.beginPath();
    c.moveTo(0, 0);
    c.lineTo(w, 0);
    c.lineTo(w - notch, h / 2);
    c.lineTo(w, h);
    c.lineTo(0, h);
    c.lineTo(notch, h / 2);
    c.closePath();
  };
  body();
  const g = c.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, rgba(mix(color, 0xffffff, 0.1)));
  g.addColorStop(1, rgba(mix(color, 0x000000, 0.12)));
  c.fillStyle = g;
  c.fill();
  c.save();
  body();
  c.clip();
  c.fillStyle = rgba(0x000000, 0.22);
  c.fillRect(notch + 3, 0, block, h);
  c.fillStyle = rgba(0xffffff, 0.28);
  c.fillRect(0, 0, w, hair(z));
  c.fillStyle = rgba(0x000000, 0.35);
  c.fillRect(0, h - hair(z), w, hair(z));
  c.restore();
}

/** 화면 가장자리 안쪽 빛 (발각 테두리, 정사각 원형 판 s): 가장자리 진한 줄 + 안으로 옅어지는 띠. 가운데는 비운다 */
export function paintEdgeGlow(c: Ctx, s: number, z: number, color: number, band: number): void {
  for (let k = 0; k < 4; k += 1) {
    c.save();
    c.translate(s / 2, s / 2);
    c.rotate((k * Math.PI) / 2);
    c.translate(-s / 2, -s / 2);
    const g = c.createLinearGradient(0, 0, 0, band);
    g.addColorStop(0, rgba(color, 0.6));
    g.addColorStop(0.15, rgba(color, 0.36));
    g.addColorStop(1, rgba(color, 0));
    c.beginPath();
    c.moveTo(0, 0);
    c.lineTo(s, 0);
    c.lineTo(s - band, band);
    c.lineTo(band, band);
    c.closePath();
    c.fillStyle = g;
    c.fill();
    c.restore();
  }
  const t = hair(z, 3);
  c.strokeStyle = rgba(color, 0.9);
  c.lineWidth = t;
  c.strokeRect(t / 2, t / 2, s - t, s - t);
}

/** 실루엣 · 문양: 어두운 외곽선 + 몸색 채움 + 어두운 문양 (월드 · 로비와 같은 모양, art/shapes.ts) */
export function paintShape(
  c: Ctx,
  s: Shape,
  k: number,
  rot: number,
  body: number,
  mark: number,
  ow: number,
): void {
  const each = (polys: readonly Poly[], fill: string, rule: CanvasFillRule): void => {
    for (const p of polys) {
      c.beginPath();
      tracePolys(c, [p], k, 0, 0, rot);
      c.fillStyle = fill;
      c.fill(rule);
    }
  };
  if (ow > 0) {
    c.beginPath();
    tracePolys(c, s.outline, k, 0, 0, rot);
    c.lineJoin = 'round';
    c.lineWidth = ow * 2;
    c.strokeStyle = rgba(OUTLINE);
    c.stroke();
  }
  each(s.outline, rgba(body), 'nonzero');
  each(s.marks, rgba(mark), 'evenodd');
}

function circle(c: Ctx, r: number): void {
  c.beginPath();
  c.arc(0, 0, r, 0, Math.PI * 2);
}

// ───────────────────────── 아틀라스 목록 ─────────────────────────

/** 고정 크기 그림: 기준점(0, 0) 둘레의 범위(논리 px)와 그리기 (기준점 좌표계) */
export interface FrameSpec {
  kind: 'frame';
  name: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  paint(c: Ctx, z: number): void;
}

/**
 * 늘어나는 패널 (9조각, v = false면 가로 3조각). l · r · t · b = 모서리 조각 크기(논리 px), v = false면 높이 t 고정.
 * 그리기는 (0, 0) ~ (w, h) 원형 판에 한다: 모서리 조각 밖(가운데 줄 · 칸)은 늘려도 같은 그림이어야 한다
 */
export interface KitSpec {
  kind: 'kit';
  name: string;
  l: number;
  r: number;
  t: number;
  b: number;
  v: boolean;
  paint(c: Ctx, w: number, h: number, z: number): void;
}

export type AtlasSpec = FrameSpec | KitSpec;

// 프레임 이름은 HUD가 매 갱신마다 수십 번 묻는다 (눈금 링 24칸 · 아이콘 · 미니맵 그림). 같은 문자열을 다시 만들지 않게
// 눈금 · 링은 미리 만든 표에서, 아이콘 · 미니맵 · 실루엣은 처음 만든 문자열을 기억해 돌려준다 (렌더링 최적화 2). 결과 문자열은
// 예전 템플릿과 같다 (tests/unit/hud-gate.test.ts가 옛 함수와 견준다)
const ALL_ACCENTS: readonly Accent[] = [...ACCENTS, 'warn'];
const TICK_NAMES = new Map<Accent, readonly string[]>(
  ALL_ACCENTS.map((a) => [a, Array.from({ length: TICKS }, (_, i) => `t:${a}:${i}`)]),
);
const RING_NAMES = new Map<Accent | 'off', string>(
  [...ALL_ACCENTS, 'off' as const].map((a) => [a, `r:${a}`]),
);
/** 아이콘 이름: 아이콘별 (색 × 1024 + 크기) → 이름. 크기 · 색이 정수가 아니거나 범위 밖이면 기억하지 않고 만든다 */
const ICON_NAMES = new Map<IconId, Map<number, string>>();
const MM_NAMES = new Map<string, string>();
const SIL_NAMES = new Map<SurvivorShapeId, readonly [string, string]>();

function iconName(id: IconId, color: number, size: number): string {
  if (!(Number.isInteger(size) && size >= 0 && size < 1024 && Number.isInteger(color) && color >= 0))
    return `i:${id}:${color.toString(16)}:${size}`;
  let byKey = ICON_NAMES.get(id);
  if (!byKey) {
    byKey = new Map();
    ICON_NAMES.set(id, byKey);
  }
  const key = color * 1024 + size;
  let name = byKey.get(key);
  if (name === undefined) {
    name = `i:${id}:${color.toString(16)}:${size}`;
    byKey.set(key, name);
  }
  return name;
}

/** 아틀라스 프레임 이름 */
export const FR = {
  icon: iconName,
  tick: (a: Accent, i: number): string => TICK_NAMES.get(a)?.[i] ?? `t:${a}:${i}`,
  ring: (a: Accent | 'off'): string => RING_NAMES.get(a) ?? `r:${a}`,
  /** 카드 원판 실루엣 (오른쪽 위를 봄, DIAL.rot), on = 살아 있음 */
  sil: (s: SurvivorShapeId, on: boolean): string => {
    let pair = SIL_NAMES.get(s);
    if (!pair) {
      pair = [`s:${s}:0`, `s:${s}:1`];
      SIL_NAMES.set(s, pair);
    }
    return pair[on ? 1 : 0];
  },
  /** 정면 문양 (점수판 · 조작 안내) */
  glyph: (g: RoleId | 'monster' | 'hidden', size: number): string => `g:${g}:${size}`,
  /** 미니맵 그림 */
  mm: (k: string): string => {
    let name = MM_NAMES.get(k);
    if (name === undefined) {
      name = `m:${k}`;
      MM_NAMES.set(k, name);
    }
    return name;
  },
} as const;

const square = (name: string, half: number, paint: (c: Ctx, z: number) => void): FrameSpec => ({
  kind: 'frame',
  name,
  x0: -half,
  y0: -half,
  x1: half,
  y1: half,
  paint,
});

const kit = (
  name: string,
  e: { l: number; r: number; t: number; b?: number; v?: boolean },
  paint: KitSpec['paint'],
): KitSpec => ({ kind: 'kit', name, l: e.l, r: e.r, t: e.t, b: e.b ?? e.t, v: e.v ?? true, paint });

/** 아이콘 하나 (가운데 기준) */
function iconSpec(id: IconId, color: number, size: number): FrameSpec {
  return square(FR.icon(id, color, size), size / 2 + 1, (c) =>
    drawIcon(c, id, -size / 2, -size / 2, size, rgba(color)),
  );
}

const PANEL: PlateLook = {
  fill: UI.panel,
  alpha: UI.panelAlpha,
  edge: UI.panelBorder,
  edgeA: 1,
  cut: [8, 0, 8, 0],
  accent: UI.panelAccent,
  accentA: UI.panelAccentAlpha,
};

/** 카드 원판 실루엣 몸 반지름 (우물 반지름 17 안: 앞 돌출 1.55배 = 16.3) */
export const DIAL = { well: 17, body: 10.5, rot: -Math.PI / 3 } as const;
/** 미니맵 그림 몸 반지름 (지도 1타일 ≈ 4.6px, 실제보다 크게) */
export const MM_BODY = 4.6;

/** HUD가 쓰는 모든 그림 (아틀라스 한 장). 이름이 겹치지 않는다 */
/** 행동 칸 아이콘 프레임 이름: 쓸 수 있거나 효과 중이면 강조색, 아니면 꺼진 색 (hud.ts가 그리고, hud.test.ts가 아틀라스에 있는지 본다) */
export function slotIconFrame(s: ActionSlot): string {
  const on = s.state === 'ready' || s.state === 'active';
  return FR.icon(s.icon, on ? ACCENT[s.accent].text : HC.off, 26);
}

export function hudSpecs(h: HudLayoutSpec = HUD): AtlasSpec[] {
  const out: AtlasSpec[] = [];
  /** 터치 배치 (M12): 링 게이지 · 큰 상태 아이콘을 더 굽고, 쓰지 않는 막대 게이지는 굽지 않는다 */
  const touch = h.touch !== null;
  const seen = new Set<string>();
  const add = (s: AtlasSpec): void => {
    if (seen.has(s.name)) return;
    seen.add(s.name);
    out.push(s);
  };
  const icon = (id: IconId, color: number, size: number): void => add(iconSpec(id, color, size));

  // ── 패널 (9조각) ──
  add(kit('card', { l: 18, r: 12, t: 16 }, (c, w, h, z) => paintPlate(c, w, h, z, PANEL)));
  for (const r of ['runner', 'guard', 'scout'] as const)
    add(
      kit(`card:${r}`, { l: 18, r: 12, t: 16 }, (c, w, h, z) =>
        paintPlate(c, w, h, z, {
          ...PANEL,
          edge: ROLE[r],
          edgeA: 0.9,
          edgeW: 2,
          accent: ROLE_TEXT[r],
          accentA: 0.9,
        }),
      ),
    );
  add(
    kit('ov', { l: 24, r: 16, t: 20 }, (c, w, h, z) =>
      paintPlate(c, w, h, z, { ...PANEL, alpha: 0.95, cut: [12, 0, 12, 0], accentA: 0.6 }),
    ),
  );
  add(kit('mm', { l: 18, r: 12, t: 16 }, (c, w, h, z) => paintPlate(c, w, h, z, { ...PANEL, alpha: 0.95 })));
  add(
    kit('note', { l: 16, r: 12, t: 12 }, (c, w, h, z) =>
      paintPlate(c, w, h, z, {
        ...PANEL,
        fill: HC.note,
        alpha: NOTE_ALPHA,
        edgeA: 0.8,
        cut: [10, 0, 10, 0],
        bar: NEON_DIM,
        accent: undefined,
      }),
    ),
  );
  add(
    kit('hint', { l: 18, r: 14, t: h.hint.h, v: false }, (c, w, hh, z) =>
      paintPlate(c, w, hh, z, { ...PANEL, cut: [8, 0, 8, 0] }),
    ),
  );
  add(
    kit('kc', { l: 6, r: 6, t: 24, v: false }, (c, w, h, z) =>
      paintPlate(c, w, h, z, {
        fill: HC.keycap,
        alpha: 1,
        edge: HC.keycapEdge,
        edgeA: 1,
        cut: [3, 3, 3, 3],
        shade: true,
      }),
    ),
  );
  add(
    kit('tag', { l: 5, r: 5, t: 20, v: false }, (c, w, h, z) =>
      paintPlate(c, w, h, z, { fill: UI.text, alpha: 1, edge: UI.text, edgeA: 1, cut: [4, 0, 4, 0] }),
    ),
  );
  add(
    kit('hr', { l: 60, r: 60, t: 2, v: false }, (c, w, _h, z) => {
      const g = c.createLinearGradient(0, 0, w, 0);
      g.addColorStop(0, rgba(UI.panelBorder, 0));
      g.addColorStop(60 / w, rgba(UI.panelBorder, 1));
      g.addColorStop(1 - 60 / w, rgba(UI.panelBorder, 1));
      g.addColorStop(1, rgba(UI.panelBorder, 0));
      c.fillStyle = g;
      c.fillRect(0, 0, w, hair(z));
    }),
  );
  add(kit('spot', { l: 44, r: 44, t: 44 }, (c, w, _h, z) => paintEdgeGlow(c, w, z, ROLE.monster, 42)));

  // ── 행동 타일 (9조각): 꺼짐 · 준비(강조색 테두리 + 안쪽 빛) · 효과 중(강조색 채움) ──
  const tileCut: [number, number, number, number] = [9, 0, 9, 0];
  add(
    kit('tile:off', { l: 13, r: 13, t: 13 }, (c, w, h, z) =>
      paintPlate(c, w, h, z, { fill: UI.panel, alpha: 0.94, edge: UI.panelBorder, edgeA: 1, cut: tileCut }),
    ),
  );
  for (const a of ACCENTS) {
    const line = ACCENT[a].line;
    add(
      kit(`tile:${a}`, { l: 13, r: 13, t: 13 }, (c, w, h, z) =>
        paintPlate(c, w, h, z, {
          fill: UI.panel,
          alpha: 0.94,
          edge: line,
          edgeA: 0.95,
          edgeW: 1.5,
          cut: tileCut,
          glow: line,
          glowA: 0.22,
        }),
      ),
    );
    add(
      kit(`tile:${a}:a`, { l: 13, r: 13, t: 13 }, (c, w, h, z) =>
        paintPlate(c, w, h, z, {
          fill: mix(UI.panel, line, 0.26),
          alpha: 0.96,
          edge: mix(line, 0xffffff, 0.35),
          edgeA: 1,
          edgeW: 2,
          cut: tileCut,
          glow: mix(line, 0xffffff, 0.3),
          glowA: 0.35,
        }),
      ),
    );
  }

  // ── 위 띠: 게이지 막대 틀 (3조각) · 채움 · 사선 · 배지 · 칩 · 타이머 틀 ──
  const G = h.gauge;
  const gs = G.barH / 2;
  for (const s of touch ? [] : GAUGE_STATES)
    add(
      kit(`gbar:${s}`, { l: gs + 4, r: gs + 4, t: G.barH, v: false }, (c, w, h, z) =>
        paintHexFrame(c, w, h, z, gs, s === 'idle' ? 0x2c4a5e : gaugeColor(s), s === 'done' ? 0.8 : 0),
      ),
    );
  const fillW = G.barW - 6;
  const fillH = G.barH - 6;
  for (const [n, col] of touch
    ? []
    : ([
        ['neon', NEON],
        ['warn', WARN],
      ] as const))
    add({
      kind: 'frame',
      name: `gfill:${n}`,
      x0: 0,
      y0: 0,
      x1: fillW,
      y1: fillH,
      paint: (c) => {
        c.beginPath();
        hexBar(c, 0, 0, fillW, fillH, fillH / 2);
        const g = c.createLinearGradient(0, 0, 0, fillH);
        g.addColorStop(0, rgba(mix(col, 0xffffff, 0.25)));
        g.addColorStop(0.5, rgba(col));
        g.addColorStop(1, rgba(mix(col, 0x000000, 0.2)));
        c.fillStyle = g;
        c.fill();
      },
    });
  // 사선 무늬 (주기 STRIPE_P를 기기 픽셀 정수로: 끝없이 흐르게)
  if (!touch)
    add({
      kind: 'frame',
      name: 'gstripe',
      x0: 0,
      y0: 0,
      x1: fillW + STRIPE_P,
      y1: fillH,
      paint: (c, z) => {
        const p = Math.round(STRIPE_P * z) / z;
        c.fillStyle = rgba(0xffffff, 0.3);
        for (let x = -fillH; x < fillW + STRIPE_P + fillH; x += p) {
          c.beginPath();
          c.moveTo(x, fillH);
          c.lineTo(x + p * 0.45, fillH);
          c.lineTo(x + p * 0.45 + fillH, 0);
          c.lineTo(x + fillH, 0);
          c.closePath();
          c.fill();
        }
      },
    });
  for (const s of GAUGE_STATES) {
    const col = gaugeColor(s);
    add(
      square(`dia:${s}`, G.dia / 2 + 3, (c, z) => {
        const h = G.dia / 2;
        c.beginPath();
        c.moveTo(0, -h);
        c.lineTo(h, 0);
        c.lineTo(0, h);
        c.lineTo(-h, 0);
        c.closePath();
        c.fillStyle = rgba(s === 'done' ? mix(UI.panel, NEON, 0.3) : UI.panel, 0.96);
        c.fill();
        c.lineWidth = hair(z, 2);
        c.lineJoin = 'miter';
        c.strokeStyle = rgba(col);
        c.stroke();
      }),
    );
    const ic = GAUGE_ICON[s];
    if (ic)
      add(
        square(`chip:${s}`, G.chip / 2 + 1, (c, z) => {
          const h = G.chip / 2;
          c.beginPath();
          chamfer(c, -h, -h, G.chip, G.chip, [5, 0, 5, 0]);
          c.fillStyle = rgba(s === 'paused' ? mix(UI.panel, WARN, 0.16) : UI.panel, 0.96);
          c.fill();
          c.lineWidth = hair(z, 1.5);
          c.strokeStyle = rgba(col);
          c.stroke();
          const is = Math.round((G.chip * 2) / 3);
          drawIcon(c, ic, -is / 2, -is / 2, is, rgba(col), 1.1);
        }),
      );
  }
  for (const m of ['normal', 'low', 'grace'] as const) {
    const col = m === 'normal' ? 0x2c4a5e : TIMER_LOOK[m].color;
    add(
      kit(`timer:${m}`, { l: 18, r: 18, t: h.timer.h, v: false }, (c, w, hh, z) =>
        paintHexFrame(c, w, hh, z, Math.round((h.timer.h * 14) / 44), col, m === 'normal' ? 0 : 0.7),
      ),
    );
    icon(TIMER_LOOK[m].icon, TIMER_LOOK[m].color, 20);
  }

  // ── 눈금 링 ──
  const ringPaint =
    (color: number, from: number, to: number) =>
    (c: Ctx): void => {
      c.lineWidth = RING.w;
      c.lineCap = 'butt';
      c.strokeStyle = rgba(color);
      for (let i = from; i < to; i += 1) {
        const a = tickAngle(i);
        c.beginPath();
        c.moveTo(Math.cos(a) * RING.r0, Math.sin(a) * RING.r0);
        c.lineTo(Math.cos(a) * RING.r1, Math.sin(a) * RING.r1);
        c.stroke();
      }
    };
  add(square(FR.ring('off'), RING.r1 + 0.6, ringPaint(HC.tickOff, 0, TICKS)));
  for (const a of touch ? [...ACCENTS, 'warn' as const] : ACCENTS) {
    add(square(FR.ring(a), RING.r1 + 0.6, ringPaint(ACCENT[a].line, 0, TICKS)));
    for (let i = 0; i < TICKS; i += 1) {
      const t = tickAngle(i);
      const xs = [Math.cos(t) * RING.r0, Math.cos(t) * RING.r1];
      const ys = [Math.sin(t) * RING.r0, Math.sin(t) * RING.r1];
      add({
        kind: 'frame',
        name: FR.tick(a, i),
        x0: Math.min(...xs) - RING.w / 2 - 0.5,
        y0: Math.min(...ys) - RING.w / 2 - 0.5,
        x1: Math.max(...xs) + RING.w / 2 + 0.5,
        y1: Math.max(...ys) + RING.w / 2 + 0.5,
        paint: ringPaint(ACCENT[a].line, i, i + 1),
      });
    }
  }

  // ── 카드: 우물 · 실루엣 · 체력 칸 · 수감 눈금 ──
  add(
    square('well', DIAL.well + 1, (c, z) => {
      circle(c, DIAL.well - 0.5);
      const g = c.createRadialGradient(0, -4, 2, 0, 0, DIAL.well);
      g.addColorStop(0, rgba(0x122130));
      g.addColorStop(1, rgba(HC.well));
      c.fillStyle = g;
      c.fill();
      c.lineWidth = hair(z);
      c.strokeStyle = rgba(UI.panelBorder);
      c.stroke();
    }),
  );
  for (const s of ['runner', 'guard', 'scout', 'hidden'] as const)
    for (const on of [true, false]) {
      const body = !on ? HC.off : s === 'hidden' ? HIDDEN_SURVIVOR : ROLE[s];
      add(
        square(FR.sil(s, on), DIAL.body * 1.6 + 2, (c) =>
          paintShape(c, SURVIVOR_SHAPES[s], DIAL.body, DIAL.rot, body, OUTLINE, 1.2),
        ),
      );
    }
  const cell = (name: string, w: number, h: number, fill: number | null, edge: number): void =>
    add({
      kind: 'frame',
      name,
      x0: -w / 2 - 1,
      y0: -h / 2 - 1,
      x1: w / 2 + 1,
      y1: h / 2 + 1,
      paint: (c, z) => {
        const t = hair(z);
        c.beginPath();
        chamfer(c, -w / 2 + t / 2, -h / 2 + t / 2, w - t, h - t, [3, 0, 3, 0]);
        if (fill !== null) {
          c.fillStyle = rgba(fill);
          c.fill();
        }
        c.lineWidth = t;
        c.strokeStyle = rgba(edge);
        c.stroke();
      },
    });
  for (const r of ['runner', 'guard', 'scout'] as const)
    cell(`hp:${r}`, 16, 10, ROLE[r], mix(ROLE[r], 0xffffff, 0.3));
  cell('hp:off', 16, 10, null, HC.off);
  cell('jail:on', 9, 13, PRISON_RED, mix(PRISON_RED, 0xffffff, 0.35));
  cell('jail:off', 9, 13, null, HC.off);

  // ── 아이콘 (색 · 크기별) ──
  for (const r of ['runner', 'guard', 'scout'] as const) {
    icon(ABILITY_ICON[r], ROLE_TEXT[r], 26);
    icon(ABILITY_ICON[r], HC.off, 26);
    icon(ABILITY_ICON[r], ROLE_TEXT[r], 16);
    icon(ABILITY_ICON[r], HC.off, 16);
  }
  for (const [id, col] of [
    ['rescue', NEON],
    ['attack', HC.red],
    ['dash', HC.red],
    ['roar', HC.red],
    ['visionSearch', HC.cone],
    ['visionHunt', HC.cone],
  ] as const) {
    icon(id, col, 26);
    icon(id, HC.off, 26);
  }
  for (const k of Object.keys(STATUS_LOOK) as StatusKey[])
    icon(STATUS_LOOK[k].icon, STATUS_LOOK[k].color, 16);
  icon('disconnected', UI.textDim, 16);
  if (touch) {
    // 터치 팀 카드: 상태 아이콘을 크게 (글자 대신)
    for (const k of Object.keys(STATUS_LOOK) as StatusKey[])
      icon(STATUS_LOOK[k].icon, STATUS_LOOK[k].color, 20);
    icon('disconnected', UI.textDim, 20);
  }
  icon('prison', UI.textDim, 16);
  for (const [id, col] of BANNER_ICONS) icon(id, col, 24);
  icon('prison', HC.red, 20);
  icon('eye', UI.textDim, 20);
  icon('timer', WARN, 20);
  icon('note', NEON_DIM, 20);
  icon('map', NEON, 18);
  icon('point', NEON, 18);
  icon('attack', HC.red, 18);

  // ── 정면 문양 (점수판 · 조작 안내) ──
  for (const size of [22, 32]) {
    for (const r of ['runner', 'guard', 'scout'] as const)
      add(
        square(FR.glyph(r, size), size / 2 + 2, (c) =>
          paintShape(c, GLYPHS[r], size / 2, 0, ROLE[r], UI.panel, 0),
        ),
      );
    add(
      square(FR.glyph('monster', size), size / 2 + 2, (c) => {
        paintShape(c, GLYPHS.monster, size / 2, 0, ROLE.monster, 0x1a0b0e, 0);
        c.fillStyle = rgba(0xfff1f2);
        for (const e of MONSTER_GLYPH_EYES) {
          c.beginPath();
          c.arc(e.x * (size / 2), e.y * (size / 2), size * 0.045, 0, Math.PI * 2);
          c.fill();
        }
      }),
    );
    add(
      square(FR.glyph('hidden', size), size / 2 + 2, (c) =>
        paintShape(c, SURVIVOR_SHAPES.hidden, size * 0.34, -Math.PI / 2, HIDDEN_SURVIVOR, OUTLINE, 1),
      ),
    );
  }

  // ── 미니맵 (생존자 화면 = 역할 실루엣 축소판, 괴물 화면 = 흰 공통 실루엣) ──
  for (const s of ['runner', 'guard', 'scout', 'hidden'] as const)
    add(
      square(FR.mm(s), MM_BODY * 1.6 + 2, (c) =>
        paintShape(
          c,
          SURVIVOR_SHAPES[s],
          MM_BODY,
          0,
          s === 'hidden' ? HIDDEN_SURVIVOR : ROLE[s],
          OUTLINE,
          0.9,
        ),
      ),
    );
  add(
    square(FR.mm('monster'), 9, (c) => {
      c.beginPath();
      tracePolys(c, [cloakOutline(CLOAK_REST)], 6.2);
      c.lineJoin = 'round';
      c.lineWidth = 2;
      c.strokeStyle = rgba(OUTLINE);
      c.stroke();
      c.fillStyle = rgba(ROLE.monster);
      c.fill();
      c.fillStyle = rgba(0x1a0b0e);
      c.beginPath();
      c.ellipse(3.6, 0, 1.2, 2, 0, 0, Math.PI * 2);
      c.fill();
    }),
  );
  add(
    square(FR.mm('self'), 9, (c) => {
      circle(c, 7.5);
      c.lineWidth = 1.5;
      c.strokeStyle = rgba(0xffffff, 0.95);
      c.stroke();
    }),
  );
  const diamond = (name: string, h: number, fill: number | null, edge: number): void =>
    add(
      square(FR.mm(name), h + 1.5, (c) => {
        c.beginPath();
        c.moveTo(0, -h);
        c.lineTo(h, 0);
        c.lineTo(0, h);
        c.lineTo(-h, 0);
        c.closePath();
        if (fill !== null) {
          c.fillStyle = rgba(fill);
          c.fill();
        }
        c.lineWidth = 1.3;
        c.strokeStyle = rgba(edge);
        c.stroke();
      }),
    );
  diamond('track', 4, ROLE.scout, OUTLINE);
  diamond('roarPing', 3.4, 0xffffff, OUTLINE);
  diamond('point', 4.5, null, NEON);
  add(
    square(FR.mm('roarSelf'), 6, (c) => {
      circle(c, 4.5);
      c.lineWidth = 2;
      c.strokeStyle = rgba(WARN);
      c.stroke();
    }),
  );
  add(
    square(FR.mm('prison'), 5, (c) => {
      c.fillStyle = rgba(PRISON_RED);
      c.fillRect(-3.5, -3.5, 7, 7);
      c.fillStyle = rgba(OUTLINE);
      c.fillRect(-1, -1.5, 2, 3);
    }),
  );
  add({
    kind: 'frame',
    name: FR.mm('exit'),
    x0: -6,
    y0: -3.5,
    x1: 6,
    y1: 3.5,
    paint: (c) => {
      c.fillStyle = rgba(EXIT_GO);
      c.fillRect(-4.5, -2, 9, 4);
    },
  });

  // ── 배너 리본 (3조각): 지속 배너 높이 · 알림 줄 높이 ──
  const B = h.banner;
  for (const [tone, rh] of [
    ['danger', B.h],
    ['warn', B.h],
    ['info', B.rowH],
    ['warn', B.rowH],
  ] as const) {
    const notch = Math.round(rh * 0.28);
    add(
      kit(`rb:${tone}:${rh}`, { l: notch + 3 + rh + 10, r: notch + 6, t: rh, v: false }, (c, w, hh, z) =>
        paintRibbon(c, w, hh, z, TONE[tone].bg, notch, rh),
      ),
    );
  }
  return out;
}

/** 사선 무늬 주기 (논리 px) */
export const STRIPE_P = 12;

/** 배너 톤: 바탕 · 글자 (WARN 위 글자는 #0B1622, 8.49:1) */
export type Tone = 'danger' | 'warn' | 'info';
export const TONE: Readonly<Record<Tone, { bg: number; text: number }>> = {
  danger: { bg: DANGER_BANNER, text: UI.white },
  warn: { bg: WARN, text: WARN_TEXT },
  info: { bg: INFO_BANNER, text: UI.white },
};

/** 배너 아이콘 (톤 글자색으로 굽는다) */
export const BANNER_ICONS: readonly (readonly [IconId, number])[] = [
  ['eye', UI.white],
  ['check', UI.white],
  ['exit', UI.white],
  ['rescue', UI.white],
  ['point', UI.white],
  ['warn', WARN_TEXT],
  ['exit', WARN_TEXT],
  ['disconnected', WARN_TEXT],
  ['prison', WARN_TEXT],
  ['point', WARN_TEXT],
  ['roar', WARN_TEXT],
];

// ───────────────────────── 조작 안내 줄 (조작 안내 · 점수판) ─────────────────────────

/** 조작 안내 한 줄: 키캡 + (누르고 있기 같은 덧말) + 설명이 이어지거나, 키 없는 목표 문장 */
export type ControlRow =
  { kind: 'keys'; pairs: { key: string; note: string; desc: string }[] } | { kind: 'goal'; text: string };

/**
 * storyText CONTROLS 한 줄을 나눈다: ' · '로 나뉜 조각마다 '키  설명'(공백 두 칸). 공백 두 칸이 없는 조각은 앞 설명에 붙인다.
 * 키에 괄호 덧말이 있으면 떼어 낸다('E (누르고 있기)' → 키캡 E + 덧말). 공백 두 칸이 하나도 없으면 목표 문장
 */
export function parseControl(line: string): ControlRow {
  if (!line.includes('  ')) return { kind: 'goal', text: line };
  const pairs: { key: string; note: string; desc: string }[] = [];
  for (const seg of line.split(' · ')) {
    const i = seg.indexOf('  ');
    const last = pairs[pairs.length - 1];
    if (i < 0) {
      if (last) last.desc += ` · ${seg}`;
      continue;
    }
    const head = seg.slice(0, i);
    const p = head.indexOf(' (');
    pairs.push({
      key: p < 0 ? head : head.slice(0, p),
      note: p < 0 ? '' : head.slice(p + 1),
      desc: seg.slice(i + 2),
    });
  }
  return { kind: 'keys', pairs };
}

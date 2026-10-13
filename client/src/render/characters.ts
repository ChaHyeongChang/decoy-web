// 캐릭터 그리기 (M10b, VISUAL_SPEC 4장). 좌표는 월드 px(1타일 = 32px), 위치 인자는 타일.
//
// 몸 · 발 · 그림자 · 망토 · 발톱 · 눈은 구운 그림(art/atlas.ts)을 이미지로 찍는다. 링 · 마커는 Graphics(범위는 render/vision.ts).
// 레이어(정보 우선 R1): 그림자 → 바닥 링 → 몸 아래 표시(노출 문양 · 기절 별) → 발 · 몸 → 부착 표시(거품 · 진행 링) → 안개 위 마커.
// 노출 문양 · 기절 별은 머리 위로 떠 있어 옆 캐릭터 몸에 걸칠 수 있으므로 모든 몸 아래에 그린다(남의 몸을 덮어
// 그 사람 역할 · 상태로 잘못 읽히지 않게, R7 · R15). 문양은 옆 몸과 겹치지 않는 자리(shapes.ts glyphSlot)에 둔다.
//
// 괴물 화면의 생존자(흰색 위장, R7)는 drawHiddenSurvivor만 그린다. 이 함수는 역할 · 체력 · 능력 상태 인자를
// **받지 않는다**(art/anim.ts hiddenSurvivorPose): 모두 같은 그림 키 · 크기 · 숨쉬기 · 걷기 · 그림자 · 발먼지다.
import Phaser from 'phaser';
import { TILE_PX, type RoleId } from '@decoy/shared';
import {
  ANIM,
  breathScale,
  hiddenSurvivorPose,
  hitReact,
  newHiddenSurvivorPose,
  newWalkPose,
  protectBlink,
  walkPose,
  type HitReact,
  type WalkPose,
} from '../art/anim';
import { CONE, DANGER, OUTLINE, ROLE, WARN } from '../art/palette';
import {
  CLAW_ANCHOR,
  CLAW_SPREAD,
  GLYPH_PLACE,
  MONSTER_FACE,
  STUN_STARS,
  fillCirclePen,
  glyphSlot,
  penArc,
  stunOrbitDist,
  strokeCirclePen,
  type Disc,
  type PathPen,
} from '../art/shapes';

const T = TILE_PX;

// ── 렌더링 최적화 2: 프레임마다 만들던 그림 키 문자열 · 자세 객체를 미리 만들어 둔다 (값은 같다) ──

/** 역할별 그림 키 (atlas.ts frameDefs의 이름과 같다) */
interface RoleFrames {
  body: string;
  gray: string;
  flash: string;
  foot: string;
  ring: string;
  glyph: string;
}

function roleFrames(role: RoleId): RoleFrames {
  return {
    body: `survivor-${role}`,
    gray: `survivor-${role}-gray`,
    flash: `survivor-${role}-flash`,
    foot: `foot-${role}`,
    ring: `ring-reveal-${role}`,
    glyph: `glyph-${role}`,
  };
}

const ROLE_FRAMES: Readonly<Record<RoleId, RoleFrames>> = {
  runner: roleFrames('runner'),
  guard: roleFrames('guard'),
  scout: roleFrames('scout'),
};

/** 괴물 눈 그림 키 */
const EYE_FRAMES: Readonly<Record<MonsterPose['eyes'], string>> = {
  open: 'eyes-open',
  blink: 'eyes-blink',
  stun: 'eyes-stun',
};

/** 숨은 생존자 번쩍 그림 키 (hiddenSurvivorPose.sprite + '-flash') */
const HIDDEN_FLASH = 'survivor-hidden-flash';

/** 그리는 동안만 쓰는 그릇 (그리기 함수는 동기라 하나를 다시 쓴다) */
const hiddenScratch = newHiddenSurvivorPose();
const walkScratch = newWalkPose();
const hitScratch: HitReact = { flash: 0, squash: 0 };
const glyphAt = { x: 0, y: 0 };
/** 기절 별 꼭짓점 10개 (strokePoints · fillPoints가 바로 명령으로 옮겨 적는다) */
const starPts: Phaser.Math.Vector2[] = Array.from({ length: 10 }, () => new Phaser.Math.Vector2());

/** 그림자 · 몸 · 부착 표시를 담는 레이어 (월드 컨테이너 안, 이 순서로) */
export interface CharacterLayers {
  shadows: Phaser.GameObjects.Container;
  ground: Phaser.GameObjects.Container;
  /** 몸 아래 표시 (노출 문양 · 기절 별): 바닥 링 위, 모든 몸 아래 */
  marks: Phaser.GameObjects.Container;
  bodies: Phaser.GameObjects.Container;
  attach: Phaser.GameObjects.Container;
}

/** 다른 캐릭터 몸 원 (문양 · 별 자리 고르기, 타일) */
export type BodyDisk = Disc;

/** 이미지 하나 (보이게 · 자리 · 회전 · 크기 · 알파를 한 번에) */
function put(
  img: Phaser.GameObjects.Image,
  frame: string,
  x: number,
  y: number,
  rot: number,
  sx: number,
  sy: number,
  alpha: number,
): void {
  if (img.frame.name !== frame) img.setFrame(frame);
  img
    .setPosition(x, y)
    .setRotation(rot)
    .setScale(sx, sy)
    .setAlpha(alpha)
    .setVisible(alpha > 0.001);
}

/** 그림 스케일: 1텍셀 = 월드 1 / texPerWorld px */
export class Rig {
  readonly parts: Phaser.GameObjects.Image[] = [];
  used = false;

  constructor(
    private readonly scene: Phaser.Scene,
    readonly key: string,
  ) {}

  make(
    layer: Phaser.GameObjects.Container,
    frame: string,
    blend?: Phaser.BlendModes,
  ): Phaser.GameObjects.Image {
    const img = this.scene.make.image({ key: this.key, frame }, false).setVisible(false);
    if (blend !== undefined) img.setBlendMode(blend);
    layer.add(img);
    this.parts.push(img);
    return img;
  }

  hide(): void {
    for (const p of this.parts) p.setVisible(false);
  }

  destroy(): void {
    for (const p of this.parts) p.destroy();
    this.parts.length = 0;
  }
}

/** 생존자 그림 묶음 */
export class SurvivorRig extends Rig {
  readonly shadow: Phaser.GameObjects.Image;
  readonly ring: Phaser.GameObjects.Image;
  readonly footA: Phaser.GameObjects.Image;
  readonly footB: Phaser.GameObjects.Image;
  readonly body: Phaser.GameObjects.Image;
  readonly spec: Phaser.GameObjects.Image;
  readonly flash: Phaser.GameObjects.Image;
  readonly bubble: Phaser.GameObjects.Image;
  readonly glyph: Phaser.GameObjects.Image;
  /** 실제로 쓴 몸 그림 키 (getDrawn sprite) */
  sprite = '';
  /** 노출 문양 자리 (몸 중심에서 본 방향, 노출 중이 아니면 null) */
  glyphDir: number | null = null;

  constructor(
    scene: Phaser.Scene,
    key: string,
    layers: CharacterLayers,
    readonly tpw: number,
  ) {
    super(scene, key);
    this.shadow = this.make(layers.shadows, 'shadow-survivor');
    this.ring = this.make(layers.ground, 'ring-self');
    this.footA = this.make(layers.bodies, 'foot-hidden');
    this.footB = this.make(layers.bodies, 'foot-hidden');
    this.body = this.make(layers.bodies, 'survivor-hidden');
    this.spec = this.make(layers.bodies, 'gloss');
    this.flash = this.make(layers.bodies, 'survivor-hidden-flash');
    this.bubble = this.make(layers.attach, 'bubble');
    this.glyph = this.make(layers.marks, 'glyph-runner');
  }
}

/** 생존자 몸 공통 배치 (그림자 · 발 · 몸 · 반사광). 몸 반지름 r (타일) */
function placeSurvivor(
  rig: SurvivorRig,
  bodyFrame: string,
  footFrame: string,
  x: number,
  y: number,
  rotation: number,
  scale: number,
  feet: WalkPose['feet'],
  alpha: number,
  r: number,
  squash: number,
): void {
  const px = x * T;
  const py = y * T;
  const s = scale / rig.tpw;
  const sx = s * (1 + squash * ANIM.squashAmt);
  const sy = s * (1 - squash * ANIM.squashAmt);
  put(rig.shadow, 'shadow-survivor', px, py, 0, s, s, alpha);
  const c = Math.cos(rotation);
  const sn = Math.sin(rotation);
  const rp = r * T * scale;
  const [fa, fb] = feet;
  put(
    rig.footA,
    footFrame,
    px + (fa.x * c - fa.y * sn) * rp,
    py + (fa.x * sn + fa.y * c) * rp,
    rotation,
    s,
    s,
    alpha,
  );
  put(
    rig.footB,
    footFrame,
    px + (fb.x * c - fb.y * sn) * rp,
    py + (fb.x * sn + fb.y * c) * rp,
    rotation,
    s,
    s,
    alpha,
  );
  put(rig.body, bodyFrame, px, py, rotation, sx, sy, alpha);
  // 윤기는 돌지 않는다 (빛은 화면 왼쪽 위에서)
  put(rig.spec, 'gloss', px, py, 0, s, s, alpha);
  rig.sprite = bodyFrame;
}

/**
 * 괴물 화면의 생존자 (흰색 위장). 역할 · 체력 · 능력 인자가 없다: 그림 키 'survivor-hidden', 발 'foot-hidden',
 * 공통 그림자, 같은 숨쉬기 · 걷기 곡선. reveal은 서버가 능력 노출 창(1초) 동안 보낸 역할 → 역할색 테두리 + 머리 위 문양.
 * others = 이 화면에 그린 다른 캐릭터 몸 원 (노출 문양이 그 몸과 겹치지 않는 자리를 고른다)
 */
export function drawHiddenSurvivor(
  rig: SurvivorRig,
  x: number,
  y: number,
  face: number,
  walkPhase: number,
  stepping: number,
  protectedFlag: boolean,
  reveal: RoleId | null,
  clockMs: number,
  bodyR: number,
  others: readonly BodyDisk[] = [],
): void {
  const p = hiddenSurvivorPose(
    x,
    y,
    face,
    walkPhase,
    stepping,
    protectedFlag,
    reveal,
    clockMs,
    PROTECTED_ALPHA,
    hiddenScratch,
  );
  placeSurvivor(rig, p.sprite, p.foot, p.x, p.y, p.rotation, p.scale, p.feet, p.alpha, bodyR, 0);
  put(rig.flash, HIDDEN_FLASH, x * T, y * T, p.rotation, p.scale / rig.tpw, p.scale / rig.tpw, 0);
  attachments(rig, x, y, p.scale, p.alpha, protectedFlag, p.blinkOutline, p.reveal, bodyR, others);
}

/** 보호 중 반투명 (지금 규칙) */
export const PROTECTED_ALPHA = 0.5;

/** 생존자 화면의 생존자 (역할 실루엣) */
export interface TeamSurvivorPose {
  role: RoleId;
  x: number;
  y: number;
  face: number;
  walkPhase: number;
  stepping: number;
  protectedFlag: boolean;
  /** 나 (발밑 흰 링) */
  self: boolean;
  /** 피격 뒤 지난 시간 (ms, 없으면 null) */
  hitMs: number | null;
  /** 숨쉬기 위상 */
  seed: number;
  clockMs: number;
  /** 페이드 (탈출 · 수감 뒤 나타남 · 사망) 0~1 */
  fade: number;
  /** 사망 회색 */
  gray: boolean;
}

/** 빈 몸 원 목록 (생존자 화면의 팀원은 노출 문양이 없다) */
const NO_DISCS: readonly BodyDisk[] = [];

export function drawTeamSurvivor(rig: SurvivorRig, p: TeamSurvivorPose, bodyR: number): void {
  const w = walkPose(p.walkPhase, p.stepping, walkScratch);
  const scale = breathScale(p.clockMs / 1000, p.seed);
  let hit = hitScratch;
  if (p.hitMs === null) {
    hit.flash = 0;
    hit.squash = 0;
  } else hit = hitReact(p.hitMs, hitScratch);
  const alpha = (p.protectedFlag ? PROTECTED_ALPHA : 1) * p.fade;
  const rot = p.face + w.lean;
  const frames = ROLE_FRAMES[p.role];
  const body = p.gray ? frames.gray : frames.body;
  placeSurvivor(rig, body, frames.foot, p.x, p.y, rot, scale, w.feet, alpha, bodyR, hit.squash);
  const s = scale / rig.tpw;
  put(rig.flash, frames.flash, p.x * T, p.y * T, rot, s, s, hit.flash * 0.9 * p.fade);
  attachments(
    rig,
    p.x,
    p.y,
    scale,
    alpha,
    p.protectedFlag,
    p.protectedFlag && protectBlink(p.clockMs),
    null,
    bodyR,
    NO_DISCS,
  );
  put(rig.ring, 'ring-self', p.x * T, p.y * T, 0, s, s, p.self ? 0.85 * p.fade : 0);
}

/** 거품 (보호) · 노출 테두리 + 문양 · 보호 깜빡임 테두리 */
function attachments(
  rig: SurvivorRig,
  x: number,
  y: number,
  scale: number,
  alpha: number,
  protectedFlag: boolean,
  blinkOutline: boolean,
  reveal: RoleId | null,
  bodyR: number,
  others: readonly BodyDisk[],
): void {
  const px = x * T;
  const py = y * T;
  const s = scale / rig.tpw;
  put(rig.bubble, 'bubble', px, py, 0, s, s, protectedFlag ? (blinkOutline ? 1 : 0.7) : 0);
  if (reveal) {
    const frames = ROLE_FRAMES[reveal];
    put(rig.ring, frames.ring, px, py, 0, s, s, 1);
    // 문양: 옆 몸과 겹치지 않는 자리 (기본 머리 위). 몸 아래 레이어라 겹쳐도 남의 몸을 덮지 않는다
    glyphAt.x = x;
    glyphAt.y = y;
    const dir = glyphSlot(glyphAt, bodyR, others, rig.glyphDir);
    rig.glyphDir = dir;
    const d = GLYPH_PLACE.dist * bodyR * T;
    put(
      rig.glyph,
      frames.glyph,
      px + Math.cos(dir) * d,
      py + Math.sin(dir) * d,
      0,
      1 / rig.tpw,
      1 / rig.tpw,
      1,
    );
  } else {
    put(rig.ring, 'ring-self', px, py, 0, s, s, 0);
    rig.glyph.setVisible(false);
    rig.glyphDir = null;
  }
  void alpha;
}

/** 괴물 그림 묶음 */
export class MonsterRig extends Rig {
  readonly shadow: Phaser.GameObjects.Image;
  readonly clawA: Phaser.GameObjects.Image;
  readonly clawB: Phaser.GameObjects.Image;
  readonly body: Phaser.GameObjects.Image;
  readonly eyes: Phaser.GameObjects.Image;
  readonly glow: Phaser.GameObjects.Image;
  sprite = '';

  constructor(
    scene: Phaser.Scene,
    key: string,
    layers: CharacterLayers,
    readonly tpw: number,
  ) {
    super(scene, key);
    this.shadow = this.make(layers.shadows, 'shadow-monster');
    this.body = this.make(layers.bodies, 'monster-idle-0');
    this.clawA = this.make(layers.bodies, 'claw');
    this.clawB = this.make(layers.bodies, 'claw');
    this.eyes = this.make(layers.bodies, 'eyes-open');
    this.glow = this.make(layers.bodies, 'eye-glow', Phaser.BlendModes.ADD);
  }
}

export interface MonsterPose {
  x: number;
  y: number;
  aim: number;
  /** 망토 프레임 이름 */
  frame: string;
  /** 공격 준비 발톱 들기 0~1 */
  raise: number;
  /** 돌진 늘어남 0~1 */
  stretch: number;
  eyes: 'open' | 'blink' | 'stun';
  /** 눈빛 (장식, 품질 높음 · 중간) */
  glow: boolean;
  scale: number;
  alpha: number;
}

export function drawMonsterRig(rig: MonsterRig, p: MonsterPose, bodyR: number): void {
  const px = p.x * T;
  const py = p.y * T;
  const s = p.scale / rig.tpw;
  const sx = s * (1 + 0.16 * p.stretch);
  const sy = s * (1 - 0.1 * p.stretch);
  const c = Math.cos(p.aim);
  const sn = Math.sin(p.aim);
  const rp = bodyR * T * p.scale;
  put(rig.shadow, 'shadow-monster', px, py, 0, s, s, p.alpha);
  put(rig.body, p.frame, px, py, p.aim, sx, sy, p.alpha);
  // 발톱: 망토 앞 가장자리 위. 공격 준비에는 앞으로 내밀고 더 벌린다 (side 1 = clawA, −1 = clawB)
  const lx = CLAW_ANCHOR.x + 0.14 * p.raise;
  for (let side = 1; side >= -1; side -= 2) {
    const img = side === 1 ? rig.clawA : rig.clawB;
    const ly = (CLAW_ANCHOR.y + 0.06 * p.raise) * side;
    const cx = px + (lx * c - ly * sn) * rp;
    const cy = py + (lx * sn + ly * c) * rp;
    put(img, 'claw', cx, cy, p.aim + side * (CLAW_SPREAD + 0.3 * p.raise), s, s * side, p.alpha);
  }
  const ex = px + (MONSTER_FACE.cx * c - 0 * sn) * rp;
  const ey = py + (MONSTER_FACE.cx * sn + 0 * c) * rp;
  put(rig.eyes, EYE_FRAMES[p.eyes], ex, ey, p.aim, s, s, p.alpha);
  put(rig.glow, 'eye-glow', ex, ey, 0, s, s, p.glow && p.eyes !== 'blink' ? 0.9 * p.alpha : 0);
  rig.sprite = p.frame;
}

// ───────────────────────── Graphics: 범위 · 링 · 마커 ─────────────────────────

/** 구조 진행 링 (0~1): 어두운 받침 + 청록 진행 + 바깥 눈금 */
export function drawRescueRing(g: PathPen, x: number, y: number, progress: number): void {
  const cx = x * T;
  const cy = y * T;
  const r = 0.62 * T;
  g.lineStyle(6, OUTLINE, 0.6);
  strokeCirclePen(g, cx, cy, r);
  g.lineStyle(3, 0xe2e8f0, 0.3);
  strokeCirclePen(g, cx, cy, r);
  g.lineStyle(3.5, 0x22d3ee, 1);
  g.beginPath();
  penArc(g, cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, progress));
  g.strokePath();
}

/** 굵은 외곽선 + 색 선 (마커용) */
function outlinedPath(
  g: Phaser.GameObjects.Graphics,
  pts: readonly [number, number][],
  color: number,
  width: number,
  fill: number | null,
): void {
  if (fill !== null) {
    g.fillStyle(color, fill);
    g.beginPath();
    pts.forEach(([x, y], i) => (i === 0 ? g.moveTo(x, y) : g.lineTo(x, y)));
    g.closePath();
    g.fillPath();
  }
  for (const [w, c, a] of [
    [width + 3, OUTLINE, 0.85],
    [width, color, 1],
  ] as const) {
    g.lineStyle(w, c, a);
    g.beginPath();
    pts.forEach(([x, y], i) => (i === 0 ? g.moveTo(x, y) : g.lineTo(x, y)));
    g.closePath();
    g.strokePath();
  }
}

/** 스카우트 탐지: 괴물 위치에 초록 다이아 + 조준선 + 펄스 고리 (안개 위) */
export function drawTrackMark(g: Phaser.GameObjects.Graphics, x: number, y: number, tS: number): void {
  const px = x * T;
  const py = y * T;
  const pulse = (tS % 0.8) / 0.8;
  g.lineStyle(2, ROLE.scout, 0.7 * (1 - pulse));
  strokeCirclePen(g, px, py, 16 + pulse * 18);
  const s = 14;
  outlinedPath(
    g,
    [
      [px, py - s],
      [px + s, py],
      [px, py + s],
      [px - s, py],
    ],
    ROLE.scout,
    3,
    0.22,
  );
  for (const [dx, dy] of [
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0],
  ] as const) {
    g.lineStyle(4.5, OUTLINE, 0.8);
    g.beginPath();
    g.moveTo(px + dx * (s + 3), py + dy * (s + 3));
    g.lineTo(px + dx * (s + 9), py + dy * (s + 9));
    g.strokePath();
    g.lineStyle(2, ROLE.scout, 1);
    g.beginPath();
    g.moveTo(px + dx * (s + 3), py + dy * (s + 3));
    g.lineTo(px + dx * (s + 9), py + dy * (s + 9));
    g.strokePath();
  }
  g.fillStyle(ROLE.scout, 1);
  fillCirclePen(g, px, py, 2.5);
}

/** 포효한 괴물 위치 (주황 경고 삼각 + 느낌표 + 펄스, 생존자 화면 1초) */
export function drawRoarMark(g: Phaser.GameObjects.Graphics, x: number, y: number, tS: number): void {
  const px = x * T;
  const py = y * T;
  const pulse = (tS % 0.4) / 0.4;
  g.lineStyle(5, OUTLINE, 0.6 * (1 - pulse));
  strokeCirclePen(g, px, py, 16 + pulse * 10);
  g.lineStyle(3, WARN, 0.9 * (1 - pulse));
  strokeCirclePen(g, px, py, 16 + pulse * 10);
  outlinedPath(
    g,
    [
      [px, py - 12],
      [px + 11, py + 8],
      [px - 11, py + 8],
    ],
    WARN,
    2,
    1,
  );
  g.fillStyle(0x0b1622, 1);
  g.fillRect(px - 1.5, py - 5, 3, 7);
  g.fillRect(px - 1.5, py + 3.5, 3, 2.5);
}

/** 포효 핑: 흰 원 펄스 + 가운데 점 (괴물 화면 1.5초). k = 지난 비율 */
export function drawRoarPing(g: Phaser.GameObjects.Graphics, x: number, y: number, k: number): void {
  const px = x * T;
  const py = y * T;
  const phase = (k * 3) % 1;
  g.lineStyle(5, OUTLINE, 0.55 * (1 - phase));
  strokeCirclePen(g, px, py, 6 + phase * 22);
  g.lineStyle(2.5, 0xffffff, 0.95 * (1 - phase));
  strokeCirclePen(g, px, py, 6 + phase * 22);
  g.fillStyle(OUTLINE, 0.85);
  fillCirclePen(g, px, py, 6);
  g.fillStyle(0xffffff, 1);
  fillCirclePen(g, px, py, 4);
}

/**
 * 기절 별: 머리 위를 도는 노란 별 셋 (양쪽 화면, 기절 동안). 몸 아래 레이어(layers.marks)에 그려 옆 캐릭터 몸을 덮지 않고(정보 우선 R7 ·
 * R15), 궤도는 옆 몸 · 그 바깥 링과 겹치지 않는 쪽(dir, shapes.ts starSlot — 기본 머리 위)에 괴물 망토 밖으로 띄운다.
 * bodyR = 괴물 판정 반지름 (타일)
 */
export function drawStunStars(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  tS: number,
  bodyR: number,
  dir: number,
): void {
  const S = STUN_STARS;
  const d = stunOrbitDist(bodyR, T, dir) * T;
  const cx = x * T + Math.cos(dir) * d;
  const cy = y * T + Math.sin(dir) * d;
  const spin = tS * S.spin;
  for (let k = 0; k < 3; k += 1) {
    const a = spin + (k * Math.PI * 2) / 3;
    drawStar(g, cx + Math.cos(a) * S.orbitX, cy + Math.sin(a) * S.orbitY, S.outer, S.inner, CONE.idle);
  }
}

function drawStar(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  outer: number,
  inner: number,
  color: number,
): void {
  const pts = starPts;
  for (let i = 0; i < 10; i += 1) {
    const r = i % 2 === 0 ? outer : inner;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    pts[i]?.set(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  g.lineStyle(STUN_STARS.edge * 2, OUTLINE, 0.85);
  g.strokePoints(pts, true);
  g.fillStyle(color, 1);
  g.fillPoints(pts, true);
}

/** 부상 표시 (생존자 화면만): 몸 뒤쪽 가장자리의 붉은 긁힘 세 줄 */
export function drawInjury(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  face: number,
  r: number,
): void {
  const c = Math.cos(face);
  const s = Math.sin(face);
  const at = (lx: number, ly: number): [number, number] => [
    x * T + (lx * c - ly * s) * r * T,
    y * T + (lx * s + ly * c) * r * T,
  ];
  for (let i = -1; i <= 1; i += 1) {
    const [ax, ay] = at(-0.95, i * 0.26 - 0.12);
    const [bx, by] = at(-0.62, i * 0.26 + 0.12);
    g.lineStyle(3, OUTLINE, 0.8);
    g.beginPath();
    g.moveTo(ax, ay);
    g.lineTo(bx, by);
    g.strokePath();
    g.lineStyle(1.6, DANGER, 1);
    g.beginPath();
    g.moveTo(ax, ay);
    g.lineTo(bx, by);
    g.strokePath();
  }
}

/** 질주 속도선 (생존자 화면만): 몸 뒤로 흐르는 선 셋 */
export function drawSpeedLines(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  face: number,
  r: number,
  tS: number,
): void {
  const c = Math.cos(face);
  const s = Math.sin(face);
  for (let i = -1; i <= 1; i += 1) {
    const flow = (((tS * 4 + i * 0.37) % 1) + 1) % 1;
    const lx0 = -1.25 - flow * 0.6;
    const len = 0.9 - Math.abs(i) * 0.25;
    const ly = i * 0.55;
    const ax = x * T + (lx0 * c - ly * s) * r * T;
    const ay = y * T + (lx0 * s + ly * c) * r * T;
    const bx = x * T + ((lx0 - len) * c - ly * s) * r * T;
    const by = y * T + ((lx0 - len) * s + ly * c) * r * T;
    g.lineStyle(2, 0xffffff, 0.45 * (1 - flow));
    g.beginPath();
    g.moveTo(ax, ay);
    g.lineTo(bx, by);
    g.strokePath();
  }
}

/** 돌진 붉은 줄 (잔상 사이). ghosts = DashTrail.live 그대로 (자리 g · 알파) */
export function drawDashStreak(
  g: Phaser.GameObjects.Graphics,
  ghosts: readonly { g: { x: number; y: number }; alpha: number }[],
): void {
  for (let i = 1; i < ghosts.length; i += 1) {
    const p = ghosts[i - 1];
    const q = ghosts[i];
    if (!p || !q) continue;
    g.lineStyle(5, DANGER, 0.35 * q.alpha);
    g.beginPath();
    g.moveTo(p.g.x * T, p.g.y * T);
    g.lineTo(q.g.x * T, q.g.y * T);
    g.strokePath();
  }
}

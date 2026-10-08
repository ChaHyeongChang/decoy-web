// 캐릭터 그리기 (M10b, VISUAL_SPEC 4장). 좌표는 월드 px(1타일 = 32px), 위치 인자는 타일.
//
// 몸 · 발 · 그림자 · 망토 · 발톱 · 눈은 구운 그림(art/atlas.ts)을 이미지로 찍는다. 범위 · 링 · 마커는 Graphics.
// 레이어(정보 우선 R1): 그림자 → 바닥 링 → 발 · 몸 → 부착 표시(거품 · 노출 문양 · 별 · 진행 링) → 안개 위 마커.
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
  protectBlink,
  walkPose,
  type WalkPose,
} from '../art/anim';
import { CONE, DANGER, OUTLINE, ROLE, WARN } from '../art/palette';
import { CLAW_ANCHOR, MONSTER_FACE } from '../art/shapes';

const T = TILE_PX;

/** 그림자 · 몸 · 부착 표시를 담는 레이어 (월드 컨테이너 안, 이 순서로) */
export interface CharacterLayers {
  shadows: Phaser.GameObjects.Container;
  ground: Phaser.GameObjects.Container;
  bodies: Phaser.GameObjects.Container;
  attach: Phaser.GameObjects.Container;
}

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
    this.glyph = this.make(layers.attach, 'glyph-runner');
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
 * 공통 그림자, 같은 숨쉬기 · 걷기 곡선. reveal은 서버가 능력 노출 창(1초) 동안 보낸 역할 → 역할색 테두리 + 머리 위 문양
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
  );
  placeSurvivor(rig, p.sprite, p.foot, p.x, p.y, p.rotation, p.scale, p.feet, p.alpha, bodyR, 0);
  put(rig.flash, `${p.sprite}-flash`, x * T, y * T, p.rotation, p.scale / rig.tpw, p.scale / rig.tpw, 0);
  attachments(rig, x, y, p.scale, p.alpha, protectedFlag, p.blinkOutline, p.reveal, bodyR);
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

export function drawTeamSurvivor(rig: SurvivorRig, p: TeamSurvivorPose, bodyR: number): void {
  const w = walkPose(p.walkPhase, p.stepping);
  const scale = breathScale(p.clockMs / 1000, p.seed);
  const hit = p.hitMs === null ? { flash: 0, squash: 0 } : hitReact(p.hitMs);
  const alpha = (p.protectedFlag ? PROTECTED_ALPHA : 1) * p.fade;
  const rot = p.face + w.lean;
  const body = p.gray ? `survivor-${p.role}-gray` : `survivor-${p.role}`;
  placeSurvivor(rig, body, `foot-${p.role}`, p.x, p.y, rot, scale, w.feet, alpha, bodyR, hit.squash);
  const s = scale / rig.tpw;
  put(rig.flash, `survivor-${p.role}-flash`, p.x * T, p.y * T, rot, s, s, hit.flash * 0.9 * p.fade);
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
): void {
  const px = x * T;
  const py = y * T;
  const s = scale / rig.tpw;
  put(rig.bubble, 'bubble', px, py, 0, s, s, protectedFlag ? (blinkOutline ? 1 : 0.7) : 0);
  if (reveal) {
    put(rig.ring, `ring-reveal-${reveal}`, px, py, 0, s, s, 1);
    put(rig.glyph, `glyph-${reveal}`, px, py - bodyR * T * 2.35, 0, 1 / rig.tpw, 1 / rig.tpw, 1);
  } else {
    put(rig.ring, 'ring-self', px, py, 0, s, s, 0);
    rig.glyph.setVisible(false);
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
    this.clawA = this.make(layers.bodies, 'claw');
    this.clawB = this.make(layers.bodies, 'claw');
    this.body = this.make(layers.bodies, 'monster-idle-0');
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
  const at = (lx: number, ly: number): [number, number] => [
    px + (lx * c - ly * sn) * rp,
    py + (lx * sn + ly * c) * rp,
  ];
  put(rig.shadow, 'shadow-monster', px, py, 0, s, s, p.alpha);
  // 발톱: 망토 밑에서 앞으로. 공격 준비에는 앞으로 내밀고 바깥으로 벌린다
  for (const side of [1, -1] as const) {
    const img = side === 1 ? rig.clawA : rig.clawB;
    const [cx, cy] = at(CLAW_ANCHOR.x + 0.16 * p.raise, (CLAW_ANCHOR.y + 0.08 * p.raise) * side);
    put(img, 'claw', cx, cy, p.aim + side * 0.38 * p.raise, s, s * side, p.alpha);
  }
  put(rig.body, p.frame, px, py, p.aim, sx, sy, p.alpha);
  const [ex, ey] = at(MONSTER_FACE.cx, 0);
  put(rig.eyes, `eyes-${p.eyes}`, ex, ey, p.aim, s, s, p.alpha);
  put(rig.glow, 'eye-glow', ex, ey, 0, s, s, p.glow && p.eyes !== 'blink' ? 0.9 * p.alpha : 0);
  rig.sprite = p.frame;
}

// ───────────────────────── Graphics: 범위 · 링 · 마커 ─────────────────────────

/** 공격 준비 범위 색 (흰색: 지금 규칙) */
export const ATTACK_RANGE = { color: 0xffffff, fill: 0.2, sweep: 0.16, edge: 0.85, width: 2 } as const;

/**
 * 공격 준비 범위: 전방 arc° · range 타일 부채꼴. 바깥 경계(판정값)는 처음부터 다 보이고, 채움은 준비 시간에 맞춰
 * 꼭짓점에서 바깥으로 0 → 100% 쓸려 차오른다 (fill = 0~1, 정확히 attack.windup에 1)
 */
export function drawAttackRange(
  g: Phaser.GameObjects.Graphics,
  line: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  dir: number,
  range: number,
  arcDeg: number,
  fill: number,
): void {
  const half = (arcDeg * Math.PI) / 360;
  const cx = x * T;
  const cy = y * T;
  const R = range * T;
  const k = Math.max(0, Math.min(1, fill));
  // 밑판 (옅게) + 차오르는 채움
  g.fillStyle(ATTACK_RANGE.color, 0.08);
  g.slice(cx, cy, R, dir - half, dir + half, false);
  g.fillPath();
  if (k > 0) {
    g.fillStyle(ATTACK_RANGE.color, ATTACK_RANGE.fill);
    g.slice(cx, cy, R * k, dir - half, dir + half, false);
    g.fillPath();
    // 차오르는 앞머리 (밝은 호)
    g.lineStyle(2.5, ATTACK_RANGE.color, 0.5 + 0.4 * k);
    g.beginPath();
    g.arc(cx, cy, R * k, dir - half, dir + half, false);
    g.strokePath();
  }
  // 판정 경계 (어두운 받침 + 흰 선): 캐릭터 그림자보다 위 레이어(line)에 그려 몸 둘레에서도 끊기지 않는다
  for (const [w, color, a] of [
    [ATTACK_RANGE.width + 2.5, OUTLINE, 0.55],
    [ATTACK_RANGE.width, ATTACK_RANGE.color, ATTACK_RANGE.edge],
  ] as const) {
    line.lineStyle(w, color, a);
    line.beginPath();
    line.moveTo(cx, cy);
    line.arc(cx, cy, R, dir - half, dir + half, false);
    line.closePath();
    line.strokePath();
  }
}

/** 구조 진행 링 (0~1): 어두운 받침 + 청록 진행 + 바깥 눈금 */
export function drawRescueRing(g: Phaser.GameObjects.Graphics, x: number, y: number, progress: number): void {
  const cx = x * T;
  const cy = y * T;
  const r = 0.62 * T;
  g.lineStyle(6, OUTLINE, 0.6);
  g.strokeCircle(cx, cy, r);
  g.lineStyle(3, 0xe2e8f0, 0.3);
  g.strokeCircle(cx, cy, r);
  g.lineStyle(3.5, 0x22d3ee, 1);
  g.beginPath();
  g.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, progress), false);
  g.strokePath();
}

/** 원 둘레 점선 (범위 표시) */
export function dashedCircle(
  g: Phaser.GameObjects.Graphics,
  cx: number,
  cy: number,
  r: number,
  width: number,
  color: number,
  alpha: number,
  dashes: number,
  offset = 0,
): void {
  g.lineStyle(width, color, alpha);
  const step = (Math.PI * 2) / dashes;
  for (let i = 0; i < dashes; i += 1) {
    const a0 = offset + i * step;
    g.beginPath();
    g.arc(cx, cy, r, a0, a0 + step * 0.55, false);
    g.strokePath();
  }
}

/** 구조 구역 (감옥 문 앞 rescueRadius): 수감자가 있을 때 생존자 화면에 */
export function drawRescueZone(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  r: number,
  spin: number,
): void {
  dashedCircle(g, x * T, y * T, r * T, 4, OUTLINE, 0.45, 18, spin);
  dashedCircle(g, x * T, y * T, r * T, 2, 0x22d3ee, 0.75, 18, spin);
}

/** 가드 밀치기 사거리 (능력 준비 · 괴물이 보일 때, 가드 화면) */
export function drawShoveRange(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  r: number,
  inRange: boolean,
): void {
  dashedCircle(g, x * T, y * T, r * T, 4, OUTLINE, 0.4, 24);
  dashedCircle(g, x * T, y * T, r * T, 2, ROLE.guard, inRange ? 0.95 : 0.55, 24);
}

/** 감옥 캠핑 경고 구역 (괴물 화면, mon.camp > 0): 철창 사각형에서 campRadius 이내 = 둥근 사각형, 주황 */
export function drawCampZone(
  g: Phaser.GameObjects.Graphics,
  rect: { x0: number; y0: number; x1: number; y1: number },
  r: number,
  level: number,
): void {
  const x0 = (rect.x0 - r) * T;
  const y0 = (rect.y0 - r) * T;
  const w = (rect.x1 - rect.x0 + 2 * r) * T;
  const h = (rect.y1 - rect.y0 + 2 * r) * T;
  g.fillStyle(WARN, level >= 2 ? 0.1 : 0.06);
  g.fillRoundedRect(x0, y0, w, h, r * T);
  g.lineStyle(4.5, OUTLINE, 0.5);
  g.strokeRoundedRect(x0, y0, w, h, r * T);
  g.lineStyle(2.5, WARN, 0.9);
  g.strokeRoundedRect(x0, y0, w, h, r * T);
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
  g.strokeCircle(px, py, 16 + pulse * 18);
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
  g.fillCircle(px, py, 2.5);
}

/** 포효한 괴물 위치 (주황 경고 삼각 + 느낌표 + 펄스, 생존자 화면 1초) */
export function drawRoarMark(g: Phaser.GameObjects.Graphics, x: number, y: number, tS: number): void {
  const px = x * T;
  const py = y * T;
  const pulse = (tS % 0.4) / 0.4;
  g.lineStyle(5, OUTLINE, 0.6 * (1 - pulse));
  g.strokeCircle(px, py, 16 + pulse * 10);
  g.lineStyle(3, WARN, 0.9 * (1 - pulse));
  g.strokeCircle(px, py, 16 + pulse * 10);
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
  g.strokeCircle(px, py, 6 + phase * 22);
  g.lineStyle(2.5, 0xffffff, 0.95 * (1 - phase));
  g.strokeCircle(px, py, 6 + phase * 22);
  g.fillStyle(OUTLINE, 0.85);
  g.fillCircle(px, py, 6);
  g.fillStyle(0xffffff, 1);
  g.fillCircle(px, py, 4);
}

/** 포효 충격파 (괴물 화면, roar.radius까지 1회, 알파 0.25 이하). k = 0~1 */
export function drawRoarWave(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  radius: number,
  k: number,
): void {
  const e = 1 - (1 - k) ** 2;
  const r = radius * T * e;
  const a = 0.22 * (1 - k);
  g.lineStyle(10, WARN, a * 0.5);
  g.strokeCircle(x * T, y * T, Math.max(1, r - 6));
  g.lineStyle(3, WARN, a);
  g.strokeCircle(x * T, y * T, Math.max(1, r));
}

/** 기절 별: 머리 위를 도는 노란 별 셋 (양쪽 화면, 기절 동안) */
export function drawStunStars(g: Phaser.GameObjects.Graphics, x: number, y: number, tS: number): void {
  const cx = x * T;
  const cy = y * T - 0.62 * T;
  const spin = tS * 3.85;
  for (let k = 0; k < 3; k += 1) {
    const a = spin + (k * Math.PI * 2) / 3;
    drawStar(g, cx + Math.cos(a) * 13, cy + Math.sin(a) * 5, 6, 2.6, CONE.idle);
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
  const pts: Phaser.Math.Vector2[] = [];
  for (let i = 0; i < 10; i += 1) {
    const r = i % 2 === 0 ? outer : inner;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push(new Phaser.Math.Vector2(x + Math.cos(a) * r, y + Math.sin(a) * r));
  }
  g.lineStyle(2.5, OUTLINE, 0.85);
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

/** 돌진 붉은 줄 (잔상 사이) */
export function drawDashStreak(
  g: Phaser.GameObjects.Graphics,
  pts: readonly { x: number; y: number; a: number }[],
): void {
  for (let i = 1; i < pts.length; i += 1) {
    const p = pts[i - 1];
    const q = pts[i];
    if (!p || !q) continue;
    g.lineStyle(5, DANGER, 0.35 * q.a);
    g.beginPath();
    g.moveTo(p.x * T, p.y * T);
    g.lineTo(q.x * T, q.y * T);
    g.strokePath();
  }
}

// 거점 · 탈출구 · 감옥 배지 (M10b): 바닥 문양 + 라벨. 캐릭터보다 아래 레이어에 그린다(정보 우선 R15: 배지가 캐릭터를 덮지 않음).
// 맵 구조가 늘 어둡게 보이므로 배지를 안개 위에서 내렸다. 항상 표시 규칙(지금 안 보이는 곳 45%, 괴물 화면 점령 중 깜빡임)은 그대로다.
//  - 거점: 패드 위쪽 가장자리의 마름모 + A/B 글자 + 상태 칩(점령 중 ▶ · 정지 ‖ 주황 · 완료 ✓). 가운데(단말 · 서 있는 사람)를 비운다
//  - 탈출구: 문 오른쪽 문틀의 표지판 + 달리는 사람 (비활성 회색 · 활성 초록). 문짝 · 미닫이 연출을 가리지 않는다
//  - 감옥: 남쪽 문 칸의 자물쇠 (수감자가 서는 안쪽을 덮지 않는다)
// 알파는 어두운 바닥 위 합성과 같은 색으로 미리 섞어 불투명하게 그린다(dimmed): 선이 겹친 곳이 진해지지 않는다.
// 배지 다섯 장을 한 아틀라스 캔버스(기기 픽셀 1:1)의 칸마다 구워 이미지로 보이고, 상태 · 알파 · 백버퍼 배율이 바뀐 배지만
// 다시 굽는다(프레임마다 다시 테셀레이션하는 Graphics를 쓰지 않는다: gfx.features.badgeGfxCmds = 0). 텍스처가 하나라 휴대폰
// MobilePipeline에서도 배지 그리기가 한 번이다 (렌더링 최적화 2).
// 정보 레이어(info)는 art/mapArtBadges.ts badgeInfo로 만들고, 품질과 상관없이 같다.
import type Phaser from 'phaser';
import {
  CAPTURE_POINTS,
  TILE_PX,
  type ExitState,
  type ExitView,
  type InfoItem,
  type PointState,
  type PointView,
} from '@decoy/shared';
import {
  BADGE,
  PRISON_COLOR,
  PRISON_LOCK,
  badgeInfo,
  dimmed,
  exitColor,
  exitSignAt,
  pointBadgeAlpha,
  pointColor,
  pointIcon,
  type BadgeAlpha,
  type PointIcon,
} from '../art/mapArtBadges';
import { UI } from '../art/palette';
import { gfxState } from '../gfx/state';
import { MAP_SCALE, MAP_X, MAP_Y, tileToScreen } from '../ui/layout';
import { makeText, type CrispText } from '../ui/text';
import {
  countGraphicsCmds,
  createCanvasTexture,
  makeCanvas,
  nextFogKey,
  paintedRadii,
  removeCanvasTexture,
  resizeCanvasTexture,
  rgba,
  uploadCanvasSubTexture,
  uploadCanvasTexture,
} from './fogPaint';

export type { BadgeAlpha } from '../art/mapArtBadges';

const T = TILE_PX;
const PLATE = UI.background;

type Pt = readonly [number, number];

/** 배지를 굽는 2D 컨텍스트 중 쓰는 부분 (단위 테스트는 기록용 가짜) */
export type BadgeCtx = Pick<
  CanvasRenderingContext2D,
  | 'fillStyle'
  | 'strokeStyle'
  | 'lineWidth'
  | 'lineJoin'
  | 'lineCap'
  | 'beginPath'
  | 'moveTo'
  | 'lineTo'
  | 'arc'
  | 'arcTo'
  | 'closePath'
  | 'fill'
  | 'stroke'
  | 'fillRect'
  | 'strokeRect'
>;

/** 월드 px 사각형 (배지 기준점에서) */
interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** 굽는 범위 여유 (월드 px): 가장 굵은 선(2.6px)의 반 + 마름모 꼭짓점 마이터 + 안티에일리어싱 */
const BOX_PAD = 3;

/** 배지 종류별 굽는 범위 (기준점 기준, 월드 px) */
export const BADGE_BOX: Readonly<Record<'point' | 'exit' | 'lock', Box>> = {
  point: {
    x0: -BADGE.pointHalf * T - 5 - BOX_PAD,
    y0: -BADGE.pointHalf * T - BOX_PAD,
    x1: (BADGE.chipDx + BADGE.chipHalf) * T + BOX_PAD,
    y1: BADGE.pointHalf * T + BOX_PAD,
  },
  exit: {
    x0: (-BADGE.exitW * T) / 2 - BOX_PAD,
    y0: (-BADGE.exitH * T) / 2 - BOX_PAD,
    x1: (BADGE.exitW * T) / 2 + BOX_PAD,
    y1: (BADGE.exitH * T) / 2 + BOX_PAD,
  },
  lock: {
    x0: (-BADGE.lockW * T) / 2 - BOX_PAD,
    y0: (-BADGE.lockH * T) / 2 - BOX_PAD,
    x1: (BADGE.lockW * T) / 2 + BOX_PAD,
    y1: (BADGE.lockH * T) / 2 + BOX_PAD,
  },
};

function path(c: BadgeCtx, pts: readonly Pt[], close: boolean): void {
  c.beginPath();
  pts.forEach(([x, y], i) => (i === 0 ? c.moveTo(x, y) : c.lineTo(x, y)));
  if (close) c.closePath();
}

function strokePts(c: BadgeCtx, pts: readonly Pt[], close: boolean, width: number, color: number): void {
  path(c, pts, close);
  c.lineWidth = width;
  c.lineJoin = 'miter';
  c.lineCap = 'butt';
  c.strokeStyle = rgba(color, 1);
  c.stroke();
}

function roundRect(c: BadgeCtx, x: number, y: number, w: number, h: number, r: number): void {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

/** 마름모(글자 자리는 비움: 글자는 컨테이너 아래 화면 글자) + 상태 칩. 좌표는 월드 px */
export function paintPointBadge(
  c: BadgeCtx,
  x: number,
  y: number,
  color: number,
  icon: PointIcon | null,
  a: number,
): void {
  const h = BADGE.pointHalf * T;
  strokePts(
    c,
    [
      [x, y - h],
      [x + h, y],
      [x, y + h],
      [x - h, y],
    ],
    true,
    2.4,
    dimmed(color, a),
  );
  // 마름모 꼭짓점 눈금 (바닥 표지 느낌)
  strokePts(
    c,
    [
      [x - h - 5, y],
      [x - h - 1.5, y],
    ],
    false,
    1.6,
    dimmed(color, a * 0.7),
  );
  if (!icon) return;
  const cx = x + BADGE.chipDx * T;
  const s = BADGE.chipHalf * T;
  c.fillStyle = rgba(dimmed(PLATE, a), 1);
  c.fillRect(cx - s, y - s, 2 * s, 2 * s);
  c.lineWidth = 1.6;
  c.strokeStyle = rgba(dimmed(color, a), 1);
  c.strokeRect(cx - s, y - s, 2 * s, 2 * s);
  c.fillStyle = rgba(dimmed(color, a), 1);
  if (icon === 'play') {
    path(
      c,
      [
        [cx - s * 0.38, y - s * 0.5],
        [cx - s * 0.38, y + s * 0.5],
        [cx + s * 0.5, y],
      ],
      true,
    );
    c.fill();
  } else if (icon === 'pause') {
    c.fillRect(cx - s * 0.48, y - s * 0.5, s * 0.32, s);
    c.fillRect(cx + s * 0.16, y - s * 0.5, s * 0.32, s);
  } else {
    strokePts(
      c,
      [
        [cx - s * 0.52, y + s * 0.02],
        [cx - s * 0.14, y + s * 0.42],
        [cx + s * 0.55, y - s * 0.42],
      ],
      false,
      2.6,
      dimmed(color, a),
    );
  }
}

/** 문 가운데 표지판 + 달리는 사람 */
export function paintExitBadge(c: BadgeCtx, x: number, y: number, color: number, a: number): void {
  const w = BADGE.exitW * T;
  const h = BADGE.exitH * T;
  c.fillStyle = rgba(dimmed(PLATE, a), 1);
  c.fillRect(x - w / 2, y - h / 2, w, h);
  c.lineWidth = 1.8;
  c.strokeStyle = rgba(dimmed(color, a), 1);
  c.strokeRect(x - w / 2, y - h / 2, w, h);
  const s = h * 0.78;
  const col = dimmed(color, a);
  const P = (u: number, v: number): Pt => [x + u * s, y + v * s];
  c.fillStyle = rgba(col, 1);
  c.beginPath();
  c.arc(x + 0.14 * s, y - 0.36 * s, 0.09 * s, 0, Math.PI * 2);
  c.fill();
  for (const limb of [
    [P(0.08, -0.22), P(-0.06, 0.06)],
    [P(0.05, -0.17), P(0.22, -0.06), P(0.32, -0.15)],
    [P(0.05, -0.17), P(-0.14, -0.11), P(-0.25, -0.01)],
    [P(-0.06, 0.06), P(0.13, 0.2), P(0.09, 0.4)],
    [P(-0.06, 0.06), P(-0.16, 0.25), P(-0.35, 0.3)],
  ] as const)
    strokePts(c, limb, false, 2.4, col);
}

/** 감옥 문 자물쇠 */
export function paintLockBadge(c: BadgeCtx, x: number, y: number, a: number): void {
  const w = BADGE.lockW * T;
  const h = BADGE.lockH * T;
  roundRect(c, x - w / 2, y - h / 2, w, h, 3);
  c.fillStyle = rgba(dimmed(PLATE, a), 1);
  c.fill();
  c.lineWidth = 1.4;
  c.strokeStyle = rgba(dimmed(PRISON_COLOR, a * 0.8), 1);
  c.stroke();
  const col = dimmed(PRISON_COLOR, a);
  c.beginPath();
  c.arc(x, y - h * 0.06, w * 0.22, Math.PI, 0, false);
  c.lineWidth = 2.6;
  c.lineCap = 'butt';
  c.strokeStyle = rgba(col, 1);
  c.stroke();
  roundRect(c, x - w * 0.32, y - h * 0.06, w * 0.64, h * 0.4, 2);
  c.fillStyle = rgba(col, 1);
  c.fill();
  c.fillStyle = rgba(dimmed(PLATE, a), 1);
  c.fillRect(x - 1.2, y + h * 0.04, 2.4, h * 0.16);
}

/** 배지 다섯 장 (아틀라스 칸 순서 = 프레임 이름) */
export type BadgeId = 'point-A' | 'point-B' | 'exit-N' | 'exit-S' | 'prison';
export const BADGE_IDS: readonly BadgeId[] = ['point-A', 'point-B', 'exit-N', 'exit-S', 'prison'];
const BADGE_KIND: Readonly<Record<BadgeId, keyof typeof BADGE_BOX>> = {
  'point-A': 'point',
  'point-B': 'point',
  'exit-N': 'exit',
  'exit-S': 'exit',
  prison: 'lock',
};
const POINT_BADGE: Readonly<Record<'A' | 'B', BadgeId>> = { A: 'point-A', B: 'point-B' };
const EXIT_BADGE: Readonly<Record<'N' | 'S', BadgeId>> = { N: 'exit-N', S: 'exit-S' };

/** 배지 기준점 (월드 px): 거점 = 패드 위쪽 가장자리, 탈출구 = 문 옆 표지판, 감옥 = 남쪽 문 칸 */
function badgeAnchor(id: BadgeId): Pt {
  if (id === 'point-A' || id === 'point-B') {
    const c = CAPTURE_POINTS[id === 'point-A' ? 'A' : 'B'];
    return [c.x * T, (c.y + BADGE.pointDy) * T];
  }
  if (id === 'exit-N' || id === 'exit-S') {
    const s = exitSignAt(id === 'exit-N' ? 'N' : 'S');
    return [s.x * T, s.y * T];
  }
  return [PRISON_LOCK.x * T, PRISON_LOCK.y * T];
}

const BADGE_AT: Readonly<Record<BadgeId, Pt>> = {
  'point-A': badgeAnchor('point-A'),
  'point-B': badgeAnchor('point-B'),
  'exit-N': badgeAnchor('exit-N'),
  'exit-S': badgeAnchor('exit-S'),
  prison: badgeAnchor('prison'),
};

/** 배지를 구울 기기 px 사각형 (배지 하나 = 캔버스 한 장이던 때의 캔버스 위치 · 크기 그대로) */
export interface BadgeRect {
  /** 백버퍼 기기 px 왼쪽 위 (정수) */
  readonly dx0: number;
  readonly dy0: number;
  readonly w: number;
  readonly h: number;
}

/** 배지 하나가 배율 zoom에서 차지하는 기기 픽셀 사각형: 기준점 + 굽는 범위를 기기 픽셀 격자로 넓힌 것 */
export function badgeRect(id: BadgeId, zoom: number): BadgeRect {
  const at = BADGE_AT[id];
  const box = BADGE_BOX[BADGE_KIND[id]];
  const kd = MAP_SCALE * zoom;
  const ex = zoom * MAP_X;
  const ey = zoom * MAP_Y;
  const dx0 = Math.floor(ex + (at[0] + box.x0) * kd);
  const dy0 = Math.floor(ey + (at[1] + box.y0) * kd);
  return {
    dx0,
    dy0,
    w: Math.ceil(ex + (at[0] + box.x1) * kd) - dx0,
    h: Math.ceil(ey + (at[1] + box.y1) * kd) - dy0,
  };
}

/** 아틀라스 칸 (아틀라스 px) */
export interface BadgeSlot {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface BadgeAtlasLayout {
  readonly width: number;
  readonly height: number;
  readonly slots: Readonly<Record<BadgeId, BadgeSlot>>;
}

/** 칸 사이 투명 테 (px): 선형 보간이 이웃 칸을 끌어오지 않게 */
const SLOT_GAP = 2;

/**
 * 배지 아틀라스 배치 (배율 zoom): 다섯 칸을 한 줄로. 칸 크기 = 그 배지가 어떤 소수 자리에서든 차지할 수 있는 가장 큰
 * 사각형(굽는 범위 × 기기 배율, 올림 + 1)이라 배지가 늘 칸 안에 들어간다. 칸 사이 · 가장자리는 투명 테
 */
export function layoutBadgeAtlas(zoom: number): BadgeAtlasLayout {
  const kd = MAP_SCALE * zoom;
  let x = SLOT_GAP;
  let height = 0;
  const slots = {} as Record<BadgeId, BadgeSlot>;
  for (const id of BADGE_IDS) {
    const box = BADGE_BOX[BADGE_KIND[id]];
    const w = Math.ceil((box.x1 - box.x0) * kd) + 1;
    const h = Math.ceil((box.y1 - box.y0) * kd) + 1;
    slots[id] = { x, y: SLOT_GAP, w, h };
    x += w + SLOT_GAP;
    height = Math.max(height, h + SLOT_GAP * 2);
  }
  return { width: x, height, slots };
}

/** 상태 코드 (서명용 수) */
const POINT_CODE: Readonly<Record<PointState, number>> = { idle: 0, capturing: 1, blocked: 2, done: 3 };
const EXIT_CODE: Readonly<Record<ExitState, number>> = { inactive: 0, active: 1, open: 2 };
const POINT_STATES: readonly PointState[] = ['idle', 'capturing', 'blocked', 'done'];
const EXIT_STATES: readonly ExitState[] = ['inactive', 'active', 'open'];

/** 배지 한 장의 마지막으로 구운 서명 (배율 · 상태 코드 · 알파: 문자열 대신 수) */
interface BadgeSig {
  zoom: number;
  code: number;
  alpha: number;
}

/**
 * 배지 다섯 장을 한 캔버스(아틀라스)에 굽고 이미지 다섯 개가 그 프레임을 그린다 (렌더링 최적화 2): 텍스처가 하나라
 * 텍스처 단위가 하나뿐인 휴대폰 MobilePipeline에서도 배지 그리기가 한 번이다(예전: 배지마다 텍스처 → 그리기 다섯 번).
 * 배지는 굽을 때마다 새로 만든 작업 캔버스(예전 배지 캔버스와 같은 크기 · 같은 변환)에 그린 뒤 제 칸에 정수 자리로 1:1
 * 복사한다. 크롬은 2D 캔버스의 래스터 방식(가속 여부)을 쓰임새 이력(다른 캔버스에 그려짐 · 지운 뒤 다시 씀 · 텍스처
 * 올리기)으로 바꾸고, 그러면 얇은 선 끝 안티에일리어싱이 최대 12~20 달라진다(아틀라스에 바로 그리거나 작업 캔버스 하나를
 * 다시 쓰면 스크린샷에서 그랬다). 새 캔버스는 예전 배지 캔버스의 첫 굽기와 같은 래스터라 텍스처 화소가 예전과 같고,
 * 이미지 자리 · 배율(텍셀 = 기기 픽셀)도 그대로다. 굽기는 상태 · 알파 · 배율이 바뀔 때만이라 캔버스를 만드는 일은 드물다.
 * 바뀐 배지만 다시 굽고, 한 프레임에 여러 장이 바뀌어도 한 번만 올린다
 */
class BadgeAtlas {
  readonly key = nextFogKey('badges');
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly texture: Phaser.Textures.Texture;
  private layout: BadgeAtlasLayout | null = null;
  private zoom = NaN;
  /** 통째로 올려야 한다 (칸을 다시 나눠 텍스처 크기가 바뀌었거나, 일부 올리기를 못 했다) */
  private dirty = false;

  constructor(private readonly scene: Phaser.Scene) {
    const { canvas, ctx } = makeCanvas(1, 1);
    this.canvas = canvas;
    this.ctx = ctx;
    this.texture = createCanvasTexture(scene.textures, this.key, canvas);
  }

  /** 배율이 바뀌었으면 칸을 다시 나눈다 (캔버스 크기를 바꾸면 내용이 지워진다: 모두 다시 구워야 한다). 바뀌었으면 true */
  ensure(zoom: number): boolean {
    if (this.layout && zoom === this.zoom) return false;
    this.zoom = zoom;
    const l = layoutBadgeAtlas(zoom);
    this.layout = l;
    // 빈 캔버스는 올리지 않는다: 칸을 다시 나누면 같은 draw에서 모두 다시 굽고 flush가 한 번 통째로 올린다
    resizeCanvasTexture(this.key, this.texture, this.canvas, l.width, l.height, false);
    this.dirty = true;
    return true;
  }

  /** 배지 한 장을 제 칸에 굽고 프레임을 맞춘다. 돌려주는 값은 구운 사각형 */
  bake(id: BadgeId, zoom: number, paint: (c: BadgeCtx, x: number, y: number) => void): BadgeRect {
    const slot = this.layout?.slots[id] ?? { x: 0, y: 0, w: 0, h: 0 };
    const r = badgeRect(id, zoom);
    const kd = MAP_SCALE * zoom;
    // 1) 새 작업 캔버스 = 예전 배지 캔버스 (같은 크기 · 같은 변환)
    const { canvas: wc, ctx: w } = makeCanvas(r.w, r.h);
    w.setTransform(kd, 0, 0, kd, zoom * MAP_X - r.dx0, zoom * MAP_Y - r.dy0);
    const at = BADGE_AT[id];
    paint(w, at[0], at[1]);
    // 2) 지운 칸에 화소 그대로 복사 (정수 자리 · 같은 크기, 투명 위 보통 섞기 = 원본 그대로).
    //    'copy'는 그린 범위 밖(다른 칸)까지 지우므로 쓰지 않는다
    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(slot.x, slot.y, slot.w, slot.h);
    c.drawImage(wc, slot.x, slot.y);
    if (this.texture.has(id)) this.texture.get(id).setSize(r.w, r.h, slot.x, slot.y);
    else this.texture.add(id, 0, slot.x, slot.y, r.w, r.h);
    // 3) GPU에는 바뀐 칸만 올린다 (작업 캔버스 = 그 칸의 화소 그대로: 예전 배지 한 장을 올리던 것과 같은 양).
    //    텍스처 크기가 바뀐 뒤(칸을 다시 나눔)이거나 WebGL이 아니면 flush가 통째로 올린다 (Canvas 렌더러는 캔버스를 바로 그린다)
    if (
      !this.dirty &&
      !uploadCanvasSubTexture(this.scene.game.renderer, this.texture.source[0], wc, slot.x, slot.y)
    )
      this.dirty = true;
    gfxState.features.badgeUploadPx =
      Number(gfxState.features.badgeUploadPx ?? 0) + (this.dirty ? 0 : r.w * r.h);
    return r;
  }

  /** 통째로 올려야 하면(칸을 다시 나눔 · 일부 올리기를 못 함) 한 번 올린다 */
  flush(): void {
    if (!this.dirty) return;
    this.dirty = false;
    uploadCanvasTexture(this.texture);
    gfxState.features.badgeUploadPx =
      Number(gfxState.features.badgeUploadPx ?? 0) + this.canvas.width * this.canvas.height;
  }

  destroy(): void {
    removeCanvasTexture(this.scene.textures, this.key);
  }
}

/** 바닥 배지 (캐릭터 아래). draw는 매 프레임(바뀐 배지만 다시 굽는다), info는 지난 draw의 정보 레이어 */
export class Badges {
  /** 배지 이미지를 담는 상자: 맵 컨테이너에 캐릭터보다 먼저 넣어 늘 아래에 그린다 */
  private readonly box: Phaser.GameObjects.Container;
  private readonly atlas: BadgeAtlas;
  private readonly images = new Map<BadgeId, Phaser.GameObjects.Image>();
  private readonly sigs: Record<BadgeId, BadgeSig>;
  private readonly labels = new Map<'A' | 'B', CrispText>();
  private last: InfoItem[] = [];

  constructor(
    private readonly scene: Phaser.Scene,
    container: Phaser.GameObjects.Container,
  ) {
    // make로 만든 컨테이너는 혼합 모드가 NORMAL로 잡힌다 (배지는 모두 NORMAL이라 그대로 둔다)
    this.box = scene.make.container({ x: 0, y: 0 }, false);
    container.add(this.box);
    this.atlas = new BadgeAtlas(scene);
    const sig = (): BadgeSig => ({ zoom: NaN, code: -1, alpha: NaN });
    this.sigs = { 'point-A': sig(), 'point-B': sig(), 'exit-N': sig(), 'exit-S': sig(), prison: sig() };
    // A · B 글자는 맵 컨테이너(0.93배) 밖 화면 좌표에 둔다(글자 텍셀 = 화면 픽셀). 캐릭터를 덮지 않게 맵 컨테이너 바로 아래로 내린다
    // (안개 레이어보다는 위: 시야 밖에서도 45%로 보인다)
    for (const id of ['A', 'B'] as const) {
      const c = CAPTURE_POINTS[id];
      const p = tileToScreen(c.x, c.y + BADGE.pointDy);
      const t = makeText(scene, p.x, p.y, id, {
        fontFamily: 'sans-serif',
        fontSize: `${17 * MAP_SCALE}px`,
        fontStyle: 'bold',
        color: '#E2E8F0',
      }).setOrigin(0.5);
      scene.children.moveBelow(t, container);
      this.labels.set(id, t);
    }
    gfxState.features.badgeGfxCmds = countGraphicsCmds(this.box.list).cmds;
    scene.events.once('shutdown', () => {
      for (const img of this.images.values()) img.destroy();
      this.images.clear();
      this.atlas.destroy();
    });
  }

  /** 지난 draw의 정보 레이어 항목 (배지 · 진행). 품질과 상관없이 같은 값 */
  info(): InfoItem[] {
    return this.last;
  }

  /**
   * 서명(배율 · 상태 코드 · 알파)이 지난번과 다를 때만 굽는다. 구우면 이미지를 그 프레임 · 자리에 맞춘다
   * (텍셀 = 기기 픽셀: 자리는 기기 픽셀 정수, 배율 1/(맵 배율 × zoom))
   */
  private bake(id: BadgeId, zoom: number, code: number, alpha: number): void {
    const s = this.sigs[id];
    if (s.zoom === zoom && s.code === code && s.alpha === alpha) return;
    s.zoom = zoom;
    s.code = code;
    s.alpha = alpha;
    const r = this.atlas.bake(id, zoom, (c, x, y) => {
      if (BADGE_KIND[id] === 'point') {
        const st = POINT_STATES[code] ?? 'idle';
        paintPointBadge(c, x, y, pointColor(st), pointIcon(st), alpha);
      } else if (BADGE_KIND[id] === 'exit') {
        paintExitBadge(c, x, y, exitColor(EXIT_STATES[code] ?? 'inactive'), alpha);
      } else {
        paintLockBadge(c, x, y, alpha);
      }
    });
    let img = this.images.get(id);
    if (!img) {
      img = this.scene.make.image({ x: 0, y: 0, key: this.atlas.key, frame: id }, false).setOrigin(0, 0);
      this.box.add(img);
      this.images.set(id, img);
      gfxState.features.badgeGfxCmds = countGraphicsCmds(this.box.list).cmds;
    }
    const kd = MAP_SCALE * zoom;
    img
      .setFrame(id)
      .setPosition((r.dx0 / zoom - MAP_X) / MAP_SCALE, (r.dy0 / zoom - MAP_Y) / MAP_SCALE)
      .setScale(1 / kd)
      .setVisible(true);
    gfxState.features.badgeBakes = Number(gfxState.features.badgeBakes ?? 0) + 1;
  }

  draw(
    points: readonly PointView[],
    exits: readonly ExitView[],
    alpha: BadgeAlpha,
    blink: Record<'A' | 'B', boolean>,
  ): void {
    this.last = badgeInfo(points, exits, alpha, blink, paintedRadii);
    // 그림은 상태 · 알파 · 백버퍼 배율이 바뀐 배지만 다시 굽는다 (진행 값은 배지 그림에 쓰지 않는다)
    const zoom = gfxState.zoom;
    if (this.atlas.ensure(zoom)) {
      // 칸을 다시 나누면 아틀라스가 지워진다: 모두 다시 굽는다 (이번 프레임에 그리지 않는 배지는 감춘다)
      for (const id of BADGE_IDS) this.sigs[id].zoom = NaN;
      for (const img of this.images.values()) img.setVisible(false);
    }
    for (const p of points) {
      const a = pointBadgeAlpha(p.id, alpha, blink);
      this.bake(POINT_BADGE[p.id], zoom, POINT_CODE[p.state], a);
      this.labels.get(p.id)?.setAlpha(a);
    }
    for (const e of exits) this.bake(EXIT_BADGE[e.id], zoom, EXIT_CODE[e.state], alpha.exits[e.id]);
    this.bake('prison', zoom, 0, alpha.prison);
    this.atlas.flush();
  }
}

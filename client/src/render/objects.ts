// 거점 · 탈출구 · 감옥 배지 (M10b): 바닥 문양 + 라벨. 캐릭터보다 아래 레이어에 그린다(정보 우선 R15: 배지가 캐릭터를 덮지 않음).
// 맵 구조가 늘 어둡게 보이므로 배지를 안개 위에서 내렸다. 항상 표시 규칙(지금 안 보이는 곳 45%, 괴물 화면 점령 중 깜빡임)은 그대로다.
//  - 거점: 패드 위쪽 가장자리의 마름모 + A/B 글자 + 상태 칩(점령 중 ▶ · 정지 ‖ 주황 · 완료 ✓). 가운데(단말 · 서 있는 사람)를 비운다
//  - 탈출구: 문 오른쪽 문틀의 표지판 + 달리는 사람 (비활성 회색 · 활성 초록). 문짝 · 미닫이 연출을 가리지 않는다
//  - 감옥: 남쪽 문 칸의 자물쇠 (수감자가 서는 안쪽을 덮지 않는다)
// 알파는 어두운 바닥 위 합성과 같은 색으로 미리 섞어 불투명하게 그린다(dimmed): 선이 겹친 곳이 진해지지 않는다.
// 배지마다 작은 캔버스(기기 픽셀 1:1)에 구워 이미지로 보이고, 상태 · 알파 · 백버퍼 배율이 바뀔 때만 다시 굽는다
// (프레임마다 다시 테셀레이션하는 Graphics를 쓰지 않는다: gfx.features.badgeGfxCmds = 0).
// 정보 레이어(info)는 art/mapArtBadges.ts badgeInfo로 만들고, 품질과 상관없이 같다.
import type Phaser from 'phaser';
import { CAPTURE_POINTS, TILE_PX, type ExitView, type InfoItem, type PointView } from '@decoy/shared';
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

/** 배지 하나를 구운 캔버스 텍스처 + 이미지 (맵 컨테이너 안, 텍셀 = 기기 픽셀) */
class BadgePatch {
  private readonly key = nextFogKey('badge');
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly texture: Phaser.Textures.Texture;
  readonly image: Phaser.GameObjects.Image;
  private drawn = '';

  constructor(
    private readonly scene: Phaser.Scene,
    box: Phaser.GameObjects.Container,
  ) {
    const { canvas, ctx } = makeCanvas(1, 1);
    this.canvas = canvas;
    this.ctx = ctx;
    this.texture = createCanvasTexture(scene.textures, this.key, canvas);
    this.image = scene.make.image({ x: 0, y: 0, key: this.key }, false).setOrigin(0, 0).setVisible(false);
    box.add(this.image);
  }

  /** sig가 지난번과 다를 때만 다시 굽는다. at = 기준점(월드 px), paint는 월드 px 좌표로 그린다 */
  bake(sig: string, zoom: number, at: Pt, box: Box, paint: (c: BadgeCtx) => void): void {
    if (sig === this.drawn) return;
    this.drawn = sig;
    const kd = MAP_SCALE * zoom;
    const ex = zoom * MAP_X;
    const ey = zoom * MAP_Y;
    const dx0 = Math.floor(ex + (at[0] + box.x0) * kd);
    const dy0 = Math.floor(ey + (at[1] + box.y0) * kd);
    const w = Math.ceil(ex + (at[0] + box.x1) * kd) - dx0;
    const h = Math.ceil(ey + (at[1] + box.y1) * kd) - dy0;
    const c = this.ctx;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      resizeCanvasTexture(this.key, this.texture, this.canvas, w, h);
      this.image.setSizeToFrame();
    } else {
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, w, h);
    }
    c.setTransform(kd, 0, 0, kd, ex - dx0, ey - dy0);
    paint(c);
    uploadCanvasTexture(this.texture);
    this.image
      .setPosition((dx0 / zoom - MAP_X) / MAP_SCALE, (dy0 / zoom - MAP_Y) / MAP_SCALE)
      .setScale(1 / kd)
      .setVisible(true);
    gfxState.features.badgeBakes = Number(gfxState.features.badgeBakes ?? 0) + 1;
  }

  destroy(): void {
    this.image.destroy();
    removeCanvasTexture(this.scene.textures, this.key);
  }
}

/** 바닥 배지 (캐릭터 아래). draw는 매 프레임(바뀐 배지만 다시 굽는다), info는 지난 draw의 정보 레이어 */
export class Badges {
  /** 배지 이미지를 담는 상자: 맵 컨테이너에 캐릭터보다 먼저 넣어 늘 아래에 그린다 */
  private readonly box: Phaser.GameObjects.Container;
  private readonly patches = new Map<string, BadgePatch>();
  private readonly labels = new Map<'A' | 'B', CrispText>();
  private last: InfoItem[] = [];

  constructor(
    private readonly scene: Phaser.Scene,
    container: Phaser.GameObjects.Container,
  ) {
    // make로 만든 컨테이너는 혼합 모드가 NORMAL로 잡힌다 (배지는 모두 NORMAL이라 그대로 둔다)
    this.box = scene.make.container({ x: 0, y: 0 }, false);
    container.add(this.box);
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
    scene.events.once('shutdown', () => {
      for (const p of this.patches.values()) p.destroy();
      this.patches.clear();
    });
  }

  /** 지난 draw의 정보 레이어 항목 (배지 · 진행). 품질과 상관없이 같은 값 */
  info(): InfoItem[] {
    return this.last;
  }

  private patch(key: string): BadgePatch {
    let p = this.patches.get(key);
    if (!p) {
      p = new BadgePatch(this.scene, this.box);
      this.patches.set(key, p);
    }
    return p;
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
    for (const p of points) {
      const a = pointBadgeAlpha(p.id, alpha, blink);
      const c = CAPTURE_POINTS[p.id];
      const at: Pt = [c.x * T, (c.y + BADGE.pointDy) * T];
      this.patch(`point-${p.id}`).bake(`${zoom}|${p.state}|${a}`, zoom, at, BADGE_BOX.point, (g) =>
        paintPointBadge(g, at[0], at[1], pointColor(p.state), pointIcon(p.state), a),
      );
      this.labels.get(p.id)?.setAlpha(a);
    }
    for (const e of exits) {
      const s = exitSignAt(e.id);
      const at: Pt = [s.x * T, s.y * T];
      const a = alpha.exits[e.id];
      this.patch(`exit-${e.id}`).bake(`${zoom}|${e.state}|${a}`, zoom, at, BADGE_BOX.exit, (g) =>
        paintExitBadge(g, at[0], at[1], exitColor(e.state), a),
      );
    }
    const lock: Pt = [PRISON_LOCK.x * T, PRISON_LOCK.y * T];
    this.patch('prison').bake(`${zoom}|${alpha.prison}`, zoom, lock, BADGE_BOX.lock, (g) =>
      paintLockBadge(g, lock[0], lock[1], alpha.prison),
    );
    gfxState.features.badgeGfxCmds = countGraphicsCmds(this.box.list).cmds;
  }
}

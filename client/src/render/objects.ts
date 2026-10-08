// 거점 · 탈출구 · 감옥 배지 (M10b): 바닥 문양 + 라벨. 캐릭터보다 아래 레이어에 그린다(정보 우선 R15: 배지가 캐릭터를 덮지 않음).
// 맵 구조가 늘 어둡게 보이므로 배지를 안개 위에서 내렸다. 항상 표시 규칙(지금 안 보이는 곳 45%, 괴물 화면 점령 중 깜빡임)은 그대로다.
//  - 거점: 패드 위쪽 가장자리의 마름모 + A/B 글자 + 상태 칩(점령 중 ▶ · 정지 ‖ 주황 · 완료 ✓). 가운데(단말 · 서 있는 사람)를 비운다
//  - 탈출구: 문 오른쪽 문틀의 표지판 + 달리는 사람 (비활성 회색 · 활성 초록). 문짝 · 미닫이 연출을 가리지 않는다
//  - 감옥: 남쪽 문 칸의 자물쇠 (수감자가 서는 안쪽을 덮지 않는다)
// 알파는 어두운 바닥 위 합성과 같은 색으로 미리 섞어 불투명하게 그린다(dimmed): 선이 겹친 곳이 진해지지 않는다.
// 정보 레이어(info)는 art/mapArtBadges.ts badgeInfo로 만들고, 품질과 상관없이 같다.
import Phaser from 'phaser';
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
import { MAP_SCALE, tileToScreen } from '../ui/layout';
import { makeText, type CrispText } from '../ui/text';
import { paintedRadii } from './fogPaint';

export type { BadgeAlpha } from '../art/mapArtBadges';

const T = TILE_PX;
const PLATE = UI.background;

type Pt = [number, number];

function vec(points: readonly Pt[]): Phaser.Math.Vector2[] {
  return points.map(([x, y]) => new Phaser.Math.Vector2(x, y));
}

/** 바닥 배지 (캐릭터 아래). draw는 매 프레임, info는 지난 draw의 정보 레이어 */
export class Badges {
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly labels = new Map<'A' | 'B', CrispText>();
  private last: InfoItem[] = [];

  constructor(scene: Phaser.Scene, container: Phaser.GameObjects.Container) {
    this.g = scene.add.graphics();
    container.add(this.g);
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
  }

  /** 지난 draw의 정보 레이어 항목 (배지 · 진행). 품질과 상관없이 같은 값 */
  info(): InfoItem[] {
    return this.last;
  }

  draw(
    points: readonly PointView[],
    exits: readonly ExitView[],
    alpha: BadgeAlpha,
    blink: Record<'A' | 'B', boolean>,
  ): void {
    const g = this.g;
    g.clear();
    for (const p of points) {
      const a = pointBadgeAlpha(p.id, alpha, blink);
      const c = CAPTURE_POINTS[p.id];
      this.pointBadge(c.x * T, (c.y + BADGE.pointDy) * T, pointColor(p.state), pointIcon(p.state), a);
      this.labels.get(p.id)?.setAlpha(a);
    }
    for (const e of exits) {
      const at = exitSignAt(e.id);
      this.exitBadge(at.x * T, at.y * T, exitColor(e.state), alpha.exits[e.id]);
    }
    this.lockBadge(PRISON_LOCK.x * T, PRISON_LOCK.y * T, alpha.prison);
    this.last = badgeInfo(points, exits, alpha, blink, paintedRadii);
  }

  /** 마름모(글자 자리는 비움: 글자는 컨테이너 아래 화면 글자) + 상태 칩 */
  private pointBadge(x: number, y: number, color: number, icon: PointIcon | null, a: number): void {
    const g = this.g;
    const h = BADGE.pointHalf * T;
    g.lineStyle(2.4, dimmed(color, a), 1);
    g.strokePoints(
      vec([
        [x, y - h],
        [x + h, y],
        [x, y + h],
        [x - h, y],
      ]),
      true,
      true,
    );
    // 마름모 꼭짓점 눈금 (바닥 표지 느낌)
    g.lineStyle(1.6, dimmed(color, a * 0.7), 1);
    g.lineBetween(x - h - 5, y, x - h - 1.5, y);
    if (!icon) return;
    const cx = x + BADGE.chipDx * T;
    const s = BADGE.chipHalf * T;
    g.fillStyle(dimmed(PLATE, a), 1);
    g.fillRect(cx - s, y - s, 2 * s, 2 * s);
    g.lineStyle(1.6, dimmed(color, a), 1);
    g.strokeRect(cx - s, y - s, 2 * s, 2 * s);
    g.fillStyle(dimmed(color, a), 1);
    if (icon === 'play') {
      g.fillTriangle(cx - s * 0.38, y - s * 0.5, cx - s * 0.38, y + s * 0.5, cx + s * 0.5, y);
    } else if (icon === 'pause') {
      g.fillRect(cx - s * 0.48, y - s * 0.5, s * 0.32, s);
      g.fillRect(cx + s * 0.16, y - s * 0.5, s * 0.32, s);
    } else {
      g.lineStyle(2.6, dimmed(color, a), 1);
      g.strokePoints(
        vec([
          [cx - s * 0.52, y + s * 0.02],
          [cx - s * 0.14, y + s * 0.42],
          [cx + s * 0.55, y - s * 0.42],
        ]),
        false,
        true,
      );
    }
  }

  /** 문 가운데 표지판 + 달리는 사람 */
  private exitBadge(x: number, y: number, color: number, a: number): void {
    const g = this.g;
    const w = BADGE.exitW * T;
    const h = BADGE.exitH * T;
    g.fillStyle(dimmed(PLATE, a), 1);
    g.fillRect(x - w / 2, y - h / 2, w, h);
    g.lineStyle(1.8, dimmed(color, a), 1);
    g.strokeRect(x - w / 2, y - h / 2, w, h);
    const s = h * 0.78;
    const col = dimmed(color, a);
    const P = (u: number, v: number): Pt => [x + u * s, y + v * s];
    g.fillStyle(col, 1);
    g.fillCircle(x + 0.14 * s, y - 0.36 * s, 0.09 * s);
    g.lineStyle(2.4, col, 1);
    for (const limb of [
      [P(0.08, -0.22), P(-0.06, 0.06)],
      [P(0.05, -0.17), P(0.22, -0.06), P(0.32, -0.15)],
      [P(0.05, -0.17), P(-0.14, -0.11), P(-0.25, -0.01)],
      [P(-0.06, 0.06), P(0.13, 0.2), P(0.09, 0.4)],
      [P(-0.06, 0.06), P(-0.16, 0.25), P(-0.35, 0.3)],
    ] as const)
      g.strokePoints(vec(limb), false, true);
  }

  /** 감옥 문 자물쇠 */
  private lockBadge(x: number, y: number, a: number): void {
    const g = this.g;
    const w = BADGE.lockW * T;
    const h = BADGE.lockH * T;
    g.fillStyle(dimmed(PLATE, a), 1);
    g.fillRoundedRect(x - w / 2, y - h / 2, w, h, 3);
    g.lineStyle(1.4, dimmed(PRISON_COLOR, a * 0.8), 1);
    g.strokeRoundedRect(x - w / 2, y - h / 2, w, h, 3);
    const col = dimmed(PRISON_COLOR, a);
    g.lineStyle(2.6, col, 1);
    g.beginPath();
    g.arc(x, y - h * 0.06, w * 0.22, Math.PI, 0, false);
    g.strokePath();
    g.fillStyle(col, 1);
    g.fillRoundedRect(x - w * 0.32, y - h * 0.06, w * 0.64, h * 0.4, 2);
    g.fillStyle(dimmed(PLATE, a), 1);
    g.fillRect(x - 1.2, y + h * 0.04, 2.4, h * 0.16);
  }
}

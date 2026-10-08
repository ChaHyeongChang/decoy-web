// 거점 · 탈출구 · 감옥: 바닥 영역(안개 아래)과 항상 표시 배지(안개 위)
import Phaser from 'phaser';
import {
  CAPTURE_POINTS,
  EXITS,
  PRISON_CENTER,
  TILE_PX,
  type Balance,
  type ExitView,
  type InfoItem,
  type PointView,
} from '@decoy/shared';
import { MAP_SCALE, tileToScreen } from '../ui/layout';
import { makeText } from '../ui/text';
import { COLOR } from './colors';

const T = TILE_PX;

/** 거점 바닥 영역 + 진행 링 (안개 아래, 레이어 3) */
export function drawPointAreas(
  g: Phaser.GameObjects.Graphics,
  points: readonly PointView[],
  balance: Balance,
): void {
  const r = balance.capturePoint.radius * T;
  for (const p of points) {
    const c = CAPTURE_POINTS[p.id];
    const cx = c.x * T;
    const cy = c.y * T;
    g.fillStyle(COLOR.pointRing, p.state === 'done' ? 0.12 : 0.05);
    g.fillCircle(cx, cy, r);
    g.lineStyle(2, COLOR.pointLine, 0.55);
    g.strokeCircle(cx, cy, r);
    if (p.progress > 0) {
      g.lineStyle(5, COLOR.pointRing, 0.95);
      g.beginPath();
      g.arc(cx, cy, r - 4, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, p.progress), false);
      g.strokePath();
    }
  }
}

function exitColor(state: ExitView['state']): number {
  return state === 'inactive' ? COLOR.exitInactive : COLOR.exitActive;
}

/** 탈출구 바닥 영역 (안개 아래) */
export function drawExitAreas(
  g: Phaser.GameObjects.Graphics,
  exits: readonly ExitView[],
  balance: Balance,
): void {
  for (const e of exits) {
    const def = EXITS[e.id];
    const color = exitColor(e.state);
    g.fillStyle(color, e.state === 'inactive' ? 0.06 : 0.14);
    g.fillCircle(def.center.x * T, def.center.y * T, balance.exit.radius * T);
    g.lineStyle(2, color, 0.5);
    g.strokeCircle(def.center.x * T, def.center.y * T, balance.exit.radius * T);
    if (e.progress !== null && e.progress > 0) {
      g.lineStyle(4, COLOR.exitActive, 0.95);
      g.beginPath();
      g.arc(
        def.center.x * T,
        def.center.y * T,
        balance.exit.radius * T - 3,
        -Math.PI / 2,
        -Math.PI / 2 + Math.PI * 2 * e.progress,
        false,
      );
      g.strokePath();
    }
  }
}

/** 달리는 사람 아이콘 (선으로 그림) */
function runner(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  s: number,
  color: number,
  alpha: number,
): void {
  g.lineStyle(2, color, alpha);
  g.fillStyle(color, alpha);
  g.fillCircle(x + s * 0.15, y - s * 0.38, s * 0.12);
  g.beginPath();
  g.moveTo(x + s * 0.1, y - s * 0.24);
  g.lineTo(x - s * 0.05, y + s * 0.08);
  g.lineTo(x - s * 0.28, y + s * 0.38);
  g.moveTo(x - s * 0.05, y + s * 0.08);
  g.lineTo(x + s * 0.18, y + s * 0.2);
  g.lineTo(x + s * 0.12, y + s * 0.42);
  g.moveTo(x - s * 0.25, y - s * 0.12);
  g.lineTo(x + s * 0.05, y - s * 0.16);
  g.lineTo(x + s * 0.3, y - s * 0.02);
  g.strokePath();
}

export interface BadgeAlpha {
  points: Record<'A' | 'B', number>;
  exits: Record<'N' | 'S', number>;
  prison: number;
}

/** 항상 표시 배지 (안개 위, 레이어 8). 미관측이면 알파 45% */
export class Badges {
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly labels: Phaser.GameObjects.Text[] = [];

  constructor(scene: Phaser.Scene, container: Phaser.GameObjects.Container) {
    this.g = scene.add.graphics();
    container.add(this.g);
    // A · B 글자는 맵 컨테이너(0.93배) 밖 화면 좌표에 둔다: 컨테이너 배율이 붙으면 글자 텍셀이 화면 픽셀과 1:1이 안 된다.
    // 크기 · 위치는 컨테이너 안에 있을 때와 같다 (18px × 0.93, 거점 중심). 컨테이너 바로 뒤에 만들어 그리는 순서도 같다
    for (const id of ['A', 'B'] as const) {
      const c = CAPTURE_POINTS[id];
      const p = tileToScreen(c.x, c.y);
      const t = makeText(scene, p.x, p.y, id, {
        fontFamily: 'sans-serif',
        fontSize: `${18 * MAP_SCALE}px`,
        fontStyle: 'bold',
        color: '#E2E8F0',
      }).setOrigin(0.5);
      this.labels.push(t);
    }
  }

  /** 지난 draw의 정보 레이어 항목 (배지 · 진행). 품질과 상관없이 같은 값 (M10b 맵 · 오브젝트 갈래가 채운다) */
  info(): InfoItem[] {
    return [];
  }

  draw(
    points: readonly PointView[],
    exits: readonly ExitView[],
    alpha: BadgeAlpha,
    blink: Record<'A' | 'B', boolean>,
  ): void {
    const g = this.g;
    g.clear();
    const w = 0.8 * T;
    // 거점 마름모 배지
    points.forEach((p, i) => {
      const c = CAPTURE_POINTS[p.id];
      const a = blink[p.id] ? 0.25 : alpha.points[p.id];
      const cx = c.x * T;
      const cy = c.y * T;
      g.fillStyle(0x0b1622, 0.85 * a);
      g.fillPoints(
        [
          new Phaser.Math.Vector2(cx, cy - w / 2 - 4),
          new Phaser.Math.Vector2(cx + w / 2 + 4, cy),
          new Phaser.Math.Vector2(cx, cy + w / 2 + 4),
          new Phaser.Math.Vector2(cx - w / 2 - 4, cy),
        ],
        true,
      );
      g.lineStyle(2, p.state === 'done' ? COLOR.pointRing : COLOR.pointLine, a);
      g.strokePoints(
        [
          new Phaser.Math.Vector2(cx, cy - w / 2 - 4),
          new Phaser.Math.Vector2(cx + w / 2 + 4, cy),
          new Phaser.Math.Vector2(cx, cy + w / 2 + 4),
          new Phaser.Math.Vector2(cx - w / 2 - 4, cy),
        ],
        true,
      );
      const label = this.labels[i];
      if (label) label.setAlpha(a);
    });
    // 탈출구: 문(2×1) + 달리는 사람
    for (const e of exits) {
      const def = EXITS[e.id];
      const a = alpha.exits[e.id];
      const color = exitColor(e.state);
      const x0 = def.door.x0 * T;
      const y0 = def.door.y0 * T;
      const dw = (def.door.x1 - def.door.x0) * T;
      const dh = (def.door.y1 - def.door.y0) * T;
      if (e.state === 'open') {
        g.fillStyle(COLOR.exitActive, 0.35 * a);
        g.fillRect(x0 - 6, y0 - 6, dw + 12, dh + 12);
      }
      g.fillStyle(color, e.state === 'open' ? 0.25 * a : 0.85 * a);
      g.fillRect(x0 + 2, y0 + 2, dw - 4, dh - 4);
      g.lineStyle(2, color, a);
      g.strokeRect(x0 + 2, y0 + 2, dw - 4, dh - 4);
      runner(g, x0 + dw / 2, y0 + dh / 2, dh * 0.9, e.state === 'open' ? COLOR.exitActive : 0xe2e8f0, a);
    }
    // 감옥 자물쇠 배지
    const pa = alpha.prison;
    const px = PRISON_CENTER.x * T;
    const py = PRISON_CENTER.y * T;
    g.lineStyle(3, COLOR.prison, pa);
    g.beginPath();
    g.arc(px, py - 4, 7, Math.PI, 0, false);
    g.strokePath();
    g.fillStyle(COLOR.prison, pa);
    g.fillRoundedRect(px - 10, py - 4, 20, 15, 3);
    g.fillStyle(0x0b1622, pa);
    g.fillCircle(px, py + 3, 2.5);
  }
}

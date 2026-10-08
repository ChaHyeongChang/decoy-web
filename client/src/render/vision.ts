// 시야 도형 그리기 (부채꼴, 근접 원, 생존자 시야 원). 좌표는 월드 픽셀.
import type Phaser from 'phaser';
import { TILE_PX, type Vec2 } from '@decoy/shared';

const T = TILE_PX;

/** 다각형 채우기 (점들은 타일 좌표) */
export function fillPolygon(
  g: Phaser.GameObjects.Graphics,
  pts: readonly Vec2[],
  color: number,
  alpha: number,
): void {
  if (pts.length < 3) return;
  g.fillStyle(color, alpha);
  g.beginPath();
  const first = pts[0];
  if (!first) return;
  g.moveTo(first.x * T, first.y * T);
  for (let i = 1; i < pts.length; i += 1) {
    const p = pts[i];
    if (p) g.lineTo(p.x * T, p.y * T);
  }
  g.closePath();
  g.fillPath();
}

/** 다각형 외곽선 */
export function strokePolygon(
  g: Phaser.GameObjects.Graphics,
  pts: readonly Vec2[],
  color: number,
  alpha: number,
  width = 2,
): void {
  if (pts.length < 2) return;
  g.lineStyle(width, color, alpha);
  g.beginPath();
  const first = pts[0];
  if (!first) return;
  g.moveTo(first.x * T, first.y * T);
  for (let i = 1; i < pts.length; i += 1) {
    const p = pts[i];
    if (p) g.lineTo(p.x * T, p.y * T);
  }
  g.closePath();
  g.strokePath();
}

/** 두 색 사이 보간 (0xRRGGBB) */
export function mixColor(a: number, b: number, k: number): number {
  const t = Math.max(0, Math.min(1, k));
  const ar = (a >> 16) & 255;
  const ag = (a >> 8) & 255;
  const ab = a & 255;
  const br = (b >> 16) & 255;
  const bg = (b >> 8) & 255;
  const bb = b & 255;
  const r = Math.round(ar + (br - ar) * t);
  const gg = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (gg << 8) | bl;
}

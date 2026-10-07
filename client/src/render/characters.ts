// 캐릭터 도형 (VISUAL_SPEC 3장). 좌표는 월드 픽셀(1타일 = 32px).
import type Phaser from 'phaser';
import { TILE_PX } from '@decoy/shared';
import { COLOR } from './colors';

const T = TILE_PX;

/** 생존자: 채워진 원(지름 0.6타일) + 진행 방향 작은 삼각 노치 */
export function drawSurvivor(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  face: number,
  color: number,
  alpha = 1,
  outline: number | null = null,
): void {
  const px = x * T;
  const py = y * T;
  const r = 0.3 * T;
  g.fillStyle(color, alpha);
  g.fillCircle(px, py, r);
  if (outline !== null) {
    g.lineStyle(2, outline, alpha);
    g.strokeCircle(px, py, r + 1);
  }
  const tip = r + 5;
  const c = Math.cos(face);
  const s = Math.sin(face);
  g.fillStyle(color, alpha);
  g.fillTriangle(
    px + c * tip,
    py + s * tip,
    px + c * (r - 1) - s * 4,
    py + s * (r - 1) + c * 4,
    px + c * (r - 1) + s * 4,
    py + s * (r - 1) - c * 4,
  );
}

/** 괴물: 후드 실루엣(둥근 삼각형, 높이 0.7타일) + 조준 방향 노치 + 눈 두 개 */
export function drawMonster(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  aim: number,
  alpha = 1,
): void {
  const px = x * T;
  const py = y * T;
  const h = 0.7 * T;
  const w = 0.62 * T;
  // 몸 (후드) — 화면 위쪽이 머리
  g.fillStyle(COLOR.monster, alpha);
  g.fillTriangle(px, py - h / 2, px - w / 2, py + h / 2, px + w / 2, py + h / 2);
  g.fillCircle(px, py - h / 2 + 4, 4);
  g.fillCircle(px - w / 2 + 3, py + h / 2 - 3, 3);
  g.fillCircle(px + w / 2 - 3, py + h / 2 - 3, 3);
  // 얼굴 (어두운 타원)과 눈
  g.fillStyle(0x0b1622, alpha);
  g.fillEllipse(px, py + 2, w * 0.55, h * 0.36);
  g.fillStyle(0xffffff, alpha);
  g.fillCircle(px - 3, py + 2, 1.6);
  g.fillCircle(px + 3, py + 2, 1.6);
  // 조준 노치
  const c = Math.cos(aim);
  const s = Math.sin(aim);
  const r0 = h / 2 + 2;
  const r1 = h / 2 + 9;
  g.fillStyle(COLOR.monster, alpha);
  g.fillTriangle(
    px + c * r1,
    py + s * r1,
    px + c * r0 - s * 5,
    py + s * r0 + c * 5,
    px + c * r0 + s * 5,
    py + s * r0 - c * 5,
  );
}

/** 공격 준비 범위: 전방 arc° · range 타일 부채꼴, 흰색 알파 25% (VISUAL_SPEC 3장) */
export function drawAttackRange(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  dir: number,
  range: number,
  arcDeg: number,
): void {
  const half = (arcDeg * Math.PI) / 360;
  g.fillStyle(0xffffff, 0.25);
  g.slice(x * T, y * T, range * T, dir - half, dir + half, false);
  g.fillPath();
  g.lineStyle(2, 0xffffff, 0.6);
  g.beginPath();
  g.arc(x * T, y * T, range * T, dir - half, dir + half, false);
  g.strokePath();
}

/** 구조 진행 링 (0~1) */
export function drawRescueRing(g: Phaser.GameObjects.Graphics, x: number, y: number, progress: number): void {
  g.lineStyle(3, 0xe2e8f0, 0.35);
  g.strokeCircle(x * T, y * T, 0.55 * T);
  g.lineStyle(3, 0x22d3ee, 0.95);
  g.beginPath();
  g.arc(x * T, y * T, 0.55 * T, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, progress), false);
  g.strokePath();
}

/** 스카우트 탐지: 괴물 위치에 초록 다이아 (안개 위) */
export function drawTrackMark(g: Phaser.GameObjects.Graphics, x: number, y: number, nowMs: number): void {
  const px = x * T;
  const py = y * T;
  const s = 13 + Math.sin(nowMs / 120) * 2;
  g.lineStyle(3, COLOR.scout, 1);
  g.fillStyle(COLOR.scout, 0.25);
  g.beginPath();
  g.moveTo(px, py - s);
  g.lineTo(px + s, py);
  g.lineTo(px, py + s);
  g.lineTo(px - s, py);
  g.closePath();
  g.fillPath();
  g.strokePath();
}

/** 포효한 괴물 위치 (주황 경고 마커, 생존자 화면 1초) */
export function drawRoarMark(g: Phaser.GameObjects.Graphics, x: number, y: number, nowMs: number): void {
  const px = x * T;
  const py = y * T;
  const r = 16 + (nowMs % 400) / 40;
  g.lineStyle(3, COLOR.warn, 0.9);
  g.strokeCircle(px, py, r);
  g.fillStyle(COLOR.warn, 0.9);
  g.fillTriangle(px, py - 10, px - 9, py + 7, px + 9, py + 7);
  g.fillStyle(0x0b1622, 1);
  g.fillRect(px - 1.5, py - 4, 3, 6);
}

/** 포효 핑: 흰 원 펄스 (괴물 화면 1.5초) */
export function drawRoarPing(g: Phaser.GameObjects.Graphics, x: number, y: number, k: number): void {
  const px = x * T;
  const py = y * T;
  const phase = (k * 3) % 1;
  g.lineStyle(2, COLOR.white, 0.9 * (1 - phase));
  g.strokeCircle(px, py, 6 + phase * 22);
  g.fillStyle(COLOR.white, 0.85);
  g.fillCircle(px, py, 4);
}

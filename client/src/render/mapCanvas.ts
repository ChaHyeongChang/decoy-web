// 정적 맵을 한 번만 Canvas2D로 그린다 (바닥, 벽, 기둥, 철창). 매 프레임 다시 그리지 않는다.
// 목표 배율(1타일 = TILE_PX × scale px)로 직접 그린다: 32px로 그린 뒤 줄이면(0.93배) 한 번 더 재샘플되어 흐려진다.
import { MAP_H, MAP_W, PRISON_RECT, TILE_PX, tileAt, type TileKind } from '@decoy/shared';
import { COLOR, hex } from './colors';

function solid(k: TileKind): boolean {
  return k === 'wall' || k === 'pillar' || k === 'exitN' || k === 'exitS';
}

/** 배율 scale로 그린 정적 맵 캔버스 크기 (px) */
export function staticMapSize(scale: number): { w: number; h: number } {
  return {
    w: Math.max(1, Math.round(MAP_W * TILE_PX * scale)),
    h: Math.max(1, Math.round(MAP_H * TILE_PX * scale)),
  };
}

/**
 * 정적 맵. scale = 출력 px / 월드 px (1이면 1타일 32px).
 * 칸 채움은 기기 픽셀 정수 경계로 그려 이웃 칸 사이에 이음선이 생기지 않게 하고, 선은 배율에 맞춰 줄인다.
 */
export function drawStaticMap(scale = 1): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const size = staticMapSize(scale);
  canvas.width = size.w;
  canvas.height = size.h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const T = TILE_PX;
  const k = T * scale;
  ctx.fillStyle = hex(COLOR.floor);
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // 장애물 · 벽 채움 (한 경로로 모아 한 번에 채운다: 칸 경계를 정수 px로 맞춰 이음선 없음)
  ctx.beginPath();
  for (let j = 0; j < MAP_H; j += 1) {
    for (let i = 0; i < MAP_W; i += 1) {
      if (!solid(tileAt(i, j))) continue;
      const x0 = Math.round(i * k);
      const y0 = Math.round(j * k);
      ctx.rect(x0, y0, Math.round((i + 1) * k) - x0, Math.round((j + 1) * k) - y0);
    }
  }
  ctx.fillStyle = hex(COLOR.obstacle);
  ctx.fill();

  // 이하 선은 월드 px 좌표로 그리고 배율을 곱한다 (그림자 흐림은 변환을 따르지 않아 직접 곱한다)
  ctx.scale(scale, scale);

  // 벽 외곽선 (#C8D2DC 2px, 약한 글로우). 기둥(장애물)은 외곽선 없이 채움만
  ctx.save();
  ctx.strokeStyle = hex(COLOR.wallLine);
  ctx.lineWidth = 2;
  ctx.shadowColor = 'rgba(200, 210, 220, 0.55)';
  ctx.shadowBlur = 6 * scale;
  ctx.beginPath();
  for (let j = 0; j < MAP_H; j += 1) {
    for (let i = 0; i < MAP_W; i += 1) {
      const k = tileAt(i, j);
      if (k !== 'wall') continue;
      const open = (a: number, b: number): boolean =>
        !solid(tileAt(a, b)) && a >= 0 && b >= 0 && a < MAP_W && b < MAP_H;
      if (open(i, j - 1)) {
        ctx.moveTo(i * T, j * T + 1);
        ctx.lineTo((i + 1) * T, j * T + 1);
      }
      if (open(i, j + 1)) {
        ctx.moveTo(i * T, (j + 1) * T - 1);
        ctx.lineTo((i + 1) * T, (j + 1) * T - 1);
      }
      if (open(i - 1, j)) {
        ctx.moveTo(i * T + 1, j * T);
        ctx.lineTo(i * T + 1, (j + 1) * T);
      }
      if (open(i + 1, j)) {
        ctx.moveTo((i + 1) * T - 1, j * T);
        ctx.lineTo((i + 1) * T - 1, (j + 1) * T);
      }
    }
  }
  ctx.stroke();
  ctx.restore();

  // 감옥 철창: 철창 타일 고리를 따라 굵은 테두리 + 가로지르는 창살. 문 칸은 점선
  ctx.save();
  ctx.strokeStyle = hex(COLOR.prison);
  ctx.shadowColor = 'rgba(239, 68, 68, 0.6)';
  ctx.shadowBlur = 6 * scale;
  for (let j = PRISON_RECT.y0; j < PRISON_RECT.y1; j += 1) {
    for (let i = PRISON_RECT.x0; i < PRISON_RECT.x1; i += 1) {
      const k = tileAt(i, j);
      if (k !== 'bars' && k !== 'prisonDoor') continue;
      const cx = i * T + T / 2;
      const cy = j * T + T / 2;
      const horizontal = j === PRISON_RECT.y0 || j === PRISON_RECT.y1 - 1;
      if (k === 'prisonDoor') {
        ctx.save();
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.globalAlpha = 0.6;
        ctx.beginPath();
        ctx.moveTo(i * T, cy);
        ctx.lineTo((i + 1) * T, cy);
        ctx.stroke();
        ctx.restore();
        continue;
      }
      ctx.lineWidth = 3;
      ctx.beginPath();
      // 고리 중심선
      if (horizontal) {
        ctx.moveTo(i * T, cy);
        ctx.lineTo((i + 1) * T, cy);
      }
      if (i === PRISON_RECT.x0 || i === PRISON_RECT.x1 - 1) {
        ctx.moveTo(cx, j * T + (j === PRISON_RECT.y0 ? T / 2 : 0));
        ctx.lineTo(cx, (j + 1) * T - (j === PRISON_RECT.y1 - 1 ? T / 2 : 0));
      }
      ctx.stroke();
      // 창살 (고리를 가로지르는 짧은 선)
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let k2 = 6; k2 < T; k2 += 10) {
        if (horizontal) {
          ctx.moveTo(i * T + k2, j * T + 6);
          ctx.lineTo(i * T + k2, (j + 1) * T - 6);
        } else {
          ctx.moveTo(i * T + 6, j * T + k2);
          ctx.lineTo((i + 1) * T - 6, j * T + k2);
        }
      }
      ctx.stroke();
    }
  }
  ctx.restore();
  return canvas;
}

// 거점 · 탈출구 · 감옥 배지의 순수 부분 (DOM · Phaser 없음): 위치 · 상태 색 · 아이콘 · 정보 레이어 항목.
// 그리는 코드는 render/objects.ts(Badges). 배지는 바닥 문양 + 라벨이라 캐릭터 아래 레이어에 그린다(정보 우선 R15).
// 정보 레이어 항목은 품질과 상관없이 같은 값이다(장식 시간 · 맥동 값을 넣지 않는다).
import {
  CAPTURE_POINTS,
  EXITS,
  PRISON_CENTER,
  PRISON_RECT,
  type ExitState,
  type ExitView,
  type InfoItem,
  type PointState,
  type PointView,
} from '@decoy/shared';
import { MAP_COLOR, OBJ_COLOR } from './mapArtGeom';
import { NEON, UI, WARN, blendOver } from './palette';

export interface BadgeAlpha {
  points: Record<'A' | 'B', number>;
  exits: Record<'N' | 'S', number>;
  prison: number;
}

/** 배지 배치 (타일). 그래픽 상수 */
export const BADGE = {
  /** 거점 글자 배지: 패드 중심에서 위로 (가운데 단말 · 서 있는 캐릭터와 겹치지 않게) */
  pointDy: -1.62,
  /** 마름모 반 대각선 */
  pointHalf: 0.42,
  /** 상태 칩: 글자 배지 오른쪽 */
  chipDx: 0.78,
  chipHalf: 0.21,
  /** 탈출구 표지판 (문 가운데) */
  exitW: 0.78,
  exitH: 0.62,
  /** 감옥 자물쇠 판 */
  lockW: 0.5,
  lockH: 0.6,
  /** 알파를 미리 섞을 어두운 바닥색 (겹친 선이 진해지지 않게 불투명하게 그린다) */
  backdrop: 0x070b11,
  /** 괴물 화면 점령 중 깜빡임 알파 */
  blinkAlpha: 0.25,
} as const;

/** 탈출구 표지판 자리: 문 오른쪽 문틀 칸 가운데 (문짝 · 미닫이 연출을 가리지 않게) */
export function exitSignAt(id: 'N' | 'S'): { x: number; y: number } {
  const d = EXITS[id].door;
  return { x: d.x1 + 0.5, y: (d.y0 + d.y1) / 2 };
}

/** 감옥 자물쇠 배지 자리: 남쪽 문 칸 가운데 (수감자가 서는 감옥 안쪽을 덮지 않는다) */
export const PRISON_LOCK = {
  x: (PRISON_RECT.x0 + PRISON_RECT.x1) / 2,
  y: PRISON_RECT.y1 - 0.5,
} as const;

/** 감옥 배지 색 (감옥 철창과 같은 빨강. 괴물 몸 #EF4444와 같은 값은 맵에 쓰지 않는다) */
export const PRISON_COLOR = MAP_COLOR.bar;

export type PointIcon = 'play' | 'pause' | 'check';

/** 거점 상태 색 (색만으로 구분하지 않게 아이콘과 같이 쓴다) */
export function pointColor(s: PointState): number {
  if (s === 'blocked') return WARN;
  if (s === 'idle') return UI.textDim;
  return NEON;
}

/** 거점 상태 아이콘: 점령 중 ▶ · 정지 ‖ · 완료 ✓ · 대기 없음 */
export function pointIcon(s: PointState): PointIcon | null {
  if (s === 'capturing') return 'play';
  if (s === 'blocked') return 'pause';
  if (s === 'done') return 'check';
  return null;
}

export function exitColor(s: ExitState): number {
  return s === 'inactive' ? OBJ_COLOR.off : OBJ_COLOR.go;
}

/** 거점 배지 알파: 괴물 화면 점령 중 깜빡임이면 0.25, 아니면 보이는 곳 1 / 안 보이는 곳 0.45 */
export function pointBadgeAlpha(id: 'A' | 'B', alpha: BadgeAlpha, blink: Record<'A' | 'B', boolean>): number {
  return blink[id] ? BADGE.blinkAlpha : alpha.points[id];
}

/** 알파 a로 어두운 바닥 위에 그린 것과 같은 불투명 색 */
export function dimmed(color: number, a: number): number {
  return blendOver(color, BADGE.backdrop, Math.max(0, Math.min(1, a)));
}

function item(
  kind: InfoItem['kind'],
  tag: string,
  x: number,
  y: number,
  r: number | null,
  value: InfoItem['value'],
  color: number,
  alpha: number,
): InfoItem {
  return { kind, tag, x, y, r, dir: null, arc: null, value, color, alpha };
}

/**
 * 배지 정보 레이어: 거점 배지 2 · 탈출구 배지 2 · 감옥 배지 1 + 진행(거점 2, 탈출구는 progress가 null이 아닐 때만).
 * 좌표는 판정 중심(타일), r = 판정 반경(바닥에 실제로 그린 값), value = 상태, color · alpha = 그린 주 색 · 알파
 */
export function badgeInfo(
  points: readonly PointView[],
  exits: readonly ExitView[],
  alpha: BadgeAlpha,
  blink: Record<'A' | 'B', boolean>,
  radii: { point: number | null; exit: number | null },
): InfoItem[] {
  const out: InfoItem[] = [];
  for (const p of points) {
    const c = CAPTURE_POINTS[p.id];
    const a = pointBadgeAlpha(p.id, alpha, blink);
    out.push(item('badge', `point-${p.id}`, c.x, c.y, radii.point, p.state, pointColor(p.state), a));
    out.push(
      item(
        'progress',
        `point-${p.id}`,
        c.x,
        c.y,
        radii.point,
        Math.max(0, Math.min(1, p.progress)),
        p.state === 'blocked' ? WARN : NEON,
        1,
      ),
    );
  }
  for (const e of exits) {
    const c = EXITS[e.id].center;
    const a = alpha.exits[e.id];
    out.push(item('badge', `exit-${e.id}`, c.x, c.y, radii.exit, e.state, exitColor(e.state), a));
    if (e.progress !== null)
      out.push(
        item(
          'progress',
          `exit-${e.id}`,
          c.x,
          c.y,
          radii.exit,
          Math.max(0, Math.min(1, e.progress)),
          OBJ_COLOR.gauge,
          1,
        ),
      );
  }
  out.push(item('badge', 'prison', PRISON_CENTER.x, PRISON_CENTER.y, null, null, PRISON_COLOR, alpha.prison));
  return out;
}

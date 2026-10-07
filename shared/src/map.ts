// 48×32 타일 맵과 구역 · 스폰 · 거점 · 탈출구 좌표 (GAME_DESIGN 10장).
// 좌표는 연속 타일 좌표: 맵 왼쪽 위가 (0,0), 타일 (i,j)는 [i, i+1) × [j, j+1). 픽셀 = 좌표 × 32.
//
// 문자 의미
//   #  벽 (이동 · 시야 차단)          o  장애물 · 기둥 (이동 · 시야 차단)
//   .  바닥                            B  감옥 철창 (이동 차단, 시야 통과)
//   D  감옥 문 (수감된 생존자만 차단, 시야 통과)
//   N  북쪽 탈출구 문 (외벽. 열리면 자유 생존자만 통과)   S  남쪽 탈출구 문
import type { Vec2 } from './geometry';

export const MAP_W = 48;
export const MAP_H = 32;
export const TILE_PX = 32;

export const MAP_ROWS: readonly string[] = [
  '#######################NN#######################',
  '#..............#...............................#',
  '#..............#...............................#',
  '#..............#####........####..........##...#',
  '#.....oooo.....#####........####...oooo...##...#',
  '#.....oooo.....#####........####...oooo...##...#',
  '#.....oooo.....#.......oo..........oooo...##...#',
  '#.....oooo.....#.......oo......................#',
  '#..............#...##......##..................#',
  '#..................##......##....######...######',
  '#..................##......##....#.............#',
  '#..####..####......##......##....#.............#',
  '#..#........#....................#.............#',
  '#...........#..##................#.............#',
  '#...........#..##.....BBBB.....................#',
  '#..#........#.........B..B.................oo..#',
  '#..#..................B..B.................oo..#',
  '#..#..................BDDB.....................#',
  '#..#........#..##..............................#',
  '#..#........#..##................#.............#',
  '#..#........#......##......##....#.............#',
  '#..##..######......##......##....#.............#',
  '#..................##......##....#.............#',
  '#..................##......##....#####...#######',
  '#......................oo......................#',
  '#......oo...##.........oo......................#',
  '#......oo...##..####........####....oo.........#',
  '#...........##..####........####....oo...##....#',
  '#...........##..####........####.........##....#',
  '#...........##...........................##....#',
  '#...........##...........................##....#',
  '#######################SS#######################',
];

export type TileKind = 'floor' | 'wall' | 'pillar' | 'bars' | 'prisonDoor' | 'exitN' | 'exitS';

const CHAR_KIND: Record<string, TileKind> = {
  '.': 'floor',
  '#': 'wall',
  o: 'pillar',
  B: 'bars',
  D: 'prisonDoor',
  N: 'exitN',
  S: 'exitS',
};

export type ExitId = 'N' | 'S';
export type PointId = 'A' | 'B';

/** 지점 좌표 */
export const PRISON_CENTER: Vec2 = { x: 24, y: 16 };
/** 감옥 철창 바깥 경계 (타일 22–25 × 14–17) */
export const PRISON_RECT = { x0: 22, y0: 14, x1: 26, y1: 18 } as const;
/** 감옥 문 바깥 중심 (구조 구역 중심) */
export const RESCUE_POINT: Vec2 = { x: 24, y: 18.5 };
/** 판 시작 · 수감 위치 (감옥 안 2×2) */
export const PRISON_SLOTS: readonly Vec2[] = [
  { x: 23.5, y: 15.5 },
  { x: 24.5, y: 15.5 },
  { x: 24, y: 16.5 },
];
/** 풀려난 생존자가 놓이는 문 바로 바깥 */
export const RELEASE_SLOTS: readonly Vec2[] = [
  { x: 23, y: 18.7 },
  { x: 24, y: 19.2 },
  { x: 25, y: 18.7 },
];
export const MONSTER_SPAWN: Vec2 = { x: 45, y: 28 };

export const CAPTURE_POINTS: Readonly<Record<PointId, Vec2>> = {
  A: { x: 8, y: 16 },
  B: { x: 40, y: 16 },
};

export interface ExitDef {
  id: ExitId;
  /** 개방 판정 원 중심 */
  center: Vec2;
  /** 문 칸 (외벽). 열리면 통과 가능, 몸 중심이 들어가면 탈출 */
  door: { x0: number; y0: number; x1: number; y1: number };
  name: string;
}

export const EXITS: Readonly<Record<ExitId, ExitDef>> = {
  N: { id: 'N', center: { x: 24, y: 1.5 }, door: { x0: 23, y0: 0, x1: 25, y1: 1 }, name: '북' },
  S: { id: 'S', center: { x: 24, y: 30.5 }, door: { x0: 23, y0: 31, x1: 25, y1: 32 }, name: '남' },
};

/** 구역 (기둥 배치 검증 · 봇 경로용) */
export const ZONES = {
  left: { x0: 0, y0: 0, x1: 16, y1: 32 },
  right: { x0: 32, y0: 0, x1: 48, y1: 32 },
  north: { x0: 16, y0: 0, x1: 32, y1: 12 },
  south: { x0: 16, y0: 20, x1: 32, y1: 32 },
  center: { x0: 16, y0: 12, x1: 32, y1: 20 },
} as const;

const KINDS: TileKind[] = [];
for (let j = 0; j < MAP_H; j += 1) {
  const row = MAP_ROWS[j] ?? '';
  for (let i = 0; i < MAP_W; i += 1) KINDS.push(CHAR_KIND[row[i] ?? '#'] ?? 'wall');
}

export function tileAt(i: number, j: number): TileKind {
  if (i < 0 || j < 0 || i >= MAP_W || j >= MAP_H) return 'wall';
  return KINDS[j * MAP_W + i] ?? 'wall';
}

/** 시야를 막는가: 벽 · 기둥 · 외벽 문. 철창과 감옥 문은 시야를 통과시킨다 */
export function blocksVision(i: number, j: number): boolean {
  const k = tileAt(i, j);
  return k === 'wall' || k === 'pillar' || k === 'exitN' || k === 'exitS';
}

/** 이동하는 쪽의 조건 */
export interface MoverContext {
  kind: 'survivor' | 'monster';
  imprisoned: boolean;
  openExits: Readonly<Record<ExitId, boolean>>;
}

/** 이 이동 주체에게 타일이 막혀 있는가 */
export function blocksMove(i: number, j: number, ctx: MoverContext): boolean {
  const k = tileAt(i, j);
  switch (k) {
    case 'floor':
      return false;
    case 'prisonDoor':
      return ctx.kind === 'survivor' && ctx.imprisoned;
    case 'exitN':
      return !(ctx.kind === 'survivor' && !ctx.imprisoned && ctx.openExits.N);
    case 'exitS':
      return !(ctx.kind === 'survivor' && !ctx.imprisoned && ctx.openExits.S);
    default:
      return true;
  }
}

/** 공격 · 밀치기 판정선: 이동을 막는 정적 타일(문 상태 무관하게 철창 포함) */
export function blocksStrike(i: number, j: number): boolean {
  const k = tileAt(i, j);
  return k !== 'floor' && k !== 'prisonDoor';
}

/** 시야 다각형 계산용: 시야 차단 타일의 모서리 점들 (바닥과 맞닿은 모서리만) */
export const VISION_CORNERS: readonly Vec2[] = (() => {
  const set = new Set<string>();
  const out: Vec2[] = [];
  for (let j = 0; j < MAP_H; j += 1) {
    for (let i = 0; i < MAP_W; i += 1) {
      if (!blocksVision(i, j)) continue;
      const exposed =
        !blocksVision(i - 1, j) ||
        !blocksVision(i + 1, j) ||
        !blocksVision(i, j - 1) ||
        !blocksVision(i, j + 1);
      if (!exposed) continue;
      for (const [cx, cy] of [
        [i, j],
        [i + 1, j],
        [i, j + 1],
        [i + 1, j + 1],
      ] as const) {
        const key = `${cx},${cy}`;
        if (set.has(key)) continue;
        set.add(key);
        out.push({ x: cx, y: cy });
      }
    }
  }
  return out;
})();

/** 점이 사각형 안에 있는가 */
export function inRect(p: Vec2, r: { x0: number; y0: number; x1: number; y1: number }): boolean {
  return p.x >= r.x0 && p.x < r.x1 && p.y >= r.y0 && p.y < r.y1;
}

/** 점에서 사각형까지 최단 거리 (안이면 0) */
export function distToRect(p: Vec2, r: { x0: number; y0: number; x1: number; y1: number }): number {
  const dx = Math.max(r.x0 - p.x, 0, p.x - r.x1);
  const dy = Math.max(r.y0 - p.y, 0, p.y - r.y1);
  return Math.hypot(dx, dy);
}

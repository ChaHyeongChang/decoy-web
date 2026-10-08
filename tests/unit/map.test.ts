import { describe, expect, it } from 'vitest';
import {
  CAPTURE_POINTS,
  EXITS,
  MAP_H,
  MAP_ROWS,
  MAP_W,
  MONSTER_SPAWN,
  PRISON_RECT,
  PRISON_SLOTS,
  RELEASE_SLOTS,
  RELEASE_SPARES,
  RESCUE_POINT,
  ZONES,
  blocksMove,
  blocksVision,
  tileAt,
  tilePenetration,
  type MoverContext,
} from '@decoy/shared';
import { loadTestBalance } from '../helpers/fixtures';

const balance = loadTestBalance();
const free: MoverContext = { kind: 'survivor', imprisoned: false, openExits: { N: false, S: false } };
const passable = (i: number, j: number): boolean => !blocksMove(i, j, free);

describe('맵 (GAME_DESIGN 10장)', () => {
  it('48×32 타일이고 외곽은 막혀 있다', () => {
    expect(MAP_ROWS).toHaveLength(MAP_H);
    for (const row of MAP_ROWS) expect(row).toHaveLength(MAP_W);
    for (let i = 0; i < MAP_W; i += 1) {
      expect(passable(i, 0)).toBe(false);
      expect(passable(i, MAP_H - 1)).toBe(false);
    }
    for (let j = 0; j < MAP_H; j += 1) {
      expect(passable(0, j)).toBe(false);
      expect(passable(MAP_W - 1, j)).toBe(false);
    }
  });

  it('모든 바닥이 하나로 이어져 있다', () => {
    const cells: [number, number][] = [];
    for (let j = 0; j < MAP_H; j += 1)
      for (let i = 0; i < MAP_W; i += 1) if (passable(i, j)) cells.push([i, j]);
    const seen = new Set<string>([cells[0]!.join()]);
    const stack = [cells[0]!];
    while (stack.length) {
      const [x, y] = stack.pop()!;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const k = `${x + dx},${y + dy}`;
        if (passable(x + dx, y + dy) && !seen.has(k)) {
          seen.add(k);
          stack.push([x + dx, y + dy]);
        }
      }
    }
    expect(seen.size).toBe(cells.length);
  });

  it('통로 폭은 최소 2타일 (모든 바닥이 2×2 바닥 블록에 속한다)', () => {
    const bad: string[] = [];
    for (let j = 0; j < MAP_H; j += 1) {
      for (let i = 0; i < MAP_W; i += 1) {
        if (!passable(i, j)) continue;
        let ok = false;
        for (const ox of [0, -1])
          for (const oy of [0, -1]) {
            if (
              passable(i + ox, j + oy) &&
              passable(i + ox + 1, j + oy) &&
              passable(i + ox, j + oy + 1) &&
              passable(i + ox + 1, j + oy + 1)
            )
              ok = true;
          }
        if (!ok) bad.push(`${i},${j}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('거점 · 탈출구 · 구조 구역 · 스폰이 바닥 위에 있다', () => {
    const r = balance.capturePoint.radius;
    for (const p of Object.values(CAPTURE_POINTS)) {
      for (let j = 0; j < MAP_H; j += 1)
        for (let i = 0; i < MAP_W; i += 1) {
          if (Math.hypot(i + 0.5 - p.x, j + 0.5 - p.y) <= r) expect(passable(i, j)).toBe(true);
        }
    }
    for (const e of Object.values(EXITS)) {
      for (let j = 0; j < MAP_H; j += 1)
        for (let i = 0; i < MAP_W; i += 1) {
          if (Math.hypot(i + 0.5 - e.center.x, j + 0.5 - e.center.y) <= balance.exit.radius) {
            expect(passable(i, j) || tileAt(i, j) === 'exitN' || tileAt(i, j) === 'exitS').toBe(true);
          }
        }
    }
    for (const p of [MONSTER_SPAWN, RESCUE_POINT, ...PRISON_SLOTS, ...RELEASE_SLOTS, ...RELEASE_SPARES]) {
      expect(passable(Math.floor(p.x), Math.floor(p.y))).toBe(true);
    }
    // 풀려나는 자리는 생존자 몸이 벽 · 철창에 겹치지 않고, 감옥 바깥이다
    for (const p of [...RELEASE_SLOTS, ...RELEASE_SPARES]) {
      expect(tilePenetration(p, balance.survivor.radius, (i, j) => !passable(i, j))).toBe(0);
      expect(p.y).toBeGreaterThan(PRISON_RECT.y1);
    }
  });

  it('두 탈출구는 대칭이고 멀리 떨어져 있다', () => {
    expect(EXITS.N.center.x).toBe(EXITS.S.center.x);
    expect(EXITS.N.center.y - 1).toBeCloseTo(MAP_H - 1 - EXITS.S.center.y);
    expect(EXITS.S.center.y - EXITS.N.center.y).toBeGreaterThan(25);
  });

  it('구역마다 한 바퀴 돌 수 있는 기둥이 1개 이상 있다', () => {
    const solid = (i: number, j: number): boolean =>
      i >= 0 && j >= 0 && i < MAP_W && j < MAP_H && !passable(i, j) && tileAt(i, j) !== 'prisonDoor';
    const seen = new Set<string>();
    const loops: { cx: number; cy: number }[] = [];
    for (let j = 1; j < MAP_H - 1; j += 1)
      for (let i = 1; i < MAP_W - 1; i += 1) {
        if (!solid(i, j) || seen.has(`${i},${j}`)) continue;
        const comp: [number, number][] = [];
        const st: [number, number][] = [[i, j]];
        seen.add(`${i},${j}`);
        while (st.length) {
          const [x, y] = st.pop()!;
          comp.push([x, y]);
          for (const [dx, dy] of [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ] as const) {
            const k = `${x + dx},${y + dy}`;
            if (solid(x + dx, y + dy) && !seen.has(k)) {
              seen.add(k);
              st.push([x + dx, y + dy]);
            }
          }
        }
        if (comp.some(([x, y]) => x === 0 || y === 0 || x === MAP_W - 1 || y === MAP_H - 1)) continue;
        const set = new Set(comp.map((c) => c.join()));
        let ringFloor = true;
        for (const [x, y] of comp)
          for (let dx = -1; dx <= 1; dx += 1)
            for (let dy = -1; dy <= 1; dy += 1) {
              if (!set.has(`${x + dx},${y + dy}`) && !passable(x + dx, y + dy)) ringFloor = false;
            }
        if (ringFloor) {
          const cx = comp.reduce((a, c) => a + c[0], 0) / comp.length + 0.5;
          const cy = comp.reduce((a, c) => a + c[1], 0) / comp.length + 0.5;
          loops.push({ cx, cy });
        }
      }
    for (const [name, z] of Object.entries(ZONES)) {
      const has = loops.some((l) => l.cx >= z.x0 && l.cx < z.x1 && l.cy >= z.y0 && l.cy < z.y1);
      expect(has, `${name} 구역에 기둥 없음`).toBe(true);
    }
  });

  it('감옥: 4×4 철창, 남쪽 문 2칸, 철창은 이동만 막고 시야는 통과', () => {
    expect(PRISON_RECT.x1 - PRISON_RECT.x0).toBe(4);
    expect(PRISON_RECT.y1 - PRISON_RECT.y0).toBe(4);
    const doors: number[] = [];
    for (let i = PRISON_RECT.x0; i < PRISON_RECT.x1; i += 1)
      if (tileAt(i, PRISON_RECT.y1 - 1) === 'prisonDoor') doors.push(i);
    expect(doors).toHaveLength(2);
    expect(tileAt(PRISON_RECT.x0, PRISON_RECT.y0)).toBe('bars');
    expect(blocksVision(PRISON_RECT.x0, PRISON_RECT.y0)).toBe(false);
    expect(passable(PRISON_RECT.x0, PRISON_RECT.y0)).toBe(false);
    const door = doors[0]!;
    // 문은 수감된 생존자만 막는다
    expect(blocksMove(door, PRISON_RECT.y1 - 1, free)).toBe(false);
    expect(blocksMove(door, PRISON_RECT.y1 - 1, { ...free, imprisoned: true })).toBe(true);
    expect(blocksMove(door, PRISON_RECT.y1 - 1, { ...free, kind: 'monster' })).toBe(false);
  });

  it('탈출구 문은 열리면 자유 생존자만 통과한다', () => {
    const open = { N: true, S: false };
    expect(blocksMove(23, 0, free)).toBe(true);
    expect(blocksMove(23, 0, { ...free, openExits: open })).toBe(false);
    expect(blocksMove(23, 0, { kind: 'monster', imprisoned: false, openExits: open })).toBe(true);
    expect(blocksMove(23, 31, { ...free, openExits: open })).toBe(true);
  });
});

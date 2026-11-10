import { describe, expect, it } from 'vitest';
import { AliasBook, buildSnapshot, computeVisibility } from '@decoy/shared/sim';
import { newGame } from '../helpers/fixtures';

function place(game: ReturnType<typeof newGame>, id: string, x: number, y: number, face = 0): void {
  const p = game.players.get(id)!;
  p.move.x = x;
  p.move.y = y;
  p.move.face = face;
}

function snaps(game: ReturnType<typeof newGame>, aliases = new AliasBook()) {
  const facts = computeVisibility(game);
  aliases.update(facts.monsterSees);
  const out = new Map<string, ReturnType<typeof buildSnapshot>>();
  for (const id of game.players.keys()) out.set(id, buildSnapshot(game, id, 0, facts, aliases));
  return { facts, out, aliases };
}

describe('정보 차단 (shared/src/sim/interest.ts)', () => {
  it('괴물에게는 부채꼴 · 근접 원 안 생존자만, 임시 ID로, 역할 없이 간다', () => {
    const game = newGame();
    // 괴물 (30,18.5) 동쪽을 봄. p2는 앞 3타일(보임), p3은 등 뒤 4타일(안 보임), p4는 등 뒤 1타일(근접 원)
    place(game, 'p1', 30, 18.5, 0);
    place(game, 'p2', 33, 18.5);
    place(game, 'p3', 26, 18.5);
    place(game, 'p4', 29, 18.5);
    const { out } = snaps(game);
    const m = out.get('p1')!;
    expect(m.survivors).toHaveLength(2);
    const xs = m.survivors.map((s) => s.x).sort();
    expect(xs).toEqual([29, 33]);
    for (const s of m.survivors) {
      expect(s.role).toBeNull();
      expect(['p2', 'p3', 'p4']).not.toContain(s.id);
      expect(s.hp).toBeNull();
      expect(s.imprisonCount).toBeNull();
    }
    expect(JSON.stringify(m)).not.toContain('"p3"');
    expect(JSON.stringify(m)).not.toContain('runner');
  });

  it('벽 뒤 생존자는 부채꼴 안이어도 괴물에게 가지 않는다', () => {
    const game = newGame();
    place(game, 'p1', 17.5, 9.5, 0); // 동쪽 벽(19–20)을 봄
    place(game, 'p2', 22, 9.5);
    const { out } = snaps(game);
    expect(out.get('p1')!.survivors).toHaveLength(0);
  });

  it('생존자에게는 시야 합집합 밖 괴물이 가지 않고, 안이면 부채꼴 정보와 함께 간다', () => {
    const game = newGame();
    place(game, 'p1', 40, 16, Math.PI);
    place(game, 'p2', 8, 16);
    place(game, 'p3', 8, 17);
    place(game, 'p4', 24, 20);
    let r = snaps(game);
    for (const id of ['p2', 'p3', 'p4']) {
      expect(r.out.get(id)!.monster).toBeNull();
      expect(r.out.get(id)!.survivors).toHaveLength(2); // 팀원은 항상
    }
    // 스카우트(7.5타일)만 볼 수 있는 거리
    place(game, 'p4', 33, 16);
    r = snaps(game);
    expect(r.facts.survivorsSeeMonster).toBe(true);
    expect(r.out.get('p2')!.monster).not.toBeNull();
    expect(r.out.get('p2')!.monster!.aim).toBeCloseTo(Math.PI, 3);
  });

  it('발각: 괴물에게 보이는 생존자는 본인 스냅샷에 spotted, 부채꼴은 빨강(seesSomeone)', () => {
    const game = newGame();
    place(game, 'p1', 30, 18.5, 0);
    place(game, 'p2', 33, 18.5);
    place(game, 'p3', 26, 18.5);
    place(game, 'p4', 8, 16);
    const { out } = snaps(game);
    expect(out.get('p2')!.you.surv!.spotted).toBe(true);
    expect(out.get('p3')!.you.surv!.spotted).toBe(false);
    expect(out.get('p3')!.monster!.seesSomeone).toBe(true);
  });

  it('팀원 스냅샷에는 다른 생존자의 발각 값이 없다 (괴물이 안 보일 때 괴물 조준 정보가 새지 않게)', () => {
    const game = newGame();
    // 괴물 (30,18.5) 추적 모드(9타일)로 동쪽, 러너는 8타일 앞 (러너 시야 6타일 밖)
    place(game, 'p1', 30, 18.5, 0);
    game.monster.mode = 'hunt';
    game.monster.blend = 1;
    place(game, 'p2', 38, 18.5);
    place(game, 'p3', 8, 16);
    place(game, 'p4', 8, 17);
    const { out, facts } = snaps(game);
    expect(facts.survivorsSeeMonster).toBe(false);
    expect(out.get('p2')!.you.surv!.spotted).toBe(true);
    const guard = out.get('p3')!;
    expect(guard.monster).toBeNull();
    for (const s of guard.survivors) expect(s.spotted).toBeNull();
  });

  it('괴물 스냅샷의 생존자 배열 순서는 자리(입장) 순서와 무관하다', () => {
    const game = newGame();
    place(game, 'p1', 30, 18.5, 0);
    place(game, 'p2', 34, 18.5);
    place(game, 'p3', 33, 19);
    place(game, 'p4', 32, 18);
    const who = (x: number): string => (x === 34 ? 'p2' : x === 33 ? 'p3' : 'p4');
    const orders = new Set<string>();
    for (let k = 0; k < 30; k += 1) {
      const { out } = snaps(game, new AliasBook());
      const list = out.get('p1')!.survivors;
      expect(list).toHaveLength(3);
      // 임시 ID 순으로 정렬되어 있다
      const ids = list.map((s) => s.id);
      expect(ids).toEqual([...ids].sort());
      orders.add(list.map((s) => who(s.x)).join(','));
    }
    // 임시 ID가 바뀔 때마다 순서도 바뀐다 (자리 순서 p2,p3,p4에 고정되지 않음)
    expect(orders.size).toBeGreaterThan(1);
  });

  it('임시 ID는 계속 보이는 동안 유지되고, 시야를 벗어났다 돌아오면 바뀐다', () => {
    const game = newGame();
    const aliases = new AliasBook();
    place(game, 'p1', 30, 18.5, 0);
    place(game, 'p2', 33, 18.5);
    place(game, 'p3', 8, 16);
    place(game, 'p4', 8, 17);
    const a1 = snaps(game, aliases).out.get('p1')!.survivors[0]!.id;
    place(game, 'p2', 33.2, 18.5);
    const a2 = snaps(game, aliases).out.get('p1')!.survivors[0]!.id;
    expect(a2).toBe(a1);
    place(game, 'p2', 26, 18.5);
    expect(snaps(game, aliases).out.get('p1')!.survivors).toHaveLength(0);
    place(game, 'p2', 33, 18.5);
    const a3 = snaps(game, aliases).out.get('p1')!.survivors[0]!.id;
    expect(a3).not.toBe(a1);
  });

  it('능력 노출 창에만 괴물에게 역할이 간다', () => {
    const game = newGame();
    place(game, 'p1', 30, 18.5, 0);
    place(game, 'p2', 33, 18.5);
    game.survivorById('p2')!.revealLeft = 0.5;
    expect(snaps(game).out.get('p1')!.survivors[0]!.role).toBe('runner');
    game.survivorById('p2')!.revealLeft = 0;
    expect(snaps(game).out.get('p1')!.survivors[0]!.role).toBeNull();
  });

  it('괴물 상태 목록은 익명이고 심각도 순, 탈출구 진행도는 괴물에게 null', () => {
    const game = newGame();
    game.survivorById('p3')!.status = 'imprisoned';
    game.survivorById('p3')!.imprisonCount = 1;
    game.survivorById('p4')!.hp = 1;
    const { out } = snaps(game);
    const w = out.get('p1')!.world;
    expect(w.statusList).toEqual([
      { state: 'imprisoned', imprisonCount: 1 },
      { state: 'injured', imprisonCount: 0 },
      { state: 'normal', imprisonCount: 0 },
    ]);
    expect(w.exits.every((e) => e.progress === null)).toBe(true);
    expect(out.get('p2')!.world.statusList).toBeNull();
    expect(out.get('p2')!.world.exits.every((e) => e.progress !== null)).toBe(true);
  });

  it('거점 게이지는 공통 정보: 괴물과 생존자의 world.points가 같다 (진행 · 상태 — HUD 진행 숫자가 기대는 값, 괴물에게 숨기는 것은 탈출구 진행뿐)', () => {
    // 플레이테스트 a-7: HUD가 거점 진행을 정수 %로 보인다. 괴물 화면 숫자가 새 정보가 아니려면 서버가 보내는 거점 값이
    // 받는 사람과 무관하게 같아야 한다 — 누가 괴물용 값만 바꾸면(흐리게 · 늦게 · 숨김) 이 시험이 먼저 알린다
    const game = newGame();
    const cap = game.balance.capturePoint.captureTime;
    const [a, b] = game.points;
    if (!a || !b) throw new Error('거점이 둘 이상이어야 한다');
    // 네 상태를 모두 거친다: 대기(멈춘 진행) · 점령 중 · 정지 · 완료. 진행 값은 소수 4자리로 반올림되는 값 · 끝자리 값
    const scenes: [string, () => void][] = [
      ['대기 0', () => undefined],
      [
        '대기 · 멈춘 진행 + 점령 중',
        () => {
          a.progress = cap * 0.123456;
          b.progress = cap * 0.6299;
          b.capturing = true;
        },
      ],
      [
        '정지 + 완료 직전',
        () => {
          a.blocked = true;
          b.progress = cap - game.dt;
        },
      ],
      [
        '완료',
        () => {
          a.blocked = false;
          a.done = true;
          a.progress = cap;
        },
      ],
    ];
    const seen = new Set<string>();
    for (const [name, change] of scenes) {
      change();
      const { out } = snaps(game);
      const monster = out.get('p1')!.world;
      expect(
        monster.points.map((p) => p.id),
        name,
      ).toEqual(game.points.map((p) => p.id));
      for (const id of ['p2', 'p3', 'p4']) {
        const mine = out.get(id)!.world;
        // 값이 같을 뿐 아니라 보낸 글자도 같다 (칸이 더 있거나 빠지지 않는다)
        expect(mine.points, `${name} ${id}`).toEqual(monster.points);
        expect(JSON.stringify(mine.points), `${name} ${id}`).toBe(JSON.stringify(monster.points));
      }
      for (const p of monster.points) {
        seen.add(p.state);
        expect(Object.keys(p).sort()).toEqual(['id', 'progress', 'state']);
        const src = game.points.find((q) => q.id === p.id)!;
        // 진행 비율 그대로 (소수 4자리) — 괴물용으로 뭉개지 않는다
        expect(p.progress, `${name} ${p.id}`).toBeCloseTo(src.progress / cap, 4);
      }
    }
    expect([...seen].sort()).toEqual(['blocked', 'capturing', 'done', 'idle']);
    // 괴물에게만 숨기는 것은 그대로 탈출구 진행뿐이다
    const { out } = snaps(game);
    expect(out.get('p1')!.world.exits.every((e) => e.progress === null)).toBe(true);
    expect(out.get('p2')!.world.exits.every((e) => e.progress !== null)).toBe(true);
  });

  it('수감 중 생존자의 시야도 합집합에 들어간다 (철창은 시야를 막지 않는다)', () => {
    const game = newGame();
    for (const id of ['p2', 'p3', 'p4']) game.survivorById(id)!.status = 'imprisoned';
    place(game, 'p2', 24, 16);
    place(game, 'p3', 24, 16);
    place(game, 'p4', 24, 16);
    place(game, 'p1', 24, 21, -Math.PI / 2);
    expect(snaps(game).out.get('p2')!.monster).not.toBeNull();
  });
});

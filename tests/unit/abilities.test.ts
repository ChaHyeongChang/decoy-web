import { describe, expect, it } from 'vitest';
import { BTN } from '@decoy/shared';
import { AliasBook, buildSnapshot, computeVisibility } from '@decoy/shared/sim';
import { Driver, place, readyGame } from '../helpers/fixtures';

const SPACE = { pressed: BTN.ABILITY };

describe('괴물 돌진 (GAME_DESIGN 5.2)', () => {
  it('조준 방향으로 0.25초 동안 4타일, 쿨 12초', () => {
    const game = readyGame();
    const d = new Driver(game);
    place(game, 'p1', 20, 18.5, 0);
    d.run(1, { p1: [0, 0, { pressed: BTN.DASH, aim: 0 }] });
    d.run(d.seconds(0.3), { p1: [0, 0, { aim: 0 }] });
    expect(game.monster.move.x - 20).toBeCloseTo(game.balance.monster.dash.distance, 3);
    expect(game.monster.dashCd).toBeGreaterThan(11.5);
    const x = game.monster.move.x;
    d.run(1, { p1: [0, 0, { pressed: BTN.DASH, aim: 0 }] });
    d.run(5);
    expect(game.monster.move.x).toBeCloseTo(x, 6);
  });

  it('벽에 닿으면 멈추고, 생존자 몸에 닿아도 멈춘다', () => {
    const game = readyGame();
    const d = new Driver(game);
    place(game, 'p1', 17.4, 9.5, 0); // 동쪽 1.6타일 앞 벽(19)
    d.run(1, { p1: [0, 0, { pressed: BTN.DASH, aim: 0 }] });
    d.run(10, { p1: [0, 0, { aim: 0 }] });
    expect(game.monster.move.x).toBeCloseTo(19 - game.balance.monster.radius, 3);
    expect(game.monster.move.dash).toBe(0);
    game.monster.dashCd = 0;
    place(game, 'p1', 20, 18.5, 0);
    place(game, 'p2', 22, 18.5);
    d.run(1, { p1: [0, 0, { pressed: BTN.DASH, aim: 0 }] });
    d.run(10, { p1: [0, 0, { aim: 0 }] });
    expect(game.monster.move.x).toBeLessThan(
      22 - game.balance.monster.radius - game.balance.survivor.radius + 0.01,
    );
  });

  it('공격 준비 중에는 돌진할 수 없다', () => {
    const game = readyGame();
    const d = new Driver(game);
    place(game, 'p1', 20, 18.5, 0);
    d.run(1, { p1: [0, 0, { pressed: BTN.ATTACK }] });
    d.run(1, { p1: [0, 0, { pressed: BTN.DASH }] });
    expect(game.monster.move.dash).toBe(0);
  });
});

describe('괴물 포효 (GAME_DESIGN 5.3)', () => {
  it('반경 10 안 생존자 위치를 괴물에게(벽 무시, ID 없이), 생존자에게는 괴물 위치 1초 + 경고, 쿨 30초', () => {
    const game = readyGame();
    const d = new Driver(game);
    place(game, 'p1', 20, 18.5, 0);
    place(game, 'p2', 27, 18.5); // 7타일 (생존자 시야 6 밖, 포효 10 안)
    place(game, 'p3', 8, 16); // 12타일 넘음
    place(game, 'p4', 22, 9.5); // 벽 너머 9.2타일
    d.run(1, { p1: [0, 0, { pressed: BTN.ROAR }] });
    const ev = game.drainOutbox('p1').find((e) => e.k === 'roarPings');
    expect(ev && ev.k === 'roarPings' && ev.pts.length).toBe(2);
    expect(JSON.stringify(ev)).not.toContain('p2');
    // 좌표 순으로 온다 (자리 순서 p2(27) → p4(22)로 오면 각 점의 역할이 드러난다)
    expect(ev && ev.k === 'roarPings' && ev.pts.map((p) => p.x)).toEqual([22, 27]);
    const sEv = game.drainOutbox('p3');
    expect(sEv.some((e) => e.k === 'text' && e.id === 'ALERT_ROAR')).toBe(true);
    expect(game.monster.roarRevealLeft).toBeGreaterThan(0.9);
    expect(game.monster.roarCd).toBeGreaterThan(29);
    // 생존자 스냅샷: 괴물이 시야 밖이어도 고정 마커만 간다 (몸 · 부채꼴은 아님)
    const facts = computeVisibility(game);
    const snap = buildSnapshot(game, 'p3', 0, facts, new AliasBook())!;
    expect(snap.monster).toBeNull();
    expect(snap.marks).toEqual([{ kind: 'roarSelf', x: 20, y: 18.5 }]);
    d.run(d.seconds(1.1));
    expect(buildSnapshot(game, 'p3', 0, computeVisibility(game), new AliasBook())!.marks).toEqual([]);
  });
});

describe('생존자 고유 능력 (GAME_DESIGN 6.3)', () => {
  it('러너 질주: 3초간 ×1.45, 쿨 20초', () => {
    const game = readyGame();
    const d = new Driver(game);
    place(game, 'p1', 45, 28);
    place(game, 'p2', 20, 18.5);
    d.run(1, { p2: [0, 0, SPACE] });
    const x0 = game.survivorById('p2')!.move.x;
    d.run(30, { p2: [1, 0] });
    const moved = game.survivorById('p2')!.move.x - x0;
    expect(moved).toBeCloseTo(
      game.balance.survivor.moveSpeed * game.balance.roles.runner.sprintMultiplier,
      1,
    );
    expect(game.survivorById('p2')!.abilityCd).toBeGreaterThan(18.9);
    d.run(d.seconds(3));
    const x1 = game.survivorById('p2')!.move.x;
    d.run(30, { p2: [1, 0] });
    expect(game.survivorById('p2')!.move.x - x1).toBeCloseTo(game.balance.survivor.moveSpeed, 3);
  });

  it('가드 밀치기: 2타일 안 괴물 1.5초 기절(이동 · 조준 · 공격 · 능력 · 모드 전환 불가), 공격 준비 취소', () => {
    const game = readyGame();
    const d = new Driver(game);
    place(game, 'p1', 20, 18.5, 0);
    place(game, 'p3', 21.8, 18.5);
    d.run(1, { p1: [0, 0, { pressed: BTN.ATTACK }] });
    expect(game.monster.windupLeft).toBeGreaterThan(0);
    d.run(1, { p3: [0, 0, SPACE] });
    expect(game.monster.move.stun).toBeGreaterThan(1.4);
    expect(game.monster.windupLeft).toBe(0);
    const m = game.monster;
    const pos = { x: m.move.x, y: m.move.y, face: m.move.face };
    d.run(10, { p1: [1, 0, { aim: 2, pressed: BTN.ATTACK | BTN.DASH | BTN.ROAR | BTN.MODE }] });
    expect(m.move.x).toBe(pos.x);
    expect(m.move.face).toBe(pos.face);
    expect(m.windupLeft).toBe(0);
    expect(m.move.dash).toBe(0);
    expect(m.roarCd).toBe(0);
    expect(m.mode).toBe('search');
    expect(game.survivorById('p3')!.stats.hitsTaken).toBe(0);
    d.run(d.seconds(1.5));
    d.run(3, { p1: [1, 0] });
    expect(m.move.x).toBeGreaterThan(pos.x);
  });

  it('밀치기 대상이 없으면(멀거나 벽 너머) 발동하지 않는다 (쿨 · 정체 노출 없음)', () => {
    const game = readyGame();
    const d = new Driver(game);
    place(game, 'p1', 17.4, 9.5, 0);
    place(game, 'p3', 20.6 + 0.8, 9.5); // 벽(19–20) 너머 거리 약 1.98
    d.run(1, { p3: [0, 0, SPACE] });
    expect(game.monster.move.stun).toBe(0);
    expect(game.survivorById('p3')!.abilityCd).toBe(0);
    expect(game.survivorById('p3')!.revealLeft).toBe(0);
    expect(game.drainOutbox('p3').some((e) => e.k === 'shoveMiss')).toBe(true);
  });

  it('돌진 중 기절하면 즉시 멈춘다 (쿨은 소모)', () => {
    const game = readyGame();
    const d = new Driver(game);
    place(game, 'p1', 20, 18.5, 0);
    place(game, 'p3', 21.2, 19.5);
    d.run(1, { p1: [0, 0, { pressed: BTN.DASH, aim: 0 }] });
    d.run(1, { p3: [0, 0, SPACE] });
    expect(game.monster.move.dash).toBe(0);
    expect(game.monster.dashCd).toBeGreaterThan(11);
  });

  it('스카우트 탐지: 4초간 괴물 실시간 위치를 팀 전원에게(벽 너머, 위치만), 쿨 30초', () => {
    const game = readyGame();
    const d = new Driver(game);
    place(game, 'p1', 40, 16, Math.PI);
    place(game, 'p2', 8, 16);
    place(game, 'p3', 8, 17);
    place(game, 'p4', 8, 18);
    d.run(1, { p4: [0, 0, SPACE] });
    let snap = buildSnapshot(game, 'p2', 0, computeVisibility(game), new AliasBook())!;
    expect(snap.monster).toBeNull();
    expect(snap.marks).toEqual([{ kind: 'track', x: 40, y: 16 }]);
    place(game, 'p1', 41, 16);
    d.run(5);
    snap = buildSnapshot(game, 'p2', 0, computeVisibility(game), new AliasBook())!;
    expect(snap.marks[0]!.x).toBeCloseTo(41, 1);
    d.run(d.seconds(4));
    snap = buildSnapshot(game, 'p2', 0, computeVisibility(game), new AliasBook())!;
    expect(snap.marks).toEqual([]);
    expect(game.survivorById('p4')!.abilityCd).toBeGreaterThan(25);
  });

  it('능력을 쓰면 괴물 시야 안일 때 1초 동안 역할이 괴물에게 보인다', () => {
    const game = readyGame();
    const d = new Driver(game);
    place(game, 'p1', 20, 18.5, 0);
    place(game, 'p2', 23, 18.5);
    d.run(1, { p2: [0, 0, SPACE] });
    const book = new AliasBook();
    const monsterSnap = () => {
      const facts = computeVisibility(game);
      book.update(facts.monsterSees);
      return buildSnapshot(game, 'p1', 0, facts, book)!;
    };
    // 러너는 (23,18.5)에 서 있는 생존자 (배열 순서는 임시 ID 순이라 위치로 찾는다)
    const runnerView = (snap: ReturnType<typeof monsterSnap>) =>
      snap.survivors.find((s) => Math.abs(s.x - 23) < 0.01 && Math.abs(s.y - 18.5) < 0.01);
    expect(runnerView(monsterSnap())!.role).toBe('runner');
    d.run(d.seconds(1.05));
    const after = monsterSnap();
    expect(runnerView(after)).toBeDefined();
    expect(after.survivors.every((s) => s.role === null)).toBe(true);
  });

  it('수감 중에는 능력을 쓸 수 없고 쿨타임은 흐른다', () => {
    const game = readyGame();
    const d = new Driver(game);
    const s = game.survivorById('p2')!;
    s.status = 'imprisoned';
    s.abilityCd = 5;
    d.run(1, { p2: [0, 0, SPACE] });
    expect(s.move.sprint).toBe(0);
    d.run(d.seconds(2));
    expect(s.abilityCd).toBeLessThan(3.1);
  });

  it('괴물은 시작 대기 중 능력을 쓸 수 없다', () => {
    const game = readyGame();
    game.monster.move.frozen = 3;
    const d = new Driver(game);
    d.run(1, { p1: [0, 0, { pressed: BTN.DASH | BTN.ROAR }] });
    expect(game.monster.dashCd).toBe(0);
    expect(game.monster.roarCd).toBe(0);
  });
});

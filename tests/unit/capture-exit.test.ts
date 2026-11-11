import { describe, expect, it } from 'vitest';
import { CAPTURE_POINTS, POINT_IDS, type GameEvent, type PointId, type Snapshot } from '@decoy/shared';
import { AliasBook, buildSnapshot, computeVisibility, type Game } from '@decoy/shared/sim';
import { Driver, place, readyGame } from '../helpers/fixtures';

function farMonster(game: ReturnType<typeof readyGame>): void {
  place(game, 'p1', 45, 28);
}

describe('거점 점령 (GAME_DESIGN 7장)', () => {
  it('1명이면 40초, 2명 이상이면 1.5배(약 26.7초)', () => {
    const one = readyGame();
    const d1 = new Driver(one);
    farMonster(one);
    place(one, 'p2', 8, 16);
    place(one, 'p3', 30, 18.5);
    place(one, 'p4', 30, 19.5);
    d1.run(d1.seconds(39.9));
    expect(one.points[0]!.done).toBe(false);
    d1.run(d1.seconds(0.2));
    expect(one.points[0]!.done).toBe(true);

    const two = readyGame();
    const d2 = new Driver(two);
    farMonster(two);
    place(two, 'p2', 8, 16);
    place(two, 'p3', 8.5, 16.5);
    place(two, 'p4', 30, 19.5);
    d2.run(d2.seconds(40 / 1.5 - 0.1));
    expect(two.points[0]!.done).toBe(false);
    d2.run(d2.seconds(0.2));
    expect(two.points[0]!.done).toBe(true);
  });

  it('괴물이 안에 있으면 멈추고, 5초 넘게 지키면 다시 진행된다 (거점 지키기 방지)', () => {
    const game = readyGame();
    const d = new Driver(game);
    place(game, 'p2', 8, 16);
    place(game, 'p1', 9, 17.5);
    place(game, 'p3', 30, 18.5);
    place(game, 'p4', 30, 19.5);
    d.run(d.seconds(4));
    expect(game.points[0]!.progress).toBe(0);
    expect(game.points[0]!.blocked).toBe(true);
    d.run(d.seconds(2));
    expect(game.points[0]!.progress).toBeGreaterThan(0.5);
    expect(game.points[0]!.blocked).toBe(false);
  });

  it('생존자가 없어도 게이지는 줄지 않는다', () => {
    const game = readyGame();
    const d = new Driver(game);
    farMonster(game);
    place(game, 'p2', 8, 16);
    d.run(d.seconds(10));
    const p = game.points[0]!.progress;
    place(game, 'p2', 20, 18.5);
    d.run(d.seconds(10));
    expect(game.points[0]!.progress).toBeCloseTo(p, 6);
  });

  it('점령 시작은 괴물에게만 알리고(쿨다운 동안 반복하지 않음), 완료는 양쪽에, 메모는 점령 순서대로', () => {
    const game = readyGame();
    const d = new Driver(game);
    farMonster(game);
    place(game, 'p2', 40, 16); // B부터
    d.run(2);
    const mEvents = game.drainOutbox('p1');
    expect(mEvents.some((e) => e.k === 'text' && e.id === 'ALERT_CAPTURE_START' && e.point === 'B')).toBe(
      true,
    );
    expect(game.drainOutbox('p2').some((e) => e.k === 'text' && e.id === 'ALERT_CAPTURE_START')).toBe(false);
    // 잠깐 나갔다 들어와도 쿨다운 안이면 다시 알리지 않는다
    place(game, 'p2', 30, 16);
    d.run(3);
    place(game, 'p2', 40, 16);
    d.run(3);
    expect(game.drainOutbox('p1').some((e) => e.k === 'text' && e.id === 'ALERT_CAPTURE_START')).toBe(false);
    d.run(d.seconds(41));
    const sEv = game.drainOutbox('p2');
    expect(sEv.some((e) => e.k === 'text' && e.id === 'ALERT_CAPTURE_DONE' && e.point === 'B')).toBe(true);
    const note = sEv.find((e) => e.k === 'text' && e.id === 'NOTE_FIRST');
    expect(note && note.k === 'text' && note.code).toBe(game.codes[0]);
    expect(game.drainOutbox('p1').some((e) => e.k === 'text' && e.id === 'ALERT_CAPTURE_DONE')).toBe(true);
  });
});

describe('거점 세 곳 중 두 곳 (플레이테스트 반영 b, GAME_DESIGN 7장)', () => {
  const pt = (game: Game, id: PointId) => game.points.find((p) => p.id === id)!;
  const texts = (ev: GameEvent[], id: string) => ev.filter((e) => e.k === 'text' && e.id === id);
  /** id 거점을 p2 혼자 한 틱 남기고 끝낸다. 끝나는 그 틱까지 한 틱씩 돌려, 끝난 틱의 상태를 본다 */
  function finish(game: Game, d: Driver, id: PointId): void {
    pt(game, id).progress = game.balance.capturePoint.captureTime - game.dt * 2;
    const c = CAPTURE_POINTS[id];
    place(game, 'p2', c.x, c.y);
    for (let i = 0; i < 10 && !pt(game, id).done; i += 1) d.run(1);
    expect(pt(game, id).done).toBe(true);
  }
  function parked(): { game: Game; d: Driver } {
    const game = readyGame();
    const d = new Driver(game);
    farMonster(game);
    place(game, 'p3', 30, 18.5);
    place(game, 'p4', 30, 19.5);
    return { game, d };
  }

  it('거점은 A · B · C 셋이고 스냅샷 순서(배열)는 id 순서 그대로다', () => {
    const game = readyGame();
    expect(game.points.map((p) => p.id)).toEqual([...POINT_IDS]);
    expect(POINT_IDS).toEqual(['A', 'B', 'C']);
    expect(game.points.every((p) => !p.done && !p.off)).toBe(true);
  });

  const ORDERS: [PointId, PointId][] = [
    ['A', 'B'],
    ['B', 'A'],
    ['A', 'C'],
    ['C', 'A'],
    ['B', 'C'],
    ['C', 'B'],
  ];
  for (const [first, second] of ORDERS) {
    const third = POINT_IDS.find((id) => id !== first && id !== second)!;
    it(`${first} → ${second}: 둘째가 끝나는 그 틱에 탈출구 둘이 켜지고 ${third}는 꺼진다, 메모는 점령 순서대로 두 장`, () => {
      const { game, d } = parked();
      finish(game, d, first);
      expect(game.exits.every((e) => e.state === 'inactive')).toBe(true);
      expect(game.points.some((p) => p.off)).toBe(false);
      const s1 = game.drainOutbox('p2');
      expect(texts(s1, 'NOTE_FIRST').map((e) => (e.k === 'text' ? e.code : null))).toEqual([game.codes[0]]);
      expect(texts(s1, 'ALERT_EXITS_ON')).toHaveLength(0);

      finish(game, d, second);
      // 끝난 틱 그대로: 남은 곳은 꺼지고 탈출구가 켜진다
      expect(pt(game, third).off).toBe(true);
      expect(pt(game, third).done).toBe(false);
      expect(pt(game, first).off || pt(game, second).off).toBe(false);
      expect(game.exits.every((e) => e.state === 'active')).toBe(true);
      expect(game.capturedCount).toBe(2);
      const s2 = game.drainOutbox('p2');
      expect(texts(s2, 'NOTE_SECOND').map((e) => (e.k === 'text' ? e.code : null))).toEqual([game.codes[1]]);
      expect(texts(s2, 'NOTE_FIRST')).toHaveLength(0);
      expect(texts(s2, 'ALERT_EXITS_ON')).toHaveLength(1);
      const m = game.drainOutbox('p1');
      expect(texts(m, 'ALERT_CAPTURE_DONE').map((e) => (e.k === 'text' ? e.point : null))).toEqual([
        first,
        second,
      ]);
      expect(texts(m, 'ALERT_EXITS_ON')).toHaveLength(1);
      expect(JSON.stringify(m)).not.toContain('NOTE_');
    });
  }

  it('꺼진 거점: 생존자가 서 있어도 진행 · 점령 기여 초 · 점령 시작 알림 · 정지가 없고, 괴물이 오래 서 있어도 지키기 경고가 없다', () => {
    const { game, d } = parked();
    pt(game, 'C').progress = 10;
    finish(game, d, 'A');
    finish(game, d, 'B');
    expect(pt(game, 'C').off).toBe(true);
    game.drainOutbox('p1');
    const before = game.survivorById('p4')!.stats.captureSeconds;
    // 생존자 둘과 괴물이 함께 꺼진 C 안에 9초 (괴물 지키기 경고 문턱 · 정지 유예 5초를 넘긴다)
    place(game, 'p4', 24, 7);
    place(game, 'p3', 23.5, 7.5);
    place(game, 'p1', 25, 7);
    const aliases = new AliasBook();
    let warned = 0;
    for (let i = 0; i < d.seconds(9); i += 1) {
      d.run(1);
      const c = pt(game, 'C');
      expect(c.capturing || c.blocked).toBe(false);
      const facts = computeVisibility(game);
      aliases.update(facts.monsterSees);
      const snap = buildSnapshot(game, 'p1', 0, facts, aliases)!;
      if (snap.you.mon?.blockWarn) warned += 1;
      expect(snap.world.points.find((p) => p.id === 'C')).toEqual({ id: 'C', progress: 0.25, state: 'off' });
    }
    expect(warned).toBe(0);
    expect(pt(game, 'C').progress).toBe(10);
    expect(game.survivorById('p4')!.stats.captureSeconds).toBe(before);
    expect(texts(game.drainOutbox('p1'), 'ALERT_CAPTURE_START')).toHaveLength(0);
  });

  // 둘째가 끝나는 바로 그 틱에 다른 생존자가 남은 곳에 처음 들어선다. 남은 곳이 배열에서 둘째보다 앞이든 뒤든
  // (예: C가 둘째로 끝나며 A가 꺼짐 ↔ A가 둘째로 끝나며 C가 꺼짐) 꺼지는 곳은 그 틱에 진행 · 기여 초 · 점령 시작 알림이 없다
  for (const [first, second] of ORDERS) {
    const third = POINT_IDS.find((id) => id !== first && id !== second)!;
    it(`${first} 끝 → ${second}가 둘째로 끝나는 틱에 ${third}에 들어서도 꺼지는 ${third}는 아무 신호가 없다 (배열 차례와 무관)`, () => {
      const { game, d } = parked();
      finish(game, d, first);
      pt(game, second).progress = game.balance.capturePoint.captureTime - game.dt / 2;
      const s = CAPTURE_POINTS[second];
      const t = CAPTURE_POINTS[third];
      place(game, 'p3', s.x, s.y);
      place(game, 'p2', t.x, t.y); // 이 틱에 처음 들어선다
      game.drainOutbox('p1');
      const before = game.survivorById('p2')!.stats.captureSeconds;
      d.run(1);
      expect(pt(game, second).done).toBe(true);
      expect(pt(game, third).off).toBe(true);
      expect(pt(game, third).progress).toBe(0);
      expect(pt(game, third).capturing || pt(game, third).blocked).toBe(false);
      expect(game.survivorById('p2')!.stats.captureSeconds).toBe(before);
      const m = game.drainOutbox('p1');
      expect(m.map((e) => (e.k === 'text' ? `${e.id}:${e.point ?? ''}` : e.k))).toEqual([
        `ALERT_CAPTURE_START:${second}`,
        `ALERT_CAPTURE_DONE:${second}`,
        'ALERT_EXITS_ON:',
      ]);
      const facts = computeVisibility(game);
      const aliases = new AliasBook();
      aliases.update(facts.monsterSees);
      const snap = buildSnapshot(game, 'p1', 0, facts, aliases)!;
      expect(snap.world.points.find((p) => p.id === third)).toEqual({ id: third, progress: 0, state: 'off' });
    });
  }

  it('같은 틱에 셋이 다 차면 배열 순서(A · B)가 먼저 끝나고 C는 꺼진다 — 완료 알림 둘 · 메모 한 장씩 · 탈출구 알림 하나', () => {
    const game = readyGame();
    const d = new Driver(game);
    farMonster(game);
    for (const p of game.points) p.progress = game.balance.capturePoint.captureTime - game.dt / 2;
    place(game, 'p2', 8, 16);
    place(game, 'p3', 40, 16);
    place(game, 'p4', 24, 7);
    d.run(1);
    expect(game.points.map((p) => [p.id, p.done, p.off])).toEqual([
      ['A', true, false],
      ['B', true, false],
      ['C', false, true],
    ]);
    const s = game.drainOutbox('p4');
    expect(texts(s, 'NOTE_FIRST')).toHaveLength(1);
    expect(texts(s, 'NOTE_SECOND')).toHaveLength(1);
    expect(texts(s, 'ALERT_CAPTURE_DONE')).toHaveLength(2);
    expect(texts(s, 'ALERT_EXITS_ON')).toHaveLength(1);
    // 그 뒤로도 C는 끝나지 않는다 (셋째 메모는 없다)
    d.run(d.seconds(45));
    expect(pt(game, 'C').done).toBe(false);
    expect(game.capturedCount).toBe(2);
    expect(texts(game.drainOutbox('p4'), 'NOTE_SECOND')).toHaveLength(0);
  });
});

describe('탈출구 (GAME_DESIGN 8장)', () => {
  /** 세 곳 중 두 곳(A · B)을 끝내 탈출구를 켠다 — C는 꺼진다 */
  function exitsOn() {
    const game = readyGame();
    for (const p of game.points) {
      p.progress = game.balance.capturePoint.captureTime - game.dt;
    }
    place(game, 'p2', 8, 16);
    place(game, 'p3', 40, 16);
    place(game, 'p4', 24, 20);
    farMonster(game);
    const d = new Driver(game);
    d.run(2);
    expect(game.points.find((p) => p.id === 'C')!.off).toBe(true);
    return { game, d };
  }

  it('거점 세 곳 중 두 곳을 점령하기 전에는 비활성, 점령하면 활성', () => {
    const game = readyGame();
    expect(game.exits.every((e) => e.state === 'inactive')).toBe(true);
    const r = exitsOn();
    expect(r.game.exits.every((e) => e.state === 'active')).toBe(true);
  });

  it('두 명이 함께 3초 머물러야 열리고, 한 명이 나가면 0으로 돌아간다', () => {
    const { game, d } = exitsOn();
    place(game, 'p2', 23.5, 2.5);
    place(game, 'p3', 24.5, 2.5);
    d.run(d.seconds(2));
    expect(game.exits[0]!.progress).toBeGreaterThan(1.9);
    place(game, 'p3', 24.5, 4.5);
    d.run(1);
    expect(game.exits[0]!.progress).toBe(0);
    place(game, 'p3', 24.5, 2.5);
    d.run(d.seconds(3) + 1);
    expect(game.exits[0]!.state).toBe('open');
    expect(game.exits[1]!.state).toBe('active');
  });

  it('혼자서는 열리지 않는다', () => {
    const { game, d } = exitsOn();
    place(game, 'p2', 24, 2.5);
    d.run(d.seconds(5));
    expect(game.exits[0]!.state).toBe('active');
  });

  it('괴물이 있어도 개방은 멈추지 않는다', () => {
    const { game, d } = exitsOn();
    place(game, 'p2', 23.5, 2.5);
    place(game, 'p3', 24.5, 2.5);
    place(game, 'p1', 26, 2.5);
    d.run(d.seconds(3) + 1);
    expect(game.exits[0]!.state).toBe('open');
  });

  it('열린 문 칸으로 걸어 들어가면 탈출, 괴물은 문을 지나갈 수 없다', () => {
    const { game, d } = exitsOn();
    place(game, 'p2', 23.5, 2.5);
    place(game, 'p3', 24.5, 2.5);
    d.run(d.seconds(3) + 1);
    d.run(d.seconds(1), { p2: [0, -1] });
    expect(game.survivorById('p2')!.status).toBe('escaped');
    place(game, 'p1', 24, 2);
    d.run(d.seconds(1), { p1: [0, -1] });
    expect(game.monster.move.y).toBeGreaterThanOrEqual(1 + game.balance.monster.radius - 1e-6);
  });
});

describe('비밀번호 조각 · 탈출구 열기 진행의 정보 범위 (플레이테스트 a-9 자물쇠 판이 기대는 사실)', () => {
  it('괴물이 받는 스냅샷 · 이벤트에 거점 메모 · 비밀번호 숫자 · 탈출구 열기 진행이 없다 (점령부터 문 열림까지 — 생존자 셋은 수감 중이어도 받는다)', () => {
    const game = readyGame(11);
    const d = new Driver(game);
    const aliases = new AliasBook();
    const got = new Map<string, Snapshot[]>();
    /** n틱 진행하며 틱마다 모든 자리의 스냅샷을 만든다 (서버 송신 경로와 같은 buildSnapshot — 받는 사람 outbox를 비운다) */
    const tick = (n: number): void => {
      for (let i = 0; i < n; i += 1) {
        d.run(1);
        const facts = computeVisibility(game);
        aliases.update(facts.monsterSees);
        for (const id of game.players.keys()) {
          const snap = buildSnapshot(game, id, 0, facts, aliases);
          if (snap) got.set(id, [...(got.get(id) ?? []), snap]);
        }
      }
    };
    place(game, 'p1', 45, 28);
    // p4는 감옥에 갇힌 채 (관전 화면의 자물쇠 판도 숫자를 받는다)
    game.survivorById('p4')!.status = 'imprisoned';
    place(game, 'p4', 24, 16);
    for (const p of game.points) p.progress = game.balance.capturePoint.captureTime - game.dt * 3;
    place(game, 'p2', 40, 16); // B 먼저
    place(game, 'p3', 30, 20);
    tick(10);
    place(game, 'p2', 8, 16); // 그다음 A
    tick(10);
    expect(game.exits.every((e) => e.state === 'active')).toBe(true);
    // 북쪽 문 앞에 둘, 괴물은 그 둘과 문이 보이는 곳에서 북쪽을 본다
    place(game, 'p2', 23.5, 2.5);
    place(game, 'p3', 24.5, 2.5);
    place(game, 'p1', 24, 5, -Math.PI / 2);
    tick(d.seconds(1.5));
    // 한 명이 나갔다 돌아온다 (지워짐)
    place(game, 'p3', 24.5, 7);
    tick(6);
    place(game, 'p3', 24.5, 2.5);
    tick(d.seconds(3.5));
    expect(game.exits[0]!.state).toBe('open');

    const mon = got.get('p1')!;
    // 괴물이 생존자 둘을 실제로 본 스냅샷이 있다 (보이는데도 진행이 없다는 것을 본다)
    expect(mon.some((s) => s.survivors.length >= 2)).toBe(true);
    const monText = JSON.stringify(mon);
    expect(monText).not.toContain('NOTE_');
    expect(monText).not.toContain('"code"');
    for (const c of game.codes) expect(monText.includes(`"${c}"`), c).toBe(false);
    for (const s of mon) for (const e of s.world.exits) expect(e.progress).toBeNull();
    const monTexts = new Set(mon.flatMap((s) => s.events.flatMap((e) => (e.k === 'text' ? [e.id] : []))));
    expect([...monTexts].sort()).toEqual([
      'ALERT_CAPTURE_DONE',
      'ALERT_CAPTURE_START',
      'ALERT_EXITS_ON',
      'ALERT_EXIT_OPEN',
    ]);

    // 생존자 셋은 메모 두 개(점령 순서대로 조각)와 탈출구 진행을 받는다
    for (const id of ['p2', 'p3', 'p4']) {
      const list = got.get(id)!;
      const notes = list
        .flatMap((s) => s.events)
        .filter((e): e is Extract<GameEvent, { k: 'text' }> => e.k === 'text' && e.id.startsWith('NOTE_'));
      expect(
        notes.map((n) => [n.id, n.code]),
        id,
      ).toEqual([
        ['NOTE_FIRST', game.codes[0]],
        ['NOTE_SECOND', game.codes[1]],
      ]);
      for (const s of list) for (const e of s.world.exits) expect(e.progress, id).not.toBeNull();
      // 열기 진행이 오르다 한 명이 나가자 0으로, 다시 올라 열림
      const north = list.map((s) => s.world.exits[0]!.progress!);
      const peak = north.indexOf(Math.max(...north.slice(0, north.lastIndexOf(0))));
      expect(north[peak]).toBeGreaterThan(0.4);
      expect(north.slice(peak).includes(0)).toBe(true);
      expect(north[north.length - 1]).toBe(1);
    }
  });
});

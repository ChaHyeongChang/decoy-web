// 화면 밖 표시 (따라가는 카메라): 정보 규칙(서버가 보낸 것만, 괴물 화면은 점령 알림 · 포효 자리만)과 가장자리 배치
import { describe, expect, it } from 'vitest';
import {
  CAPTURE_POINTS,
  EXITS,
  POINT_IDS,
  RESCUE_POINT,
  type DrawnEntity,
  type ExitView,
  type PointView,
  type Role,
  type SurvivorStatus,
} from '@decoy/shared';
import {
  EDGE_MAX,
  edgeTargets,
  fromPerim,
  inView,
  placeEdges,
  rayToTrack,
  toPerim,
  type EdgeInput,
  type EdgeMarker,
  type EdgeTarget,
  type ViewPx,
} from '../../client/src/render/offscreen';
import { loadTestBalance } from '../helpers/fixtures';

const ent = (id: string, kind: DrawnEntity['kind'], x: number, y: number, tag?: string): DrawnEntity => ({
  id,
  kind,
  x,
  y,
  face: 0,
  layer: 'main',
  ...(tag ? { tag } : {}),
});

const POINTS_IDLE: PointView[] = [
  { id: 'A', progress: 0, state: 'idle' },
  { id: 'B', progress: 0, state: 'idle' },
  { id: 'C', progress: 0, state: 'idle' },
];
const EXITS_OFF: ExitView[] = [
  { id: 'N', state: 'inactive', progress: null },
  { id: 'S', state: 'inactive', progress: null },
];

function input(over: Partial<EdgeInput>): EdgeInput {
  const status: Record<string, SurvivorStatus> = { r: 'free', g: 'free', s: 'free' };
  const roles: Record<string, Role> = { r: 'runner', g: 'guard', s: 'scout' };
  return {
    role: 'runner',
    selfId: 'r',
    myStatus: 'free',
    followId: 'r',
    drawn: [],
    statusOf: (id) => status[id] ?? null,
    roleOf: (id) => roles[id] ?? null,
    points: POINTS_IDLE,
    exits: EXITS_OFF,
    ...over,
  };
}

const kinds = (t: EdgeTarget[]): string[] => t.map((x) => `${x.kind}:${x.id}`).sort();

describe('edgeTargets 정보 규칙', () => {
  it('생존자 화면: 자유 팀원 · 보이는 괴물 · 탐지 · 포효 자리 · 끝나지 않은 거점', () => {
    const out: EdgeTarget[] = [];
    edgeTargets(
      input({
        drawn: [
          ent('r', 'self', 10, 10),
          ent('g', 'survivor', 40, 20),
          ent('s', 'survivor', 2, 2),
          ent('monster', 'monster', 30, 30),
          ent('mark-track', 'mark', 31, 30, 'track'),
          ent('mark-roarSelf', 'mark', 33, 28, 'roarSelf'),
        ],
        points: [
          { id: 'A', progress: 0.3, state: 'capturing' },
          { id: 'B', progress: 1, state: 'done' },
          { id: 'C', progress: 0.1, state: 'idle' },
        ],
      }),
      out,
    );
    expect(kinds(out)).toEqual(
      [
        'monster:monster',
        'point:A',
        'point:C',
        'roar:roar',
        'teammate:g',
        'teammate:s',
        'track:track',
      ].sort(),
    );
    const g = out.find((x) => x.id === 'g');
    expect(g?.role).toBe('guard');
    expect(out.find((x) => x.kind === 'point')).toMatchObject({ tx: CAPTURE_POINTS.A.x, state: 'capturing' });
    // C는 C 자리 (북쪽 교차로)
    expect(out.find((x) => x.id === 'C')).toMatchObject({
      tx: CAPTURE_POINTS.C.x,
      ty: CAPTURE_POINTS.C.y,
      state: 'idle',
    });
  });

  it('꺼진 거점(다른 두 곳이 끝나 점령할 수 없음)은 화살표가 없다 — 생존자 화면 · 괴물 화면 모두, 탈출구 화살표는 그대로', () => {
    const out: EdgeTarget[] = [];
    const ended: PointView[] = [
      { id: 'A', progress: 1, state: 'done' },
      { id: 'B', progress: 0.42, state: 'off' },
      { id: 'C', progress: 1, state: 'done' },
    ];
    const exitsOn: ExitView[] = [
      { id: 'N', state: 'active', progress: 0 },
      { id: 'S', state: 'active', progress: 0 },
    ];
    edgeTargets(input({ points: ended, exits: exitsOn }), out);
    expect(out.some((x) => x.kind === 'point')).toBe(false);
    expect(kinds(out)).toEqual(['exit:N', 'exit:S']);
    // 꺼진 거점 안에 생존자가 서 있어도 괴물 화면에 아무 화살표가 없다 (꺼진 거점은 점령 중이 되지 않는다)
    edgeTargets(
      input({
        role: 'monster',
        selfId: 'm',
        myStatus: null,
        followId: 'm',
        drawn: [ent('m', 'self', 10, 10)],
        points: ended,
        exits: exitsOn.map((e) => ({ ...e, progress: null })),
      }),
      out,
    );
    expect(out).toEqual([]);
    // 셋 중 어느 것이 꺼져도 같다
    for (const offId of ['A', 'B', 'C'] as const) {
      const pts: PointView[] = (['A', 'B', 'C'] as const).map((id) => ({
        id,
        progress: id === offId ? 0.3 : 1,
        state: id === offId ? 'off' : 'done',
      }));
      edgeTargets(input({ points: pts, exits: exitsOn }), out);
      expect(out.filter((x) => x.kind === 'point')).toEqual([]);
    }
  });

  it('생존자 화면: 괴물이 그려지지 않았으면(공유 시야 밖) 괴물 화살표도 없다', () => {
    const out: EdgeTarget[] = [];
    edgeTargets(input({ drawn: [ent('r', 'self', 10, 10), ent('g', 'survivor', 40, 20)] }), out);
    expect(out.some((x) => x.kind === 'monster')).toBe(false);
  });

  it('생존자 화면: 수감된 팀원은 감옥 구조 자리 하나로 (내가 자유일 때만), 사망 · 탈출 팀원은 없음', () => {
    const status: Record<string, SurvivorStatus> = { r: 'free', g: 'imprisoned', s: 'dead' };
    const out: EdgeTarget[] = [];
    const base = input({
      drawn: [ent('r', 'self', 10, 10), ent('g', 'survivor', 23.5, 15.5), ent('s', 'survivor', 5, 5)],
      statusOf: (id) => status[id] ?? null,
    });
    edgeTargets(base, out);
    expect(kinds(out)).toEqual(['point:A', 'point:B', 'point:C', 'prison:prison']);
    expect(out.find((x) => x.kind === 'prison')).toMatchObject({ tx: RESCUE_POINT.x, ty: RESCUE_POINT.y });
    // 나도 수감 중이면 구조 화살표 없음
    edgeTargets({ ...base, myStatus: 'imprisoned' }, out);
    expect(out.some((x) => x.kind === 'prison')).toBe(false);
  });

  it('생존자 화면: 활성 · 열린 탈출구만', () => {
    const out: EdgeTarget[] = [];
    edgeTargets(
      input({
        exits: [
          { id: 'N', state: 'active', progress: 0 },
          { id: 'S', state: 'open', progress: 1 },
        ],
      }),
      out,
    );
    expect(out.filter((x) => x.kind === 'exit').map((x) => [x.id, x.state, x.ty])).toEqual([
      ['N', 'active', EXITS.N.center.y],
      ['S', 'open', EXITS.S.center.y],
    ]);
  });

  it('관전 중: 보고 있는 동료는 빼고, 수감 중인 내 자리를 넣는다', () => {
    const status: Record<string, SurvivorStatus> = { r: 'imprisoned', g: 'free', s: 'free' };
    const out: EdgeTarget[] = [];
    edgeTargets(
      input({
        myStatus: 'imprisoned',
        followId: 'g',
        drawn: [ent('r', 'self', 23.5, 15.5), ent('g', 'survivor', 40, 20), ent('s', 'survivor', 2, 2)],
        statusOf: (id) => status[id] ?? null,
      }),
      out,
    );
    expect(kinds(out).filter((k) => !k.startsWith('point'))).toEqual(['self:r', 'teammate:s']);
  });

  it('괴물 화면: 생존자 엔티티 화살표는 없고 포효 핑(역할 없음) · 점령 중 거점만', () => {
    const out: EdgeTarget[] = [];
    edgeTargets(
      input({
        role: 'monster',
        selfId: 'm',
        myStatus: null,
        followId: 'm',
        drawn: [
          ent('m', 'self', 10, 10),
          ent('r', 'survivor', 40, 20),
          ent('g', 'survivor', 2, 2),
          ent('mark-roarPing', 'mark', 40, 20, 'roarPing'),
          ent('mark-roarPing', 'mark', 2, 2, 'roarPing'),
        ],
        points: [
          { id: 'A', progress: 0.3, state: 'capturing' },
          { id: 'B', progress: 0.1, state: 'blocked' },
        ],
        exits: [{ id: 'N', state: 'open', progress: null }],
      }),
      out,
    );
    expect(kinds(out)).toEqual(['point:A', 'roarPing:ping0', 'roarPing:ping1']);
    // 포효 핑은 역할 · 생존자 id 없음
    for (const t of out) {
      expect(t.role).toBeNull();
      expect(['r', 'g', 's']).not.toContain(t.id);
    }
  });

  it('상한 EDGE_MAX는 규칙상 한꺼번에 나올 수 있는 대상 수 이상이다 — 거점 세 곳이 다 나오는 최악에도 거점 화살표가 잘리지 않는다 (상태 전수)', () => {
    const bal = loadTestBalance();
    expect(POINT_IDS.length).toBe(bal.capturePoint.count);
    const required = bal.capturePoint.required;
    // 규칙에 맞는 거점 · 탈출구 상태 (끝난 수 < required면 꺼짐 · 켜진 탈출구 없음, = required면 남은 곳은 꺼짐 + 탈출구 켜짐)
    const PS: PointView['state'][] = ['idle', 'capturing', 'blocked', 'done', 'off'];
    const worlds: { points: PointView[]; exits: ExitView[] }[] = [];
    const ES: ExitView['state'][] = ['active', 'open'];
    for (let k = 0; k < PS.length ** POINT_IDS.length; k += 1) {
      const points = POINT_IDS.map((id, i): PointView => {
        const st = PS[Math.floor(k / PS.length ** i) % PS.length]!;
        return { id, progress: st === 'done' ? 1 : 0.5, state: st };
      });
      const done = points.filter((p) => p.state === 'done').length;
      const off = points.filter((p) => p.state === 'off').length;
      if (done < required && off === 0) worlds.push({ points, exits: EXITS_OFF });
      if (done === required && off === points.length - required)
        for (const n of ES)
          for (const sx of ES)
            worlds.push({
              points,
              exits: [
                { id: 'N', state: n, progress: 0 },
                { id: 'S', state: sx, progress: 0 },
              ],
            });
    }
    expect(worlds.length).toBeGreaterThan(50);
    const SS: SurvivorStatus[] = ['free', 'imprisoned', 'dead', 'escaped'];
    const out: EdgeTarget[] = [];
    let max = 0;
    let worst: EdgeTarget[] = [];
    let cases = 0;
    for (const me of SS)
      for (const follow of me === 'free' ? ['r'] : ['r', 'g', 's'])
        for (const gs of SS)
          for (const ss of SS)
            for (let extra = 0; extra < 8; extra += 1) {
              const status: Record<string, SurvivorStatus> = { r: me, g: gs, s: ss };
              const drawn: DrawnEntity[] = [
                ent('r', 'self', 23.5, 15.5),
                ent('g', 'survivor', 40, 20),
                ent('s', 'survivor', 2, 2),
              ];
              if (extra & 1) drawn.push(ent('monster', 'monster', 30, 30));
              if (extra & 2) drawn.push(ent('mark-track', 'mark', 31, 30, 'track'));
              if (extra & 4) drawn.push(ent('mark-roarSelf', 'mark', 33, 28, 'roarSelf'));
              for (const w of worlds) {
                edgeTargets(
                  input({
                    myStatus: me,
                    followId: follow,
                    drawn,
                    statusOf: (id) => status[id] ?? null,
                    points: w.points,
                    exits: w.exits,
                  }),
                  out,
                );
                cases += 1;
                if (out.length > max) {
                  max = out.length;
                  worst = out.slice();
                }
              }
            }
    expect(cases).toBeGreaterThan(10_000);
    expect(max).toBeLessThanOrEqual(EDGE_MAX);
    // 최악은 거점 세 곳이 모두 나오는 경우다 (괴물 · 탐지 · 포효 + 팀원 · 감옥 2 + 거점 3)
    expect(worst.filter((t) => t.kind === 'point').map((t) => t.id)).toEqual([...POINT_IDS]);
    // 그 최악을 모두 창 밖에 두어도 거점 화살표 셋이 다 놓인다 (우선순위 꼴찌인 거점이 잘리지 않는다)
    const far: ViewPx = { view: { x: 46, y: 30.5, w: 1.5, h: 1 }, rect: { x: 0, y: 0, w: 960, h: 640 } };
    const placed: EdgeMarker[] = [];
    placeEdges(worst, far, { inset: 30, r: 14, gap: 4, avoid: [], bodyR: 12 }, [], placed);
    expect(placed).toHaveLength(worst.length);
    expect(placed.filter((m) => m.kind === 'point')).toHaveLength(POINT_IDS.length);
    // 괴물 화면: 포효 핑(생존자 셋까지) + 점령 중 거점(셋까지)
    const pings = ['r', 'g', 's'].map((id, n) => ent(`ping-${id}`, 'mark', 5 + n * 10, 5, 'roarPing'));
    for (const w of worlds) {
      edgeTargets(
        input({ role: 'monster', selfId: 'm', myStatus: null, followId: 'm', drawn: pings, ...w }),
        out,
      );
      expect(out.length).toBeLessThanOrEqual(EDGE_MAX);
    }
  });

  it('미니맵 사본(layer minimap)은 읽지 않는다', () => {
    const out: EdgeTarget[] = [];
    edgeTargets(input({ drawn: [{ ...ent('monster', 'monster', 30, 30), layer: 'minimap' }] }), out);
    expect(out.some((x) => x.kind === 'monster')).toBe(false);
  });
});

describe('가장자리 배치', () => {
  const v: ViewPx = { view: { x: 10, y: 10, w: 16, h: 10.667 }, rect: { x: 0, y: 0, w: 960, h: 640 } };
  const L = { inset: 30, r: 14, gap: 4, avoid: [], bodyR: 12 };
  const tgt = (id: string, tx: number, ty: number, prio = 4): EdgeTarget => ({
    kind: 'teammate',
    id,
    tx,
    ty,
    prio,
    role: 'runner',
    state: null,
    scale: 1,
  });

  it('둘레 거리 왕복', () => {
    const t = { x0: 30, y0: 30, x1: 930, y1: 610 };
    for (const s of [0, 100, 900, 1200, 1700, 2500, 2900]) {
      const p = fromPerim(t, s);
      expect(toPerim(t, p.x, p.y)).toBeCloseTo(s, 6);
    }
  });

  it('창 안 대상은 화살표가 없다, 창 밖 대상은 가장자리 안쪽에서 대상 쪽을 가리킨다', () => {
    const out: EdgeMarker[] = [];
    placeEdges([tgt('in', 15, 15), tgt('east', 40, 15)], v, L, [], out);
    expect(out.map((m) => m.id)).toEqual(['east']);
    const m = out[0]!;
    expect(m.x).toBeCloseTo(960 - 30, 6);
    expect(Math.abs(m.dir)).toBeLessThan(0.3);
    expect(inView(v.view, 15, 15)).toBe(true);
  });

  it('반직선 교점은 안쪽 사각형 위', () => {
    const t = { x0: 30, y0: 30, x1: 930, y1: 610 };
    const p = rayToTrack(t, 480, -1000);
    expect(p.y).toBeCloseTo(30, 6);
    expect(p.x).toBeCloseTo(480, 6);
  });

  it('가까운 두 대상은 겹치지 않게 둘레를 따라 민다', () => {
    const out: EdgeMarker[] = [];
    placeEdges([tgt('a', 40, 15), tgt('b', 40, 15.05)], v, L, [], out);
    expect(out).toHaveLength(2);
    const d = Math.hypot(out[0]!.x - out[1]!.x, out[0]!.y - out[1]!.y);
    expect(d).toBeGreaterThanOrEqual(L.r * 2 + L.gap - 1e-6);
  });

  it('상한을 넘으면 우선순위가 낮은 것부터 빠진다', () => {
    const many: EdgeTarget[] = [];
    for (let k = 0; k < EDGE_MAX + 3; k += 1) many.push(tgt(`t${k}`, 40, 2 + k * 2, k === 0 ? 9 : 4));
    many.push(tgt('mon', 0, 15, 0));
    const out: EdgeMarker[] = [];
    placeEdges(many, v, L, [], out);
    expect(out).toHaveLength(EDGE_MAX);
    expect(out.some((m) => m.id === 'mon')).toBe(true);
    expect(out.some((m) => m.id === 't0')).toBe(false);
  });

  it('피할 사각형(엄지 버튼) 안이면 둘레를 따라 비켜난다', () => {
    const box = { x: 860, y: 520, w: 100, h: 120 };
    const out: EdgeMarker[] = [];
    placeEdges([tgt('se', 40, 25)], v, { ...L, avoid: [box] }, [], out);
    const m = out[0]!;
    const nx = Math.max(box.x, Math.min(box.x + box.w, m.x));
    const ny = Math.max(box.y, Math.min(box.y + box.h, m.y));
    expect(Math.hypot(m.x - nx, m.y - ny)).toBeGreaterThanOrEqual(L.r - 1e-6);
  });

  it('같은 피할 사각형에 막힌 두 화살표는 같은 빈자리에 쌓이지 않는다 (검토 반영)', () => {
    const box = { x: 860, y: 520, w: 100, h: 120 };
    const out: EdgeMarker[] = [];
    placeEdges([tgt('a', 40, 24), tgt('b', 38, 26)], v, { ...L, avoid: [box] }, [], out);
    expect(out).toHaveLength(2);
    for (const m of out) {
      const nx = Math.max(box.x, Math.min(box.x + box.w, m.x));
      const ny = Math.max(box.y, Math.min(box.y + box.h, m.y));
      expect(Math.hypot(m.x - nx, m.y - ny)).toBeGreaterThanOrEqual(L.r - 1e-6);
    }
    const d = Math.hypot(out[0]!.x - out[1]!.x, out[0]!.y - out[1]!.y);
    expect(d).toBeGreaterThanOrEqual(L.r * 2);
  });

  it('여러 화살표가 엄지 버튼 둘레에 몰려도 둘레를 따라 최소 간격(지름 + 틈) 넘게 떨어진다 (무작위 400판, 모퉁이에서는 직선 거리가 더 짧다)', () => {
    const boxes = [
      { x: 820, y: 470, w: 140, h: 170 },
      { x: 0, y: 500, w: 160, h: 140 },
    ];
    let seed = 7;
    const rnd = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let trial = 0; trial < 400; trial += 1) {
      const ts: EdgeTarget[] = [];
      const base = rnd() * Math.PI * 2;
      for (let i = 0; i < 4; i += 1) {
        const a = base + (rnd() - 0.5) * 0.4;
        ts.push(tgt(`t${i}`, 18 + Math.cos(a) * 30, 15.3 + Math.sin(a) * 30, i));
      }
      const out: EdgeMarker[] = [];
      placeEdges(ts, v, { ...L, avoid: boxes }, [], out);
      const t = { x0: L.inset, y0: L.inset, x1: 960 - L.inset, y1: 640 - L.inset };
      const P = 2 * (t.x1 - t.x0 + (t.y1 - t.y0));
      for (let i = 0; i < out.length; i += 1)
        for (let j = i + 1; j < out.length; j += 1) {
          const d = Math.abs(toPerim(t, out[i]!.x, out[i]!.y) - toPerim(t, out[j]!.x, out[j]!.y)) % P;
          expect(Math.min(d, P - d), `판 ${trial} ${out[i]!.id}-${out[j]!.id}`).toBeGreaterThanOrEqual(
            L.r * 2 + L.gap - 0.5,
          );
        }
    }
  });

  it('캐릭터 몸과 겹치면 흐리게', () => {
    const out: EdgeMarker[] = [];
    placeEdges([tgt('east', 40, 15)], v, L, [{ x: 935, y: 300 }], out);
    expect(out[0]!.faded).toBe(true);
    placeEdges([tgt('east', 40, 15)], v, L, [{ x: 500, y: 300 }], out);
    expect(out[0]!.faded).toBe(false);
  });
});

// 포효 표시 강화 (플레이테스트 반영 a-3): 드러나는 정보(반경 안 자리 · 흰색 · 역할 없음 · 1.5초)는 그대로 두고 전달만 세게 한다.
//  - 창 밖 화살표: 포효 핑만 1.3배 + 월드 핑과 같은 박자의 흰 펄스 고리 (번쩍임 줄이기면 고정). 핑마다 같은 그림
//  - 미니맵: 마름모를 몸 그림 크기로 + 펄스 고리 프레임
//  - 소리: 드러난 수만큼 같은 음의 핑, 0명이면 빈 메아리 (포효 소리 play('roar')와 따로)
//  - 알림 한 줄: 드러난 수 / 아무도 없음 — 핑과 함께 사라진다
// 서버 · 시뮬레이션은 건드리지 않는다(rules-golden · abilities · interest 시험이 그대로 통과해야 한다)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DrawnEntity, PointView } from '@decoy/shared';
import { HIDDEN_SURVIVOR, UI } from '../../client/src/art/palette';
import { ROAR_RESULT, Sfx } from '../../client/src/audio';
import { STORY_TEXT, UI_TEXT } from '../../client/src/data/storyText';
import {
  edgeTargets,
  inView,
  placeEdges,
  toPerim,
  type EdgeInput,
  type EdgeMarker,
  type EdgeTarget,
  type ViewPx,
} from '../../client/src/render/offscreen';
import { PING_PULSE, pingPhase, pingPulse, type PingPulse } from '../../client/src/render/prefsFx';
import { roarResultText } from '../../client/src/roarFeedback';
import { EDGE_HALO, chevBack, edgeLook, haloScale } from '../../client/src/ui/edgeLook';
import { EDGE_ART, EDGE_GLYPH, FR, MM_BODY, MM_PING, hudSpecs } from '../../client/src/ui/hudArt';
import { BANNER_MIN_MS, BANNER_TIED_MIN_MS, shownUntil } from '../../client/src/ui/hudGate';
import { loadTestBalance } from '../helpers/fixtures';

const balance = loadTestBalance();

const ent = (id: string, kind: DrawnEntity['kind'], x: number, y: number, tag?: string): DrawnEntity => ({
  id,
  kind,
  x,
  y,
  face: 0,
  layer: 'main',
  ...(tag ? { tag } : {}),
});

const ping = (x: number, y: number): DrawnEntity => ent('mark-roarPing', 'mark', x, y, 'roarPing');

const CAPTURING: PointView[] = [
  { id: 'A', progress: 0.3, state: 'capturing' },
  { id: 'B', progress: 0, state: 'idle' },
];

function monsterInput(drawn: DrawnEntity[], points: PointView[] = CAPTURING): EdgeInput {
  return {
    role: 'monster',
    selfId: 'm',
    myStatus: null,
    followId: 'm',
    drawn,
    statusOf: () => null,
    roleOf: () => null,
    points,
    exits: [],
  };
}

/** 창 16 × 10.667타일(기본 확대 3)이 960 × 640 논리 px에 그려진다 */
const VIEW: ViewPx = { view: { x: 10, y: 10, w: 16, h: 10.667 }, rect: { x: 0, y: 0, w: 960, h: 640 } };
const LAYOUT = { inset: 30, r: 17, gap: 5, avoid: [], bodyR: 12 };

const target = (kind: EdgeTarget['kind'], id: string, tx: number, ty: number): EdgeTarget => ({
  kind,
  id,
  tx,
  ty,
  prio: 2,
  role: null,
  state: kind === 'point' ? 'capturing' : null,
  scale: kind === 'roarPing' ? EDGE_ART.pingScale : 1,
});

describe('포효 핑 펄스 (창 밖 화살표 · 미니맵 고리)', () => {
  it('포효 핑 펄스: 표시 시간에 3번, 월드 핑과 같은 위상, 번쩍임 줄이기면 시간과 무관하게 고정', () => {
    // 월드 핑(characters.drawRoarPing)이 예전부터 쓰던 식 (k × 3) % 1 — 화살표 · 미니맵 고리가 같은 함수를 쓴다
    expect(PING_PULSE.beats).toBe(3);
    for (let i = 0; i <= 1000; i += 1) {
      const k = i / 1000;
      expect(pingPhase(k)).toBe((k * 3) % 1);
    }
    const out: PingPulse = { t: -1, alpha: -1 };
    // 그릇에 쓴다 (프레임마다 객체를 만들지 않는다)
    expect(pingPulse(0.2, false, out)).toBe(out);
    // 0 → 1 사이에 고리가 세 번 처음 크기로 돌아간다(k = 0, 1/3, 2/3), 그 사이에는 퍼지며 흐려진다
    let starts = 0;
    let prevT = 1;
    for (let i = 0; i < 1500; i += 1) {
      const k = i / 1500;
      const p = pingPulse(k, false, out);
      expect(p.t).toBe(pingPhase(k));
      expect(p.alpha).toBeCloseTo(PING_PULSE.alpha * (1 - pingPhase(k)), 12);
      expect(p.t).toBeGreaterThanOrEqual(0);
      expect(p.t).toBeLessThan(1);
      expect(p.alpha).toBeGreaterThan(0);
      expect(p.alpha).toBeLessThanOrEqual(1);
      if (p.t < prevT) starts += 1;
      prevT = p.t;
    }
    expect(starts).toBe(3);
    // 초당 3번 미만으로 깜빡인다 (표시 시간은 balance의 revealDuration)
    expect(PING_PULSE.beats / balance.monster.roar.revealDuration).toBeLessThan(3);
    // 번쩍임 줄이기: 어느 시각이든 같은 고리 (퍼지지 않는다) — 그래도 보인다
    const seen = new Set<string>();
    for (let i = 0; i <= 300; i += 1) {
      const p = pingPulse(i / 300, true, out);
      seen.add(`${p.t}:${p.alpha}`);
    }
    expect([...seen]).toEqual([`${PING_PULSE.steadyT}:${PING_PULSE.steadyAlpha}`]);
    expect(PING_PULSE.steadyAlpha).toBeGreaterThanOrEqual(0.5);
    // 살아 있는 핑이 없으면(−1) · 수명이 끝났으면 고리가 없다 (잔상 없음, 번쩍임 줄이기여도)
    for (const k of [-1, -0.001, 1.0001, 5, Number.NaN])
      for (const reduced of [false, true]) expect(pingPulse(k, reduced, out).alpha).toBe(0);
  });

  it('펄스 고리 크기: 커진 배지 둘레에서 시작해 보통 배지 반지름의 haloTo배까지', () => {
    const baked = EDGE_ART.r * EDGE_ART.pingScale;
    expect(haloScale(0)).toBe(1);
    expect(baked * haloScale(1)).toBeCloseTo(EDGE_ART.r * EDGE_ART.haloTo, 9);
    expect(EDGE_ART.haloTo).toBeGreaterThan(EDGE_ART.pingScale);
    // 번쩍임 줄이기의 고정 고리는 배지 밖에 보인다 (배지에 가려지지 않는다)
    expect(haloScale(PING_PULSE.steadyT)).toBeGreaterThan(1.05);
  });
});

describe('포효 핑 화살표: 크게 + 같은 그림', () => {
  it('포효 핑 화살표는 모두 같은 배율(EDGE_ART.pingScale)이고 다른 화살표는 1', () => {
    expect(EDGE_ART.pingScale).toBe(1.3);
    const out: EdgeTarget[] = [];
    edgeTargets(
      monsterInput([
        ent('m', 'self', 18, 15),
        ping(40, 20),
        ping(2, 2),
        ping(19, 16),
        ent('r', 'survivor', 19, 16),
      ]),
      out,
    );
    const pings = out.filter((t) => t.kind === 'roarPing');
    expect(pings.map((t) => t.id)).toEqual(['ping0', 'ping1', 'ping2']);
    expect(pings.map((t) => t.scale)).toEqual([1.3, 1.3, 1.3]);
    const points = out.filter((t) => t.kind === 'point');
    expect(points.map((t) => [t.id, t.scale])).toEqual([['A', 1]]);
    // 대상은 그대로: 포효 핑 셋 + 점령 중 거점 하나 (생존자 엔티티 화살표는 없다)
    expect(out).toHaveLength(4);
    // 생존자 화면의 화살표는 하나도 커지지 않는다 (생존자 화면 불변)
    edgeTargets(
      {
        role: 'runner',
        selfId: 'r',
        myStatus: 'free',
        followId: 'r',
        drawn: [
          ent('r', 'self', 10, 10),
          ent('g', 'survivor', 40, 20),
          ent('monster', 'monster', 30, 30),
          ent('mark-track', 'mark', 31, 30, 'track'),
          ent('mark-roarSelf', 'mark', 33, 28, 'roarSelf'),
        ],
        statusOf: () => 'free',
        roleOf: () => 'guard',
        points: CAPTURING,
        exits: [{ id: 'N', state: 'open', progress: 1 }],
      },
      out,
    );
    expect(out.length).toBeGreaterThanOrEqual(6);
    expect(out.every((t) => t.scale === 1)).toBe(true);
  });

  it('포효 핑 화살표 그림은 id · 자리 · 방향이 달라도 같다 (흰색 위장)', () => {
    const mk = (id: string, tx: number, ty: number, x: number, y: number, dir: number): EdgeMarker => ({
      ...target('roarPing', id, tx, ty),
      x,
      y,
      dir,
      faded: false,
    });
    const a = edgeLook(mk('ping0', 19.5, 16.5, 400, 30, -1.5), true);
    const b = edgeLook(mk('ping1', 29.5, 25.5, 930, 500, 0.2), true);
    const c = edgeLook(mk('ping2', 3, 30, 30, 610, 2.6), true);
    expect(b).toEqual(a);
    expect(c).toEqual(a);
    // 흰 공통 문양 · 흰 테두리 · 펄스 고리, 글자 · 깜빡임 없음
    expect(a).toEqual({
      color: HIDDEN_SURVIVOR,
      inner: FR.glyph('hidden', EDGE_GLYPH),
      label: '',
      labelColor: UI.text,
      blink: false,
      dim: false,
      pulse: true,
    });
    // 펄스 고리는 포효 핑에만 (거점 · 생존자 화면 화살표에는 없다)
    const point = edgeLook({ ...target('point', 'A', 8, 16), x: 30, y: 300, dir: 3, faded: false }, true);
    expect(point.pulse).toBe(false);
    expect(point.blink).toBe(true);
    for (const kind of ['monster', 'track', 'roar', 'prison', 'teammate', 'self', 'exit'] as const)
      expect(
        edgeLook({ ...target(kind, 'x', 1, 1), x: 0, y: 0, dir: 0, faded: false }, false).pulse,
        kind,
      ).toBe(false);
    // 그림이 HUD 아틀라스에 있다: 흰 배지 · 흰 셰브론 · 흰 공통 문양 · 흰 펄스 고리
    const names = new Set(hudSpecs().map((s) => s.name));
    expect(EDGE_HALO).toBe(FR.edge('halo', HIDDEN_SURVIVOR));
    for (const f of [
      FR.edge('badge', a.color),
      FR.edge('chev', a.color),
      a.inner,
      EDGE_HALO,
      FR.mm('roarPing'),
      FR.mm('roarPingRing'),
    ])
      expect(names.has(f), f).toBe(true);
  });

  it('큰 화살표끼리 · 큰 화살표와 보통 화살표는 반지름 합 + 틈보다 가깝지 않다', () => {
    const R = LAYOUT.r;
    const big = R * EDGE_ART.pingScale;
    const out: EdgeMarker[] = [];
    // 같은 쪽(동쪽)으로 거의 겹치는 포효 핑 둘
    placeEdges(
      [target('roarPing', 'ping0', 40, 15), target('roarPing', 'ping1', 40, 15.05)],
      VIEW,
      LAYOUT,
      [],
      out,
    );
    expect(out).toHaveLength(2);
    expect(Math.hypot(out[0]!.x - out[1]!.x, out[0]!.y - out[1]!.y)).toBeGreaterThanOrEqual(
      big * 2 + LAYOUT.gap - 1e-6,
    );
    // 포효 핑 하나 + 거점 하나: 큰 반지름 + 보통 반지름 + 틈
    placeEdges([target('roarPing', 'ping0', 40, 15), target('point', 'A', 40, 15.05)], VIEW, LAYOUT, [], out);
    expect(Math.hypot(out[0]!.x - out[1]!.x, out[0]!.y - out[1]!.y)).toBeGreaterThanOrEqual(
      big + R + LAYOUT.gap - 1e-6,
    );
    // 보통 화살표 둘은 예전 간격 그대로 (지름 + 틈에서 멈춘다 — 더 벌리지 않는다)
    placeEdges([target('point', 'A', 40, 15), target('point', 'B', 40, 15.05)], VIEW, LAYOUT, [], out);
    expect(Math.hypot(out[0]!.x - out[1]!.x, out[0]!.y - out[1]!.y)).toBeCloseTo(R * 2 + LAYOUT.gap, 6);
    // 포효 핑 셋 + 거점: 둘레를 따라 잰 간격이 쌍마다 반지름 합 + 틈 이상 (무작위 200판)
    let seed = 11;
    const rnd = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const track = { x0: 30, y0: 30, x1: 930, y1: 610 };
    const P = 2 * (track.x1 - track.x0 + (track.y1 - track.y0));
    for (let trial = 0; trial < 200; trial += 1) {
      const base = rnd() * Math.PI * 2;
      const ts: EdgeTarget[] = [];
      for (let i = 0; i < 4; i += 1) {
        const ang = base + (rnd() - 0.5) * 0.3;
        ts.push(
          target(i < 3 ? 'roarPing' : 'point', `t${i}`, 18 + Math.cos(ang) * 30, 15.3 + Math.sin(ang) * 30),
        );
      }
      placeEdges(ts, VIEW, LAYOUT, [], out);
      expect(out).toHaveLength(4);
      for (let i = 0; i < out.length; i += 1)
        for (let j = i + 1; j < out.length; j += 1) {
          const d = Math.abs(toPerim(track, out[i]!.x, out[i]!.y) - toPerim(track, out[j]!.x, out[j]!.y)) % P;
          const need = R * out[i]!.scale + R * out[j]!.scale + LAYOUT.gap;
          expect(Math.min(d, P - d), `판 ${trial} ${out[i]!.id}-${out[j]!.id}`).toBeGreaterThanOrEqual(
            need - 0.5,
          );
        }
    }
  });

  it('큰 화살표는 커진 반지름으로 피할 사각형 · 몸 겹침을 잰다', () => {
    const R = LAYOUT.r;
    const big = R * EDGE_ART.pingScale;
    const out: EdgeMarker[] = [];
    // 동쪽 가장자리(x = 930, y = 300 근처)에 놓인다. 그 아래 20px에서 시작하는 버튼 사각형: 보통 배지(17)는 닿지 않고 큰 배지(22.1)는 닿는다
    placeEdges([target('point', 'A', 40, 15)], VIEW, LAYOUT, [], out);
    const at = { x: out[0]!.x, y: out[0]!.y };
    const box = { x: 880, y: at.y + 20, w: 80, h: 100 };
    const clear = (m: EdgeMarker, r: number): number => {
      const nx = Math.max(box.x, Math.min(box.x + box.w, m.x));
      const ny = Math.max(box.y, Math.min(box.y + box.h, m.y));
      return Math.hypot(m.x - nx, m.y - ny) - r;
    };
    placeEdges([target('point', 'A', 40, 15)], VIEW, { ...LAYOUT, avoid: [box] }, [], out);
    expect(out[0]!.y).toBeCloseTo(at.y, 6);
    placeEdges([target('roarPing', 'ping0', 40, 15)], VIEW, { ...LAYOUT, avoid: [box] }, [], out);
    expect(out[0]!.y).toBeLessThan(at.y);
    expect(clear(out[0]!, big)).toBeGreaterThanOrEqual(-1e-6);
    // 몸: 배지 가운데에서 31px 떨어진 캐릭터 — 보통(17 + 12 = 29)은 안 겹치고 큰 배지(22.1 + 12 = 34.1)는 겹쳐 흐려진다
    const body = [{ x: at.x - 31, y: at.y }];
    placeEdges([target('point', 'A', 40, 15)], VIEW, LAYOUT, body, out);
    expect(out[0]!.faded).toBe(false);
    placeEdges([target('roarPing', 'ping0', 40, 15)], VIEW, LAYOUT, body, out);
    expect(out[0]!.faded).toBe(true);
  });

  it('큰 화살표의 셰브론 끝은 보통 화살표와 같은 자리다 (창 가장자리를 넘지 않는다)', () => {
    const tip = EDGE_ART.r + EDGE_ART.chevGap + EDGE_ART.chevLen;
    expect(chevBack(1)).toBe(0);
    // scale배로 커진 셰브론을 chevBack만큼 당기면 끝이 보통 화살표의 끝과 같다
    expect(tip * EDGE_ART.pingScale - chevBack(EDGE_ART.pingScale)).toBeCloseTo(tip, 9);
    expect(tip).toBeLessThanOrEqual(EDGE_ART.inset);
    // 커진 배지도 창 가장자리 안이다
    expect(EDGE_ART.r * EDGE_ART.pingScale).toBeLessThan(EDGE_ART.inset);
  });

  it('창 밖 포효 핑마다 화살표 하나, 창 안 핑은 화살표 없음: 화살표 수 + 창 안 핑 수 = 그린 핑 수 (정보 불변)', () => {
    // 괴물 (20.5, 24.5)가 왼쪽 위를 볼 때의 창. 핑 하나는 창 안, 둘은 창 밖 (a-3 조사 장면)
    const v: ViewPx = {
      view: { x: 10.57, y: 17.67, w: 16, h: 10.667 },
      rect: { x: 0, y: 0, w: 960, h: 640 },
    };
    const pts: [number, number][] = [
      [24.5, 26.5],
      [19.5, 16.5],
      [29.5, 25.5],
    ];
    const targets: EdgeTarget[] = [];
    edgeTargets(
      monsterInput([ent('m', 'self', 20.5, 24.5), ...pts.map(([x, y]) => ping(x, y))], []),
      targets,
    );
    const out: EdgeMarker[] = [];
    placeEdges(targets, v, LAYOUT, [], out);
    const inside = pts.filter(([x, y]) => inView(v.view, x, y)).length;
    expect(inside).toBe(1);
    expect(out.map((m) => [m.kind, m.tx, m.ty])).toEqual([
      ['roarPing', 19.5, 16.5],
      ['roarPing', 29.5, 25.5],
    ]);
    expect(out.length + inside).toBe(pts.length);
    // 0명: 화살표도 없다
    edgeTargets(monsterInput([ent('m', 'self', 20.5, 24.5)], []), targets);
    placeEdges(targets, v, LAYOUT, [], out);
    expect(out).toEqual([]);
  });
});

describe('미니맵 포효 핑 그림', () => {
  it('마름모는 몸 그림과 같은 크기(예전 3.4보다 크다), 펄스 고리는 마름모 밖에서 시작해 2배 넘게 퍼진다', () => {
    expect(MM_PING.h).toBe(MM_BODY);
    expect(MM_PING.h).toBeGreaterThan(3.4);
    const specs = hudSpecs();
    const frame = (name: string): { x0: number; x1: number } => {
      const s = specs.find((x) => x.name === name);
      if (!s || s.kind !== 'frame') throw new Error(`프레임 없음: ${name}`);
      return s;
    };
    // 마름모 프레임이 그 크기를 담는다 (잘리지 않는다)
    expect(frame(FR.mm('roarPing')).x1).toBeGreaterThanOrEqual(MM_PING.h + 1);
    // 고리: 마름모 꼭짓점 밖에서 시작, 프레임이 고리(선 굵기 포함)를 담는다
    expect(MM_PING.ring).toBeGreaterThan(MM_PING.h);
    expect(frame(FR.mm('roarPingRing')).x1).toBeGreaterThanOrEqual(MM_PING.ring + 1.6);
    expect(MM_PING.ringTo).toBeGreaterThanOrEqual(2);
  });

  it('결과 알림 리본의 아이콘(정보 톤 흰 포효 아이콘)이 HUD 아틀라스에 있다', () => {
    const names = new Set(hudSpecs().map((s) => s.name));
    expect(names.has(FR.icon('roar', UI.white, 24))).toBe(true);
  });
});

// ───────────────────────── 소리 ─────────────────────────

/** 기록하는 가짜 오디오 노드: 종류 · 연결 · 주파수 · 이득 · 시작 시각 */
class RecNode {
  readonly out: RecNode[] = [];
  type = '';
  buffer: unknown = null;
  /** 주파수 예약 [값, 시각] */
  readonly freqs: [number, number][] = [];
  /** 이득 예약 값 */
  readonly gains: number[] = [];
  startAt: number | null = null;
  readonly frequency = {
    value: 0,
    setValueAtTime: (v: number, t: number): void => {
      this.freqs.push([v, t]);
    },
    linearRampToValueAtTime: (v: number, t: number): void => {
      this.freqs.push([v, t]);
    },
  };
  readonly gain = {
    value: 1,
    setTargetAtTime: (): void => undefined,
    setValueAtTime: (v: number): void => {
      this.gains.push(v);
    },
    exponentialRampToValueAtTime: (v: number): void => {
      this.gains.push(v);
    },
    linearRampToValueAtTime: (v: number): void => {
      this.gains.push(v);
    },
  };
  constructor(
    readonly kind: string,
    private readonly ctx: RecCtx,
  ) {}
  connect(n: RecNode): RecNode {
    this.out.push(n);
    return n;
  }
  disconnect(): void {
    this.out.length = 0;
  }
  start(t: number): void {
    this.startAt = t;
    this.ctx.started.push(this);
  }
  stop(): void {
    return undefined;
  }
}

class RecCtx {
  state: 'running' | 'suspended' = 'running';
  sampleRate = 8000;
  currentTime = 2.5;
  readonly destination = new RecNode('destination', this);
  readonly made: RecNode[] = [];
  readonly started: RecNode[] = [];
  private node(kind: string): RecNode {
    const n = new RecNode(kind, this);
    this.made.push(n);
    return n;
  }
  createGain(): RecNode {
    return this.node('gain');
  }
  createOscillator(): RecNode {
    return this.node('osc');
  }
  createBiquadFilter(): RecNode {
    return this.node('filter');
  }
  createBufferSource(): RecNode {
    return this.node('buffer');
  }
  createBuffer(_c: number, len: number): { getChannelData: () => Float32Array } {
    return { getChannelData: () => new Float32Array(len) };
  }
  resume(): Promise<void> {
    return Promise.resolve();
  }
}

function audio(): { sfx: Sfx; ctx: () => RecCtx | null; unlock: () => void } {
  let made: RecCtx | null = null;
  const sfx = new Sfx(() => {
    made = new RecCtx();
    return made as unknown as AudioContext;
  });
  const t = new EventTarget();
  sfx.attachUnlock(t);
  return { sfx, ctx: () => made, unlock: () => t.dispatchEvent(new Event('keydown')) };
}

/** 발진기에서 출력 쪽으로 따라가 처음 만나는 이득 예약의 가장 큰 값 (그 음의 세기) */
function peakOf(n: RecNode): number {
  for (let cur: RecNode | undefined = n.out[0]; cur; cur = cur.out[0])
    if (cur.gains.length > 0) return Math.max(...cur.gains);
  return Number.NaN;
}

function reaches(n: RecNode, to: RecNode): boolean {
  return n === to || n.out.some((o) => reaches(o, to));
}

describe('포효 결과 소리', () => {
  let now = 0;
  beforeEach(() => {
    now = 5000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.stubGlobal('window', { setTimeout: () => 0 });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('포효 결과 소리: 드러난 수만큼 같은 음 · 같은 세기의 핑(일정한 간격), 0명이면 빈 메아리', () => {
    for (const n of [1, 2, 3]) {
      const { sfx, ctx, unlock } = audio();
      unlock();
      const c = ctx()!;
      sfx.roarResult(n);
      // 기록(getSounds)에 핑마다 한 줄
      expect(sfx.log.map((e) => e.name)).toEqual(Array.from({ length: n }, () => 'roarFound'));
      // 발진기가 딱 그 수만큼, 포효 소리가 잦아든 뒤부터 같은 간격으로
      const osc = c.started.filter((x) => x.kind === 'osc');
      expect(osc).toHaveLength(n);
      expect(c.started).toHaveLength(n);
      osc.forEach((o, i) => {
        expect(o.startAt).toBeCloseTo(c.currentTime + ROAR_RESULT.delayS + i * ROAR_RESULT.gapS, 9);
      });
      // 같은 음 · 같은 파형 · 같은 세기 (순서 · 자리에 따라 달라지지 않는다 — 누가 누구인지 단서가 없다)
      expect(new Set(osc.map((o) => o.type)).size).toBe(1);
      expect(new Set(osc.flatMap((o) => o.freqs.map(([f]) => f)))).toEqual(new Set([ROAR_RESULT.pingHz]));
      expect(new Set(osc.map(peakOf))).toEqual(new Set([ROAR_RESULT.pingPeak]));
      // 핑끼리 겹치지 않는다 (하나씩 셀 수 있다)
      expect(ROAR_RESULT.gapS).toBeGreaterThan(ROAR_RESULT.pingS);
    }
    // 0명: 낮게 떨어지는 빈 메아리 (한 번 + 작게 한 번 더), 기록은 한 줄
    const { sfx, ctx, unlock } = audio();
    unlock();
    const c = ctx()!;
    sfx.roarResult(0);
    expect(sfx.log.map((e) => e.name)).toEqual(['roarEmpty']);
    const osc = c.started.filter((x) => x.kind === 'osc');
    expect(osc).toHaveLength(2);
    for (const o of osc) {
      const [f0, f1] = o.freqs.map(([f]) => f);
      // 떨어지는 음, 핑(높은 음)과 헷갈리지 않게 훨씬 낮다
      expect(f1!).toBeLessThan(f0!);
      expect(f0!).toBeLessThan(ROAR_RESULT.pingHz / 4);
      expect(f1!).toBeGreaterThan(100);
    }
    // 같은 음을 조금 뒤에 더 작게 한 번 더 (메아리), 포효 소리가 잦아든 뒤에 시작
    expect(osc[1]!.freqs).toEqual(
      osc[0]!.freqs.map(([f, t]) => [f, t + (osc[1]!.startAt! - osc[0]!.startAt!)]),
    );
    expect(osc[0]!.startAt).toBeCloseTo(c.currentTime + ROAR_RESULT.delayS, 9);
    expect(osc[1]!.startAt! - osc[0]!.startAt!).toBeGreaterThan(0.15);
    expect(peakOf(osc[1]!)).toBeLessThan(peakOf(osc[0]!) / 2);
  });

  it('한 번의 호출 안에서 예약한다: 같은 소리 간격(60ms)에 걸리지 않고, 포효 소리(play)와 따로 기록된다', () => {
    const { sfx, ctx, unlock } = audio();
    unlock();
    const c = ctx()!;
    // 포효 이벤트 처리 순서 그대로: 포효 소리 → 결과 소리 (같은 시각)
    sfx.play('roar');
    const afterRoar = c.started.length;
    sfx.roarResult(3);
    expect(sfx.log.map((e) => e.name)).toEqual(['roar', 'roarFound', 'roarFound', 'roarFound']);
    expect(c.started.length - afterRoar).toBe(3);
    // 같은 시각에 play('roar')를 또 부르면 한 번만 난다 (예전 규칙 그대로) — 핑을 play로 냈다면 한 번만 났을 것이다
    sfx.play('roar');
    expect(sfx.log.filter((e) => e.name === 'roar')).toHaveLength(1);
    // 결과 소리는 효과음 묶음으로 간다 (UI 묶음이 아니다): 묶음 노드 = [전체, 효과음, UI]
    const [, sfxBus, uiBus] = c.made.filter((x) => x.kind === 'gain');
    const pings = c.started.slice(afterRoar);
    expect(pings.every((o) => reaches(o, sfxBus!))).toBe(true);
    expect(pings.some((o) => reaches(o, uiBus!))).toBe(false);
  });

  it('음소거 · 효과음 0 · 오디오가 열리기 전이면 기록만 남고 소리 노드를 만들지 않는다', () => {
    const a = audio();
    a.sfx.roarResult(2);
    expect(a.ctx()).toBeNull();
    expect(a.sfx.log.map((e) => e.name)).toEqual(['roarFound', 'roarFound']);
    const b = audio();
    b.unlock();
    const c = b.ctx()!;
    b.sfx.setLevels({ master: 0, sfx: 1, ui: 1 });
    b.sfx.roarResult(3);
    b.sfx.setLevels({ master: 1, sfx: 0, ui: 1 });
    b.sfx.roarResult(0);
    expect(c.started).toHaveLength(0);
    expect(b.sfx.log.map((e) => e.name)).toEqual(['roarFound', 'roarFound', 'roarFound', 'roarEmpty']);
  });

  it('수가 이상해도 터지지 않는다: 음수 · 소수는 내려서, 상한(max)까지만 낸다', () => {
    const { sfx, ctx, unlock } = audio();
    unlock();
    const c = ctx()!;
    sfx.roarResult(-2);
    expect(sfx.log.map((e) => e.name)).toEqual(['roarEmpty']);
    sfx.roarResult(2.9);
    expect(sfx.log.filter((e) => e.name === 'roarFound')).toHaveLength(2);
    const before = c.started.length;
    sfx.roarResult(100);
    expect(c.started.length - before).toBe(ROAR_RESULT.max);
    // 판의 생존자는 셋이다: 상한이 실제 수를 자르지 않는다
    expect(ROAR_RESULT.max).toBeGreaterThanOrEqual(3);
  });
});

describe('포효 결과 알림', () => {
  it("포효 결과 알림 글: 0명이면 '근처에 아무도 없다', 1~3명이면 그 수 (자리 수 하나로 정한다)", () => {
    expect(roarResultText(0)).toBe(UI_TEXT.roarNone);
    expect(UI_TEXT.roarNone).toContain('아무도 없다');
    const seen = new Set<string>([roarResultText(0)]);
    for (const n of [1, 2, 3]) {
      const t = roarResultText(n);
      expect(t).toBe(UI_TEXT.roarFound.replace('{n}', String(n)));
      expect(t).toContain(`${n}명`);
      expect(t).not.toContain('{');
      seen.add(t);
    }
    // 네 경우가 모두 다른 글이다 (0명과 찾은 경우가 구분된다)
    expect(seen.size).toBe(4);
    // 생존자 화면의 포효 경고와 다른 글이다 (괴물 화면 전용)
    expect(seen.has(STORY_TEXT.ALERT_ROAR.text)).toBe(false);
    // 입력은 수 하나뿐이다 — 역할 · id · 상태를 넘길 자리가 없다 (타입 검사: tsc -p tests)
    const typeOnly = (f: typeof roarResultText): void => {
      f(2);
      // @ts-expect-error 누가 드러났는지(생존자 id)를 넘길 자리가 없다
      f(2, 'p2');
      // @ts-expect-error 자리 목록 · 역할을 넘길 수 없다
      f([{ x: 1, y: 2, role: 'runner' }]);
    };
    expect(typeof typeOnly).toBe('function');
    expect(roarResultText.length).toBe(1);
  });

  it('함께 사라져야 하는 알림은 밀려도 끝나는 시각을 늘리지 않고, 너무 늦으면 버린다', () => {
    const dur = balance.monster.roar.revealDuration * 1000;
    // 바로 뜨면 핑과 같은 시각에 끝난다
    expect(shownUntil(1000 + dur, true, 1016)).toBe(1000 + dur);
    // 다른 알림 둘에 밀려 늦게 떠도 그 시각 그대로
    expect(shownUntil(1000 + dur, true, 1000 + dur - BANNER_TIED_MIN_MS)).toBe(1000 + dur);
    // 남은 시간이 너무 짧거나 이미 지났으면 띄우지 않는다 (핑이 사라진 뒤에 글만 남지 않게)
    expect(shownUntil(1000 + dur, true, 1000 + dur - BANNER_TIED_MIN_MS + 1)).toBeNull();
    expect(shownUntil(1000 + dur, true, 1000 + dur + 500)).toBeNull();
    // 보통 알림은 예전 그대로: 남은 시간만큼, 밀렸어도 최소 0.8초
    expect(BANNER_MIN_MS).toBe(800);
    expect(shownUntil(3000, false, 1000)).toBe(3000);
    expect(shownUntil(3000, false, 2900)).toBe(2900 + 800);
    expect(shownUntil(3000, false, 9000)).toBe(9000 + 800);
  });
});

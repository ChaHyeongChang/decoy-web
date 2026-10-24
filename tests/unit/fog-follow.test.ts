// 내 빛 따라가기 (안개 주기 사이 내 시야를 지금 자리까지 옮겨 그린다, fogMath followShift · selfMarkGradient · followTexel ·
// FOG_EDGE_FRAG followLight · fogPaint LightMap.addSelfAt · LightRecord · art/fx DustField).
//  - Δ 규칙: 내 눈이 없거나 역할 · 상태가 바뀌었거나 FOLLOW_MAX를 넘으면 0
//  - 빛 지도에 칠하는 내 시야(내 덮임 표시): R · G는 예전 그라디언트와 같은 값, B만 SELF_MARK 낮다. source-over로 먼저 칠한다
//  - 셰이더 식(TS 쌍둥이 followTexel): Δ = 0이면 예전 그림, 움직이는 동안 밝게 그린 곳 ⊆ P_me(r + m)(주기 눈) ∩ D(지금 눈, r) ∪ 팀원 빛
//    (무작위 점), 팀원 빛과 겹치면 합집합, 8비트 반올림에도 표시를 읽는다
//  - GLSL 소스가 TS 쌍둥이와 같은 식
import { describe, expect, it } from 'vitest';
import {
  MAP_H,
  MAP_W,
  blocksVision,
  pointInPolygon,
  survivorVisionPolygon,
  survivorVisionRadius,
  type RoleId,
  type Vec2,
} from '@decoy/shared';
import { DustField } from '../../client/src/art/fx';
import { FOG } from '../../client/src/render/colors';
import {
  FOG_EDGE_FRAG,
  FOLLOW_EPS,
  FOLLOW_MAX,
  SELF_MARK,
  ambientRgb,
  followSamplePoint,
  followShift,
  followTexel,
  rgbCss,
  selfMarkGradient,
  softLightGeometry,
  type FollowUniforms,
} from '../../client/src/render/fogMath';
import { LightMap, LightRecord, type LightCtx, type LightSurface } from '../../client/src/render/fogPaint';
import { loadTestBalance } from '../helpers/fixtures';

const b = loadTestBalance();
const SOFT = b.survivor.visionSoftEdge;
const AMB_RGB = ambientRgb(FOG.ambient, FOG.tint);
const AMB = AMB_RGB.map((v) => v / 255) as [number, number, number];
const AMB_CSS = rgbCss(AMB_RGB);
const MARK = SELF_MARK / 255;
const ROLES: RoleId[] = ['runner', 'guard', 'scout'];

type RGB = [number, number, number];

function rng(seed: number): () => number {
  let s = seed;
  return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
}

function openPoint(rnd: () => number): Vec2 {
  for (;;) {
    const p = { x: 1 + rnd() * (MAP_W - 2), y: 1 + rnd() * (MAP_H - 2) };
    if (!blocksVision(Math.floor(p.x), Math.floor(p.y))) return p;
  }
}

/** 'rgb(r, g, b)' → 0~1 */
function parseRgb(css: string): RGB {
  const m = /^rgb\((\d+), (\d+), (\d+)\)$/.exec(css);
  if (!m) throw new Error(`색 ${css}`);
  return [Number(m[1]) / 255, Number(m[2]) / 255, Number(m[3]) / 255];
}

/** 캔버스 방사형 그라디언트 값 (같은 중심 두 원, 정지점 사이 선형) */
function gradientAt(d: number, inner: number, outer: number, stops: readonly [number, string][]): RGB {
  const u = Math.max(0, Math.min(1, (d - inner) / (outer - inner)));
  const s = stops.map(([o, c]) => [o, parseRgb(c)] as const);
  for (let i = 0; i < s.length; i += 1) {
    const [o, c] = s[i]!;
    if (u <= o) {
      if (i === 0) return [...c];
      const [o0, c0] = s[i - 1]!;
      const w = o === o0 ? 1 : (u - o0) / (o - o0);
      return [0, 1, 2].map((k) => c0[k]! + (c[k]! - c0[k]!) * w) as RGB;
    }
  }
  return [...s[s.length - 1]![1]];
}

/** 예전 생존자 시야 그라디언트 (흰색 → 하한, r − soft → r) 값 */
function oldSoft(d: number, r: number): RGB {
  const g = softLightGeometry(r, SOFT);
  return gradientAt(d, g.inner, g.outer, [
    [0, 'rgb(255, 255, 255)'],
    [1, AMB_CSS],
  ]);
}

interface Eye {
  pos: Vec2;
  r: number;
  poly: Vec2[];
}

interface Scene {
  /** 안개 주기 내 눈 (P_me(r + m)) */
  me: Eye & { far: Vec2[] };
  team: Eye[];
}

function makeScene(rnd: () => number, k: number): Scene {
  const role = ROLES[k % 3]!;
  const pos = openPoint(rnd);
  const r = survivorVisionRadius(b, role);
  const team: Eye[] = [];
  // 팀원은 반쯤은 가까이 (빛이 겹치게)
  for (let i = 0; i < 2; i += 1) {
    let tp = openPoint(rnd);
    if (rnd() < 0.6) {
      const near = { x: pos.x + (rnd() * 2 - 1) * 6, y: pos.y + (rnd() * 2 - 1) * 6 };
      if (near.x > 1 && near.y > 1 && near.x < MAP_W - 1 && near.y < MAP_H - 1)
        if (!blocksVision(Math.floor(near.x), Math.floor(near.y))) tp = near;
    }
    const tr = survivorVisionRadius(b, ROLES[(k + i + 1) % 3]!);
    team.push({ pos: tp, r: tr, poly: survivorVisionPolygon(tp, tr) });
  }
  return {
    me: { pos, r, poly: survivorVisionPolygon(pos, r), far: survivorVisionPolygon(pos, r + FOLLOW_MAX) },
    team,
  };
}

const q8 = (v: number): number => Math.round(v * 255) / 255;

/**
 * 새 빛 지도 한 칸 (모형): 바탕 하한 → 내 시야(P_me(r + m), 표시 그라디언트, source-over) → 팀원(lighten). quant면 8비트로
 */
function paintedNew(s: Scene, p: Vec2, quant: boolean): RGB {
  let px: RGB = [...AMB];
  if (pointInPolygon(p, s.me.far)) {
    const g = selfMarkGradient(s.me.r, SOFT, FOLLOW_MAX, AMB_RGB);
    px = gradientAt(Math.hypot(p.x - s.me.pos.x, p.y - s.me.pos.y), g.inner, g.outer, g.stops);
  }
  for (const t of s.team)
    if (pointInPolygon(p, t.poly)) {
      const v = oldSoft(Math.hypot(p.x - t.pos.x, p.y - t.pos.y), t.r);
      px = [Math.max(px[0], v[0]), Math.max(px[1], v[1]), Math.max(px[2], v[2])];
    }
  return quant ? [q8(px[0]), q8(px[1]), q8(px[2])] : px;
}

/** 예전 빛 지도 한 칸 (모형): 바탕 하한 → 모든 시야 lighten. myPoly = 내 시야 다각형 */
function paintedOld(s: Scene, p: Vec2, myPoly: readonly Vec2[]): RGB {
  let px: RGB = [...AMB];
  const eyes: { pos: Vec2; r: number; poly: readonly Vec2[] }[] = [{ ...s.me, poly: myPoly }, ...s.team];
  for (const t of eyes)
    if (pointInPolygon(p, t.poly)) {
      const v = oldSoft(Math.hypot(p.x - t.pos.x, p.y - t.pos.y), t.r);
      px = [Math.max(px[0], v[0]), Math.max(px[1], v[1]), Math.max(px[2], v[2])];
    }
  return px;
}

function uniforms(s: Scene, shift: Vec2): FollowUniforms {
  return {
    lightAmb: AMB,
    mark: MARK,
    selfOn: true,
    eyeFog: s.me.pos,
    eyeNow: { x: s.me.pos.x + shift.x, y: s.me.pos.y + shift.y },
    r: s.me.r,
    soft: SOFT,
    shiftOn: false,
    shift: { x: 0, y: 0 },
  };
}

/** 그린 밝기 (G로, 0~1) */
const tOf = (c: RGB): number => (c[1] - AMB[1]) / (1 - AMB[1]);

const lightOf = (d: number, r: number): number => Math.max(0, Math.min(1, (r - d) / SOFT));

describe('Δ 규칙 (followShift)', () => {
  const out = { x: 9, y: 9 };
  it('지금 자리 − 안개 주기 내 눈 자리 (같은 그릇에 쓴다)', () => {
    const r = followShift({ x: 10.2, y: 5.1 }, { x: 10, y: 5 }, true, out);
    expect(r).toBe(out);
    expect(r.x).toBeCloseTo(0.2, 12);
    expect(r.y).toBeCloseTo(0.1, 12);
  });
  it('내 눈이 없었거나 · 지금 자리가 없거나 · 역할 · 상태가 바뀌었으면 0', () => {
    expect(followShift({ x: 1, y: 1 }, null, true, out)).toEqual({ x: 0, y: 0 });
    expect(followShift(null, { x: 1, y: 1 }, true, out)).toEqual({ x: 0, y: 0 });
    expect(followShift({ x: 1.1, y: 1 }, { x: 1, y: 1 }, false, out)).toEqual({ x: 0, y: 0 });
  });
  it('FOLLOW_MAX(0.5타일)까지는 옮기고 넘으면(순간이동 · 수감) 0: 걷기 0.25 · 질주 0.36 · 괴물 0.18보다 크다', () => {
    expect(FOLLOW_MAX).toBe(0.5);
    // 걷기 · 질주 · 괴물이 한 안개 주기(생존자 50ms · 괴물 1/30초)에 가는 거리
    const walk = (b.survivor.moveSpeed * 50) / 1000;
    const sprint = (b.survivor.moveSpeed * b.roles.runner.sprintMultiplier * 50) / 1000;
    const monster = (b.monster.moveSpeed * 1000) / 30 / 1000;
    for (const d of [walk, sprint, monster]) expect(d).toBeLessThan(FOLLOW_MAX);
    expect(followShift({ x: 1.5, y: 1 }, { x: 1, y: 1 }, true, out).x).toBe(0.5);
    expect(followShift({ x: 1.5001, y: 1 }, { x: 1, y: 1 }, true, out)).toEqual({ x: 0, y: 0 });
    expect(followShift({ x: 1.4, y: 1.4 }, { x: 1, y: 1 }, true, out)).toEqual({ x: 0, y: 0 });
    expect(followShift({ x: Number.NaN, y: 1 }, { x: 1, y: 1 }, true, out)).toEqual({ x: 0, y: 0 });
  });
});

describe('내 덮임 표시 그라디언트 (selfMarkGradient)', () => {
  it('안쪽 r − soft · 바깥 r + reach, 정지점 0 흰색 − 표시 · soft/(soft + reach) 하한 − 표시 · 1 하한 − 표시', () => {
    const g = selfMarkGradient(6, 1.2, 0.5, AMB_RGB);
    expect(g.inner).toBeCloseTo(4.8, 12);
    expect(g.outer).toBe(6.5);
    expect(g.stops).toEqual([
      [0, `rgb(255, 255, ${255 - SELF_MARK})`],
      [1.2 / 1.7, `rgb(76, 88, ${101 - SELF_MARK})`],
      [1, `rgb(76, 88, ${101 - SELF_MARK})`],
    ]);
  });

  it('R · G는 예전 그라디언트(r − soft → r, 흰색 → 하한)와 같고 B만 표시만큼 낮다 (0 ~ r + reach)', () => {
    for (const role of ROLES) {
      const r = survivorVisionRadius(b, role);
      const g = selfMarkGradient(r, SOFT, FOLLOW_MAX, AMB_RGB);
      for (let d = 0; d <= r + FOLLOW_MAX; d += 0.01) {
        const v = gradientAt(d, g.inner, g.outer, g.stops);
        const o = d < r ? oldSoft(d, r) : AMB;
        expect(v[0]).toBeCloseTo(o[0], 9);
        expect(v[1]).toBeCloseTo(o[1], 9);
        expect(v[2]).toBeCloseTo(o[2] - MARK, 9);
      }
    }
  });

  it('표시 B는 0보다 크고 R · G는 늘 하한 이상 (바탕 위 source-over = lighten과 같은 R · G)', () => {
    expect(AMB_RGB[2] - SELF_MARK).toBeGreaterThan(0);
    const g = selfMarkGradient(6, SOFT, FOLLOW_MAX, AMB_RGB);
    for (const [, css] of g.stops) {
      const c = parseRgb(css);
      expect(c[0]).toBeGreaterThanOrEqual(AMB[0]);
      expect(c[1]).toBeGreaterThanOrEqual(AMB[1]);
    }
  });
});

describe('셰이더 식 (followTexel, GLSL followLight의 TS 쌍둥이)', () => {
  it('표시가 없으면(uSelfOn 0 · 표시 없는 칸) 텍스처 그대로 (uSelfOn이면 B만 반올림 차이 안)', () => {
    const rnd = rng(3);
    const s = makeScene(rnd, 0);
    const u = uniforms(s, { x: 0.2, y: 0 });
    for (let i = 0; i < 2000; i += 1) {
      const p = openPoint(rnd);
      const tex: RGB = [AMB[0] + rnd() * (1 - AMB[0]), 0, 0];
      tex[1] = AMB[1] + (tex[0] - AMB[0]) * ((1 - AMB[1]) / (1 - AMB[0]));
      tex[2] = AMB[2] + (tex[0] - AMB[0]) * ((1 - AMB[2]) / (1 - AMB[0]));
      expect(followTexel(tex, p, { ...u, selfOn: false })).toEqual(tex);
      const o = followTexel(tex, p, u);
      for (let c = 0; c < 3; c += 1) expect(o[c]).toBeCloseTo(tex[c]!, 12);
      // 8비트 반올림한 칸: B는 G가 말하는 값까지만 오른다 (±1 안)
      const q: RGB = [q8(tex[0]), q8(tex[1]), q8(tex[2])];
      const oq = followTexel(q, p, u);
      expect(oq[0]).toBe(q[0]);
      expect(oq[1]).toBe(q[1]);
      expect(oq[2] - q[2]).toBeGreaterThanOrEqual(0);
      expect(oq[2] - q[2]).toBeLessThanOrEqual(1 / 255);
    }
  });

  it('Δ = 0이면 예전 그림: 같은 다각형을 예전 그라디언트로 칠한 값과 같다 (8비트 반올림 ±1)', () => {
    const rnd = rng(20261101);
    let checked = 0;
    let marked = 0;
    for (let e = 0; e < 120; e += 1) {
      const s = makeScene(rnd, e);
      const u = uniforms(s, { x: 0, y: 0 });
      for (let i = 0; i < 80; i += 1) {
        const p = {
          x: s.me.pos.x + (rnd() * 2 - 1) * (s.me.r + 1),
          y: s.me.pos.y + (rnd() * 2 - 1) * (s.me.r + 1),
        };
        checked += 1;
        if (pointInPolygon(p, s.me.far)) marked += 1;
        const want = paintedOld(s, p, s.me.far);
        // 실수 모형: 정확히 같다
        const exact = followTexel(paintedNew(s, p, false), p, u);
        for (let c = 0; c < 3; c += 1) expect(exact[c]).toBeCloseTo(want[c]!, 9);
        // 8비트 텍스처: ±1/255 안
        const q = followTexel(paintedNew(s, p, true), p, u);
        for (let c = 0; c < 3; c += 1) expect(Math.abs(q[c]! - want[c]!)).toBeLessThanOrEqual(1.2 / 255);
      }
    }
    expect(checked).toBe(9600);
    expect(marked).toBeGreaterThan(2000);
  });

  it('반경 r + m 다각형은 r 안에서 예전 다각형(반경 r)과 같은 곳을 덮는다 (꼭짓점 근사 차이 1% 미만, 벽 가까이)', () => {
    const rnd = rng(42);
    let n = 0;
    let diff = 0;
    for (let e = 0; e < 200; e += 1) {
      const s = makeScene(rnd, e);
      for (let i = 0; i < 50; i += 1) {
        const a = rnd() * Math.PI * 2;
        const d = rnd() * (s.me.r - 0.02);
        const p = { x: s.me.pos.x + Math.cos(a) * d, y: s.me.pos.y + Math.sin(a) * d };
        n += 1;
        if (pointInPolygon(p, s.me.poly) !== pointInPolygon(p, s.me.far)) diff += 1;
      }
    }
    expect(diff / n).toBeLessThan(0.01);
  });

  for (const quant of [false, true])
    it(`움직이는 동안 밝게 그린 곳 ⊆ P_me(r + m)(주기 눈) ∩ D(지금 눈, r) ∪ 팀원 빛 (무작위 점 2만 개${quant ? ', 8비트 텍스처' : ''})`, () => {
      const rnd = rng(quant ? 777 : 778);
      let lit = 0;
      let moved = 0;
      let violations = 0;
      for (let e = 0; e < 250; e += 1) {
        const s = makeScene(rnd, e);
        const a = rnd() * Math.PI * 2;
        const len = rnd() * FOLLOW_MAX;
        const shift = { x: Math.cos(a) * len, y: Math.sin(a) * len };
        const u = uniforms(s, shift);
        for (let i = 0; i < 80; i += 1) {
          const p = {
            x: s.me.pos.x + (rnd() * 2 - 1) * (s.me.r + 1.5),
            y: s.me.pos.y + (rnd() * 2 - 1) * (s.me.r + 1.5),
          };
          const t = tOf(followTexel(paintedNew(s, p, quant), p, u));
          // 8비트: 반올림 흔들림(1/167 남짓)보다 큰 밝기만 '밝게'로 센다
          if (t <= (quant ? 0.02 : 1e-9)) continue;
          lit += 1;
          const mine = pointInPolygon(p, s.me.far) && Math.hypot(p.x - u.eyeNow.x, p.y - u.eyeNow.y) < s.me.r;
          const team = s.team.some(
            (q) => pointInPolygon(p, q.poly) && Math.hypot(p.x - q.pos.x, p.y - q.pos.y) < q.r,
          );
          if (!mine && !team) violations += 1;
          if (mine && !pointInPolygon(p, s.me.poly)) moved += 1;
        }
      }
      expect(lit).toBeGreaterThan(5000);
      // 주기 다각형 P(r) 밖인데 지금 반경 안이라 밝게 그린 곳 (따라가기가 실제로 일어났다)
      expect(moved).toBeGreaterThan(50);
      expect(violations).toBe(0);
    });

  it('팀원 빛이 없으면 내 빛 = 지금 눈 둘레 밝기 곡선 (P_me(r + m) 안), 팀원 빛이 더 밝은 곳은 합집합', () => {
    const rnd = rng(9);
    let teamMax = 0;
    for (let e = 0; e < 150; e += 1) {
      const s = makeScene(rnd, e);
      const shift = { x: (rnd() * 2 - 1) * 0.35, y: (rnd() * 2 - 1) * 0.35 };
      const u = uniforms(s, shift);
      const alone: Scene = { me: s.me, team: [] };
      for (let i = 0; i < 60; i += 1) {
        const p = {
          x: s.me.pos.x + (rnd() * 2 - 1) * (s.me.r + 1),
          y: s.me.pos.y + (rnd() * 2 - 1) * (s.me.r + 1),
        };
        const dNow = Math.hypot(p.x - u.eyeNow.x, p.y - u.eyeNow.y);
        const t = tOf(followTexel(paintedNew(alone, p, false), p, u));
        expect(t).toBeCloseTo(pointInPolygon(p, s.me.far) ? lightOf(dNow, s.me.r) : 0, 9);
        // 팀원 빛이 내 주기 빛보다 FOLLOW_EPS 넘게 밝은 곳: max(팀원, 지금 내 빛)
        const team = Math.max(
          0,
          ...s.team.map((q) =>
            pointInPolygon(p, q.poly) ? lightOf(Math.hypot(p.x - q.pos.x, p.y - q.pos.y), q.r) : 0,
          ),
        );
        const inMe = pointInPolygon(p, s.me.far);
        const gFog = inMe ? lightOf(Math.hypot(p.x - s.me.pos.x, p.y - s.me.pos.y), s.me.r) : 0;
        if (inMe && team > gFog + FOLLOW_EPS) {
          teamMax += 1;
          const tt = tOf(followTexel(paintedNew(s, p, false), p, u));
          expect(tt).toBeCloseTo(Math.max(team, lightOf(dNow, s.me.r)), 9);
        }
      }
    }
    expect(teamMax).toBeGreaterThan(50);
  });

  it('괴물: 빛 지도를 통째로 Δ만큼 옮겨 읽는다 (점 − Δ), 맵 밖은 하한(null)', () => {
    const u: FollowUniforms = {
      lightAmb: AMB,
      mark: MARK,
      selfOn: false,
      eyeFog: { x: 0, y: 0 },
      eyeNow: { x: 0, y: 0 },
      r: 1,
      soft: 1,
      shiftOn: true,
      shift: { x: 0.18, y: -0.05 },
    };
    expect(followSamplePoint({ x: 10, y: 10 }, u, MAP_W, MAP_H)).toEqual({ x: 10 - 0.18, y: 10.05 });
    expect(followSamplePoint({ x: 0.1, y: 10 }, u, MAP_W, MAP_H)).toBeNull();
    expect(followSamplePoint({ x: 10, y: MAP_H - 0.01 }, u, MAP_W, MAP_H)).toBeNull();
    const off = { ...u, shiftOn: false };
    const p = { x: 3, y: 4 };
    expect(followSamplePoint(p, off, MAP_W, MAP_H)).toBe(p);
  });
});

describe('GLSL followLight (FOG_EDGE_FRAG)가 TS 쌍둥이와 같은 식', () => {
  const src = FOG_EDGE_FRAG.replace(/\s+/g, ' ');
  const has = (line: string): boolean => src.includes(line.replace(/\s+/g, ' '));
  it('생존자: 관측 밝기 · 기대 B · 표시 정도 · 지금 자리 밝기 · 합치기 · 되살리기', () => {
    expect(has('float tObs = clamp((tex.g - a.g) / max(0.001, 1.0 - a.g), 0.0, 1.0);')).toBe(true);
    expect(has('float expB = a.b + (1.0 - a.b) * tObs;')).toBe(true);
    expect(has('float c = smoothstep(0.25, 0.75, (expB - tex.b) / uMark);')).toBe(true);
    expect(has('if (c <= 0.0) return vec4(tex.r, tex.g, max(tex.b, expB), tex.a);')).toBe(true);
    expect(has('if (uSelfOn < 0.5) return tex;')).toBe(true);
    expect(has('return clamp((uR - distance(p, eye)) / max(uSoft, 0.0001), 0.0, 1.0);')).toBe(true);
    expect(has('vec2 p = uv * uMapSize;')).toBe(true);
    expect(
      has(
        `float t = tObs <= gFog + ${FOLLOW_EPS.toFixed(4)} ? clamp(tObs + c * (gNow - gFog), 0.0, 1.0) : max(tObs, c * gNow);`,
      ),
    ).toBe(true);
    expect(has('return vec4(a + (1.0 - a) * t, tex.a);')).toBe(true);
  });
  it('괴물: uv − Δ / 맵 크기, 맵 밖은 하한. 경계 어둡게는 따라간 빛에 건다', () => {
    expect(has('vec2 s = uv - uShift / uMapSize;')).toBe(true);
    expect(has('if (s.x < 0.0 || s.y < 0.0 || s.x > 1.0 || s.y > 1.0) return vec4(uLightAmb, 1.0);')).toBe(
      true,
    );
    expect(has('vec4 light = followLight(outTexCoord);')).toBe(true);
    // 텍스처를 직접 읽어 경계 어둡게에 쓰지 않는다 (따라간 빛만)
    expect(src.match(/texture2D\(/g)).toHaveLength(2);
  });
});

// ───────────── 빛 지도에 칠하는 것 (기록용 컨텍스트) ─────────────

interface Fill {
  op: string;
  path: Vec2[];
  grad: { r0: number; r1: number; stops: [number, string][] } | null;
  color: string | null;
}

function recording(ambient: readonly [number, number, number] | null): {
  map: LightMap<{ width: number; height: number }>;
  fills: Fill[];
} {
  const fills: Fill[] = [];
  let path: Vec2[] = [];
  const grads = new Map<CanvasGradient, { r0: number; r1: number; stops: [number, string][] }>();
  const stack: string[] = [];
  const ctx: LightCtx = {
    globalCompositeOperation: 'source-over',
    fillStyle: '#000000',
    save() {
      stack.push(this.globalCompositeOperation);
    },
    restore() {
      this.globalCompositeOperation = (stack.pop() ?? 'source-over') as GlobalCompositeOperation;
    },
    beginPath() {
      path = [];
    },
    moveTo(x: number, y: number) {
      path.push({ x, y });
    },
    lineTo(x: number, y: number) {
      path.push({ x, y });
    },
    closePath() {},
    fill() {
      const f = this.fillStyle;
      const g = typeof f === 'string' ? null : (grads.get(f as CanvasGradient) ?? null);
      fills.push({
        op: this.globalCompositeOperation,
        path: [...path],
        grad: g,
        color: typeof f === 'string' ? f : null,
      });
    },
    fillRect() {},
    createRadialGradient(_x0: number, _y0: number, r0: number, _x1: number, _y1: number, r1: number) {
      const rec = { r0, r1, stops: [] as [number, string][] };
      const g: CanvasGradient = { addColorStop: (o: number, c: string) => void rec.stops.push([o, c]) };
      grads.set(g, rec);
      return g;
    },
  };
  const surface = (width: number, height: number): LightSurface<{ width: number; height: number }> => ({
    canvas: { width, height },
    ctx,
  });
  return { map: new LightMap(16, AMB_CSS, surface, ambient), fills };
}

describe('빛 지도: 내 시야는 내 덮임 표시와 함께 source-over로 먼저 칠한다', () => {
  const eye = { x: 21.5, y: 25 };
  const r = 6;
  const far = survivorVisionPolygon(eye, r + FOLLOW_MAX);
  const team = survivorVisionPolygon({ x: 24, y: 25 }, 7.5);

  it('addSelfAt: 경로 = P(r + m) × k, 그라디언트 = selfMarkGradient × k, source-over (칠한 뒤 되돌린다)', () => {
    const { map, fills } = recording(AMB_RGB);
    map.addSelfAt(far, eye.x, eye.y, r, SOFT, FOLLOW_MAX);
    expect(fills).toHaveLength(1);
    const f = fills[0]!;
    expect(f.op).toBe('source-over');
    expect(f.path).toEqual(far.map((p) => ({ x: p.x * 16, y: p.y * 16 })));
    const g = selfMarkGradient(r, SOFT, FOLLOW_MAX, AMB_RGB);
    expect(f.grad?.r0).toBeCloseTo(g.inner * 16, 9);
    expect(f.grad?.r1).toBeCloseTo(g.outer * 16, 9);
    expect(f.grad?.stops).toEqual(g.stops);
  });

  it('바탕 RGB를 모르면(Canvas 합성 · 옛 호출) 표시 없이 보통 시야와 같다 (lighten)', () => {
    const { map, fills } = recording(null);
    map.addSelfAt(far, eye.x, eye.y, r, SOFT, FOLLOW_MAX);
    expect(fills[0]?.op).toBe('lighten');
    expect(fills[0]?.grad?.stops).toEqual([
      [0, '#ffffff'],
      [1, AMB_CSS],
    ]);
  });

  it('LightRecord: 더한 순서와 상관없이 내 시야(reach > 0)를 먼저 칠하고 나머지는 lighten', () => {
    const { map, fills } = recording(AMB_RGB);
    const rec = new LightRecord();
    rec.addSoft({ poly: team, center: { x: 24, y: 25 }, radius: 7.5, soft: SOFT });
    rec.addSoft({ poly: far, center: eye, radius: r, soft: SOFT, reach: FOLLOW_MAX });
    expect(rec.paint(map)).toBe(true);
    expect(fills.map((f) => f.op)).toEqual(['source-over', 'lighten']);
    expect(fills[0]?.path).toHaveLength(far.length);
    expect(fills[1]?.path).toHaveLength(team.length);
  });

  it('LightRecord: reach가 바뀌면 다시 칠한다 (같으면 칠하지 않는다)', () => {
    const { map } = recording(AMB_RGB);
    const rec = new LightRecord();
    const add = (reach: number): void => {
      rec.reset();
      rec.addSoft({ poly: far, center: eye, radius: r, soft: SOFT, reach });
    };
    add(FOLLOW_MAX);
    expect(rec.paint(map)).toBe(true);
    add(FOLLOW_MAX);
    expect(rec.paint(map)).toBe(false);
    add(0);
    expect(rec.paint(map)).toBe(true);
  });
});

describe('빛 속 먼지: 내 눈은 Δ만큼 옮긴 시야에서 (DustField dx · dy)', () => {
  const eye = { x: 21.5, y: 16.5 };
  const poly = survivorVisionPolygon(eye, 6);
  const shiftPoly = (d: Vec2): Vec2[] => poly.map((p) => ({ x: p.x + d.x, y: p.y + d.y }));

  it('Δ = 0이면 dx · dy가 없을 때와 비트 단위로 같다', () => {
    const a = new DustField();
    const c = new DustField();
    for (let t = 0; t < 30; t += 0.37) {
      const m0 = a.motes(t, [{ poly, center: eye, radius: 4.8 }], 40).map((m) => ({ ...m }));
      const m1 = c.motes(t, [{ poly, center: eye, radius: 4.8, dx: 0, dy: 0 }], 40).map((m) => ({ ...m }));
      expect(m1).toEqual(m0);
    }
  });

  it('Δ가 있으면 다각형 · 중심을 Δ만큼 옮긴 눈과 같은 먼지 (반경 검사는 옮긴 중심 둘레)', () => {
    const rnd = rng(11);
    for (let i = 0; i < 40; i += 1) {
      const d = { x: (rnd() * 2 - 1) * 0.45, y: (rnd() * 2 - 1) * 0.3 };
      const t = rnd() * 40;
      const moved = new DustField()
        .motes(t, [{ poly: shiftPoly(d), center: { x: eye.x + d.x, y: eye.y + d.y }, radius: 4.8 }], 40)
        .map((m) => ({ ...m }));
      const follow = new DustField()
        .motes(t, [{ poly, center: eye, radius: 4.8, dx: d.x, dy: d.y }], 40)
        .map((m) => ({ ...m }));
      expect(follow.length).toBe(moved.length);
      follow.forEach((m, k) => {
        expect(m.x).toBeCloseTo(moved[k]!.x, 12);
        expect(m.y).toBeCloseTo(moved[k]!.y, 12);
      });
    }
  });
});

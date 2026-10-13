// 렌더링 최적화 2 (G1 월드): 프레임마다 만들던 배열 · 객체를 줄이고 계산을 건너뛴 함수가 예전 구현과 같은 결과를 내는지 본다.
// 예전 구현을 이 파일에 그대로 두고(오라클) 무작위 입력 여러 개에서 비트 단위로 견준다(숫자는 문자열로 바꿔 견준다: −0 · 마지막 자리까지).
//  - unionOutline: 경계 상자 밖이면 점-다각형 검사를 건너뛰고 숫자로 잰다
//  - 빛 속 먼지 DustField: 칸 목록을 눈의 자리 · 반경이 바뀔 때만 다시 만든다
//  - 노출 문양 · 기절 별 자리 glyphSlot · starSlot: 후보마다 원 배열을 만들지 않는다
//  - 자세 walkPose · hitReact · hiddenSurvivorPose: 그릇(out)에 쓴다
//  - 빨강 부채꼴 해치 drawConeHatch: 줄마다 교차 배열 · 객체를 만들지 않는다
//  - 시야 림 traceRim: WebGL은 이어진 변을 한 줄로 (펼친 선분이 예전과 같은 순서 · 같은 값), Canvas는 예전 명령 그대로
//  - 돌진 잔상 DashTrail.live: 목록을 제자리에서 걸러 항목을 다시 쓴다
//  - 삼각형 부채 채우기 fillCircleFan · fillFanPolygon: 같은 꼭짓점, 다각형과 같은 영역을 겹침 없이 덮는다
//  - 시야 다각형 캐시 peek · put
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Rng, angleDiff, pointInPolygon, type Vec2 } from '@decoy/shared';
import { validateBalance } from '../../shared/src/balance';
import { monsterConePolygon, monsterNearPolygon, survivorVisionPolygon } from '../../shared/src/visibility';
import {
  ANIM,
  breathScale,
  hiddenSurvivorPose,
  hitReact,
  newHiddenSurvivorPose,
  newWalkPose,
  protectBlink,
  walkPose,
  hatchPulse,
  HIDDEN_BREATH_SEED,
  type HitReact,
  type WalkPose,
} from '../../client/src/art/anim';
import {
  DUST,
  DashTrail,
  DustField,
  FxSystem,
  GHOST_EVERY_MS,
  DASH_GAP_MS,
  DASH_GHOST_MS,
  dustMotes,
  type DustEye,
  type DustMote,
  type FxPen,
  type Ghost,
} from '../../client/src/art/fx';
import {
  GLYPH_PLACE,
  GLYPH_SLOTS,
  STUN_STARS,
  fillCircleFan,
  fillCirclePen,
  glyphSlot,
  pickSlot,
  starSlot,
  stunOrbitDist,
  type Disc,
  type FanPen,
  type PathPen,
} from '../../client/src/art/shapes';
import { PolyCache, unionOutline } from '../../client/src/render/fogMath';
import { CONE_LOOK, drawConeHatch, fillFanPolygon, traceRim } from '../../client/src/render/vision';
import { MAP_SCALE } from '../../client/src/ui/layout';

const b = validateBalance(JSON.parse(readFileSync('config/balance.json', 'utf8')));
const T = 32;

/** 숫자를 비트 단위로 견주려고 문자열로 (−0도 구별) */
const n = (v: number): string => (Object.is(v, -0) ? '-0' : String(v));

/** 모든 호출을 문자열로 남기는 펜 */
function logPen(): FanPen & { log: string[] } {
  const log: string[] = [];
  return {
    log,
    fillStyle: (c: number, a = 1) => log.push(`fs ${c} ${n(a)}`),
    lineStyle: (w: number, c: number, a = 1) => log.push(`ls ${n(w)} ${c} ${n(a)}`),
    beginPath: () => log.push('begin'),
    closePath: () => log.push('close'),
    fillPath: () => log.push('fill'),
    strokePath: () => log.push('stroke'),
    moveTo: (x: number, y: number) => log.push(`m ${n(x)} ${n(y)}`),
    lineTo: (x: number, y: number) => log.push(`l ${n(x)} ${n(y)}`),
    fillTriangle: (x0: number, y0: number, x1: number, y1: number, x2: number, y2: number) =>
      log.push(`tri ${n(x0)} ${n(y0)} ${n(x1)} ${n(y1)} ${n(x2)} ${n(y2)}`),
  };
}

/** 맵 안 무작위 자리 (벽 안일 수도 있다: 그래도 같아야 한다) */
function randomEye(rng: Rng): Vec2 {
  return { x: 1.5 + rng.next() * 45, y: 1.5 + rng.next() * 29 };
}

// ───────────────────────── unionOutline ─────────────────────────

/** 렌더링 최적화 2 전 구현 그대로 */
function unionOutlineOld(polys: readonly (readonly Vec2[])[], step = 0.1): [Vec2, Vec2][] {
  const out: [Vec2, Vec2][] = [];
  for (let pi = 0; pi < polys.length; pi += 1) {
    const poly = polys[pi];
    if (!poly || poly.length < 3) continue;
    const others = polys.filter((q, qi) => qi !== pi && q.length >= 3);
    for (let i = 0; i < poly.length; i += 1) {
      const a = poly[i];
      const bb = poly[(i + 1) % poly.length];
      if (!a || !bb) continue;
      const len = Math.hypot(bb.x - a.x, bb.y - a.y);
      const k1 = Math.max(1, Math.ceil(len / step));
      let runStart: Vec2 | null = null;
      for (let k = 0; k < k1; k += 1) {
        const t0 = k / k1;
        const t1 = (k + 1) / k1;
        const mid = { x: a.x + (bb.x - a.x) * ((t0 + t1) / 2), y: a.y + (bb.y - a.y) * ((t0 + t1) / 2) };
        const hidden = others.some((q) => pointInPolygon(mid, q));
        const p0 = { x: a.x + (bb.x - a.x) * t0, y: a.y + (bb.y - a.y) * t0 };
        if (!hidden && runStart === null) runStart = p0;
        if (hidden && runStart !== null) {
          out.push([runStart, p0]);
          runStart = null;
        }
      }
      if (runStart !== null) out.push([runStart, { x: bb.x, y: bb.y }]);
    }
  }
  return out;
}

const segText = (segs: readonly (readonly [Vec2, Vec2])[]): string[] =>
  segs.map(([p, q]) => `${n(p.x)} ${n(p.y)} ${n(q.x)} ${n(q.y)}`);

describe('unionOutline: 경계 상자 밖 건너뛰기 · 숫자로 재기 — 예전 구현과 같다', () => {
  it('실제 판정 다각형 (부채꼴 ∪ 근접 원) 무작위 자리 · 방향 · 모양 300가지', () => {
    const rng = new Rng(20261013);
    let segs = 0;
    for (let k = 0; k < 300; k += 1) {
      const eye = randomEye(rng);
      const aim = rng.next() * Math.PI * 4 - Math.PI * 2;
      const blend = [0, 1, rng.next()][k % 3] ?? 0;
      const cone = monsterConePolygon(b, eye, aim, blend);
      const near = monsterNearPolygon(b, eye);
      const now = unionOutline([cone, near]);
      expect(segText(now)).toEqual(segText(unionOutlineOld([cone, near])));
      segs += now.length;
    }
    expect(segs).toBeGreaterThan(300 * 10);
  });

  it('겹친 · 떨어진 · 안에 든 사각형과 무작위 다각형, 꼭짓점 3개 미만, 조각 간격', () => {
    const rng = new Rng(7);
    const sq = (x: number, y: number, s: number): Vec2[] => [
      { x, y },
      { x: x + s, y },
      { x: x + s, y: y + s },
      { x, y: y + s },
    ];
    const blob = (): Vec2[] => {
      const c = randomEye(rng);
      const m = 3 + Math.floor(rng.next() * 9);
      const out: Vec2[] = [];
      for (let i = 0; i < m; i += 1) {
        const a = (i / m) * Math.PI * 2;
        const r = 0.5 + rng.next() * 4;
        out.push({ x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r });
      }
      return out;
    };
    const cases: Vec2[][][] = [
      [sq(0, 0, 1), sq(5, 5, 2)],
      [sq(0, 0, 4), sq(1, 1, 1)],
      [sq(0, 0, 2), sq(1, 0, 2)],
      [sq(0, 0, 2), sq(2, 0, 2)],
      [
        sq(0, 0, 2),
        [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
        sq(1, 1, 3),
      ],
    ];
    for (let k = 0; k < 200; k += 1) cases.push([blob(), blob(), ...(k % 4 === 0 ? [blob()] : [])]);
    for (const polys of cases)
      for (const step of [0.1, 0.05, 0.37])
        expect(segText(unionOutline(polys, step))).toEqual(segText(unionOutlineOld(polys, step)));
  });
});

// ───────────────────────── 빛 속 먼지 ─────────────────────────

function hash2(i: number, j: number, salt: number): number {
  let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(salt, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** 렌더링 최적화 2 전 dustMotes 그대로 (프레임마다 칸을 나열 · 정렬) */
function dustMotesOld(tS: number, eyes: readonly DustEye[], count: number): DustMote[] {
  if (count <= 0 || eyes.length === 0) return [];
  const cell = DUST.cell;
  const seen = new Set<number>();
  const cells: { pri: number; i: number; j: number }[] = [];
  for (const e of eyes) {
    const i0 = Math.floor((e.center.x - e.radius) / cell);
    const i1 = Math.floor((e.center.x + e.radius) / cell);
    const j0 = Math.floor((e.center.y - e.radius) / cell);
    const j1 = Math.floor((e.center.y + e.radius) / cell);
    for (let j = j0; j <= j1; j += 1) {
      for (let i = i0; i <= i1; i += 1) {
        const key = j * 4096 + i;
        if (seen.has(key)) continue;
        seen.add(key);
        cells.push({ pri: hash2(i, j, 7), i, j });
      }
    }
  }
  cells.sort((a, c) => a.pri - c.pri);
  const out: DustMote[] = [];
  for (const { i, j } of cells) {
    if (out.length >= count) break;
    const period = DUST.periodMinS + hash2(i, j, 3) * (DUST.periodMaxS - DUST.periodMinS);
    const ph = (tS / period + hash2(i, j, 4)) % 1;
    const wob = tS * 0.21 + hash2(i, j, 5) * 6.28;
    const x = (i + 0.2 + 0.6 * hash2(i, j, 1)) * cell + Math.sin(wob) * DUST.drift;
    const y = (j + 0.2 + 0.6 * hash2(i, j, 2)) * cell + Math.cos(wob * 0.8) * DUST.drift - ph * 0.3;
    let inside = false;
    for (const q of eyes) {
      if (Math.hypot(x - q.center.x, y - q.center.y) > q.radius) continue;
      if (pointInPolygon({ x, y }, q.poly)) {
        inside = true;
        break;
      }
    }
    if (!inside) continue;
    out.push({
      x,
      y,
      alpha: DUST.alpha * Math.sin(Math.PI * ph),
      size: DUST.sizePx * (0.6 + 0.4 * hash2(i, j, 6)),
    });
  }
  return out;
}

const moteText = (ms: readonly DustMote[]): string[] =>
  ms.map((m) => `${n(m.x)} ${n(m.y)} ${n(m.alpha)} ${n(m.size)}`);

function survivorEyes(rng: Rng, k: number): DustEye[] {
  const eyes: DustEye[] = [];
  for (let i = 0; i < k; i += 1) {
    const center = randomEye(rng);
    const r = [b.survivor.visionRadius, b.roles.scout.visionRadius][i % 2] ?? 5;
    eyes.push({ poly: survivorVisionPolygon(center, r), center, radius: r - b.survivor.visionSoftEdge });
  }
  return eyes;
}

describe('빛 속 먼지 DustField: 칸 목록을 다시 쓰는 계산기 — 예전 dustMotes와 같다', () => {
  it('프레임처럼 이어 부른다: 눈이 그대로인 프레임 · 움직인 프레임 · 개수가 바뀐 프레임 (600프레임)', () => {
    const rng = new Rng(20261014);
    const field = new DustField();
    let eyes = survivorEyes(rng, 3);
    let motes = 0;
    for (let f = 0; f < 600; f += 1) {
      const t = 3 + f / 60;
      // 안개 주기마다(3프레임) 가끔 눈 하나가 움직인다 · 눈 수가 바뀐다
      if (f % 3 === 0 && rng.next() < 0.4) {
        const k = 1 + Math.floor(rng.next() * 3);
        eyes = rng.next() < 0.2 ? survivorEyes(rng, k) : eyes.map((e) => ({ ...e }));
        const e = eyes[0];
        if (e) {
          const center = {
            x: e.center.x + (rng.next() - 0.5) * 0.3,
            y: e.center.y + (rng.next() - 0.5) * 0.3,
          };
          eyes[0] = { poly: survivorVisionPolygon(center, 5), center, radius: 5 - b.survivor.visionSoftEdge };
        }
      }
      const count = [40, 15, 40, 1][Math.floor(f / 150)] ?? 40;
      const now = field.motes(t, eyes, count);
      expect(moteText(now)).toEqual(moteText(dustMotesOld(t, eyes, count)));
      motes += now.length;
    }
    expect(motes).toBeGreaterThan(600 * 5);
    // 칸 목록은 눈이 바뀐 때만 다시 만든다
    expect(field.rebuilds).toBeLessThan(250);
  });

  it('중심 객체를 제자리에서 바꿔도(예측한 내 자리) 바뀐 값으로 다시 만든다 · 괴물 시야 (부채꼴 + 근접 원) · 빈 입력', () => {
    const field = new DustField();
    const center = { x: 24, y: 20.5 };
    for (let k = 0; k < 120; k += 1) {
      center.x = 24 + Math.sin(k / 9) * 3;
      const cone = monsterConePolygon(b, center, k / 7, (k % 10) / 10);
      const near = monsterNearPolygon(b, center);
      const eyes: DustEye[] = [
        { poly: cone, center, radius: 9 },
        { poly: near, center, radius: b.monster.nearVisionRadius },
      ];
      const t = k * 0.173;
      expect(moteText(field.motes(t, eyes, 40))).toEqual(moteText(dustMotesOld(t, eyes, 40)));
    }
    expect(field.motes(1, [], 40)).toHaveLength(0);
    const eyes = survivorEyes(new Rng(3), 2);
    expect(field.motes(1, eyes, 0)).toHaveLength(0);
    // 순수 함수판도 같다
    expect(moteText(dustMotes(7.25, eyes, 40))).toEqual(moteText(dustMotesOld(7.25, eyes, 40)));
  });
});

// ───────────────────────── 노출 문양 · 기절 별 자리 ─────────────────────────

function glyphSlotOld(self: Vec2, bodyR: number, others: readonly Disc[], prev: number | null): number {
  const d = GLYPH_PLACE.dist * bodyR;
  return pickSlot(
    GLYPH_SLOTS,
    (a) => [{ x: self.x + Math.cos(a) * d, y: self.y + Math.sin(a) * d, r: GLYPH_PLACE.r * bodyR }],
    others,
    prev,
  );
}

function starSlotOld(
  center: Vec2,
  bodyR: number,
  tilePx: number,
  others: readonly Disc[],
  prev: number | null,
): number {
  const S = STUN_STARS;
  const sr = (S.outer + S.edge) / tilePx;
  return pickSlot(
    GLYPH_SLOTS,
    (a) => {
      const d = stunOrbitDist(bodyR, tilePx, a);
      const cx = center.x + Math.cos(a) * d;
      const cy = center.y + Math.sin(a) * d;
      const out: Disc[] = [];
      for (let i = 0; i < 12; i += 1) {
        const t = (i / 12) * Math.PI * 2;
        out.push({
          x: cx + (Math.cos(t) * S.orbitX) / tilePx,
          y: cy + (Math.sin(t) * S.orbitY) / tilePx,
          r: sr,
        });
      }
      return out;
    },
    others,
    prev,
  );
}

describe('노출 문양 · 기절 별 자리: 후보마다 원 배열을 만들지 않아도 예전 pickSlot과 같다', () => {
  it('무작위 옆 몸 0~4개 · 지난 자리 있음/없음 2000가지', () => {
    const rng = new Rng(99);
    const sR = b.survivor.radius;
    const mR = b.monster.radius;
    const dirs = new Set<number>();
    for (let k = 0; k < 2000; k += 1) {
      const self = { x: 10 + rng.next() * 4, y: 10 + rng.next() * 4 };
      const m = Math.floor(rng.next() * 5);
      const others: Disc[] = [];
      for (let i = 0; i < m; i += 1)
        others.push({
          x: self.x + (rng.next() - 0.5) * 3.5,
          y: self.y + (rng.next() - 0.5) * 3.5,
          r: rng.next() < 0.5 ? sR : mR,
        });
      const prev = rng.next() < 0.5 ? null : (GLYPH_SLOTS[Math.floor(rng.next() * 8)] ?? null);
      const g = glyphSlot(self, sR, others, prev);
      expect(n(g)).toBe(n(glyphSlotOld(self, sR, others, prev)));
      const s = starSlot(self, mR, T, others, prev);
      expect(n(s)).toBe(n(starSlotOld(self, mR, T, others, prev)));
      dirs.add(s);
    }
    // 머리 위만 견준 것이 아니다
    expect(dirs.size).toBeGreaterThan(4);
  });
});

// ───────────────────────── 자세 그릇 ─────────────────────────

function walkPoseOld(phase: number, stepping: number): WalkPose {
  const k = Math.max(0, Math.min(1, stepping));
  const s = Math.sin(phase);
  return {
    feet: [
      { x: ANIM.footReach * s * k, y: -ANIM.footSide },
      { x: -ANIM.footReach * s * k, y: ANIM.footSide },
    ],
    lean: ((ANIM.leanDeg * Math.PI) / 180) * Math.sin(phase) * k,
  };
}

function hitReactOld(elapsedMs: number): HitReact {
  if (elapsedMs < 0) return { flash: 0, squash: 0 };
  return {
    flash: Math.max(0, Math.min(1, 1 - elapsedMs / ANIM.hitFlashMs)),
    squash: elapsedMs >= ANIM.squashMs ? 0 : Math.sin((Math.PI * elapsedMs) / ANIM.squashMs),
  };
}

const walkText = (w: WalkPose): string =>
  `${n(w.feet[0].x)} ${n(w.feet[0].y)} ${n(w.feet[1].x)} ${n(w.feet[1].y)} ${n(w.lean)}`;

describe('자세 그릇: 그릇에 써도 예전과 같은 값', () => {
  it('walkPose · hitReact · hiddenSurvivorPose (같은 그릇을 이어 쓴다)', () => {
    const rng = new Rng(5);
    const wOut = newWalkPose();
    const hOut: HitReact = { flash: 0, squash: 0 };
    const pOut = newHiddenSurvivorPose();
    for (let k = 0; k < 1000; k += 1) {
      const phase = rng.next() * 20 - 5;
      const stepping = rng.next() * 1.4 - 0.2;
      expect(walkText(walkPose(phase, stepping, wOut))).toBe(walkText(walkPoseOld(phase, stepping)));
      expect(walkText(walkPose(phase, stepping))).toBe(walkText(walkPoseOld(phase, stepping)));
      const ms = rng.next() * 300 - 50;
      const h = hitReact(ms, hOut);
      const o = hitReactOld(ms);
      expect(`${n(h.flash)} ${n(h.squash)}`).toBe(`${n(o.flash)} ${n(o.squash)}`);
      const prot = rng.next() < 0.3;
      const reveal = rng.next() < 0.2 ? 'scout' : null;
      const clock = rng.next() * 1e5;
      const p = hiddenSurvivorPose(1, 2, phase, phase, stepping, prot, reveal, clock, 0.5, pOut);
      const w = walkPoseOld(phase, stepping);
      expect(p).toBe(pOut);
      expect({ ...p, feet: walkText({ feet: p.feet, lean: 0 }) }).toEqual({
        sprite: 'survivor-hidden',
        foot: 'foot-hidden',
        shadow: 'shadow-survivor',
        x: 1,
        y: 2,
        rotation: phase + w.lean,
        scale: breathScale(clock / 1000, HIDDEN_BREATH_SEED),
        feet: walkText({ feet: w.feet, lean: 0 }),
        alpha: prot ? 0.5 : 1,
        blinkOutline: prot && protectBlink(clock),
        reveal,
      });
    }
    // 그릇 없이 부르면 새 객체 (예전처럼)
    expect(hiddenSurvivorPose(1, 2, 0, 0, 0, false, null, 0, 0.5)).not.toBe(
      hiddenSurvivorPose(1, 2, 0, 0, 0, false, null, 0, 0.5),
    );
  });
});

// ───────────────────────── 빨강 부채꼴 해치 ─────────────────────────

/** 렌더링 최적화 2 전 clipLine · drawConeHatch 그대로 */
function clipLineOld(p: Vec2, d: Vec2, poly: readonly Vec2[]): [number, number][] {
  const ts: number[] = [];
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const a = poly[j];
    const c = poly[i];
    if (!a || !c) continue;
    const ex = c.x - a.x;
    const ey = c.y - a.y;
    const den = d.x * ey - d.y * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((a.x - p.x) * ey - (a.y - p.y) * ex) / den;
    const u = ((a.x - p.x) * d.y - (a.y - p.y) * d.x) / den;
    if (u >= 0 && u < 1) ts.push(t);
  }
  ts.sort((x, y) => x - y);
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < ts.length; i += 2) {
    const a = ts[i];
    const c = ts[i + 1];
    if (a !== undefined && c !== undefined) out.push([a, c]);
  }
  return out;
}

function drawConeHatchOld(
  g: PathPen,
  cone: readonly Vec2[],
  apex: Vec2,
  aim: number,
  coneRed: number,
  tS: number,
  color: number,
): number {
  if (!(coneRed > 0.01) || cone.length < 3) return 0;
  const pulse = hatchPulse(tS);
  const a = (CONE_LOOK.hatchAlpha + CONE_LOOK.hatchPulse * pulse) * Math.min(1, coneRed);
  const dir = { x: Math.cos(aim + Math.PI / 4), y: Math.sin(aim + Math.PI / 4) };
  const nn = { x: -dir.y, y: dir.x };
  const sp = CONE_LOOK.hatchSpacing;
  const shift = ((((tS / ANIM.hatchPulseS) % 1) + 1) % 1) * sp;
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of cone) {
    const c = (p.x - apex.x) * nn.x + (p.y - apex.y) * nn.y;
    lo = Math.min(lo, c);
    hi = Math.max(hi, c);
  }
  g.lineStyle(CONE_LOOK.hatchWidth / MAP_SCALE, color, a);
  g.beginPath();
  const sign = nn.x * Math.cos(aim) + nn.y * Math.sin(aim) >= 0 ? 1 : -1;
  let segs = 0;
  for (let c = Math.floor(lo / sp) * sp - sp; c <= hi + sp; c += sp) {
    const off = c + sign * shift;
    const o = { x: apex.x + nn.x * off, y: apex.y + nn.y * off };
    for (const [t0, t1] of clipLineOld(o, dir, cone)) {
      g.moveTo((o.x + dir.x * t0) * T, (o.y + dir.y * t0) * T);
      g.lineTo((o.x + dir.x * t1) * T, (o.y + dir.y * t1) * T);
      segs += 1;
    }
  }
  g.strokePath();
  return segs;
}

describe('빨강 부채꼴 해치: 줄마다 객체 · 배열 없이 같은 명령', () => {
  it('무작위 괴물 자리 · 조준 · 모양 · 시각 · 빨강 정도 300가지', () => {
    const rng = new Rng(31);
    let segs = 0;
    for (let k = 0; k < 300; k += 1) {
      const m = randomEye(rng);
      const aim = rng.next() * 8 - 4;
      const cone = monsterConePolygon(b, m, aim, rng.next());
      const red = [1, 0.5, 0.005, rng.next()][k % 4] ?? 1;
      const t = rng.next() * 100;
      const a = logPen();
      const o = logPen();
      const na = drawConeHatch(a, cone, m, aim, red, t, 0xff0000);
      expect(na).toBe(drawConeHatchOld(o, cone, m, aim, red, t, 0xff0000));
      expect(a.log).toEqual(o.log);
      segs += na;
    }
    expect(segs).toBeGreaterThan(1000);
  });
});

// ───────────────────────── 시야 림 ─────────────────────────

/** 렌더링 최적화 2 전 림: 변마다 moveTo + lineTo */
function rimOld(g: PathPen, poly: readonly Vec2[], center: Vec2, r: number): void {
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i];
    const c = poly[(i + 1) % poly.length];
    if (!a || !c) continue;
    const da = Math.hypot(a.x - center.x, a.y - center.y);
    const db = Math.hypot(c.x - center.x, c.y - center.y);
    if (da < r - 0.06 || db < r - 0.06) continue;
    g.moveTo(a.x * 32, a.y * 32);
    g.lineTo(c.x * 32, c.y * 32);
  }
}

/** 기록을 선분 목록으로 편다 (moveTo로 시작한 줄의 이웃 점 쌍): WebGL batchStrokePath가 선마다 긋는 사각형의 입력 */
function segmentsOf(log: readonly string[]): { segs: string[]; paths: number } {
  const segs: string[] = [];
  let last: string | null = null;
  let paths = 0;
  for (const l of log) {
    if (l.startsWith('m ')) {
      last = l.slice(2);
      paths += 1;
    } else if (l.startsWith('l ')) {
      const p = l.slice(2);
      if (last !== null) segs.push(`${last} → ${p}`);
      last = p;
    }
  }
  return { segs, paths };
}

describe('시야 림: 이어진 변을 한 줄로 그어도 같은 선분 · 같은 순서 (WebGL 같은 사각형)', () => {
  it('무작위 자리의 실제 시야 다각형 400개', () => {
    const rng = new Rng(77);
    let saved = 0;
    let total = 0;
    for (let k = 0; k < 400; k += 1) {
      const c = randomEye(rng);
      const r = k % 2 === 0 ? b.survivor.visionRadius : b.roles.scout.visionRadius;
      const poly = survivorVisionPolygon(c, r);
      const a = logPen();
      const o = logPen();
      traceRim(a, poly, c, r);
      rimOld(o, poly, c, r);
      const now = segmentsOf(a.log);
      const old = segmentsOf(o.log);
      expect(now.segs).toEqual(old.segs);
      saved += old.paths - now.paths;
      total += old.paths;
      // Canvas(join = false)는 예전 명령 그대로 (이어 그으면 마이터 이음으로 화소가 달라진다)
      const split = logPen();
      traceRim(split, poly, c, r, false);
      expect(split.log).toEqual(o.log);
    }
    // 하위 경로(= WebGL 경로 객체)가 크게 준다
    expect(saved / total).toBeGreaterThan(0.8);
  });

  it('림 두께는 2px 이하 (WebGL이 이음매 사각형을 넣지 않는 조건)', () => {
    expect(CONE_LOOK.rimWidth / MAP_SCALE).toBeLessThanOrEqual(2);
  });
});

// ───────────────────────── 돌진 잔상 ─────────────────────────

/** 렌더링 최적화 2 전 DashTrail 그대로 (live · clear만 바뀌었다) */
class DashTrailOld {
  private ghosts: Ghost[] = [];
  private lifeMs = DASH_GHOST_MS;
  private start: number | null = null;
  private nextK = 0;
  private hasPrev = false;
  private prevX = 0;
  private prevY = 0;
  private prevAim = 0;
  private prevT = 0;
  private lastFrameAt: number | null = null;
  setLife(ms: number): void {
    if (ms > 0) this.lifeMs = ms;
  }
  update(dashing: { x: number; y: number; aim: number } | null, nowMs: number, onset: () => number): void {
    if (this.lastFrameAt !== null && nowMs - this.lastFrameAt > DASH_GAP_MS) this.end();
    this.lastFrameAt = nowMs;
    if (!dashing) {
      if (this.start !== null) this.end();
      return;
    }
    const start = this.start ?? Math.min(nowMs, onset());
    this.sample(dashing.x, dashing.y, dashing.aim, nowMs, start);
  }
  sample(x: number, y: number, aim: number, nowMs: number, startMs: number): void {
    if (this.start !== startMs) {
      this.start = startMs;
      this.nextK = 0;
      this.hasPrev = false;
    }
    if (this.hasPrev && nowMs - this.prevT > DASH_GAP_MS) this.hasPrev = false;
    if (!this.hasPrev) {
      const latest = Math.floor((nowMs + 1 - startMs) / GHOST_EVERY_MS);
      if (latest > this.nextK) this.nextK = latest;
    }
    for (;;) {
      const g = startMs + this.nextK * GHOST_EVERY_MS;
      if (g > nowMs + 1) break;
      if (this.hasPrev && g > this.prevT && g < nowMs) {
        const k = (g - this.prevT) / (nowMs - this.prevT);
        this.ghosts.push({
          x: this.prevX + (x - this.prevX) * k,
          y: this.prevY + (y - this.prevY) * k,
          aim: this.prevAim + angleDiff(this.prevAim, aim) * k,
          at: g,
        });
      } else this.ghosts.push({ x, y, aim, at: g });
      this.nextK += 1;
    }
    this.hasPrev = true;
    this.prevX = x;
    this.prevY = y;
    this.prevAim = aim;
    this.prevT = nowMs;
  }
  end(): void {
    this.start = null;
    this.hasPrev = false;
  }
  live(nowMs: number): { g: Ghost; alpha: number }[] {
    this.ghosts = this.ghosts.filter((g) => nowMs - g.at < this.lifeMs);
    return this.ghosts.map((g) => ({ g, alpha: Math.min(1, 1 - (nowMs - g.at) / this.lifeMs) }));
  }
  clear(): void {
    this.ghosts = [];
    this.end();
  }
}

describe('돌진 잔상 DashTrail.live: 제자리에서 걸러 항목을 다시 써도 같은 잔상 · 같은 알파', () => {
  it('무작위 돌진 · 멈춤 · 지우기 · 틈이 섞인 3000프레임', () => {
    const rng = new Rng(11);
    const a = new DashTrail();
    const o = new DashTrailOld();
    a.setLife(250);
    o.setLife(250);
    let t = 0;
    let dashing = false;
    let start = 0;
    let seen = 0;
    for (let f = 0; f < 3000; f += 1) {
      t += [1000 / 60, 1000 / 120, 1000 / 144, 40][Math.floor(rng.next() * 4)] ?? 16;
      if (rng.next() < 0.005) t += 400;
      if (!dashing && rng.next() < 0.03) {
        dashing = true;
        start = t - rng.next() * 10;
      } else if (dashing && t - start > 250) dashing = false;
      if (rng.next() < 0.002) {
        a.clear();
        o.clear();
      }
      const at = dashing ? { x: (t - start) * 0.01, y: Math.sin(t / 100), aim: t / 300 } : null;
      a.update(at, t, () => start);
      o.update(at, t, () => start);
      const now = a.live(t).map((g) => `${n(g.g.x)} ${n(g.g.y)} ${n(g.g.aim)} ${n(g.g.at)} ${n(g.alpha)}`);
      const old = o.live(t).map((g) => `${n(g.g.x)} ${n(g.g.y)} ${n(g.g.aim)} ${n(g.g.at)} ${n(g.alpha)}`);
      expect(now).toEqual(old);
      seen += now.length;
    }
    expect(seen).toBeGreaterThan(500);
  });
});

// ───────────────────────── 삼각형 부채 채우기 ─────────────────────────

/** 기록에서 채운 경로의 점들 (moveTo · lineTo · closePath의 첫 점) */
function pathPoints(log: readonly string[]): string[] {
  const out: string[] = [];
  for (const l of log) if (l.startsWith('m ') || l.startsWith('l ')) out.push(l.slice(2));
  return out;
}

/** 삼각형 기록 → 꼭짓점 좌표 */
function tris(log: readonly string[]): number[][] {
  return log.filter((l) => l.startsWith('tri ')).map((l) => l.slice(4).split(' ').map(Number));
}

/** 표본점이 삼각형 안이면 1 (넓이 0인 삼각형은 아무것도 덮지 않는다: GPU도 칠하지 않는다) */
function inTri(px: number, py: number, t: readonly number[]): number {
  const [x0 = 0, y0 = 0, x1 = 0, y1 = 0, x2 = 0, y2 = 0] = t;
  if ((x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0) === 0) return 0;
  const d1 = (px - x1) * (y0 - y1) - (x0 - x1) * (py - y1);
  const d2 = (px - x2) * (y1 - y2) - (x1 - x2) * (py - y2);
  const d3 = (px - x0) * (y2 - y0) - (x2 - x0) * (py - y0);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return neg && pos ? 0 : 1;
}

/** 점에서 다각형 변까지 가장 가까운 거리 */
function edgeDist(p: Vec2, poly: readonly Vec2[]): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i];
    const c = poly[(i + 1) % poly.length];
    if (!a || !c) continue;
    const dx = c.x - a.x;
    const dy = c.y - a.y;
    const L = dx * dx + dy * dy;
    const t = L > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L)) : 0;
    best = Math.min(best, Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t)));
  }
  return best;
}

describe('삼각형 부채 채우기 (WebGL): fillPath와 같은 꼭짓점 · 같은 영역 · 겹침 없음', () => {
  it('원: fillCirclePen과 같은 점들에서 첫 점 부채, 원 안 표본점은 정확히 한 삼각형', () => {
    for (const r of [0.6, 1.1, 2, 3.4, 9, 26]) {
      const a = logPen();
      const o = logPen();
      const cx = 400.37;
      const cy = 211.9;
      fillCircleFan(a, cx, cy, r);
      fillCirclePen(o, cx, cy, r);
      const pts = pathPoints(o.log);
      const ts = tris(a.log);
      // 부채 삼각형 i = (점 0, 점 i, 점 i + 1): 경로의 점과 비트 단위로 같다
      expect(ts.length).toBe(pts.length - 2);
      ts.forEach((t, i) => {
        expect(`${n(t[0] ?? 0)} ${n(t[1] ?? 0)}`).toBe(pts[0]);
        expect(`${n(t[2] ?? 0)} ${n(t[3] ?? 0)}`).toBe(pts[i + 1]);
        expect(`${n(t[4] ?? 0)} ${n(t[5] ?? 0)}`).toBe(pts[i + 2]);
      });
      const poly = pts.map((p) => {
        const [x = 0, y = 0] = p.split(' ').map(Number);
        return { x, y };
      });
      for (let k = 0; k < 400; k += 1) {
        const p = { x: cx + (Math.sin(k * 12.9898) * 1.2 - 0.1) * r, y: cy + Math.cos(k * 78.233) * 1.2 * r };
        if (edgeDist(p, poly) < 1e-6 * r) continue;
        const cover = ts.reduce((s, t) => s + inTri(p.x, p.y, t), 0);
        expect(cover).toBe(pointInPolygon(p, poly) ? 1 : 0);
      }
    }
  });

  it('부채꼴 시야 다각형: 무작위 괴물 자리 · 조준 · 모양 150가지에서 표본점이 다각형 안이면 정확히 한 삼각형, 밖이면 0', () => {
    const rng = new Rng(2026);
    let checked = 0;
    for (let k = 0; k < 150; k += 1) {
      const m = randomEye(rng);
      const aim = rng.next() * 7 - 3.5;
      const cone = monsterConePolygon(b, m, aim, rng.next());
      const pen = logPen();
      fillFanPolygon(pen, cone, 0xffcc00, 0.2);
      expect(pen.log[0]).toBe(`fs ${0xffcc00} 0.2`);
      const ts = tris(pen.log);
      expect(ts.length).toBe(cone.length - 2);
      const poly = cone.map((p) => ({ x: p.x * T, y: p.y * T }));
      for (let s = 0; s < 120; s += 1) {
        const p = { x: (m.x + (rng.next() - 0.5) * 20) * T, y: (m.y + (rng.next() - 0.5) * 20) * T };
        if (edgeDist(p, poly) < 1e-6) continue;
        const cover = ts.reduce((acc, t) => acc + inTri(p.x, p.y, t), 0);
        expect(cover).toBe(pointInPolygon(p, poly) ? 1 : 0);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(15_000);
  });

  it('효과 그리기: fan이면 채운 점(흩어짐 · 발먼지)만 삼각형으로, 나머지 명령 · 색 · 꼭짓점은 같다', () => {
    const make = (): FxSystem => {
      const fx = new FxSystem(42, 400);
      fx.dissolve(10, 10, 0.3, 0, null, false);
      fx.footDust(12, 11, 0, null, false);
      fx.sparks(9, 9, 0.3, 0, null, false);
      fx.ring('shockwave', 8, 8, 1.5, 0, null, false);
      fx.slash(7, 7, 0.4, 1.2, 1.4, 0, null, false);
      return fx;
    };
    for (const t of [0.01, 0.05, 0.12, 0.2]) {
      const a = logPen();
      const o = logPen();
      make().draw(a, t, 32, true);
      make().draw(o, t, 32, false);
      // fan 기록을 경로 기록으로 되돌리면(삼각형 i의 세 번째 점 = 경로 점 i + 2) 예전 기록과 같다
      const back: string[] = [];
      let fan: string[] = [];
      const flush = (): void => {
        if (fan.length === 0) return;
        const first = fan[0]?.split(' ') ?? [];
        back.push('begin', `m ${first[1]} ${first[2]}`, `l ${first[3]} ${first[4]}`);
        for (const tri of fan) {
          const p = tri.split(' ');
          back.push(`l ${p[5]} ${p[6]}`);
        }
        back.push('close', 'fill');
        fan = [];
      };
      for (const l of a.log) {
        if (l.startsWith('tri ')) fan.push(l);
        else {
          flush();
          back.push(l);
        }
      }
      flush();
      expect(back).toEqual(o.log);
      expect(a.log.some((l) => l.startsWith('tri '))).toBe(true);
      expect(a.log.includes('fill')).toBe(false);
    }
    // fillTriangle이 없는 펜이면 fan이어도 fillPath 그대로
    const lp = logPen();
    const plain: FxPen = {
      fillStyle: lp.fillStyle,
      lineStyle: lp.lineStyle,
      beginPath: lp.beginPath,
      closePath: lp.closePath,
      fillPath: lp.fillPath,
      strokePath: lp.strokePath,
      moveTo: lp.moveTo,
      lineTo: lp.lineTo,
    };
    const ref = logPen();
    make().draw(plain, 0.05, 32, true);
    make().draw(ref, 0.05, 32, false);
    expect(lp.log).toEqual(ref.log);
  });
});

// ───────────────────────── 시야 다각형 캐시 ─────────────────────────

describe('시야 다각형 캐시 peek · put', () => {
  it('peek은 입력이 정확히 같을 때만, put은 넣은 것을 돌려주고 get과 같은 결과', () => {
    const c = new PolyCache();
    expect(c.peek('cone', 1, 2, 3, 4)).toBeNull();
    const p = [{ x: 1, y: 2 }];
    expect(c.put('cone', 1, 2, 3, 4, p)).toBe(p);
    expect(c.peek('cone', 1, 2, 3, 4)).toBe(p);
    expect(c.peek('cone', 1, 2, 3, 4.0001)).toBeNull();
    expect(c.peek('near', 1, 2, 3, 4)).toBeNull();
    expect(c.get('cone', 1, 2, 3, 4, () => [])).toBe(p);
    const q = c.get('cone', 1, 2, 3, 5, () => [{ x: 0, y: 0 }]);
    expect(q).toEqual([{ x: 0, y: 0 }]);
    expect(c.peek('cone', 1, 2, 3, 4)).toBeNull();
    expect(c.misses).toBe(2);
  });
});

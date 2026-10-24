// 내 캐릭터 움직임 고르기 요약 (motion.spec.ts가 쓴다, docs/PERF.md 5절). 순수 함수 — 페이지 밖(Node)에서 돈다.
//  ① 내 그린 자리 프레임당 변화량 · ② 카메라 프레임당 이동량 · ③ 화면 위 내 자리(카메라 기준)의 프레임당 변화량을 기기 px로 잰다.
//  걷기 구간(키를 누른 뒤 settleMs부터 뗄 때까지)만 본다: 그 사이 내 캐릭터는 같은 빠르기로 걷고 카메라는 따라가기 지연이 다
//  가라앉아(τ 0.12초의 약 6배) ①·②는 프레임 간격 × 빠르기, ③은 0이어야 한다
import type { MotionFrame, MotionKey } from './motionHooks';

export interface Dist {
  mean: number;
  p5: number;
  p50: number;
  p95: number;
  max: number;
  min: number;
}

export interface WalkStats {
  /** 걷기 구간 수 · 구간 안 프레임 쌍 수 */
  segments: number;
  pairs: number;
  fps: number;
  /** 프레임 간격 (ms) */
  interval: Dist;
  /** 프레임 작업 시간 (ms) */
  work: Dist;
  /** 기기 px / 타일 */
  devPerTile: number;
  /** 평균 빠르기 (기기 px / 프레임 간격 16.67ms) — 참고 */
  speedPer60: number;
  /** ① 그린 자리 프레임당 변화 (기기 px) */
  d1: Dist;
  /** ① 프레임당 변화 ÷ (평균 빠르기 × 그 프레임 간격): 1이면 고르다 */
  r1: Dist;
  /** ① 멈칫(비율 < 0.5) · 튐(> 1.5) 프레임 수 */
  stall1: number;
  jump1: number;
  /** ① 기대 이동과의 차 |변화 − 빠르기 × 간격| (기기 px) */
  err1: Dist;
  /** ① 프레임당 변화의 변동 계수 (표준편차 ÷ 평균, 간격으로 나누지 않음): 간격이 고르지 않으면 커진다 */
  cv1: number;
  /** ② 카메라 */
  d2: Dist;
  r2: Dist;
  stall2: number;
  jump2: number;
  err2: Dist;
  /** ③ 카메라 기준 화면 위 내 자리의 프레임당 변화 (기기 px, 0이어야 한다) */
  d3: Dist;
  /** ③ 구간 안 화면 위 자리 폭 (최대 − 최소, 기기 px, 구간 평균) */
  range3: number;
  /** 그린 자리가 예측 상태보다 뒤인 시간 (ms, 거리 ÷ 빠르기): 보간이 더한 화면 지연 */
  behindMs: Dist;
  /** 대기 입력 수 평균 */
  pending: number;
}

export interface LatencyStats {
  trials: number;
  /** 키 눌림 → 내 그린 자리가 처음 움직인 프레임이 끝난 시각 (ms) */
  move: Dist;
  /** 키 눌림 → 카메라가 처음 움직인 프레임 (ms) */
  camera: Dist;
  /** 키 눌림 → 내 그린 자리가 기기 1px 넘게 움직인 프레임 (ms): 눈에 보이는 첫 움직임 */
  visible: Dist;
}

const round = (v: number, d = 2): number => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : v);

export function dist(values: number[]): Dist {
  if (values.length === 0) return { mean: 0, p5: 0, p50: 0, p95: 0, max: 0, min: 0 };
  const s = [...values].sort((a, b) => a - b);
  const at = (p: number): number =>
    s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))] ?? 0;
  const sum = s.reduce((a, b) => a + b, 0);
  return {
    mean: round(sum / s.length, 3),
    p5: round(at(5), 3),
    p50: round(at(50), 3),
    p95: round(at(95), 3),
    max: round(s[s.length - 1] ?? 0, 3),
    min: round(s[0] ?? 0, 3),
  };
}

function cv(values: number[]): number {
  if (values.length < 2) return 0;
  const m = values.reduce((a, b) => a + b, 0) / values.length;
  const v = values.reduce((a, b) => a + (b - m) ** 2, 0) / values.length;
  return m > 0 ? Math.sqrt(v) / m : 0;
}

/** 누름 → 뗌 쌍 (같은 키) */
export function keySegments(keys: readonly MotionKey[]): { code: string; down: number; up: number }[] {
  const out: { code: string; down: number; up: number }[] = [];
  const open = new Map<string, number>();
  for (const k of keys) {
    if (k.type === 'down') open.set(k.code, k.t);
    else {
      const d = open.get(k.code);
      if (d !== undefined) out.push({ code: k.code, down: d, up: k.t });
      open.delete(k.code);
    }
  }
  return out;
}

export function walkStats(
  frames: readonly MotionFrame[],
  keys: readonly MotionKey[],
  dpr: number,
  settleMs: number,
): WalkStats {
  const segs = keySegments(keys);
  const intervals: number[] = [];
  const works: number[] = [];
  const d1: number[] = [];
  const d2: number[] = [];
  const d3: number[] = [];
  const r1: number[] = [];
  const r2: number[] = [];
  const e1: number[] = [];
  const e2: number[] = [];
  const behind: number[] = [];
  const pend: number[] = [];
  const ranges: number[] = [];
  let kSum = 0;
  let kN = 0;
  let speedSum = 0;
  let pairs = 0;
  let span = 0;
  for (const seg of segs) {
    const fr = frames.filter((f) => f.t >= seg.down + settleMs && f.at <= seg.up);
    if (fr.length < 3) continue;
    const first = fr[0];
    const last = fr[fr.length - 1];
    if (!first || !last) continue;
    const k = first.k * dpr;
    // 구간 평균 빠르기 (기기 px / ms)
    const total = Math.hypot(last.mx - first.mx, last.my - first.my) * k;
    const v = total / Math.max(1e-6, last.t - first.t);
    span += last.t - first.t;
    speedSum += v * (last.t - first.t);
    kSum += k;
    kN += 1;
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 1; i < fr.length; i += 1) {
      const a = fr[i - 1];
      const b = fr[i];
      if (!a || !b) continue;
      const dt = b.t - a.t;
      if (dt <= 0) continue;
      pairs += 1;
      intervals.push(dt);
      works.push(b.work);
      const m = Math.hypot(b.mx - a.mx, b.my - a.my) * k;
      const c = Math.hypot(b.cx - a.cx, b.cy - a.cy) * dpr;
      const s = Math.hypot(b.px - a.px, b.py - a.py) * dpr;
      d1.push(m);
      d2.push(c);
      d3.push(s);
      const want = v * dt;
      r1.push(m / want);
      r2.push(c / want);
      e1.push(Math.abs(m - want));
      e2.push(Math.abs(c - want));
      if (Number.isFinite(b.sx)) behind.push((Math.hypot(b.sx - b.mx, b.sy - b.my) * k) / Math.max(1e-6, v));
      pend.push(b.pend);
    }
    for (const f of fr) {
      const x = f.px * dpr;
      lo = Math.min(lo, x);
      hi = Math.max(hi, x);
    }
    ranges.push(hi - lo);
  }
  const vAvg = span > 0 ? speedSum / span : 0;
  return {
    segments: ranges.length,
    pairs,
    fps: round(
      intervals.length > 0 ? 1000 / (intervals.reduce((a, b) => a + b, 0) / intervals.length) : 0,
      1,
    ),
    interval: dist(intervals),
    work: dist(works),
    devPerTile: round(kN > 0 ? kSum / kN : 0, 2),
    speedPer60: round(vAvg * (1000 / 60), 3),
    d1: dist(d1),
    r1: dist(r1),
    stall1: r1.filter((r) => r < 0.5).length,
    jump1: r1.filter((r) => r > 1.5).length,
    err1: dist(e1),
    cv1: round(cv(d1), 3),
    d2: dist(d2),
    r2: dist(r2),
    stall2: r2.filter((r) => r < 0.5).length,
    jump2: r2.filter((r) => r > 1.5).length,
    err2: dist(e2),
    d3: dist(d3),
    range3: round(ranges.reduce((a, b) => a + b, 0) / Math.max(1, ranges.length), 2),
    behindMs: dist(behind),
    pending: round(pend.reduce((a, b) => a + b, 0) / Math.max(1, pend.length), 2),
  };
}

/**
 * 키 눌림마다: 누르기 직전 프레임 자리에서 처음 벗어난 프레임까지 (그린 자리 1e-3타일 · 기기 1px, 카메라 0.01 CSS px).
 * 1e-3타일은 기기 0.1px 남짓이라 눈에 안 보이는 첫 걸음까지 센다 — 보이는 첫 움직임은 1px로 따로 낸다
 */
export function latencyStats(
  frames: readonly MotionFrame[],
  keys: readonly MotionKey[],
  dpr = 1,
): LatencyStats {
  const move: number[] = [];
  const cam: number[] = [];
  const vis: number[] = [];
  for (const k of keys) {
    if (k.type !== 'down') continue;
    let base: MotionFrame | undefined;
    for (const f of frames) {
      if (f.at <= k.t) base = f;
      else break;
    }
    if (!base) continue;
    const after = frames.filter((f) => f.at > k.t && f.at < k.t + 400);
    const m = after.find((f) => Math.hypot(f.mx - base.mx, f.my - base.my) > 1e-3);
    const c = after.find((f) => Math.hypot(f.cx - base.cx, f.cy - base.cy) > 0.01);
    const v = after.find((f) => Math.hypot(f.mx - base.mx, f.my - base.my) * f.k * dpr >= 1);
    if (m) move.push(m.at - k.t);
    if (c) cam.push(c.at - k.t);
    if (v) vis.push(v.at - k.t);
  }
  return { trials: move.length, move: dist(move), camera: dist(cam), visible: dist(vis) };
}

/** 표에 붙일 프레임별 발췌 (걷기 구간 하나에서 n프레임) */
export function excerpt(
  frames: readonly MotionFrame[],
  keys: readonly MotionKey[],
  dpr: number,
  settleMs: number,
  n: number,
): { dt: number; d1: number; d2: number; s3: number; pend: number }[] {
  const seg = keySegments(keys)[0];
  if (!seg) return [];
  const fr = frames.filter((f) => f.t >= seg.down + settleMs && f.at <= seg.up);
  const out: { dt: number; d1: number; d2: number; s3: number; pend: number }[] = [];
  const x0 = (fr[0]?.px ?? 0) * dpr;
  for (let i = 1; i < fr.length && out.length < n; i += 1) {
    const a = fr[i - 1];
    const b = fr[i];
    if (!a || !b) continue;
    const k = b.k * dpr;
    out.push({
      dt: round(b.t - a.t, 2),
      d1: round(Math.hypot(b.mx - a.mx, b.my - a.my) * k, 2),
      d2: round(Math.hypot(b.cx - a.cx, b.cy - a.cy) * dpr, 2),
      s3: round(b.px * dpr - x0, 2),
      pend: b.pend,
    });
  }
  return out;
}

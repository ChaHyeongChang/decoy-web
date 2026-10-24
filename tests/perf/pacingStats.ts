// 잔렉 측정 요약 (pacing.spec.ts가 쓴다, docs/PERF.md 6절). 순수 함수 — 페이지 밖(Node)에서 돈다.
// 그린 프레임마다 ① 내 그린 자리(월드) 변화 ② 카메라 이동 ③ 카메라 기준 화면 위 내 자리 ④ rAF 간격 · 화면 표시 간격 · 표시 지연,
// ⑤ 시야 빛(안개 눈 자리)과 내 몸의 화면 위 어긋남을 기기 px로 잰다. 그리고 '화면 표시 시각'(가상 시계 작업 시간 모형의 vsync)마다
// 실제로 보이는 프레임을 골라, 맵 스크롤 · 내 자리 · 시야 빛이 고르게 움직였다면 있어야 할 자리에서 얼마나 벗어났는지 본다
// (같은 빠르기로 걸으면 맵은 표시 시각에 비례해 움직이고, 내 자리 · 빛은 화면에 고정이어야 한다).

/** 페이지 안 기록: 판 장면이 그린 프레임 하나 */
export interface PacingFrame {
  /** rAF 시각 */
  t: number;
  /** 콜백 시작 시각 (performance.now) */
  start: number;
  /** 그린 프레임 번호 (getAnimState().frames) */
  n: number;
  /** 예측 그린 자리 (타일) */
  mx: number;
  my: number;
  /** 그린 내 엔티티 화면 자리 (CSS px) */
  px: number;
  py: number;
  /** 화면 위 타일 (0,0) (CSS px) */
  cx: number;
  cy: number;
  /** CSS px / 타일 */
  k: number;
  /** 안개 갱신 시각 (getAnimState().fogAt) */
  fogAt: number | null;
  /** 목표 FPS · 화면 주사율 (gfx) */
  targetHz: number;
  displayHz: number;
}

export interface PacingKey {
  t: number;
  type: 'down' | 'up';
  code: string;
}

/** 가상 시계 작업 시간 모형의 그린 프레임 (VirtualFrameLog와 같은 모양) */
export interface PacingLog {
  ts: number;
  start: number;
  work: number;
  disp: number;
  fog: boolean;
}

export interface Dist {
  mean: number;
  min: number;
  p5: number;
  p50: number;
  p95: number;
  max: number;
}

export function dist(values: readonly number[]): Dist {
  if (values.length === 0) return { mean: 0, min: 0, p5: 0, p50: 0, p95: 0, max: 0 };
  const s = [...values].sort((a, b) => a - b);
  const at = (q: number): number =>
    s[Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1) + 0.5)))] ?? 0;
  return {
    mean: s.reduce((a, b) => a + b, 0) / s.length,
    min: s[0] ?? 0,
    p5: at(0.05),
    p50: at(0.5),
    p95: at(0.95),
    max: s[s.length - 1] ?? 0,
  };
}

function cv(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const m = values.reduce((a, b) => a + b, 0) / values.length;
  if (m === 0) return 0;
  const v = values.reduce((a, b) => a + (b - m) ** 2, 0) / values.length;
  return Math.sqrt(v) / m;
}

/** 값 → 개수 (정수 px로 반올림한 카메라 이동 분포 등) */
function histogram(values: readonly number[], step = 1): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of values) {
    const k = String(Math.round(v / step) * step);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

export interface WalkSummary {
  /** 걷기 구간에서 그린 프레임 수 · 그린 FPS */
  frames: number;
  fps: number;
  /** 걸을 때 목표 FPS · 잰 화면 주사율 */
  targetHz: number;
  displayHz: number;
  /** 기기 px / 타일, 기기 px / CSS px */
  devPerTile: number;
  devPerCss: number;
  /** 평균 빠르기 (타일/초) */
  speed: number;
  /** ④ rAF 간격 (ms) · 변동 계수 */
  rafIv: Dist;
  rafCv: number;
  /** ④ 콜백이 rAF 시각보다 늦게 시작한 시간 (ms) */
  startLag: Dist;
  /** ① 그린 자리 프레임당 변화 (기기 px) · 빠르기 × rAF 간격에 대한 비율 */
  d1: Dist;
  r1: Dist;
  /** ② 카메라 프레임당 이동 (기기 px) · 값별 개수 · 변동 계수 */
  d2: Dist;
  cam: Record<string, number>;
  cv2: number;
  /** ③ 화면 위 내 자리: 프레임당 변화 · 구간 폭 (기기 px) */
  d3: Dist;
  range3: number;
  /** ⑤ 시야 빛(안개 눈) − 내 몸 화면 어긋남 (기기 px): 프레임별 · 폭 */
  fog: Dist;
  fogRange: number;
  /** 안개 갱신 간격 (ms) */
  fogIv: Dist;
  /** 화면 표시 시각 기준 (작업 시간 모형이 있을 때만) */
  display: DisplaySummary | null;
}

export interface DisplaySummary {
  /** 표시 갱신(vsync) 수 · 보인 프레임 수 · 그렸지만 안 보인 프레임 수 */
  refreshes: number;
  shown: number;
  dropped: number;
  /** 보인 프레임의 표시 간격 (ms) · 변동 계수 */
  dispIv: Dist;
  dispCv: number;
  /** 보인 프레임마다 |표시 간격 − 내용 간격(rAF 시각 차)| ÷ 주기: 0이면 움직임 계산 시각과 표시 시각이 맞다 */
  mismatch: Dist;
  /** 그 값이 0.5 주기를 넘는 보인 프레임 비율 (%) */
  mismatchPct: number;
  /** 표시 지연 (표시 − rAF 시각, ms) */
  latency: Dist;
  /** vsync마다 보이는 맵 스크롤 자리가 고른 스크롤(표시 시각에 비례)에서 벗어난 양 (기기 px) */
  mapErr: Dist;
  /** vsync마다 화면 위 내 자리 (평균에서 벗어난 양, 기기 px) */
  selfErr: Dist;
  /** vsync마다 시야 빛 − 내 몸 어긋남 (평균에서 벗어난 양, 기기 px) */
  fogErr: Dist;
}

/**
 * 걷기 요약: 키를 누른 뒤 settleMs부터 뗄 때까지(같은 빠르기로 걷고 카메라 따라가기 늦음이 가라앉은 구간)만 본다.
 * frames는 그린 프레임만(프레임 제한기가 건너뛴 rAF 없음), logs는 가상 시계 작업 시간 모형 기록(없으면 빈 배열)
 */
export function walkSummary(
  frames: readonly PacingFrame[],
  keys: readonly PacingKey[],
  logs: readonly PacingLog[],
  devPerCss: number,
  settleMs: number,
  periodMs: number,
): WalkSummary {
  const down = keys.find((k) => k.type === 'down');
  const up = down ? keys.find((k) => k.type === 'up' && k.t > down.t) : undefined;
  if (!down || !up) throw new Error('걷기 키 기록 없음');
  // 안개 눈 자리: 안개를 다시 그린 프레임의 예측 그린 자리 (worldRenderer는 v.me로 시야를 잰다)
  const eyeOf = new Map<number, { x: number; y: number }>();
  let eye: { x: number; y: number } | null = null;
  let lastFog: number | null = null;
  const fogTimes: number[] = [];
  for (const f of frames) {
    if (f.fogAt !== lastFog) {
      eye = { x: f.mx, y: f.my };
      lastFog = f.fogAt;
      fogTimes.push(f.t);
    }
    if (eye) eyeOf.set(f.n, eye);
  }
  const fr = frames.filter((f) => f.t >= down.t + settleMs && f.t <= up.t);
  const first = fr[0];
  const last = fr[fr.length - 1];
  if (!first || !last || fr.length < 4) throw new Error('걷기 구간 프레임이 모자람');
  const k = first.k;
  const devPerTile = k * devPerCss;
  const speedPerMs = Math.hypot(last.mx - first.mx, last.my - first.my) / (last.t - first.t);
  const rafIv: number[] = [];
  const d1: number[] = [];
  const r1: number[] = [];
  const d2: number[] = [];
  const d3: number[] = [];
  const fog: number[] = [];
  const startLag: number[] = [];
  let lo3 = Infinity;
  let hi3 = -Infinity;
  for (let i = 0; i < fr.length; i += 1) {
    const b = fr[i]!;
    startLag.push(b.start - b.t);
    const e = eyeOf.get(b.n);
    // 화면 위 빛(눈) 자리 − 내 몸 자리: 빛은 맵에 붙어 카메라와 같이 움직이고, 몸은 격자 나머지만큼 옮겨 그린 자리
    if (e) fog.push(((e.x - b.mx) * k + (b.cx + b.mx * k - b.px)) * devPerCss);
    const sx = (b.px - first.px) * devPerCss;
    lo3 = Math.min(lo3, sx);
    hi3 = Math.max(hi3, sx);
    if (i === 0) continue;
    const a = fr[i - 1]!;
    const dt = b.t - a.t;
    rafIv.push(dt);
    const dm = Math.hypot(b.mx - a.mx, b.my - a.my);
    d1.push(dm * devPerTile);
    r1.push(dm / (speedPerMs * dt));
    d2.push(Math.hypot(b.cx - a.cx, b.cy - a.cy) * devPerCss);
    d3.push(Math.hypot(b.px - a.px, b.py - a.py) * devPerCss);
  }
  const fogIv: number[] = [];
  for (let i = 1; i < fogTimes.length; i += 1) {
    const t = fogTimes[i]!;
    if (t >= down.t + settleMs && t <= up.t) fogIv.push(t - fogTimes[i - 1]!);
  }
  const fogD = dist(fog);
  return {
    frames: fr.length,
    fps: ((fr.length - 1) * 1000) / (last.t - first.t),
    targetHz: last.targetHz,
    displayHz: last.displayHz,
    devPerTile,
    devPerCss,
    speed: speedPerMs * 1000,
    rafIv: dist(rafIv),
    rafCv: cv(rafIv),
    startLag: dist(startLag),
    d1: dist(d1),
    r1: dist(r1),
    d2: dist(d2),
    cam: histogram(d2),
    cv2: cv(d2),
    d3: dist(d3),
    range3: hi3 - lo3,
    fog: fogD,
    fogRange: fogD.max - fogD.min,
    fogIv: dist(fogIv),
    display: logs.length > 0 ? displaySummary(fr, logs, eyeOf, devPerCss, periodMs) : null,
  };
}

/** 화면 표시 시각(vsync)마다 보이는 프레임을 골라 고른 움직임에서 벗어난 양을 잰다 */
function displaySummary(
  fr: readonly PacingFrame[],
  logs: readonly PacingLog[],
  eyeOf: ReadonlyMap<number, { x: number; y: number }>,
  devPerCss: number,
  P: number,
): DisplaySummary {
  const byTs = new Map<number, PacingLog>();
  for (const l of logs) byTs.set(l.ts, l);
  const withDisp = fr
    .map((f) => ({ f, l: byTs.get(f.t) }))
    .filter((x): x is { f: PacingFrame; l: PacingLog } => x.l !== undefined);
  if (withDisp.length < 4) throw new Error('표시 기록이 모자람');
  // 같은 vsync에 둘이면 나중 것이 보인다
  const shown: { f: PacingFrame; disp: number }[] = [];
  let dropped = 0;
  for (const { f, l } of withDisp) {
    const prev = shown[shown.length - 1];
    if (prev && Math.abs(prev.disp - l.disp) < 1e-6) {
      shown[shown.length - 1] = { f, disp: l.disp };
      dropped += 1;
    } else shown.push({ f, disp: l.disp });
  }
  const dispIv: number[] = [];
  const mismatch: number[] = [];
  const latency: number[] = [];
  for (let i = 0; i < shown.length; i += 1) {
    const b = shown[i]!;
    latency.push(b.disp - b.f.t);
    if (i === 0) continue;
    const a = shown[i - 1]!;
    dispIv.push(b.disp - a.disp);
    mismatch.push(Math.abs(b.disp - a.disp - (b.f.t - a.f.t)) / P);
  }
  // vsync마다 (첫 보인 프레임부터 마지막 보인 프레임까지)
  const r0 = shown[0]!.disp;
  const r1 = shown[shown.length - 1]!.disp;
  const mapX: { r: number; v: number }[] = [];
  const self: number[] = [];
  const fog: number[] = [];
  let j = 0;
  for (let r = r0; r <= r1 + 1e-6; r += P) {
    while (j + 1 < shown.length && shown[j + 1]!.disp <= r + 1e-6) j += 1;
    const f = shown[j]!.f;
    mapX.push({ r, v: -f.cx * devPerCss });
    self.push(f.px * devPerCss);
    const e = eyeOf.get(f.n);
    if (e) fog.push(((e.x - f.mx) * f.k + (f.cx + f.mx * f.k - f.px)) * devPerCss);
  }
  // 맵 스크롤: 표시 시각에 대한 직선(최소 제곱)에서 벗어난 양
  const n = mapX.length;
  const mr = mapX.reduce((a, b) => a + b.r, 0) / n;
  const mv = mapX.reduce((a, b) => a + b.v, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (const p of mapX) {
    sxy += (p.r - mr) * (p.v - mv);
    sxx += (p.r - mr) ** 2;
  }
  const slope = sxx > 0 ? sxy / sxx : 0;
  const mapErr = mapX.map((p) => Math.abs(p.v - (mv + slope * (p.r - mr))));
  const center = (a: number[]): number[] => {
    const m = a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
    return a.map((v) => Math.abs(v - m));
  };
  return {
    refreshes: n,
    shown: shown.length,
    dropped,
    dispIv: dist(dispIv),
    dispCv: cv(dispIv),
    mismatch: dist(mismatch),
    mismatchPct: (mismatch.filter((m) => m > 0.5).length * 100) / Math.max(1, mismatch.length),
    latency: dist(latency),
    mapErr: dist(mapErr),
    selfErr: dist(center(self)),
    fogErr: dist(center(fog)),
  };
}

/** 키 눌림 → 처음 움직인 프레임이 화면에 보인 시각 (ms). 작업 시간 모형이 없으면 rAF 시각 + 한 주기 */
export function firstMoveLatency(
  frames: readonly PacingFrame[],
  keys: readonly PacingKey[],
  logs: readonly PacingLog[],
  periodMs: number,
): number[] {
  const byTs = new Map<number, PacingLog>();
  for (const l of logs) byTs.set(l.ts, l);
  const out: number[] = [];
  for (const d of keys) {
    if (d.type !== 'down') continue;
    const rest = [...frames].reverse().find((f) => f.t <= d.t);
    if (!rest) continue;
    const moved = frames.find((f) => f.t > d.t && Math.hypot(f.mx - rest.mx, f.my - rest.my) > 1e-3);
    if (!moved) continue;
    const disp = byTs.get(moved.t)?.disp ?? moved.t + periodMs;
    out.push(disp - d.t);
  }
  return out;
}

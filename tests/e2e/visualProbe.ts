// M10b 화면 픽셀 탐침 (m10-visual*.spec.ts): 게임 캔버스를 그린 바로 그 프레임에 페이지 안에서 읽어
// 캐릭터 몸 원판 · 바깥 링의 색 · 밝기, 몸 · 그림자 폭, 범위 선의 화면 반지름 · 각도, 경계 선의 색을 잰다. 큰 이미지를 Node로 옮기지 않는다.
// 캔버스는 Phaser가 그린 직후의 requestAnimationFrame 콜백에서 복사한다(WebGL도 같은 프레임이라 버퍼가 남아 있다).
import type { Page } from '@playwright/test';
import type { DrawnEntity, InfoItem } from '@decoy/shared';

export interface BodyProbe {
  /** 이름 (보고용) */
  name: string;
  x: number;
  y: number;
  face: number;
  /** 몸 반지름 (타일) */
  r: number;
}

export interface BodyStat {
  name: string;
  /** 몸 원판(0.45r) 평균 색 */
  mean: [number, number, number];
  /** 원판 픽셀 중 무채색(채도 max−min ≤ 24) · 밝음(휘도 ≥ 0.7)인 비율 */
  whiteFrac: number;
  /** 원판 픽셀과 역할 4색의 Lab ΔE 최솟값 */
  minRoleDeltaE: number;
  /** 원판 평균색과 기준색의 Lab ΔE (기준색을 줬을 때) */
  deltaE: number | null;
  /** 몸(원판) 상대 휘도 · 바깥 링(r+3~r+8 논리 px, 등 쪽 반원) 상대 휘도 · 대비 */
  bodyLum: number;
  ringLum: number;
  contrast: number;
  /** 링 안에서 기준색과 ΔE ≤ 25인 픽셀 수 (노출 테두리 찾기) */
  ringRoleHits: number;
  /** 머리 위 문양 자리에서 기준색과 ΔE ≤ 25인 픽셀 수 */
  glyphRoleHits: number;
  /** 몸 둘레 1.75r~3.3r 고리(문양이 어느 쪽에 있든)에서 기준색과 ΔE ≤ 25인 픽셀 수 */
  annulusRoleHits: number;
  /** 몸 원(0.95r) 안에서 표시 색(opts.markColors)과 ΔE ≤ 25인 픽셀 수 (남의 문양 · 별이 몸을 덮었나) */
  bodyMarkHits: number;
  /**
   * 몸 폭 (px): 바라보는 방향 기준 0° · 45° · 90° · 135° 축을 따라 가운데 밝기의 절반으로 떨어지는 곳(외곽선)까지 양쪽 거리의 합.
   * 양쪽을 더해 그리기 자리의 부분 px 반올림이 상쇄된다
   */
  widths: number[];
  /**
   * 바깥 실루엣 폭 (px): 같은 네 축을 바깥(1.8r)에서 안으로 와서 처음 가운데 밝기의 절반을 넘는 곳까지. 몸 안쪽의 가는 선 ·
   * 무늬(새 캐릭터 그림)에 흔들리지 않는다
   */
  outerWidths: number[];
  /**
   * 접지 그림자 폭 (px): 앞 노치와 다른 캐릭터 쪽을 뺀 방향들의 정규화한 어둡기 평균이 절반이 되는 반지름 × 2 (못 재면 null)
   */
  shadowW: number | null;
}

/** 원점에서 여러 방향으로 쏜 광선 위 범위 선 찾기 (기대 거리 근처에서 지표가 가장 큰 곳) */
export interface RayProbe {
  name: string;
  x: number;
  y: number;
  /** 지표: lum = 밝기(흰 선), red, warm(주황 · 노랑), purple, cyan */
  metric: 'lum' | 'red' | 'warm' | 'purple' | 'cyan';
  angles: number[];
  /** 방향마다 기대 거리 (타일) */
  expect: number[];
  /** 찾는 구간 (기대 거리 배수) */
  lo?: number;
  hi?: number;
  /** 이보다 약한 봉우리는 '못 찾음' */
  minPeak?: number;
}

export interface RayResult {
  name: string;
  /** 방향마다 찾은 거리 (px, 못 찾으면 null) · 기대 거리 (px) */
  found: (number | null)[];
  expectPx: number[];
}

/** 원점 둘레 반지름 rho(타일)의 원 위를 a0 → a1로 훑어 지표가 가장 큰 각도 (직선 변 각도 재기) */
export interface ArcScan {
  name: string;
  x: number;
  y: number;
  rho: number;
  a0: number;
  a1: number;
  metric: RayProbe['metric'];
}

export interface ArcScanResult {
  name: string;
  /** 찾은 각도 (라디안) · 그 반지름의 px */
  angle: number | null;
  rhoPx: number;
}

/** 선분 a → b를 따라 법선 ±perpPx 안에서 지표 최댓값 (경계 선이 끊겼나) */
export interface LineProbe {
  name: string;
  ax: number;
  ay: number;
  bx: number;
  by: number;
  stepTiles: number;
  perpPx: number;
  metric: RayProbe['metric'];
}

export interface LineResult {
  name: string;
  samples: { d: number; v: number }[];
}

export interface Capture {
  stats: BodyStat[];
  drawn: DrawnEntity[];
  info: InfoItem[];
  effects: Record<string, number | boolean>;
  /** 공격 범위 경계 반지름 (px, 재지 않았으면 null)과 기대값 (px) */
  rangePx: number | null;
  rangeExpectPx: number | null;
  /** 공격 범위 탐침 밝기 (바깥 → 안, 진단용) */
  rangeProfile: number[];
  rays: RayResult[];
  arcs: ArcScanResult[];
  lines: LineResult[];
  /** 캔버스 px / 논리 px */
  zoom: number;
  /** 화면 px / 타일 */
  pxPerTile: number;
  /** 조건을 처음 만난 시각 · 잰 시각 (페이지 performance.now, ms) */
  tMet: number;
  tCapture: number;
  ok: boolean;
}

export interface CaptureOptions {
  /** 이 효과 키가 참(또는 0보다 큼)인 프레임을 기다린다 */
  waitEffect?: string;
  /** 이 효과 키들이 모두 참인 프레임을 기다린다 */
  waitEffects?: string[];
  /** 정보 레이어에 이 tag 항목이 있는 프레임을 기다린다 */
  waitInfo?: string;
  /** 조건이 처음 참이 된 뒤 이만큼(ms) 더 기다렸다가 잰다 (그때도 조건이 참이어야 ok) */
  holdMs?: number;
  /** 페이지 시각(performance.now)이 이 값을 지날 때까지 기다렸다가 잰다 (그때도 조건이 참이어야 ok) */
  notBefore?: number;
  /** 위상 훑기의 첫 시계가 이미 멈춰 있는 값이다: 첫 위상은 조건을 만난 그 프레임을 바로 읽는다 (느린 화면에서 짧은 효과를 놓치지 않게) */
  firstClockSet?: boolean;
  /** 몸 원판 평균과 비교할 기준색 (body 이름 → 0xRRGGBB) */
  refColors?: Record<string, number>;
  /** 몸 원 안에서 찾을 표시 색 (남의 문양 · 기절 별) */
  markColors?: number[];
  /** 공격 범위 경계를 잴 중심 · 방향 · 판정 거리 (타일) */
  range?: { x: number; y: number; dir: number; tiles: number };
  rays?: RayProbe[];
  arcs?: ArcScan[];
  lines?: LineProbe[];
  timeoutMs?: number;
}

/** 지금 그려진 프레임에서 몸들을 잰다 */
export async function captureBodies(
  page: Page,
  bodies: BodyProbe[],
  opts: CaptureOptions = {},
): Promise<Capture> {
  const [c] = await captureSweep(page, bodies, [null], opts);
  return c!;
}

/**
 * 장식 시계를 clocks 값마다 멈춰 가며(null = 그대로) 같은 조건의 프레임을 잇달아 잰다 (별 위상 훑기 등).
 * 조건(waitEffect · waitEffects · waitInfo)을 처음 만난 뒤 바로 이어서 잰다
 */
export async function captureSweep(
  page: Page,
  bodies: BodyProbe[],
  clocks: (number | null)[],
  opts: CaptureOptions = {},
): Promise<Capture[]> {
  return page.evaluate(
    async ({ bodies, clocks, opts }) => {
      const ROLE_COLORS = [0x3b82f6, 0xa855f7, 0x22c55e, 0xef4444];
      const lin = (c: number): number => {
        const v = c / 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      };
      const relLum = (r: number, g: number, b: number): number =>
        0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
      const lab = (r: number, g: number, b: number): [number, number, number] => {
        const R = lin(r);
        const G = lin(g);
        const B = lin(b);
        const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047;
        const Y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
        const Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
        const f = (t: number): number => (t > 216 / 24389 ? Math.cbrt(t) : (841 / 108) * t + 4 / 29);
        return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
      };
      const hexLab = (c: number): [number, number, number] => lab((c >> 16) & 255, (c >> 8) & 255, c & 255);
      const dE = (a: [number, number, number], b: [number, number, number]): number =>
        Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      const roleLabs = ROLE_COLORS.map(hexLab);
      const markLabs = (opts.markColors ?? []).map(hexLab);
      const metricOf = (m: string, c: [number, number, number]): number => {
        const [r, g, b] = c;
        switch (m) {
          case 'red':
            return r - Math.max(g, b);
          case 'warm':
            return (r + g) / 2 - b;
          case 'purple':
            return Math.min(r, b) - g;
          case 'cyan':
            return Math.min(g, b) - r;
          default:
            return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        }
      };
      const d = window.__DECOY__;
      if (!d) throw new Error('디버그 훅 없음');
      const canvas = document.querySelector<HTMLCanvasElement>('#game-root canvas');
      if (!canvas) throw new Error('게임 캔버스 없음');
      const truthy = (v: unknown): boolean => v === true || (typeof v === 'number' && v > 0);
      const cond = (): boolean => {
        const fx = d.getEffects();
        if (opts.waitEffect && !truthy(fx[opts.waitEffect])) return false;
        for (const k of opts.waitEffects ?? []) if (!truthy(fx[k])) return false;
        if (opts.waitInfo && !d.getInfoLayer().some((i) => i.tag === opts.waitInfo)) return false;
        return true;
      };
      const nextFrame = (): Promise<void> => new Promise((res) => requestAnimationFrame(() => res()));
      // 조건을 기다린다 (Phaser가 그린 직후의 프레임에서 확인: Phaser의 rAF 콜백이 먼저 돈다)
      const start = performance.now();
      let met = false;
      let tMet = 0;
      while (performance.now() - start < (opts.timeoutMs ?? 8000)) {
        await nextFrame();
        if (cond()) {
          met = true;
          tMet = performance.now();
          break;
        }
      }
      if (met && (opts.holdMs || opts.notBefore)) {
        const until = Math.max(tMet + (opts.holdMs ?? 0), opts.notBefore ?? 0);
        while (performance.now() < until) await nextFrame();
        met = cond();
      }
      const rect = canvas.getBoundingClientRect();
      const k = canvas.width / rect.width;
      const zoom = canvas.width / 1920;
      const toPx = (x: number, y: number): [number, number] => {
        const p = d.tileToClient(x, y);
        if (!p) throw new Error('tileToClient 없음');
        return [(p.x - rect.left) * k, (p.y - rect.top) * k];
      };
      const [ox] = toPx(0, 0);
      const [ox1] = toPx(1, 0);
      const pxPerTile = ox1 - ox;
      // 읽을 영역: 몸만 재면 몸 둘레(3.6r)만 (큰 캔버스 전체를 읽지 않아 위상 훑기가 빠르다), 범위 · 선 탐침이 있으면 전체
      let roi = { x: 0, y: 0, w: canvas.width, h: canvas.height };
      if (!opts.rays && !opts.arcs && !opts.lines && !opts.range && bodies.length > 0) {
        let x0 = Infinity;
        let y0 = Infinity;
        let x1 = -Infinity;
        let y1 = -Infinity;
        for (const b of bodies) {
          const [cx, cy] = toPx(b.x, b.y);
          const m = 3.6 * b.r * pxPerTile;
          x0 = Math.min(x0, cx - m);
          y0 = Math.min(y0, cy - m);
          x1 = Math.max(x1, cx + m);
          y1 = Math.max(y1, cy + m);
        }
        const rx = Math.max(0, Math.floor(x0));
        const ry = Math.max(0, Math.floor(y0));
        roi = {
          x: rx,
          y: ry,
          w: Math.min(canvas.width, Math.ceil(x1)) - rx,
          h: Math.min(canvas.height, Math.ceil(y1)) - ry,
        };
      }
      const grab = (): {
        img: ImageData;
        drawn: DrawnEntity[];
        info: InfoItem[];
        effects: Record<string, number | boolean>;
      } | null => {
        const c = document.createElement('canvas');
        c.width = roi.w;
        c.height = roi.h;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        if (!ctx) return null;
        ctx.drawImage(canvas, roi.x, roi.y, roi.w, roi.h, 0, 0, roi.w, roi.h);
        return {
          img: ctx.getImageData(0, 0, c.width, c.height),
          drawn: d.getDrawn(),
          info: d.getInfoLayer(),
          effects: d.getEffects(),
        };
      };
      const frames: { f: ReturnType<typeof grab> | null; t: number }[] = [];
      for (const [ci, clock] of clocks.entries()) {
        if (!met) {
          frames.push({ f: null, t: 0 });
          continue;
        }
        if (clock !== null && !(ci === 0 && opts.firstClockSet)) {
          // 우리 rAF 콜백은 Phaser 다음에 돈다: 지금 멈춘 시계는 다음 프레임 Phaser 그리기에 들어간다
          d.freezeClock(clock);
          await nextFrame();
        }
        // 위상 훑기(clocks)는 조건과 상관없이 그 프레임을 읽는다 (효과가 끝났는지는 effects로 본다)
        frames.push({ f: clocks.length > 1 || cond() ? grab() : null, t: performance.now() });
      }
      return frames.map(({ f: frame, t: tCapture }) => {
        if (!frame)
          return {
            stats: [],
            drawn: [],
            info: [],
            effects: {},
            rangePx: null,
            rangeExpectPx: null,
            rangeProfile: [],
            rays: [],
            arcs: [],
            lines: [],
            zoom,
            pxPerTile,
            tMet,
            tCapture,
            ok: false,
          };
        const { data, width, height } = frame.img;
        // 좌표는 캔버스 px, 읽은 영역(roi) 안으로 옮겨 읽는다
        const px = (x: number, y: number): [number, number, number] => {
          const xi = Math.max(0, Math.min(width - 1, Math.round(x) - roi.x));
          const yi = Math.max(0, Math.min(height - 1, Math.round(y) - roi.y));
          const i = (yi * width + xi) * 4;
          return [data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0];
        };
        /** 쌍선형 표본 밝기 (부분 px 자리) */
        const lumBi = (x: number, y: number): number => {
          const x0 = Math.floor(x - roi.x);
          const y0 = Math.floor(y - roi.y);
          const fx = x - roi.x - x0;
          const fy = y - roi.y - y0;
          const l = (xi: number, yi: number): number => {
            const cx0 = Math.max(0, Math.min(width - 1, xi));
            const cy0 = Math.max(0, Math.min(height - 1, yi));
            const i = (cy0 * width + cx0) * 4;
            return 0.2126 * (data[i] ?? 0) + 0.7152 * (data[i + 1] ?? 0) + 0.0722 * (data[i + 2] ?? 0);
          };
          return (
            l(x0, y0) * (1 - fx) * (1 - fy) +
            l(x0 + 1, y0) * fx * (1 - fy) +
            l(x0, y0 + 1) * (1 - fx) * fy +
            l(x0 + 1, y0 + 1) * fx * fy
          );
        };
        /** f(t)가 문턱 th를 처음 지나는 t (sign = −1: 위 → 아래, +1: 아래 → 위). 0.25px 걸음 + 선형 보간 */
        const crossing = (
          f: (t: number) => number,
          t0: number,
          t1: number,
          th: number,
          sign: 1 | -1,
        ): number | null => {
          let prevT = t0;
          let prevV = f(t0);
          for (let t = t0 + 0.25; t <= t1; t += 0.25) {
            const v = f(t);
            if ((sign < 0 && v < th && prevV >= th) || (sign > 0 && v >= th && prevV < th))
              return prevT + ((th - prevV) / (v - prevV)) * (t - prevT);
            prevT = t;
            prevV = v;
          }
          return null;
        };
        const stats = bodies.map((b) => {
          const [cx, cy] = toPx(b.x, b.y);
          const R = b.r * pxPerTile;
          const disk = 0.45 * R;
          let n = 0;
          let white = 0;
          let minRole = Infinity;
          let sr = 0;
          let sg = 0;
          let sb = 0;
          let lumSum = 0;
          for (let y = Math.floor(cy - disk); y <= Math.ceil(cy + disk); y += 1)
            for (let x = Math.floor(cx - disk); x <= Math.ceil(cx + disk); x += 1) {
              if ((x - cx) ** 2 + (y - cy) ** 2 > disk * disk) continue;
              const [r, g, bl] = px(x, y);
              n += 1;
              sr += r;
              sg += g;
              sb += bl;
              lumSum += relLum(r, g, bl);
              if (
                Math.max(r, g, bl) - Math.min(r, g, bl) <= 24 &&
                (0.2126 * r + 0.7152 * g + 0.0722 * bl) / 255 >= 0.7
              )
                white += 1;
              const L = lab(r, g, bl);
              for (const rl of roleLabs) minRole = Math.min(minRole, dE(L, rl));
            }
          const mean: [number, number, number] = [sr / n, sg / n, sb / n];
          const ref = opts.refColors?.[b.name];
          const deltaE = ref === undefined ? null : dE(lab(mean[0], mean[1], mean[2]), hexLab(ref));
          // 바깥 링: 등 쪽 반원(앞 돌출 — 방패 · 렌즈 · 물방울 끝 — 을 피한다)
          let rn = 0;
          let ringLum = 0;
          let ringRoleHits = 0;
          const refLab = ref === undefined ? null : hexLab(ref);
          const r0 = R + 3 * zoom;
          const r1 = R + 8 * zoom;
          for (let y = Math.floor(cy - r1); y <= Math.ceil(cy + r1); y += 1)
            for (let x = Math.floor(cx - r1); x <= Math.ceil(cx + r1); x += 1) {
              const dd = Math.hypot(x - cx, y - cy);
              if (dd < r0 || dd > r1) continue;
              const a = Math.atan2(y - cy, x - cx) - b.face;
              const back = Math.cos(a) < -0.17;
              const [r, g, bl] = px(x, y);
              if (refLab && dE(lab(r, g, bl), refLab) <= 25) ringRoleHits += 1;
              if (!back) continue;
              rn += 1;
              ringLum += relLum(r, g, bl);
            }
          ringLum /= Math.max(1, rn);
          // 머리 위 문양 자리 (몸 위 2.35r 근처)
          let glyphRoleHits = 0;
          let annulusRoleHits = 0;
          if (refLab) {
            const gy = cy - 2.35 * R;
            for (let y = Math.floor(gy - R); y <= Math.ceil(gy + R); y += 1)
              for (let x = Math.floor(cx - R); x <= Math.ceil(cx + R); x += 1) {
                const [r, g, bl] = px(x, y);
                if (dE(lab(r, g, bl), refLab) <= 25) glyphRoleHits += 1;
              }
            const a0 = 1.75 * R;
            const a1 = 3.3 * R;
            for (let y = Math.floor(cy - a1); y <= Math.ceil(cy + a1); y += 1)
              for (let x = Math.floor(cx - a1); x <= Math.ceil(cx + a1); x += 1) {
                const dd = Math.hypot(x - cx, y - cy);
                if (dd < a0 || dd > a1) continue;
                const [r, g, bl] = px(x, y);
                if (dE(lab(r, g, bl), refLab) <= 25) annulusRoleHits += 1;
              }
          }
          // 몸 원 안의 표시 색 (남의 문양 · 별)
          let bodyMarkHits = 0;
          if (markLabs.length > 0) {
            const br = 0.95 * R;
            for (let y = Math.floor(cy - br); y <= Math.ceil(cy + br); y += 1)
              for (let x = Math.floor(cx - br); x <= Math.ceil(cx + br); x += 1) {
                if ((x - cx) ** 2 + (y - cy) ** 2 > br * br) continue;
                const [r, g, bl] = px(x, y);
                const L = lab(r, g, bl);
                if (markLabs.some((m) => dE(L, m) <= 25)) bodyMarkHits += 1;
              }
          }
          // 몸 흰 영역 반지름: 가운데에서 바깥으로 밝기가 가운데의 절반 아래로 떨어지는 곳(외곽선). 쌍선형 표본 + 선형 보간 (부분 px)
          const lc = lumBi(cx, cy);
          const edge = (a: number): number => {
            const at = (t: number): number => lumBi(cx + Math.cos(a) * t, cy + Math.sin(a) * t);
            return crossing(at, 0.3 * R, 1.8 * R, lc * 0.5, -1) ?? 1.8 * R;
          };
          const widths = [0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4].map(
            (da) => edge(b.face + da) + edge(b.face + da + Math.PI),
          );
          const outerEdge = (a: number): number => {
            const far = 1.8 * R;
            const at = (t: number): number =>
              lumBi(cx + Math.cos(a) * (far - t), cy + Math.sin(a) * (far - t));
            const c = crossing(at, 0, far - 0.3 * R, lc * 0.5, 1);
            return c === null ? 0.3 * R : far - c;
          };
          const outerWidths = [0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4].map(
            (da) => outerEdge(b.face + da) + outerEdge(b.face + da + Math.PI),
          );
          // 접지 그림자: 앞 노치(±50°)와 다른 캐릭터(그 프레임 getDrawn) 쪽을 뺀 여러 방향의 몸 밖 밝기 단면을, 방향마다
          // 배경(2.5r~2.9r 중앙값)과 안쪽(1.25r)으로 정규화한 어둡기로 평균해 절반이 되는 반지름 × 2 (바닥 무늬 · 빛 차이를 줄인다)
          const others = frame.drawn
            .filter((e) => Math.hypot(e.x - b.x, e.y - b.y) > 0.05)
            .map((e) => toPx(e.x, e.y));
          const ts: number[] = [];
          for (let t = 1.25 * R; t <= 2.9 * R + 1e-9; t += 0.25) ts.push(t);
          const dark = ts.map(() => 0);
          let used = 0;
          for (let deg = 50; deg <= 310; deg += 10) {
            const a = b.face + (deg * Math.PI) / 180;
            const ux = Math.cos(a);
            const uy = Math.sin(a);
            // 광선(1.0r~2.9r)에서 0.75타일 안에 다른 캐릭터가 있으면 뺀다
            const near = others.some(([ex, ey]) => {
              const tt = Math.max(R, Math.min(2.9 * R, (ex - cx) * ux + (ey - cy) * uy));
              return Math.hypot(ex - (cx + ux * tt), ey - (cy + uy * tt)) < 0.75 * pxPerTile;
            });
            if (near) continue;
            const prof = ts.map((t) => {
              let sum = 0;
              for (const o of [-1, 0, 1]) sum += lumBi(cx + ux * t - uy * o, cy + uy * t + ux * o);
              return sum / 3;
            });
            const bgs = prof.filter((_, i) => (ts[i] ?? 0) >= 2.5 * R).sort((p, q) => p - q);
            const bg = bgs[Math.floor(bgs.length / 2)] ?? 0;
            const inner = prof[0] ?? 0;
            if (bg - inner < 4) continue;
            // 배경이 고르지 않은 방향(채움 · 시야 경계가 지나는 쪽)은 뺀다: 배경 구간의 흔들림이 어둡기 폭의 15% 넘음
            if ((bgs[bgs.length - 1] ?? 0) - (bgs[0] ?? 0) > 0.15 * (bg - inner)) continue;
            // 선(시야 테두리 · 범위 선)이 가로지르는 방향도 뺀다: 단면 어디든 배경보다 15% 넘게 밝다
            if (prof.some((v) => v > bg + 0.15 * (bg - inner))) continue;
            prof.forEach((v, i) => (dark[i] = (dark[i] ?? 0) + (bg - v) / (bg - inner)));
            used += 1;
          }
          let shadowW: number | null = null;
          if (used >= 4) {
            const avg = dark.map((v) => v / used);
            for (let i = 1; i < avg.length; i += 1) {
              const p0 = avg[i - 1] ?? 0;
              const p1 = avg[i] ?? 0;
              if (p0 > 0.5 && p1 <= 0.5) {
                const t0 = ts[i - 1] ?? 0;
                shadowW = 2 * (t0 + ((p0 - 0.5) / (p0 - p1)) * 0.25);
                break;
              }
            }
          }
          const bodyLum = lumSum / n;
          const contrast = (Math.max(bodyLum, ringLum) + 0.05) / (Math.min(bodyLum, ringLum) + 0.05);
          return {
            name: b.name,
            mean,
            whiteFrac: white / n,
            minRoleDeltaE: minRole,
            deltaE,
            bodyLum,
            ringLum,
            contrast,
            ringRoleHits,
            glyphRoleHits,
            annulusRoleHits,
            bodyMarkHits,
            widths,
            outerWidths,
            shadowW,
          };
        });
        // 공격 범위 경계: 방향을 따라 바깥에서 안으로 오며 처음 만나는 밝은 선(흰 경계 선)의 가운데
        let rangePx: number | null = null;
        let rangeExpectPx: number | null = null;
        let rangeProfile: number[] = [];
        if (opts.range) {
          const [cx, cy] = toPx(opts.range.x, opts.range.y);
          rangeExpectPx = opts.range.tiles * pxPerTile;
          const samples: { t: number; l: number }[] = [];
          for (let t = rangeExpectPx * 1.3; t >= rangeExpectPx * 0.7; t -= 0.25) {
            const [r, g, bl] = px(cx + Math.cos(opts.range.dir) * t, cy + Math.sin(opts.range.dir) * t);
            samples.push({ t, l: 0.2126 * r + 0.7152 * g + 0.0722 * bl });
          }
          rangeProfile = samples.filter((_, i) => i % 2 === 0).map((q) => Math.round(q.l));
          const max = Math.max(...samples.map((q) => q.l));
          let outer: number | null = null;
          let inner: number | null = null;
          for (const q of samples) {
            if (q.l >= max - 25) {
              if (outer === null) outer = q.t;
              inner = q.t;
            } else if (outer !== null) break;
          }
          if (outer !== null && inner !== null) rangePx = (outer + inner) / 2;
        }
        // 봉우리 가운데: 최댓값 근처(최댓값 − 허용)로 이어진 구간의 가운데
        const peakCenter = (s: { t: number; v: number }[], minPeak: number): number | null => {
          let bi = -1;
          let bv = -Infinity;
          s.forEach((q, i) => {
            if (q.v > bv) {
              bv = q.v;
              bi = i;
            }
          });
          if (bi < 0 || bv < minPeak) return null;
          const tol = Math.max(6, 0.12 * bv);
          let i0 = bi;
          let i1 = bi;
          while (i0 > 0 && (s[i0 - 1]?.v ?? -Infinity) >= bv - tol) i0 -= 1;
          while (i1 < s.length - 1 && (s[i1 + 1]?.v ?? -Infinity) >= bv - tol) i1 += 1;
          return ((s[i0]?.t ?? 0) + (s[i1]?.t ?? 0)) / 2;
        };
        const rays = (opts.rays ?? []).map((rp) => {
          const [cx, cy] = toPx(rp.x, rp.y);
          const found = rp.angles.map((a, i) => {
            const e = (rp.expect[i] ?? 0) * pxPerTile;
            const s: { t: number; v: number }[] = [];
            for (let t = e * (rp.lo ?? 0.75); t <= e * (rp.hi ?? 1.25); t += 0.25)
              s.push({ t, v: metricOf(rp.metric, px(cx + Math.cos(a) * t, cy + Math.sin(a) * t)) });
            return peakCenter(s, rp.minPeak ?? 30);
          });
          return { name: rp.name, found, expectPx: rp.expect.map((e) => e * pxPerTile) };
        });
        const arcs = (opts.arcs ?? []).map((as) => {
          const [cx, cy] = toPx(as.x, as.y);
          const rho = as.rho * pxPerTile;
          const s: { t: number; v: number }[] = [];
          const step = 0.25 / rho;
          for (let a = as.a0; a <= as.a1; a += step)
            s.push({ t: a, v: metricOf(as.metric, px(cx + Math.cos(a) * rho, cy + Math.sin(a) * rho)) });
          return { name: as.name, angle: peakCenter(s, 30), rhoPx: rho };
        });
        const lines = (opts.lines ?? []).map((lp) => {
          const [ax, ay] = toPx(lp.ax, lp.ay);
          const [bx, by] = toPx(lp.bx, lp.by);
          const len = Math.hypot(bx - ax, by - ay);
          const ux = (bx - ax) / len;
          const uy = (by - ay) / len;
          const samples: { d: number; v: number }[] = [];
          const lenT = Math.hypot(lp.bx - lp.ax, lp.by - lp.ay);
          for (let dT = 0; dT <= lenT + 1e-9; dT += lp.stepTiles) {
            const t = (dT / lenT) * len;
            let best = -Infinity;
            for (let o = -lp.perpPx; o <= lp.perpPx; o += 0.5)
              best = Math.max(best, metricOf(lp.metric, px(ax + ux * t - uy * o, ay + uy * t + ux * o)));
            samples.push({ d: dT, v: best });
          }
          return { name: lp.name, samples };
        });
        return {
          stats,
          drawn: frame.drawn,
          info: frame.info,
          effects: frame.effects,
          rangePx,
          rangeExpectPx,
          rangeProfile,
          rays,
          arcs,
          lines,
          zoom,
          pxPerTile,
          tMet,
          tCapture,
          ok: true,
        };
      });
    },
    { bodies, clocks, opts },
  );
}

/** 사람이 읽을 요약 한 줄 */
export function describe(c: Capture): string {
  return c.stats
    .map(
      (s) =>
        `${s.name}: 흰 ${(s.whiteFrac * 100).toFixed(0)}% · 역할색 최소 ΔE ${s.minRoleDeltaE.toFixed(1)}` +
        (s.deltaE === null ? '' : ` · 기준 ΔE ${s.deltaE.toFixed(1)}`) +
        ` · 대비 ${s.contrast.toFixed(2)} (몸 ${s.bodyLum.toFixed(3)} / 링 ${s.ringLum.toFixed(3)})`,
    )
    .join(' | ');
}

// ───────────────────────── Node 쪽 색 계산 ─────────────────────────

function linC(c: number): number {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/** sRGB(0~255) → CIE Lab (D65) */
export function labOf(rgb: readonly [number, number, number]): [number, number, number] {
  const R = linC(rgb[0]);
  const G = linC(rgb[1]);
  const B = linC(rgb[2]);
  const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047;
  const Y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  const Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const f = (t: number): number => (t > 216 / 24389 ? Math.cbrt(t) : (841 / 108) * t + 4 / 29);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}

/** 두 sRGB 색의 Lab ΔE (CIE76) */
export function deltaE(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  const p = labOf(a);
  const q = labOf(b);
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

/** 찾은 값 중앙값 (못 찾은 것은 뺀다) */
export function median(xs: readonly (number | null)[]): number | null {
  const v = xs.filter((x): x is number => x !== null).sort((a, b) => a - b);
  if (v.length === 0) return null;
  return v[Math.floor(v.length / 2)] ?? null;
}

// M10b 화면 픽셀 탐침 (m10-visual*.spec.ts): 게임 캔버스를 그린 바로 그 프레임에 페이지 안에서 읽어
// 캐릭터 몸 원판 · 바깥 링의 색 · 밝기와 공격 범위 반지름을 잰다. 큰 이미지를 Node로 옮기지 않는다.
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
  /** 캔버스 px / 논리 px */
  zoom: number;
  ok: boolean;
}

export interface CaptureOptions {
  /** 이 효과 키가 참(또는 0보다 큼)인 프레임을 기다린다 */
  waitEffect?: string;
  /** 몸 원판 평균과 비교할 기준색 (body 이름 → 0xRRGGBB) */
  refColors?: Record<string, number>;
  /** 공격 범위 경계를 잴 중심 · 방향 · 판정 거리 (타일) */
  range?: { x: number; y: number; dir: number; tiles: number };
  timeoutMs?: number;
}

/** 지금 그려진 프레임에서 몸들을 잰다 */
export async function captureBodies(
  page: Page,
  bodies: BodyProbe[],
  opts: CaptureOptions = {},
): Promise<Capture> {
  return page.evaluate(
    async ({ bodies, opts }) => {
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
      const d = window.__DECOY__;
      if (!d) throw new Error('디버그 훅 없음');
      const canvas = document.querySelector<HTMLCanvasElement>('#game-root canvas');
      if (!canvas) throw new Error('게임 캔버스 없음');
      const cond = (): boolean => {
        if (!opts.waitEffect) return true;
        const v = d.getEffects()[opts.waitEffect];
        return v === true || (typeof v === 'number' && v > 0);
      };
      // Phaser가 그린 직후의 프레임에서 복사 (Phaser의 rAF 콜백이 먼저 돈다)
      const frame = await new Promise<{
        img: ImageData;
        drawn: DrawnEntity[];
        info: InfoItem[];
        effects: Record<string, number | boolean>;
      } | null>((resolve) => {
        const start = performance.now();
        const loop = (): void => {
          if (cond()) {
            const c = document.createElement('canvas');
            c.width = canvas.width;
            c.height = canvas.height;
            const ctx = c.getContext('2d', { willReadFrequently: true });
            if (!ctx) {
              resolve(null);
              return;
            }
            ctx.drawImage(canvas, 0, 0);
            resolve({
              img: ctx.getImageData(0, 0, c.width, c.height),
              drawn: d.getDrawn(),
              info: d.getInfoLayer(),
              effects: d.getEffects(),
            });
            return;
          }
          if (performance.now() - start > (opts.timeoutMs ?? 8000)) {
            resolve(null);
            return;
          }
          requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
      });
      if (!frame)
        return {
          stats: [],
          drawn: [],
          info: [],
          effects: {},
          rangePx: null,
          rangeExpectPx: null,
          rangeProfile: [],
          zoom: 1,
          ok: false,
        };
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
      const { data, width, height } = frame.img;
      const px = (x: number, y: number): [number, number, number] => {
        const xi = Math.max(0, Math.min(width - 1, Math.round(x)));
        const yi = Math.max(0, Math.min(height - 1, Math.round(y)));
        const i = (yi * width + xi) * 4;
        return [data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0];
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
        if (refLab) {
          const gy = cy - 2.35 * R;
          for (let y = Math.floor(gy - R); y <= Math.ceil(gy + R); y += 1)
            for (let x = Math.floor(cx - R); x <= Math.ceil(cx + R); x += 1) {
              const [r, g, bl] = px(x, y);
              if (dE(lab(r, g, bl), refLab) <= 25) glyphRoleHits += 1;
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
      return {
        stats,
        drawn: frame.drawn,
        info: frame.info,
        effects: frame.effects,
        rangePx,
        rangeExpectPx,
        rangeProfile,
        zoom,
        ok: true,
      };
    },
    { bodies, opts },
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

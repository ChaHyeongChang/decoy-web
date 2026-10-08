// 로고 원본(PNG 213px)과 다시 그린 SVG를 비교한다 (M10 로고 SVG).
//   node scripts/logo-compare.mjs
// 이미 설치된 Playwright Chromium으로 페이지 안 canvas에서 그리고 재기 때문에 새 의존성이 없다.
// 결과:
//   artifacts/remaster/logo-compare.png  — 위: 원본 213px 확대 | SVG 512px | 겹침 50% | 차이 히트맵
//                                         아래: 64px · 32px(파비콘 · 작은 표시)에서 같은 비교 (4배 확대 + 실제 크기)
//   artifacts/remaster/logo-metrics.json — 크기별 알파 실루엣 IoU, 네온 선 IoU, 평균 색 차 ΔE(CIE Lab)
// 213px 알파 실루엣 IoU가 0.9 미만이거나 두 SVG 파일이 다르면 종료 코드 1.
/* global document, Image */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PNG_PATH = 'docs/images/logo_decoy.png';
const SVG_PATH = 'docs/images/logo_decoy.svg';
const PUBLIC_SVG_PATH = 'client/public/logo.svg';
const OUT_DIR = 'artifacts/remaster';
/** 213px에서 알파 실루엣 IoU 하한 (계획서 M10c 5) */
const MIN_ALPHA_IOU = 0.9;
/** 비교 그림 배경 (VISUAL_SPEC 배경색) */
const BG = '#0B1622';

const pngBuf = readFileSync(join(ROOT, PNG_PATH));
const svgText = readFileSync(join(ROOT, SVG_PATH), 'utf8');
const publicSvgText = readFileSync(join(ROOT, PUBLIC_SVG_PATH), 'utf8');

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  const problems = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') problems.push(msg.text());
  });
  page.on('pageerror', (err) => problems.push(err.message));
  await page.setContent('<!doctype html><meta charset="utf-8"><body></body>');

  const result = await page.evaluate(
    async ({ pngUrl, svgUrl, bg }) => {
      const load = async (src) => {
        const im = new Image();
        im.src = src;
        await im.decode();
        return im;
      };
      const png = await load(pngUrl);
      const svg = await load(svgUrl);
      const canvas = (w, h) => {
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        return c;
      };
      /** 이미지를 size×size로 그린 캔버스 (SVG는 그 크기로 벡터 래스터화, PNG는 고품질 보간) */
      const render = (im, size) => {
        const c = canvas(size, size);
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(im, 0, 0, size, size);
        return c;
      };
      const pixels = (c) =>
        c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data;
      const lab = (r, g, b) => {
        const lin = (u) => {
          const v = u / 255;
          return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
        };
        const R = lin(r);
        const G = lin(g);
        const B = lin(b);
        const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
        const X = f((0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047);
        const Y = f(0.2126 * R + 0.7152 * G + 0.0722 * B);
        const Z = f((0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883);
        return [116 * Y - 16, 500 * (X - Y), 200 * (Y - Z)];
      };
      /** 같은 크기의 두 그림을 잰다: 알파 실루엣 IoU, 네온 선(청록 코어) IoU, 불투명 픽셀 평균 ΔE */
      const measure = (a, b, size) => {
        let inter = 0;
        let union = 0;
        let nInter = 0;
        let nUnion = 0;
        const des = [];
        const deMap = new Float32Array(size * size);
        const compared = new Uint8Array(size * size);
        for (let i = 0; i < size * size; i++) {
          const p = i * 4;
          const sa = a[p + 3] >= 128;
          const sb = b[p + 3] >= 128;
          if (sa && sb) inter++;
          if (sa || sb) union++;
          const na = a[p + 1] - a[p] > 100 && a[p + 1] > 150;
          const nb = b[p + 1] - b[p] > 100 && b[p + 1] > 150;
          if (na && nb) nInter++;
          if (na || nb) nUnion++;
          if (a[p + 3] >= 250 && b[p + 3] >= 250) {
            const la = lab(a[p], a[p + 1], a[p + 2]);
            const lb = lab(b[p], b[p + 1], b[p + 2]);
            const de = Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2]);
            des.push(de);
            deMap[i] = de;
            compared[i] = 1;
          }
        }
        des.sort((x, y) => x - y);
        const mean = des.reduce((s, v) => s + v, 0) / des.length;
        const round = (v) => Math.round(v * 10000) / 10000;
        return {
          stats: {
            alphaIoU: round(inter / union),
            neonIoU: round(nUnion > 0 ? nInter / nUnion : 1),
            meanDeltaE: round(mean),
            p95DeltaE: round(des[Math.floor(des.length * 0.95)]),
            comparedPixels: des.length,
          },
          deMap,
          compared,
        };
      };

      const sizes = [213, 64, 32];
      const metrics = {};
      const maps = {};
      const masks = {};
      for (const s of sizes) {
        const m = measure(pixels(render(png, s)), pixels(render(svg, s)), s);
        metrics[s] = m.stats;
        maps[s] = m.deMap;
        masks[s] = m.compared;
      }
      // SVG가 512px에서 비어 있지 않은지 (불투명 픽셀 비율)
      const big = pixels(render(svg, 512));
      let opaque = 0;
      for (let i = 3; i < big.length; i += 4) if (big[i] >= 250) opaque++;
      const svgOpaque512 = Math.round((opaque / (512 * 512)) * 10000) / 10000;

      // ---- 비교 그림 ----
      const P = 512;
      const GAP = 24;
      const TOP = 64;
      const font = (px, weight = 400) =>
        `${weight} ${px}px "Noto Sans KR", "Malgun Gothic", "Apple SD Gothic Neo", "WenQuanYi Zen Hei", sans-serif`;
      const W = GAP + 4 * (P + GAP);
      const ROW2 = TOP + P + GAP + 56;
      const H = ROW2 + 4 * 64 + 40 + 64 + 60;
      const out = canvas(W, H);
      const ctx = out.getContext('2d');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#E2E8F0';
      ctx.textBaseline = 'alphabetic';
      const label = (text, x, y, px = 22, weight = 600) => {
        ctx.font = font(px, weight);
        ctx.fillStyle = '#E2E8F0';
        ctx.fillText(text, x, y);
      };
      const heat = (deMap, size, mask) => {
        const c = canvas(size, size);
        const g = c.getContext('2d');
        const img = g.createImageData(size, size);
        const NAVY = [24, 36, 52];
        const YELLOW = [250, 204, 21];
        const RED = [239, 68, 68];
        const mixColor = (p, q, t) => p.map((v, k) => Math.round(v + (q[k] - v) * t));
        for (let i = 0; i < size * size; i++) {
          // 0 → 어두운 남색, 10 → 노랑, 25 이상 → 빨강. 비교하지 않은 픽셀(원판 밖)은 투명
          const de = deMap[i];
          const col =
            de <= 10 ? mixColor(NAVY, YELLOW, de / 10) : mixColor(YELLOW, RED, Math.min(1, (de - 10) / 15));
          img.data[i * 4] = col[0];
          img.data[i * 4 + 1] = col[1];
          img.data[i * 4 + 2] = col[2];
          img.data[i * 4 + 3] = mask[i] ? 255 : 0;
        }
        g.putImageData(img, 0, 0);
        return c;
      };
      const panel = (k) => GAP + k * (P + GAP);

      // 위 줄: 512px
      label('원본 PNG 213px 확대', panel(0), TOP - 16);
      label('SVG 512px', panel(1), TOP - 16);
      label('겹침 (원본 위에 SVG 50%)', panel(2), TOP - 16);
      label('차이 ΔE (213px 기준, 0 남색 · 10 노랑 · 25+ 빨강)', panel(3), TOP - 16, 18);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(png, panel(0), TOP, P, P);
      ctx.drawImage(svg, panel(1), TOP, P, P);
      ctx.drawImage(png, panel(2), TOP, P, P);
      ctx.globalAlpha = 0.5;
      ctx.drawImage(svg, panel(2), TOP, P, P);
      ctx.globalAlpha = 1;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(heat(maps[213], 213, masks[213]), panel(3), TOP, P, P);

      // 아래 줄: 64px · 32px (4배 확대한 픽셀 보기 + 실제 크기)
      let x = GAP;
      for (const s of [64, 32]) {
        const z = s * 4;
        const o = render(png, s);
        const v = render(svg, s);
        const mix = canvas(s, s);
        const mctx = mix.getContext('2d');
        mctx.drawImage(o, 0, 0);
        mctx.globalAlpha = 0.5;
        mctx.drawImage(v, 0, 0);
        const items = [
          [`원본 PNG ${s}px`, o],
          [`SVG ${s}px`, v],
          [`겹침 ${s}px`, mix],
        ];
        for (const [text, c] of items) {
          label(text, x, ROW2 - 16, 18);
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(c, x, ROW2, z, z);
          // 실제 크기
          ctx.drawImage(c, x, ROW2 + z + 12);
          x += Math.max(z, 150) + GAP;
        }
        x += GAP;
      }
      ctx.font = font(16, 400);
      ctx.fillStyle = '#94A3B8';
      ctx.fillText('아래 줄: 4배로 키운 픽셀 보기와 그 아래 실제 크기', GAP, ROW2 + 4 * 64 + 12 + 64 + 30);
      const m = metrics[213];
      label(
        `213px: 알파 실루엣 IoU ${m.alphaIoU.toFixed(3)} · 네온 선 IoU ${m.neonIoU.toFixed(3)} · 평균 ΔE ${m.meanDeltaE.toFixed(2)}` +
          `   |   64px: IoU ${metrics[64].alphaIoU.toFixed(3)} · ΔE ${metrics[64].meanDeltaE.toFixed(2)}` +
          `   |   32px: IoU ${metrics[32].alphaIoU.toFixed(3)} · ΔE ${metrics[32].meanDeltaE.toFixed(2)}`,
        GAP,
        H - 20,
        20,
        600,
      );
      return { metrics, svgOpaque512, png: out.toDataURL('image/png') };
    },
    {
      pngUrl: `data:image/png;base64,${pngBuf.toString('base64')}`,
      svgUrl: `data:image/svg+xml;base64,${Buffer.from(svgText).toString('base64')}`,
      bg: BG,
    },
  );

  const sha = (buf) => createHash('sha256').update(buf).digest('hex');
  const identical = svgText === publicSvgText;
  const pass = result.metrics[213].alphaIoU >= MIN_ALPHA_IOU && identical && result.svgOpaque512 > 0.5;
  const metrics = {
    generatedBy: 'scripts/logo-compare.mjs',
    original: { path: PNG_PATH, width: 213, height: 213, bytes: pngBuf.length, sha256: sha(pngBuf) },
    svg: {
      path: SVG_PATH,
      publicCopy: PUBLIC_SVG_PATH,
      identicalCopy: identical,
      bytes: Buffer.byteLength(svgText),
      sha256: sha(Buffer.from(svgText)),
      opaqueRatioAt512: result.svgOpaque512,
    },
    method:
      '두 그림을 같은 크기로 그려(원본 PNG는 고품질 보간, SVG는 그 크기로 벡터 래스터화) 비교한다. ' +
      '알파 실루엣 = 알파 ≥ 128, 네온 선 = G−R > 100 그리고 G > 150, ΔE = 둘 다 알파 ≥ 250인 픽셀의 CIE76(Lab, D65).',
    thresholds: { alphaIoUAt213: MIN_ALPHA_IOU },
    sizes: result.metrics,
    pass,
  };
  const outDir = join(ROOT, OUT_DIR);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'logo-compare.png'), Buffer.from(result.png.split(',')[1], 'base64'));
  writeFileSync(join(outDir, 'logo-metrics.json'), JSON.stringify(metrics, null, 2) + '\n');
  console.log(`[로고 비교] ${OUT_DIR}/logo-compare.png · logo-metrics.json`);
  for (const [s, m] of Object.entries(result.metrics)) {
    console.log(
      `  ${s}px: 알파 IoU ${m.alphaIoU} · 네온 선 IoU ${m.neonIoU} · 평균 ΔE ${m.meanDeltaE} (p95 ${m.p95DeltaE})`,
    );
  }
  console.log(`  SVG ${metrics.svg.bytes}B, 두 파일 같음: ${identical}`);
  if (problems.length > 0) {
    console.error('[로고 비교] 페이지 콘솔 문제:', problems);
    process.exitCode = 1;
  }
  if (!pass) {
    console.error(`[로고 비교] 실패: 213px 알파 IoU ≥ ${MIN_ALPHA_IOU}, 두 SVG 동일, 512px 렌더가 비지 않음`);
    process.exitCode = 1;
  }
} finally {
  await browser.close();
}

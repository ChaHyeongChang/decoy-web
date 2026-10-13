// 렌더링 최적화 전후 스크린샷 화소 비교 (docs/PERF.md 4절, "높음" 품질이 눈에 띄게 바뀌지 않았는지)
//   node scripts/perf-shots-diff.mjs <전 폴더> <후 폴더> [--out=<차이 그림 폴더>] [--json=<결과 파일>]
//   예: node scripts/perf-shots-diff.mjs artifacts/perf/before/high artifacts/perf/after/high --out=artifacts/perf/diff
// 두 폴더에 같은 이름으로 있는 PNG마다: 채널(RGB) 최대 차이, 평균 차이, 차이가 2 · 8 · 32를 넘는 화소 비율.
// --out을 주면 차이가 8을 넘는 화소를 빨갛게 칠한 그림(<이름>.png, 나머지는 전 그림을 어둡게)을 남긴다.
// 이미 설치된 Playwright Chromium의 페이지 canvas로 읽으므로 새 의존성이 없다.
/* global document, Image, ImageData */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith('--'));
const opt = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? null;
if (positional.length !== 2) {
  console.error(
    '사용법: node scripts/perf-shots-diff.mjs <전 폴더> <후 폴더> [--out=<폴더>] [--json=<파일>]',
  );
  process.exit(2);
}
const [beforeDir, afterDir] = positional;
const outDir = opt('out');
const jsonPath = opt('json');
/** 차이 그림에서 빨갛게 칠하는 기준 (채널 차이) */
const MARK = 8;

const names = readdirSync(beforeDir)
  .filter((f) => f.endsWith('.png'))
  .filter((f) => readdirSync(afterDir).includes(f))
  .sort();
if (names.length === 0) throw new Error('두 폴더에 같은 이름의 PNG가 없습니다');
if (outDir) mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const results = [];
try {
  const page = await browser.newPage();
  await page.setContent('<!doctype html><meta charset="utf-8"><body></body>');
  for (const name of names) {
    const a = readFileSync(join(beforeDir, name)).toString('base64');
    const b = readFileSync(join(afterDir, name)).toString('base64');
    const r = await page.evaluate(
      async ({ a, b, mark, wantImage }) => {
        const load = (src) =>
          new Promise((ok, fail) => {
            const img = new Image();
            img.onload = () => ok(img);
            img.onerror = () => fail(new Error('그림을 읽지 못했다'));
            img.src = `data:image/png;base64,${src}`;
          });
        const [ia, ib] = await Promise.all([load(a), load(b)]);
        if (ia.width !== ib.width || ia.height !== ib.height) {
          return { sizeMismatch: `${ia.width}×${ia.height} ≠ ${ib.width}×${ib.height}` };
        }
        const w = ia.width;
        const h = ia.height;
        const pixels = (img) => {
          const c = document.createElement('canvas');
          c.width = w;
          c.height = h;
          const g = c.getContext('2d', { willReadFrequently: true });
          g.drawImage(img, 0, 0);
          return g.getImageData(0, 0, w, h);
        };
        const da = pixels(ia);
        const db = pixels(ib).data;
        const out = wantImage ? new ImageData(w, h) : null;
        let max = 0;
        let sum = 0;
        let over2 = 0;
        let over8 = 0;
        let over32 = 0;
        for (let i = 0; i < da.data.length; i += 4) {
          let m = 0;
          for (let k = 0; k < 3; k += 1) {
            const d = Math.abs(da.data[i + k] - db[i + k]);
            sum += d;
            if (d > m) m = d;
          }
          if (m > max) max = m;
          if (m > 2) over2 += 1;
          if (m > 8) over8 += 1;
          if (m > 32) over32 += 1;
          if (out) {
            const hot = m > mark;
            out.data[i] = hot ? 255 : da.data[i] >> 2;
            out.data[i + 1] = hot ? 40 : da.data[i + 1] >> 2;
            out.data[i + 2] = hot ? 40 : da.data[i + 2] >> 2;
            out.data[i + 3] = 255;
          }
        }
        const n = w * h;
        let image = null;
        if (out) {
          const c = document.createElement('canvas');
          c.width = w;
          c.height = h;
          c.getContext('2d').putImageData(out, 0, 0);
          image = c.toDataURL('image/png').split(',')[1];
        }
        return {
          width: w,
          height: h,
          maxChannelDiff: max,
          meanChannelDiff: sum / (n * 3),
          over2: over2 / n,
          over8: over8 / n,
          over32: over32 / n,
          image,
        };
      },
      { a, b, mark: MARK, wantImage: Boolean(outDir) },
    );
    const { image, ...row } = r;
    if (image && outDir) writeFileSync(join(outDir, name), Buffer.from(image, 'base64'));
    results.push({ file: name, ...row });
  }
} finally {
  await browser.close();
}

const pct = (v) => `${(v * 100).toFixed(3)}%`;
for (const r of results) {
  if (r.sizeMismatch) {
    console.log(`${r.file}: 크기가 다르다 (${r.sizeMismatch})`);
    continue;
  }
  console.log(
    `${r.file}: 최대 ${r.maxChannelDiff} · 평균 ${r.meanChannelDiff.toFixed(3)} · >2 ${pct(r.over2)} · >8 ${pct(r.over8)} · >32 ${pct(r.over32)}`,
  );
}
if (jsonPath) writeFileSync(jsonPath, `${JSON.stringify({ beforeDir, afterDir, results }, null, 2)}\n`);

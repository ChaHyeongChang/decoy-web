// 캐릭터 리디자인 시안 그림 만들기. scripts/char-art/entry.ts를 esbuild로 묶어 헤드리스 Chromium에서 그리고 PNG로 저장한다.
//
// 사용법
//   node scripts/char-art.mjs preview <runner|guard|scout|common|monster ...> [--out=<폴더>]   디자인 미리보기 보드
//   node scripts/char-art.mjs lineup [--out=<폴더>]                                            다섯 캐릭터 한 장
//   node scripts/char-art.mjs metrics [--out=<폴더>]                                           규칙 측정 (IoU · 범위 · 몸 가운데 색) → metrics.json
//   node scripts/char-art.mjs sheets [--out=artifacts/characters/sheets]                       캐릭터별 큰 그림 시트 + 다섯 나란히
//   node scripts/char-art.mjs gifs [장면 id ...] [--out=artifacts/characters/anim] [--fps=25]   동작 GIF (ffmpeg 필요: palettegen · paletteuse)
//   node scripts/char-art.mjs list                                                             GIF 장면 목록
// 기본 출력 폴더: artifacts/characters/_preview (커밋하지 않는 작업 그림은 --out으로 다른 곳에)
/* global window */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const a = args.find((s) => s.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : def;
};
const positional = args.filter((s) => !s.startsWith('--'));
const cmd = positional[0] ?? 'preview';
const defaultOut = { sheets: 'artifacts/characters/sheets', gifs: 'artifacts/characters/anim' }[cmd] ?? 'artifacts/characters/_preview';
const out = resolve(opt('out', defaultOut));
mkdirSync(out, { recursive: true });

const finalCmd = ['sheets', 'gifs', 'list'].includes(cmd);
const bundled = await build({
  entryPoints: [finalCmd ? 'scripts/char-art/final.ts' : 'scripts/char-art/entry.ts'],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  write: false,
  logLevel: 'warning',
  define: { __DECOY_BUILD__: '"char-art"' },
});
const code = bundled.outputFiles[0].text;
const font = readFileSync('client/public/fonts/noto-sans-kr-ui.woff2').toString('base64');

const browser = await chromium.launch({ args: ['--disable-gpu', '--disable-accelerated-2d-canvas'] });
try {
  const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
  const problems = [];
  page.on('pageerror', (e) => problems.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(m.text());
  });
  await page.setContent('<!doctype html><html><body style="background:#0b1622"></body></html>');
  await page.addScriptTag({ content: code });
  await page.evaluate(
    (f) => (window.CHAR_FINAL ?? window.CHAR_ART).loadFont(`data:font/woff2;base64,${f}`),
    font,
  );
  const save = async (name, dataUrl) => {
    const file = join(out, name);
    writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
    console.log(`저장: ${file}`);
  };
  if (cmd === 'preview') {
    const ids = positional.slice(1);
    for (const id of ids.length ? ids : ['runner', 'guard', 'scout', 'common', 'monster']) {
      const url = await page.evaluate((cid) => window.CHAR_ART.previewBoard(cid), id);
      await save(`preview-${id}.png`, url);
    }
  } else if (cmd === 'lineup') {
    await save('lineup.png', await page.evaluate(() => window.CHAR_ART.lineupBoard()));
  } else if (cmd === 'metrics') {
    const m = await page.evaluate(() => window.CHAR_ART.metrics());
    const file = join(out, 'metrics.json');
    writeFileSync(file, JSON.stringify(m, null, 2));
    for (const [size, row] of Object.entries(m.iou))
      console.log(`IoU ${size}: ` + Object.entries(row).map(([k, v]) => `${k} ${v.sil}/${v.fill}`).join(' · '));
    for (const [id, row] of Object.entries(m.extents))
      console.log(`범위 ${id}: ` + Object.entries(row).map(([k, v]) => `${k} 앞${v.front} 뒤${v.back} 옆${v.side}`).join(' · '));
    console.log('몸 가운데: ' + JSON.stringify(m.centerDisc));
    console.log('기준: ' + JSON.stringify(m.rules));
  } else if (cmd === 'list') {
    for (const s of await page.evaluate(() => window.CHAR_FINAL.sceneList()))
      console.log(`${s.id.padEnd(22)} ${s.dur.toFixed(2)}초 ${s.w}×${s.h}  ${s.label}`);
  } else if (cmd === 'sheets') {
    for (const id of ['runner', 'guard', 'scout', 'common', 'monster'])
      await save(`${id}.png`, await page.evaluate((cid) => window.CHAR_FINAL.sheet(cid), id));
    await save('lineup.png', await page.evaluate(() => window.CHAR_FINAL.lineup()));
  } else if (cmd === 'gifs') {
    const fps = Number(opt('fps', '25'));
    const all = await page.evaluate(() => window.CHAR_FINAL.sceneList());
    const want = positional.slice(1);
    const pick = want.length ? all.filter((s) => want.includes(s.id) || want.includes(s.id.split('-')[0])) : all;
    const encode = async (name, frames, rate) => {
      const dir = mkdtempSync(join(tmpdir(), 'char-gif-'));
      try {
        frames.forEach((url, i) =>
          writeFileSync(join(dir, `${String(i).padStart(4, '0')}.png`), Buffer.from(url.split(',')[1], 'base64')),
        );
        const file = join(out, name);
        execFileSync('ffmpeg', [
          '-v', 'error', '-y', '-framerate', String(rate), '-i', join(dir, '%04d.png'),
          '-vf', 'split[a][b];[a]palettegen=max_colors=255:stats_mode=full[p];[b][p]paletteuse=dither=none:diff_mode=rectangle',
          '-loop', '0', file,
        ]);
        console.log(`저장: ${file} (${frames.length}프레임, ${Math.round(statSync(file).size / 1024)}KiB)`);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    };
    for (const s of pick) {
      const frames = [];
      const n = Math.round(s.dur * fps);
      for (let from = 0; from < n; from += 20)
        frames.push(
          ...(await page.evaluate(([id, f, a, c]) => window.CHAR_FINAL.sceneFrames(id, f, a / f, c), [s.id, fps, from, Math.min(20, n - from)])),
        );
      await encode(`${s.id}.gif`, frames, fps);
    }
    // 캐릭터별 모아 보기 (각 칸은 제 길이로 되풀이)
    if (!want.length || want.includes('overview')) {
      const ofps = 20;
      for (const prefix of ['runner', 'guard', 'scout', 'common', 'monster']) {
        // 가장 긴 장면 한 번 길이 (짧은 칸은 그사이 되풀이)
        const longest = Math.max(...all.filter((s) => s.id.startsWith(`${prefix}-`) && !s.id.endsWith('-slow')).map((s) => s.dur));
        const n = Math.ceil(longest * ofps);
        const frames = [];
        for (let from = 0; from < n; from += 10) {
          const r = await page.evaluate(
            ([p, f, a, c]) => window.CHAR_FINAL.overviewFrames(p, f, a / f, c),
            [prefix, ofps, from, Math.min(10, n - from)],
          );
          frames.push(...r.frames);
        }
        await encode(`${prefix}-all.gif`, frames, ofps);
      }
    }
  } else throw new Error(`모르는 명령: ${cmd}`);
  if (problems.length) {
    console.error('브라우저 문제:\n' + problems.join('\n'));
    process.exitCode = 1;
  }
} finally {
  await browser.close();
}

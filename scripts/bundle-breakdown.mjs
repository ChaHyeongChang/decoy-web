// JS 번들 구성 재기 (docs/PERF.md 8절): 배포 빌드를 소스맵을 켜서 임시 폴더에 한 번 더 만들고, 출력 JS의 글자마다
// 어느 원본 파일에서 왔는지 소스맵으로 찾아 갈래별로 더한다. 기록용이다 — 번들 예산 검사는 tests/e2e/bundle-size.spec.ts.
//   node scripts/bundle-breakdown.mjs            # 갈래 표 + 큰 파일 15개 (마크다운)
//   node scripts/bundle-breakdown.mjs --json     # 같은 수치를 JSON으로
// 수치 셋:
//  - 압축 전: 줄인(minify) 출력에서 그 갈래가 차지하는 바이트 (UTF-8)
//  - gzip 몫: 갈래마다 자기 조각만 이어 붙여 따로 gzip한 크기를, 합이 전체 gzip과 같아지게 비례로 맞춘 값
//    (따로 압축하면 갈래 사이의 겹치는 말을 못 써서 합이 전체보다 크다)
//  - 빼면 줄어드는 양: 전체 gzip − 그 갈래 조각을 뺀 나머지의 gzip (그 갈래를 통째로 덜어 내면 줄어들 어림)
// gzip은 bundle-size 시험과 같은 zlib 기본 수준이다. 빌드 ID가 빌드마다 무작위라 전체가 1~2B 다를 수 있다.
// 번들 줄이기: 조각별 표(첫 묶음 · 나눠 받는 조각, gzip · brotli 11 — 서버가 실제로 보내는 사본과 같은 수준)와, 갈래마다
// 첫 묶음에 든 압축 전 바이트(첫 로딩에 받는 몫)를 함께 적는다
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { brotliCompressSync, constants as zlibConstants, gzipSync } from 'node:zlib';
import { build } from 'vite';

const ROOT = resolve(import.meta.dirname, '..');
const asJson = process.argv.includes('--json');

/** 갈래: [큰 갈래, 갈래, 원본 경로(저장소 기준)를 고르는 함수]. 위에서부터 처음 맞는 것 */
const GROUPS = [
  ['엔진', 'Phaser (사용자 빌드)', (p) => p.includes('node_modules/') || p === 'client/src/phaserCore.js'],
  [
    '메타',
    '판 밖 성장 · 보상 (판 기록 · 평가 · 레벨 · 기록 저장 · 결과 평가 패널)',
    (p) =>
      p.startsWith('shared/src/meta/') ||
      p === 'shared/src/sim/record.ts' ||
      p === 'config/progression.json' ||
      p.startsWith('client/src/meta/') ||
      /^client\/src\/ui\/(levelChip|resultRating|resultHost)\.ts$/.test(p),
  ],
  [
    '그래픽 그리는 코드',
    '캐릭터 그림 (그림 명령 · 자세 프레임)',
    (p) => /^client\/src\/art\/(chars\/|charFrames)/.test(p),
  ],
  ['그래픽 그리는 코드', '맵 · 효과 · 아이콘 그림', (p) => p.startsWith('client/src/art/')],
  [
    '그래픽 그리는 코드',
    '렌더링 (안개 · 시야 · 셰이더 · 카메라 · 월드)',
    (p) => p.startsWith('client/src/render/'),
  ],
  ['그래픽 그리는 코드', '품질 · 프레임 페이싱 · 측정', (p) => p.startsWith('client/src/gfx/')],
  ['판 장면', '판 장면 (GameScene)', (p) => p.startsWith('client/src/scenes/')],
  [
    'UI',
    '로비 · 설정 · 결과 · 조작 배치 편집 (DOM)',
    (p) =>
      /^client\/src\/ui\/(lobby|settingsPanel|settingsHost|layoutEditor|layoutEditorLoader|result|lifecycleUi|wakeNotice|uiArt)\.ts$/.test(
        p,
      ) || /^client\/src\/(settingsModel|prefs|controlLayout|touchTutorial|matchMenu)\.ts$/.test(p),
  ],
  [
    'UI',
    '판 HUD (미니맵 · 화면 밖 화살표 · 터치 조작 · 글자 · 디버그 표)',
    (p) => p.startsWith('client/src/ui/'),
  ],
  [
    'UI',
    '문구 (STORY_TEXT)',
    (p) => p === 'client/src/data/storyText.ts' || p === 'client/src/data/accountText.ts',
  ],
  [
    '네트워크 · 입력',
    '네트워크 · 동기화 (접속 · 재접속 · 예측 · 보간)',
    (p) => /^client\/src\/(net|session|serverStatus|sync|wakeNotice|lifecycle)\.ts$/.test(p),
  ],
  [
    '네트워크 · 입력',
    '입력 (키보드 · 마우스 · 터치)',
    (p) => /^client\/src\/(input|touchInput|aimHold|localActions)\.ts$/.test(p),
  ],
  [
    '규칙 · 연습',
    '기기 안 연습 (시뮬레이션 · 봇)',
    (p) => p.startsWith('shared/src/sim/') || p === 'client/src/localServer.ts',
  ],
  [
    '규칙 · 연습',
    '공유 규칙 (이동 · 시야 · 맵 · 수치)',
    (p) => p.startsWith('shared/src/') || p === 'config/balance.json',
  ],
  [
    '앱 · 기타',
    '앱 흐름 · 기기 · 소리 · 디버그 훅',
    (p) => p.startsWith('client/src/') || p.startsWith('docs/'),
  ],
];
const UNMAPPED = ['앱 · 기타', '매핑 없음 (번들러 이음새)'];

const B64 = new Map(
  [...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'].map((c, i) => [c, i]),
);

/** 소스맵 mappings 한 줄을 [생성 열, 원본 번호 | -1] 목록으로 (원본 번호는 줄 사이에도 이어지는 상대값이라 state로 넘긴다) */
function decodeLine(line, state) {
  const out = [];
  let col = 0;
  for (const seg of line.split(',')) {
    if (seg === '') continue;
    const vals = [];
    let v = 0;
    let shift = 0;
    for (const ch of seg) {
      const d = B64.get(ch);
      v += (d & 31) << shift;
      if (d & 32) shift += 5;
      else {
        vals.push(v & 1 ? -(v >>> 1) : v >>> 1);
        v = 0;
        shift = 0;
      }
    }
    col += vals[0];
    if (vals.length >= 4) {
      state.src += vals[1];
      out.push([col, state.src]);
    } else out.push([col, -1]);
  }
  return out;
}

const outDir = mkdtempSync(join(tmpdir(), 'decoy-bundle-'));
try {
  await build({
    configFile: join(ROOT, 'client/vite.config.ts'),
    logLevel: 'error',
    build: { outDir, emptyOutDir: true, sourcemap: true },
  });
  const assets = join(outDir, 'assets');
  const jsFiles = readdirSync(assets).filter((f) => f.endsWith('.js'));
  const groupKeys = [...GROUPS.map((g) => `${g[0]}|${g[1]}`), UNMAPPED.join('|')];
  /** 갈래 → 출력 순서대로 모은 조각 */
  const parts = new Map(groupKeys.map((k) => [k, []]));
  /** 원본 파일 → 압축 전 바이트 */
  const fileBytes = new Map();
  const fileGroup = new Map();
  /** 출력 순서대로 [갈래, 조각] (빼면 줄어드는 양을 잴 때 다시 잇는다) */
  const ordered = [];
  let totalGzip = 0;
  let totalRaw = 0;
  /** 조각별: 이름 · 첫 묶음인가 · 압축 전 · gzip · brotli */
  const chunks = [];
  /** 갈래 → 첫 묶음에 든 압축 전 바이트 */
  const initialRaw = new Map(groupKeys.map((k) => [k, 0]));
  for (const f of jsFiles) {
    // 소스맵 주석은 소스맵을 켠 빌드에만 붙는다 — 빼야 배포 빌드와 같은 글이다
    const code = readFileSync(join(assets, f), 'utf8').replace(/\n?\/\/# sourceMappingURL=\S+\s*$/, '');
    const buf = Buffer.from(code);
    const gz = gzipSync(buf).length;
    const br = brotliCompressSync(buf, {
      params: {
        [zlibConstants.BROTLI_PARAM_QUALITY]: zlibConstants.BROTLI_MAX_QUALITY,
        [zlibConstants.BROTLI_PARAM_MODE]: zlibConstants.BROTLI_MODE_TEXT,
        [zlibConstants.BROTLI_PARAM_SIZE_HINT]: buf.length,
      },
    }).length;
    const initial = f.startsWith('index-');
    chunks.push({ name: f.replace(/-[\w-]+\.js$/, ''), initial, raw: buf.length, gzip: gz, brotli: br });
    totalGzip += gz;
    totalRaw += Buffer.byteLength(code);
    const map = JSON.parse(readFileSync(join(assets, `${f}.map`), 'utf8'));
    const sources = map.sources.map((s) => relative(ROOT, resolve(assets, map.sourceRoot ?? '', s)));
    const groupOfSrc = sources.map((p) => {
      const g = GROUPS.find((x) => x[2](p));
      return g ? `${g[0]}|${g[1]}` : UNMAPPED.join('|');
    });
    const lines = code.split('\n');
    const mapLines = map.mappings.split(';');
    const state = { src: 0 };
    const push = (src, text) => {
      if (text === '') return;
      const key = src < 0 ? UNMAPPED.join('|') : groupOfSrc[src];
      parts.get(key).push(text);
      ordered.push([key, text]);
      if (initial) initialRaw.set(key, initialRaw.get(key) + Buffer.byteLength(text));
      if (src >= 0) {
        const p = sources[src];
        fileBytes.set(p, (fileBytes.get(p) ?? 0) + Buffer.byteLength(text));
        fileGroup.set(p, key);
      }
    };
    for (let li = 0; li < lines.length; li++) {
      const line = lines[li] + (li < lines.length - 1 ? '\n' : '');
      const segs = decodeLine(mapLines[li] ?? '', state);
      if (segs.length === 0 || segs[0][0] > 0)
        push(-1, line.slice(0, segs.length ? segs[0][0] : line.length));
      for (let si = 0; si < segs.length; si++) {
        const end = si + 1 < segs.length ? segs[si + 1][0] : line.length;
        push(segs[si][1], line.slice(segs[si][0], end));
      }
    }
  }
  const rows = groupKeys.map((key) => {
    const text = parts.get(key).join('');
    const rest = ordered
      .filter((o) => o[0] !== key)
      .map((o) => o[1])
      .join('');
    return {
      big: key.split('|')[0],
      name: key.split('|')[1],
      raw: Buffer.byteLength(text),
      initialRaw: initialRaw.get(key),
      alone: text === '' ? 0 : gzipSync(Buffer.from(text)).length,
      removed: totalGzip - gzipSync(Buffer.from(rest)).length,
    };
  });
  const aloneSum = rows.reduce((s, r) => s + r.alone, 0);
  for (const r of rows) r.gzip = (totalGzip * r.alone) / aloneSum;
  const files = [...fileBytes.entries()]
    .map(([p, raw]) => ({ path: p, raw, group: fileGroup.get(p).split('|')[1] }))
    .sort((a, b) => b.raw - a.raw);

  chunks.sort((a, b) => Number(b.initial) - Number(a.initial) || b.gzip - a.gzip);
  if (asJson) {
    console.log(JSON.stringify({ totalGzip, totalRaw, aloneSum, chunks, rows, files }, null, 2));
  } else {
    const kib = (n) => (n / 1024).toFixed(1);
    const pct = (n, d) => `${((100 * n) / d).toFixed(1)}%`;
    console.log(
      `JS ${jsFiles.length}개 · 압축 전 ${totalRaw}B · gzip ${totalGzip}B (갈래마다 따로 압축한 합 ${aloneSum}B)\n`,
    );
    const sumOf = (list, k) => list.reduce((a, c) => a + c[k], 0);
    console.log('| 조각 | 받는 때 | 압축 전 B | gzip B | brotli B |');
    console.log('|---|---|---|---|---|');
    for (const c of chunks)
      console.log(
        `| ${c.name} | ${c.initial ? '첫 화면' : '나눠 받기'} | ${c.raw} | ${c.gzip} | ${c.brotli} |`,
      );
    const first = chunks.filter((c) => c.initial);
    const lazyChunks = chunks.filter((c) => !c.initial);
    console.log(
      `| **첫 로딩 JS** | | **${sumOf(first, 'raw')}** | **${sumOf(first, 'gzip')}** | **${sumOf(first, 'brotli')}** |`,
    );
    console.log(
      `| **나눠 받는 조각 ${lazyChunks.length}개** | | **${sumOf(lazyChunks, 'raw')}** | **${sumOf(lazyChunks, 'gzip')}** | **${sumOf(lazyChunks, 'brotli')}** |`,
    );
    console.log(
      `| **전체 JS** | | **${sumOf(chunks, 'raw')}** | **${totalGzip}** | **${sumOf(chunks, 'brotli')}** |\n`,
    );
    console.log(
      '| 큰 갈래 | 갈래 | 압축 전 KiB | 그중 첫 묶음 KiB | gzip 몫 KiB | 비율 | 빼면 줄어드는 gzip KiB |',
    );
    console.log('|---|---|---|---|---|---|---|');
    for (const r of rows)
      console.log(
        `| ${r.big} | ${r.name} | ${kib(r.raw)} | ${kib(r.initialRaw)} | ${kib(r.gzip)} | ${pct(r.gzip, totalGzip)} | ${kib(r.removed)} |`,
      );
    console.log(
      `| **합** | | **${kib(totalRaw)}** | **${kib(rows.reduce((a, r) => a + r.initialRaw, 0))}** | **${kib(totalGzip)}** | 100% | |\n`,
    );
    const bigs = [...new Set(rows.map((r) => r.big))];
    console.log('| 큰 갈래 | 압축 전 KiB | gzip 몫 KiB | 비율 |');
    console.log('|---|---|---|---|');
    for (const b of bigs) {
      const rs = rows.filter((r) => r.big === b);
      const raw = rs.reduce((s, r) => s + r.raw, 0);
      const gz = rs.reduce((s, r) => s + r.gzip, 0);
      console.log(`| ${b} | ${kib(raw)} | ${kib(gz)} | ${pct(gz, totalGzip)} |`);
    }
    console.log('\n| 큰 파일 (압축 전) | 갈래 | 압축 전 KiB |');
    console.log('|---|---|---|');
    for (const x of files.filter((x) => !x.path.includes('node_modules/')).slice(0, 15))
      console.log(`| \`${x.path}\` | ${x.group} | ${kib(x.raw)} |`);
    // Phaser 안: phaser/src 아래 첫 폴더별 압축 전 바이트 (그 밖의 node_modules는 '그 밖')
    const phaser = new Map();
    for (const x of files) {
      if (!x.path.includes('node_modules/')) continue;
      const m = /node_modules\/phaser\/src\/([^/]+)\//.exec(x.path);
      const k = m ? m[1] : x.path.includes('node_modules/phaser/') ? '(src 바로 아래)' : '그 밖';
      phaser.set(k, (phaser.get(k) ?? 0) + x.raw);
    }
    console.log(
      `\nPhaser 안 (압축 전 KiB): ${[...phaser.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k} ${kib(v)}`)
        .join(' · ')}`,
    );
  }
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

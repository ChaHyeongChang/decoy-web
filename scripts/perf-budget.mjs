// 렌더링 일의 양 예산 기준값 다시 쓰기 (tests/e2e/perfBudget.ts 머리 주석)
//   node scripts/perf-budget.mjs <work-counts.json> [--at=<기준 빌드 설명>]
// tests/perf/work-counts.spec.ts가 센 결과에서 예산 장면 · 셈만 골라 tests/e2e/perf-budget.json의 baseline을 바꾼다(margin은 그대로)
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'tests/e2e/perf-budget.json');
/** 예산을 거는 장면 (E2E 시간을 아끼려 tests/perf/workScene.ts 장면 가운데 셋만, WebGL은 백버퍼 1/4 장면) */
const SCENES = ['canvas-high-runner', 'canvas-high-monster', 'webgl-high-runner-s25'];
/** 렌더러마다 막는 셈 */
const KEYS = {
  canvas: [
    'pathMainPerFrame',
    'paintMainPerFrame',
    'stateMainPerFrame',
    'drawImagePerFrame',
    'pathOffPerFrame',
    'paintOffPerFrame',
    'textPerSec',
    'resizePerSec',
    'readbackPerSec',
  ],
  webgl: [
    'drawsPerFrame',
    'uploadsPerSec',
    'uploadPxPerFrame',
    'bufferBytesPerFrame',
    'programsPerFrame',
    'framebuffersPerFrame',
    'pathOffPerFrame',
    'paintOffPerFrame',
    'textPerSec',
    'resizePerSec',
    'readbackPerSec',
  ],
};

const src = process.argv[2];
if (!src) {
  console.error('사용법: node scripts/perf-budget.mjs <work-counts.json> [--at=<기준 빌드>]');
  process.exit(2);
}
const at = process.argv.find((a) => a.startsWith('--at='))?.slice(5) ?? 'work-counts';
const counts = JSON.parse(readFileSync(src, 'utf8'));
let prev = { margin: 1.05 };
try {
  prev = JSON.parse(readFileSync(OUT, 'utf8'));
} catch {
  // 처음 만든다
}
const scenes = {};
for (const name of SCENES) {
  const row = counts[name];
  if (!row) throw new Error(`${src}에 장면 ${name}이 없다`);
  if (row.frames !== 1200) throw new Error(`${name}: 1200프레임이 아니다 (${row.frames})`);
  const kind = row.scene?.project === 'webgl' ? 'webgl' : 'canvas';
  scenes[name] = Object.fromEntries(KEYS[kind].map((k) => [k, row[k]]));
}
writeFileSync(OUT, `${JSON.stringify({ margin: prev.margin ?? 1.05, measuredAt: at, scenes }, null, 2)}\n`);
console.log(`${OUT} ← ${src} (${at})`);

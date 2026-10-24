// 렌더링 일의 양 예산 기준값 다시 쓰기 (tests/e2e/perfBudget.ts 머리 주석)
//   node scripts/perf-budget.mjs <work-counts.json> [--at=<기준 빌드 설명>]
// tests/perf/work-counts.spec.ts가 센 결과에서 예산 장면 · 셈만 골라 tests/e2e/perf-budget.json의 baseline을 바꾼다(margin은 그대로).
//   --scenes=a,b   이 장면만 다시 쓰고 나머지 장면 기준값 · 잰 빌드는 그대로 둔다 (장면마다 잰 빌드는 sceneAt)
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'tests/e2e/perf-budget.json');
/**
 * 예산을 거는 장면 (tests/perf/workScene.ts에서 budget 표시가 있는 장면과 같아야 한다 — 빠지면 perfBudget.ts 시험이 실패한다).
 * E2E 시간을 아끼려 기존 셋 + 새 캐릭터 셋 + WebGL 품질 중간 하나만, WebGL은 백버퍼 1/4 장면
 */
const SCENES = [
  'canvas-high-runner',
  'canvas-high-monster',
  'webgl-high-runner-s25',
  'canvas-high-runner-new',
  'canvas-high-monster-new',
  'webgl-high-runner-s25-new',
  'webgl-medium-runner-s25',
];
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
const only = process.argv
  .find((a) => a.startsWith('--scenes='))
  ?.slice(9)
  .split(',')
  .filter(Boolean);
const counts = JSON.parse(readFileSync(src, 'utf8'));
let prev = { margin: 1.05 };
try {
  prev = JSON.parse(readFileSync(OUT, 'utf8'));
} catch {
  // 처음 만든다
}
if (only) for (const n of only) if (!SCENES.includes(n)) throw new Error(`예산 장면이 아니다: ${n}`);
const scenes = {};
const sceneAt = {};
for (const name of SCENES) {
  if (only && !only.includes(name)) {
    const kept = prev.scenes?.[name];
    if (!kept) throw new Error(`${name}: 기존 기준값이 없다 (--scenes에 넣어 새로 잰다)`);
    scenes[name] = kept;
    sceneAt[name] = prev.sceneAt?.[name] ?? prev.measuredAt;
    continue;
  }
  const row = counts[name];
  if (!row) throw new Error(`${src}에 장면 ${name}이 없다`);
  if (row.frames !== 1200) throw new Error(`${name}: 1200프레임이 아니다 (${row.frames})`);
  const kind = row.scene?.project === 'webgl' ? 'webgl' : 'canvas';
  scenes[name] = Object.fromEntries(KEYS[kind].map((k) => [k, row[k]]));
  sceneAt[name] = at;
}
// 장면마다 잰 빌드가 모두 같으면 measuredAt 하나로, 다르면 가장 많은 값 + 장면별 sceneAt
const counts2 = {};
for (const v of Object.values(sceneAt)) counts2[v] = (counts2[v] ?? 0) + 1;
const measuredAt = Object.entries(counts2).sort((a, b) => b[1] - a[1])[0][0];
const diff = Object.fromEntries(Object.entries(sceneAt).filter(([, v]) => v !== measuredAt));
const out = {
  margin: prev.margin ?? 1.05,
  measuredAt,
  ...(Object.keys(diff).length ? { sceneAt: diff } : {}),
  scenes,
};
writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`);
console.log(`${OUT} ← ${src} (${at})`);

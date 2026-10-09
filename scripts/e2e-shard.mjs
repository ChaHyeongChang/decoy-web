// 전체 E2E 샤드 (CI 전체 검사, .github/workflows/ci.yml 행렬).
// tests/e2e의 모든 spec 파일을 러너에서 잰 시간(tests/e2e/durations.json, 초)을 무게로 N개 묶음에 고르게 나누고,
// 이 작업의 묶음만 돌린다. 시간표에 없는 새 파일도 기본 무게로 반드시 어느 한 묶음에 들어간다(빠지는 파일 없음).
// Playwright --shard는 테스트 수로 앞에서부터 잘라서, 러너에서 느린 WebGL 파일이 한 작업에 몰린다.
// 쓰기: npm run build && node scripts/e2e-shard.mjs <번호 1..N> <N>
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** 시간표에 없는 파일의 무게 (초) */
export const DEFAULT_SECONDS = 120;
export const E2E_DIR = 'tests/e2e';

/** E2E spec 파일 이름 (이름순) */
export function specFiles(dir = E2E_DIR) {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.spec.ts'))
    .sort();
}

/**
 * 무거운 파일부터 지금 가장 가벼운 묶음에 넣는다. 결정적이다: 무게가 같으면 이름순, 합이 같으면 앞 번호 묶음.
 * @param {readonly string[]} files
 * @param {Readonly<Record<string, number>>} seconds
 * @param {number} n
 * @returns {{ files: string[]; seconds: number }[]}
 */
export function planShards(files, seconds, n) {
  const shards = Array.from({ length: n }, () => ({ files: [], seconds: 0 }));
  const items = files
    .map((f) => ({ f, s: seconds[f] ?? DEFAULT_SECONDS }))
    .sort((a, b) => b.s - a.s || a.f.localeCompare(b.f));
  for (const it of items) {
    let best = shards[0];
    for (const sh of shards) if (sh.seconds < best.seconds) best = sh;
    best.files.push(it.f);
    best.seconds += it.s;
  }
  for (const sh of shards) sh.files.sort();
  return shards;
}

/** Playwright 파일 필터 (정규식으로 해석되므로 점 등을 이스케이프하고 끝에 고정) */
export function fileFilter(file, dir = E2E_DIR) {
  return `${dir}/${file}`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$';
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [k, n] = process.argv.slice(2).map(Number);
  if (!Number.isInteger(n) || n < 1 || !Number.isInteger(k) || k < 1 || k > n) {
    console.error('쓰기: node scripts/e2e-shard.mjs <번호 1..N> <N>');
    process.exit(2);
  }
  const seconds = JSON.parse(readFileSync(`${E2E_DIR}/durations.json`, 'utf8'));
  const shards = planShards(specFiles(), seconds, n);
  shards.forEach((s, i) =>
    console.log(`[샤드 ${i + 1}/${n}] 약 ${(s.seconds / 60).toFixed(1)}분: ${s.files.join(' ')}`),
  );
  const mine = shards[k - 1].files;
  if (mine.length === 0) {
    console.log(`[샤드 ${k}/${n}] 맡은 파일 없음`);
    process.exit(0);
  }
  const r = spawnSync(
    'npx',
    ['playwright', 'test', '--config', 'tests/e2e/playwright.config.ts', ...mine.map((f) => fileFilter(f))],
    { stdio: 'inherit' },
  );
  process.exit(r.status ?? 1);
}

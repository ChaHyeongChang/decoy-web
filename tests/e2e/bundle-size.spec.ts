// JS 번들 크기 예산 (MOBILE_PLAN M10 성능 · 비용): 리마스터 전체로 gzip +40KiB 이하. 휴대폰 첫 접속 시간을 지킨다.
// 빌드 결과(client/dist, test:e2e가 먼저 빌드한다)의 모든 JS를 zlib 기본 수준으로 압축해 더한다.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { expect, test } from '@playwright/test';

/** M10 시작 전(7d79dee) 같은 방법으로 잰 값 (바이트). Vite 표시로는 348.45kB */
const BEFORE_M10 = 346_679;
const BUDGET = 40 * 1024;

test('JS 번들 gzip이 리마스터 전보다 40KiB 넘게 늘지 않는다', { tag: '@core' }, () => {
  const dir = join(process.cwd(), 'client/dist/assets');
  let total = 0;
  for (const f of readdirSync(dir))
    if (f.endsWith('.js')) total += gzipSync(readFileSync(join(dir, f))).length;
  console.log(
    `[번들] JS gzip ${total}B (M10 전 ${BEFORE_M10}B, +${((total - BEFORE_M10) / 1024).toFixed(1)}KiB / 예산 40KiB)`,
  );
  expect(total).toBeGreaterThan(BEFORE_M10 / 2);
  expect(total - BEFORE_M10).toBeLessThanOrEqual(BUDGET);
});

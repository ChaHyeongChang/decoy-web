// JS 번들 크기 예산 (MOBILE_PLAN M10 성능 · 비용): 휴대폰 첫 접속 시간을 지킨다.
// 빌드 결과(client/dist, test:e2e가 먼저 빌드한다)의 모든 JS를 zlib 기본 수준으로 압축해 더한다.
// M10c부터 배포 빌드는 Phaser 사용자 빌드(client/src/phaserCore.js)라 리마스터 전보다 작다. 예산은 그 기준에서 잰다
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { expect, test } from '@playwright/test';

/** M10 시작 전(7d79dee) 같은 방법으로 잰 값 (바이트). Vite 표시로는 348.45kB */
const BEFORE_M10 = 346_679;
/** M10c 계약(Phaser 사용자 빌드 적용 직후) 값 (바이트) */
const PHASER_CORE_BASE = 243_281;
/** M10c(HUD · 로비 · 결과 · 폰트 불러오기 코드)가 더 쓸 수 있는 양 */
const BUDGET = 25 * 1024;

test('JS 번들 gzip: Phaser 사용자 빌드 기준 +25KiB 이하, 리마스터 전보다 작다', { tag: '@core' }, () => {
  const dir = join(process.cwd(), 'client/dist/assets');
  let total = 0;
  for (const f of readdirSync(dir))
    if (f.endsWith('.js')) total += gzipSync(readFileSync(join(dir, f))).length;
  const kib = (n: number): string => `${n >= 0 ? '+' : ''}${(n / 1024).toFixed(1)}KiB`;
  console.log(
    `[번들] JS gzip ${total}B (M10c 기준 ${PHASER_CORE_BASE}B ${kib(total - PHASER_CORE_BASE)} / 예산 +25KiB, M10 전 ${BEFORE_M10}B ${kib(total - BEFORE_M10)})`,
  );
  expect(total).toBeGreaterThan(PHASER_CORE_BASE / 2);
  expect(total - PHASER_CORE_BASE).toBeLessThanOrEqual(BUDGET);
  expect(total).toBeLessThan(BEFORE_M10);
});

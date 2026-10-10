// JS 번들 크기 예산 (MOBILE_PLAN M10 성능 · 비용): 휴대폰 첫 접속 시간을 지킨다.
// 빌드 결과(client/dist, test:e2e가 먼저 빌드한다)의 모든 JS를 zlib 기본 수준으로 압축해 더한다.
// M10c부터 배포 빌드는 Phaser 사용자 빌드(client/src/phaserCore.js)라 리마스터 전보다 작다. 예산은 그 기준에서 잰다
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { expect, test } from '@playwright/test';

/** M10 시작 전(7d79dee) 같은 방법으로 잰 값 (바이트). Vite 표시로는 348.45kB. 이 값을 넘지 않는다(휴대폰 첫 접속) */
const BEFORE_M10 = 346_679;
/**
 * 마일스톤마다의 예산: 직전 마일스톤 병합 값에서 이번 마일스톤이 더 쓸 수 있는 양 (DECISIONS M11 "번들 예산").
 * M10c는 Phaser 사용자 빌드 직후 243,281B에서 +25KiB였다. 다음 마일스톤에서 기준을 그 병합 값으로 옮긴다
 */
const MILESTONE = { name: 'M13c 빠른 매칭', base: 303_210, baseName: 'M13b 병합', budget: 4 * 1024 };

test('JS 번들 gzip: 마일스톤 예산 이하, 리마스터 전보다 작다', { tag: '@core' }, () => {
  const dir = join(process.cwd(), 'client/dist/assets');
  let total = 0;
  for (const f of readdirSync(dir))
    if (f.endsWith('.js')) total += gzipSync(readFileSync(join(dir, f))).length;
  const kib = (n: number): string => `${n >= 0 ? '+' : ''}${(n / 1024).toFixed(1)}KiB`;
  const M = MILESTONE;
  console.log(
    `[번들] JS gzip ${total}B (${M.baseName} ${M.base}B ${kib(total - M.base)} / ${M.name} 예산 +${M.budget / 1024}KiB, M10 전 ${BEFORE_M10}B ${kib(total - BEFORE_M10)})`,
  );
  expect(total).toBeGreaterThan(M.base / 2);
  expect(total - M.base).toBeLessThanOrEqual(M.budget);
  expect(total).toBeLessThan(BEFORE_M10);
});

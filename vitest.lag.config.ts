import { defineConfig } from 'vitest/config';

// 지연(lag 100 · 200) 실시간 봇 전체 판 (BUILD_PLAN M9 검증). 실제 시간으로 판을 끝까지 돌려 몇 분 걸린다
export default defineConfig({
  test: {
    include: ['tests/lag/**/*.test.ts'],
    environment: 'node',
    testTimeout: 600_000,
    hookTimeout: 60_000,
  },
});

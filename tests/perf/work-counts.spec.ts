// 프레임당 일의 양 (렌더링 최적화 2, docs/PERF.md 4.2): 가상 시계 120Hz에서 같은 시드의 봇과 연습 판을 정해진 조작으로 돌리고
// 2D 명령 · 그리기 호출 · 텍스처 올리기 · 캔버스 크기 바꾸기를 센다(workCounts.ts). 시간이 아니라 횟수라 같은 빌드면 같은 수가 나온다 →
// 최적화 전후를 정확히 견준다: DECOY_PERF_DIR=<다른 빌드> DECOY_PERF_LABEL=<이름> npx playwright test --config tests/perf/playwright.config.ts work-counts
// 결과는 artifacts/perf/<label>/work-counts.json. 같은 장면 · 셈을 tests/e2e/perf-budget.spec.ts가 예산으로 막는다
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { test } from '@playwright/test';
import { WORK_SCENES, measureWork } from './workScene';

const LABEL = process.env.DECOY_PERF_LABEL ?? 'current';
const OUT = resolve(import.meta.dirname, `../../artifacts/perf/${LABEL}/work-counts.json`);

function record(name: string, stats: Record<string, unknown>): void {
  mkdirSync(dirname(OUT), { recursive: true });
  const all = existsSync(OUT) ? (JSON.parse(readFileSync(OUT, 'utf8')) as Record<string, unknown>) : {};
  all[name] = stats;
  writeFileSync(OUT, `${JSON.stringify(all, null, 2)}\n`);
}

for (const sc of WORK_SCENES) {
  test(`[${sc.project}] 일의 양 ${sc.name}`, async ({ browser }) => {
    const { counts, problems } = await measureWork(browser, sc);
    console.log(`${LABEL} ${sc.name} ${JSON.stringify(counts)}`);
    record(sc.name, { ...counts, problems, scene: sc });
  });
}

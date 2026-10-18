// 렌더링 일의 양 예산 (렌더링 최적화 2, docs/PERF.md 4.2 · DECISIONS 7절). perf-budget.spec.ts(Canvas) · perf-budget.webgl.spec.ts(WebGL)가 쓴다.
// 가상 시계 120Hz에서 같은 시드 · 같은 조작의 봇과 연습 판을 돌려 센 프레임당 일의 양(tests/perf/workScene.ts)이 기준값 × MARGIN을 넘으면 실패한다.
// 횟수는 기계 · 부하와 상관없이 같은 빌드면 같으므로 시간 게이트(m3-info FPS 게이트)와 달리 흔들리지 않는다.
// 일부러 늘렸다면(새 연출 등) 기준값을 다시 재서 perf-budget.json을 고치고 DECISIONS에 이유를 적는다:
//   DECOY_PERF_LABEL=budget npx playwright test --config tests/perf/playwright.config.ts work-counts
//   node scripts/perf-budget.mjs artifacts/perf/budget/work-counts.json   ← perf-budget.json의 baseline을 다시 쓴다
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { WORK_SCENES, measureWork } from '../perf/workScene';

interface BudgetFile {
  /** 기준값에 곱하는 여유 (작은 코드 변경이 막히지 않게) */
  margin: number;
  /** 기준값을 잰 빌드 */
  measuredAt: string;
  /** 장면마다 기준값을 잰 빌드 (없으면 measuredAt) */
  sceneAt?: Record<string, string>;
  /** 장면 → 셈 이름 → 기준값 (프레임당 · 초당) */
  scenes: Record<string, Record<string, number>>;
}

const BUDGET = JSON.parse(
  readFileSync(resolve(import.meta.dirname, 'perf-budget.json'), 'utf8'),
) as BudgetFile;

/**
 * project의 예산 장면(budget 표시)마다 시험 하나: 120Hz로 다 그렸고(1200프레임) 콘솔 문제 0, 셈마다 기준값 × margin 이하.
 * 새 캐릭터 장면('-new')은 짝 기존 장면 기준값 × margin도 넘지 않는다(같은 예산 안). 기준값이 없으면 실패한다
 */
export function budgetTests(project: 'canvas' | 'webgl'): void {
  for (const sc of WORK_SCENES.filter((s) => s.project === project && s.budget)) {
    const base = BUDGET.scenes[sc.name];
    const pairName = sc.chars ? sc.name.replace(/-new$/, '') : null;
    const pair = pairName ? BUDGET.scenes[pairName] : undefined;
    const at = BUDGET.sceneAt?.[sc.name] ?? BUDGET.measuredAt;
    const pairNote = pairName ? `, 기존 장면 ${pairName} 기준 × ${BUDGET.margin}도` : '';
    test(`일의 양 예산: ${sc.name} (가상 시계 120Hz · 10초, 기준 ${at} × ${BUDGET.margin}${pairNote})`, async ({
      browser,
    }) => {
      test.setTimeout(240_000);
      expect(
        base,
        `perf-budget.json에 ${sc.name} 기준값이 없다 (scripts/perf-budget.mjs SCENES)`,
      ).toBeDefined();
      if (pairName) expect(pair, `perf-budget.json에 짝 기존 장면 ${pairName} 기준값이 없다`).toBeDefined();
      if (!base) return;
      const { counts, problems } = await measureWork(browser, sc);
      expect(problems, '콘솔 에러 · 경고').toEqual([]);
      expect(counts.frames, '120Hz로 10초 = 1200프레임을 모두 그린다').toBe(1200);
      const over: string[] = [];
      for (const [key, ref] of Object.entries(base)) {
        const v = counts[key];
        if (v === undefined) throw new Error(`셈 없음: ${key}`);
        const limit = ref * BUDGET.margin + 1e-9;
        if (v > limit) over.push(`${key} ${v} > ${ref} × ${BUDGET.margin}`);
        const pref = pair?.[key];
        if (pref !== undefined && v > pref * BUDGET.margin + 1e-9)
          over.push(`${key} ${v} > 기존 장면 ${pref} × ${BUDGET.margin}`);
      }
      console.log(
        `[예산] ${sc.name} ${JSON.stringify(Object.fromEntries(Object.keys(base).map((k) => [k, counts[k]])))}`,
      );
      expect(
        over,
        '기준값을 넘은 셈 (일부러 늘렸다면 perf-budget.json을 다시 재고 DECISIONS에 이유를 적는다)',
      ).toEqual([]);
    });
  }
}

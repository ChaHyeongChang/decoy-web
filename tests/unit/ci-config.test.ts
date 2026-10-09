// CI 설정: push · PR은 빠른 검사, 수동 실행(병합 직전)은 전체 검사. 전체 E2E 샤드는 모든 spec 파일을 빠짐없이 한 번씩 돌린다
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { DEFAULT_SECONDS, fileFilter, planShards, specFiles } from '../../scripts/e2e-shard.mjs';

interface Step {
  run?: string;
  uses?: string;
  with?: Record<string, unknown>;
}

interface Job {
  if?: string;
  name: string;
  needs?: string[];
  'timeout-minutes': number;
  strategy?: { 'fail-fast'?: boolean; matrix: { shard: number[] } };
  steps: Step[];
}

const ci = parse(readFileSync('.github/workflows/ci.yml', 'utf8')) as {
  on: Record<string, unknown>;
  jobs: Record<'quick' | 'e2e' | 'lag' | 'deploy' | 'full', Job>;
};
const durations = JSON.parse(readFileSync('tests/e2e/durations.json', 'utf8')) as Record<string, number>;
const DISPATCH_ONLY = "github.event_name == 'workflow_dispatch'";

describe('ci.yml', () => {
  it('push(main) · PR · 수동 실행에서 돈다', () => {
    expect(Object.keys(ci.on).sort()).toEqual(['pull_request', 'push', 'workflow_dispatch']);
  });

  it('빠른 검사는 언제나: 타입 · 린트 · 단위 · 핵심 E2E', () => {
    const q = ci.jobs.quick;
    expect(q.if).toBeUndefined();
    const runs = q.steps.map((s) => s.run).filter(Boolean);
    expect(runs).toEqual(expect.arrayContaining(['npm run check', 'npm test', 'npm run test:e2e:core']));
  });

  it('전체 E2E · 지연 봇 판 · 배포 검증은 수동 실행에서만', () => {
    for (const k of ['e2e', 'lag', 'deploy'] as const) expect(ci.jobs[k].if).toBe(DISPATCH_ONLY);
    expect(ci.jobs.full.if).toBe(`always() && ${DISPATCH_ONLY}`);
    expect(ci.jobs.full.needs?.sort()).toEqual(['deploy', 'e2e', 'lag', 'quick']);
  });

  it('전체 E2E는 샤드 작업 수와 스크립트 인자가 같고, 제한 시간이 넉넉하며, 기록 이름이 겹치지 않는다', () => {
    const e = ci.jobs.e2e;
    const shards = e.strategy?.matrix.shard ?? [];
    expect(shards).toEqual(Array.from({ length: shards.length }, (_, i) => i + 1));
    expect(shards.length).toBeGreaterThanOrEqual(3);
    expect(e.strategy?.['fail-fast']).toBe(false);
    expect(e['timeout-minutes']).toBeGreaterThanOrEqual(40);
    const run = e.steps.find((s) => s.run?.includes('e2e-shard.mjs'))?.run;
    expect(run).toBe(`node scripts/e2e-shard.mjs \${{ matrix.shard }} ${shards.length}`);
    expect(e.name).toContain(`/${shards.length}`);
    const upload = e.steps.find((s) => s.uses?.startsWith('actions/upload-artifact'));
    expect(String(upload?.with?.name)).toContain('${{ matrix.shard }}');
  });
});

describe('전체 E2E 샤드 나누기 (scripts/e2e-shard.mjs)', () => {
  const files = specFiles();

  it('모든 spec 파일이 정확히 한 샤드에 들어간다 (샤드 수 1~6)', () => {
    for (let n = 1; n <= 6; n++) {
      const all = planShards(files, durations, n).flatMap((s) => s.files);
      expect(all.sort()).toEqual([...files].sort());
    }
  });

  it('시간표에 없는 새 파일도 기본 무게로 들어간다', () => {
    const shards = planShards([...files, 'zz-new.spec.ts'], durations, 4);
    const owner = shards.filter((s) => s.files.includes('zz-new.spec.ts'));
    expect(owner).toHaveLength(1);
    const total = shards.reduce((a, s) => a + s.seconds, 0);
    const known = files.reduce((a, f) => a + (durations[f] ?? DEFAULT_SECONDS), 0);
    expect(total).toBe(known + DEFAULT_SECONDS);
  });

  it('결정적이고 고르다: 가장 무거운 샤드 − 가장 가벼운 샤드 ≤ 가장 무거운 파일', () => {
    const a = planShards(files, durations, 4);
    expect(planShards([...files].reverse(), durations, 4)).toEqual(a);
    const loads = a.map((s) => s.seconds);
    const heaviest = Math.max(...files.map((f) => durations[f] ?? DEFAULT_SECONDS));
    expect(Math.max(...loads) - Math.min(...loads)).toBeLessThanOrEqual(heaviest);
  });

  it('시간표의 파일은 모두 실제로 있다 (지운 파일이 남지 않게)', () => {
    for (const f of Object.keys(durations)) expect(files).toContain(f);
  });

  it('파일 필터는 그 파일만 고른다 (점 이스케이프 · 끝 고정)', () => {
    const re = new RegExp(fileFilter('m10-map.spec.ts'), 'i');
    expect(re.test('/repo/tests/e2e/m10-map.spec.ts')).toBe(true);
    expect(re.test('/repo/tests/e2e/m10-map.webgl.spec.ts')).toBe(false);
    expect(re.test('/repo/tests/e2e/m10-mapXspec.ts')).toBe(false);
  });
});

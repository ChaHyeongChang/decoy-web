// 내 캐릭터 움직임 고르기 표 (docs/PERF.md 5절): artifacts/perf/motion/<이름>/motion.json 두 개를 견준다.
//   node scripts/motion-table.mjs before after        → 전 → 후 요약 표 (마크다운)
//   node scripts/motion-table.mjs after --excerpt p60-runner  → 그 장면 프레임별 발췌
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const load = (label) =>
  JSON.parse(
    readFileSync(resolve(import.meta.dirname, `../artifacts/perf/motion/${label}/motion.json`), 'utf8'),
  );

const ex = args.indexOf('--excerpt');
if (ex >= 0) {
  const label = args[0];
  const scene = args[ex + 1];
  const rows = load(label)[scene]?.excerpt ?? [];
  console.log(
    '| 프레임 | 간격 ms | ① 그린 자리 변화 px | ② 카메라 이동 px | ③ 화면 위 자리 px (첫 프레임 기준) | 대기 입력 |',
  );
  console.log('|---|---|---|---|---|---|');
  rows.forEach((r, i) => console.log(`| ${i + 1} | ${r.dt} | ${r.d1} | ${r.d2} | ${r.s3} | ${r.pend} |`));
  process.exit(0);
}

const [a, b] = args;
const A = load(a);
const B = b ? load(b) : null;
const f = (v, d = 2) => (typeof v === 'number' ? v.toFixed(d) : '—');
const pair = (x, y, d = 2) => (B ? `${f(x, d)} → ${f(y, d)}` : f(x, d));
const pct = (n, total) => (total > 0 ? (100 * n) / total : 0);

console.log(
  '| 장면 | FPS | 간격 p95 · 최대 ms | ① 비율 p5~p95 | ① 멈칫 · 튐 % | ① 기대와 차 p95 px | ② 비율 p5~p95 | ③ 변화 p95 · 최대 px | ③ 폭 px | 화면 지연 ms | 첫 움직임 ms |',
);
console.log('|---|---|---|---|---|---|---|---|---|---|---|');
for (const name of Object.keys(A)) {
  const x = A[name];
  const y = B?.[name];
  const w = x.walk;
  const v = y?.walk;
  const sp = (s) => `${f(s.p5)}~${f(s.p95)}`;
  const bad = (s) => pct(s.stall1 + s.jump1, s.pairs);
  const cell = (fn) => (v ? `${fn(w)} → ${fn(v)}` : fn(w));
  console.log(
    `| ${name} | ${pair(w.fps, v?.fps, 1)} | ${cell((s) => `${f(s.interval.p95, 1)} · ${f(s.interval.max, 1)}`)} | ${cell((s) => sp(s.r1))} | ${cell((s) => f(bad(s), 1))} | ${pair(w.err1.p95, v?.err1.p95)} | ${cell((s) => sp(s.r2))} | ${cell((s) => `${f(s.d3.p95)} · ${f(s.d3.max)}`)} | ${pair(w.range3, v?.range3)} | ${pair(w.behindMs.mean, v?.behindMs.mean, 1)} | ${pair(x.latency.move.mean, y?.latency.move.mean, 1)} |`,
  );
}

// 둘째 표: 프레임당 이동 변동(간격으로 나누지 않음 — 고르지 않은 간격까지 보인다) · 입력 지연 · 프레임 작업 시간
console.log('');
console.log(
  '| 장면 | ① 프레임당 이동 변동 계수 | 첫 움직임 평균 · p95 ms | 보이는 첫 움직임(1px) 평균 · p95 ms | 카메라 첫 움직임 평균 ms | 작업 p95 · 최대 ms | 간격 최대 ms | 대기 입력 평균 |',
);
console.log('|---|---|---|---|---|---|---|---|');
for (const name of Object.keys(A)) {
  const x = A[name];
  const y = B?.[name];
  const w = x.walk;
  const v = y?.walk;
  const cell = (fn) => (v ? `${fn(w, x)} → ${fn(v, y)}` : fn(w, x));
  const visCell = (_s, r) =>
    r.latency.visible ? `${f(r.latency.visible.mean, 1)} · ${f(r.latency.visible.p95, 1)}` : '—';
  console.log(
    `| ${name} | ${cell((s) => f(s.cv1, 3))} | ${cell((_s, r) => `${f(r.latency.move.mean, 1)} · ${f(r.latency.move.p95, 1)}`)} | ${cell(visCell)} | ${cell((_s, r) => f(r.latency.camera.mean, 1))} | ${cell((s) => `${f(s.work.p95, 1)} · ${f(s.work.max, 1)}`)} | ${cell((s) => f(s.interval.max, 1))} | ${cell((s) => f(s.pending, 2))} |`,
  );
}

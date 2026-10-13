// 렌더링 최적화 성능 측정 결과(tests/perf → artifacts/perf/<label>/frame-perf.json)를 전후 표(마크다운)로 만든다 (docs/PERF.md 4절)
//   node scripts/perf-table.mjs <이름>=<폴더 또는 쉼표로 이은 폴더들> ...
//   예: node scripts/perf-table.mjs 전=artifacts/perf/runs/before-1,artifacts/perf/runs/before-2 \
//                                   후=artifacts/perf/runs/after-a-1,artifacts/perf/runs/after-a-2
// 같은 이름에 폴더를 여럿 주면 장면별로 평균한다(번갈아 잰 회차). 장면마다 열 하나에 '전 → 후' 값을 적는다
// --work: 가상 시계로 센 일의 양(work-counts.json, tests/perf/work-counts.spec.ts)을 표로 — 횟수라 회차 하나로 충분하다
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const WORK = process.argv.includes('--work');
const groups = process.argv
  .slice(2)
  .filter((a) => !a.startsWith('--'))
  .map((a) => {
    const [name, dirs] = a.split('=');
    if (!name || !dirs) throw new Error(`인자 형식: <이름>=<폴더>[,<폴더>] (받은 값 ${a})`);
    return {
      name,
      runs: dirs
        .split(',')
        .map((d) => JSON.parse(readFileSync(join(d, WORK ? 'work-counts.json' : 'frame-perf.json'), 'utf8'))),
    };
  });
if (groups.length === 0) throw new Error('비교할 묶음이 없다');

/** 일의 양 표 (프레임당 · 초당) */
const WORK_COLUMNS = [
  ['2D 경로(화면)/프레임', 'pathMainPerFrame', 1],
  ['2D 경로(밖)/프레임', 'pathOffPerFrame', 1],
  ['2D 칠하기(화면)/프레임', 'paintMainPerFrame', 1],
  ['2D 칠하기(밖)/프레임', 'paintOffPerFrame', 1],
  ['2D 상태(화면)/프레임', 'stateMainPerFrame', 1],
  ['drawImage/프레임', 'drawImagePerFrame', 1],
  ['글자 그리기/초', 'textPerSec', 1],
  ['캔버스 크기 바꾸기/초', 'resizePerSec', 1],
  ['GL 그리기/프레임', 'drawsPerFrame', 2],
  ['텍스처 올리기/초', 'uploadsPerSec', 1],
  ['올린 화소/프레임', 'uploadPxPerFrame', 0],
  ['버퍼 바이트/프레임', 'bufferBytesPerFrame', 0],
];
/** 표에 넣는 값: [열 이름, 키, 소수 자리] */
const FRAME_COLUMNS = [
  ['FPS', 'fps', 1],
  ['간격 p95 ms', 'intervalP95', 1],
  ['작업 평균 ms', 'workAvg', 2],
  ['작업 p95 ms', 'workP95', 1],
  ['8.33ms 넘는 작업', 'over120', 3],
  ['그리기/프레임', 'drawsAvg', 1],
  ['올리기/초', 'uploadsPerSec', 1],
  ['2D 명령/프레임', 'ops2dPerFrame', 1],
  ['할당 MB/초', 'allocMBps', 1],
  ['GC/초', 'gcPerSec', 2],
  ['메인 스레드 ms/초', 'mainBusyMsPerSec', 0],
];
const COLUMNS = WORK ? WORK_COLUMNS : FRAME_COLUMNS;

const mean = (vals) => vals.reduce((a, b) => a + b, 0) / vals.length;
const scenarios = Object.keys(groups[0].runs[0]);
const value = (g, sc, key) => {
  const vals = g.runs.map((r) => r[sc]?.[key]).filter((v) => typeof v === 'number');
  return vals.length > 0 ? mean(vals) : null;
};

const lines = [];
lines.push(`| 장면 | ${COLUMNS.map((c) => c[0]).join(' | ')} |`);
lines.push(`|---|${COLUMNS.map(() => '---').join('|')}|`);
for (const sc of scenarios) {
  const cells = COLUMNS.map(([, key, digits]) =>
    groups
      .map((g) => {
        const v = value(g, sc, key);
        return v === null ? '-' : v.toFixed(digits);
      })
      .join(' → '),
  );
  lines.push(`| ${sc} | ${cells.join(' | ')} |`);
}
console.log(`값: ${groups.map((g) => `${g.name}(${g.runs.length}회 평균)`).join(' → ')}\n`);
console.log(lines.join('\n'));

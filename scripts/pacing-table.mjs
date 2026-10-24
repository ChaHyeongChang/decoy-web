// 잔렉 측정 표 (docs/PERF.md 6절): tests/perf/pacing.spec.ts가 쓴 artifacts/perf/pacing/<label>/<장면>.json을 마크다운 표로.
//   node scripts/pacing-table.mjs before after            # 전 → 후 (장면마다 한 줄)
//   node scripts/pacing-table.mjs after                   # 한 빌드
//   node scripts/pacing-table.mjs after --excerpt 144-sustained   # 프레임별 발췌
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../artifacts/perf/pacing');
const args = process.argv.slice(2);
const exIdx = args.indexOf('--excerpt');
const excerptOf = exIdx >= 0 ? args[exIdx + 1] : null;
const labels = args.filter((a, i) => !a.startsWith('--') && (exIdx < 0 || i !== exIdx + 1));
if (labels.length === 0) labels.push('current');

function load(label) {
  const dir = resolve(ROOT, label);
  const out = {};
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    out[f.slice(0, -5)] = JSON.parse(readFileSync(resolve(dir, f), 'utf8'));
  }
  return out;
}

const runs = labels.map(load);
const f1 = (v) =>
  v === undefined || v === null || Number.isNaN(v) ? '-' : (Math.round(v * 10) / 10).toString();
const f2 = (v) =>
  v === undefined || v === null || Number.isNaN(v) ? '-' : (Math.round(v * 100) / 100).toString();
const hz = (v) => (v === undefined ? '-' : Number.isInteger(v) ? String(v) : f1(v));
const join = (vals) => vals.join(' → ');
const cam = (h) =>
  h
    ? Object.entries(h)
        .sort((a, b) => Number(a[0]) - Number(b[0]))
        .map(([k, n]) => `${k}:${n}`)
        .join(' ')
    : '-';

if (excerptOf) {
  for (const [i, run] of runs.entries()) {
    const d = run[excerptOf];
    if (!d) continue;
    console.log(`\n${labels[i]} ${excerptOf} (기기 px, 걷는 중 가운데 24프레임)\n`);
    console.log(
      '| rAF 시각 ms | 간격 ms | 시작 늦음 ms | 표시 vsync ms | 표시 지연 ms | ① 그린 자리 변화 px | ② 카메라 이동 px | ③ 화면 위 내 자리 px | ⑤ 빛 − 몸 px |',
    );
    console.log('|---|---|---|---|---|---|---|---|---|');
    const fr = d.excerpt;
    const s = d.summary;
    const k = s.devPerTile;
    const dpc = s.devPerCss;
    const mid = Math.max(1, Math.floor(fr.length / 2) - 12);
    let eye = null;
    let lastFog = null;
    // 빛 중심 x: 고친 뒤 빌드는 안개 주기 눈 + 실제로 옮긴 양, 고치기 전 빌드는 안개를 다시 그린 프레임의 내 자리
    const eyes = fr.map((f) => {
      if (f.fogAt !== lastFog) {
        eye = f.mx;
        lastFog = f.fogAt;
      }
      if (f.fogEye !== undefined) return f.fogEye ? f.fogEye.x + (f.fogShift?.x ?? 0) : null;
      return eye;
    });
    const p0 = fr[mid].px;
    for (let j = mid; j < Math.min(fr.length, mid + 24); j += 1) {
      const a = fr[j - 1];
      const b = fr[j];
      const light = eyes[j] === null ? NaN : (b.cx + eyes[j] * b.k - b.px) * dpc;
      console.log(
        `| ${f1(b.t)} | ${f2(b.t - a.t)} | ${f1(b.start - b.t)} | ${b.disp === null ? '-' : f1(b.disp)} | ${b.disp === null ? '-' : f1(b.disp - b.t)} | ${f2(Math.abs(b.mx - a.mx) * k)} | ${f2(Math.abs(b.cx - a.cx) * dpc)} | ${f2((b.px - p0) * dpc)} | ${f2(light)} |`,
      );
    }
  }
  process.exit(0);
}

const names = [...new Set(runs.flatMap((r) => Object.keys(r)))];
const order = (n) => {
  const m = /^(\d+)-/.exec(n);
  return m ? Number(m[1]) : 1e4;
};
names.sort((a, b) => {
  const pa = a.startsWith('pc') || a.startsWith('phone');
  const pb = b.startsWith('pc') || b.startsWith('phone');
  if (pa !== pb) return pa ? 1 : -1;
  return order(a) - order(b) || a.localeCompare(b);
});

console.log(
  `\n### 걷기 (${labels.join(' → ')})\n\n| 장면 | 목표 Hz | 그린 FPS | ④ rAF 간격 ms (최소~최대 · 변동 계수) | ④ 표시 간격 변동 계수 | 표시 ≠ 계산 프레임 % | 표시 지연 ms (p5~p95) | ① 비율 p5~p95 | ③ 화면 위 내 자리 폭 px | ⑤ 시야 빛 − 몸 폭 px | 맵 스크롤 어긋남 p95 px | 시야 빛 어긋남 p95 px |`,
);
console.log('|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const n of names) {
  const cells = (fn) => join(runs.map((r) => (r[n] ? fn(r[n].summary, r[n]) : '-')));
  console.log(
    `| ${n} | ${cells((s) => hz(s.targetHz))} | ${cells((s) => f1(s.fps))} | ${cells((s) => `${f1(s.rafIv.min)}~${f1(s.rafIv.max)} · ${f2(s.rafCv)}`)} | ${cells((s) => f2(s.display?.dispCv))} | ${cells((s) => f1(s.display?.mismatchPct))} | ${cells((s) => (s.display ? `${f1(s.display.latency.p5)}~${f1(s.display.latency.p95)}` : '-'))} | ${cells((s) => `${f2(s.r1.p5)}~${f2(s.r1.p95)}`)} | ${cells((s) => f2(s.range3))} | ${cells((s) => f1(s.fogRange))} | ${cells((s) => f2(s.display?.mapErr.p95))} | ${cells((s) => f1(s.display?.fogErr.p95))} |`,
  );
}

console.log(
  `\n### 카메라 · 입력 (${labels.join(' → ')})\n\n| 장면 | 기기 px/타일 | ② 카메라 px/프레임 (값:개수) | ② 변동 계수 | 안개 갱신 간격 ms (p5~p95) | 콜백 시작 늦음 p95 ms | 키 → 첫 움직임 표시 ms (p50 · p95) |`,
);
console.log('|---|---|---|---|---|---|---|');
for (const n of names) {
  const cells = (fn) => join(runs.map((r) => (r[n] ? fn(r[n].summary, r[n]) : '-')));
  console.log(
    `| ${n} | ${cells((s) => f1(s.devPerTile))} | ${cells((s) => cam(s.cam))} | ${cells((s) => f2(s.cv2))} | ${cells((s) => `${f1(s.fogIv.p5)}~${f1(s.fogIv.p95)}`)} | ${cells((s) => f1(s.startLag.p95))} | ${cells((s, d) => `${f1(d.latency.p50)} · ${f1(d.latency.p95)}`)} |`,
  );
}

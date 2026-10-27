// 판 평가 기준 맞추기 (기록용): 실전 봇 넷 판을 시드 여럿으로 끝까지 돌려 평가 점수 · 등급 분포를 본다.
// 실행: npx tsx scripts/meta-calibrate.ts [판 수=60]. 봇은 사람보다 서툴러, 봇 판 중앙값이 은(2) 안팎이면 기준이 알맞다(GAME_DESIGN 12장)
import { readFileSync } from 'node:fs';
import { validateBalance } from '@decoy/shared';
import { PROGRESSION, matchXp, rateMatch } from '@decoy/shared/meta';
import { MatchRecorder, SimMatch, practiceBrain, preparePracticeMap, type BotBrain } from '@decoy/shared/sim';

const balance = validateBalance(JSON.parse(readFileSync('config/balance.json', 'utf8')));
const N = Number(process.argv[2] ?? 60);
preparePracticeMap();
const scores = new Map<string, number[]>();
const tiers = new Map<string, number[]>();
const stats = new Map<string, number[]>();
const xp: number[] = [];
let survWins = 0;
for (let seed = 1; seed <= N; seed += 1) {
  const setup = SimMatch.roles();
  const brains = new Map<string, BotBrain>(setup.map((p) => [p.id, practiceBrain(p.role, seed)]));
  const sim = new SimMatch(setup, balance, brains, seed);
  sim.recorder = new MatchRecorder(sim.game);
  const limit = Math.ceil(balance.match.timeLimit / sim.game.dt) + 2;
  for (let i = 0; i < limit && !sim.game.end; i += 1) sim.step();
  const rec = sim.recorder.finish(sim.game, `cal-${seed}`);
  if (rec.winner === 'survivors') survWins += 1;
  for (const p of rec.players) {
    const r = rateMatch({ ...rec, role: p.role, stats: p.stats }, PROGRESSION);
    xp.push(matchXp(r, PROGRESSION).total);
    for (const e of r.emblems) {
      (scores.get(e.id) ?? scores.set(e.id, []).get(e.id)!).push(e.score);
      (tiers.get(e.id) ?? tiers.set(e.id, []).get(e.id)!).push(e.tier);
    }
    for (const [k, v] of Object.entries(p.stats)) (stats.get(k) ?? stats.set(k, []).get(k)!).push(v ?? 0);
  }
}
const q = (a: number[], f: number): number => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(f * s.length))] ?? 0;
};
console.log(`판 ${N} · 생존자 승 ${survWins}`);
console.log('| 평가 | 점수 p10 · p50 · p90 | 등급 0·1·2·3·4 | 기준 |');
for (const [id, arr] of scores) {
  const t = tiers.get(id) ?? [];
  const hist = [0, 1, 2, 3, 4].map((k) => t.filter((v) => v === k).length).join('·');
  console.log(
    `| ${id} | ${q(arr, 0.1)} · ${q(arr, 0.5)} · ${q(arr, 0.9)} | ${hist} | ${PROGRESSION.emblems[id as 'capture'].tiers.join(' ')} |`,
  );
}
console.log('수치 p10 · p50 · p90:');
for (const [k, arr] of stats) console.log(`  ${k}: ${q(arr, 0.1)} · ${q(arr, 0.5)} · ${q(arr, 0.9)}`);
console.log(`경험치 p10 · p50 · p90: ${q(xp, 0.1)} · ${q(xp, 0.5)} · ${q(xp, 0.9)}`);

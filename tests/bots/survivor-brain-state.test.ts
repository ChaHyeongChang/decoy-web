// 실전 생존자 봇 두뇌 (플레이테스트 반영 c 검토 반영): 두뇌가 기억하는 상태가 끝날 때를 지킨다
//  - 두뇌 시계는 판이 흐른 시간만 센다: 판 정지(괴물 재접속 대기) 동안 두뇌를 부르지 않아 스냅샷 틱이 건너뛰어도
//    탐지 대기 · 지켜짐 기억 · 기다림 차례가 정지가 없을 때와 같다
import { beforeAll, describe, expect, it } from 'vitest';
import {
  BTN,
  CAPTURE_POINTS,
  RESCUE_POINT,
  type InputFrame,
  type MatchInfo,
  type RoleId,
  type Snapshot,
} from '@decoy/shared';
import {
  PracticeSurvivorBrain,
  SimMatch,
  idleBrain,
  preparePracticeMap,
  survivorPlan,
  type BotBrain,
} from '@decoy/shared/sim';
import { loadTestBalance, place } from '../helpers/fixtures';

const balance = loadTestBalance();
const HZ = balance.network.serverTickHz;
const ROLES: readonly RoleId[] = ['runner', 'guard', 'scout'];
/** SimMatch.roles()의 자리: 괴물 p1, 러너 p2, 가드 p3, 스카우트 p4 */
const SEAT: Readonly<Record<RoleId, string>> = { runner: 'p2', guard: 'p3', scout: 'p4' };

beforeAll(() => {
  preparePracticeMap();
});

/** 손으로 맞추는 장면: 준 두뇌 말고는 모두 가만히 있고, 괴물 시작 정지는 없다 */
function scene(seed: number, brains: Readonly<Record<string, BotBrain>> = {}): SimMatch {
  const setup = SimMatch.roles();
  const sim = new SimMatch(
    setup,
    balance,
    new Map(setup.map((p) => [p.id, brains[p.id] ?? idleBrain])),
    seed,
  );
  sim.game.monster.move.frozen = 0;
  return sim;
}

/** 손으로 바꾼 판 상태가 스냅샷에 담길 때까지 (스냅샷은 20Hz라 틱마다 오지 않는다) */
function refreshSnapshots(sim: SimMatch): void {
  const before = sim.lastSnap.get('p1');
  for (let i = 0; i < 4 && sim.lastSnap.get('p1') === before; i += 1) sim.step();
}

/** 한 역할의 스냅샷 · MatchInfo (괴물이 나(30.5, 24.5)에서 동쪽 gap 타일, 다른 생존자는 멀리) */
function closeUp(role: RoleId, gap: number): { snap: Snapshot; info: MatchInfo } {
  const sim = scene(1);
  const g = sim.game;
  for (const r of ROLES)
    if (r !== role) place(g, SEAT[r], r === 'guard' ? 5.5 : 4.5, r === 'scout' ? 28.5 : 4.5);
  place(g, SEAT[role], 30.5, 24.5);
  place(g, 'p1', 30.5 + gap, 24.5, Math.PI);
  for (const s of g.survivors) s.abilityCd = 30;
  refreshSnapshots(sim);
  const snap = sim.lastSnap.get(SEAT[role]);
  const info = sim.infos.get(SEAT[role]);
  if (!snap || !info || !snap.monster) throw new Error('장면 스냅샷 없음');
  return { snap, info };
}

/** 같은 스냅샷을 틱만 올려 보낸다 (monster를 바꿔 끼울 수 있다) */
function at(snap: Snapshot, tick: number, monster: Snapshot['monster']): Snapshot {
  return { ...snap, tick, monster, events: [] };
}

/** 입력 · 두뇌 상태를 한 줄로 (두 두뇌의 결정이 같은지 견주기) */
function trace(out: InputFrame, brain: PracticeSurvivorBrain): string {
  const d = brain.debugState();
  const r = (v: number): string => v.toFixed(3);
  const st = d
    ? `${d.kind}${d.probe ? '+probe' : ''}${d.fleeing ? '+flee' : ''} → (${r(d.target.x)}, ${r(d.target.y)})`
    : '-';
  return `${r(out.mx)},${r(out.my)} p${out.pressed} h${out.held} ${st}`;
}

// ───────────────────────── 판 정지 ─────────────────────────

describe('생존자 봇: 판 정지(괴물 재접속 대기)로 틱이 건너뛰어도 두뇌 시계는 판 시간으로 센다', () => {
  /**
   * 스카우트가 계획 첫 거점 안에서 점령 중, 괴물은 안 보인다. pause가 있으면 그 틱 구간 동안 두뇌를 부르지 않는다
   * (BotDriver · 서버 봇이 정지 중에 하는 대로 — 스냅샷 틱은 정지 중에도 오른다). 첫 탐지의 판 시각(틱, 정지 구간 뺌)
   */
  function firstTrack(pause: { from: number; len: number } | null): number {
    const sim = scene(1);
    const a = CAPTURE_POINTS[survivorPlan(7, 'scout')[0] ?? 'A'];
    place(sim.game, 'p4', a.x, a.y);
    place(sim.game, 'p1', 45, 28);
    refreshSnapshots(sim);
    const snap = sim.lastSnap.get('p4');
    const info = sim.infos.get('p4');
    if (!snap || !info) throw new Error('스냅샷 없음');
    const brain = new PracticeSurvivorBrain('scout', 7);
    let paused = 0;
    for (let tick = 0; tick < 60 * HZ; tick += 1) {
      if (pause && tick >= pause.from && tick < pause.from + pause.len) {
        paused += 1;
        continue;
      }
      const s: Snapshot = {
        ...snap,
        tick,
        monster: null,
        marks: [],
        events: [],
        you: { ...snap.you, surv: snap.you.surv ? { ...snap.you.surv, abilityCd: 0 } : null },
      };
      const out = brain.decide(s, info, balance, tick + 1);
      if ((out.pressed & BTN.ABILITY) !== 0) return tick - paused;
    }
    return -1;
  }

  it('정지 20초가 끼어도 스카우트 첫 탐지는 판 시간으로 같은 때 (재개 첫 틱에 바로 쓰지 않는다)', () => {
    const plain = firstTrack(null);
    expect(plain).toBeGreaterThan(10 * HZ);
    expect(firstTrack({ from: 10 * HZ, len: 20 * HZ })).toBe(plain);
    expect(firstTrack({ from: 3 * HZ, len: 30 * HZ })).toBe(plain);
  });

  it('정지 앞뒤로 지켜짐 기억 · 기다리기 · 들어가 보기 결정이 정지가 없을 때와 판 시간으로 같다', () => {
    // 동료 둘은 갇혔고(할 일이 구조뿐), 괴물은 구조 지점 남쪽 2타일에서 보였다가 안 보인다 → 지켜짐 기억(8초) 동안 기다린다
    for (const role of ROLES) {
      const { snap, info } = closeUp(role, 1.0);
      const base = snap.monster;
      if (!base) throw new Error('괴물 없음');
      const survivors = snap.survivors.map((v, i) => ({
        ...v,
        status: 'imprisoned' as const,
        x: 23.5 + i,
        y: 15.5,
      }));
      const run = (pauseLen: number): string[] => {
        const brain = new PracticeSurvivorBrain(role, 9);
        const lines: string[] = [];
        let tick = 100;
        for (let k = 0; k < 14 * HZ; k += 1) {
          // 1초째에서 정지 (정지 중 두뇌를 부르지 않는다)
          if (k === HZ) tick += pauseLen;
          const seen = k < 2;
          const s: Snapshot = {
            ...at(snap, tick, seen ? { ...base, x: RESCUE_POINT.x, y: RESCUE_POINT.y + 2, windup: 0 } : null),
            survivors,
            you: { ...snap.you, surv: snap.you.surv ? { ...snap.you.surv, spotted: false } : null },
          };
          const out = brain.decide(s, info, balance, k + 1);
          lines.push(`${(k / HZ).toFixed(2)}초 ${trace(out, brain)}`);
          tick += 1;
        }
        return lines;
      };
      const plain = run(0);
      // 검사가 헛돌지 않게: 정지가 없으면 기억이 남은 동안 기다리고(wait), 기억이 끝난 뒤에는 구조하러 간다
      expect(
        plain.some((l) => l.includes(' wait')),
        role,
      ).toBe(true);
      expect(
        plain.some((l) => l.includes(' rescue')),
        role,
      ).toBe(true);
      expect(run(20 * HZ), role).toEqual(plain);
    }
  });
});

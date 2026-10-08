// M3: 정보 차단. 각 클라이언트가 받은 모든 스냅샷 원문을 서버 정답 기록과 대조한다.
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { validateBalance, type Balance, type Snapshot } from '@decoy/shared';
import { anyVisible, circleVerdict, monsterVerdict, type Verdict } from './infoCheck';
import { collectFrames, type CollectedFrames } from './frames';
import { closeAll, sendTest, startFourPlayerMatch, type Player } from './helpers';

const balance: Balance = validateBalance(JSON.parse(readFileSync('config/balance.json', 'utf8')));

interface TruthPlayer {
  id: string;
  role: string;
  x: number;
  y: number;
  face: number;
  status: string;
}
interface TruthFrame {
  room: string;
  tick: number;
  players: TruthPlayer[];
  monster: { aim: number; blend: number; mode: string; windup: number } | null;
  reveal: { id: string; left: number }[];
  tracked: number;
  roarReveal: number;
}

function loadTruth(room: string): Map<number, TruthFrame> {
  const map = new Map<number, TruthFrame>();
  const text = readFileSync('tests/e2e/.results/truth.jsonl', 'utf8');
  for (const line of text.split('\n')) {
    if (!line.includes(`"room":"${room}"`)) continue;
    const f = JSON.parse(line) as TruthFrame;
    map.set(f.tick, f);
  }
  return map;
}

function monsterVerdictFor(f: TruthFrame, s: TruthPlayer): Verdict {
  const m = f.players.find((p) => p.role === 'monster')!;
  return monsterVerdict(balance, m.x, m.y, f.monster!.aim, f.monster!.blend, s.x, s.y);
}

function survivorsSeeMonster(f: TruthFrame): Verdict {
  const m = f.players.find((p) => p.role === 'monster')!;
  const v: Verdict[] = [];
  for (const s of f.players) {
    if (s.role === 'monster' || s.status === 'dead' || s.status === 'escaped') continue;
    const r = s.role === 'scout' ? balance.roles.scout.visionRadius : balance.survivor.visionRadius;
    v.push(circleVerdict(s.x, s.y, r, m.x, m.y));
  }
  return anyVisible(v);
}

async function scenario(players: Player[]): Promise<void> {
  const monster = players.find((p) => p.role === 'monster')!;
  const page = monster.page;
  // 괴물을 감옥 남쪽으로 옮겨 감옥 쪽을 보게 한다. 생존자는 흩어진다
  await sendTest(page, { kind: 'teleport', target: monster.id, x: 24, y: 23, face: -Math.PI / 2 });
  await page.waitForTimeout(300);
  const runner = players.find((p) => p.role === 'runner')!;
  const guard = players.find((p) => p.role === 'guard')!;
  const scout = players.find((p) => p.role === 'scout')!;
  await sendTest(page, { kind: 'teleport', target: runner.id, x: 8, y: 16 });
  await sendTest(page, { kind: 'teleport', target: guard.id, x: 24, y: 19.5 });
  await sendTest(page, { kind: 'teleport', target: scout.id, x: 36, y: 16 });
  // 괴물은 조준을 돌리며 시야 모드를 바꾼다, 생존자는 움직인다
  const aims = [
    { x: 24, y: 10 },
    { x: 34, y: 18 },
    { x: 14, y: 22 },
    { x: 24, y: 28 },
  ];
  await runner.page.keyboard.down('KeyD');
  await scout.page.keyboard.down('KeyA');
  // 능력 노출 · 탐지 · 포효 예외 구간도 함께 검사한다
  await scout.page.keyboard.press('Space');
  await runner.page.keyboard.press('Space');
  for (let i = 0; i < aims.length; i += 1) {
    const a = aims[i]!;
    const c = await page.evaluate((t) => window.__DECOY__?.tileToClient(t.x, t.y) ?? null, a);
    await page.mouse.move(c!.x, c!.y, { steps: 8 });
    if (i === 1) {
      await page.mouse.down({ button: 'right' });
      await page.mouse.up({ button: 'right' });
    }
    if (i === 2) await page.keyboard.press('KeyQ');
    await guard.page.keyboard.down(i % 2 === 0 ? 'KeyA' : 'KeyD');
    await page.waitForTimeout(900);
    await guard.page.keyboard.up(i % 2 === 0 ? 'KeyA' : 'KeyD');
  }
  await runner.page.keyboard.up('KeyD');
  await scout.page.keyboard.up('KeyA');
  await page.waitForTimeout(300);
}

test('괴물 · 생존자가 받은 스냅샷 전체에 시야 밖 상대 좌표가 한 번도 없다', async ({ browser }) => {
  const { code, players } = await startFourPlayerMatch(browser);
  const frames = new Map<string, CollectedFrames>();
  // 이미 열린 소켓은 잡을 수 없으므로 새로고침해서 같은 자리로 다시 들어온다
  for (const p of players) {
    frames.set(p.id, collectFrames(p.page));
    await p.page.reload();
    await p.page.waitForFunction(() => (window.__DECOY__?.snapCount ?? 0) > 3);
  }
  await scenario(players);
  const truth = loadTruth(code);
  const survivorIds = players.filter((p) => p.role !== 'monster').map((p) => p.id);

  // ── 괴물이 받은 것 ──
  const monster = players.find((p) => p.role === 'monster')!;
  const mFrames = frames.get(monster.id)!;
  let hiddenFrames = 0;
  let visibleFrames = 0;
  let checked = 0;
  for (const { raw, snap } of mFrames.snaps) {
    const f = truth.get(snap.tick);
    if (!f || !f.monster) continue;
    checked += 1;
    const verdicts = new Map<string, Verdict>();
    for (const s of f.players) {
      if (s.role === 'monster' || s.status === 'dead' || s.status === 'escaped') continue;
      verdicts.set(s.id, monsterVerdictFor(f, s));
    }
    if ([...verdicts.values()].includes('hidden')) hiddenFrames += 1;
    if ([...verdicts.values()].includes('visible')) visibleFrames += 1;
    // 받은 생존자는 모두 실제로 보이는(또는 경계의) 생존자와 위치가 맞아야 한다
    for (const e of snap.survivors) {
      const match = f.players.find((p) => p.role !== 'monster' && Math.hypot(p.x - e.x, p.y - e.y) < 0.01);
      expect(match, `틱 ${snap.tick}: 정답에 없는 위치`).toBeTruthy();
      expect(
        verdicts.get(match!.id),
        `틱 ${snap.tick}: 시야 밖 생존자 ${match!.id} 좌표가 괴물에게 갔다`,
      ).not.toBe('hidden');
      // 역할 · 실제 ID 노출 금지 (능력 노출 창 제외)
      const revealed = (f.reveal.find((r) => r.id === match!.id)?.left ?? 0) > 0;
      if (!revealed) expect(e.role).toBeNull();
      expect(survivorIds).not.toContain(e.id);
    }
    // 보이는 생존자는 빠짐없이 받는다
    const visibleCount = [...verdicts.values()].filter((v) => v === 'visible').length;
    expect(snap.survivors.length).toBeGreaterThanOrEqual(visibleCount);
    // 원문에도 생존자 실제 ID가 없다
    for (const id of survivorIds) expect(raw.includes(`"${id}"`), `원문에 ${id}`).toBe(false);
    expect(snap.monster).toBeNull();
    expect(snap.world.exits.every((x) => x.progress === null)).toBe(true);
  }
  expect(checked).toBeGreaterThan(60);
  // 빈 통과 방지: 숨은 생존자가 있는 프레임과 보이는 생존자가 있는 프레임이 충분히 있었다
  expect(hiddenFrames / checked).toBeGreaterThan(0.3);
  expect(visibleFrames / checked).toBeGreaterThan(0.1);

  // ── 생존자가 받은 것 ──
  let monsterHidden = 0;
  let monsterSeen = 0;
  for (const p of players.filter((q) => q.role !== 'monster')) {
    for (const { snap } of frames.get(p.id)!.snaps) {
      const f = truth.get(snap.tick);
      if (!f) continue;
      const v = survivorsSeeMonster(f);
      if (v === 'hidden') {
        monsterHidden += 1;
        expect(snap.monster, `틱 ${snap.tick}: 시야 밖 괴물 좌표가 ${p.role}에게 갔다`).toBeNull();
        // 마커는 탐지 · 포효 노출 창에서만 허용
        if (f.tracked <= 0 && f.roarReveal <= 0) expect(snap.marks.length).toBe(0);
      }
      if (v === 'visible') {
        monsterSeen += 1;
        expect(snap.monster).not.toBeNull();
      }
      // 팀원은 항상 보인다
      expect(snap.survivors.length).toBe(2);
    }
  }
  expect(monsterHidden).toBeGreaterThan(20);
  expect(monsterSeen).toBeGreaterThan(20);
  for (const p of players) expect(p.problems).toEqual([]);
  await closeAll(players);
});

async function measureFps(players: Player[]): Promise<number[]> {
  await players[0]!.page.waitForTimeout(3000);
  const samples: number[][] = players.map(() => []);
  for (let i = 0; i < 10; i += 1) {
    await players[0]!.page.waitForTimeout(1000);
    for (let k = 0; k < players.length; k += 1) {
      samples[k]!.push(await players[k]!.page.evaluate(() => window.__DECOY__?.fps ?? 0));
    }
  }
  return samples.map((s) => s.reduce((a, b) => a + b, 0) / s.length);
}

for (const scale of ['1', '0.5']) {
  test(`브라우저 4개 동시 실행 FPS (Canvas 렌더러, 헤드리스, scale=${scale})`, async ({ browser }) => {
    const q = `&scale=${scale}`;
    const { players } = await startFourPlayerMatch(browser, undefined, [q, q, q, q]);
    // 괴물을 생존자 근처로 옮겨 서로 보이는 상태(가장 많이 그리는 상태)에서 잰다
    const monster = players.find((p) => p.role === 'monster')!;
    await sendTest(monster.page, { kind: 'teleport', target: monster.id, x: 24, y: 21, face: -Math.PI / 2 });
    const avgs = await measureFps(players);
    const avg = avgs.reduce((a, b) => a + b, 0) / avgs.length;
    console.log(
      `FPS scale=${scale} 탭별 평균: ${avgs.map((v) => v.toFixed(1)).join(', ')} / 전체 ${avg.toFixed(1)}`,
    );
    test.info().annotations.push({ type: `fps-scale-${scale}`, description: avg.toFixed(1) });
    // 게이트: 저사양 모드(scale 0.5) 55 이상. 전체 해상도는 회귀 감시용 하한 30 (CPU 래스터 4탭 + 서버가 4코어를 나눠 쓴다)
    expect(avg).toBeGreaterThanOrEqual(scale === '0.5' ? 55 : 30);
    for (const p of players) expect(p.problems).toEqual([]);
    await closeAll(players);
  });
}

void (null as unknown as Snapshot);

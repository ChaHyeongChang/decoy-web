// '매미 붙기' 재현 (11/18 수업 시연 피드백): 생존자가 괴물 몸에 딱 붙어 옆 · 등 뒤로 돌면 공격이 거의 안 맞던 것.
// 실제 판(Game)에 입력만 넣는다 — 판정은 서버 코드 그대로다.
//  - 매미 생존자: 괴물 몸에 닿은 채(중심 거리 = 두 몸 반지름 합 + 0.01) 한쪽으로 계속 돈다
//  - 사람 흉내 괴물: 화면에 보이는 생존자 자리(보간 100ms + 지연 약 70ms = 5틱 전 자리)를 겨누고 다가가며,
//    사거리 안이라고 보이면 쿨타임이 끝나는 대로 누른다
// 근접 판정(monster.attack.closeRange) 전에는 조준이 준비 시작 때 고정되고(0.4초) 판정이 앞 90° 부채꼴이라
// 붙어 도는 생존자가 0.4초에 약 2타일(몸 둘레 반 바퀴 이상)을 돌아 거의 늘 빗나갔다
import { describe, expect, it } from 'vitest';
import { BTN, type Vec2 } from '@decoy/shared';
import type { Game } from '@decoy/shared/sim';
import { Driver, place, readyGame } from '../helpers/fixtures';

/** 트인 자리 (동쪽 방 x 35–46, y 10–13 바닥) */
const CENTER: Vec2 = { x: 39.5, y: 12 };

interface Run {
  swings: number;
  hits: number;
}

/**
 * seconds 동안 매미 생존자(p2) 대 사람 흉내 괴물(p1). 맞아도 체력을 되돌려 계속 붙어 돈다.
 * delayTicks = 괴물이 보는 생존자 자리가 몇 틱 전 것인가, flipEvery = 도는 방향을 바꾸는 간격(초, 0이면 안 바꿈)
 */
function cicada(game: Game, seconds: number, delayTicks: number, flipEvery = 0): Run {
  const d = new Driver(game);
  const b = game.balance;
  const m = game.monster;
  const s = game.survivorById('p2');
  if (!s) throw new Error('러너 없음');
  const contact = b.monster.radius + b.survivor.radius + 0.01;
  place(game, 'p1', CENTER.x, CENTER.y, 0);
  place(game, 'p2', CENTER.x + contact, CENTER.y);
  place(game, 'p3', 8, 16);
  place(game, 'p4', 8, 17);
  const seen: Vec2[] = [];
  let swings = 0;
  const before = m.stats.hitsLanded;
  let spin = 1;
  const ticks = d.seconds(seconds);
  for (let t = 0; t < ticks; t += 1) {
    if (flipEvery > 0 && t > 0 && t % d.seconds(flipEvery) === 0) spin = -spin;
    seen.push({ x: s.move.x, y: s.move.y });
    const view = seen[Math.max(0, seen.length - 1 - delayTicks)] ?? s.move;
    // 생존자: 몸 둘레 접선 방향 + 거리 보정 (닿은 채로 돈다)
    const rx = s.move.x - m.move.x;
    const ry = s.move.y - m.move.y;
    const dist = Math.hypot(rx, ry) || 1;
    const ux = rx / dist;
    const uy = ry / dist;
    const k = 3 * (contact - dist);
    const sx = -uy * spin + ux * k;
    const sy = ux * spin + uy * k;
    // 괴물: 보이는 자리를 겨누고 다가간다. 사거리 안으로 보이면 누른다
    const vx = view.x - m.move.x;
    const vy = view.y - m.move.y;
    const vd = Math.hypot(vx, vy) || 1;
    const aim = Math.atan2(vy, vx);
    const reach = b.monster.attack.range + b.survivor.radius - 0.2;
    const press = vd <= reach && m.attackCd <= 0 && m.windupLeft <= 0;
    if (press) swings += 1;
    d.input('p1', vx / vd, vy / vd, { aim, pressed: press ? BTN.ATTACK : 0 });
    d.input('p2', sx, sy);
    d.input('p3', 0, 0);
    d.input('p4', 0, 0);
    game.step();
    // 맞아도 감옥으로 가지 않게 (붙어 도는 상황만 잰다)
    s.hp = b.survivor.maxHp;
  }
  return { swings, hits: m.stats.hitsLanded - before };
}

/** 지연(틱) × 도는 방향 바꾸기(초) 조합. 한 조합만 보면 도는 주기와 공격 주기가 맞물려 우연히 맞거나 빗나간다 */
const DELAYS = [0, 2, 4, 6, 8];
const FLIPS = [0, 0.5, 0.9];

function grid(seconds: number): { swings: number; hits: number; worst: number } {
  let swings = 0;
  let hits = 0;
  let worst = 1;
  let seed = 1;
  for (const delay of DELAYS)
    for (const flip of FLIPS) {
      const r = cicada(readyGame(seed), seconds, delay, flip);
      seed += 1;
      swings += r.swings;
      hits += r.hits;
      worst = Math.min(worst, r.swings > 0 ? r.hits / r.swings : 0);
    }
  return { swings, hits, worst };
}

describe('매미 붙기 (괴물 몸에 붙어 옆 · 등 뒤로 도는 생존자)', () => {
  it('보이는 자리가 0~8틱 늦은 사람 흉내 괴물이 붙어 도는 생존자를 거의 늘 맞힌다 (근접 판정, 15조합 × 20초)', () => {
    const r = grid(20);
    expect(r.swings).toBeGreaterThan(150);
    // 근접 판정 전(05e9580): 전체 명중 약 35%, 가장 나쁜 조합 0% (지연 0 — 준비가 끝날 때 생존자가 거의 정확히 등 뒤)
    expect(r.hits / r.swings).toBeGreaterThan(0.9);
    expect(r.worst).toBeGreaterThan(0.75);
  });
});

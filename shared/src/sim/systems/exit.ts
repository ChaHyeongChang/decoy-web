// 탈출구 (GAME_DESIGN 8장)
//   두 거점을 모두 점령하면 활성화. 자유 생존자 2명 이상이 같은 탈출구 반경 1.5 안에 함께 3초 → 그 문이 열린다
//   인원이 모자라면 진행은 0으로. 괴물이 있어도 멈추지 않는다(exit.pausedWhenMonsterInside: false)
//   한 번 열린 문은 끝까지 열려 있고, 열린 문 칸(외벽)으로 걸어 들어가면 탈출
import { CAPTURE_POINTS, EXITS, inRect } from '../../index';
import type { Game } from '../game';
import type { SurvivorState } from '../state';

export function exitTick(game: Game): void {
  const b = game.balance.exit;
  const m = game.monster;
  for (const e of game.exits) {
    const def = EXITS[e.id];
    if (e.state === 'active') {
      const near = game.survivors.filter(
        (s) =>
          s.status === 'free' && Math.hypot(s.move.x - def.center.x, s.move.y - def.center.y) <= b.radius,
      );
      const monsterInside = Math.hypot(m.move.x - def.center.x, m.move.y - def.center.y) <= b.radius;
      const paused = b.pausedWhenMonsterInside && monsterInside;
      if (near.length >= b.requiredSurvivors) {
        if (!paused) e.progress += game.dt;
      } else {
        e.progress = 0;
      }
      if (e.progress >= b.openTime - 1e-9) {
        e.state = 'open';
        e.progress = b.openTime;
        for (const p of game.players.values())
          game.emitTo(p, { k: 'text', id: 'ALERT_EXIT_OPEN', exit: e.id });
      }
    }
    if (e.state === 'open') {
      for (const s of game.survivors) {
        if (s.status === 'free' && inRect(s.move, def.door)) escape(game, s);
      }
    }
  }
}

function escape(game: Game, s: SurvivorState): void {
  s.status = 'escaped';
  s.rescueProgress = 0;
  for (const t of game.survivors) game.emitTo(t, { k: 'escaped', you: t === s });
  game.emitTo(game.monster, { k: 'escaped', you: false });
}

/** 거점이 모두 끝났는가 (테스트 · 봇용) */
export function allPointsDone(game: Game): boolean {
  return game.points.length === Object.keys(CAPTURE_POINTS).length && game.points.every((p) => p.done);
}

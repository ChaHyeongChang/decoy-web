// 거점 점령 (GAME_DESIGN 7장)
//   안에 자유 생존자가 있으면 게이지가 오른다. 1명 40초, 2명 이상 1.5배
//   괴물이 안에 있으면 멈춘다. 단, 괴물이 monsterBlockGrace(5초) 넘게 연속으로 머물면 정지가 풀린다(DECISIONS)
//   생존자가 없어도 게이지는 줄지 않는다
//   점령 시작 → 괴물에게 알림(배지 깜빡임 + 문구), 완료 → 양쪽 배너 + 생존자에게 스토리 메모(점령 순서대로)
import { CAPTURE_POINTS, exceeds, reached } from '../../index';
import type { Game } from '../game';
import type { CapturePointState } from '../state';

export function captureTick(game: Game): void {
  const b = game.balance.capturePoint;
  const m = game.monster;
  for (const p of game.points) {
    const center = CAPTURE_POINTS[p.id];
    const monsterInside = Math.hypot(m.move.x - center.x, m.move.y - center.y) <= b.radius;
    m.pointCamp[p.id] = monsterInside ? m.pointCamp[p.id] + game.dt : 0;
    if (p.done) {
      p.capturing = false;
      p.blocked = false;
      continue;
    }
    const inside = game.survivors.filter(
      (s) => s.status === 'free' && Math.hypot(s.move.x - center.x, s.move.y - center.y) <= b.radius,
    );
    p.blocked =
      inside.length > 0 &&
      b.pausedWhenMonsterInside &&
      monsterInside &&
      !exceeds(m.pointCamp[p.id], b.monsterBlockGrace);
    p.capturing = inside.length > 0 && !p.blocked;
    if (p.capturing) {
      if (!p.wasCapturing && reached(game.time - p.lastAlertAt, b.alertCooldown)) {
        p.lastAlertAt = game.time;
        game.emitTo(m, { k: 'text', id: 'ALERT_CAPTURE_START', point: p.id });
      }
      const rate = inside.length >= 2 ? b.groupMultiplier : 1;
      p.progress = Math.min(b.captureTime, p.progress + game.dt * rate);
      for (const s of inside) s.stats.captureSeconds += game.dt;
      if (p.progress >= b.captureTime - 1e-9) complete(game, p);
    }
    p.wasCapturing = p.capturing;
  }
}

function complete(game: Game, p: CapturePointState): void {
  p.done = true;
  p.progress = game.balance.capturePoint.captureTime;
  p.capturing = false;
  game.capturedCount += 1;
  const order = game.capturedCount;
  for (const s of game.survivors) {
    game.emitTo(s, { k: 'text', id: 'ALERT_CAPTURE_DONE', point: p.id });
    // 스토리 메모는 A/B와 무관하게 점령 순서대로, 비밀번호 두 자리씩
    game.emitTo(s, {
      k: 'text',
      id: order === 1 ? 'NOTE_FIRST' : 'NOTE_SECOND',
      code: game.codes[order === 1 ? 0 : 1],
    });
  }
  game.emitTo(game.monster, { k: 'text', id: 'ALERT_CAPTURE_DONE', point: p.id });
  if (game.points.every((q) => q.done)) {
    for (const e of game.exits) if (e.state === 'inactive') e.state = 'active';
    for (const pl of game.players.values()) game.emitTo(pl, { k: 'text', id: 'ALERT_EXITS_ON' });
  }
}

// 승패 (GAME_DESIGN 9장 + DECISIONS "승패")
//   생존자 2명 이상 탈출 → 생존자 승리 (남은 자유 생존자에게 최후의 30초, 타이머 정지)
//   생존자 2명 이상 사망 → 괴물 승리
//   3명 동시 수감, 또는 넓혀서 "탈출 2명 미만인데 자유 생존자 0명" → 괴물 승리
//   12분 경과 → 탈출 못 한 생존자 사망 처리 후 판정 (= 괴물 승리)
//   괴물이 재접속 유예 안에 돌아오지 않음 → 무효
// 판정 순서: 생존자 승리를 먼저, 그다음 괴물 승리
import type { MatchResult, PlayerRecord, ResultGrade, TextId } from '@decoy/shared';
import type { Game } from '../game';
import type { MatchOutcomeReason } from '../state';

export function counts(game: Game): { free: number; imprisoned: number; dead: number; escaped: number } {
  const c = { free: 0, imprisoned: 0, dead: 0, escaped: 0 };
  for (const s of game.survivors) c[s.status] += 1;
  return c;
}

export function finish(
  game: Game,
  winner: 'survivors' | 'monster' | 'void',
  reason: MatchOutcomeReason,
): void {
  if (game.end) return;
  game.end = { winner, reason, tick: game.tick };
}

/** 이벤트로 들어오는 승패 (접속 끊김 유예 만료). M9에서 연결 처리와 잇는다 */
export function applyDropExpired(game: Game, playerId: string): void {
  if (game.end) return;
  const p = game.players.get(playerId);
  if (!p) return;
  if (p.kind === 'monster') {
    finish(game, 'void', 'monsterLeft');
    return;
  }
  if (p.status === 'free' || p.status === 'imprisoned') p.status = 'dead';
  evaluate(game);
}

/** 지금 상태로 승패를 판정한다 (틱 끝, 상태가 바뀐 뒤) */
export function evaluate(game: Game): void {
  if (game.end) return;
  const c = counts(game);
  const need = game.balance.exit.requiredSurvivors;
  // 1) 생존자 승리 확정
  if (c.escaped >= need) {
    if (c.free === 0) {
      finish(game, 'survivors', 'escaped');
      return;
    }
    if (game.grace === null) {
      // 최후의 30초 시작 (12분 타이머는 멈춘다)
      game.grace = game.balance.match.lastSurvivorGrace;
      for (const s of game.survivors) {
        if (s.status === 'free') game.emitTo(s, { k: 'text', id: 'ALERT_LAST_30' });
      }
    }
    return;
  }
  // 2) 괴물 승리
  if (c.dead >= 2) {
    finish(game, 'monster', 'deaths');
    return;
  }
  if (c.free === 0) {
    finish(game, 'monster', c.imprisoned === game.survivors.length ? 'allImprisoned' : 'noFreeSurvivors');
  }
}

/** 틱마다 (모든 규칙 처리 뒤): 승패 판정 → 최후의 30초 · 12분 제한 */
export function matchTick(game: Game): void {
  if (game.end) return;
  evaluate(game);
  if (game.end) return;
  if (game.grace !== null) {
    game.grace -= game.dt;
    if (game.grace <= 1e-9) {
      game.grace = 0;
      finish(game, 'survivors', 'escaped');
    }
    return;
  }
  if (game.timeLeft <= 1e-9) {
    // 시간 초과: 탈출하지 못한 생존자는 사망 처리
    for (const s of game.survivors) if (s.status === 'free' || s.status === 'imprisoned') s.status = 'dead';
    const c = counts(game);
    if (c.escaped >= game.balance.exit.requiredSurvivors) finish(game, 'survivors', 'escaped');
    else finish(game, 'monster', 'timeout');
  }
}

export function gradeOf(escaped: number): ResultGrade {
  if (escaped >= 3) return 'full';
  if (escaped >= 2) return 'success';
  return 'fail';
}

export function endingOf(game: Game): TextId {
  const end = game.end;
  const escaped = counts(game).escaped;
  if (!end || end.winner === 'void') return 'END_VOID';
  if (end.winner === 'survivors') return escaped >= 3 ? 'END_ALL' : 'END_TWO';
  return end.reason === 'timeout' && escaped === 0 ? 'END_TIMEOUT' : 'END_MONSTER';
}

export function buildResult(game: Game): MatchResult {
  const end = game.end;
  const escaped = counts(game).escaped;
  const players: PlayerRecord[] = [...game.players.values()].map((p) => ({
    id: p.id,
    name: p.name,
    role: p.role,
    hitsTaken: p.stats.hitsTaken,
    hitsLanded: p.stats.hitsLanded,
    rescues: p.stats.rescues,
    captureSeconds: Math.round(p.stats.captureSeconds * 10) / 10,
    status: p.kind === 'survivor' ? p.status : null,
  }));
  return {
    winner: end?.winner ?? 'void',
    grade: end && end.winner !== 'void' ? gradeOf(escaped) : null,
    ending: endingOf(game),
    escaped,
    durationSec: Math.round(game.time),
    players,
  };
}

// 테스트 전용 정답 상태 기록 (--test-hooks / --truth-log). 정보 차단 E2E가 이것과 대조한다.
import { appendFileSync, writeFileSync } from 'node:fs';
import type { Room } from './room';

export interface TruthPlayer {
  id: string;
  role: string;
  x: number;
  y: number;
  face: number;
  status: string;
}

export interface TruthFrame {
  room: string;
  tick: number;
  players: TruthPlayer[];
  monster: { aim: number; blend: number; mode: string; windup: number } | null;
  /** 정보 차단 예외 구간 (능력 노출 · 탐지 · 포효) */
  reveal: { id: string; left: number }[];
  tracked: number;
  roarReveal: number;
}

export function truthOf(room: Room): TruthFrame | null {
  const game = room.game;
  if (!game) return null;
  const m = game.monster;
  return {
    room: room.code,
    tick: game.tick,
    players: [...game.players.values()].map((p) => ({
      id: p.id,
      role: p.role,
      x: p.move.x,
      y: p.move.y,
      face: p.move.face,
      status: p.kind === 'survivor' ? p.status : 'monster',
    })),
    monster: { aim: m.move.face, blend: m.blend, mode: m.mode, windup: m.windupLeft },
    reveal: game.survivors.map((s) => ({ id: s.id, left: s.revealLeft })),
    tracked: m.trackedLeft,
    roarReveal: m.roarRevealLeft,
  };
}

export class TruthLog {
  constructor(private readonly path: string) {
    writeFileSync(path, '');
  }

  record(room: Room): void {
    const frame = truthOf(room);
    if (frame) appendFileSync(this.path, `${JSON.stringify(frame)}\n`);
  }
}

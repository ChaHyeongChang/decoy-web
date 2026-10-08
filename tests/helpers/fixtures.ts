// 단위 · 봇 테스트 공용: balance 로드와 기본 판 구성
import { readFileSync } from 'node:fs';
import { validateBalance, type Balance, type InputFrame, type Role } from '@decoy/shared';
import { Game, type GamePlayerSetup } from '../../server/src/game';

export function loadTestBalance(): Balance {
  return validateBalance(JSON.parse(readFileSync('config/balance.json', 'utf8')));
}

export const ROLES4: Role[] = ['monster', 'runner', 'guard', 'scout'];

export function setup4(): GamePlayerSetup[] {
  return ROLES4.map((role, i) => ({ id: `p${i + 1}`, name: `P${i + 1}`, role, bot: false }));
}

export function newGame(seed = 1, balance = loadTestBalance()): Game {
  return new Game(setup4(), balance, { seed });
}

export function frame(seq: number, mx = 0, my = 0, extra: Partial<InputFrame> = {}): InputFrame {
  return { seq, mx, my, aim: Number.NaN, held: 0, pressed: 0, ...extra };
}

/** 플레이어에게 입력 한 개를 넣고 한 틱 진행 */
export class Driver {
  private seqs = new Map<string, number>();
  constructor(readonly game: Game) {}

  input(id: string, mx: number, my: number, extra: Partial<InputFrame> = {}): void {
    const seq = (this.seqs.get(id) ?? 0) + 1;
    this.seqs.set(id, seq);
    this.game.queueInput(id, [frame(seq, mx, my, extra)]);
  }

  /** 지정한 입력을 유지하면서 n틱 진행. 입력이 없는 플레이어는 빈 입력 */
  run(ticks: number, inputs: Record<string, [number, number, Partial<InputFrame>?]> = {}): void {
    for (let t = 0; t < ticks; t += 1) {
      for (const p of this.game.players.values()) {
        const i = inputs[p.id];
        this.input(p.id, i?.[0] ?? 0, i?.[1] ?? 0, i?.[2] ?? {});
      }
      this.game.step();
    }
  }

  seconds(s: number): number {
    return Math.round(s / this.game.dt);
  }
}

/** 테스트용 배치: 위치와 방향을 바로 정한다 */
export function place(game: Game, id: string, x: number, y: number, face?: number): void {
  const p = game.players.get(id);
  if (!p) throw new Error(`플레이어 없음 ${id}`);
  p.move.x = x;
  p.move.y = y;
  if (face !== undefined) p.move.face = face;
}

/** 괴물 시작 대기를 없앤 판 */
export function readyGame(seed = 1): Game {
  const game = newGame(seed);
  game.monster.move.frozen = 0;
  return game;
}

// 소켓 없이 한 판을 빠르게 돌리는 시뮬레이션 (봇 시나리오 테스트용).
// 실제 방과 같은 흐름: 스냅샷 틱(20Hz)마다 받는 사람별 스냅샷을 만들고, 봇은 매 틱(30Hz) 마지막 스냅샷을 보고 입력한다.
import type { Balance, MatchInfo, Role, Snapshot } from '../index';
import type { BotBrain } from './botBrains';
import { Game, type GamePlayerSetup } from './game';
import { AliasBook, buildSnapshot, computeVisibility } from './interest';

export function isSnapshotTick(balance: Balance, tick: number): boolean {
  const n = balance.network;
  return (
    Math.floor((tick * n.snapshotHz) / n.serverTickHz) !==
    Math.floor(((tick - 1) * n.snapshotHz) / n.serverTickHz)
  );
}

export class SimMatch {
  readonly game: Game;
  private readonly aliases = new AliasBook();
  private readonly seqs = new Map<string, number>();
  readonly lastSnap = new Map<string, Snapshot>();
  /** 받는 사람별로 받은 모든 스냅샷 (정보 차단 검사용) */
  readonly received = new Map<string, Snapshot[]>();
  readonly infos = new Map<string, MatchInfo>();

  constructor(
    setup: GamePlayerSetup[],
    readonly balance: Balance,
    readonly brains: Map<string, BotBrain>,
    seed = 1,
    private readonly keepHistory = false,
  ) {
    this.game = new Game(setup, balance, { seed });
    for (const p of setup) {
      this.infos.set(p.id, {
        you: p.id,
        role: p.role,
        roster:
          p.role === 'monster'
            ? [{ id: p.id, name: p.name, role: p.role, bot: true }]
            : setup.map((q) => ({ ...q, bot: true })),
        tickHz: balance.network.serverTickHz,
        firstMatch: false,
      });
    }
    this.snapshot();
  }

  static roles(roles: Role[] = ['monster', 'runner', 'guard', 'scout']): GamePlayerSetup[] {
    return roles.map((role, i) => ({ id: `p${i + 1}`, name: `봇${i + 1}`, role, bot: true }));
  }

  private snapshot(): void {
    const facts = computeVisibility(this.game);
    this.aliases.update(facts.monsterSees);
    for (const id of this.game.players.keys()) {
      const snap = buildSnapshot(
        this.game,
        id,
        this.game.tick * (1000 / this.balance.network.serverTickHz),
        facts,
        this.aliases,
      );
      if (!snap) continue;
      this.lastSnap.set(id, snap);
      if (this.keepHistory) {
        const list = this.received.get(id) ?? [];
        list.push(snap);
        this.received.set(id, list);
      }
    }
  }

  step(): void {
    for (const [id, brain] of this.brains) {
      const snap = this.lastSnap.get(id);
      const info = this.infos.get(id);
      if (!snap || !info) continue;
      const seq = (this.seqs.get(id) ?? 0) + 1;
      this.seqs.set(id, seq);
      this.game.queueInput(id, [brain.decide(snap, info, this.balance, seq)]);
    }
    this.game.step();
    if (isSnapshotTick(this.balance, this.game.tick) || this.game.end) this.snapshot();
  }

  /** 조건이 맞거나 판이 끝나거나 제한 시간(시뮬레이션 초)이 지날 때까지 */
  runUntil(cond: (g: Game) => boolean, maxSeconds: number): boolean {
    const ticks = Math.ceil(maxSeconds / this.game.dt);
    for (let i = 0; i < ticks; i += 1) {
      if (cond(this.game)) return true;
      if (this.game.end) return cond(this.game);
      this.step();
    }
    return cond(this.game);
  }
}

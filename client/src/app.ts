// 클라이언트 상태와 흐름: 연결 → 로비 → 판 → 결과
import type Phaser from 'phaser';
import {
  validateBalance,
  type Balance,
  type LobbyState,
  type MatchInfo,
  type MatchResult,
  type MonsterView,
  type MoveEnv,
  type Role,
  type ServerMessage,
  type Snapshot,
  type SurvivorView,
} from '@decoy/shared';
import { NetClient, defaultWsUrl } from './net';
import { getAltTokens, getSavedName, getSeatToken, saveName, saveSeatToken } from './session';
import { Interpolator, Predictor, lerpAngle, lerpNum } from './sync';
import { LobbyUI } from './ui/lobby';

export type DebugMode = 'off' | 'hook' | 'overlay';

export interface AppParams {
  room: string | null;
  bots: boolean;
  lag: number;
  debug: DebugMode;
  renderer: 'auto' | 'canvas' | 'webgl';
  name: string | null;
}

export function readParams(search: string): AppParams {
  const p = new URLSearchParams(search);
  const debugRaw = p.get('debug');
  const renderer = p.get('renderer');
  const lag = Number(p.get('lag') ?? 0);
  return {
    room: p.get('room')?.toUpperCase() ?? null,
    bots: p.get('bots') === '1' || p.get('bots') === 'true',
    lag: Number.isFinite(lag) && lag > 0 ? lag : 0,
    debug: debugRaw === null ? 'off' : debugRaw === 'hook' ? 'hook' : 'overlay',
    renderer: renderer === 'canvas' || renderer === 'webgl' ? renderer : 'auto',
    name: p.get('name'),
  };
}

function lerpSurvivor(a: SurvivorView, b: SurvivorView, k: number): SurvivorView {
  return { ...b, x: lerpNum(a.x, b.x, k), y: lerpNum(a.y, b.y, k), face: lerpAngle(a.face, b.face, k) };
}

function lerpMonster(a: MonsterView, b: MonsterView, k: number): MonsterView {
  return {
    ...b,
    x: lerpNum(a.x, b.x, k),
    y: lerpNum(a.y, b.y, k),
    aim: lerpAngle(a.aim, b.aim, k),
    blend: lerpNum(a.blend, b.blend, k),
  };
}

export type AppEvent =
  | { kind: 'match'; info: MatchInfo }
  | { kind: 'snapshot'; snap: Snapshot }
  | { kind: 'result'; result: MatchResult }
  | { kind: 'lobby'; lobby: LobbyState };

export class App {
  readonly net: NetClient;
  readonly lobbyUi: LobbyUI;
  balance: Balance | null = null;
  balanceHash = '';
  you: string | null = null;
  roomCode: string | null;
  lobby: LobbyState | null = null;
  match: MatchInfo | null = null;
  result: MatchResult | null = null;
  lastSnap: Snapshot | null = null;
  snapCount = 0;
  predictor: Predictor | null = null;
  readonly survivorsInterp = new Interpolator<SurvivorView>(lerpSurvivor);
  readonly monsterInterp = new Interpolator<MonsterView>(lerpMonster);
  game: Phaser.Game | null = null;
  private readonly listeners = new Set<(e: AppEvent) => void>();
  private reconnectTimer: number | null = null;

  constructor(
    readonly params: AppParams,
    uiRoot: HTMLElement,
  ) {
    this.roomCode = params.room;
    this.net = new NetClient(defaultWsUrl(), { lag: params.lag, jitterMs: 20 });
    this.lobbyUi = new LobbyUI(
      uiRoot,
      {
        create: (name) => {
          saveName(name);
          this.net.send({
            t: 'join',
            room: null,
            create: true,
            name,
            token: null,
            altTokens: [],
            bots: params.bots,
          });
        },
        join: (code, name) => {
          saveName(name);
          this.roomCode = code.toUpperCase();
          this.sendJoin(name);
        },
        pickRole: (role: Role | null) => this.net.send({ t: 'role', role }),
        setReady: (ready) => this.net.send({ t: 'ready', ready }),
        setName: (name) => this.net.send({ t: 'name', name }),
        start: () => this.net.send({ t: 'start' }),
      },
      params.name ?? getSavedName(),
    );
    this.net.on((msg) => this.onMessage(msg));
    this.net.onOpen = () => {
      if (this.roomCode) this.sendJoin(params.name ?? getSavedName());
      else this.lobbyUi.renderHome();
    };
    this.net.onClose = () => this.scheduleReconnect();
  }

  start(): void {
    this.net.connect();
  }

  subscribe(listener: (e: AppEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(e: AppEvent): void {
    for (const l of this.listeners) l(e);
  }

  private sendJoin(name: string): void {
    const room = this.roomCode;
    if (!room) return;
    this.net.send({
      t: 'join',
      room,
      create: false,
      name,
      token: getSeatToken(room),
      altTokens: getAltTokens(room),
      bots: this.params.bots,
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) return;
    showToast('연결이 끊겼습니다. 다시 연결하는 중…');
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.net.connect();
    }, 1000);
  }

  get dt(): number {
    return 1 / (this.balance?.network.serverTickHz ?? 30);
  }

  /** 예측에 쓸 이동 환경 (마지막 스냅샷의 위치들을 정지한 장애물로) */
  moveEnv(): MoveEnv | null {
    const snap = this.lastSnap;
    const balance = this.balance;
    if (!snap || !balance) return null;
    const role = snap.you.role;
    const kind = role === 'monster' ? 'monster' : 'survivor';
    const obstacles: { x: number; y: number; r: number }[] = [];
    const imprisoned = snap.you.surv?.status === 'imprisoned';
    if (kind === 'survivor' && !imprisoned && snap.monster) {
      obstacles.push({ x: snap.monster.x, y: snap.monster.y, r: balance.monster.radius });
    }
    if (kind === 'monster') {
      for (const s of snap.survivors) {
        if (s.status === 'free') obstacles.push({ x: s.x, y: s.y, r: balance.survivor.radius });
      }
    }
    return {
      kind,
      role: role === 'monster' ? null : role,
      mover: {
        kind,
        imprisoned,
        openExits: {
          N: snap.world.exits.some((e) => e.id === 'N' && e.state === 'open'),
          S: snap.world.exits.some((e) => e.id === 'S' && e.state === 'open'),
        },
      },
      campActive: snap.world.imprisoned > 0,
      obstacles,
    };
  }

  private onMessage(msg: ServerMessage): void {
    switch (msg.t) {
      case 'welcome': {
        this.balance = validateBalance(msg.balance);
        this.balanceHash = msg.balanceHash;
        this.you = msg.you;
        this.roomCode = msg.room;
        this.lobbyUi.setYou(msg.you);
        saveSeatToken(msg.room, msg.token);
        const url = new URL(window.location.href);
        url.searchParams.set('room', msg.room);
        window.history.replaceState(null, '', url.toString());
        return;
      }
      case 'lobby':
        this.lobby = msg.lobby;
        if (msg.lobby.phase === 'lobby') {
          this.match = null;
          this.result = null;
          this.lobbyUi.renderRoom(msg.lobby);
        }
        this.emit({ kind: 'lobby', lobby: msg.lobby });
        return;
      case 'match':
        if (!this.balance) return;
        this.match = msg.info;
        this.result = null;
        this.lastSnap = null;
        this.snapCount = 0;
        this.predictor = new Predictor(this.balance, this.dt);
        this.survivorsInterp.clear();
        this.monsterInterp.clear();
        this.lobbyUi.hide();
        this.emit({ kind: 'match', info: msg.info });
        return;
      case 'snap': {
        const snap = msg.s;
        this.lastSnap = snap;
        this.snapCount += 1;
        const env = this.moveEnv();
        if (this.predictor && env) this.predictor.reconcile(snap.you.move, snap.ack, env);
        this.survivorsInterp.push(
          snap.st,
          snap.survivors.map((s) => ({ id: s.id, v: s })),
        );
        this.monsterInterp.push(snap.st, snap.monster ? [{ id: 'monster', v: snap.monster }] : []);
        this.emit({ kind: 'snapshot', snap });
        return;
      }
      case 'result':
        this.result = msg.result;
        this.emit({ kind: 'result', result: msg.result });
        return;
      case 'error':
        if (msg.code === 'room-not-found' || msg.code === 'in-progress' || msg.code === 'room-full') {
          this.roomCode = null;
          this.lobbyUi.renderHome();
        }
        this.lobbyUi.showError(msg.message);
        return;
      default:
        return;
    }
  }
}

export function showToast(text: string, ms = 2500): void {
  const node = document.createElement('div');
  node.className = 'toast';
  node.textContent = text;
  document.body.appendChild(node);
  window.setTimeout(() => node.remove(), ms);
}

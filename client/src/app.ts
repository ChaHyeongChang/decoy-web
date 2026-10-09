// 클라이언트 상태와 흐름: 연결 → 로비 → 판 → 결과. 앱 생명주기(숨김 · 재접속 · 마지막 방 · 뒤로 가기 · 화면 꺼짐 방지)는 M12
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
import { sfx } from './audio';
import { UI_TEXT } from './data/storyText';
import { device } from './device';
import type { QualityTier } from './gfx/presets';
import { parseQuality } from './gfx/quality';
import { haptics } from './haptics';
import {
  BackGuard,
  LinkKeeper,
  ScreenAwake,
  browserClock,
  browserWakeLock,
  listenLifecycle,
  rejoinRetryDelay,
  type LastRoom,
  type LifecycleDebug,
} from './lifecycle';
import { NetClient, defaultWsUrl } from './net';
import { parseScale } from './render/resolution';
import {
  clearLastRoom,
  getAltTokens,
  getSavedName,
  getSeatToken,
  loadLastRoom,
  saveLastRoom,
  saveName,
  saveSeatToken,
} from './session';
import { Interpolator, Predictor, SnapshotClock, lerpAngle, lerpNum } from './sync';
import { LeaveDialog, ReplacedNotice } from './ui/lifecycleUi';
import { LobbyUI } from './ui/lobby';
import { ResultUI } from './ui/result';
import { WakeNoticeUI } from './ui/wakeNotice';
import { WakeNoticeState } from './wakeNotice';

export type DebugMode = 'off' | 'hook' | 'overlay';

export interface AppParams {
  room: string | null;
  bots: boolean;
  lag: number;
  debug: DebugMode;
  renderer: 'auto' | 'canvas' | 'webgl';
  /**
   * ?scale: 렌더 해상도 배율 (0.25~1). 표시 크기 × 기기 픽셀 배율로 정한 해상도에 곱한다(render/resolution.ts).
   * 값이 없거나 비었거나 0 · 음수 · 숫자가 아니면 null(지정 없음). 논리 좌표는 그대로 1920×1080
   */
  scaleOverride: number | null;
  /** ?quality=high|medium|low: 그래픽 품질 강제 (저장된 선택 · 자동보다 우선). 없으면 null */
  quality: QualityTier | null;
  name: string | null;
  /** ?touch=1|0: 터치 화면을 강제로 켜거나 끈다 (M11, device.ts detectTouchMode). 없으면 null(기기로 판단) */
  touch: string | null;
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
    scaleOverride: parseScale(p.get('scale')),
    quality: parseQuality(p.get('quality')),
    name: p.get('name'),
    touch: p.get('touch'),
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

declare global {
  interface Window {
    __DECOY_LIFE__?: LifecycleDebug;
  }
}

export class App {
  readonly net: NetClient;
  readonly lobbyUi: LobbyUI;
  readonly resultUi: ResultUI;
  balance: Balance | null = null;
  balanceHash = '';
  you: string | null = null;
  roomCode: string | null;
  lobby: LobbyState | null = null;
  match: MatchInfo | null = null;
  result: MatchResult | null = null;
  lastSnap: Snapshot | null = null;
  snapCount = 0;
  /** 마지막 스냅샷을 받은 시각 (performance.now) */
  lastSnapAt = 0;
  predictor: Predictor | null = null;
  readonly survivorsInterp = new Interpolator<SurvivorView>(lerpSurvivor);
  readonly monsterInterp = new Interpolator<MonsterView>(lerpMonster);
  readonly snapClock = new SnapshotClock();
  game: Phaser.Game | null = null;
  private readonly listeners = new Set<(e: AppEvent) => void>();
  /** 다른 탭이 이 자리를 넘겨받았다: "여기서 계속하기"를 누를 때까지 다시 연결하지 않는다 */
  private replaced = false;
  /** '서버 깨우는 중' 안내 (무료 호스팅의 잠든 서버 · 재시작) */
  readonly wake = new WakeNoticeState();
  private readonly wakeUi: WakeNoticeUI;
  private wakeTimer: number | null = null;
  /** 지금 연결이 열린 적이 있다 (끊김 알림을 끊길 때 한 번만 띄운다) */
  private wasOpen = false;
  /** 마지막 입장 요청이 링크 · 재연결로 자동으로 보낸 것이다 (직접 입력한 코드가 아니다) */
  private joinFromLink = false;
  // ── 앱 생명주기 (M12) ──
  /** 연결 유지: 재연결 간격 · 숨김 · 오프라인 · 수신 감시 */
  private readonly keeper: LinkKeeper;
  /** 판 중 화면 꺼짐 방지 */
  private readonly awake = new ScreenAwake(browserWakeLock, () => document.visibilityState === 'visible');
  /** 터치 모드 또는 설치 앱: 마지막 방 복귀 · 뒤로 가기 확인을 쓴다 (PC 브라우저는 지금 동작 그대로) */
  readonly lifeApp: boolean;
  private readonly backGuard: BackGuard | null;
  private readonly leaveDialog: LeaveDialog;
  private readonly replacedNotice: ReplacedNotice;
  /** 마지막 방으로 돌아가는 중 (주소에 ?room= 없이 30초 안에 다시 연 앱) */
  private returning: LastRoom | null = null;
  private rejoinTimer: number | null = null;
  /** 다음 끊김은 일부러 낸 것이다 (나가기): 끊김 알림을 띄우지 않는다 */
  private quietClose = false;
  /** 첫 화면 방 코드 칸에 미리 넣을 것 (판에서 나간 방: 30초 안에 입장을 누르면 같은 자리) */
  private homePrefill = '';

  constructor(
    readonly params: AppParams,
    uiRoot: HTMLElement,
  ) {
    this.lifeApp = device.touch || !device.inBrowser;
    this.roomCode = params.room;
    if (this.roomCode === null && this.lifeApp) {
      this.returning = loadLastRoom();
      this.roomCode = this.returning?.room ?? null;
    }
    this.net = new NetClient(defaultWsUrl(), { lag: params.lag, jitterMs: 20 });
    this.keeper = new LinkKeeper(
      {
        connect: () => {
          this.wake.connecting(performance.now());
          this.net.connect();
        },
        drop: () => this.net.drop(),
        resync: () => this.net.resync(),
      },
      {
        visible: () => document.visibilityState === 'visible',
        online: () => navigator.onLine !== false,
      },
      browserClock,
    );
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
          this.joinFromLink = false;
          this.returning = null;
          this.sendJoin(name);
        },
        pickRole: (role: Role | null) => this.net.send({ t: 'role', role }),
        setReady: (ready) => this.net.send({ t: 'ready', ready }),
        setName: (name) => this.net.send({ t: 'name', name }),
        start: () => this.net.send({ t: 'start' }),
      },
      params.name ?? getSavedName(),
    );
    this.resultUi = new ResultUI(uiRoot, () => this.net.send({ t: 'rematch' }));
    this.wakeUi = new WakeNoticeUI(uiRoot);
    this.leaveDialog = new LeaveDialog(uiRoot, {
      stay: () => {
        // "계속"을 누른 이 핸들러(사용자 활성화)에서 뒤로 가기 항목을 다시 넣는다
        this.leaveDialog.close();
        this.backGuard?.gesture();
      },
      leave: () => this.leaveRoom(),
    });
    this.replacedNotice = new ReplacedNotice(uiRoot, () => this.continueHere());
    this.backGuard = this.lifeApp ? new BackGuard(window.history, () => this.leaveDialog.open()) : null;
    this.net.on((msg) => this.onMessage(msg));
    this.net.onHeard = () => this.keeper.heard();
    this.net.onResynced = () => haptics.clockSynced();
    this.net.onOpen = () => {
      this.wasOpen = true;
      this.keeper.opened();
      this.wake.opened();
      this.renderWake();
      if (this.roomCode) {
        this.joinFromLink = true;
        this.sendJoin(params.name ?? getSavedName());
      } else if (!this.lobbyUi.atHome) this.lobbyUi.renderHome(this.homePrefill);
    };
    this.net.onClose = () => {
      const wasOpen = this.wasOpen;
      this.wasOpen = false;
      this.clearRejoin();
      if (this.replaced) {
        this.keeper.stop();
        this.wake.stop();
        this.renderWake();
        return;
      }
      if (wasOpen && !this.quietClose) showToast(UI_TEXT.disconnected);
      this.quietClose = false;
      this.wake.closed(performance.now());
      this.renderWake();
      this.keeper.closed();
    };
  }

  start(): void {
    listenLifecycle({
      visibility: (visible) => this.onVisibility(visible),
      online: (on) => {
        this.wake.setOffline(!on);
        this.renderWake();
        if (on) this.keeper.kick();
        else this.keeper.offline();
      },
      pageshow: () => this.keeper.kick(),
      pagehide: () => this.touchLastRoom(),
      gesture: () => {
        if (!this.leaveDialog.isOpen) this.backGuard?.gesture();
      },
      popstate: () => void this.backGuard?.popped(),
    });
    if (this.params.debug !== 'off' || import.meta.env.DEV) this.installLifecycleDebug();
    this.wake.setOffline(navigator.onLine === false);
    this.wake.connecting(performance.now());
    this.keeper.start();
    // 기다린 시간(초)을 세려고 주기적으로 다시 그린다. 바뀐 게 없으면 DOM을 건드리지 않는다
    this.wakeTimer ??= window.setInterval(() => this.renderWake(), 250);
  }

  private renderWake(): void {
    this.wakeUi.render(this.wake.view(performance.now()));
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

  // ───────────── 앱 생명주기 (M12) ─────────────

  /** 화면이 숨겨짐 · 보임: 감시 멈춤 · 재개(즉시 ping + 시계 다시 맞추기), 화면 꺼짐 방지 다시 요청, 오디오 다시 켜기 */
  private onVisibility(visible: boolean): void {
    this.keeper.visibility(visible);
    if (visible) {
      this.awake.shown();
      sfx.resume();
    } else {
      haptics.holdClock();
      this.touchLastRoom();
    }
  }

  /** 판 중인가 (화면 꺼짐 방지 · 뒤로 가기 확인) */
  private setPlaying(on: boolean): void {
    this.awake.set(on);
    if (on) this.backGuard?.arm();
    else {
      this.leaveDialog.close();
      this.backGuard?.disarm();
    }
  }

  /** 마지막 방 시각을 지금으로 (터치 · 설치 앱만, 방에 들어가 있을 때) */
  private touchLastRoom(): void {
    if (this.lifeApp && this.roomCode && this.lobby?.room === this.roomCode) saveLastRoom(this.roomCode);
  }

  private clearRejoin(): void {
    if (this.rejoinTimer !== null) window.clearTimeout(this.rejoinTimer);
    this.rejoinTimer = null;
  }

  /**
   * 마지막 방 복귀가 거절됐다 (옛 소켓이 아직 붙어 있어 in-progress · room-full): 30초 창 안이면 2초 뒤 다시.
   * 다시 시도하면 true, 창이 지났으면 그만두고 false
   */
  private retryReturn(): boolean {
    const last = this.returning;
    if (!last) return false;
    const ms = rejoinRetryDelay(last, Date.now());
    if (ms === null) {
      this.returning = null;
      clearLastRoom();
      return false;
    }
    this.wake.rejoining(performance.now());
    this.renderWake();
    this.clearRejoin();
    this.rejoinTimer = window.setTimeout(() => {
      this.rejoinTimer = null;
      this.sendJoin(this.params.name ?? getSavedName());
    }, ms);
    return true;
  }

  /** 판 중 뒤로 가기 확인에서 "나가기": 방에서 나가 첫 화면으로 (서버는 끊김으로 보고 30초 유예를 센다) */
  private leaveRoom(): void {
    const code = this.roomCode ?? '';
    this.setPlaying(false);
    clearLastRoom();
    this.clearRejoin();
    this.roomCode = null;
    this.returning = null;
    this.you = null;
    this.lobby = null;
    this.match = null;
    this.result = null;
    this.lastSnap = null;
    this.homePrefill = code;
    const url = new URL(window.location.href);
    url.searchParams.delete('room');
    window.history.replaceState(window.history.state, '', url.toString());
    this.resultUi.hide();
    this.lobbyUi.renderHome(code);
    // 판 장면을 멈추게 한다 (main.ts는 로비 단계 이벤트로 판 장면을 끝낸다)
    this.emit({
      kind: 'lobby',
      lobby: { room: code, phase: 'lobby', players: [], bots: false, canStart: false, waitingFor: null },
    });
    // 이 소켓은 그 자리에 묶여 있다: 버리고 새로 연결해 첫 화면에서 쓴다
    this.quietClose = true;
    this.keeper.restart();
  }

  /** 다른 탭 안내의 "여기서 계속하기": 이 기기로 다시 들어온다 (서버는 저쪽에 'replaced'를 보낸다) */
  private continueHere(): void {
    this.replaced = false;
    this.replacedNotice.hide();
    this.wake.resume();
    this.keeper.resume();
  }

  private installLifecycleDebug(): void {
    const keeper = this.keeper;
    const guard = this.backGuard;
    const net = this.net;
    const lifeApp = this.lifeApp;
    window.__DECOY_LIFE__ = {
      get link() {
        return keeper.status;
      },
      get connects() {
        return keeper.connects;
      },
      get watchdogDrops() {
        return keeper.watchdogDrops;
      },
      get guarding() {
        return guard?.guarding ?? false;
      },
      lifeApp,
      get clockFresh() {
        return net.clockFresh;
      },
      hapticHit: (ageMs) => haptics.hit(ageMs),
      hapticSpotted: (on, ageMs) => haptics.spotted(on, ageMs),
      hapticLog: () => haptics.log.map((e) => e.pattern.slice()),
    };
  }

  /** 다른 캐릭터를 그릴 시각 (스냅샷 시계 − 100ms) */
  renderTime(): number {
    return this.snapClock.now(performance.now()) - (this.balance?.network.interpolationDelayMs ?? 100);
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
        this.returning = null;
        this.homePrefill = '';
        this.clearRejoin();
        // 마지막 방 복귀로 기다리던 안내를 내린다
        this.wake.opened();
        this.renderWake();
        this.lobbyUi.setYou(msg.you);
        saveSeatToken(msg.room, msg.token);
        if (this.lifeApp) saveLastRoom(msg.room);
        const url = new URL(window.location.href);
        url.searchParams.set('room', msg.room);
        window.history.replaceState(window.history.state, '', url.toString());
        return;
      }
      case 'lobby':
        this.lobby = msg.lobby;
        if (msg.lobby.phase === 'lobby') {
          this.match = null;
          this.result = null;
          this.setPlaying(false);
          this.resultUi.hide();
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
        this.snapClock.reset();
        haptics.reset();
        this.lobbyUi.matchStarting();
        this.lobbyUi.hide();
        this.resultUi.hide();
        this.setPlaying(true);
        this.emit({ kind: 'match', info: msg.info });
        return;
      case 'snap': {
        const snap = msg.s;
        this.lastSnap = snap;
        this.lastSnapAt = performance.now();
        this.snapCount += 1;
        this.snapClock.add(snap.st, performance.now());
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
        this.setPlaying(false);
        this.resultUi.show(msg.result, this.match?.role ?? null);
        this.emit({ kind: 'result', result: msg.result });
        return;
      case 'error':
        if (msg.code === 'replaced') {
          // 다른 탭(기기)이 이 자리를 가져갔다: 다시 연결하지 않고 "여기서 계속하기"를 기다린다
          this.replaced = true;
          this.keeper.stop();
          this.setPlaying(false);
          this.replacedNotice.show(msg.message);
          return;
        }
        // 마지막 방 복귀: 옛 소켓이 아직 그 자리에 붙어 있으면 30초 창 안에서 2초마다 다시
        if ((msg.code === 'in-progress' || msg.code === 'room-full') && this.retryReturn()) return;
        if (this.returning && msg.code === 'room-not-found') {
          this.returning = null;
          clearLastRoom();
        }
        if (msg.code === 'room-not-found' || msg.code === 'in-progress' || msg.code === 'room-full') {
          this.roomCode = null;
          this.wake.opened();
          this.renderWake();
          this.lobbyUi.renderHome();
        }
        // 링크 · 재연결로 들어가려던 방이 없으면 대개 서버가 잠들었다 깨어났거나 다시 시작한 것이다 (방은 메모리에만 있다)
        if (msg.code === 'room-not-found' && this.joinFromLink) {
          this.lobbyUi.showError(`${msg.message}. ${UI_TEXT.roomGoneHint}`);
          return;
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

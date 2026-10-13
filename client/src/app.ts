// 클라이언트 상태와 흐름: 연결 → 로비 → 판 → 결과. 앱 생명주기(숨김 · 재접속 · 마지막 방 · 뒤로 가기 · 화면 꺼짐 방지)는 M12
import type Phaser from 'phaser';
import {
  isKeptNote,
  validateBalance,
  type Balance,
  type GameEvent,
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
import { buildMismatch } from './buildInfo';
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
  leaveKindFor,
  listenLifecycle,
  practiceEntry,
  rejoinRetryDelay,
  returnTarget,
  staleAfterLeave,
  type LastRoom,
  type LifecycleDebug,
} from './lifecycle';
import { LocalTransport } from './localServer';
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
import { serverStatus } from './serverStatus';
import { Interpolator, Predictor, SnapshotClock, lerpAngle, lerpNum } from './sync';
import type { Transport } from './transport';
import { LeaveDialog, ReplacedNotice } from './ui/lifecycleUi';
import { LobbyUI } from './ui/lobby';
import { ResultUI } from './ui/result';
import { WakeNoticeUI } from './ui/wakeNotice';
import { WakeNoticeState, wakeOffersHome } from './wakeNotice';

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
  /** ?practice=1: 첫 화면에서 봇과 연습 역할 고르기를 바로 연다 (M13b, 깨우기 화면의 "봇과 연습") */
  practice: boolean;
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
    practice: p.get('practice') === '1',
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
  /**
   * 이번 'match' 뒤에 받은 거점 메모(비밀번호). 판 장면은 'match' 뒤 판 시작 대기(터치: 크기 안정 · 세로 안내)가 끝나야
   * 생기므로 그 전에 온 메모는 받을 장면이 없다. 새 판 장면이 처음에 이것을 다시 보인다 (M12 검토)
   */
  matchNotes: GameEvent[] = [];
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
  /** 터치 모드 또는 설치 앱(standalone): 마지막 방 복귀 · 뒤로 가기 확인을 쓴다 (PC 브라우저는 F11 전체 화면이어도 지금 동작 그대로) */
  readonly lifeApp: boolean;
  private readonly backGuard: BackGuard | null;
  private readonly leaveDialog: LeaveDialog;
  private readonly replacedNotice: ReplacedNotice;
  /** 마지막 방으로 돌아가는 중 (?room= 없이, 또는 같은 방 주소로 30초 안에 다시 연 앱) */
  private returning: LastRoom | null = null;
  private rejoinTimer: number | null = null;
  /** 다음 끊김은 일부러 낸 것이다 (나가기): 끊김 알림을 띄우지 않는다 */
  private quietClose = false;
  /** 첫 화면 방 코드 칸에 미리 넣을 것 (판에서 나간 방: 30초 안에 입장을 누르면 같은 자리) */
  private homePrefill = '';
  // ── 봇과 연습 (M13b) ──
  /** 기기 안 연습 서버. 연습 중이면 판 화면 · 디버그 훅은 이것으로 주고받는다 (app.link) */
  private local: LocalTransport | null = null;
  private localUnsub: (() => void) | null = null;
  /**
   * 이 소켓으로 'leave'를 보냈고 아직 다음 welcome을 받지 않았다 (검토 반영 F07): 그사이 온 lobby · match · snap · result는
   * 서버가 leave를 처리하기 전에 보낸 떠난 방 것이라 버린다(staleAfterLeave). 새 소켓이 열리면 푼다
   */
  private awaitingWelcome = false;

  constructor(
    readonly params: AppParams,
    uiRoot: HTMLElement,
  ) {
    this.lifeApp = device.touch || device.installed;
    // ?practice=1이 방 링크 없이 왔으면(깨우기 화면의 "봇과 연습") 마지막 방 복귀보다 우선한다: 복귀를 건너뛰고 기억도 지운다.
    // 지우지 않으면 주소에서 practice를 지운 뒤 30초 안에 새로고침할 때 복귀가 되살아난다 (검토 반영 F12)
    if (practiceEntry(params.practice, params.room)) clearLastRoom();
    this.returning = this.lifeApp ? returnTarget(params.room, loadLastRoom(), params.practice) : null;
    this.roomCode = params.room ?? this.returning?.room ?? null;
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
        practice: (role, name) => this.startPractice(role, name),
        quick: (name) => {
          saveName(name);
          this.joinFromLink = false;
          this.returning = null;
          this.net.send({ t: 'quick', name });
        },
        leaveQueue: () => this.leaveToHome(),
        leaveRoom: () => this.leaveToHome(),
        join: (code, name) => {
          saveName(name);
          this.roomCode = code.toUpperCase();
          this.joinFromLink = false;
          this.returning = null;
          this.sendJoin(name);
        },
        pickRole: (role: Role | null) => this.link.send({ t: 'role', role }),
        setReady: (ready) => this.link.send({ t: 'ready', ready }),
        setName: (name) => this.link.send({ t: 'name', name }),
        start: () => this.link.send({ t: 'start' }),
      },
      params.name ?? getSavedName(),
    );
    this.resultUi = new ResultUI(
      uiRoot,
      () => this.link.send({ t: 'rematch' }),
      () => this.leaveToHome(),
    );
    this.wakeUi = new WakeNoticeUI(uiRoot, () => this.leaveBootRoom());
    this.leaveDialog = new LeaveDialog(uiRoot, {
      stay: () => {
        // "계속"을 누른 이 핸들러(사용자 활성화)에서 뒤로 가기 항목을 다시 넣는다
        this.leaveDialog.close();
        this.backGuard?.gesture();
      },
      leave: () => this.leaveRoom(),
    });
    this.replacedNotice = new ReplacedNotice(uiRoot, () => this.continueHere());
    // 확인 창 문구는 판 종류마다 다르다 (leaveRoom의 분기와 같은 조건): 빠른 매칭 판은 나가기가 바로 판정되고(검토 반영 F10),
    // 연습 판은 기기 안 판을 닫고 첫 화면으로 간다(검토 반영 F16)
    this.backGuard = this.lifeApp
      ? new BackGuard(
          window.history,
          () => this.leaveDialog.open(leaveKindFor(this.local !== null, this.lobby?.kind ?? null)),
          window.history.state,
        )
      : null;
    // 연습 중에는 서버 메시지를 쓰지 않는다 (연결도 쉰다)
    this.net.on((msg) => {
      if (this.local) return;
      // 'leave' 뒤 같은 소켓으로 늦게 온 떠난 방 메시지는 다음 welcome까지 버린다 (검토 반영 F07)
      if (staleAfterLeave(this.awaitingWelcome, msg.t)) return;
      if (msg.t === 'welcome') this.awaitingWelcome = false;
      this.onMessage(msg);
    });
    this.net.onHeard = () => this.keeper.heard();
    // 숨겨진 채 받은 첫 표본으로는 풀지 않는다 (보이면 다시 맞추고 그때 푼다)
    this.net.onResynced = () => {
      if (document.visibilityState === 'visible') haptics.clockSynced();
    };
    this.net.onOpen = () => {
      this.wasOpen = true;
      // 새 소켓에는 떠난 방 메시지가 없다
      this.awaitingWelcome = false;
      // 나가기가 끊긴 채 기다리던 중이었으면(닫힘 이벤트 없이 바로 연결) 그 표시가 남아 다음 진짜 끊김 알림을 삼킨다
      this.quietClose = false;
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
    // 첫 화면은 연결과 상관없이 바로 그린다 (M13b). 방 링크 · 마지막 방 복귀로 들어가는 중이면 지금처럼 깨우기 패널
    if (!this.roomCode) {
      // 연습 판 중 새로고침 · 탭 폐기 뒤 복원으로 왔으면 그 판의 뒤로 가기 항목({decoyGuard:1})이 남아 있다: 첫 화면을 그리기
      // 전에 걷는다. 남기면 첫 화면에서 누른 첫 뒤로 가기가 아무 일 없이 먹힌다 (검토 반영 F16. 방 판은 다시 들어가 그 항목을 쓴다)
      this.backGuard?.disarm();
      if (this.params.practice) this.lobbyUi.renderPracticePicker(this.params.name ?? getSavedName());
      else this.lobbyUi.renderHome(this.homePrefill);
    }
    // ?practice=1은 읽었으면 주소에서 지운다 (검토 반영 F12): 남으면 연습 → '홈으로' 뒤 새로고침 · '새 버전' 새로고침이 다시
    // 역할 고르기를 열고, 서비스 워커는 이 주소를 캐시 먼저로 준다. 뒤로 가기 항목 표시(history.state)는 그대로 둔다
    if (this.params.practice) {
      const url = new URL(window.location.href);
      url.searchParams.delete('practice');
      window.history.replaceState(window.history.state, '', url.toString());
    }
    // 기다린 시간(초)을 세려고 주기적으로 다시 그린다. 바뀐 게 없으면 DOM을 건드리지 않는다
    this.wakeTimer ??= window.setInterval(() => this.renderWake(), 250);
  }

  /** 연결 안내: 첫 화면은 상태 줄(M13b), 방 · 판 화면은 가운데 패널. 연습 중에는 둘 다 띄우지 않는다 */
  private renderWake(): void {
    const now = performance.now();
    this.lobbyUi.setServerStatus(
      serverStatus({
        connected: this.net.connected,
        offline: this.wake.offline,
        waitingSince: this.wake.waitingSince,
        nowMs: now,
      }),
    );
    // 빠른 매칭 대기 남은 시간 (서버 시계)
    if (this.net.synced) this.lobbyUi.tick(this.net.serverNow());
    const panel = this.wake.view(now);
    // 방 경로로 들어가려다 기다리는 중이면 '첫 화면으로' (검토 반영 F23)
    const canGoHome = wakeOffersHome({
      roomCode: this.roomCode,
      inRoom: this.lobby !== null || this.match !== null,
      practicing: this.local !== null,
    });
    this.wakeUi.render(this.local || this.lobbyUi.atHome ? { ...panel, visible: false } : panel, canGoHome);
  }

  /** 서버 빌드가 이 화면과 다르다 (M13d) */
  private showUpdate(): void {
    showUpdateBanner();
  }

  /** 지금 주고받는 전송: 연습 중이면 기기 안 서버, 아니면 서버 WebSocket */
  get link(): Transport {
    return this.local ?? this.net;
  }

  /** 기기 안 연습 중 */
  get practicing(): boolean {
    return this.local !== null;
  }

  /** 연습 방 코드 (디버그 · 시험) */
  get practiceRoom(): string | null {
    return this.local?.room?.code ?? null;
  }

  /** 기기 안 정답 상태 (연습 중 · 디버그 훅 전용) */
  localTruth(): ReturnType<LocalTransport['truth']> {
    return this.local?.truth() ?? null;
  }

  /**
   * 봇과 연습 (M13b): 기기 안 서버를 만들고 고른 역할로 바로 시작한다. 서버 연결은 쉰다 — 연습 중에는 새 연결을 시도하지
   * 않는다(오프라인 · 서버 잠듦에서도 소켓 시도 0). 주소 ?room= · 자리 토큰 · 마지막 방은 저장하지 않고,
   * 수신 감시 · 재연결 · 다른 탭 처리도 쓰지 않는다(연습은 다른 사람과 무관하다). 뒤로 가기 확인은 쓴다 — 설치 앱(TWA)에서는
   * 뒤로 가기가 곧 앱 종료이고 판 중 첫 화면으로 갈 다른 길이 없다. 연습 문구로 묻고 '나가기'면 첫 화면 (검토 반영 F16)
   */
  private startPractice(role: Role, name: string): void {
    if (this.local) return;
    saveName(name);
    this.quietClose = true;
    this.keeper.stop();
    this.wake.stop();
    this.net.drop();
    this.clearRejoin();
    this.returning = null;
    this.roomCode = null;
    const local = new LocalTransport({ testHooks: this.params.debug !== 'off' || import.meta.env.DEV });
    this.local = local;
    this.localUnsub = local.subscribe((msg) => this.onMessage(msg));
    this.renderWake();
    local.send({ t: 'join', room: null, create: true, name, token: null, altTokens: [], bots: true });
    local.send({ t: 'role', role });
    local.send({ t: 'ready', ready: true });
    local.send({ t: 'start' });
  }

  /** 연습을 끝내고 첫 화면으로: 기기 안 서버를 닫고 서버 연결을 다시 시작한다 */
  private stopPractice(): void {
    const local = this.local;
    if (!local) return;
    this.localUnsub?.();
    this.localUnsub = null;
    local.close();
    this.local = null;
    this.you = null;
    this.toHome('');
    this.wake.resume();
    this.wake.connecting(performance.now());
    this.keeper.resume();
    this.renderWake();
  }

  /**
   * 결과 화면 "홈으로" (M13b) · 빠른 매칭 대기 취소 · 친구 방 로비 "나가기": 연습이면 연습을 닫고, 서버 방이면 'leave'로 자리를
   * 비우고 첫 화면으로. 연결은 방에서 풀려 그대로 첫 화면에서 쓴다 (방 만들기 · 입장). 다음 welcome까지 늦게 온 떠난 방
   * 메시지는 버린다(awaitingWelcome). 친구 방이면 코드 칸에 방 코드를 남긴다 — 결과 화면에서 잘못 눌렀어도 '다시 하기'로
   * 방이 대기로 돌아가면 입장 한 번에 돌아올 수 있다 (빠른 매칭 방은 코드로 들어갈 수 없다)
   */
  private leaveToHome(queueDropped = false): void {
    if (this.local) {
      this.stopPractice();
      return;
    }
    const prefill = this.lobby?.kind === 'code' ? (this.roomCode ?? '') : '';
    this.net.send({ t: 'leave' });
    this.awaitingWelcome = true;
    this.forgetRoom(queueDropped, prefill);
  }

  /** 방을 잊고 첫 화면으로 (나가기 뒤 · 대기열에서 빠짐): 주소 room · 마지막 방을 지운다. 연결은 그대로 쓴다 */
  private forgetRoom(queueDropped: boolean, prefill = ''): void {
    clearLastRoom();
    this.clearRejoin();
    this.returning = null;
    this.you = null;
    this.homePrefill = prefill;
    this.toHome(prefill, queueDropped);
    const url = new URL(window.location.href);
    url.searchParams.delete('room');
    window.history.replaceState(window.history.state, '', url.toString());
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
    // 연습: 숨기면 기기 안 서버 루프만 멈추고(판이 그대로 멈춤), 보이면 시계를 지금으로 맞춰 이어 간다 (따라잡기 0)
    if (this.local) {
      if (visible) {
        this.local.resume();
        haptics.clockSynced();
      } else this.local.pause();
    }
    // 빠른 매칭 대기 중 화면이 숨겨지면 바로 대기열에서 빠진다 (돌아오면 "대기열에서 빠졌어요 — 다시 찾기", M13c)
    if (
      !visible &&
      !this.local &&
      this.lobby?.kind === 'quick' &&
      this.lobby.phase === 'lobby' &&
      this.match === null
    )
      this.leaveToHome(true);
    if (visible) {
      this.awake.shown();
      sfx.resume();
    } else {
      haptics.holdClock();
      this.touchLastRoom();
    }
  }

  /** 판 중인가 (화면 꺼짐 방지 · 뒤로 가기 확인 · 새 버전 띠 숨김) */
  private setPlaying(on: boolean): void {
    this.awake.set(on);
    // 판 중에는 "새 버전이 있어요" 띠를 숨긴다(style.css .in-match): 남은 시간 · 거점 게이지 · 맵 위쪽을 가렸다.
    // 결과 · 로비 · 첫 화면에서 다시 보인다 (검토 반영 F08)
    document.body.classList.toggle('in-match', on);
    // 뒤로 가기 확인은 연습 판도 쓴다 (검토 반영 F16): 설치 앱(TWA)에서는 뒤로 가기가 곧 앱 종료이고, 연습 판 중에는 첫 화면으로
    // 갈 다른 길이 없다. 문구는 판 종류별(leaveKindFor), 연습의 '나가기'는 첫 화면(leaveRoom)
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

  /**
   * 방을 떠나 첫 화면으로 (나가기 · 다시 들어가지 못함): 화면 꺼짐 방지를 놓고 뒤로 가기 항목을 걷고 판 상태를 비운다.
   * 방에 있었으면 판 장면을 멈추게 한다 (main.ts는 로비 단계 이벤트로 판 장면을 끝낸다)
   */
  private toHome(prefill: string, queueDropped = false): void {
    const code = this.roomCode ?? '';
    const wasInRoom = this.lobby !== null || this.match !== null;
    this.setPlaying(false);
    this.roomCode = null;
    this.lobby = null;
    this.match = null;
    this.result = null;
    this.lastSnap = null;
    this.resultUi.hide();
    this.lobbyUi.renderHome(prefill, queueDropped);
    if (wasInRoom)
      this.emit({
        kind: 'lobby',
        lobby: {
          room: code,
          kind: 'code',
          phase: 'lobby',
          players: [],
          bots: false,
          canStart: false,
          waitingFor: null,
          autoStartAt: null,
        },
      });
  }

  /**
   * 판 중 뒤로 가기 확인에서 "나가기": 방에서 나가 첫 화면으로. 친구 방은 서버가 끊김으로 보고 30초 유예를 센다.
   * 빠른 매칭 판은 유예 없이 바로 판정한다. 연습 판은 기기 안 판을 닫는다 (확인 창 문구도 다르다, leaveTextFor)
   */
  private leaveRoom(): void {
    // 연습 판: 기기 안 서버를 닫고 첫 화면으로, 서버 연결은 다시 시작한다 (검토 반영 F16). 연습 방도 로비 상태를 가지므로
    // 아래 친구 방 경로(마지막 방 지우기 · 새 소켓)를 타지 않게 먼저 거른다
    if (this.local) {
      this.stopPractice();
      return;
    }
    // 빠른 매칭 판: 나가기는 서버에 알려 그 자리를 바로 판정한다(유예 없음, M13c). 연결은 그대로 첫 화면에서 쓴다
    if (this.lobby?.kind === 'quick') {
      this.leaveToHome();
      return;
    }
    const code = this.roomCode ?? '';
    clearLastRoom();
    this.clearRejoin();
    this.returning = null;
    this.you = null;
    this.homePrefill = code;
    this.toHome(code);
    const url = new URL(window.location.href);
    url.searchParams.delete('room');
    window.history.replaceState(window.history.state, '', url.toString());
    // 이 소켓은 그 자리에 묶여 있다: 버리고 새로 연결해 첫 화면에서 쓴다
    this.quietClose = true;
    this.keeper.restart();
  }

  /**
   * 깨우기 패널의 '첫 화면으로' (검토 반영 F23): 방 링크 · 마지막 방 복귀로 들어가려고 기다리다 첫 화면으로. 오프라인 · 서버 꺼짐이면
   * 연결이 열리지 않아 패널에 갇혔다. 마지막 방 · 주소 room을 지우고 코드는 첫 화면 코드 칸에 남긴다(연결되면 입장 한 번으로 같은
   * 자리). 연결은 그대로 둔다 — 열리면 roomCode가 없으므로 첫 화면에 머문다
   */
  private leaveBootRoom(): void {
    const code = this.roomCode ?? '';
    clearLastRoom();
    this.clearRejoin();
    this.returning = null;
    this.joinFromLink = false;
    this.homePrefill = code;
    // 옛 연결이 남아 다시 시도하던 중(연결은 열림)이면 기다림 표시를 내린다
    if (this.net.connected) this.wake.opened();
    this.toHome(code);
    // 주소의 room은 뒤로 가기 항목을 걷어 내는 순회(toHome → disarm)가 끝난 뒤에 지운다 — 판 중 새로고침 · 탭 복원으로
    // 그 항목이 남아 있으면, 먼저 지운 주소가 순회 뒤 아래 항목의 ?room으로 되돌아갔다 (출시 전 검토의 수정 검토)
    const dropRoomFromUrl = (): void => {
      const url = new URL(window.location.href);
      url.searchParams.delete('room');
      window.history.replaceState(window.history.state, '', url.toString());
    };
    if (this.backGuard) this.backGuard.whenSettled(dropRoomFromUrl);
    else dropRoomFromUrl();
    this.renderWake();
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
      case 'pong':
        // 서버가 새 빌드면 (앱 셸 캐시가 옛 화면을 줬다) "새 버전이 있어요" (M13d, 연습 중에는 오지 않는다)
        if (buildMismatch(msg.build)) this.showUpdate();
        return;
      case 'welcome': {
        if (buildMismatch(msg.build)) this.showUpdate();
        this.balance = validateBalance(msg.balance);
        this.balanceHash = msg.balanceHash;
        this.you = msg.you;
        this.lobbyUi.setYou(msg.you);
        // 연습 방: 주소 · 자리 토큰 · 마지막 방을 저장하지 않는다 (연습 중 새로고침 → 첫 화면)
        if (this.local) return;
        this.roomCode = msg.room;
        this.returning = null;
        this.homePrefill = '';
        this.clearRejoin();
        // 마지막 방 복귀로 기다리던 안내를 내린다
        this.wake.opened();
        this.renderWake();
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
          // 연습 방은 방 화면 없이 바로 판이 시작된다 (역할 고르기 화면 · 결과 화면에서)
          if (msg.lobby.kind !== 'practice') this.lobbyUi.renderRoom(msg.lobby);
        }
        this.emit({ kind: 'lobby', lobby: msg.lobby });
        return;
      case 'match':
        if (!this.balance) return;
        this.match = msg.info;
        this.result = null;
        this.lastSnap = null;
        this.snapCount = 0;
        this.matchNotes = [];
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
        for (const ev of snap.events) if (isKeptNote(ev)) this.matchNotes.push(ev);
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
        // 빠른 매칭 자동 시작 순간 응답이 없어 대기열에서 빠졌다 (M13c)
        if (msg.code === 'queue-dropped') {
          this.forgetRoom(true);
          return;
        }
        // 마지막 방 복귀: 옛 소켓이 아직 그 자리에 붙어 있으면 30초 창 안에서 2초마다 다시
        if ((msg.code === 'in-progress' || msg.code === 'room-full') && this.retryReturn()) return;
        if (this.returning && msg.code === 'room-not-found') {
          this.returning = null;
          clearLastRoom();
        }
        // 판 중 다시 연결했는데 방이 사라졌거나 자리가 없으면 나가기처럼 정리한다 (화면 꺼짐 방지 · 뒤로 가기 항목 · 판 장면).
        // 방 밖(첫 화면)에서 들어가려던 방이 진행 중 · 가득 참이면 친 코드는 남긴다: 결과 단계 방은 '다시 하기'로 대기로
        // 돌아가면 다시 들어갈 수 있다 (검토 반영)
        if (msg.code === 'room-not-found' || msg.code === 'in-progress' || msg.code === 'room-full') {
          const keep =
            msg.code !== 'room-not-found' && this.lobby === null && this.match === null
              ? (this.roomCode ?? '')
              : '';
          this.wake.opened();
          this.renderWake();
          this.toHome(keep);
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

/** "새 버전이 있어요" + 새로고침 (M13d). 한 번만 만들고 판 화면을 가리지 않게 위 가운데 작은 띠 */
let updateShown = false;
function showUpdateBanner(): void {
  if (updateShown) return;
  updateShown = true;
  const node = document.createElement('div');
  node.className = 'update-banner';
  node.setAttribute('role', 'status');
  node.setAttribute('data-testid', 'update-available');
  const text = document.createElement('span');
  text.textContent = UI_TEXT.updateAvailable;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn';
  btn.textContent = UI_TEXT.updateReload;
  btn.addEventListener('click', () => window.location.reload());
  node.append(text, btn);
  document.body.appendChild(node);
}

export function showToast(text: string, ms = 2500): void {
  const node = document.createElement('div');
  node.className = 'toast';
  node.textContent = text;
  document.body.appendChild(node);
  window.setTimeout(() => node.remove(), ms);
}

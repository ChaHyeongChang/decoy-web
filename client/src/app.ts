// 클라이언트 상태와 흐름: 연결 → 로비 → 판 → 결과. 앱 생명주기(숨김 · 재접속 · 마지막 방 · 뒤로 가기 · 화면 꺼짐 방지)는 M12
import type Phaser from 'phaser';
import {
  LOGIN_RESULT_PARAM,
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
import { AccountApi } from './account/api';
import { bootAccount } from './account/boot';
import type { AccountController } from './account/controller';
import { accountMark } from './account/mark';
import { sfx } from './audio';
import { buildMismatch } from './buildInfo';
import { UI_TEXT } from './data/storyText';
import { device } from './device';
import { isFrameLimit, type FrameLimit } from './gfx/framePacing';
import type { QualityTier } from './gfx/presets';
import { parseCharStyle, type CharStyle } from './gfx/charStyle';
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
  reopenForAccount,
  returnTarget,
  staleAfterLeave,
  type LastRoom,
  type LifecycleDebug,
} from './lifecycle';
import type * as PracticeModuleNs from './localServer';
import type { LocalTransport } from './localServer';
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
import { readKey } from './storageKeys';
import { Interpolator, Predictor, SnapshotClock, lerpAngle, lerpNum } from './sync';
import type { Transport } from './transport';
import { LeaveDialog, ReplacedNotice } from './ui/lifecycleUi';
import { loadLayoutEditor } from './ui/layoutEditorLoader';
import { costumeSetFromRoster, lobbyCostumeSet, setBakeCostumes } from './art/costumeBake';
import { MetaState } from './meta/meta';
import { setWearing } from './meta/wearing';
import { DeviceProfileStore } from './meta/profileStore';
import type * as AccountUiNs from './ui/account';
import { HubHost } from './ui/hubHost';
import { LevelChip } from './ui/levelChip';
import { LobbyUI } from './ui/lobby';
import { SettingsHost } from './ui/settingsHost';
import { ResultHost } from './ui/resultHost';
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
  /**
   * ?fpsLimit=auto|60|120: 이번 세션의 프레임 제한 (렌더링 최적화 시험용. 저장한 선택보다 우선, 저장하지 않음).
   * 그 밖에는 null. 측정 표시는 ?debug=1 오버레이(ui/debugOverlay.ts)
   */
  fpsLimit: FrameLimit | null;
  /** ?chars=new|classic: 이번 접속의 캐릭터 스타일 (시험 · 촬영용. 저장한 선택보다 우선, 저장하지 않음). 그 밖에는 null */
  chars: CharStyle | null;
  /**
   * ?cam=1~6: 카메라 확대 수준 (시험 · 촬영용, 1 = 맵 전체). 로컬 주소(localhost · 127.0.0.1 · [::1])에서만 쓴다 —
   * 배포 주소에서는 무시한다(확대 수준은 플레이어가 바꿀 수 없다, 공정성). 그 밖에는 null
   */
  cam: number | null;
  /**
   * ?camSnap=0: 따라가는 카메라 창을 기기 픽셀 격자에 맞추지 않는다 (잔렉 고치기 — 사람이 격자 맞춤의 미세한 걸음을 견주어 보는 진단용,
   * 저장하지 않음, 그림 정보 · 판정과 무관해 배포 주소에서도 받는다). 없거나 그 밖의 값이면 true(맞춘다)
   */
  camSnap: boolean;
}

/** ?cam 값 해석: 1~6 사이 수만 (소수 허용), 그 밖에는 null */
export function parseCamZoom(raw: string | null): number | null {
  if (raw === null || raw.trim() === '') return null;
  const v = Number(raw);
  return Number.isFinite(v) && v >= 1 && v <= 6 ? v : null;
}

/** ?cam을 받아 주는 주소인가 (개발 · 시험 서버만) */
export function camOverrideAllowed(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
}

export function readParams(search: string): AppParams {
  const p = new URLSearchParams(search);
  const debugRaw = p.get('debug');
  const renderer = p.get('renderer');
  const lag = Number(p.get('lag') ?? 0);
  // ?quality와 같이 앞뒤 공백 · 대소문자는 가리지 않는다
  const fpsLimit = p.get('fpsLimit')?.trim().toLowerCase() ?? null;
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
    fpsLimit: isFrameLimit(fpsLimit) ? fpsLimit : null,
    chars: parseCharStyle(p.get('chars')),
    cam: parseCamZoom(p.get('cam')),
    camSnap: p.get('camSnap') !== '0',
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
  /** 결과 화면 (나눠 받는 조각, ui/resultHost.ts) */
  readonly resultUi: ResultHost;
  /** 게스트 기록 저장소 (decoy:progress) */
  private readonly deviceStore = new DeviceProfileStore();
  /**
   * 내 성장 기록 (GAME_DESIGN 12장): 게스트는 기기 저장소에서 읽고 판 결과의 내 평가로 경험치를 적립한다. 로그인하면 계정
   * 저장소로 바꿔 끼운다(서버가 적립 — docs/ACCOUNT_PLAN.md)
   */
  readonly meta = new MetaState(this.deviceStore);
  /** 계정 API (선택형 구글 로그인) */
  private readonly accountApi = new AccountApi();
  /** 계정 흐름 · 화면 (나눠 받는 조각 'account' — 로그인한 기기의 부팅 · 설정을 열 때만 받는다) */
  private accountUi: Promise<{ mod: typeof AccountUiNs; ctl: AccountController } | null> | null = null;
  /** 첫 화면 · 연습 고르기 내 레벨 · 불씨 칩 (누르면 '내 기록' 창) */
  readonly levelChip = new LevelChip(this.meta, () => this.hub.open());
  /** '내 기록' 창 (나눠 받는 조각, ui/hubHost.ts): 레벨 · 불씨 · 접속 보상 · 오늘의 도전 */
  readonly hub: HubHost;
  /** 자정(게스트: 이 기기 시간, 로그인: 계정 시간대)에 칩 · 창을 다시 그린다 (새 도전 · 접속 보상) */
  private midnightTimer: number | null = null;
  /** 자정 타이머를 건 기록 저장소 (바뀌면 다시 건다) */
  private midnightMode: 'device' | 'server' = 'device';
  /** 설정 화면 (설정 화면 통합): 로비 · 판 중 메뉴에서 연다 (#ui-root, 로비 · 판 화면 위). 화면 코드는 나눠 받는 조각 */
  readonly settings: SettingsHost;
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
   * 기기 안 연습 서버 코드(localServer.ts + 공유 시뮬레이션 · 봇 두뇌)는 나눠 받는 조각 'localServer'다 (DECISIONS 11절 '번들 줄이기: 나눠 받는 조각 넷 더').
   * 판 밖 쉬는 시간에 미리 받고(prefetchPractice), 역할을 누를 때 아직이면 받은 뒤 시작한다. 받지 못하면 null
   */
  private practiceModule: Promise<typeof PracticeModuleNs | null> | null = null;
  /** 연습 시작 요청 번호: 조각을 받는 사이 다른 역할을 누르거나 첫 화면 · 방으로 가면 앞 요청은 시작하지 않는다 */
  private practiceReq = 0;
  /**
   * 이 소켓으로 'leave'를 보냈고 아직 다음 welcome을 받지 않았다 (검토 반영 F07): 그사이 온 lobby · match · snap · result는
   * 서버가 leave를 처리하기 전에 보낸 떠난 방 것이라 버린다(staleAfterLeave). 새 소켓이 열리면 푼다
   */
  private awaitingWelcome = false;
  /**
   * 이 소켓을 연 뒤 계정 모드가 바뀌었다 (부팅이 아닌 때 — 로그아웃 · 계정 삭제 · 세션 끝 · 꺼짐 · 다른 탭 로그인). 서버는 소켓을 열
   * 때의 세션 쿠키로 계정을 정하므로(Conn.account) 이 소켓의 계정은 지금 모드와 다르다: 첫 화면이면 바로, 방 · 판 중이면 첫 화면에
   * 돌아올 때 다시 연다. 그때까지 계정 모드의 온라인 판은 기기 기록에 적립하고(서버가 이 계정에 적립하지 않는다) credit은 받지 않는다
   * (다른 계정 것일 수 있다). 게스트 모드는 그대로 기기 기록 — DECISIONS 15절
   */
  private staleSocket = false;

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
          // 새 소켓은 지금 쿠키를 싣는다 (부팅 때는 계정 상태를 읽는 중이어도 같은 쿠키 — 계정 모드를 따른다)
          this.staleSocket = false;
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
    this.settings = new SettingsHost(
      uiRoot,
      {
        touch: device.touch,
        haptics: {
          supported: device.touch && haptics.supported,
          enabled: () => haptics.enabled,
          setEnabled: (on) => haptics.setEnabled(on),
        },
        role: () => this.match?.role ?? this.lobby?.players.find((p) => p.id === this.you)?.role ?? null,
        replayTutorial: () => this.lobbyUi.tutorialReset(),
        account: (page, show) => this.fillAccountTab(page, show),
        // 편집 화면은 나눠 받는 조각(ui/layoutEditorLoader.ts): 로비에서 설정을 열 때 미리 받는다. 아직이면 받은 뒤 열고,
        // 그사이 닫히면(판 시작) 열지 않는다. 받지 못하면 설정 화면으로 돌아가 "새 버전이 있어요"
        openLayoutEditor: (done) => {
          const role = this.lobby?.players.find((p) => p.id === this.you)?.role ?? null;
          let editor: { close(): void } | null = null;
          let ended = false;
          const end = (): void => {
            if (ended) return;
            ended = true;
            done();
          };
          void loadLayoutEditor().then((mod) => {
            if (ended) return;
            if (!mod) {
              end();
              this.showUpdate();
              return;
            }
            editor = mod.openLayoutEditor({
              host: uiRoot,
              role: role === 'monster' ? 'monster' : 'survivor',
              onClose: () => {
                end();
                // 판 직전 터치 안내 그림이 바꾼 배치를 따르게 방 화면을 다시 그린다
                this.lobbyUi.refreshTutorial();
              },
            });
          });
          return {
            close: () => {
              if (editor) editor.close();
              else end();
            },
          };
        },
      },
      () => this.showUpdate(),
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
            costume: this.meta.costumes(),
          });
        },
        practice: (role, name) => this.startPractice(role, name),
        quick: (name) => {
          saveName(name);
          this.joinFromLink = false;
          this.returning = null;
          this.net.send({ t: 'quick', name, costume: this.meta.costumes() });
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
      this.settings,
      { chip: this.levelChip.el, level: () => this.meta.level().level },
    );
    this.hub = new HubHost(uiRoot, this.meta, () => this.showUpdate());
    // 입은 의상: 판 밖 화면의 내 역할 그림 · 로비 미리 굽기 · 서버 자리 (옷장 · 다른 탭에서 바꾸면 따라간다).
    // 기록 저장소가 바뀌면(로그인 · 로그아웃) 자정 타이머를 그 시간대로 다시 건다
    setWearing(this.meta.costumes());
    this.meta.onChange(() => {
      this.wearingChanged();
      if (this.midnightMode !== this.meta.mode && this.midnightTimer !== null) this.armMidnight();
    });
    this.resultUi = new ResultHost(
      uiRoot,
      () => this.link.send({ t: 'rematch' }),
      () => this.leaveToHome(),
      () => this.showUpdate(),
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
    // 연습 중에는 서버 메시지를 쓰지 않는다 (연결도 쉰다). 계정 적립 알림(credit)은 연습 중에 와도 받는다 (앞 온라인 판의 것)
    this.net.on((msg) => {
      if (msg.t === 'credit') {
        if (!this.staleSocket) this.meta.credit(msg.matchId, msg.ok, msg.profile);
        return;
      }
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
    // 생명주기 디버그 훅(window.__DECOY_LIFE__, 시험 · ?debug)은 만들 때 건다: 주소에 ?debug가 있으면 main.ts가 디버그 조각을
    // 받은 뒤 start()를 부르는데, 시험은 문서가 준비될 때(사용자 활성화 전) 이 훅을 쓴다 (예전 순서 그대로 — 모듈 실행 안)
    if (this.params.debug !== 'off' || import.meta.env.DEV) this.installLifecycleDebug();
  }

  /** 다음 자정(게스트: 이 기기 시간, 로그인: 계정 시간대)에 칩 · 창을 다시 그린다. 자정마다 다시 건다 */
  private armMidnight(): void {
    if (this.midnightTimer !== null) window.clearTimeout(this.midnightTimer);
    this.midnightMode = this.meta.mode;
    // 1초 늦게 (자정 바로 그 순간의 시계 반올림을 피해서)
    this.midnightTimer = window.setTimeout(() => {
      this.midnightTimer = null;
      this.meta.refresh();
      this.armMidnight();
    }, this.meta.untilMidnight() + 1000);
  }

  /** 계정 흐름 · 화면 조각 (설정 '계정' 탭 · 고르기 창 · 안내). 받지 못하면 "새 버전이 있어요" */
  private loadAccount(): Promise<{ mod: typeof AccountUiNs; ctl: AccountController } | null> {
    this.accountUi ??= import('./ui/account').then(
      (mod) => ({
        mod,
        ctl: mod.createAccount({
          api: this.accountApi,
          meta: this.meta,
          mark: accountMark(),
          device: this.deviceStore,
          deviceText: () => readKey('progress'),
          left: () => this.accountChanged(),
          entered: () => this.accountChanged(),
          now: () => Date.now(),
        }),
      }),
      () => {
        this.accountUi = null;
        this.showUpdate();
        return null;
      },
    );
    return this.accountUi;
  }

  /** 설정 '계정' 탭 (로비에서 열 때 — 조각을 받아 상태를 보고 채운다. 받지 못하면 숨긴다) */
  private fillAccountTab(page: HTMLElement, show: (on: boolean) => void): void {
    void this.loadAccount().then((a) => (a ? a.mod.fillTab(page, a.ctl, show) : show(false)));
  }

  /**
   * 부팅이 아닌 때 계정 모드가 바뀌었다 (로그아웃 · 계정 삭제 · 세션 끝 · 꺼짐 · 다른 탭 로그인): 이 소켓은 옛 계정 상태로 열렸다.
   * 첫 화면이면 바로, 방 · 판 중이면 첫 화면에 돌아올 때(forgetRoom) 다시 연다 — 옛 계정 소켓으로 하는 판이 계속 그 계정에
   * 적립되거나(공용 기기면 다음 사람 판이 앞사람 계정에), 게스트 소켓의 판이 어디에도 적립되지 않는 일이 없게
   */
  private accountChanged(): void {
    this.staleSocket = true;
    this.reopenAtHome();
  }

  /** 계정 모드가 바뀐 소켓이고 첫 화면이면 다시 연다 (판 중 나가기 leaveRoom · 연습 끝은 원래 새로 연다) */
  private reopenAtHome(): void {
    if (!reopenForAccount(this.staleSocket, this.lobby !== null || this.match !== null)) return;
    this.quietClose = true;
    this.keeper.restart();
  }

  start(): void {
    this.armMidnight();
    // 선택형 구글 로그인: 이 기기 표시가 있거나 로그인하고 돌아왔으면(?login=) 계정 상태를 읽는다 — 게스트는 요청 없음.
    // ?login=은 아래에서 주소에서 지운다
    const login = new URLSearchParams(window.location.search).get(LOGIN_RESULT_PARAM);
    void bootAccount(
      {
        api: this.accountApi,
        mark: accountMark(),
        meta: this.meta,
        controller: () => this.loadAccount().then((a) => a?.ctl ?? null),
      },
      login,
    );
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
    this.wake.setOffline(navigator.onLine === false);
    this.wake.connecting(performance.now());
    this.keeper.start();
    // 첫 화면은 연결과 상관없이 바로 그린다 (M13b). 방 링크 · 마지막 방 복귀로 들어가는 중이면 지금처럼 깨우기 패널
    if (!this.roomCode) {
      // 연습 판 중 새로고침 · 탭 폐기 뒤 복원으로 왔으면 그 판의 뒤로 가기 항목({decoyGuard:1})이 남아 있다: 첫 화면을 그리기
      // 전에 걷는다. 남기면 첫 화면에서 누른 첫 뒤로 가기가 아무 일 없이 먹힌다 (검토 반영 F16. 방 판은 다시 들어가 그 항목을 쓴다)
      this.backGuard?.disarm();
      if (this.params.practice) {
        // 깨우기 화면의 "봇과 연습": 역할을 고르는 동안 연습 조각을 받는다
        this.prefetchPractice();
        this.lobbyUi.renderPracticePicker(this.params.name ?? getSavedName());
      } else this.lobbyUi.renderHome(this.homePrefill);
    }
    // ?practice=1은 읽었으면 주소에서 지운다 (검토 반영 F12): 남으면 연습 → '홈으로' 뒤 새로고침 · '새 버전' 새로고침이 다시
    // 역할 고르기를 열고, 서비스 워커는 이 주소를 캐시 먼저로 준다. 뒤로 가기 항목 표시(history.state)는 그대로 둔다.
    // ?login=(로그인 결과)도 같다 — 새로고침할 때마다 안내가 다시 뜨지 않게
    if (this.params.practice || login !== null) {
      const url = new URL(window.location.href);
      url.searchParams.delete('practice');
      url.searchParams.delete(LOGIN_RESULT_PARAM);
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
   * 입은 의상이 바뀌었다 (옷장 · 다른 탭 · 기록을 처음 읽음): 방에 있으면 서버 자리에 알리고(판 중이면 서버가 무시한다),
   * 판 밖이면 로비 미리 굽기를 맞춘다. 판 중 · 결과 화면의 그림은 그 판 시작 명단 그대로 둔다
   */
  private wearingChanged(): void {
    if (!setWearing(this.meta.costumes())) return;
    // 방에 있으면 서버 자리에 알린다 (판 중이면 서버가 두었다가 판이 끝나면 입힌다 — room.ts recostume).
    // 방 밖이면 다음 join · quick에 실려 간다
    if (this.you && this.lobby) this.link.send({ t: 'costume', costume: this.meta.costumes() });
    if (this.match) return;
    const mine = this.lobby?.players.find((p) => p.id === this.you)?.role ?? null;
    setBakeCostumes(lobbyCostumeSet(mine, this.meta.costumes()));
  }

  /**
   * 봇과 연습 (M13b): 기기 안 서버를 만들고 고른 역할로 바로 시작한다. 서버 연결은 쉰다 — 연습 중에는 새 연결을 시도하지
   * 않는다(오프라인 · 서버 잠듦에서도 소켓 시도 0). 주소 ?room= · 자리 토큰 · 마지막 방은 저장하지 않고,
   * 수신 감시 · 재연결 · 다른 탭 처리도 쓰지 않는다(연습은 다른 사람과 무관하다). 뒤로 가기 확인은 쓴다 — 설치 앱(TWA)에서는
   * 뒤로 가기가 곧 앱 종료이고 판 중 첫 화면으로 갈 다른 길이 없다. 연습 문구로 묻고 '나가기'면 첫 화면 (검토 반영 F16)
   */
  private startPractice(role: Role, name: string): void {
    if (this.local) return;
    const req = ++this.practiceReq;
    // 역할을 누른 그 고르기 화면 (받는 사이 취소했다가 다시 연 고르기는 번호가 다르다)
    const picker = this.lobbyUi.practicePicker;
    void this.loadPractice().then((mod) => {
      // 받는 사이 다른 역할을 눌렀거나, 그 고르기를 떠났거나(취소 · 방 링크 · 다시 연 고르기), 이미 연습 중이면 그만
      if (req !== this.practiceReq || this.local || picker === null || this.lobbyUi.practicePicker !== picker)
        return;
      if (!mod) {
        // 새 배포로 옛 조각이 사라졌다(옛 화면): '새 버전이 있어요' — 새로고침하면 새 조각을 받는다
        this.showUpdate();
        return;
      }
      this.beginPractice(mod, role, name);
    });
  }

  /** 연습 조각을 판 밖 쉬는 시간에 미리 받는다 (main.ts schedulePrebake · 연습 고르기를 열 때) */
  prefetchPractice(): void {
    void this.loadPractice();
  }

  private loadPractice(): Promise<typeof PracticeModuleNs | null> {
    this.practiceModule ??= import('./localServer').catch(() => {
      this.practiceModule = null;
      return null;
    });
    return this.practiceModule;
  }

  private beginPractice(mod: typeof PracticeModuleNs, role: Role, name: string): void {
    saveName(name);
    this.quietClose = true;
    this.keeper.stop();
    this.wake.stop();
    this.net.drop();
    this.clearRejoin();
    this.returning = null;
    this.roomCode = null;
    const local = new mod.LocalTransport({ testHooks: this.params.debug !== 'off' || import.meta.env.DEV });
    this.local = local;
    this.localUnsub = local.subscribe((msg) => this.onMessage(msg));
    this.renderWake();
    // 연습: 고른 역할에 내 의상을 미리 굽는다 (봇 자리는 기본)
    setBakeCostumes(lobbyCostumeSet(role, this.meta.costumes()));
    local.send({
      t: 'join',
      room: null,
      create: true,
      name,
      token: null,
      altTokens: [],
      bots: true,
      costume: this.meta.costumes(),
    });
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
   * 메시지는 버린다(awaitingWelcome). 친구 방에 다른 사람이 남아 있으면 코드 칸에 방 코드를 남긴다 — 결과 화면에서 잘못
   * 눌렀어도 '다시 하기'로 방이 대기로 돌아가면 입장 한 번에 돌아올 수 있다 (빠른 매칭 방은 코드로 들어갈 수 없다). 마지막
   * 사람이면 서버가 방을 바로 지우므로 남기지 않는다 — 남기면 '입장'이 방을 찾을 수 없다고 했다 (수정 검토)
   */
  private leaveToHome(queueDropped = false): void {
    if (this.local) {
      this.stopPractice();
      return;
    }
    const others = this.lobby?.players.some((p) => p.id !== this.you && !p.bot) ?? false;
    const prefill = this.lobby?.kind === 'code' && others ? (this.roomCode ?? '') : '';
    this.net.send({ t: 'leave' });
    this.awaitingWelcome = true;
    this.forgetRoom(queueDropped, prefill);
  }

  /**
   * 방을 잊고 첫 화면으로 (나가기 뒤 · 대기열에서 빠짐 · 결과 '홈으로'): 주소 room · 마지막 방을 지운다. 연결은 그대로 쓴다 — 방 · 판
   * 중에 계정 모드가 바뀌었으면 여기서 다시 연다('leave'는 먼저 보냈다)
   */
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
    this.reopenAtHome();
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
      costume: this.meta.costumes(),
    });
  }

  // ───────────── 앱 생명주기 (M12) ─────────────

  /** 화면이 숨겨짐 · 보임: 감시 멈춤 · 재개(즉시 ping + 시계 다시 맞추기), 화면 꺼짐 방지 다시 요청, 오디오 다시 켜기 */
  private onVisibility(visible: boolean): void {
    this.keeper.visibility(visible);
    // 앱으로 돌아오면 날이 바뀌었을 수 있다 (새 도전 · 접속 보상 점)
    if (visible) this.meta.refresh();
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
    // 방 밖: 지난 판 명단 의상을 굽기 값에서 지운다 (굽기 값이 바뀌면 첫 화면 미리 굽기가 기본으로 되돌린다 — main.ts
    // onBakeCostumesChange. 다음 연습 판에서 봇 자리에 지난 판 의상이 보이지 않게)
    setBakeCostumes(lobbyCostumeSet(null, this.meta.costumes()));
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

  /**
   * 다른 캐릭터를 그릴 시각 (스냅샷 시계 − 100ms). atMs = 이 프레임 시각 — 판 장면은 rAF 시각(frameTimeOf)을 준다(잔렉 고치기):
   * 콜백 안 performance.now는 콜백이 늦게 시작한 만큼 프레임마다 흔들려, 따라가는 카메라(rAF 시각) 아래에서 걷는 상대가 그만큼 떨렸다
   */
  renderTime(atMs: number = performance.now()): number {
    return this.snapClock.now(atMs) - (this.balance?.network.interpolationDelayMs ?? 100);
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
          // 미리 굽기 의상: 내가 고른 역할에만 내 의상 (다른 자리 의상은 판 시작 명단으로 안다)
          const mine = msg.lobby.players.find((p) => p.id === this.you)?.role ?? null;
          setBakeCostumes(lobbyCostumeSet(mine, this.meta.costumes()));
          // 연습 방은 방 화면 없이 바로 판이 시작된다 (역할 고르기 화면 · 결과 화면에서)
          if (msg.lobby.kind !== 'practice') this.lobbyUi.renderRoom(msg.lobby);
        }
        this.emit({ kind: 'lobby', lobby: msg.lobby });
        return;
      case 'match':
        if (!this.balance) return;
        this.match = msg.info;
        // 이 판에 입힐 의상 (판 시작 명단 — 괴물 화면 명단에는 생존자가 없어 생존자 칸은 기본). 그림 조각이 아직이면 오는 대로 그 칸만 다시 굽는다
        setBakeCostumes(costumeSetFromRoster(msg.info.roster));
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
        // '내 기록' 창이 열린 채 판이 시작되면(방 링크로 들어오는 중 · 진행 중인 판에 다시 들어옴) 창이 판을 가리지 않게 닫는다
        this.hub.close();
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
      case 'result': {
        this.result = msg.result;
        this.setPlaying(false);
        // 내 평가 적립 (같은 판이면 다시 주지 않는다 — 재접속해 결과를 다시 받아도). 저장이 안 돼도 화면은 그대로
        // 로그인했으면 온라인 판은 서버가 계정에 적립하고(credit을 기다린다), 연습 판은 적립하지 않는다 (meta.ts). 연 뒤 계정
        // 모드가 바뀐 소켓의 판은 서버가 이 계정에 적립하지 않으니 기기 기록에 (staleSocket)
        const rated = msg.rating
          ? this.meta.applyRating(msg.rating, this.local !== null, this.staleSocket)
          : null;
        this.resultUi.show(msg.result, this.match?.role ?? null, rated);
        this.emit({ kind: 'result', result: msg.result });
        return;
      }
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

// 판 화면: 1/30초 고정 간격 입력 → 예측 → 서버 전송, 그리고 렌더링 · HUD · 배너
// 설정 화면 통합 (판 중 설정 효과): 흔들림 · 번쩍임 줄이기(prefs) · FPS · 핑 칩 · 지도 크게 보기 · 판 중 메뉴(PC 버튼 · Esc ·
// 터치 '설정' 버튼 → matchMenu). 메뉴가 열려 있어도 판은 흐르고 그리기도 그대로다 — 키 · 마우스 · 터치 입력만 멈춘다
import Phaser from 'phaser';
import {
  BTN,
  MAP_H,
  MAP_W,
  TILE_PX,
  type AnimDebug,
  type CameraDebug,
  type DrawnEntity,
  type SurvivorView,
  type FxTarget,
  type GameEvent,
  type HudLayoutItem,
  type InfoItem,
  type MatchPrefsDebug,
  type InputFrame,
  type InputLogEntry,
  type Role,
  type Snapshot,
  type SurvivorStatus,
  isKeptNote,
} from '@decoy/shared';
import type { App } from '../app';
import { LinearRamp, isWalking, selfPieces, type SelfStep, type TravelPiece } from '../art/anim';
import { sfx } from '../audio';
import { HELP_TEXT, STORY_TEXT, UI_TEXT, formatText } from '../data/storyText';
import { device } from '../device';
import { FPS_WINDOW_MS, sessionFrameStats, type FrameWindow } from '../gfx/frameStats';
import { ladderSize, pacingHooks } from '../gfx/framePacing';
import {
  lateWindowFor,
  qualityHooks,
  sessionAutoDowngrade,
  type AdaptContext,
  type FrameSample,
} from '../gfx/quality';
import { getFpsOverride, gfxNow, gfxState, onGfxChange, probeSlot } from '../gfx/state';
import { haptics } from '../haptics';
import { InputLog, InputSampler } from '../input';
import { matchMenu, toggleMatchMenu } from '../matchMenu';
import { onPrefsChange, pref, shakeScaleOf, type PrefKey } from '../prefs';
import { AimHold, aimAnchor } from '../aimHold';
import { applyDashStart, applyWindupLock, predictMonsterPress, type LocalWindup } from '../localActions';
import { COLOR } from '../render/colors';
import { cullable } from '../render/camera';
import { CameraDirector, devPerTile } from '../render/cameraDirector';
import { UI } from '../art/palette';
import { ScreenEffects, collectFxTargets } from '../render/effects';
import { bigMinimapPlace, spottedEdgeAlpha } from '../render/prefsFx';
import { WorldRenderer, type MotionSource } from '../render/worldRenderer';
import { TouchInput, type TouchFrameCtx } from '../touchInput';
import { TOUCH_HINT_MS, takeTouchHints } from '../touchTutorial';
import type { IconId } from '../art/icons';
import { Banners, type BannerLine } from '../ui/banners';
import { Hud } from '../ui/hud';
import type { Tone } from '../ui/hudArt';
import { HudKit, type Slice } from '../ui/hudKit';
import {
  CAM,
  CAM_ZOOM,
  HUD,
  HUD_BAND,
  MAP_RECT,
  MINIMAP_INSET,
  MIN_GAP,
  VIEW_H,
  VIEW_TILES_H,
  VIEW_TILES_W,
  VIEW_W,
  WORLD_SCALE,
  fitCamera,
  minimapFallback,
  tileToScreen,
} from '../ui/layout';
import { MatchMenuButton, menuButtonPlace } from '../ui/matchMenuButton';
import { Minimap } from '../ui/minimap';
import { EdgeMarkers, edgeMetrics } from '../ui/edgeMarkers';
import { edgeTargets, placeEdges, type EdgeMarker, type EdgeTarget } from '../render/offscreen';
import { Scoreboard, TutorialOverlay } from '../ui/overlays';
import { PERF_CHIP, PerfChip, perfChipPlace, perfChipText, type CssRect } from '../ui/perfChip';
import { PROBE_DEPTH, drawProbeText } from '../ui/text';
import { TouchControls, type TouchView } from '../ui/touchControls';
import { frameDeltaMs, frameTimeOf, staleEventLimitMs, trackFrameMs } from './staleEvents';

/** 안개 (M3부터) */
export const FOG_ENABLED = true;
/** 입력이 밀렸을 때 한 번에 따라잡는 최대 스텝 */
const MAX_CATCHUP_STEPS = 4;
/** 입력 틱 경계 비교 여유 (ms): 쌓인 시간이 틱 길이에 부동소수 오차만큼 모자라도 그 틱으로 본다 */
const STEP_EPS_MS = 1e-6;
/** 첫 판 조작 안내 표시 시간 (VISUAL_SPEC 8.3) */
const TUTORIAL_SECONDS = 5;
const EXIT_NAMES = { N: '북', S: '남' } as const;
/** 알림 배너의 톤 · 아이콘 (색만으로 구분하지 않기: 아이콘이 같이 바뀐다) */
const ALERT_LOOK: Partial<Record<string, { tone: Tone; icon: IconId }>> = {
  ALERT_CAPTURE_START: { tone: 'warn', icon: 'point' },
  ALERT_ROAR: { tone: 'warn', icon: 'roar' },
  ALERT_CAPTURE_DONE: { tone: 'info', icon: 'check' },
  ALERT_EXITS_ON: { tone: 'info', icon: 'exit' },
  ALERT_EXIT_OPEN: { tone: 'info', icon: 'exit' },
  ALERT_RESCUED: { tone: 'info', icon: 'rescue' },
};
/** 늘 같은 배너 줄 (프레임마다 새 객체를 만들지 않는다. Banners는 줄을 붙잡지 않고 값만 읽는다) */
const LINE = {
  campSlow: { text: UI_TEXT.campSlow, tone: 'warn', icon: 'prison' },
  campWarn: { text: UI_TEXT.campWarn, tone: 'warn', icon: 'prison' },
  pointWarn: { text: UI_TEXT.pointWarn, tone: 'warn', icon: 'point' },
  spotted: { text: UI_TEXT.spotted, tone: 'danger', icon: 'eye' },
} as const satisfies Record<string, BannerLine>;
let last30: BannerLine | null = null;
/** 최후의 30초 줄 (문구 틀을 프레임마다 채우지 않는다: 매개변수가 없어 늘 같은 글) */
function lastChanceLine(): BannerLine {
  last30 ??= { text: formatText('ALERT_LAST_30'), tone: 'warn', icon: 'exit' };
  return last30;
}

/** 적응형 품질이 최근 1초 측정을 다시 내는 간격 (ms). 매 프레임 백분위를 내지 않는다 */
const ADAPT_WINDOW_EVERY_MS = 250;

export class GameScene extends Phaser.Scene {
  private app!: App;
  private sampler = new InputSampler();
  /** 터치 모드(device.touch)에서만: 터치 상태 기계와 터치 화면 (M11) */
  private touch: TouchInput | null = null;
  private touchControls: TouchControls | null = null;
  /** 터치 화면이 지금 입력을 받는가 (바뀔 때만 setActive) */
  private touchActive: boolean | null = null;
  /** 최근 입력 프레임 (디버그 · E2E) */
  private readonly inputHistory = new InputLog(120);
  private seq = 0;
  /** 최근 프레임 간격 (ms, 느려지면 바로 · 빨라지면 천천히): 느린 기기에서 오래된 이벤트 한도를 늘린다 */
  private frameMs = 0;
  /** 입력 틱 시계: 쌓인 시간 (ms, 틱 길이가 되면 한 틱) · 마지막으로 쌓은 시각 */
  private acc = 0;
  private lastInputAt = 0;
  private inputTimer: number | null = null;
  private world!: WorldRenderer;
  /** HUD 아틀라스와 부품 (배율이 바뀔 때만 다시 굽는다) */
  private kit!: HudKit;
  private hud!: Hud;
  private minimap!: Minimap;
  /** 화면 밖 화살표 (확대 1이면 없음: 맵 전체가 보인다) */
  private edges: EdgeMarkers | null = null;
  private readonly edgeTargetBuf: EdgeTarget[] = [];
  private readonly edgePlaced: EdgeMarker[] = [];
  /** 카드 탭 · 클릭으로 고른 팀 카드 번호 (관전, 다음 프레임에 처리) */
  private cardPick: number | null = null;
  /** 터치 엄지 버튼 사각형 (논리 px, 화살표가 피한다) */
  private thumbBoxes: readonly { x: number; y: number; w: number; h: number }[] = [];
  /** 이번 프레임 캐릭터 몸 자리 (논리 px, 화살표가 겹치면 흐리게) — 그릇 재사용 */
  private readonly bodyPts: { x: number; y: number }[] = [];
  private readonly statusOf = (id: string): SurvivorStatus | null => {
    const list = this.app.lastSnap?.survivors;
    if (!list) return null;
    for (const s of list) if (s.id === id) return s.status;
    return null;
  };
  private banners!: Banners;
  /** 첫 판에만 만든다 (두 번째 판부터는 보이지 않으므로 글자 · 이미지를 만들지 않는다) */
  private tutorial: TutorialOverlay | null = null;
  private scoreboard!: Scoreboard;
  /** 발각: 화면 가장자리 안쪽 빨간 빛 (얇은 테두리 + 안으로 옅어지는 띠, HUD 아래) */
  private spottedEdge!: Slice;
  /** 괴물 화면: 내 부채꼴 모양 보간 (스냅샷 사이에도 0.4초 전환이 부드럽게) */
  private myBlend = 0;
  /**
   * myBlend의 시간 곡선: 시야 모드가 바뀐 스냅샷을 받은 순간부터 visionModeSwitchTime에 걸쳐 (렌더링 최적화: 프레임마다
   * 더하면 바뀐 프레임에 그 전 시간까지 더해져 fps마다 달랐다). 판 장면마다 새로
   */
  private blendRamp: LinearRamp | null = null;
  /** 판 장면을 만든 뒤 그린 프레임 수 (디버그 animDebug: 120Hz로 정말 그렸는지 시험이 본다) */
  private renderedFrames = 0;
  /** 괴물 마우스 조준 붙잡기 (커서가 움직였을 때만 다시 잰다) */
  private readonly aimHold = new AimHold();
  private readonly aimPointer = { x: 0, y: 0 };
  private readonly aimCursor = new Phaser.Math.Vector2();
  /** 지난 조준 때 백버퍼 크기 (바뀌었으면 포인터 좌표만 옮겨진 것: AimHold.rebase) */
  private aimBackingW = 0;
  private aimBackingH = 0;
  /** 화면 밖 화살표가 피할 사각형 (프레임마다 다시 채운다) */
  private readonly edgeAvoid: { x: number; y: number; w: number; h: number }[] = [];

  /** 판 중 창이 낮아져 엄지 버튼이 옆 칸 미니맵을 덮었다 (TouchControls onCovered) */
  private minimapCovered = false;

  // ── 판 중 설정 효과 (설정 화면 통합) ──
  /** OS '동작 줄이기' (판 장면을 만들 때 읽는다): 흔들림 0 */
  private osReduceMotion = false;
  /** 시험의 흔들림 배율 덮어쓰기 (setShakeScale). '흔들림 줄이기' 설정이 바뀌면 지운다 */
  private shakeOverride: number | null = null;
  /** 번쩍임 줄이기 (피격 테두리 옅게 · 잘라 옮김 어두워짐 없음 · 발각 테두리 맥동 없음) */
  private flashReduced = false;
  /** 발각 빛 테두리에 지금 건 알파 (디버그, 보이지 않으면 0) */
  private spottedAlphaNow = 0;
  /** 판 중 메뉴(설정 화면)가 열려 입력을 멈췄다 (matchMenu.isOpen을 입력 틱 · 프레임마다 본다) */
  private menuOpen = false;
  /** #ui-root (판 중 메뉴 버튼 · FPS 칩 · 터치 화면을 붙이는 곳) */
  private uiRoot: HTMLElement = document.body;
  /** PC 판 중 메뉴 버튼 (터치 모드는 null — 터치 화면의 '설정' 시스템 버튼) */
  private menuButton: MatchMenuButton | null = null;
  /** FPS · 핑 칩 (설정을 켠 판에서 처음 보일 때 만든다) · 다음에 글자를 고칠 시각 · 설정 */
  private chip: PerfChip | null = null;
  private chipAt = 0;
  private chipWanted = false;
  /** 칩 글자 길이 (바뀌면 화면 밖 화살표가 피할 사각형을 다시 잰다) */
  private chipLen = -1;
  private readonly chipWin: FrameWindow = { fps: 0, intervalAvg: 0, workP95: 0, frames: 0, late: 0 };
  /** FPS 칩 사각형 (논리 px, 화면 밖 화살표가 피한다). 칩이 없거나 숨었으면 null */
  private chipAvoid: { x: number; y: number; w: number; h: number } | null = null;
  /** 창 크기가 바뀌어 메뉴 버튼 · 칩 자리를 다시 놓아야 한다 */
  private buttonDirty = true;
  private chipDirty = true;
  /** ?debug=1 칩 (터치 기기에서 FPS 칩과 같은 구석이면 칩이 그 아래로) */
  private debugChip: HTMLElement | null = null;
  /** 지도 크게 보기 (처음 열 때 만든다) · 열렸는가 · 이 판에서 연 횟수 */
  private minimapBig: Minimap | null = null;
  private bigOpen = false;
  private bigOpens = 0;

  /**
   * 미니맵 자리: 엄지 버튼이 덮지 않으면 처음 자리. 덮으면 확대 화면에서는 맵 창 안 빈 구석으로 옮기고(미니맵이 필수, 검토 반영),
   * 옮길 자리가 없거나 확대 1이면 예전처럼 숨긴다(M12 — 판 화면 전체가 보여 같은 정보)
   */
  private placeMinimap(): void {
    const mm = this.minimap;
    if (!this.minimapCovered) {
      mm.relocate(null);
      mm.setHidden(false);
      return;
    }
    const size = mm.frameSize;
    const L = HUD.touch?.L ?? 1;
    const spot =
      CAM_ZOOM > 1 && size
        ? minimapFallback(MAP_RECT, size, this.thumbBoxes, MINIMAP_INSET.margin * L, MIN_GAP * L)
        : null;
    mm.relocate(spot);
    mm.setHidden(spot === null);
  }

  /** 조준 붙잡기 기준 카메라 가운데 (타일 → 월드 px, 입력 틱마다 다시 쓴다) */
  private readonly aimAnchorTile = { x: 0, y: 0 };
  /** 따라가는 카메라 (판 장면마다 새로) · 창 밖 가리개 · 잘라 옮김 어두워짐 */
  private director: CameraDirector | null = null;
  private frameCovers: Phaser.GameObjects.GameObject[] = [];
  /** 창 밖에 통째로 있어 이번 프레임 그리지 않는 월드 그림 (cameraFilter로 거른다 — visible · 게임 상태는 그대로) */
  private readonly culled = new Set<Phaser.GameObjects.GameObject>();
  /**
   * getBounds 결과 그릇. 배포 빌드의 Phaser 사용자 빌드(phaserCore.js)에는 Phaser.Geom이 없어 Rectangle을 만들 수 없다 →
   * 평범한 객체를 쓴다. getBounds는 그릇의 x · y · width · height만 읽고 쓴다(GetBounds.js) — 타입만 맞추려는 변환이다
   */
  private readonly cullRect = {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  } as unknown as Phaser.Geom.Rectangle;
  private dipCover: Phaser.GameObjects.Rectangle | null = null;
  /** 괴물: 예측한 돌진을 누른 마지막 시각 (입력 틱, 돌진 잔상 격자의 시작) */
  private localDashAt: number | null = null;
  /** 지난 프레임의 렌더 시각 (보간 경로 조각 · 상태 경계를 잴 구간 시작) */
  private lastRenderTime: number | null = null;
  /** 이번 프레임 구간 (motion이 읽는다): 렌더 시각 r0 → r1, 이 기기 시각 prevNow(지난 프레임, 없으면 null) → now */
  private motionSpan: { r0: number; r1: number; prevNow: number | null; now: number } = {
    r0: 0,
    r1: 0,
    prevNow: null,
    now: 0,
  };
  /**
   * 내 캐릭터 걷기 기록 (입력 틱 · 스냅샷 보정마다, 시각 순서, 최근 16개 — anim SelfStep). 걷기 판단은 입력 틱에 예측 상태가
   * 움직였는가로 한다: 스냅샷 보정 순간(보낸 입력을 서버가 모두 처리함) 그린 자리가 다음 틱까지 멈추는데, 그린 자리의
   * 프레임 사이 거리로 재면 120fps는 그 사이 프레임을 '멈춤'으로 보고 60fps는 보지 못해 걷기 자세가 fps마다 달랐다
   */
  private readonly selfSteps: SelfStep[] = [];
  /** 보간 엔티티의 프레임 사이 경로 · 상태 경계 (월드 렌더러가 걷기 · 바뀐 순간을 잰다) */
  private readonly motion: MotionSource = {
    travel: (kind: 'survivor' | 'monster', id: string, out: TravelPiece[]): number => {
      const span = this.motionSpan;
      return this.interpOf(kind).travel(id, span.r0, span.r1, out);
    },
    edgeAt: (kind: 'survivor' | 'monster', id: string): number | null => {
      const span = this.motionSpan;
      const r = this.interpOf(kind).edgeAt(id, span.r0, span.r1);
      return r === null ? null : span.now - (span.r1 - r);
    },
    selfTravel: (out: TravelPiece[]): number => {
      const { prevNow, now } = this.motionSpan;
      return prevNow === null ? -1 : selfPieces(this.selfSteps, prevNow, now, out);
    },
  };
  drawn: DrawnEntity[] = [];
  /** 마지막으로 보낸 입력 (디버그) */
  lastFrame: InputFrame | null = null;
  private unsubscribe: (() => void) | null = null;
  /** 포효 핑 (괴물 화면) */
  private roarPings: { x: number; y: number; until: number; start: number }[] = [];
  /** 마지막으로 그린 내 위치 (예측) */
  localPos = { x: 0, y: 0, face: 0 };
  /** 피격 플래시 · 수감 페이드 · 기절 채도 감소 */
  private screenFx!: ScreenEffects;
  /** 괴물: 서버 확인 전에 먼저 보여 주는 공격 준비 */
  private localWindup: LocalWindup | null = null;
  /** 판 중 FPS 감시를 하는가 (세션 상태는 sessionAutoDowngrade: 느리면 한 단계 내리고 효과를 확인한다) */
  private watchingFps = false;
  /** 적응형 품질 입력 (프레임마다 새로 만들지 않는다). 최근 1초 측정은 ADAPT_WINDOW_EVERY_MS마다 다시 낸다 */
  private readonly adaptSample: FrameSample = { fps: 0, workP95: 0, late: 0 };
  private readonly adaptCtx: AdaptContext = { targetHz: 60, displayHz: 60, canRateFallback: false };
  private readonly adaptWindow: FrameWindow = { fps: 0, intervalAvg: 0, workP95: 0, frames: 0, late: 0 };
  /** 늦은 프레임 기준: 목표 주기 + 반 vsync (적응형 목표 FPS의 고르지 않은 프레임, PACING_WATCH) */
  private readonly adaptLate = { periodMs: 1000 / 60, slackMs: 1000 / 120 };
  private nextAdaptWindowAt = 0;
  /** 지금 처리하는 스냅샷이 서버에서 만들어진 뒤 지난 시간 (ms, 진동: 오래된 일은 울리지 않는다) */
  private eventAgeMs = 0;
  /** 터치 화면에 넘기는 값 (프레임마다 새로 만들지 않는다) */
  private readonly touchView: TouchView = { slots: [] };
  /** 괴물 재접속 대기 줄 (남은 초가 바뀔 때만 새로) */
  private pausedMemo: { sec: number; line: BannerLine } | null = null;
  /** 미니맵: 팀원 id → 역할 (이 판 명단. 프레임마다 · 엔티티마다 닫힘 함수를 만들지 않는다) */
  private readonly roleOf = (id: string): Role | null => {
    for (const r of this.app.match?.roster ?? []) if (r.id === id) return r.role;
    return null;
  };

  constructor() {
    super('game');
  }

  init(data: { app: App }): void {
    this.app = data.app;
    this.seq = 0;
    this.acc = 0;
  }

  /** 미니맵을 맵 창 안에 두었는가 (디버그 · 시험) */
  get minimapInset(): boolean {
    return (this.minimap?.insetRect ?? null) !== null;
  }

  get minimapDrawn(): DrawnEntity[] {
    return this.minimap?.drawn ?? [];
  }

  /** 디버그 · 시험: 크게 본 지도에 그린 엔티티 (닫혀 있으면 빈 목록) */
  get minimapBigDrawn(): DrawnEntity[] {
    return this.bigOpen ? (this.minimapBig?.drawn ?? []) : [];
  }

  /** 디버그 · 시험: 판 중 설정 효과 (메뉴 상태는 debug.ts가 더한다) */
  get matchPrefsDebug(): Omit<MatchPrefsDebug, 'menu'> {
    const r = this.game.canvas.getBoundingClientRect();
    const k = r.height > 0 ? r.height / VIEW_H : 0;
    const r1 = (v: number): number => Math.round(v * 10) / 10;
    const box = (b: { x: number; y: number; w: number; h: number }) => ({
      x: r1(r.left + b.x * k),
      y: r1(r.top + b.y * k),
      w: r1(b.w * k),
      h: r1(b.h * k),
    });
    const el = (e: HTMLElement) => {
      const b = e.getBoundingClientRect();
      return { x: r1(b.left), y: r1(b.top), w: r1(b.width), h: r1(b.height) };
    };
    const tap = CAM_ZOOM > 1 ? (this.minimap?.frameRect ?? null) : null;
    const big = this.minimapBig;
    const open = this.bigOpen && big !== null;
    return {
      shakeScale: this.director?.shake.scale ?? 1,
      shakeOffset: this.director?.shakeNow ?? 0,
      reduceFlash: this.flashReduced,
      spottedAlpha: this.spottedAlphaNow,
      inputSuspended: this.sampler.isSuspended,
      menuButton: this.menuButton ? { ...el(this.menuButton.el), visible: this.menuButton.shown } : null,
      perfChip: this.chip ? { ...el(this.chip.el), visible: this.chip.shown, text: this.chip.textNow } : null,
      perfChipAvoid: this.chipAvoid ? { ...this.chipAvoid } : null,
      minimapTap: tap ? box(tap) : null,
      minimapBig: {
        open,
        frame: open ? big.frameRect : null,
        frames: open ? big.drawnFrames : [],
        opens: this.bigOpens,
        bakes: big?.bakes ?? 0,
        smallBakes: this.minimap?.bakes ?? 0,
      },
    };
  }

  get bannerTexts(): string[] {
    return this.banners?.visible ?? [];
  }

  /** 디버그 · 테스트: 이번 프레임의 정보 레이어 (품질과 상관없이 같아야 함) */
  get infoLayer(): InfoItem[] {
    return this.world?.info ?? [];
  }

  /**
   * 디버그 · 테스트: 후처리가 걸린 레이어. 장면 표시 목록 · 카메라에서 직접 모은다(자기 신고 아님):
   * 월드 렌더러가 아는 객체는 그 레이어, 화면 효과 · 발각 테두리는 screen, 나머지는 hud
   */
  get fxTargets(): FxTarget[] {
    const world = this.world;
    if (!world) return [];
    return collectFxTargets(
      this,
      (o) => world.layerOf(o) ?? (this.spottedEdge?.owns(o) || this.screenFx?.owns(o) ? 'screen' : null),
    );
  }

  /**
   * 디버그 · 테스트: HUD 상태 (M10c). 다시 굽기 횟수(`bakes`) · 거점 게이지 상태 · 점수판 · 조작 안내 표시 등.
   * 키와 값은 HUD가 정한다(VISUAL_SPEC 8장)
   */
  get hudDebug(): Record<string, number | boolean | string> {
    if (!this.hud) return {};
    const hudGraphics = this.children.list.filter(
      (o) => o instanceof Phaser.GameObjects.Graphics && o.depth >= 38 && !this.screenFx.owns(o),
    ).length;
    // 늘 떠 있는 HUD(미니맵 39~41 · HUD 40~42)에 실제로 그려진 그림 · 글자의 자리 (논리 px). 부품이 스스로 신고한
    // 배치 값이 아니라 표시 목록에서 직접 잰다 (E2E: 맵 사각형과 겹치지 않음)
    const r1 = (v: number): number => Math.round(v * 10) / 10;
    const drawn: [number, number, number, number][] = [];
    for (const o of this.children.list) {
      if (!(o instanceof Phaser.GameObjects.Image || o instanceof Phaser.GameObjects.Text)) continue;
      if (!o.visible || o.alpha === 0 || o.depth < 39 || o.depth >= 43 || this.screenFx.owns(o)) continue;
      const b = o.getBounds();
      if (b.width > 0 && b.height > 0) drawn.push([r1(b.x), r1(b.y), r1(b.width), r1(b.height)]);
    }
    return {
      bakes: this.kit.bakes,
      ...this.hud.debug(),
      scoreboard: this.scoreboard.visible,
      scoreText: this.scoreboard.text,
      help: this.tutorial?.visible ?? false,
      spotted: this.spottedEdge.shown,
      hudGraphics,
      panels: JSON.stringify(drawn),
      missingFrames: [...this.kit.missing].sort().join(','),
    };
  }

  /**
   * 디버그 · 테스트: 보이는 HUD 글자 · 그림 (M12 getHudLayout, 논리 px). 깊이 39 이상(미니맵 · HUD · 배너 · 안내 · 점수판)에서
   * 화면 효과 · 발각 테두리 · 선명도 탐침을 뺀다. 글자 크기 = 글꼴 px × 세로 배율. 표시 목록에서 직접 잰다(자기 신고 아님)
   */
  get hudItems(): HudLayoutItem[] {
    const items: HudLayoutItem[] = [];
    if (!this.hud) return items;
    const r1 = (v: number): number => Math.round(v * 10) / 10;
    let n = 0;
    for (const o of this.children.list) {
      const text = o instanceof Phaser.GameObjects.Text;
      if (!(text || o instanceof Phaser.GameObjects.Image)) continue;
      if (!o.visible || o.alpha === 0 || o.depth < 39 || o.depth >= PROBE_DEPTH) continue;
      if (this.screenFx.owns(o) || this.spottedEdge.owns(o)) continue;
      // 빈 글자는 아무것도 그리지 않는다
      if (text && o.text === '') continue;
      const b = o.getBounds();
      if (b.width <= 0 || b.height <= 0) continue;
      n += 1;
      const item: HudLayoutItem = {
        id: o.name || `${text ? 'text' : 'image'}${n}`,
        kind: text ? 'text' : 'image',
        x: r1(b.x),
        y: r1(b.y),
        w: r1(b.width),
        h: r1(b.height),
      };
      if (text) {
        item.fontPx = r1(parseFloat(String(o.style.fontSize)) * Math.abs(o.scaleY));
        item.text = o.text;
      }
      items.push(item);
    }
    return items;
  }

  /** 디버그 · 테스트: 최근 입력 프레임 120개, 오래된 것부터 (pressed는 한 프레임만 살아 lastFrame으로는 놓친다) */
  get inputLog(): InputLogEntry[] {
    return this.inputHistory.entries();
  }

  /** 디버그 · 테스트: 지금 입력 방식 (터치 화면이 있으면 'touch') */
  get inputMode(): 'keyboard' | 'touch' {
    return this.sampler.mode;
  }

  /** 디버그 · 테스트: 지금 보이는 연출 */
  get effects(): Record<string, number | boolean> {
    if (!this.screenFx || !this.world) return {};
    return { ...this.screenFx.state, ...this.world.fx };
  }

  create(): void {
    const app = this.app;
    const info = app.match;
    const balance = app.balance;
    if (!info || !balance) return;
    this.cameras.main.setBackgroundColor(COLOR.background);
    fitCamera(this.cameras.main);
    // 지난 판의 창이 남아 있으면 첫 스냅샷 전까지 A · B 글자 · 조준이 엉뚱한 자리를 본다: 월드와 같은 (0, 0)에서 시작
    CAM.x = 0;
    CAM.y = 0;
    this.world = new WorldRenderer(this, FOG_ENABLED);
    this.shakeOverride = null;
    this.makeCameraFrame();
    this.aimHold.reset();
    this.myBlend = 0;
    this.blendRamp = null;
    this.renderedFrames = 0;
    this.localDashAt = null;
    this.selfSteps.length = 0;
    // 보간 경로 조각 · 내 걷기 기록 · 시야 모드 보간은 판 장면을 만든 순간부터 잰다: 첫 프레임 시각은 fps마다 다르다
    // (판 장면은 판 시작 메시지를 받은 순간에 만들고 첫 그리기는 다음 프레임이다)
    const createdAt = performance.now();
    this.lastRenderTime = app.renderTime();
    this.motionSpan.now = createdAt;
    this.motionSpan.prevNow = null;
    if (app.lastSnap) this.noteBlend(app.lastSnap, createdAt);
    this.kit = new HudKit(this);
    this.hud = new Hud(this.kit, info, balance, device.touch);
    this.minimap = new Minimap(this, this.kit, info.role === 'monster');
    this.edges = CAM_ZOOM > 1 ? new EdgeMarkers(this.kit) : null;
    this.thumbBoxes = [];
    this.banners = new Banners(this.kit);
    // 첫 판 조작 안내는 키보드 · 마우스용이라 터치 모드에서는 만들지 않는다 (터치는 판 직전 안내 + 판 중 위치 표시, M12)
    this.tutorial = info.firstMatch && !device.touch ? new TutorialOverlay(this.kit, info) : null;
    this.scoreboard = new Scoreboard(this.kit, info, balance, device.touch);
    this.screenFx = new ScreenEffects(this, this.world.stunVeil);
    // 판 중 설정 효과: 번쩍임 줄이기 · FPS 칩 (설정이 바뀌면 판 중에도 바로 — onPref)
    this.applyFlash();
    this.chipWanted = pref('perfChip');
    this.localWindup = null;
    this.spottedEdge = this.kit.slice(38);
    this.spottedEdge.hollow = true;
    this.spottedEdge.set('spot', 0, 0, VIEW_W, VIEW_H).show(false);
    // 선명도 검사 글자는 판 동안 이 장면(HUD와 같은 곳)에 그린다. 장면이 끝나면 대기 장면 것으로 돌려놓는다
    const prevProbe = probeSlot.draw;
    probeSlot.draw = (text, x, y, px) => drawProbeText(this, text, x, y, px);
    // 판 중 측정은 온라인 · 연습을 따로 재고 기억한다 (기기 안 시뮬레이션이 CPU를 더 쓴다, 검토 반영 F11).
    // 시작 품질은 main.ts가 판 장면을 만들기 전에 같은 모드로 정했다(enterPerfMode)
    sessionAutoDowngrade.beginMatch(performance.now(), app.practicing ? 'practice' : 'online');
    this.watchingFps = true;

    // 판 시작 문구 (괴물 대기 5초 동안)
    const intro = info.role === 'monster' ? 'INTRO_MONSTER' : 'INTRO_WALL';
    this.banners.pushNote(formatText(intro), STORY_TEXT[intro].seconds ?? 3);
    this.tutorial?.show(performance.now(), TUTORIAL_SECONDS);

    const host = this.game.canvas.parentElement ?? document.body;
    this.uiRoot = document.getElementById('ui-root') ?? document.body;
    // 터치 모드: 터치 상태 기계를 입력 소스로 붙이고 터치 화면을 만든다. PC에서는 터치 레이어를 만들지 않는다
    this.inputHistory.clear();
    this.touch = device.touch ? new TouchInput() : null;
    this.touchActive = null;
    this.sampler.attach(host, {
      touch: this.touch,
      touchAim: info.role === 'monster',
      aimSurface: this.game.canvas,
    });
    if (this.touch) {
      const uiRoot = this.uiRoot;
      // 판 HUD 자리 (논리 px): 터치 화면이 이동 영역을 그 아래에서 시작한다. 캔버스 자리는 창 크기가 바뀔 때마다 다시 잰다.
      // 판 중 창이 낮아져 엄지 버튼이 미니맵을 덮으면 미니맵을 숨기고, 크기가 돌아오면 다시 보인다 (M12 검토)
      const plan = HUD.touch ? (info.role === 'monster' ? HUD.touch.monster : HUD.touch.survivor) : null;
      const canvas = this.game.canvas;
      this.touchControls = new TouchControls(uiRoot, {
        role: info.role,
        feed: this.touch,
        // 오른쪽 위 시스템 버튼 '설정': 판 중 설정 (판은 멈추지 않는다)
        onMenu: () => this.openMenu(),
        hud: {
          rects: plan?.rects ?? [],
          canvas: () => {
            const r = canvas.getBoundingClientRect();
            return r.height > 0 ? { left: r.left, top: r.top, k: r.height / VIEW_H } : null;
          },
          onCovered: (ids) => {
            this.minimapCovered = ids.has('minimap');
            this.placeMinimap();
          },
          onThumbs: (boxes) => {
            this.thumbBoxes = boxes;
            this.placeMinimap();
          },
        },
      });
      // 판 직전 터치 안내를 본 판이면 처음 10초 동안 스틱 · 버튼 자리를 보인다 (입력을 막지 않는다)
      if (takeTouchHints()) this.touchControls.showHints(TOUCH_HINT_MS);
    }
    // 관전 카드 고르기: 창 단위 캡처로 받아 캔버스 논리 좌표의 팀 카드 사각형과 맞춘다 (카드는 캔버스 그림이라 DOM 터치 대상이
    // 아니다 — 수감 중에도 켜져 있는 터치 이동 영역이 손가락을 먼저 붙잡지 않게 맞으면 전파를 멈춘다)
    this.cardPick = null;
    // 같은 캡처에서 지도 누르기(크게 보기)도 받는다 (지도도 캔버스 그림이다)
    const onPointer = (e: PointerEvent): void => this.onPointerCapture(e);
    window.addEventListener('pointerdown', onPointer, true);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () =>
      window.removeEventListener('pointerdown', onPointer, true),
    );
    this.setupMatchPrefs();
    this.roarPings = [];
    // 'match' 뒤 이 장면이 생기기 전(판 시작 대기 · 세로 안내 · 다시 들어온 판의 장면 재시작)에 온 거점 메모를 다시 보인다.
    // 장면이 생긴 뒤의 메모는 아래 구독이 받는다 (M12 검토: 재접속 때 서버가 남겨 보낸 메모가 터치에서 사라지던 것)
    for (const ev of app.matchNotes) this.onEvent(ev);
    this.unsubscribe = app.subscribe((e) => {
      if (e.kind !== 'snapshot') return;
      if (this.seq < e.snap.ack) this.seq = e.snap.ack;
      // 오래된 스냅샷의 일회성 연출(소리 · 플래시 · 알림 배너 · 핑)은 건너뛴다(staleEvents.ts). 거점 메모(비밀번호)는 오래돼도 보여 준다
      const age = app.link.synced ? Math.max(0, app.link.serverNow() - e.snap.st) : 0;
      const stale = app.link.synced && age > staleEventLimitMs(this.frameMs);
      this.eventAgeMs = age;
      // 괴물 시야 모드 보간 · 내 걷기 기록은 받은 순간부터 잰다
      this.noteBlend(e.snap, performance.now());
      this.noteSelfReconcile(performance.now());
      // 진동 (터치 기기): 발각 꺼짐 → 켜짐 전환만 울린다(판단은 haptics, 지난 일은 그 시간으로 거른다)
      if (device.touch) haptics.spotted(e.snap.you.surv?.spotted === true, age);
      for (const ev of e.snap.events) {
        if (!stale || isKeptNote(ev)) this.onEvent(ev);
      }
      const now = performance.now();
      this.roarPings = this.roarPings.filter((p) => p.until > now);
    });
    // 입력 샘플링은 렌더 프레임과 따로 타이머로 돈다 (그리기가 느려도 조작 주기는 1/30초 유지).
    // 다음 1/30초 경계에 맞춰 깨어난다(M12: 4ms 간격 반복은 초당 250번 깨어나 휴대폰 메인 스레드의 약 14%를 썼다)
    this.lastInputAt = performance.now();
    this.scheduleInput();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      probeSlot.draw = prevProbe;
      this.watchingFps = false;
      sessionAutoDowngrade.endMatch();
      if (this.inputTimer !== null) window.clearTimeout(this.inputTimer);
      this.inputTimer = null;
      this.sampler.detach();
      this.touchControls?.destroy();
      this.touchControls = null;
      this.touch = null;
      this.unsubscribe?.();
    });
  }

  /**
   * 따라가는 카메라: 감독 · 창 밖 가리개(맵 사각형 둘레 네 장, 월드 위 · HUD 아래 — 확대한 월드가 HUD 띠 · 여백으로 비치지
   * 않게) · 잘라 옮김 어두워짐(맵 사각형). 확대 1(맵 전체)이면 가리개가 필요 없다
   */
  private makeCameraFrame(): void {
    this.director = new CameraDirector(VIEW_TILES_W, VIEW_TILES_H);
    // 흔들림 세기: 동작 줄이기(OS 설정) 또는 '흔들림 줄이기' 설정이면 0 (prefs.shakeScaleOf, 판 중에 바꾸면 onPref)
    let reduce = false;
    try {
      reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
      reduce = false;
    }
    this.osReduceMotion = reduce;
    this.applyShake();
    this.frameCovers = [];
    this.dipCover = null;
    if (CAM_ZOOM <= 1) return;
    const m = MAP_RECT;
    const W = VIEW_W;
    const H = VIEW_H;
    const rects: [number, number, number, number][] = [
      [0, 0, W, m.y],
      [0, m.y + m.h, W, H - m.y - m.h],
      [0, m.y, m.x, m.h],
      [m.x + m.w, m.y, W - m.x - m.w, m.h],
    ];
    // 가리개 넷을 Graphics 하나로 (사각형 넷이면 프레임마다 save · setTransform · restore가 넷이다 — 같은 화소)
    const g = this.add.graphics().setDepth(37);
    g.fillStyle(UI.background, 1);
    for (const [x, y, w, h] of rects) {
      if (w <= 0 || h <= 0) continue;
      // 가장자리 반 픽셀 비침이 없게 1px 겹친다
      g.fillRect(x - 0.5, y - 0.5, w + 1, h + 1);
    }
    this.frameCovers.push(g);
    this.dipCover = this.add
      .rectangle(m.x, m.y, m.w, m.h, 0x000000)
      .setOrigin(0, 0)
      .setDepth(36)
      .setAlpha(0)
      .setVisible(false);
  }

  /**
   * 창 밖 컬링 (성능, 확대 화면만): 월드 그림(깊이 36 아래의 Image · Sprite · Text) 가운데 맵 창 밖(가리개 밑 · 캔버스 밖)에
   * 통째로 있는 것은 이번 프레임 그리지 않는다. visible은 건드리지 않고 카메라 거르기(cameraFilter)만 쓴다 — 캐릭터 · 정보 코드가
   * 정하는 보이기 상태와 디버그 목록은 그대로다. 지난 프레임에 거른 것은 먼저 되돌린다(깊이 · 부모가 바뀌어도 숨은 채로 남지 않게).
   * 가리개가 불투명이라 같은 화소다 (render/camera.ts cullable)
   */
  private cullWorld(): void {
    for (const o of this.culled) o.cameraFilter = 0;
    this.culled.clear();
    if (CAM_ZOOM <= 1) return;
    const cam = this.cameras.main;
    const z = gfxState.zoom > 0 ? gfxState.zoom : 1;
    const pad = Math.max(1, 0.5 + 1 / z);
    const view = {
      viewW: VIEW_W,
      viewH: VIEW_H,
      canvasW: this.game.canvas.width / z,
      canvasH: this.game.canvas.height / z,
    };
    const r = this.cullRect;
    const visit = (o: Phaser.GameObjects.GameObject): void => {
      if (o instanceof Phaser.GameObjects.Container) {
        if (o.visible) for (const c of o.list) visit(c);
        return;
      }
      if (
        !(o instanceof Phaser.GameObjects.Image) &&
        !(o instanceof Phaser.GameObjects.Sprite) &&
        !(o instanceof Phaser.GameObjects.Text)
      )
        return;
      if (!o.visible) return;
      o.getBounds(r);
      if (cullable(r, MAP_RECT, pad, view)) {
        o.cameraFilter = cam.id;
        this.culled.add(o);
      }
    };
    for (const o of this.children.list) {
      const d = (o as Phaser.GameObjects.GameObject & { depth?: number }).depth ?? 0;
      if (d < 36) visit(o);
    }
    gfxState.features.culledObjects = this.culled.size;
  }

  /**
   * 흔들림 세기 배율 (디버그 · 시험의 픽셀 탐침, '흔들림 줄이기'와 같은 값). 덮어쓴 값은 '흔들림 줄이기' 설정이 바뀔 때까지 이긴다
   */
  setShakeScale(scale: number): void {
    this.shakeOverride = Math.max(0, scale);
    this.applyShake();
  }

  /** 흔들림 세기 = 시험 덮어쓰기 ?? (흔들림 줄이기 · OS 동작 줄이기면 0, 아니면 1) */
  private applyShake(): void {
    if (this.director) this.director.shake.scale = this.shakeOverride ?? shakeScaleOf(this.osReduceMotion);
  }

  /** 번쩍임 줄이기를 판 화면에 건다 (피격 테두리 · 잘라 옮김 어두워짐 · 발각 테두리) */
  private applyFlash(): void {
    const on = pref('reduceFlash');
    this.flashReduced = on;
    if (this.screenFx) this.screenFx.reduceFlash = on;
    if (this.director) this.director.noDip = on;
  }

  /** 설정이 바뀌었다 (설정 화면, 판 중에도 바로 — 판은 멈추지 않는다) */
  private onPref(key: PrefKey | null): void {
    if (key === null || key === 'reduceShake') {
      this.shakeOverride = null;
      this.applyShake();
    }
    if (key === null || key === 'reduceFlash') this.applyFlash();
    if (key === null || key === 'perfChip') {
      this.chipWanted = pref('perfChip');
      this.chipAt = 0;
      this.chipDirty = true;
      if (!this.chipWanted) {
        this.chip?.show(false);
        this.chipAvoid = null;
      }
    }
  }

  /**
   * 판 중 설정 효과 준비 (create 끝): 설정 구독 · PC 메뉴 버튼 · Esc · 창 크기 변화(메뉴 버튼 · 칩 자리). 장면이 끝나면 모두 걷는다
   */
  private setupMatchPrefs(): void {
    this.menuOpen = false;
    this.bigOpen = false;
    this.bigOpens = 0;
    this.minimapBig = null;
    this.chip = null;
    this.chipAt = 0;
    this.chipLen = -1;
    this.chipAvoid = null;
    this.buttonDirty = true;
    this.chipDirty = true;
    this.spottedAlphaNow = 0;
    this.debugChip = document.querySelector<HTMLElement>('#debug-overlay .dbg-chip');
    this.menuButton = device.touch ? null : new MatchMenuButton(this.uiRoot, () => this.openMenu());
    const offPrefs = onPrefsChange((key) => this.onPref(key));
    const onKey = (e: KeyboardEvent): void => this.onMenuKey(e);
    // 창 거품 단계(맨 마지막): 설정 화면이 제 안에서 Esc를 처리했으면(기본 동작을 막고 전파를 멈춤) 여기 오지 않거나 defaultPrevented다
    window.addEventListener('keydown', onKey);
    const onResize = (): void => {
      this.buttonDirty = true;
      this.chipDirty = true;
    };
    window.addEventListener('resize', onResize);
    this.scale.on('resize', onResize);
    const offGfx = onGfxChange(onResize);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      offPrefs();
      offGfx();
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
      this.scale.off('resize', onResize);
      this.menuButton?.destroy();
      this.menuButton = null;
      this.chip?.destroy();
      this.chip = null;
      this.closeBigMap();
      this.minimapBig?.destroy();
      this.minimapBig = null;
      this.menuOpen = false;
    });
  }

  /** 판 중 설정을 연다 (PC 메뉴 버튼 · 터치 '설정' 버튼). 연결점이 없거나(설정 화면 전) 판이 끝났으면 아무것도 하지 않는다 */
  private openMenu(): void {
    if (!matchMenu.open || this.app.result !== null) return;
    this.closeBigMap();
    sfx.ui('open');
    matchMenu.open();
    this.syncMenu();
  }

  /**
   * Esc (창 keydown, 거품 단계): 크게 본 지도가 열려 있으면 닫고, 아니면 판 중 설정을 열고 닫는다. 설정 화면이 제 안에서 이미 처리한
   * Esc(defaultPrevented)는 건드리지 않는다 — 한 번 눌러 닫힌 설정이 다시 열리지 않게. 쓴 Esc는 기본 동작을 막고 여기서 멈춘다.
   * 판이 끝났거나 연결점이 없으면 건드리지 않는다
   */
  private onMenuKey(e: KeyboardEvent): void {
    if (e.code !== 'Escape' && e.key !== 'Escape') return;
    if (e.defaultPrevented || this.app.result !== null) return;
    // 다른 대화상자(나가기 확인 등) 안에서 누른 Esc는 그 대화상자의 것이다
    if (e.target instanceof Element && e.target.closest('[aria-modal="true"]') && !matchMenu.isOpen()) return;
    if (this.bigOpen) {
      this.closeBigMap();
    } else {
      if (!matchMenu.open) return;
      if (!e.repeat) {
        sfx.ui(matchMenu.isOpen() ? 'close' : 'open');
        toggleMatchMenu();
        this.syncMenu();
      }
    }
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  /**
   * 판 중 메뉴가 열려 있는지 따라간다 (입력 틱 · 프레임 처음): 열리면 키 · 마우스 · 터치 입력을 멈추고 누르던 것을 뗀다(InputSampler.suspend),
   * 크게 본 지도를 닫는다. 닫히면 다시 받는다. 판 · 그리기는 그대로 흐른다
   */
  private syncMenu(): void {
    const open = matchMenu.isOpen();
    if (open === this.menuOpen) return;
    this.menuOpen = open;
    this.sampler.suspend(open);
    this.aimHold.reset();
    if (open) this.closeBigMap();
  }

  /** 화면 좌표 (창 CSS px) → 논리 px (캔버스 사각형 기준) */
  private toLogical(clientX: number, clientY: number): { x: number; y: number } | null {
    const r = this.game.canvas.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    return { x: ((clientX - r.left) / r.width) * VIEW_W, y: ((clientY - r.top) / r.height) * VIEW_H };
  }

  /** 팀 카드 i의 판정 사각형 (논리 px, 칸 사이 빈틈이 없게 간격의 반씩 넓힌다) */
  private cardHitRect(i: number): { x: number; y: number; w: number; h: number } | null {
    const c = this.hud.cardRect(i);
    if (!c) return null;
    const g = this.hud.cardGap / 2;
    return { x: c.x - g, y: c.y - g, w: c.w + g * 2, h: c.h + g * 2 };
  }

  /**
   * 창 단위 pointerdown 캡처: 판 중 설정 화면을 누른 것은 보지 않는다. 크게 본 지도가 열려 있으면 어디를 눌러도 닫는다(캔버스를 누른 것은
   * 닫기로만 — 공격 · 시야 전환 · 카드 고르기로 가지 않는다. DOM 버튼은 제 일도 한다). 아니면 관전 카드 · 지도(크게 보기)
   */
  private onPointerCapture(e: PointerEvent): void {
    if (this.menuOpen || matchMenu.isOpen()) return;
    if (this.bigOpen) {
      this.closeBigMap();
      if (e.target === this.game.canvas) e.stopPropagation();
      return;
    }
    if (this.onCardDown(e)) return;
    this.onMinimapDown(e);
  }

  /** 관전 카드 고르기 (창 단위 pointerdown 캡처). 골랐으면 true */
  private onCardDown(e: PointerEvent): boolean {
    if (CAM_ZOOM <= 1 || !this.director?.canSpectate) return false;
    // 점수판이 열려 있으면 닫기 동작이 먼저 (터치 점수판 버튼 · Tab)
    if (this.sampler.tabHeld || (this.touchControls?.scoreboard ?? false)) return false;
    if (e.pointerType === 'mouse' && e.button !== 0) return false;
    const p = this.toLogical(e.clientX, e.clientY);
    if (!p) return false;
    for (let i = 0; i < 3; i += 1) {
      const c = this.cardHitRect(i);
      if (!c || p.x < c.x || p.x > c.x + c.w || p.y < c.y || p.y > c.y + c.h) continue;
      this.cardPick = i;
      e.stopPropagation();
      return true;
    }
    return false;
  }

  /**
   * 지도 누르기 → 크게 보기 (확대 화면만: 확대 1이면 판 화면에 맵 전체가 보인다). 캔버스 위 누르기만 — 지도 위에 터치 버튼(DOM)이
   * 겹쳐 있으면 그 버튼이 받는다. 점수판이 열려 있으면 닫기가 먼저
   */
  private onMinimapDown(e: PointerEvent): void {
    if (CAM_ZOOM <= 1 || e.target !== this.game.canvas || this.app.result !== null) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (this.sampler.tabHeld || (this.touchControls?.scoreboard ?? false)) return;
    const r = this.minimap.frameRect;
    if (!r || !this.minimap.shown) return;
    const p = this.toLogical(e.clientX, e.clientY);
    if (!p || p.x < r.x || p.x > r.x + r.w || p.y < r.y || p.y > r.y + r.h) return;
    if (this.openBigMap()) e.stopPropagation();
  }

  /**
   * 지도 크게 보기를 연다: 처음이면 만든다(맵 창 가운데, prefsFx.bigMinimapPlace). 바닥은 지금 합성 그림으로 한 번 — 작은 지도도 같은
   * 그림으로 맞춰 둘이 같은 것을 보인다. 그다음부터는 작은 지도가 다시 그리는 프레임에만 같이 그린다(MINIMAP_BASE_MS 간격 그대로)
   */
  private openBigMap(): boolean {
    if (this.bigOpen || CAM_ZOOM <= 1 || !this.minimap.shown) return false;
    let big = this.minimapBig;
    if (!big) {
      const k = HUD.s;
      const place = bigMinimapPlace(MAP_RECT, HUD.minimap.pad * k, HUD.minimap.title * k, MAP_W / MAP_H);
      big = new Minimap(this, this.kit, this.app.match?.role === 'monster', {
        place,
        caption: HELP_TEXT.minimapClose,
      });
      this.minimapBig = big;
    }
    this.bigOpen = true;
    this.bigOpens += 1;
    big.setHidden(false);
    const base = this.world.baseCanvas;
    this.minimap.refreshBase(base);
    big.refreshBase(base);
    return true;
  }

  /** 크게 본 지도를 닫는다 (숨기기만, 다시 열 때 그대로 쓴다) */
  private closeBigMap(): void {
    if (!this.bigOpen) return;
    this.bigOpen = false;
    this.minimapBig?.setHidden(true);
  }

  /**
   * 크게 본 지도 한 프레임 (작은 지도 바로 뒤): 같은 메인 그림 목록 · 세계 상태 · 보이는 창 · 깜빡임. 바닥은 작은 지도가 이번 프레임에
   * 다시 그렸을 때만(이미 합성된 같은 캔버스). 작은 지도가 숨거나 · 판이 끝나거나 · 메뉴가 열리면 닫는다
   */
  private updateBigMap(
    snap: Snapshot,
    view: { x: number; y: number; w: number; h: number },
    blinkOff: boolean,
    baseNew: boolean,
  ): void {
    if (!this.bigOpen) return;
    const big = this.minimapBig;
    if (!big || !this.minimap.shown || this.app.result !== null || this.menuOpen) {
      this.closeBigMap();
      return;
    }
    if (baseNew) big.refreshBase(this.world.baseCanvas);
    big.setWorld(snap.world.points, snap.world.exits, view, this.director?.spectating ?? null, blinkOff);
    big.update(this.drawn, snap.you.role, this.roleOf);
  }

  /** 캔버스 자리 (창 CSS px의 왼쪽 위 · 논리 1px의 CSS px). 보이지 않으면 null */
  private canvasBox(): { left: number; top: number; k: number } | null {
    const r = this.game.canvas.getBoundingClientRect();
    return r.height > 0 ? { left: r.left, top: r.top, k: r.height / VIEW_H } : null;
  }

  /**
   * 판 중 DOM (프레임 끝, 바뀐 것만 쓴다): PC 메뉴 버튼(판 중 · 연결점이 있을 때, 창 크기가 바뀌면 다시 놓는다) · FPS 칩
   * (초당 2번까지 글자, 설정을 끄면 바로 숨김)
   */
  private updateDom(now: number): void {
    const done = this.app.result !== null;
    const btn = this.menuButton;
    if (btn) {
      const want = !done && matchMenu.open !== null;
      if (want && (this.buttonDirty || !btn.shown)) {
        const c = this.canvasBox();
        if (c) {
          const p = menuButtonPlace(c, HUD_BAND);
          btn.place(p.left, p.top);
          this.buttonDirty = false;
        }
      }
      btn.show(want);
    }
    if (!this.chipWanted || done) {
      if (this.chip?.shown) this.chip.show(false);
      this.chipAvoid = null;
      return;
    }
    if (now < this.chipAt) return;
    this.chipAt = now + PERF_CHIP.updateMs;
    const chip = (this.chip ??= new PerfChip(this.uiRoot));
    // FPS = ?debug=1 오버레이와 같은 측정(최근 1초 렌더 프레임), 핑 = 왕복 시간 (연습 판 · 시계를 맞추기 전이면 모른다)
    const w = sessionFrameStats.window(FPS_WINDOW_MS, this.chipWin);
    const link = this.app.link;
    chip.setText(
      perfChipText(w.frames > 1 ? w.fps : null, link.kind === 'local' || !link.synced ? null : link.rtt),
    );
    const len = chip.textNow.length;
    // 자리: 창 크기가 바뀌었거나 ?debug=1 칩이 있으면(그 칩도 4Hz로 옮겨 간다) 다시 잰다 — 읽기 먼저, 쓰기는 그 뒤
    if (this.chipDirty || this.debugChip !== null || !chip.shown || len !== this.chipLen) {
      const c = this.canvasBox();
      if (c) {
        // 피할 것: ?debug=1 칩, 터치 시스템 버튼 · 맵 창 안 미니맵(좌우 반전이면 맵 왼쪽 위에 온다)
        const avoid: CssRect[] = [];
        if (this.debugChip) avoid.push(this.debugChip.getBoundingClientRect());
        if (this.touchControls)
          for (const b of this.uiRoot.querySelectorAll<HTMLElement>('.tc-sys'))
            avoid.push(b.getBoundingClientRect());
        const inset = this.minimap?.insetRect;
        if (inset)
          avoid.push({
            left: c.left + inset.x * c.k,
            top: c.top + inset.y * c.k,
            width: inset.w * c.k,
            height: inset.h * c.k,
          });
        const p = perfChipPlace(c, MAP_RECT, avoid);
        chip.place(p.left, p.top);
        chip.show(true);
        this.chipDirty = false;
        this.chipLen = len;
        // 화면 밖 화살표가 피할 사각형 (논리 px): 칩 크기는 글자 길이가 바뀔 때 · 자리를 다시 놓을 때만 잰다
        const cw = chip.el.offsetWidth;
        const ch = chip.el.offsetHeight;
        this.chipAvoid = { x: (p.left - c.left) / c.k, y: (p.top - c.top) / c.k, w: cw / c.k, h: ch / c.k };
      }
    }
    chip.show(true);
  }

  /** 숫자 키 · 카드로 고른 동료로 관전을 옮긴다 (내 카드 · 내 번호면 내 시점으로) */
  private applySpectatePick(snap: Snapshot): void {
    const keyPick = this.sampler.takeSpectatePick();
    const pick = this.cardPick ?? keyPick;
    this.cardPick = null;
    const d = this.director;
    if (pick === null || !d || !d.canSpectate) return;
    const id = this.hud.cardIds[pick] ?? null;
    if (id === null) return;
    d.request(id === snap.you.id ? null : id);
  }

  /** 디버그 · 시험: 관전 카드 판정 사각형 (창 CSS px) */
  get spectateCards(): { index: number; id: string | null; x: number; y: number; w: number; h: number }[] {
    const out: { index: number; id: string | null; x: number; y: number; w: number; h: number }[] = [];
    const r = this.game.canvas.getBoundingClientRect();
    if (!this.hud || r.width <= 0) return out;
    const kx = r.width / VIEW_W;
    const ky = r.height / VIEW_H;
    for (let i = 0; i < 3; i += 1) {
      const c = this.hud.cardRect(i);
      if (!c) continue;
      out.push({
        index: i,
        id: this.hud.cardIds[i] ?? null,
        x: r.left + c.x * kx,
        y: r.top + c.y * ky,
        w: c.w * kx,
        h: c.h * ky,
      });
    }
    return out;
  }

  /** 카드 순서 생존자 id (러너 · 가드 · 스카우트, 생존자 화면 명단) */
  private teamOrder(): readonly string[] {
    const roster = this.app.match?.roster ?? [];
    if (this.teamOf === roster) return this.teamIds;
    const order = ['runner', 'guard', 'scout'];
    this.teamOf = roster;
    this.teamIds = [...roster]
      .filter((r) => r.role !== 'monster')
      .sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role))
      .map((r) => r.id);
    return this.teamIds;
  }

  /** 카드 순서 명단 (이 판 명단이 그대로면 다시 만들지 않는다) */
  private teamOf: readonly unknown[] | null = null;
  private teamIds: string[] = [];

  /** 디버그 · 시험: 카메라 상태 */
  get cameraDebug(): CameraDebug | null {
    const d = this.director;
    if (!d) return null;
    const r3 = (v: number): number => Math.round(v * 1000) / 1000;
    return {
      zoom: CAM_ZOOM,
      view: { x: r3(d.view.x), y: r3(d.view.y), w: r3(d.view.w), h: r3(d.view.h) },
      follow: d.follow,
      spectating: d.spectating,
      canSpectate: d.canSpectate,
      look: { x: r3(d.look.x), y: r3(d.look.y) },
      lookApplied: { x: r3(d.lookApplied.x), y: r3(d.lookApplied.y) },
      cuts: d.cuts,
      dip: r3(d.dip(performance.now())),
      shakes: d.shake.active,
      shakeScale: d.shake.scale,
      markers: this.edges?.debug() ?? [],
    };
  }

  /** 서버 이벤트 → 배너 · 메모 · 효과 · 소리 */
  private onEvent(ev: GameEvent): void {
    const now = performance.now();
    const isMonster = this.app.match?.role === 'monster';
    // 월드 연출(불꽃 · 충격파 · 베기 호 등)은 받은 이벤트 좌표에서만 생긴다 (상대 잔여 효과 규칙)
    this.world.onEvent(ev, now);
    switch (ev.k) {
      case 'attackStart': {
        // 괴물 본인은 누른 순간 이미 들었다 (즉시 피드백). 예측하지 못한 경우만 여기서
        const lw = this.localWindup;
        const predicted = isMonster && lw !== null && now - lw.until < 1000;
        if (!predicted) sfx.play('windup', isMonster ? 1 : 0.8);
        return;
      }
      case 'attackHit':
        if (isMonster && ev.hits > 0) {
          sfx.play('hit', 0.7);
          this.director?.shake.add('strike', now);
        }
        return;
      case 'stunned':
        if (isMonster) this.director?.shake.add('stunMe', now);
        return;
      case 'hit':
        if (ev.you) {
          this.director?.shake.add('hitMe', now);
          this.screenFx.hit(now);
          sfx.play('hit', 1);
          if (device.touch) haptics.hit(this.eventAgeMs);
        } else {
          sfx.play('hit', 0.4);
        }
        return;
      case 'imprisoned':
        if (ev.you) this.screenFx.imprison(now);
        return;
      case 'text': {
        if (ev.id === 'ALERT_CAPTURE_START') sfx.play('captureStart');
        else if (ev.id === 'ALERT_CAPTURE_DONE') sfx.play('captureDone');
        else if (ev.id === 'ALERT_EXIT_OPEN') sfx.play('doorOpen');
        else if (ev.id === 'ALERT_ROAR') sfx.play('roar', 0.9);
        if (ev.id === 'ALERT_LAST_30') return; // 지속형 배너로 따로 그린다
        const params = { point: ev.point, exit: ev.exit ? EXIT_NAMES[ev.exit] : undefined, code: ev.code };
        const text = formatText(ev.id, params);
        const sec = STORY_TEXT[ev.id].seconds ?? 2;
        if (ev.id === 'NOTE_FIRST' || ev.id === 'NOTE_SECOND' || ev.id.startsWith('INTRO')) {
          this.banners.pushNote(text, sec);
        } else {
          const look = ALERT_LOOK[ev.id] ?? { tone: 'info', icon: 'point' };
          this.banners.push(text, sec, look.tone, look.icon, now);
        }
        return;
      }
      case 'roarPings': {
        sfx.play('roar');
        this.director?.shake.add('roar', now);
        const dur = (this.app.balance?.monster.roar.revealDuration ?? 1.5) * 1000;
        for (const p of ev.pts) this.roarPings.push({ x: p.x, y: p.y, start: now, until: now + dur });
        return;
      }
      case 'shoveMiss':
        // 터치 모드에는 행동 칸 이름 자리가 없어 경고 배너로 알린다
        if (device.touch) this.banners.push(UI_TEXT.outOfRange, 1, 'warn', 'warn', now);
        else this.hud.flash(UI_TEXT.outOfRange, 1000, now);
        return;
      default:
        return;
    }
  }

  /** 지금 내 마우스 조준 목표 각도 (괴물: 커서 방향, 생존자: NaN) */
  private aimTarget(): number {
    if (this.app.match?.role !== 'monster') return Number.NaN;
    const me = this.app.predictor?.state;
    if (!me) return Number.NaN;
    // 이 판에서 마우스가 캔버스 위에서 움직이거나 판 화면을 누른 적이 없으면 포인터 자리(로비에서 누른 버튼 자리 · 0,0 · 마지막 터치 자리)를
    // 따라 돌지 않는다: 지금 방향 유지 (검토 반영 — 판 시작 조준이 로비 클릭 자리를 향하던 것)
    if (!this.sampler.aimPointerReady || this.menuOpen) {
      this.aimHold.reset();
      return me.face;
    }
    // 손가락 포인터는 조준을 바꾸지 않는다(터치스크린 노트북의 손가락 · 손바닥): 마우스 포인터만
    const p = this.input.mousePointer ?? this.input.activePointer;
    // 조준 = 괴물에서 커서 쪽. 커서가 움직였을 때 커서 월드 자리를 재고(지난 프레임의 창), 그 사이에는 그 자리를 기준 카메라
    // (앞당김 · 따라가기 지연 없이 괴물 가운데, 맵 안으로 자름)를 따라 옮긴 곳을 겨눈다 (aimHold.ts: 앞당김이 조준을 끌지 않고,
    // 맵 끝에 막힌 화면에서는 커서 쪽으로 돈다). 괴물 자리는 이 입력 틱의 예측 상태(me)다 — 그리는 자리(localPos)는 프레임마다
    // 보간해 주사율에 따라 달라, 마우스를 두고 걸을 때 다시 재는 조준이 60Hz · 120Hz에서 달라졌다(frame-independence 시험)
    // 백버퍼 크기가 바뀌었으면(창 크기 · DPR) 포인터는 같은 게임 자리로 옮겨졌을 뿐 마우스가 움직인 것이 아니다 (aimHold.rebase).
    // 렌더 프레임에서도 입력 틱을 처리하므로(catchUpInput) 크기 변경 직후 · 카메라 행렬을 다시 맞추기 전에 잴 수 있다
    if (this.scale.width !== this.aimBackingW || this.scale.height !== this.aimBackingH) {
      this.aimBackingW = this.scale.width;
      this.aimBackingH = this.scale.height;
      this.aimHold.rebase(p);
    }
    const w = this.cameras.main.getWorldPoint(p.x, p.y, this.aimCursor);
    const body = tileToScreen(me.x, me.y);
    const a = aimAnchor(me.x, me.y, VIEW_TILES_W, VIEW_TILES_H, MAP_W, MAP_H, this.aimAnchorTile);
    const anchor = tileToScreen(a.x, a.y);
    this.aimPointer.x = p.x;
    this.aimPointer.y = p.y;
    return this.aimHold.update(this.aimPointer, w, body, anchor, 0.05 * TILE_PX * WORLD_SCALE, me.face);
  }

  /**
   * 터치 발사 대기에 넘길 상황: 예측한 face, 그리고 지금 공격 · 돌진을 시작할 수 있는가.
   * 조건은 공격 · 돌진 예측(predictMonsterPress = 서버 monsterCanAct + 쿨타임)과 같다. 생존자는 둘 다 거짓
   */
  private touchCtx(): TouchFrameCtx | undefined {
    if (!this.touch) return undefined;
    const app = this.app;
    const nowMs = performance.now();
    const st = app.predictor?.state;
    const mon = app.lastSnap?.you.mon;
    const balance = app.balance;
    if (!st || !mon || !balance) return { nowMs, face: st?.face ?? 0, canAttack: false, canDash: false };
    const base = {
      move: st,
      mon,
      balance,
      ageSec: (nowMs - app.lastSnapAt) / 1000 + app.link.rtt / 2000,
      localWindupActive: this.localWindup !== null && nowMs < this.localWindup.until,
    };
    return {
      nowMs,
      face: st.face,
      canAttack: predictMonsterPress({ ...base, pressed: BTN.ATTACK }).attack,
      canDash: predictMonsterPress({ ...base, pressed: BTN.DASH }).dash,
    };
  }

  /** 입력 틱: deltaMs = 지난번부터 흐른 시간, nowMs = 그 시각 (타이머 · 렌더 프레임이 같은 시계로 쌓는다) */
  private stepInput(deltaMs: number, nowMs: number): void {
    const app = this.app;
    this.syncMenu();
    const env = app.moveEnv();
    if (!env || !app.predictor?.state) return;
    // 사망 · 탈출 뒤에는 관전: 입력을 보내지 않는다
    const status = app.lastSnap?.you.surv?.status;
    if (status === 'dead' || status === 'escaped') {
      this.acc = 0;
      this.stopSelfWalk();
      return;
    }
    // 괴물 재접속 대기(판 전체 일시정지): 서버가 입력을 처리하지 않으므로 보내지도 예측하지도 않는다.
    // 터치 모드 세로 화면도 입력을 보내지 않는다 (판은 흐른다, 그동안 무방비)
    if ((app.lastSnap?.world.paused ?? null) !== null || (this.touch !== null && device.portrait)) {
      this.acc = 0;
      this.sampler.clearPressed();
      this.stopSelfWalk();
      return;
    }
    const dtMs = app.dt * 1000;
    this.acc = Math.min(this.acc + deltaMs, dtMs * MAX_CATCHUP_STEPS);
    const frames: InputFrame[] = [];
    // 입력 반응 (잔렉 고치기): 이번 틱들에서 멈춤 ↔ 걷기가 바뀌었는가
    let walking = this.selfSteps[this.selfSteps.length - 1]?.walk ?? false;
    let walkFlip = false;
    while (this.acc >= dtMs - STEP_EPS_MS) {
      this.acc = Math.max(0, this.acc - dtMs);
      this.seq += 1;
      const frame = this.sampler.sample(this.seq, this.aimTarget(), this.touchCtx());
      if (frame.pressed !== 0 && app.match?.role === 'monster') this.predictMonster(frame);
      // 명목 시각 (입력 틱 격자 위 = 쌓인 시간이 이 틱의 경계에 닿은 순간, 밀려서 한 번에 여러 틱이면 앞 틱일수록 이르다).
      // 그린 자리는 이 시각부터 보간하고(Predictor.alphaAt) 내 걷기 기록도 이 시각으로 적는다. 늦게 깬 타이머가 처리한 시각을
      // 쓰면 늦은 만큼 멈췄다 다음 틱에 튄다 (내 움직임 고르기)
      const at = nowMs - this.acc;
      app.predictor.applyLocal(frame, env, at);
      const moved = app.predictor.stepDistance;
      const walk = isWalking(moved, dtMs);
      if (walk !== walking) walkFlip = true;
      walking = walk;
      this.noteSelfStep(at, moved / dtMs, at + dtMs, walk);
      frames.push(frame);
      this.lastFrame = frame;
      this.inputHistory.push(frame, performance.now(), this.sampler.mode);
    }
    if (frames.length > 0) app.link.send({ t: 'input', frames });
    // 멈춤 ↔ 걷기가 바뀌었으면 다음 rAF를 제한과 상관없이 한 번 그린다(목표를 화면의 절반으로 낮춰도 첫 움직임 · 멈춤이 다음 그릴
    // 차례까지 늦지 않게). 렌더 프레임이 처리한 틱이면(catchUpInput) 그 프레임이 이미 그린다
    if (walkFlip && !this.inFrameInput) pacingHooks.requestFrame?.();
  }

  /** 괴물: 공격 준비 · 돌진을 서버 확인 전에 먼저 보여 준다 (판정은 서버, 어긋나면 보정) */
  private predictMonster(frame: InputFrame): void {
    const app = this.app;
    const mon = app.lastSnap?.you.mon;
    const st = app.predictor?.state;
    const balance = app.balance;
    if (!mon || !st || !balance || !app.predictor) return;
    const now = performance.now();
    const res = predictMonsterPress({
      pressed: frame.pressed,
      move: st,
      mon,
      balance,
      ageSec: (now - app.lastSnapAt) / 1000 + app.link.rtt / 2000,
      localWindupActive: this.localWindup !== null && now < this.localWindup.until,
    });
    if (res.attack) {
      app.predictor.predictAction(frame.seq, applyWindupLock(balance));
      this.localWindup = { seq: frame.seq, until: now + balance.monster.attack.windup * 1000, dir: st.face };
      sfx.play('windup');
    }
    if (res.dash) {
      app.predictor.predictAction(frame.seq, applyDashStart(balance));
      this.localDashAt = now;
    }
  }

  /** 다음 입력 틱(쌓인 시간이 1/30초가 되는 때)에 깨어나도록 예약한다. 장면이 끝나면 SHUTDOWN에서 취소 */
  private scheduleInput(): void {
    const dtMs = this.app.dt * 1000;
    const wait = Math.max(1, dtMs - this.acc - (performance.now() - this.lastInputAt));
    this.inputTimer = window.setTimeout(() => {
      this.inputTimer = null;
      this.inputTick();
      if (this.sys.isActive()) this.scheduleInput();
    }, wait);
  }

  private inputTick(now: number = performance.now()): void {
    const delta = Math.max(0, now - this.lastInputAt);
    this.lastInputAt = Math.max(this.lastInputAt, now);
    if (document.hidden) {
      // 백그라운드 탭: 입력을 보내지 않는다 (서버는 입력이 끊기면 제자리에 세운다)
      this.acc = 0;
      this.stopSelfWalk();
      return;
    }
    this.stepInput(delta, now);
  }

  /**
   * 렌더 프레임에서: 이 프레임 시각 frameAt까지 지난 입력 틱이 아직 처리되지 않았으면(타이머가 늦게 깸 — 120Hz에서 프레임 작업이
   * 타이머를 막는다) 지금 처리하고 타이머를 다시 맞춘다. 그래야 이 프레임에 그리는 자리가 명목 시각 기준 보간 구간 안에 있다.
   * 타이머가 제때 깨면(가상 시계 · 한가한 기기) 할 일이 없다. 입력을 더 일찍 읽을 뿐 늦추지 않는다
   */
  private catchUpInput(frameAt: number): void {
    if (this.inputTimer === null || !(frameAt > this.lastInputAt)) return;
    const dtMs = this.app.dt * 1000;
    if (this.acc + (frameAt - this.lastInputAt) < dtMs - STEP_EPS_MS) return;
    window.clearTimeout(this.inputTimer);
    this.inputTimer = null;
    this.inFrameInput = true;
    try {
      this.inputTick(frameAt);
    } finally {
      this.inFrameInput = false;
    }
    if (this.sys.isActive()) this.scheduleInput();
  }

  /** catchUpInput이 렌더 프레임 안에서 입력 틱을 처리하는 중 (그 프레임이 이미 그린다 — requestFrame을 부르지 않는다) */
  private inFrameInput = false;

  /**
   * 공격 준비 표시: 누른 순간부터 내 시계로 0.4초 (예측). 서버가 그 입력을 처리한 뒤 도착하는 같은 준비(서버 값)는
   * 이미 보여 줬으므로 다시 그리지 않는다. 예측하지 못한 준비(서버가 받아들인 경우)는 서버 값을 그린다
   */
  private windupView(ack: number, now: number): { dir: number | null; hideServer: boolean } {
    const lw = this.localWindup;
    if (!lw) return { dir: null, hideServer: false };
    if (ack < lw.seq) return { dir: now < lw.until ? lw.dir : null, hideServer: false };
    return { dir: null, hideServer: now < lw.until + this.app.link.rtt + 150 };
  }

  /** 프레임 독립성 시험용 연출 상태 (렌더링 최적화, 디버그 훅 getAnimState): 같은 시각이면 60 · 120fps에서 같아야 한다 */
  get animDebug(): AnimDebug | null {
    if (!this.world) return null;
    const w = this.world.animDebug();
    return {
      myBlend: this.app.match?.role === 'monster' ? this.myBlend : null,
      gait: w.gait,
      fogAt: w.fogAt,
      fogEye: w.fogEye,
      fogShift: w.fogShift,
      fogFollow: w.fogFollow,
      coneRed: w.coneRed,
      dashGhosts: w.dashGhosts,
      ghosts: w.ghosts,
      particles: w.particles,
      frames: this.renderedFrames,
    };
  }

  /** 입력을 적용하지 않는 틱 (관전 · 판 정지 · 숨김): 예측 상태가 움직이지 않는다 */
  private stopSelfWalk(): void {
    const last = this.selfSteps[this.selfSteps.length - 1];
    if (last?.walk || (last?.speed ?? 0) > 0) {
      const now = performance.now();
      this.noteSelfStep(now, 0, now, false);
    }
  }

  /**
   * 스냅샷 보정 뒤 (app이 reconcile한 바로 다음): 예측 보간의 두 상태가 바뀌었을 수 있다. 빠르기는 새 두 상태 사이 거리 /
   * 틱 길이, 보간이 다 가는 시각(마지막 입력 틱 + 틱 길이)과 걷기 판단(마지막 입력 틱)은 그대로
   */
  private noteSelfReconcile(t: number): void {
    const last = this.selfSteps[this.selfSteps.length - 1];
    const p = this.app.predictor;
    if (!last || !p) return;
    this.noteSelfStep(t, p.stepDistance / (this.app.dt * 1000), last.until, last.walk);
  }

  /** 내 캐릭터 걷기 기록 하나 (최근 16개: 틱 30Hz + 보정 20Hz로 0.3초 남짓, 느린 프레임 하나보다 길게) */
  private noteSelfStep(t: number, speed: number, until: number, walk: boolean): void {
    const steps = this.selfSteps;
    steps.push({ t, speed, until, walk });
    if (steps.length > 16) steps.shift();
  }

  /** 보간기 (생존자 화면의 괴물 · 다른 생존자) */
  private interpOf(kind: 'survivor' | 'monster'): App['survivorsInterp'] | App['monsterInterp'] {
    return kind === 'monster' ? this.app.monsterInterp : this.app.survivorsInterp;
  }

  /**
   * 괴물 시야 모드 보간의 목표를 스냅샷을 받은 순간 t에 맞춘다. 서버 값과 0.35 넘게 어긋나면 서버 값으로 (재접속 · 늦은 스냅샷).
   * 스냅샷 사이에는 시간 곡선을 읽기만 한다 (프레임 수와 무관)
   */
  private noteBlend(snap: Snapshot, t: number): void {
    const mon = snap.you.mon;
    const balance = this.app.balance;
    if (!mon || !balance) return;
    const ramp = (this.blendRamp ??= new LinearRamp(
      this.myBlend,
      Math.max(1, balance.monster.visionModeSwitchTime * 1000),
    ));
    ramp.setTarget(mon.mode === 'hunt' ? 1 : 0, t);
    if (Math.abs(ramp.valueAt(t) - mon.blend) > 0.35) ramp.jump(mon.blend, t);
  }

  override update(time: number, _delta: number): void {
    // Phaser의 delta는 200ms(최소 5fps)를 넘으면 이전 값으로 바꿔 넣으므로 느린 기기의 실제 간격은 rawDelta로 잰다.
    // 시간으로 쌓는 연출(보정 어긋남 · 걷기 · 부채꼴 색)도 rawDelta를 쓴다: delta는 최근 10프레임 평균이고 시작 · 복귀 뒤
    // 120프레임은 16.67ms로 막혀 120fps에서 실제와 다르다 (렌더링 최적화, smoothStep을 끄든 켜든 같게)
    const raw = this.game.loop.rawDelta;
    this.renderedFrames += 1;
    this.frameMs = trackFrameMs(this.frameMs, raw);
    this.renderFrame(frameDeltaMs(raw), time);
    this.watchFps();
  }

  /**
   * 판 중(결과 전) 보이는 탭에서만 잰다. 느린 상태가 이어지면 품질을 한 단계 내리고(재연결 · 장면 재시작 없음),
   * 같은 판에서 효과를 확인해 효과가 없으면 되돌린다 (gfx/quality.ts AutoDowngrade)
   */
  private watchFps(): void {
    if (!this.watchingFps || document.hidden) return;
    if (!this.app.lastSnap || this.app.result) return;
    const now = performance.now();
    const sample = this.adaptSample;
    // 측정: 그린 프레임의 최근 1초 FPS · 작업 시간 p95 (gfx/frameStats.ts). injectFps는 간격 = 작업 = 1000/fps로 본다
    const forced = getFpsOverride();
    if (forced !== null) {
      sample.fps = forced;
      sample.workP95 = 1000 / forced;
      sample.late = 0;
    } else if (now >= this.nextAdaptWindowAt) {
      this.nextAdaptWindowAt = now + ADAPT_WINDOW_EVERY_MS;
      // 늦은 프레임은 지금 목표 주기 + 반 vsync로 잰다 (120Hz 화면에서 목표 120이면 12.5ms 이상, 목표 60이면 20.8ms 이상)
      lateWindowFor(gfxState.targetHz, gfxState.displayHz, this.adaptLate);
      sessionFrameStats.window(FPS_WINDOW_MS, this.adaptWindow, this.adaptLate);
      sample.fps = this.adaptWindow.fps;
      sample.workP95 = this.adaptWindow.workP95;
      sample.late = this.adaptWindow.late;
    }
    // 목표: 프레임 제한 · 잰 화면 주사율 (main.ts가 페이싱 상태를 gfxState에 옮겨 적는다)
    const ctx = this.adaptCtx;
    ctx.targetHz = gfxState.targetHz;
    ctx.displayHz = gfxState.displayHz;
    // 목표 FPS를 약수 사다리로 내리고 올릴 수 있는가 (자동 제한 · 화면 주사율에 60 이상 약수가 있음 — 60 · 75Hz는 없다)
    ctx.canRateFallback = gfxState.frameLimit === 'auto' && ladderSize(gfxState.displayHz) > 1;
    const action = sessionAutoDowngrade.sample(now, sample, gfxState.quality, ctx);
    gfxState.measuredFps = sessionAutoDowngrade.average;
    if (action) qualityHooks.auto?.(action);
  }

  /**
   * 카메라를 한 걸음: 따라갈 대상(내 캐릭터 · 관전 중인 동료) · 괴물 앞당김 · 흔들림 → 기기 픽셀 격자의 창. 화면 좌표 변환
   * (ui/layout CAM)도 여기서 바꾼다 — 같은 프레임의 그리기 · 조준 · 디버그가 같은 창을 본다
   */
  private updateCamera(
    now: number,
    delta: number,
    me: { x: number; y: number; face: number } | null,
    survivors: ReadonlyMap<string, SurvivorView>,
  ): { x: number; y: number; w: number; h: number } {
    const d = this.director;
    const snap = this.app.lastSnap;
    const balance = this.app.balance;
    if (!d || !snap || !balance || CAM_ZOOM <= 1) {
      CAM.x = 0;
      CAM.y = 0;
      return { x: 0, y: 0, w: VIEW_TILES_W, h: VIEW_TILES_H };
    }
    const view = d.update({
      nowMs: now,
      dtMs: delta,
      role: snap.you.role,
      selfId: snap.you.id,
      me,
      myStatus: snap.you.surv?.status ?? null,
      survivors,
      team: this.teamOrder(),
      balance,
      blend: this.myBlend,
      viewW: VIEW_TILES_W,
      viewH: VIEW_TILES_H,
      // ?camSnap=0이면 격자에 맞추지 않는다 (진단용 — 0이면 CameraDirector가 맞추지 않고 나머지도 0)
      devPerTile: this.app.params.camSnap ? devPerTile(WORLD_SCALE, gfxState.zoom) : 0,
    });
    CAM.x = view.x;
    CAM.y = view.y;
    const dip = d.dip(now);
    this.dipCover?.setVisible(dip > 0).setAlpha(dip);
    return view;
  }

  /**
   * 화면 밖 화살표: 이번 프레임 메인 그림(drawn) · 세계 상태 · 고정 맵 자리에서만 대상을 고르고(render/offscreen.ts) 창
   * 가장자리 안쪽에 놓는다. 엄지 버튼 · 안쪽 미니맵을 피하고, 캐릭터 몸과 겹치면 흐리게 한다
   */
  private updateEdges(
    snap: Snapshot,
    view: { x: number; y: number; w: number; h: number },
    now: number,
  ): void {
    const edges = this.edges;
    if (!edges) return;
    const role = snap.you.role;
    const targets = edgeTargets(
      {
        role,
        selfId: snap.you.id,
        myStatus: snap.you.surv?.status ?? null,
        followId: this.director?.follow ?? snap.you.id,
        drawn: this.drawn,
        statusOf: this.statusOf,
        roleOf: this.roleOf,
        points: snap.world.points,
        exits: snap.world.exits,
      },
      this.edgeTargetBuf,
    );
    const bodies = this.bodyPts;
    let n = 0;
    for (const d of this.drawn) {
      if (d.kind === 'mark' || d.layer === 'minimap') continue;
      const p = tileToScreen(d.x, d.y);
      const b = bodies[n] ?? { x: 0, y: 0 };
      b.x = p.x;
      b.y = p.y;
      bodies[n] = b;
      n += 1;
    }
    bodies.length = n;
    const m = edgeMetrics();
    const balance = this.app.balance;
    const bodyR = balance ? balance.survivor.radius * TILE_PX * WORLD_SCALE * 1.15 : 0;
    // 피할 사각형: 엄지 버튼 · 맵 안 미니맵 · 보이는 안내 줄 (검토 반영: 넓은 터치 배치는 맵이 화면 높이 가득이라 아래 화살표가
    // 수감 · 관전 안내 줄 밑에 깔렸다). 배열 하나를 다시 쓴다
    const avoid = this.edgeAvoid;
    avoid.length = 0;
    for (const b of this.thumbBoxes) avoid.push(b);
    if (this.minimap.insetRect) avoid.push(this.minimap.insetRect);
    const hint = this.hud.hintRect;
    if (hint) avoid.push(hint);
    if (this.chipAvoid) avoid.push(this.chipAvoid);
    placeEdges(
      targets,
      { view, rect: MAP_RECT },
      { inset: m.inset, r: m.r, gap: m.gap, avoid, bodyR },
      bodies,
      this.edgePlaced,
    );
    edges.update(this.edgePlaced, role === 'monster', now);
  }

  /** 그리는 내 자리 그릇 (프레임마다 다시 쓴다: world.draw는 이번 프레임 안에서만 읽는다) */
  private readonly drawMeBuf = { x: 0, y: 0, face: 0 };

  /**
   * 내 몸을 그리는 자리 = 예측 자리 + 카메라 격자 맞추기 나머지 (확대 화면만, 기기 1px 미만). 맵 · HUD는 격자 그대로 선명하고,
   * 화면에서 내 캐릭터는 맞추기 전 창 기준이라 따라가는 동안 반 픽셀씩 흔들리지 않는다(내 움직임 고르기). getRenderPos는 예측 자리 그대로
   */
  private drawSelfAt(
    me: { x: number; y: number; face: number } | null,
  ): { x: number; y: number; face: number } | null {
    const d = this.director;
    if (!me || !d || CAM_ZOOM <= 1) return me;
    const out = this.drawMeBuf;
    out.x = me.x + d.snapResidual.x;
    out.y = me.y + d.snapResidual.y;
    out.face = me.face;
    return out;
  }

  private renderFrame(delta: number, rafTime: number): void {
    const app = this.app;
    const snap = app.lastSnap;
    if (!snap || !app.balance || !app.match) {
      this.drawn = [];
      return;
    }
    const now = performance.now();
    this.syncMenu();
    // 내 캐릭터 · 카메라는 이 프레임의 rAF 시각(vsync)으로 잰다: 화면에 나가는 간격과 같은 시계라 고르다. 콜백이 늦게 시작한
    // 만큼(입력 이벤트 · 다른 콜백) 흔들리는 performance.now 대신. 따라가기 감쇠의 간격(rawDelta)도 이 시각들의 차이다
    const frameAt = frameTimeOf(rafTime, now);
    this.catchUpInput(frameAt);
    // 다른 캐릭터 보간 시각도 같은 rAF 시각으로 (내 캐릭터 · 카메라와 같은 시계 — 콜백이 늦게 시작한 만큼 흔들리지 않게)
    const renderTime = app.renderTime(frameAt);
    const span = this.motionSpan;
    span.r0 = this.lastRenderTime ?? renderTime;
    span.r1 = renderTime;
    span.prevNow = this.lastRenderTime === null ? null : span.now;
    span.now = now;
    this.lastRenderTime = renderTime;
    const windup = this.windupView(snap.ack, now);
    // 보간 비율은 예측기가 마지막 입력 틱의 명목 시각으로 잰다 (Predictor.alphaAt)
    const me = app.predictor?.renderPos(delta, undefined, frameAt) ?? null;
    if (me) this.localPos = me;
    const mon = snap.you.mon;
    if (mon) {
      // 이 장면이 생기기 전에 받은 스냅샷이면 첫 프레임에 시작한다
      if (!this.blendRamp) this.noteBlend(snap, now);
      this.myBlend = this.blendRamp?.valueAt(now) ?? this.myBlend;
    }
    const lw = this.localWindup;
    const survivors = app.survivorsInterp.sample(renderTime);
    this.applySpectatePick(snap);
    const view = this.updateCamera(now, delta, me, survivors);
    // 내 몸을 그리는 자리: 카메라가 창을 기기 픽셀 격자에 맞추며 옮긴 만큼 같이 옮긴다(화면에서는 맞추기 전 창 기준 — 고르게
    // 움직인다). 시야 · 부채꼴 · 범위 · 정보 레이어는 예측 자리 그대로(맵에 붙은 그림, 판정과 같은 자리)
    const drawMe = this.drawSelfAt(me);
    this.world.draw(
      {
        balance: app.balance,
        snap,
        role: snap.you.role,
        selfId: snap.you.id,
        me,
        meBody: drawMe,
        survivors,
        monster:
          snap.you.role === 'monster' ? null : (app.monsterInterp.sample(renderTime).get('monster') ?? null),
        myBlend: this.myBlend,
        nowMs: now,
        roarPings: this.roarPings,
        localWindupDir: windup.dir,
        hideServerWindup: windup.hideServer,
        myStunned: snap.you.role === 'monster' && (app.predictor?.state?.stun ?? 0) > 0,
        myDashing: snap.you.role === 'monster' && (app.predictor?.state?.dash ?? 0) > 0,
        snapAt: app.lastSnapAt,
        localWindupAt: windup.dir !== null && lw ? lw.until - app.balance.monster.attack.windup * 1000 : null,
        localDashAt: this.localDashAt,
        motion: this.motion,
        view,
      },
      delta,
    );
    this.drawn = this.world.drawn;
    this.screenFx.update(now, snap.you.role === 'monster' && (app.predictor?.state?.stun ?? 0) > 0);
    this.kit.sync();
    // 미니맵 바닥: 안개 그림이 바뀐 다음 프레임에 줄여 그린다 (없거나 숨었으면 읽지 않는다. 다시 보이면 그 프레임에 한 번)
    const baseNew = this.minimap.syncBase(this.world.baseRefreshed, this.world, now);
    const d = this.director;
    const blinkOff = Math.floor(now / 500) % 2 === 1;
    this.minimap.setWorld(
      snap.world.points,
      snap.world.exits,
      CAM_ZOOM > 1 ? view : null,
      d?.spectating ?? null,
      blinkOff,
    );
    this.minimap.update(this.drawn, snap.you.role, this.roleOf);
    // 지도 크게 보기: 작은 지도와 같은 값 · 같은 프레임
    this.updateBigMap(snap, view, blinkOff, baseNew);
    this.updateEdges(snap, view, now);
    this.hud.setWatching(d?.spectating ?? null, CAM_ZOOM > 1 && (d?.canSpectate ?? false));
    this.hud.update(snap, now);

    // 괴물 경고 줄 (감옥 캠핑 · 거점 지키기): 지속 배너 자리에 주황 리본 + 아이콘
    const warn: BannerLine | null = !mon
      ? null
      : mon.camp > 0
        ? mon.camp === 2
          ? LINE.campSlow
          : LINE.campWarn
        : mon.blockWarn
          ? LINE.pointWarn
          : null;
    const spotted = snap.you.surv?.spotted === true;
    this.spottedEdge.show(spotted);
    // 발각 빛 테두리: 1.2Hz 맥동 (번쩍임 줄이기면 맥동 없이 고정 알파 — 발각 정보는 그대로)
    this.spottedAlphaNow = spotted ? spottedEdgeAlpha(gfxNow(), this.flashReduced) : 0;
    if (spotted) this.spottedEdge.setAlpha(this.spottedAlphaNow);
    const lastChance = snap.world.grace !== null && snap.you.surv?.status === 'free';
    const paused = snap.world.paused;
    const persistent: BannerLine | null =
      paused !== null
        ? this.pausedLine(Math.ceil(paused))
        : spotted
          ? LINE.spotted
          : lastChance
            ? lastChanceLine()
            : null;
    this.banners.update(persistent, warn, now);
    this.updateTouch(snap);
    const anyKey = this.sampler.anyKeyPressed;
    this.sampler.anyKeyPressed = false;
    // Tab 점수판(터치: 점수판 버튼)이 열리면 조작 안내를 닫는다 (두 패널이 겹치지 않게)
    const tab = this.sampler.tabHeld || (this.touchControls?.scoreboard ?? false);
    this.tutorial?.update(now, anyKey || tab);
    this.scoreboard.update(tab, snap);
    // 이번 프레임 월드 그림이 다 놓인 뒤: 창 밖 그림은 그리지 않는다
    this.cullWorld();
    this.updateDom(now);
  }

  /**
   * 터치 화면: 판 중이고 관전 · 결과 · 판 정지 · 세로 화면 · 판 중 메뉴가 아닐 때만 입력을 받는다('설정' 버튼은 결과 전이면 늘). 끄는 순간 손가락 · 발사 대기를 비운다.
   * 행동 칸은 이번 프레임 캔버스 HUD가 계산한 actionSlots 결과를 그대로 쓴다 (쿨타임 게이지 · 못 씀 표시)
   */
  private updateTouch(snap: Snapshot): void {
    const controls = this.touchControls;
    if (!controls) return;
    const status = snap.you.surv?.status;
    const active =
      this.app.result === null &&
      status !== 'dead' &&
      status !== 'escaped' &&
      snap.world.paused === null &&
      !device.portrait &&
      !this.menuOpen;
    if (active !== this.touchActive) {
      this.touchActive = active;
      controls.setActive(active);
      if (!active) this.touch?.reset();
    }
    // 판 중 '설정' 버튼: 관전 · 판 정지 중에도 (결과 전 · 메뉴가 닫혀 있을 때, PC 메뉴 버튼과 같다)
    controls.setMenuAvailable(this.app.result === null && !this.menuOpen);
    if (active) {
      this.touchView.slots = this.hud.lastSlots;
      controls.update(this.touchView);
    }
  }

  /** 괴물 재접속 대기 줄 (남은 초가 같으면 같은 객체) */
  private pausedLine(sec: number): BannerLine {
    const m = this.pausedMemo;
    if (m && m.sec === sec) return m.line;
    const line: BannerLine = {
      text: `${UI_TEXT.monsterReconnect} ${sec}초`,
      tone: 'warn',
      icon: 'disconnected',
    };
    this.pausedMemo = { sec, line };
    return line;
  }
}

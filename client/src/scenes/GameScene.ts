// 판 화면: 1/30초 고정 간격 입력 → 예측 → 서버 전송, 그리고 렌더링 · HUD · 배너
import Phaser from 'phaser';
import {
  BTN,
  type AnimDebug,
  type DrawnEntity,
  type FxTarget,
  type GameEvent,
  type HudLayoutItem,
  type InfoItem,
  type InputFrame,
  type InputLogEntry,
  type Role,
  type Snapshot,
  isKeptNote,
} from '@decoy/shared';
import type { App } from '../app';
import { LinearRamp, isWalking, selfPieces, type SelfStep, type TravelPiece } from '../art/anim';
import { sfx } from '../audio';
import { STORY_TEXT, UI_TEXT, formatText } from '../data/storyText';
import { device } from '../device';
import { FPS_WINDOW_MS, sessionFrameStats, type FrameWindow } from '../gfx/frameStats';
import { qualityHooks, sessionAutoDowngrade, type AdaptContext, type FrameSample } from '../gfx/quality';
import { getFpsOverride, gfxNow, gfxState, probeSlot } from '../gfx/state';
import { haptics } from '../haptics';
import { InputLog, InputSampler } from '../input';
import { applyDashStart, applyWindupLock, predictMonsterPress, type LocalWindup } from '../localActions';
import { COLOR } from '../render/colors';
import { ScreenEffects, collectFxTargets } from '../render/effects';
import { WorldRenderer, type MotionSource } from '../render/worldRenderer';
import { TouchInput, type TouchFrameCtx } from '../touchInput';
import { TOUCH_HINT_MS, takeTouchHints } from '../touchTutorial';
import type { IconId } from '../art/icons';
import { Banners, type BannerLine } from '../ui/banners';
import { Hud } from '../ui/hud';
import type { Tone } from '../ui/hudArt';
import { HudKit, type Slice } from '../ui/hudKit';
import { HUD, VIEW_H, VIEW_W, fitCamera, screenToTile } from '../ui/layout';
import { Minimap } from '../ui/minimap';
import { Scoreboard, TutorialOverlay } from '../ui/overlays';
import { PROBE_DEPTH, drawProbeText } from '../ui/text';
import { TouchControls, type TouchView } from '../ui/touchControls';
import { frameDeltaMs, staleEventLimitMs, trackFrameMs } from './staleEvents';

/** 안개 (M3부터) */
export const FOG_ENABLED = true;
/** 입력이 밀렸을 때 한 번에 따라잡는 최대 스텝 */
const MAX_CATCHUP_STEPS = 4;
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
/** 발각 테두리 맥동 (Hz) */
const SPOTTED_PULSE_HZ = 1.2;
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
  private acc = 0;
  private lastInputAt = 0;
  /** 마지막으로 입력 틱을 처리한 시각 (틱 사이 보간 비율) */
  private lastStepAt = 0;
  private inputTimer: number | null = null;
  private world!: WorldRenderer;
  /** HUD 아틀라스와 부품 (배율이 바뀔 때만 다시 굽는다) */
  private kit!: HudKit;
  private hud!: Hud;
  private minimap!: Minimap;
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
  private readonly adaptSample: FrameSample = { fps: 0, workP95: 0 };
  private readonly adaptCtx: AdaptContext = { targetHz: 60, displayHz: 60, canRateFallback: false };
  private readonly adaptWindow: FrameWindow = { fps: 0, intervalAvg: 0, workP95: 0, frames: 0 };
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

  get minimapDrawn(): DrawnEntity[] {
    return this.minimap?.drawn ?? [];
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
    this.world = new WorldRenderer(this, FOG_ENABLED);
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
    this.banners = new Banners(this.kit);
    // 첫 판 조작 안내는 키보드 · 마우스용이라 터치 모드에서는 만들지 않는다 (터치는 판 직전 안내 + 판 중 위치 표시, M12)
    this.tutorial = info.firstMatch && !device.touch ? new TutorialOverlay(this.kit, info) : null;
    this.scoreboard = new Scoreboard(this.kit, info, balance, device.touch);
    this.screenFx = new ScreenEffects(this, this.world.stunVeil);
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
      const uiRoot = document.getElementById('ui-root') ?? document.body;
      // 판 HUD 자리 (논리 px): 터치 화면이 이동 영역을 그 아래에서 시작한다. 캔버스 자리는 창 크기가 바뀔 때마다 다시 잰다.
      // 판 중 창이 낮아져 엄지 버튼이 미니맵을 덮으면 미니맵을 숨기고, 크기가 돌아오면 다시 보인다 (M12 검토)
      const plan = HUD.touch ? (info.role === 'monster' ? HUD.touch.monster : HUD.touch.survivor) : null;
      const canvas = this.game.canvas;
      this.touchControls = new TouchControls(uiRoot, {
        role: info.role,
        feed: this.touch,
        hud: {
          rects: plan?.rects ?? [],
          canvas: () => {
            const r = canvas.getBoundingClientRect();
            return r.height > 0 ? { left: r.left, top: r.top, k: r.height / VIEW_H } : null;
          },
          onCovered: (ids) => this.minimap.setHidden(ids.has('minimap')),
        },
      });
      // 판 직전 터치 안내를 본 판이면 처음 10초 동안 스틱 · 버튼 자리를 보인다 (입력을 막지 않는다)
      if (takeTouchHints()) this.touchControls.showHints(TOUCH_HINT_MS);
    }
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
        if (isMonster && ev.hits > 0) sfx.play('hit', 0.7);
        return;
      case 'hit':
        if (ev.you) {
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
    if (!this.sampler.aimPointerReady) return me.face;
    // 손가락 포인터는 조준을 바꾸지 않는다(터치스크린 노트북의 손가락 · 손바닥): 마우스 포인터만
    const p = this.input.mousePointer ?? this.input.activePointer;
    const w = this.cameras.main.getWorldPoint(p.x, p.y);
    const t = screenToTile(w.x, w.y);
    if (Math.hypot(t.x - me.x, t.y - me.y) < 0.05) return me.face;
    return Math.atan2(t.y - me.y, t.x - me.x);
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

  private stepInput(deltaMs: number): void {
    const app = this.app;
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
    while (this.acc >= dtMs) {
      this.acc -= dtMs;
      this.seq += 1;
      const frame = this.sampler.sample(this.seq, this.aimTarget(), this.touchCtx());
      if (frame.pressed !== 0 && app.match?.role === 'monster') this.predictMonster(frame);
      app.predictor.applyLocal(frame, env);
      this.lastStepAt = performance.now();
      const moved = app.predictor.stepDistance;
      this.noteSelfStep(this.lastStepAt, moved / dtMs, this.lastStepAt + dtMs, isWalking(moved, dtMs));
      frames.push(frame);
      this.lastFrame = frame;
      this.inputHistory.push(frame, this.lastStepAt, this.sampler.mode);
    }
    if (frames.length > 0) app.link.send({ t: 'input', frames });
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

  private inputTick(): void {
    const now = performance.now();
    const delta = now - this.lastInputAt;
    this.lastInputAt = now;
    if (document.hidden) {
      // 백그라운드 탭: 입력을 보내지 않는다 (서버는 입력이 끊기면 제자리에 세운다)
      this.acc = 0;
      this.stopSelfWalk();
      return;
    }
    this.stepInput(delta);
  }

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

  override update(_time: number, _delta: number): void {
    // Phaser의 delta는 200ms(최소 5fps)를 넘으면 이전 값으로 바꿔 넣으므로 느린 기기의 실제 간격은 rawDelta로 잰다.
    // 시간으로 쌓는 연출(보정 어긋남 · 걷기 · 부채꼴 색)도 rawDelta를 쓴다: delta는 최근 10프레임 평균이고 시작 · 복귀 뒤
    // 120프레임은 16.67ms로 막혀 120fps에서 실제와 다르다 (렌더링 최적화, smoothStep을 끄든 켜든 같게)
    const raw = this.game.loop.rawDelta;
    this.renderedFrames += 1;
    this.frameMs = trackFrameMs(this.frameMs, raw);
    this.renderFrame(frameDeltaMs(raw));
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
    } else if (now >= this.nextAdaptWindowAt) {
      this.nextAdaptWindowAt = now + ADAPT_WINDOW_EVERY_MS;
      sessionFrameStats.window(FPS_WINDOW_MS, this.adaptWindow);
      sample.fps = this.adaptWindow.fps;
      sample.workP95 = this.adaptWindow.workP95;
    }
    // 목표: 프레임 제한 · 잰 화면 주사율 (main.ts가 페이싱 상태를 gfxState에 옮겨 적는다)
    const ctx = this.adaptCtx;
    ctx.targetHz = gfxState.targetHz;
    ctx.displayHz = gfxState.displayHz;
    ctx.canRateFallback = gfxState.frameLimit === 'auto' && gfxState.displayHz > 60;
    const action = sessionAutoDowngrade.sample(now, sample, gfxState.quality, ctx);
    gfxState.measuredFps = sessionAutoDowngrade.average;
    if (action) qualityHooks.auto?.(action);
  }

  private renderFrame(delta: number): void {
    const app = this.app;
    const snap = app.lastSnap;
    if (!snap || !app.balance || !app.match) {
      this.drawn = [];
      return;
    }
    const now = performance.now();
    const renderTime = app.renderTime();
    const span = this.motionSpan;
    span.r0 = this.lastRenderTime ?? renderTime;
    span.r1 = renderTime;
    span.prevNow = this.lastRenderTime === null ? null : span.now;
    span.now = now;
    this.lastRenderTime = renderTime;
    const alpha = (now - this.lastStepAt) / (app.dt * 1000);
    const windup = this.windupView(snap.ack, now);
    const me = app.predictor?.renderPos(delta, alpha, now) ?? null;
    if (me) this.localPos = me;
    const mon = snap.you.mon;
    if (mon) {
      // 이 장면이 생기기 전에 받은 스냅샷이면 첫 프레임에 시작한다
      if (!this.blendRamp) this.noteBlend(snap, now);
      this.myBlend = this.blendRamp?.valueAt(now) ?? this.myBlend;
    }
    const lw = this.localWindup;
    this.world.draw(
      {
        balance: app.balance,
        snap,
        role: snap.you.role,
        selfId: snap.you.id,
        me,
        survivors: app.survivorsInterp.sample(renderTime),
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
      },
      delta,
    );
    this.drawn = this.world.drawn;
    this.screenFx.update(now, snap.you.role === 'monster' && (app.predictor?.state?.stun ?? 0) > 0);
    this.kit.sync();
    // 미니맵 바닥: 안개 그림이 바뀐 다음 프레임에 줄여 그린다 (없거나 숨었으면 읽지 않는다. 다시 보이면 그 프레임에 한 번)
    this.minimap.syncBase(this.world.baseRefreshed, this.world);
    this.minimap.update(this.drawn, snap.you.role, this.roleOf);
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
    if (spotted)
      this.spottedEdge.setAlpha(0.8 + 0.2 * Math.cos((gfxNow() / 1000) * Math.PI * 2 * SPOTTED_PULSE_HZ));
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
  }

  /**
   * 터치 화면: 판 중이고 관전 · 결과 · 판 정지 · 세로 화면이 아닐 때만 입력을 받는다. 끄는 순간 손가락 · 발사 대기를 비운다.
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
      !device.portrait;
    if (active !== this.touchActive) {
      this.touchActive = active;
      controls.setActive(active);
      if (!active) this.touch?.reset();
    }
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

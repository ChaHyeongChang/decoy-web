// window.__DECOY__ 디버그 훅과 ?debug=1 오버레이 (FPS · 프레임 시간 · 그리기 호출 · 핑 · 서버 틱 · 예측 오차 · 품질 …,
// 표시는 ui/debugOverlay.ts). 오버레이는 배포 빌드에서도 ?debug=1이면 뜨고, 그때만 그리기 호출을 센다
import Phaser from 'phaser';
import type { ControlLayoutInfo, DecoyDebug, HudLayout, MatchPrefsDebug, TouchTarget } from '@decoy/shared';
import type { App } from './app';
import { sfx } from './audio';
import { device } from './device';
import { setCharStyle } from './gfx/charStyle';
import { pacingHooks } from './gfx/framePacing';
import {
  FPS_WINDOW_MS,
  frameStatsInfo,
  installDrawCounter,
  sessionFrameStats,
  type FrameWindow,
} from './gfx/frameStats';
import { lateWindowFor } from './gfx/quality';
import { freezeGfxClock, gfxState, probeSlot, setFogFollowDisabled, setFpsOverride } from './gfx/state';
import { matchMenu } from './matchMenu';
import { setPref } from './prefs';
import type { GameScene } from './scenes/GameScene';
import { installDebugOverlay, type DebugOverlayData, type OverlayAnchor } from './ui/debugOverlay';
import { MAP_RECT, VIEW_H, VIEW_W, layout, tileToScreen } from './ui/layout';
import { fontState, uiFontsReady } from './ui/fonts';
import { auditTexts } from './ui/text';
import { editorControlLayout, openLayoutEditor } from './ui/layoutEditor';
import { liveControlLayout } from './ui/touchControls';

declare global {
  interface Window {
    __DECOY__?: DecoyDebug;
  }
}

/** 판 중 터치 화면의 조작 배치 (조작 배치 편집 시험, 없으면 null) */
function matchControlLayout(): ControlLayoutInfo | null {
  const live = liveControlLayout();
  if (!live) return null;
  const L = live.layout;
  const r = (b: { x: number; y: number; w: number; h: number }) => ({ x: b.x, y: b.y, w: b.w, h: b.h });
  const controls: ControlLayoutInfo['controls'] = [
    {
      id: 'move',
      ...r({ x: L.moveHome.x - L.moveR, y: L.moveHome.y - L.moveR, w: L.moveR * 2, h: L.moveR * 2 }),
    },
  ];
  if (L.aim) controls.push({ id: 'attack', ...r(L.aim) });
  for (const [id, b] of Object.entries(L.buttons)) if (b) controls.push({ id, ...r(b) });
  const pad = 6;
  return {
    source: 'match',
    team: live.team,
    mirror: live.mirror,
    fallback: live.fallback,
    safe: r(L.safe),
    range: { x: L.safe.x + pad, y: L.safe.y + pad, w: L.safe.w - pad * 2, h: L.safe.h - pad * 2 },
    zone: r(L.zone),
    controls,
    hud: live.hud.map((x) => ({ id: x.id, ...r(x.b) })),
  };
}

function gameScene(app: App): GameScene | null {
  const scene = app.game?.scene.getScene('game') as GameScene | undefined;
  return scene && scene.sys.isActive() ? scene : null;
}

const TOUCH_KINDS: readonly TouchTarget['kind'][] = ['zone', 'stick', 'button'];

/**
 * 손가락이 닿는 터치 대상 (M11): #ui-root 안 [data-touch-target] 중 보이고(크기 > 0 · display · visibility ·
 * 조상 포함 opacity 0 아님) 입력을 받는(pointer-events none · inert 아님) 요소. 좌표는 CSS px, 창 기준.
 * data-touch-kind가 없거나 틀리면 'button'으로 본다(가장 엄한 크기 검사를 받게). 테스트에서만 부른다(레이아웃을 읽는다)
 */
function touchTargets(): TouchTarget[] {
  const out: TouchTarget[] = [];
  const uiRoot = document.getElementById('ui-root');
  if (!uiRoot) return out;
  for (const el of uiRoot.querySelectorAll<HTMLElement>('[data-touch-target]')) {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0 || el.closest('[inert]')) continue;
    // checkVisibility가 없는 옛 브라우저(크롬 105 미만)는 크기 · pointer-events만 본다
    const visible =
      typeof el.checkVisibility !== 'function' ||
      el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
    if (!visible) continue;
    if (getComputedStyle(el).pointerEvents === 'none') continue;
    const kind = TOUCH_KINDS.find((k) => k === el.dataset.touchKind) ?? 'button';
    out.push({ id: el.dataset.touchTarget ?? '', kind, x: r.left, y: r.top, w: r.width, h: r.height });
  }
  return out;
}

/**
 * 판 화면 HUD 배치 (M12): 판 장면이 표시 목록에서 잰 HUD 글자 · 그림(논리 px)을 캔버스 위치로 CSS px로 바꾼다.
 * 글자 크기도 CSS px (터치 화면 글자 하한 12px 검사)
 */
function hudLayout(app: App): HudLayout | null {
  const scene = gameScene(app);
  const canvas = app.game?.canvas;
  if (!scene || !canvas) return null;
  const rect = canvas.getBoundingClientRect();
  const k = rect.height / VIEW_H;
  const r1 = (v: number): number => Math.round(v * 10) / 10;
  const box = (b: { x: number; y: number; w: number; h: number }) => ({
    x: r1(rect.left + b.x * k),
    y: r1(rect.top + b.y * k),
    w: r1(b.w * k),
    h: r1(b.h * k),
  });
  return {
    layout: layout().kind,
    viewW: VIEW_W,
    viewH: VIEW_H,
    cssPerLogical: k,
    map: box(MAP_RECT),
    items: scene.hudItems.map((i) => ({
      ...i,
      ...box(i),
      ...(i.fontPx !== undefined ? { fontPx: r1(i.fontPx * k) } : {}),
    })),
    minimapInset: scene.minimapInset,
  };
}

export function installDebug(app: App, overlay: boolean): void {
  const hook: DecoyDebug = {
    get gfx() {
      return { ...gfxState, features: { ...gfxState.features } };
    },
    freezeClock: (ms) => freezeGfxClock(ms),
    injectFps: (fps) => setFpsOverride(fps),
    getFrameStats: () => frameStatsInfo(),
    getAnimState: () => gameScene(app)?.animDebug ?? null,
    setFogFollowDisabled: (off) => setFogFollowDisabled(off),
    getCamera: () => gameScene(app)?.cameraDebug ?? null,
    getSpectateCards: () => gameScene(app)?.spectateCards ?? [],
    setCameraShake: (scale) => gameScene(app)?.setShakeScale(scale),
    // ── 판 중 설정 효과 ──
    getMatchPrefs: () => matchPrefs(app),
    getDrawnMinimapBig: () => gameScene(app)?.minimapBigDrawn.map((d) => ({ ...d })) ?? [],
    fakeMatchMenu: (on) => setFakeMatchMenu(on),
    setMatchPref: (key, on) => void setPref(key, on),
    setFrameLimit: (limit) => pacingHooks.setLimit?.(limit),
    setCharStyle: (style) => void setCharStyle(style, false),
    probeText: (text, x, y, px) => probeSlot.draw?.(text, x, y, px),
    textAudit: () => auditTexts(app.game?.scene.getScenes(true) ?? []),
    get fonts() {
      return { ready: uiFontsReady(), atSceneStart: fontState.atSceneStart };
    },
    getHud: () => ({ ...(gameScene(app)?.hudDebug ?? {}) }),
    get role() {
      return app.match?.role ?? null;
    },
    get you() {
      return app.you;
    },
    get room() {
      return app.roomCode;
    },
    get phase() {
      return app.lobby?.phase ?? null;
    },
    get fps() {
      return app.game?.loop.actualFps ?? 0;
    },
    get ping() {
      return app.link.rtt;
    },
    get serverOffset() {
      return app.link.offset;
    },
    get pendingInputs() {
      return app.predictor?.pendingCount ?? 0;
    },
    get correction() {
      return app.predictor?.lastCorrection ?? 0;
    },
    get renderer() {
      const r = app.game?.renderer;
      if (!r) return 'none';
      return r.type === Phaser.WEBGL ? 'webgl' : 'canvas';
    },
    get balanceHash() {
      return app.balanceHash;
    },
    get snapCount() {
      return app.snapCount;
    },
    getLocalState: () => app.predictor?.state ?? null,
    getRenderPos: () => {
      const s = gameScene(app);
      return s ? { ...s.localPos } : null;
    },
    getLastSnapshot: () => app.lastSnap,
    getDrawn: () => gameScene(app)?.drawn.map((d) => ({ ...d })) ?? [],
    getDrawnMinimap: () => gameScene(app)?.minimapDrawn.map((d) => ({ ...d })) ?? [],
    getBanners: () => gameScene(app)?.bannerTexts.slice() ?? [],
    getEffects: () => ({ ...(gameScene(app)?.effects ?? {}) }),
    getInfoLayer: () => gameScene(app)?.infoLayer.map((i) => ({ ...i })) ?? [],
    getFxTargets: () =>
      gameScene(app)?.fxTargets.map((t) => ({ layer: t.layer, effects: t.effects.slice() })) ?? [],
    getSounds: () => sfx.log.map((s) => s.name),
    get audioReady() {
      return sfx.ready;
    },
    getResult: () => app.result,
    getLastInput: () => gameScene(app)?.lastFrame ?? null,
    // M11: 입력 기록 · 방식은 GameScene(판 장면이 없으면 빈 기록 · 'keyboard'), 터치 대상은 #ui-root DOM
    getInputLog: () => gameScene(app)?.inputLog.map((e) => ({ ...e })) ?? [],
    get inputMode() {
      return gameScene(app)?.inputMode ?? 'keyboard';
    },
    getTouchTargets: () => touchTargets(),
    getHudLayout: () => hudLayout(app),
    serverNow: () => app.link.serverNow(),
    sendTest: (cmd) => app.link.send({ t: 'test', cmd }),
    get transport() {
      return app.link.kind;
    },
    get practiceRoom() {
      return app.practiceRoom;
    },
    getTruth: () => app.localTruth(),
    tileToClient: (x, y) => {
      const canvas = app.game?.canvas;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const p = tileToScreen(x, y);
      return { x: rect.left + (p.x / VIEW_W) * rect.width, y: rect.top + (p.y / VIEW_H) * rect.height };
    },
    // ── 조작 배치 편집 ──
    openLayoutEditor: (team) => {
      openLayoutEditor({
        host: document.getElementById('ui-root') ?? document.body,
        role: team,
        onClose: () => undefined,
      });
    },
    getControlLayout: () => editorControlLayout() ?? matchControlLayout(),
  };
  window.__DECOY__ = hook;
  if (!overlay) return;
  watchDrawCalls(app);
  installDebugOverlay({
    data: () => overlayData(app, hook),
    // 터치 기기는 접은 칩으로 시작한다 (판 HUD를 가리지 않게). PC는 펼친 채
    expanded: !device.touch,
    anchor: () => overlayAnchor(app),
  });
}

// ── 판 중 설정 효과 (디버그) ──

/** 시험용 가짜 판 중 메뉴 (fakeMatchMenu): 열림 상태 · 횟수, 되돌릴 진짜 연결점 */
interface FakeMenu {
  open: boolean;
  opens: number;
  closes: number;
  saved: { open: typeof matchMenu.open; close: typeof matchMenu.close; isOpen: typeof matchMenu.isOpen };
}
let fakeMenu: FakeMenu | null = null;

function setFakeMatchMenu(on: boolean): void {
  if (on && !fakeMenu) {
    const f: FakeMenu = {
      open: false,
      opens: 0,
      closes: 0,
      saved: { open: matchMenu.open, close: matchMenu.close, isOpen: matchMenu.isOpen },
    };
    matchMenu.open = () => {
      if (f.open) return;
      f.open = true;
      f.opens += 1;
    };
    matchMenu.close = () => {
      if (!f.open) return;
      f.open = false;
      f.closes += 1;
    };
    matchMenu.isOpen = () => f.open;
    fakeMenu = f;
  } else if (!on && fakeMenu) {
    matchMenu.open = fakeMenu.saved.open;
    matchMenu.close = fakeMenu.saved.close;
    matchMenu.isOpen = fakeMenu.saved.isOpen;
    fakeMenu = null;
  }
}

/** 판 중 설정 효과 상태 (판 장면이 없으면 null) */
function matchPrefs(app: App): MatchPrefsDebug | null {
  const s = gameScene(app);
  if (!s) return null;
  const base = s.matchPrefsDebug;
  const f = fakeMenu;
  return {
    ...base,
    menu: f
      ? { open: f.open, opens: f.opens, closes: f.closes, fake: true }
      : { open: matchMenu.isOpen(), opens: 0, closes: 0, fake: false },
  };
}

/** 터치 기기 칩의 맵 왼쪽 끝에서 띄우는 거리 (CSS px) */
const OVERLAY_MAP_INSET = 6;
/** 터치 기기 칩의 화면(안전 영역) 위쪽에서 띄우는 거리 (CSS px) */
const OVERLAY_TOP_INSET = 2;

/**
 * 터치 기기의 칩 자리: 맵 사각형 왼쪽 끝 바로 안 · 화면 맨 위. 늘 떠 있는 판 HUD(타이머 · 게이지 · 팀 카드 · 미니맵)는
 * 맵 밖 기둥에 있고(m12-screen이 맵과 겹치지 않음을 본다), 이동 영역은 왼쪽 HUD 아래에서 시작하고, 시스템 버튼 ·
 * 엄지 버튼은 오른쪽이라 여기에 닿지 않는다. 배너 · 메모는 맵 위쪽 가운데에 뜨지만 칩 높이(약 20px)보다 아래에서 시작한다.
 * 태블릿(맵 위 HUD 띠)은 띠 가운데의 타이머와 왼쪽 끝 게이지 사이다. PC는 null(CSS 기본: 왼쪽 아래)
 */
function overlayAnchor(app: App): OverlayAnchor | null {
  if (!device.touch) return null;
  const canvas = app.game?.canvas;
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  if (rect.height <= 0) return null;
  const k = rect.height / VIEW_H;
  return { left: rect.left + MAP_RECT.x * k + OVERLAY_MAP_INSET, top: rect.top + OVERLAY_TOP_INSET };
}

/** 오버레이 늦은 프레임 비율 그릇 (4Hz로 다시 쓴다) */
const LATE_WINDOW: FrameWindow = { fps: 0, intervalAvg: 0, workP95: 0, frames: 0, late: 0 };
const LATE_AT = { periodMs: 1000 / 60, slackMs: 1000 / 120 };

/** 최근 1초 늦은 프레임 비율 (지금 목표 주기 + 반 vsync 기준, 렌더한 프레임이 없으면 null) */
function lateRatio(): number | null {
  lateWindowFor(gfxState.targetHz, gfxState.displayHz, LATE_AT);
  const w = sessionFrameStats.window(FPS_WINDOW_MS, LATE_WINDOW, LATE_AT);
  return w.frames > 1 ? w.late : null;
}

function overlayData(app: App, hook: DecoyDebug): DebugOverlayData {
  const renderer = hook.renderer;
  return {
    stats: frameStatsInfo(),
    late: lateRatio(),
    targetHz: gfxState.targetHz,
    displayHz: gfxState.displayHz,
    frameLimit: gfxState.frameLimit,
    ping: app.link.rtt,
    lag: app.params.lag,
    tick: app.lastSnap?.tick ?? null,
    snapCount: app.snapCount,
    correction: app.predictor?.lastCorrection ?? 0,
    pending: app.predictor?.pendingCount ?? 0,
    inputMode: hook.inputMode,
    renderer: renderer === 'webgl' || renderer === 'canvas' ? renderer : 'none',
    quality: gfxState.quality,
    qualitySource: gfxState.qualitySource,
    adapt: String(gfxState.features.autoDowngrade ?? '-'),
    dpr: gfxState.dpr,
    zoom: gfxState.zoom,
    backingW: gfxState.backingW,
    backingH: gfxState.backingH,
    balanceHash: app.balanceHash,
  };
}

/**
 * 그리기 호출 수를 프레임 측정에 넣는다 (오버레이를 켰을 때만). WebGL: Phaser 컨텍스트의 그리기 호출을 세고 POST_RENDER마다
 * 읽고 비운다(한 걸음 = 갱신 중 렌더 텍스처 그리기 + 렌더 + 마지막 flush). Canvas: Phaser가 그 프레임에 그린 객체 수
 */
function watchDrawCalls(app: App): void {
  const game = app.game;
  if (!game) return;
  const start = (): void => {
    const r = game.renderer;
    if (r instanceof Phaser.Renderer.WebGL.WebGLRenderer) {
      const counter = installDrawCounter(r.gl, (n) => sessionFrameStats.setDrawCalls(n));
      game.events.on(Phaser.Core.Events.POST_RENDER, () => {
        counter.endCount();
        counter.beginCount();
      });
    } else if (r instanceof Phaser.Renderer.Canvas.CanvasRenderer) {
      game.events.on(Phaser.Core.Events.POST_RENDER, () => sessionFrameStats.setDrawCalls(r.drawCount));
    }
  };
  if (game.isBooted) start();
  else game.events.once(Phaser.Core.Events.READY, start);
}

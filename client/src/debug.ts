// window.__DECOY__ 디버그 훅과 ?debug=1 오버레이 (FPS, 핑, 서버 틱, 예측 오차)
import Phaser from 'phaser';
import type { DecoyDebug, HudLayout, TouchTarget } from '@decoy/shared';
import type { App } from './app';
import { sfx } from './audio';
import { freezeGfxClock, gfxState, probeSlot, setFpsOverride } from './gfx/state';
import type { GameScene } from './scenes/GameScene';
import { MAP_RECT, VIEW_H, VIEW_W, layout, tileToScreen } from './ui/layout';
import { fontState, uiFontsReady } from './ui/fonts';
import { auditTexts } from './ui/text';

declare global {
  interface Window {
    __DECOY__?: DecoyDebug;
  }
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
  };
}

export function installDebug(app: App, overlay: boolean): void {
  const hook: DecoyDebug = {
    get gfx() {
      return { ...gfxState, features: { ...gfxState.features } };
    },
    freezeClock: (ms) => freezeGfxClock(ms),
    injectFps: (fps) => setFpsOverride(fps),
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
  };
  window.__DECOY__ = hook;
  if (!overlay) return;
  const box = document.createElement('div');
  box.id = 'debug-overlay';
  document.body.appendChild(box);
  window.setInterval(() => {
    const snap = app.lastSnap;
    box.textContent = [
      `FPS ${hook.fps.toFixed(0)}  렌더러 ${hook.renderer}`,
      `핑 ${hook.ping.toFixed(0)}ms  지연설정 ${app.params.lag}ms`,
      `서버 틱 ${snap?.tick ?? '-'}  스냅샷 ${app.snapCount}`,
      `예측 대기 ${hook.pendingInputs}  보정 ${hook.correction.toFixed(3)}타일  입력 ${hook.inputMode}`,
      `밸런스 ${app.balanceHash}`,
      `그래픽 ${gfxState.quality}(${gfxState.qualitySource})  배율 ${gfxState.zoom.toFixed(2)}  ${gfxState.backingW}×${gfxState.backingH}  자동 하향 ${String(gfxState.features.autoDowngrade ?? '-')}`,
    ].join('\n');
  }, 250);
}

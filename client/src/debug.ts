// window.__DECOY__ 디버그 훅과 ?debug=1 오버레이 (FPS, 핑, 서버 틱, 예측 오차)
import Phaser from 'phaser';
import type { DecoyDebug } from '@decoy/shared';
import type { App } from './app';
import type { GameScene } from './scenes/GameScene';
import { VIEW_H, VIEW_W, tileToScreen } from './ui/layout';

declare global {
  interface Window {
    __DECOY__?: DecoyDebug;
  }
}

function gameScene(app: App): GameScene | null {
  const scene = app.game?.scene.getScene('game') as GameScene | undefined;
  return scene && scene.sys.isActive() ? scene : null;
}

export function installDebug(app: App, overlay: boolean): void {
  const hook: DecoyDebug = {
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
      return app.net.rtt;
    },
    get serverOffset() {
      return app.net.offset;
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
    getResult: () => app.result,
    getLastInput: () => gameScene(app)?.lastFrame ?? null,
    serverNow: () => app.net.serverNow(),
    sendTest: (cmd) => app.net.send({ t: 'test', cmd }),
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
      `예측 대기 ${hook.pendingInputs}  보정 ${hook.correction.toFixed(3)}타일`,
      `밸런스 ${app.balanceHash}`,
    ].join('\n');
  }, 250);
}

// DECOY 클라이언트 진입점
import Phaser from 'phaser';
import { App, readParams } from './app';
import { installDebug } from './debug';
import { GameScene } from './scenes/GameScene';
import { VIEW_H, VIEW_W, fitCamera, setRenderScale } from './ui/layout';

const params = readParams(window.location.search);
const uiRoot = document.getElementById('ui-root') ?? document.body;
const app = new App(params, uiRoot);
setRenderScale(params.renderScale);

function rendererType(): number {
  if (params.renderer === 'canvas') return Phaser.CANVAS;
  if (params.renderer === 'webgl') return Phaser.WEBGL;
  return Phaser.AUTO;
}

class IdleScene extends Phaser.Scene {
  constructor() {
    super('idle');
  }
  create(): void {
    fitCamera(this.cameras.main);
  }
}

const game = new Phaser.Game({
  type: rendererType(),
  parent: 'game-root',
  backgroundColor: '#0B1622',
  banner: false,
  disableContextMenu: true,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: Math.round(VIEW_W * params.renderScale),
    height: Math.round(VIEW_H * params.renderScale),
  },
  fps: { target: 60 },
  // 카메라 배경색이 매 프레임 화면 전체를 칠하므로 따로 지우지 않는다. 정수 좌표로 그려 비트맵 복사를 싸게
  render: { clearBeforeRender: false },
  scene: [IdleScene, GameScene],
});
app.game = game;

app.subscribe((e) => {
  if (e.kind === 'match') {
    game.scene.stop('game');
    game.scene.start('game', { app });
  } else if (e.kind === 'lobby' && e.lobby.phase === 'lobby') {
    if (game.scene.isActive('game')) game.scene.stop('game');
  }
});

if (params.debug !== 'off' || import.meta.env.DEV) installDebug(app, params.debug === 'overlay');
app.start();

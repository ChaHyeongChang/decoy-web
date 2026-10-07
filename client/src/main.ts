// DECOY 클라이언트 진입점
import Phaser from 'phaser';
import { App, readParams } from './app';
import { installDebug } from './debug';
import { GameScene } from './scenes/GameScene';
import { VIEW_H, VIEW_W } from './ui/layout';

const params = readParams(window.location.search);
const uiRoot = document.getElementById('ui-root') ?? document.body;
const app = new App(params, uiRoot);

function rendererType(): number {
  if (params.renderer === 'canvas') return Phaser.CANVAS;
  if (params.renderer === 'webgl') return Phaser.WEBGL;
  return Phaser.AUTO;
}

class IdleScene extends Phaser.Scene {
  constructor() {
    super('idle');
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
    width: VIEW_W,
    height: VIEW_H,
  },
  fps: { target: 60 },
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

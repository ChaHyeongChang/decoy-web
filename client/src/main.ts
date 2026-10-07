// DECOY 클라이언트 진입점
import Phaser from 'phaser';

const params = new URLSearchParams(window.location.search);

function pickRenderer(): number {
  const r = params.get('renderer');
  if (r === 'canvas') return Phaser.CANVAS;
  if (r === 'webgl') return Phaser.WEBGL;
  return Phaser.AUTO;
}

class BootScene extends Phaser.Scene {
  constructor() {
    super('boot');
  }
  create(): void {
    this.add
      .text(960, 540, 'DECOY', { fontFamily: 'sans-serif', fontSize: '96px', color: '#22D3EE' })
      .setOrigin(0.5);
  }
}

const game = new Phaser.Game({
  type: pickRenderer(),
  parent: 'game-root',
  backgroundColor: '#0B1622',
  banner: false,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: 1920,
    height: 1080,
  },
  scene: [BootScene],
});

if (params.has('debug')) {
  (window as unknown as { __DECOY_GAME__: Phaser.Game }).__DECOY_GAME__ = game;
}

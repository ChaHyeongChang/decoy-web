// Phaser 사용자 빌드 (코어 + 쓰는 게임 오브젝트만)
import Phaser from 'phaser/src/phaser-core.js';
import Container from 'phaser/src/gameobjects/container/Container.js';
import Blitter from 'phaser/src/gameobjects/blitter/Blitter.js';
import Rectangle from 'phaser/src/gameobjects/shape/rectangle/Rectangle.js';
import 'phaser/src/gameobjects/container/ContainerFactory.js';
import 'phaser/src/gameobjects/container/ContainerCreator.js';
import 'phaser/src/gameobjects/blitter/BlitterFactory.js';
import 'phaser/src/gameobjects/blitter/BlitterCreator.js';
import 'phaser/src/gameobjects/shape/rectangle/RectangleFactory.js';
Phaser.GameObjects.Container = Container;
Phaser.GameObjects.Blitter = Blitter;
Phaser.GameObjects.Rectangle = Rectangle;
export default Phaser;

// Phaser 사용자 빌드 (배포 빌드만 — client/vite.config.ts가 'phaser'를 이 파일로 바꾼다).
// phaser/src/phaser-core.js와 같은 짜임에서 이 게임이 쓰지 않는 것을 뺐다 (번들 줄이기, DECISIONS 11절 '번들 줄이기'):
//  - 로더(Loader · 파일 형식) · 트윈(TweenManager) · 시계(Clock) · 데이터 플러그인 · 씬 입력 플러그인(InputPlugin — 누르기 판정 ·
//    끌기 · 키보드 · 게임패드) · 스프라이트 · 애니메이션 이름 공간 · FX 컨트롤러. 그림은 모두 코드로 그려 텍스처로 올리고(파일을
//    받지 않는다), 움직임은 우리 코드가 프레임 간격으로 적분하며, 키보드 · 터치 입력은 DOM에서 직접 읽는다(input.ts · touchInput.ts).
//    판 장면의 마우스 조준은 게임 입력 관리자(game.input — Phaser.Game이 늘 만든다)의 포인터를 읽는다
//  - 씬 기본 플러그인 목록(DefaultScene)의 Clock · DataManagerPlugin · InputPlugin · Loader · TweenManager는 모듈을 불러오지 않으면
//    등록되지 않아 씬에 붙지 않는다(PluginManager.addToScene이 등록된 것만 붙인다) — scene.time · scene.data · scene.input ·
//    scene.load · scene.tweens 없음
//  - 미리 FX(preFX) · FX 파이프라인 셰이더는 vite.config.ts가 빈 모듈로 바꾸고, 게임 설정에서 disablePreFX · disablePostFX를 켠다
//    (main.ts). 우리 후처리(effects.ts WorldGradePipeline)는 PostFXPipeline을 직접 이어받아 그대로다
// 우리 코드가 쓰는 이름 공간 칸만 남긴다. 새 Phaser 기능을 쓰려면 여기에 더한다 (개발 서버는 전체 Phaser라 거기서는 된다 —
// 배포 빌드로 도는 E2E가 잡는다)
import 'phaser/src/polyfills/requestVideoFrame.js';
import CONST from 'phaser/src/const.js';
import Extend from 'phaser/src/utils/object/Extend.js';
import BlendModes from 'phaser/src/renderer/BlendModes.js';
import ScaleModes from 'phaser/src/renderer/ScaleModes.js';
import Scene2D from 'phaser/src/cameras/2d/index.js';
import Core from 'phaser/src/core/index.js';
import Class from 'phaser/src/utils/Class.js';
import Events from 'phaser/src/events/index.js';
import Game from 'phaser/src/core/Game.js';
import Plugins from 'phaser/src/plugins/index.js';
import Renderer from 'phaser/src/renderer/index.js';
import Scale from 'phaser/src/scale/index.js';
import Scene from 'phaser/src/scene/Scene.js';
import Scenes from 'phaser/src/scene/index.js';
import Textures from 'phaser/src/textures/index.js';
import Vector2 from 'phaser/src/math/Vector2.js';
// 씬 핵심 플러그인(DisplayList · UpdateList · GameObjectCreator · GameObjectFactory)은 모듈을 불러올 때 스스로 등록된다 —
// 아래 import가 그 등록을 겸한다 (EventEmitter · CameraManager · ScenePlugin은 위 events · cameras · scene에서)
import DisplayList from 'phaser/src/gameobjects/DisplayList.js';
import UpdateList from 'phaser/src/gameobjects/UpdateList.js';
import GameObjectCreator from 'phaser/src/gameobjects/GameObjectCreator.js';
import GameObjectFactory from 'phaser/src/gameobjects/GameObjectFactory.js';
import Components from 'phaser/src/gameobjects/components/index.js';
import BuildGameObject from 'phaser/src/gameobjects/BuildGameObject.js';
import GameObject from 'phaser/src/gameobjects/GameObject.js';
import Blitter from 'phaser/src/gameobjects/blitter/Blitter.js';
import Container from 'phaser/src/gameobjects/container/Container.js';
import Graphics from 'phaser/src/gameobjects/graphics/Graphics.js';
import Image from 'phaser/src/gameobjects/image/Image.js';
import Layer from 'phaser/src/gameobjects/layer/Layer.js';
import Rectangle from 'phaser/src/gameobjects/shape/rectangle/Rectangle.js';
import Text from 'phaser/src/gameobjects/text/Text.js';
// 만들기 함수 등록 (scene.add.* · scene.make.*)
import 'phaser/src/gameobjects/blitter/BlitterFactory.js';
import 'phaser/src/gameobjects/blitter/BlitterCreator.js';
import 'phaser/src/gameobjects/container/ContainerFactory.js';
import 'phaser/src/gameobjects/container/ContainerCreator.js';
import 'phaser/src/gameobjects/graphics/GraphicsFactory.js';
import 'phaser/src/gameobjects/graphics/GraphicsCreator.js';
import 'phaser/src/gameobjects/image/ImageFactory.js';
import 'phaser/src/gameobjects/image/ImageCreator.js';
import 'phaser/src/gameobjects/layer/LayerFactory.js';
import 'phaser/src/gameobjects/layer/LayerCreator.js';
import 'phaser/src/gameobjects/shape/rectangle/RectangleFactory.js';
import 'phaser/src/gameobjects/text/TextFactory.js';
import 'phaser/src/gameobjects/text/TextCreator.js';

const Phaser = Extend(
  false,
  {
    BlendModes,
    Cameras: { Scene2D },
    Core,
    Class,
    Events,
    Game,
    GameObjects: {
      DisplayList,
      UpdateList,
      GameObjectCreator,
      GameObjectFactory,
      Components,
      BuildGameObject,
      GameObject,
      Blitter,
      Container,
      Graphics,
      Image,
      Layer,
      Rectangle,
      Text,
    },
    Math: { Vector2 },
    Plugins,
    Renderer,
    Scale,
    ScaleModes,
    Scene,
    Scenes,
    Textures,
  },
  CONST,
);

globalThis.Phaser = Phaser;

export default Phaser;

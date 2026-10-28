// Phaser 사용자 빌드 지키기 (배포 빌드): 배포 빌드는 'phaser'를 코어 + 쓰는 게임 오브젝트만 담은 client/src/phaserCore.js로 바꾼다
// (vite.config.ts). 개발 서버 · 단위 시험은 전체 Phaser를 써서, 코어에 없는 것(예: Phaser.Geom.Rectangle)을 값으로 쓰면 배포
// 빌드에서만 시작하자마자 멈춘다(따라가는 카메라 PR에서 실제로 났다). 클라이언트 코드가 값으로 쓰는 Phaser.* 경로가 모두
// 사용자 빌드에 있는지 본다
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';

const CORE = 'client/src/phaserCore.js';

/**
 * phaserCore.js의 `Extend(false, { ... }, CONST)` 객체에서 붙은 경로(그 아래는 모두 있다). 줄임 속성(`Game,`)과
 * `Name: 식별자`는 잎, `Name: { ... }`는 중첩이다. 구문 트리로 읽는다
 */
function coreLeaves(): Set<string> {
  const src = readFileSync(CORE, 'utf8');
  const sf = ts.createSourceFile(CORE, src, ts.ScriptTarget.Latest, true);
  let root: ts.ObjectLiteralExpression | null = null;
  const find = (n: ts.Node): void => {
    if (
      ts.isCallExpression(n) &&
      ts.isIdentifier(n.expression) &&
      n.expression.text === 'Extend' &&
      n.arguments.length === 3 &&
      n.arguments[1] !== undefined &&
      ts.isObjectLiteralExpression(n.arguments[1]) &&
      n.arguments[2] !== undefined &&
      ts.isIdentifier(n.arguments[2]) &&
      n.arguments[2].text === 'CONST'
    )
      root = n.arguments[1];
    ts.forEachChild(n, find);
  };
  find(sf);
  if (root === null) throw new Error('phaserCore.js 구조가 바뀌었다 (Extend(false, { ... }, CONST))');
  const leaves = new Set<string>();
  const walk = (obj: ts.ObjectLiteralExpression, prefix: string[]): void => {
    for (const p of obj.properties) {
      if (ts.isShorthandPropertyAssignment(p)) leaves.add([...prefix, p.name.text].join('.'));
      else if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name)) {
        if (ts.isObjectLiteralExpression(p.initializer)) walk(p.initializer, [...prefix, p.name.text]);
        else leaves.add([...prefix, p.name.text].join('.'));
      } else throw new Error(`phaserCore.js: 읽지 못하는 칸 ${p.getText()}`);
    }
  };
  walk(root, ['Phaser']);
  // 상수(AUTO · CANVAS · WEBGL …)
  const consts = readFileSync('node_modules/phaser/src/const.js', 'utf8');
  for (const m of consts.matchAll(/^ {4}([A-Z_0-9]+):/gm)) leaves.add(`Phaser.${m[1] ?? ''}`);
  return leaves;
}

/**
 * 붙은 묶음 안이지만 사용자 빌드가 빈 모듈로 바꾼 것 (vite.config.ts PHASER_STUBS — 미리 FX · FX 파이프라인).
 * 값으로 쓰면 배포 빌드에서만 멈춘다
 */
const STUBBED: readonly string[] = [
  'Phaser.Renderer.WebGL.Pipelines.FX',
  'Phaser.Renderer.WebGL.Pipelines.FXPipeline',
  'Phaser.Renderer.WebGL.Pipelines.PreFXPipeline',
];

/** 사용자 빌드가 등록하는 만들기 함수 (scene.add.* · scene.make.*, GameObjectFactory.existing 포함) */
function registeredFactories(): Set<string> {
  const src = readFileSync(CORE, 'utf8');
  const names = new Set(['existing']);
  for (const m of src.matchAll(/gameobjects\/[a-z/]+\/([A-Za-z]+)(?:Factory|Creator)\.js'/g))
    names.add((m[1] ?? '').charAt(0).toLowerCase() + (m[1] ?? '').slice(1));
  return names;
}

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...tsFiles(p));
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

/**
 * 소스 하나에서 값으로 쓰는 Phaser 경로: TypeScript 구문 트리에서 `Phaser`로 시작하는 속성 접근 식(가장 바깥 사슬)을 모은다.
 * 타입 자리(`: Phaser.X` · `as Phaser.X` · `<Phaser.X>` · `type T = Phaser.X` · 타입 안 `typeof`)는 QualifiedName이라 저절로
 * 빠진다. `implements`와 인터페이스 `extends`는 타입이라 빼고, 클래스 `extends`는 모듈을 읽을 때 값으로 쓰여 넣는다.
 * (검토 반영: 예전 정규식은 객체 값 · 화살표 본문 · 문장 시작 · 클래스 extends를 놓쳤다)
 */
function scanSource(file: string, src: string): { file: string; path: string }[] {
  const uses: { file: string; path: string }[] = [];
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
  /** 식별자 Phaser에서 시작하는 순수 속성 접근 사슬이면 'Phaser.A.B', 아니면 null */
  const chain = (n: ts.Expression): string | null => {
    if (ts.isIdentifier(n)) return n.text === 'Phaser' ? 'Phaser' : null;
    if (ts.isPropertyAccessExpression(n)) {
      const head = chain(n.expression);
      return head === null ? null : `${head}.${n.name.text}`;
    }
    return null;
  };
  const typeOnlyHeritage = (n: ts.Node): boolean => {
    const clause = n.parent;
    if (!ts.isExpressionWithTypeArguments(n) || !clause || !ts.isHeritageClause(clause)) return false;
    return clause.token === ts.SyntaxKind.ImplementsKeyword || ts.isInterfaceDeclaration(clause.parent);
  };
  const visit = (n: ts.Node): void => {
    if (typeOnlyHeritage(n)) return;
    if (ts.isPropertyAccessExpression(n)) {
      const outer = ts.isPropertyAccessExpression(n.parent) && n.parent.expression === n;
      const path = outer ? null : chain(n);
      if (path !== null) {
        uses.push({ file, path });
        return;
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return uses;
}

/** 클라이언트 코드(Phaser를 들여오는 파일)가 값으로 쓰는 Phaser 경로 */
function valueUses(): { file: string; path: string }[] {
  const uses: { file: string; path: string }[] = [];
  for (const file of tsFiles('client/src')) {
    const src = readFileSync(file, 'utf8');
    if (!/^import Phaser from 'phaser';$/m.test(src)) continue;
    uses.push(...scanSource(file, src));
  }
  return uses;
}

/** 사용자 빌드가 불러오지 않아 씬에 붙지 않는 기본 플러그인 (scene.tweens · scene.time · scene.load · scene.input · scene.data · scene.lights) */
const DROPPED_SCENE_PLUGINS: ReadonlySet<string> = new Set([
  'tweens',
  'time',
  'load',
  'input',
  'data',
  'lights',
]);

/**
 * 소스 하나에서 사용자 빌드에 없는 Phaser 기능을 쓰는 곳: Phaser.Scene을 이어받은 클래스의 `this.<빠진 플러그인>`,
 * `scene.<빠진 플러그인>` · `.scene.<…>` · `.sys.<…>`, 등록하지 않은 만들기 함수 `.add.<이름>` · `.make.<이름>`,
 * 누르기 판정(`setInteractive` — 씬 입력 플러그인), 기본 FX 추가(`.preFX.add…` · `.postFX.add…`)
 */
function scanMissingFeatures(file: string, src: string, factories: ReadonlySet<string>): string[] {
  const out: string[] = [];
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
  const sceneClass = (n: ts.Node): boolean =>
    ts.isClassDeclaration(n) &&
    (n.heritageClauses ?? []).some((h) => h.types.some((t) => t.expression.getText(sf) === 'Phaser.Scene'));
  const visit = (n: ts.Node, inScene: boolean): void => {
    const scene = inScene || sceneClass(n);
    if (ts.isPropertyAccessExpression(n)) {
      const name = n.name.text;
      const left = n.expression;
      const where = `${file}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`;
      if (DROPPED_SCENE_PLUGINS.has(name)) {
        const sceneLike =
          (scene && left.kind === ts.SyntaxKind.ThisKeyword) ||
          (ts.isIdentifier(left) && left.text === 'scene') ||
          (ts.isPropertyAccessExpression(left) && (left.name.text === 'scene' || left.name.text === 'sys'));
        if (sceneLike) out.push(`${where} ${n.getText(sf)}`);
      }
      if (ts.isPropertyAccessExpression(left) && (left.name.text === 'add' || left.name.text === 'make'))
        if (!factories.has(name)) out.push(`${where} ${n.getText(sf)}`);
      if (name === 'setInteractive') out.push(`${where} ${n.getText(sf)}`);
      if (
        name.startsWith('add') &&
        ts.isPropertyAccessExpression(left) &&
        (left.name.text === 'preFX' || left.name.text === 'postFX')
      )
        out.push(`${where} ${n.getText(sf)}`);
    }
    ts.forEachChild(n, (c) => visit(c, scene));
  };
  visit(sf, false);
  return out;
}

describe('Phaser 사용자 빌드 (배포 빌드)', () => {
  const leaves = coreLeaves();
  const has = (path: string): boolean => {
    if (STUBBED.some((x) => path === x || path.startsWith(`${x}.`))) return false;
    const parts = path.split('.');
    for (let n = 2; n <= parts.length; n += 1) if (leaves.has(parts.slice(0, n).join('.'))) return true;
    return false;
  };

  it('코어 목록을 읽는다 (구조가 바뀌면 이 시험부터 고친다)', () => {
    expect(leaves.has('Phaser.Game')).toBe(true);
    expect(leaves.has('Phaser.GameObjects.Image')).toBe(true);
    expect(leaves.has('Phaser.Math.Vector2')).toBe(true);
    expect(leaves.has('Phaser.Renderer')).toBe(true);
    expect(leaves.has('Phaser.WEBGL')).toBe(true);
    expect(leaves.has('Phaser.GameObjects.Container')).toBe(true);
    // 사용자 빌드에 없는 것 (예전 실수 · 번들 줄이기에서 뺀 것)
    expect(has('Phaser.Geom.Rectangle')).toBe(false);
    expect(has('Phaser.Math.Clamp')).toBe(false);
    expect(has('Phaser.GameObjects.Sprite')).toBe(false);
    expect(has('Phaser.Tweens.TweenManager')).toBe(false);
    expect(has('Phaser.Loader.LoaderPlugin')).toBe(false);
    expect(has('Phaser.Renderer.WebGL.Pipelines.FXPipeline')).toBe(false);
    expect(has('Phaser.Renderer.WebGL.Pipelines.PostFXPipeline')).toBe(true);
    expect(registeredFactories()).toEqual(
      new Set(['existing', 'blitter', 'container', 'graphics', 'image', 'layer', 'rectangle', 'text']),
    );
  });

  it('스캔: 값 자리는 모두 잡고 타입 자리는 뺀다', () => {
    const src = [
      "import Phaser from 'phaser';",
      'const a = { alpha: Phaser.Math.Clamp(1, 0, 1) };',
      'const f = (v: number): number => Phaser.Math.Between(v, 0);',
      'Phaser.Utils.Array.Shuffle([]);',
      'const t = a ? 1 : Phaser.Scale.FIT;',
      'class Z extends Phaser.GameObjects.Zone {}',
      'const r = new Phaser.Geom.Rectangle();',
      'if (r instanceof Phaser.GameObjects.Image) void 0;',
      'const arr = [Phaser.BlendModes.ADD, `${Phaser.VERSION}`];',
      'let x: Phaser.Geom.Circle | null = null;',
      'type T = Phaser.Math.Vector2;',
      'const y = x as Phaser.GameObjects.Sprite | null;',
      'interface I extends Phaser.Types.Core.GameConfig {}',
      'class W implements Phaser.Types.Input.InputConfiguration {}',
      'const s = new Set<Phaser.GameObjects.Text>();',
    ].join('\n');
    const got = scanSource('x.ts', src).map((u) => u.path);
    expect(got).toEqual([
      'Phaser.Math.Clamp',
      'Phaser.Math.Between',
      'Phaser.Utils.Array.Shuffle',
      'Phaser.Scale.FIT',
      'Phaser.GameObjects.Zone',
      'Phaser.Geom.Rectangle',
      'Phaser.GameObjects.Image',
      'Phaser.BlendModes.ADD',
      'Phaser.VERSION',
    ]);
  });

  it('클라이언트 코드가 값으로 쓰는 Phaser 경로가 모두 사용자 빌드에 있다', () => {
    const uses = valueUses();
    // 스캔이 실제로 무언가를 찾는지 (new Phaser.Game · instanceof Phaser.GameObjects.Image · class extends Phaser.Scene 등)
    expect(uses.some((u) => u.path === 'Phaser.Game')).toBe(true);
    expect(uses.some((u) => u.path === 'Phaser.Scene')).toBe(true);
    expect(uses.some((u) => u.path.startsWith('Phaser.GameObjects.'))).toBe(true);
    const missing = uses.filter((u) => !has(u.path)).map((u) => `${u.file}: ${u.path}`);
    expect(missing).toEqual([]);
  });
  it('빠진 씬 플러그인 · 등록하지 않은 만들기 함수 · 누르기 판정 · 기본 FX를 쓰지 않는다', () => {
    const factories = registeredFactories();
    // 스캔이 잡는지 (반례)
    const bad = [
      "import Phaser from 'phaser';",
      'class S extends Phaser.Scene {',
      '  create(): void {',
      '    this.tweens.add({});',
      '    this.add.sprite(0, 0, "k");',
      '    this.time.delayedCall(1, () => undefined);',
      '  }',
      '}',
      'function f(scene: Phaser.Scene, img: Phaser.GameObjects.Image): void {',
      '  scene.input.on("pointerdown", () => undefined);',
      '  img.setInteractive();',
      '  img.preFX?.addGlow();',
      '  scene.add.image(0, 0, "k");',
      '}',
    ].join('\n');
    expect(scanMissingFeatures('x.ts', bad, factories).map((x) => x.split(' ')[1])).toEqual([
      'this.tweens',
      'this.add.sprite',
      'this.time',
      'scene.input',
      'img.setInteractive',
      'img.preFX?.addGlow',
    ]);
    const found: string[] = [];
    for (const file of tsFiles('client/src')) {
      const src = readFileSync(file, 'utf8');
      if (!/^import Phaser from 'phaser';$/m.test(src)) continue;
      found.push(...scanMissingFeatures(file, src, factories));
    }
    expect(found).toEqual([]);
  });

  it('게임 설정이 미리 FX · 기본 후처리 FX를 끈다 (빈 모듈로 바꾼 FX 파이프라인을 부팅 때 만들지 않게)', () => {
    const main = readFileSync('client/src/main.ts', 'utf8');
    expect(main).toMatch(/^\s*disablePreFX: true,$/m);
    expect(main).toMatch(/^\s*disablePostFX: true,$/m);
    const vite = readFileSync('client/vite.config.ts', 'utf8');
    for (const f of ['renderer/webgl/pipelines/FXPipeline.js', 'renderer/webgl/pipelines/fx/index.js'])
      expect(vite).toContain(`'${f}'`);
  });
});

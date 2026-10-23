// Phaser 사용자 빌드 지키기 (배포 빌드): 배포 빌드는 'phaser'를 코어 + 쓰는 게임 오브젝트만 담은 client/src/phaserCore.js로 바꾼다
// (vite.config.ts). 개발 서버 · 단위 시험은 전체 Phaser를 써서, 코어에 없는 것(예: Phaser.Geom.Rectangle)을 값으로 쓰면 배포
// 빌드에서만 시작하자마자 멈춘다(따라가는 카메라 PR에서 실제로 났다). 클라이언트 코드가 값으로 쓰는 Phaser.* 경로가 모두
// 사용자 빌드에 있는지 본다
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';

/** phaser-core.js의 `var Phaser = { ... }`에서 require로 붙은 경로(그 아래는 모두 있다) */
function coreLeaves(): Set<string> {
  const src = readFileSync('node_modules/phaser/src/phaser-core.js', 'utf8');
  const start = src.indexOf('var Phaser = {');
  const end = src.indexOf('\n};', start);
  if (start < 0 || end < 0) throw new Error('phaser-core.js 구조가 바뀌었다');
  const body = src.slice(start + 'var Phaser = {'.length, end);
  const leaves = new Set<string>();
  const stack: string[] = [];
  // 키: `Name: {` (중첩 열기), `Name: require(...)` (잎), `Name: { Inner: require(...) }` (한 줄 중첩)
  const token = /([A-Za-z0-9_]+)\s*:\s*(\{|require\()|\}/g;
  for (let m = token.exec(body); m; m = token.exec(body)) {
    if (m[0] === '}') {
      stack.pop();
      continue;
    }
    const key = m[1] ?? '';
    if (m[2] === '{') stack.push(key);
    else leaves.add(['Phaser', ...stack, key].join('.'));
  }
  // `Phaser = Extend(false, Phaser, CONST)`: 상수(AUTO · CANVAS · WEBGL …)
  if (!src.includes('Extend(false, Phaser, CONST)')) throw new Error('phaser-core.js 상수 붙이기가 바뀌었다');
  const consts = readFileSync('node_modules/phaser/src/const.js', 'utf8');
  for (const m of consts.matchAll(/^ {4}([A-Z_0-9]+):/gm)) leaves.add(`Phaser.${m[1] ?? ''}`);
  return leaves;
}

/** phaserCore.js가 덧붙인 경로 (`Phaser.GameObjects.Container = Container;`) */
function patched(): Set<string> {
  const src = readFileSync('client/src/phaserCore.js', 'utf8');
  return new Set([...src.matchAll(/^(Phaser\.[A-Za-z0-9_.]+)\s*=/gm)].map((m) => m[1] ?? ''));
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

describe('Phaser 사용자 빌드 (배포 빌드)', () => {
  const leaves = coreLeaves();
  const extra = patched();
  const has = (path: string): boolean => {
    if (extra.has(path)) return true;
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
    expect(extra.has('Phaser.GameObjects.Container')).toBe(true);
    // 코어에 없는 것 (예전 실수)
    expect(has('Phaser.Geom.Rectangle')).toBe(false);
    expect(has('Phaser.Math.Clamp')).toBe(false);
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
});

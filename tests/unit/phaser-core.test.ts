// Phaser 사용자 빌드 지키기 (배포 빌드): 배포 빌드는 'phaser'를 코어 + 쓰는 게임 오브젝트만 담은 client/src/phaserCore.js로 바꾼다
// (vite.config.ts). 개발 서버 · 단위 시험은 전체 Phaser를 써서, 코어에 없는 것(예: Phaser.Geom.Rectangle)을 값으로 쓰면 배포
// 빌드에서만 시작하자마자 멈춘다(따라가는 카메라 PR에서 실제로 났다). 클라이언트 코드가 값으로 쓰는 Phaser.* 경로가 모두
// 사용자 빌드에 있는지 본다
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
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
 * 값으로 쓰는 Phaser 경로 (타입 자리는 뺀다: 바로 앞이 `:` `<` `|` `&` `,`(타입 인자 안) · `as` · `extends` ·
 * `implements` · `typeof` · `keyof`, 또는 `type X =` 오른쪽). 값 자리 = new · instanceof · 호출 · 속성 읽기
 */
function valueUses(): { file: string; path: string }[] {
  const uses: { file: string; path: string }[] = [];
  for (const file of tsFiles('client/src')) {
    const src = readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    if (!/^import Phaser from 'phaser';$/m.test(src)) continue;
    for (const m of src.matchAll(/(new|instanceof)\s+(Phaser(?:\.[A-Za-z0-9_]+)+)/g))
      uses.push({ file, path: m[2] ?? '' });
    // 속성 읽기 · 호출: `= Phaser.Scale.FIT`, `(Phaser.BlendModes.ADD)`, `Phaser.Math.Between(` 처럼 값 자리
    for (const m of src.matchAll(/([=(,?!]|return|\|\||&&)\s*(Phaser(?:\.[A-Za-z0-9_]+)+)/g)) {
      const before = src.slice(Math.max(0, (m.index ?? 0) - 1), m.index ?? 0);
      // `<A, Phaser.X>` 같은 타입 인자 안의 `,`는 타입이다 — 그 앞 문맥이 `<`로 열려 있으면 뺀다
      if (m[1] === ',' && /<[^>()]*$/.test(src.slice(Math.max(0, (m.index ?? 0) - 120), m.index ?? 0)))
        continue;
      if (before === '=' && m[1] === '=') {
        // `type X = Phaser.Y` 는 타입
        const line = src.slice(src.lastIndexOf('\n', m.index ?? 0) + 1, m.index ?? 0);
        if (/\btype\s+\w+\s*$/.test(line)) continue;
      }
      uses.push({ file, path: m[2] ?? '' });
    }
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

  it('클라이언트 코드가 값으로 쓰는 Phaser 경로가 모두 사용자 빌드에 있다', () => {
    const uses = valueUses();
    // 스캔이 실제로 무언가를 찾는지 (new Phaser.Game · instanceof Phaser.GameObjects.Image 등)
    expect(uses.some((u) => u.path === 'Phaser.Game')).toBe(true);
    expect(uses.some((u) => u.path.startsWith('Phaser.GameObjects.'))).toBe(true);
    const missing = uses.filter((u) => !has(u.path)).map((u) => `${u.file}: ${u.path}`);
    expect(missing).toEqual([]);
  });
});

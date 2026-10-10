// 기기 저장 키 검사 (MOBILE_PLAN M12 12번 · 제안 14): localStorage · sessionStorage는 client/src/storageKeys.ts에서만 쓴다.
//  - client/src의 다른 파일에서 쓰면(주석 제외) 실패한다 → 키는 STORAGE_KEYS에 설명 · 보관 기간과 함께 더하고 readKey · writeKey로
//  - 게임 코드 밖에서 혼자 도는 client/public의 HTML · JS(깨우기 화면 등)는 직접 쓸 수밖에 없으므로, 쓰는 키가 목록에 있는지 대조한다
//  - 쿠키 · IndexedDB는 쓰지 않는다 (개인정보 처리방침 "쿠키 없음")
//  - 개인정보 처리방침(client/public/privacy.html, M15)에 모든 키 · 캐시 이름이 나와야 한다 (표 내용 대조는 privacy.test.ts)
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { STORAGE_KEYS, type StorageArea } from '../../client/src/storageKeys';

const SRC = 'client/src';
const PUBLIC = 'client/public';
const PRIVACY = 'client/public/privacy.html';
/** 여기서만 저장소를 직접 만진다 */
const ALLOWED = join(SRC, 'storageKeys.ts');

function walk(dir: string, exts: RegExp): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p, exts));
    else if (exts.test(name)) out.push(p);
  }
  return out;
}

/** 주석을 뺀 코드 (TypeScript 파서로: 문자열 안의 '//'는 그대로 둔다) */
function code(text: string, file: string, js: boolean): string {
  const sf = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    false,
    js ? ts.ScriptKind.JS : ts.ScriptKind.TS,
  );
  return ts.createPrinter({ removeComments: true }).printFile(sf);
}

/** HTML 안 인라인 스크립트들 */
function inlineScripts(html: string): string[] {
  return [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1] ?? '');
}

const STORAGE_RE = /\b(localStorage|sessionStorage)\b/;

interface PublicUse {
  file: string;
  area: StorageArea;
  key: string;
}

/** 공개 파일 코드에서 저장소 사용과 키를 찾는다: storage.getItem(KEY) · setItem · removeItem, KEY는 글자 그대로나 const 상수 */
function publicUses(file: string, src: string): PublicUse[] {
  const consts = new Map<string, string>();
  for (const m of src.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*(['"`])([^'"`]*)\2/g))
    consts.set(m[1]!, m[3]!);
  const uses: PublicUse[] = [];
  for (const m of src.matchAll(
    /\b(localStorage|sessionStorage)\s*\.\s*(getItem|setItem|removeItem)\s*\(\s*([^,)]+)/g,
  )) {
    const raw = m[3]!.trim();
    const lit = /^(['"`])(.*)\1$/.exec(raw);
    const key = lit ? lit[2]! : (consts.get(raw) ?? `?${raw}`);
    uses.push({ file, area: m[1] === 'sessionStorage' ? 'session' : 'local', key });
  }
  // getItem 같은 메서드 말고 다른 방식(storage[key], Object.keys(localStorage) …)으로 쓰면 키를 알 수 없다 → 실패시킨다
  const all = (src.match(/\b(localStorage|sessionStorage)\b/g) ?? []).length;
  if (all !== uses.length)
    uses.push({ file, area: 'local', key: '?(getItem · setItem · removeItem 밖에서 씀)' });
  return uses;
}

function listed(key: string, area: StorageArea): boolean {
  const all = Object.values(STORAGE_KEYS);
  return all.some((k) =>
    'prefix' in k && k.prefix ? key.startsWith(k.key) && k.area === area : k.key === key && k.area === area,
  );
}

describe('기기 저장 키', () => {
  it('client/src에서 storageKeys.ts 밖의 localStorage · sessionStorage 사용 0건 (주석 제외)', () => {
    const bad: string[] = [];
    for (const f of walk(SRC, /\.(ts|js)$/)) {
      if (f === ALLOWED) continue;
      const c = code(readFileSync(f, 'utf8'), f, f.endsWith('.js'));
      c.split('\n').forEach((line, i) => {
        if (STORAGE_RE.test(line)) bad.push(`${f} (주석 뺀 ${i + 1}줄): ${line.trim()}`);
      });
    }
    expect(bad, 'storageKeys.ts의 readKey · writeKey · removeKey를 쓴다').toEqual([]);
  });

  it('검사가 실제로 잡는다: 주석 속 이름은 통과, 코드 속 사용은 걸림', () => {
    const f = 'x.ts';
    expect(STORAGE_RE.test(code('// localStorage 설명\nconst a = 1; /* sessionStorage */', f, false))).toBe(
      false,
    );
    expect(STORAGE_RE.test(code("const u = 'http://x'; localStorage.getItem('k');", f, false))).toBe(true);
    expect(publicUses('w.html', "const K = 'decoy:x'; sessionStorage.setItem(K, '1');")).toEqual([
      { file: 'w.html', area: 'session', key: 'decoy:x' },
    ]);
    expect(publicUses('w.js', 'for (const k in localStorage) {}')[0]?.key).toMatch(/^\?/);
  });

  it('client/public · index.html의 스크립트가 쓰는 키는 목록에 있다 (영역도 같다)', () => {
    const files = [...walk(PUBLIC, /\.(html|js)$/), 'client/index.html'];
    const uses: PublicUse[] = [];
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      const parts = f.endsWith('.html') ? inlineScripts(text) : [text];
      for (const p of parts) uses.push(...publicUses(f, code(p, f, true)));
    }
    const unknown = uses.filter((u) => !listed(u.key, u.area)).map((u) => `${u.file}: ${u.area} ${u.key}`);
    expect(unknown, 'STORAGE_KEYS에 키 · 설명 · 보관 기간을 더한다').toEqual([]);
    // 깨우기 화면은 지금 쓰고 있다 (검사가 헛돌지 않는지)
    expect(uses.some((u) => u.file.endsWith('wake.html'))).toBe(true);
  });

  it('쿠키 · IndexedDB는 쓰지 않는다', () => {
    const bad: string[] = [];
    const files = [...walk(SRC, /\.(ts|js)$/), ...walk(PUBLIC, /\.(html|js)$/), 'client/index.html'];
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      const parts = f.endsWith('.html') ? inlineScripts(text) : [text];
      for (const p of parts)
        if (/\bdocument\.cookie\b|\bindexedDB\b/.test(code(p, f, !f.endsWith('.ts')))) bad.push(f);
    }
    expect(bad).toEqual([]);
  });

  it('개인정보 처리방침(client/public/privacy.html, M15)에 모든 저장 키 · 캐시 이름이 나온다', () => {
    const doc = readFileSync(PRIVACY, 'utf8');
    const sw = readFileSync(join(PUBLIC, 'sw.js'), 'utf8');
    // 'decoy-wake-v2' · `decoy-shell-${BUILD}` → 'decoy-shell-'
    const caches = [
      ...sw.matchAll(
        /\bconst\s+\w*CACHE\w*\s*=\s*(?:\w+\s*\?\s*)?['`](decoy-[a-z]+-)(?:\$\{|([^'`$]*)['`])/g,
      ),
    ].map((m) => m[1]! + (m[2] ?? ''));
    expect(caches.length).toBeGreaterThanOrEqual(2);
    const keys = Object.values(STORAGE_KEYS).map((k) => k.key);
    const missing = [...keys, ...caches].filter((k) => !doc.includes(k));
    expect(missing).toEqual([]);
  });
});

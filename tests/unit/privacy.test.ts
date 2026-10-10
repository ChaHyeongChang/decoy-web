// M15 개인정보 처리방침 ↔ 코드 대조 (MOBILE_PLAN M15 자동 검증)
//  - ClientMessage(shared/src/types.ts)에서 뽑은 보내는 필드가 대응표(client/src/privacyData.ts)에 빠짐없이 있고,
//    대응표의 이름 · 유형이 처리방침(client/public/privacy.html)과 docs/STORE_LISTING.md 둘 다에 나온다
//  - 기기 저장 키(storageKeys.ts) · 오프라인 캐시 이름(sw.js)이 두 문서에 모두 나온다
//  - 처리방침 문서 형식(lang · 필수 제목 · 스크립트 · 외부 주소 없음 · 문의처 자리), 서버 응답(/privacy · /privacy.html, 문의처 바꿔 넣기)
//  - 외부 전송 없음(정적): 클라이언트 코드 · 공개 파일에 밖으로 가는 주소가 없다(XML 네임스페이스만 허용). 실제 요청은 E2E(m15-privacy)
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import ts from 'typescript';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PROTOCOL_FIELDS, SENT_DATA } from '../../client/src/privacyData';
import { STORAGE_KEYS } from '../../client/src/storageKeys';
import {
  PRIVACY_CONTACT_ENV,
  PRIVACY_PATHS,
  contactHtml,
  privacyHandler,
  renderPrivacy,
} from '../../server/src/privacy';

const PRIVACY = readFileSync('client/public/privacy.html', 'utf8');
const LISTING = readFileSync('docs/STORE_LISTING.md', 'utf8');
const TYPES = 'shared/src/types.ts';

/** ClientMessage 유니온의 각 메시지에서 보내는 필드 ('메시지.필드', 같은 파일 인터페이스 배열은 '메시지.필드.하위필드') */
function clientMessageFields(): { fields: string[]; kinds: string[] } {
  const sf = ts.createSourceFile(TYPES, readFileSync(TYPES, 'utf8'), ts.ScriptTarget.Latest, true);
  const interfaces = new Map<string, ts.InterfaceDeclaration>();
  let union: ts.TypeNode | null = null;
  sf.forEachChild((n) => {
    if (ts.isInterfaceDeclaration(n)) interfaces.set(n.name.text, n);
    if (ts.isTypeAliasDeclaration(n) && n.name.text === 'ClientMessage') union = n.type;
  });
  if (!union || !ts.isUnionTypeNode(union)) throw new Error('ClientMessage 유니온을 찾지 못함');
  const fields: string[] = [];
  const kinds: string[] = [];
  for (const member of (union as ts.UnionTypeNode).types) {
    if (!ts.isTypeLiteralNode(member)) throw new Error('메시지는 객체 타입이어야 한다');
    let kind = '';
    const props: ts.PropertySignature[] = [];
    for (const m of member.members) {
      if (!ts.isPropertySignature(m) || !ts.isIdentifier(m.name)) continue;
      if (m.name.text === 't' && m.type && ts.isLiteralTypeNode(m.type) && ts.isStringLiteral(m.type.literal))
        kind = m.type.literal.text;
      else props.push(m);
    }
    kinds.push(kind);
    for (const p of props) {
      const name = `${kind}.${(p.name as ts.Identifier).text}`;
      const t = p.type;
      const el = t && ts.isArrayTypeNode(t) ? t.elementType : null;
      const iface =
        el && ts.isTypeReferenceNode(el) && ts.isIdentifier(el.typeName)
          ? interfaces.get(el.typeName.text)
          : undefined;
      if (iface) {
        for (const im of iface.members)
          if (ts.isPropertySignature(im) && ts.isIdentifier(im.name)) fields.push(`${name}.${im.name.text}`);
      } else fields.push(name);
    }
  }
  return { fields, kinds };
}

/** 처리방침 표(data-testid)의 칸 글자들 (태그 · 공백 정리) */
function tableCells(html: string, testId: string): string[][] {
  const m = new RegExp(`<table data-testid="${testId}">([\\s\\S]*?)</table>`).exec(html);
  if (!m) return [];
  const body = /<tbody>([\s\S]*?)<\/tbody>/.exec(m[1] ?? '')?.[1] ?? '';
  return [...body.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((r) =>
    [...(r[1] ?? '').matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) =>
      (c[1] ?? '')
        .replace(/<[^>]+>/g, '')
        .replace(/\s+/g, ' ')
        .trim(),
    ),
  );
}

/** STORE_LISTING 표에서 첫 칸이 label인 줄 */
function listingRow(label: string): string | undefined {
  return LISTING.split('\n').find((l) => l.startsWith(`| ${label} |`));
}

function swCacheNames(): string[] {
  const sw = readFileSync('client/public/sw.js', 'utf8');
  // const 이름에 CACHE가 든 선언의 값: 'decoy-wake-v2' · `decoy-shell-${BUILD}` → 접두사 (주석 속 이름은 보지 않는다)
  const names = [
    ...sw.matchAll(/\bconst\s+\w*CACHE\w*\s*=\s*(?:\w+\s*\?\s*)?['`](decoy-[a-z]+-)(?:\$\{|([^'`$]*)['`])/g),
  ].map((m) => (m[1] ?? '') + (m[2] ?? ''));
  return [...new Set(names)];
}

describe('보내는 항목 대응표 (privacyData.ts ↔ ClientMessage)', () => {
  it('ClientMessage의 모든 필드가 대응표에 있고, 대응표에 없는 필드를 적지 않았다', () => {
    const { fields } = clientMessageFields();
    const mapped: string[] = Object.values(SENT_DATA).flatMap((d) => [...d.fields]);
    expect(fields.length).toBeGreaterThan(10);
    expect(
      fields.filter((f) => !mapped.includes(f)),
      '대응표에 없는 보내는 필드',
    ).toEqual([]);
    expect(
      mapped.filter((f) => !fields.includes(f)),
      'ClientMessage에 없는 필드',
    ).toEqual([]);
    expect(new Set(mapped).size).toBe(mapped.length);
    expect(PROTOCOL_FIELDS).toEqual(['t']);
  });

  it('검사가 실제로 잡는다: 입력 프레임은 하위 필드로 펼친다', () => {
    const { fields, kinds } = clientMessageFields();
    expect(fields).toContain('input.frames.aim');
    expect(fields).toContain('join.altTokens');
    expect(fields).not.toContain('input.frames');
    expect(kinds).toContain('leave');
  });

  it('대응표의 이름 · 유형이 처리방침 1번 표와 STORE_LISTING 데이터 보안 표에 모두 나온다', () => {
    const rows = tableCells(PRIVACY, 'sent-data');
    for (const d of Object.values(SENT_DATA)) {
      const row = rows.find((r) => r[0] === d.label);
      expect(row, `처리방침 표에 ${d.label}`).toBeDefined();
      expect(row?.[2], `${d.label} 유형`).toBe(d.playType);
      const line = listingRow(d.label);
      expect(line, `STORE_LISTING 표에 ${d.label}`).toBeDefined();
      expect(line, `${d.label} 유형`).toContain(`| ${d.playType} |`);
    }
    expect(rows.length).toBe(Object.keys(SENT_DATA).length);
  });

  it('확인이 필요한 판단은 문서에도 확인 필요로 표시한다', () => {
    for (const d of Object.values(SENT_DATA))
      if (d.confirm) expect(`${d.playType} ${listingRow(d.label) ?? ''}`).toMatch(/확인 필요/);
  });
});

describe('기기 저장 키 · 캐시 이름 (storageKeys.ts · sw.js ↔ 문서)', () => {
  it('sw.js의 캐시 이름을 찾는다', () => {
    expect(swCacheNames().sort()).toEqual(['decoy-shell-', 'decoy-wake-v2']);
  });

  it('모든 저장 키와 캐시 이름이 처리방침 4번 표와 STORE_LISTING에 나온다 (저장 위치도 맞다)', () => {
    const rows = tableCells(PRIVACY, 'storage-keys');
    const area = { local: '기기 저장소', session: '탭 저장소' } as const;
    for (const k of Object.values(STORAGE_KEYS)) {
      const row = rows.find((r) => r[0]?.startsWith(k.key) && (r[0] === k.key || 'prefix' in k));
      expect(row, `처리방침 표에 ${k.key}`).toBeDefined();
      expect(row?.[1]).toBe(area[k.area]);
      expect(row?.[2]).toBe(k.what);
      expect(row?.[3]).toBe(k.keep);
      const line = LISTING.split('\n').find((l) => l.startsWith(`| \`${k.key}\``));
      expect(line, `STORE_LISTING 표에 ${k.key}`).toContain(`| ${area[k.area]} |`);
    }
    for (const c of swCacheNames()) {
      expect(
        rows.some((r) => r[0]?.startsWith(c) && r[1] === '오프라인 캐시'),
        c,
      ).toBe(true);
      expect(LISTING).toContain(`\`${c}\``);
    }
    expect(rows.length).toBe(Object.keys(STORAGE_KEYS).length + swCacheNames().length);
  });
});

describe('처리방침 문서', () => {
  it('한국어 · 필수 제목(항목 · 목적 · 보관 · 제3자 · 위탁 · 국외 이전 · 파기 · 권리 · 문의처 · 시행일)', () => {
    expect(PRIVACY).toMatch(/<html lang="ko">/);
    expect(PRIVACY).toMatch(/<meta name="viewport"/);
    const h2 = [...PRIVACY.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/g)].map((m) => m[1] ?? '');
    for (const word of [
      '항목',
      '목적',
      '보관',
      '제3자',
      '위탁',
      '국외 이전',
      '파기',
      '권리',
      '문의처',
      '시행일',
    ])
      expect(
        h2.some((t) => t.includes(word)),
        word,
      ).toBe(true);
  });

  it('스크립트 · 외부 자원 없음, 링크는 같은 사이트 안쪽만', () => {
    expect(PRIVACY).not.toMatch(/<script/i);
    expect(PRIVACY).not.toMatch(/\bsrc\s*=/i);
    expect(PRIVACY).not.toMatch(/url\(/i);
    expect(PRIVACY).not.toMatch(/@import/i);
    const hrefs = [...PRIVACY.matchAll(/\bhref\s*=\s*"([^"]*)"/g)].map((m) => m[1] ?? '');
    expect(hrefs.length).toBeGreaterThan(0);
    for (const h of hrefs) expect(h, h).toMatch(/^\/(?!\/)/);
  });

  it('시행일이 머리와 12번에서 같고, 문의처 자리가 한 번 있다', () => {
    const dates = [...PRIVACY.matchAll(/(\d{4})년 (\d{1,2})월 (\d{1,2})일/g)].map((m) => m[0]);
    expect(dates.length).toBeGreaterThanOrEqual(2);
    expect(new Set(dates).size).toBe(1);
    expect(PRIVACY.match(/<!--contact-->/g)?.length).toBe(1);
    expect(PRIVACY.match(/<!--\/contact-->/g)?.length).toBe(1);
  });

  it('서버 보관 사실이 코드와 같다: 방이 비면 60초 (ROOM_IDLE_TIMEOUT_MS)', async () => {
    const { ROOM_IDLE_TIMEOUT_MS } = await import('@decoy/shared/sim');
    expect(PRIVACY).toContain(`${ROOM_IDLE_TIMEOUT_MS / 1000}초 안에`);
    expect(LISTING).toContain(`${ROOM_IDLE_TIMEOUT_MS / 1000}초 안에`);
  });
});

describe('문의처 바꿔 넣기', () => {
  it('이메일이면 mailto 링크, 그 밖은 글자 그대로(이스케이프), 비었거나 너무 길면 null', () => {
    expect(contactHtml('dev@example.com')).toBe('<a href="mailto:dev@example.com">dev@example.com</a>');
    expect(contactHtml('  카카오톡 오픈채팅 "DECOY" ')).toBe('카카오톡 오픈채팅 &quot;DECOY&quot;');
    expect(contactHtml('<script>x</script>')).toBe('&lt;script&gt;x&lt;/script&gt;');
    expect(contactHtml('')).toBeNull();
    expect(contactHtml(undefined)).toBeNull();
    expect(contactHtml('a'.repeat(201))).toBeNull();
  });

  it('문서의 자리만 바꾸고, null이면 원문 그대로', () => {
    const out = renderPrivacy(PRIVACY, contactHtml('dev@example.com'));
    expect(out).toContain(
      '<!--contact--><a href="mailto:dev@example.com">dev@example.com</a><!--/contact-->',
    );
    expect(out).not.toContain("'개발자 연락처'로 문의해 주세요");
    expect(renderPrivacy(PRIVACY, null)).toBe(PRIVACY);
    // $ 같은 바꾸기 특수 문자가 그대로 들어간다
    expect(renderPrivacy('<!--contact-->x<!--/contact-->', '$&$1')).toBe('<!--contact-->$&$1<!--/contact-->');
  });
});

describe('서버 응답 (/privacy · /privacy.html)', () => {
  let dir: string;
  let server: Server;
  let empty: Server;
  let port = 0;
  let emptyPort = 0;

  function listen(handler: ReturnType<typeof privacyHandler>): Promise<[Server, number]> {
    const s = createServer((req, res) => handler(res, req.headers['accept-encoding']));
    return new Promise((resolve) =>
      s.listen(0, '127.0.0.1', () => resolve([s, (s.address() as AddressInfo).port])),
    );
  }

  function get(
    p: number,
    path: string,
    gzip = false,
  ): Promise<{ status: number; headers: Record<string, unknown>; body: Buffer }> {
    return new Promise((resolve, reject) => {
      const req = request(
        { host: '127.0.0.1', port: p, path, headers: gzip ? { 'accept-encoding': 'gzip' } : {} },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () =>
            resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }),
          );
        },
      );
      req.on('error', reject);
      req.end();
    });
  }

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'decoy-privacy-'));
    writeFileSync(join(dir, 'privacy.html'), PRIVACY);
    [server, port] = await listen(privacyHandler(dir, { [PRIVACY_CONTACT_ENV]: 'dev@example.com' }));
    const none = mkdtempSync(join(tmpdir(), 'decoy-privacy-none-'));
    [empty, emptyPort] = await listen(privacyHandler(none, {}));
  });
  afterAll(() => {
    server.close();
    empty.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('두 경로 모두 200 · text/html · no-cache, 문의처가 바뀌어 있다 (압축 받으면 gzip)', async () => {
    expect(PRIVACY_PATHS).toEqual(['/privacy', '/privacy.html']);
    for (const path of PRIVACY_PATHS) {
      const r = await get(port, path);
      expect(r.status, path).toBe(200);
      expect(r.headers['content-type']).toBe('text/html; charset=utf-8');
      expect(r.headers['cache-control']).toBe('no-cache');
      const html = r.body.toString('utf8');
      expect(html).toContain('<html lang="ko">');
      expect(html).toContain('mailto:dev@example.com');
      const z = await get(port, path, true);
      expect(z.headers['content-encoding']).toBe('gzip');
      expect(gunzipSync(z.body).toString('utf8')).toBe(html);
    }
  });

  it('파일이 바뀌면 다시 읽는다', async () => {
    const file = join(dir, 'privacy.html');
    writeFileSync(
      file,
      PRIVACY.replace('DECOY 개인정보 처리방침</h1>', 'DECOY 개인정보 처리방침 (개정)</h1>'),
    );
    const later = new Date(statSync(file).mtimeMs + 5000);
    const { utimesSync } = await import('node:fs');
    utimesSync(file, later, later);
    const r = await get(port, '/privacy');
    expect(r.body.toString('utf8')).toContain('(개정)');
  });

  it('파일이 없으면 404 · 게임 HTML이 아니다', async () => {
    const r = await get(emptyPort, '/privacy');
    expect(r.status).toBe(404);
    expect(String(r.headers['content-type'])).toContain('text/plain');
    expect(r.body.toString('utf8')).not.toContain('<html');
  });
});

describe('외부 전송 없음 (정적 검사)', () => {
  /** XML 네임스페이스 이름은 주소처럼 생겼지만 요청하지 않는다 */
  const ALLOWED = new Set(['http://www.w3.org/2000/svg', 'http://www.w3.org/1999/xlink']);

  function walk(d: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) out.push(...walk(p));
      else if (/\.(ts|js|mjs|html|css|svg|webmanifest|json)$/.test(name)) out.push(p);
    }
    return out;
  }

  it('클라이언트 코드 · 공개 파일 · index.html에 밖으로 가는 주소가 없다 (fetch · WebSocket · src · href · url() 대상 포함)', () => {
    const files = [...walk('client/src'), ...walk('client/public'), 'client/index.html'];
    const bad: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      for (const m of text.matchAll(/\b(?:https?|wss?):\/\/[^\s'"`<>)\\]+/g)) {
        const url = m[0].replace(/[.,;]+$/, '');
        if (!ALLOWED.has(url)) bad.push(`${f}: ${url}`);
      }
      // 주소창 기준 상대가 아닌 '//호스트' (프로토콜 생략)
      for (const m of text.matchAll(/\b(?:src|href)\s*[=:]\s*['"`]\/\/[^'"`]+/g)) bad.push(`${f}: ${m[0]}`);
      for (const m of text.matchAll(/url\(\s*['"]?\/\/[^)]+\)/g)) bad.push(`${f}: ${m[0]}`);
    }
    expect(bad).toEqual([]);
    expect(files.length).toBeGreaterThan(20);
  });

  it('등급 · 데이터 보안 답의 근거: 채팅 메시지 없음 · 광고 · 분석 · 결제 의존성 없음', () => {
    const { kinds } = clientMessageFields();
    expect(kinds.filter((k) => /chat|say|message|emote|voice/i.test(k))).toEqual([]);
    const types = readFileSync(TYPES, 'utf8');
    expect(types).not.toMatch(/t:\s*'(chat|say|whisper|emote)'/);
    const deps: string[] = [];
    for (const p of [
      'package.json',
      'shared/package.json',
      'server/package.json',
      'client/package.json',
      'tests/package.json',
    ]) {
      const j = JSON.parse(readFileSync(p, 'utf8')) as Record<string, Record<string, string> | undefined>;
      deps.push(...Object.keys(j.dependencies ?? {}), ...Object.keys(j.devDependencies ?? {}));
    }
    const banned =
      /ads|admob|adsense|analytics|gtag|firebase|sentry|mixpanel|amplitude|segment|billing|stripe|paypal|purchase|tracking/i;
    expect(deps.filter((d) => banned.test(d))).toEqual([]);
  });
});

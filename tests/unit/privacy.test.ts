// M15 개인정보 처리방침 ↔ 코드 대조 (MOBILE_PLAN M15 자동 검증)
//  - ClientMessage(shared/src/types.ts)에서 뽑은 보내는 필드가 대응표(client/src/privacyData.ts)에 빠짐없이 있고,
//    대응표의 이름 · 유형이 처리방침(client/public/privacy.html)과 docs/STORE_LISTING.md 둘 다에 나온다
//  - 기기 저장 키(storageKeys.ts) · 오프라인 캐시 이름(sw.js)이 두 문서에 모두 나온다
//  - 공개 처리방침에는 초안 표시(확인 필요 · ⚠)가 없다. 사람이 확인할 판단(confirm)은 STORE_LISTING 표 4번째 칸에만
//  - 데이터 보안 양식의 답(form)과 타깃 연령(TARGET_AGE)은 2026-10-13 사용자 결정이다. 대응표 · 처리방침 · STORE_LISTING ·
//    PLAY_STORE_GUIDE 7단계 표가 같은 값을 쓴다
//  - 처리방침 문서 형식(lang · 필수 제목 · 스크립트 · 외부 주소 없음 · 문의처 자리), 사실 문구(보내는 시점 · 처리 근거 ·
//    보관 기간 · 기기 저장 값의 전송), 서버 응답(/privacy · /privacy.html, 문의처 바꿔 넣기)
//  - 외부 전송 없음(정적): 클라이언트 코드 · 공개 파일에 밖으로 가는 주소가 없다(XML 네임스페이스만 허용). 실제 요청은 E2E(m15-privacy)
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import ts from 'typescript';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  PROTOCOL_FIELDS,
  SENT_DATA,
  TARGET_AGE,
  formAnswer,
  type SentDataInfo,
} from '../../client/src/privacyData';
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
const GUIDE = readFileSync('docs/PLAY_STORE_GUIDE.md', 'utf8');
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

/** STORE_LISTING 표 줄의 칸들 */
function listingCells(label: string): string[] {
  return (listingRow(label) ?? '')
    .split('|')
    .slice(1, -1)
    .map((c) => c.trim());
}

/** 태그를 지우고 공백을 하나로 */
function plain(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 처리방침의 한 절 (id가 붙은 h2부터 다음 h2 앞까지) */
function section(id: string): string {
  const at = PRIVACY.indexOf(`<h2 id="${id}">`);
  if (at < 0) throw new Error(`절 없음: ${id}`);
  const next = PRIVACY.indexOf('<h2', at + 1);
  return PRIVACY.slice(at, next < 0 ? undefined : next);
}

/** data-label이 label인 칸의 글자 */
function labeledCell(html: string, label: string): string {
  return plain(new RegExp(`<td data-label="${label}">([\\s\\S]*?)</td>`).exec(html)?.[1] ?? '');
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

  it('공개 처리방침에는 초안 표시(확인 필요 · ⚠)가 없고, 사람이 확인할 판단은 STORE_LISTING 표 4번째 칸에만 적는다', () => {
    expect(PRIVACY).not.toMatch(/확인 필요|⚠/);
    expect(Object.values(SENT_DATA).some((d) => d.confirm)).toBe(true);
    for (const d of Object.values(SENT_DATA)) {
      // 데이터 유형은 처리방침 표에 그대로 나간다
      expect(d.playType, d.label).not.toMatch(/확인 필요|⚠/);
      const cells = listingCells(d.label);
      expect(cells[2], `${d.label} STORE_LISTING 유형 칸`).toBe(d.playType);
      if (d.confirm) expect(cells[3], `${d.label} STORE_LISTING 4번째 칸`).toMatch(/⚠ 확인 필요/);
      else expect(cells[3], `${d.label} STORE_LISTING 4번째 칸`).not.toMatch(/⚠|확인 필요/);
    }
  });

  it('데이터 보안 양식의 답: 신고하는 유형마다 form이 있고 STORE_LISTING 4번째 칸 · PLAY_STORE_GUIDE 7단계 표가 같은 답 글자 (자리 토큰 = 기기 또는 기타 ID, 2026-10-13 결정)', () => {
    for (const d of Object.values(SENT_DATA) as SentDataInfo[]) {
      const declared = d.playType !== '해당 없음';
      expect(d.form !== undefined, `${d.label} form`).toBe(declared);
      if (!d.form) continue;
      const answer = formAnswer(d.form);
      expect(listingCells(d.label)[3], `${d.label} STORE_LISTING 4번째 칸`).toContain(answer);
      const row = GUIDE.split('\n')
        .map((l) => l.trim())
        .find((l) => l.startsWith(`| 데이터 유형 › ${d.playType} `));
      expect(row, `PLAY_STORE_GUIDE 표에 ${d.playType}`).toBeDefined();
      // 같은 유형으로 가는 항목(방 · 역할 선택 · 조작 입력)은 답도 같아야 표 한 줄에 맞는다
      expect(row, `${d.label} 안내서 답`).toContain(`| ${answer} |`);
    }
    // 사용자가 정한 값 그대로 (바꾸려면 사용자 결정 → 네 곳을 함께)
    expect(SENT_DATA.seatToken.playType).toBe('기기 또는 기타 ID');
    expect(formAnswer(SENT_DATA.seatToken.form)).toBe(
      '수집 예 · 공유 아니요 · 필수 · 목적 앱 기능 · 일시적 처리 아니요',
    );
    expect(SENT_DATA.nickname.form).toEqual({ required: false, ephemeral: false });
    // 요약 표의 '수집함' 줄에 신고하는 유형이 모두 나온다
    const summary = LISTING.split('\n').find((l) =>
      l.startsWith('| 필수 데이터 유형을 수집하거나 공유하나요?'),
    );
    expect(summary).toContain('기기 또는 기타 ID');
    expect(LISTING).not.toMatch(/신고하지 않는 것:[^\n]*기기 ID\(/);
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

  it('서버 보관 사실이 코드와 같다: 방이 비면 60초가 지난 뒤 (ROOM_IDLE_TIMEOUT_MS, 끊김을 알아채는 시간이 더 걸릴 수 있다)', async () => {
    const { ROOM_IDLE_TIMEOUT_MS } = await import('@decoy/shared/sim');
    const sec = ROOM_IDLE_TIMEOUT_MS / 1000;
    // 빈 방은 그 시간이 '지난 뒤' 지운다 ('안에'가 아니다 — 갑자기 끊긴 연결은 서버가 알아채는 데 시간이 더 걸린다)
    for (const [name, doc] of [
      ['처리방침', plain(PRIVACY)],
      ['STORE_LISTING', LISTING],
    ] as const) {
      expect(doc, name).toContain(`${sec}초가 지난 뒤`);
      expect(doc, name).not.toContain(`${sec}초 안에`);
      expect(doc, name).toMatch(/알아채는 데 시간이 더 걸릴 수 있/);
    }
  });

  // 수정 검토: 대기 · 결과 화면의 나가기는 그 자리를 바로 지우고, 사람이 남지 않은 방은 방째 바로 지운다(RoomManager.dropIfAbandoned).
  // 문서가 '모두 나가면 60초가 지난 뒤'만 적어 가장 흔한 경로와 달랐다. 코드와 문서 한쪽만 바뀌어도 실패한다
  it('서버 보관 사실이 코드와 같다: 대기 · 결과 화면에서 나가면 그 자리 · 빈 방을 바로 지운다', async () => {
    const { ServerCore } = await import('@decoy/shared/sim');
    const { FakeConn } = await import('../helpers/fakeConn');
    const { loadTestBalance } = await import('../helpers/fixtures');
    const core = new ServerCore({ balance: loadTestBalance(), seed: 3, testHooks: false }, {}, () => 1000);
    const join = (name: string, room: string | null) =>
      JSON.stringify({
        t: 'join',
        room,
        create: room === null,
        name,
        token: null,
        altTokens: [],
        bots: false,
      });
    const a = new FakeConn();
    const b = new FakeConn();
    const la = core.connect(a, (err) => {
      throw err;
    });
    const lb = core.connect(b, (err) => {
      throw err;
    });
    la.receive(join('가', null));
    const code = a.last('welcome')?.room ?? '';
    lb.receive(join('나', code));
    const room = core.manager.rooms.get(code);
    expect(room?.seats.map((x) => x.name)).toEqual(['가', '나']);
    // 시계를 움직이지 않는다: 60초를 기다리지 않고 바로
    lb.receive(JSON.stringify({ t: 'leave' }));
    expect(room?.seats.map((x) => x.name)).toEqual(['가']);
    la.receive(JSON.stringify({ t: 'leave' }));
    expect(core.manager.rooms.size).toBe(0);
    for (const [name, doc] of [
      ['처리방침', plain(PRIVACY)],
      ['STORE_LISTING', LISTING],
    ] as const) {
      expect(doc, name).toMatch(/결과 화면에서 나가면[^.|]*닉네임은 바로 지우고/);
      expect(doc, name).toContain('방째');
    }
  });

  it('보내는 시점이 사실과 같다: 앱을 인터넷에 연결된 상태로 열면 첫 화면 연결(지연 측정값 · IP 주소), 나머지는 온라인 대전에서만', () => {
    expect(PRIVACY).not.toMatch(/온라인 대전을 할 때만/);
    expect(PRIVACY).not.toMatch(/온라인 대전을 하지 않으면 이전되지 않습니다/);
    const when = plain(/<p data-testid="sent-when">([\s\S]*?)<\/p>/.exec(section('items'))?.[1] ?? '');
    expect(when).toMatch(/앱을 인터넷에 연결된 상태로 열면.*지연 측정값/);
    expect(when).toContain('IP 주소');
    // 온라인 대전에서만 보내는 것: 대응표에서 지연 측정값 · 시험 명령을 뺀 나머지 전부
    for (const d of [SENT_DATA.nickname, SENT_DATA.seatToken, SENT_DATA.roomChoice, SENT_DATA.controls])
      expect(when, d.label).toContain(d.label);
    expect(when).toMatch(/온라인 대전[^.]*에서만 보냅니다/);
    // 7번 국외 이전: 시기에 '앱을 … 열 때', 거부 방법은 인터넷을 끈 채 봇과 연습
    const transfer = section('transfer');
    expect(labeledCell(transfer, '시기 · 방법')).toMatch(/앱을[^.]*열 때/);
    const refuse = labeledCell(transfer, '거부');
    expect(refuse).toContain('IP 주소');
    expect(refuse).toMatch(/인터넷을 끈 채[^.]*봇과 연습/);
    // 스토어 문서도 같은 사실
    expect(LISTING).toMatch(/앱을 인터넷에 연결된 상태로 열면[^\n]*지연 측정값[^\n]*IP 주소/);
  });

  it('처리 근거: 2번에 동의 없이 처리하는 항목과 법적 근거(개인정보 보호법 제15조 제1항 제4호), 동의 받는 항목 없음', () => {
    const purpose = plain(section('purpose'));
    expect(purpose).toMatch(/동의 없이/);
    expect(purpose).toMatch(/제15조\s*제1항\s*제4호/);
    expect(purpose).toContain('동의를 받아 처리하는 항목은 없습니다');
    const basis = plain(/<p data-testid="legal-basis">([\s\S]*?)<\/p>/.exec(PRIVACY)?.[1] ?? '');
    // 배포 서버가 받는 항목은 모두 근거 문단에 이름이 나온다 (시험 명령은 배포 서버가 받지 않는다)
    for (const d of Object.values(SENT_DATA))
      if (d !== SENT_DATA.testCommand) expect(basis, d.label).toContain(d.label);
    expect(basis).toContain('IP 주소');
    expect(basis).toMatch(/닉네임은 선택/);
  });

  it('대상 연령: 처리방침 머리 · 2번 · 9번이 만 16세 이상, STORE_LISTING 2.4 · PLAY_STORE_GUIDE가 같은 칸만 고르고 아동 관심 아니요 (2026-10-13 결정)', () => {
    const sentence = `이 서비스는 만 ${TARGET_AGE.minAge}세 이상을 대상으로 합니다`;
    const intro = /<strong data-testid="target-age-intro">([\s\S]*?)<\/strong>/.exec(PRIVACY)?.[1] ?? '';
    expect(plain(intro)).toContain(sentence);
    expect(PRIVACY.indexOf('data-testid="target-age-intro"')).toBeLessThan(PRIVACY.indexOf('<h2'));
    expect(section('purpose')).toContain('<p data-testid="target-age">');
    const age = plain(/<p data-testid="target-age">([\s\S]*?)<\/p>/.exec(PRIVACY)?.[1] ?? '');
    expect(age).toContain(sentence);
    // 처리 근거(동의 없이 처리)와 맞게: 한국법상 아동(만 14세 미만)을 대상으로 하지 않고, 알게 되면 파기
    expect(age).toMatch(/만 14세 미만 아동을 대상으로 하지 않/);
    expect(age).toMatch(/알게 되면[^.]*파기/);
    expect(plain(section('rights'))).toContain(sentence);
    // 만 13세 이상을 대상으로 하던 때의 옛 문구는 없다
    expect(PRIVACY).not.toContain('실명이 아닌 닉네임을 쓰기를 권합니다');

    const at = LISTING.indexOf('### 2.4 타깃 연령층');
    const sec = LISTING.slice(at, LISTING.indexOf('\n### ', at + 1));
    const groups = `**${TARGET_AGE.playGroups.join(', ')}**`;
    expect(sec.split('\n').find((l) => l.startsWith('- 답'))).toContain(groups);
    expect(sec).toContain(sentence);
    const appeal = TARGET_AGE.appealsToChildren ? '**예**' : '**아니요**';
    expect(sec.split('\n').find((l) => l.includes('아동의 관심'))).toContain(appeal);
    const guideRow = (q: string): string =>
      GUIDE.split('\n')
        .map((l) => l.trim())
        .find((l) => l.startsWith(`| ${q} |`)) ?? '';
    for (const g of TARGET_AGE.playGroups) expect(guideRow('타깃 연령층'), g).toContain(`**${g}**`);
    expect(guideRow('앱이 아동의 관심을 끌 수 있나요?')).toContain(appeal);
  });

  it('마지막 방(lastRoom)은 저절로 지우지 않고 다음에 앱을 열어 읽을 때 30초가 지났으면 지운다 — 문서도 그렇게', async () => {
    const { LAST_ROOM_MS } = await import('../../client/src/lifecycle');
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
    });
    try {
      const { loadLastRoom, saveLastRoom } = await import('../../client/src/session');
      saveLastRoom('ABCD', 0);
      // 읽기 전에는 30초가 훨씬 지나도 남아 있다 (타이머가 없다)
      expect(store.has(STORAGE_KEYS.lastRoom.key)).toBe(true);
      expect(loadLastRoom(LAST_ROOM_MS)?.room).toBe('ABCD');
      expect(loadLastRoom(LAST_ROOM_MS + 1)).toBeNull();
      expect(store.has(STORAGE_KEYS.lastRoom.key)).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
    const phrase = `다음에 앱을 열 때 ${LAST_ROOM_MS / 1000}초가 지났으면 지움`;
    expect(STORAGE_KEYS.lastRoom.keep).toContain(phrase);
    expect(LISTING.split('\n').find((l) => l.startsWith('| `decoy:lastRoom`'))).toContain(phrase);
  });

  it("4번 '서버로 보내지 않습니다'의 예외에 방에 들어갈 때 보내는 저장 값(이름 · 마지막 방 코드 · 자리 토큰)이 모두 있다", () => {
    // 저장 키 → 방에 들어갈 때 실리는 join 필드 (client/src/app.ts sendJoin) → 문서의 이름
    const sentFromStorage = [
      { key: 'name', field: 'join.name', word: '이름' },
      { key: 'lastRoom', field: 'join.room', word: '마지막 방 코드' },
      { key: 'seat', field: 'join.token', word: '자리 토큰' },
      { key: 'seats', field: 'join.altTokens', word: '자리 토큰' },
    ] as const;
    const fields: string[] = Object.values(SENT_DATA).flatMap((d) => [...d.fields]);
    const first = plain(/<p>([\s\S]*?)<\/p>/.exec(section('device'))?.[1] ?? '');
    expect(first).toContain('서버로 보내지 않습니다');
    const except = /서버로 보내지 않습니다\(([^)]*)\)/.exec(first)?.[1] ?? '';
    const listingHead = LISTING.split('\n').find((l) => l.startsWith('**기기에만 저장하는 것**')) ?? '';
    for (const s of sentFromStorage) {
      expect(STORAGE_KEYS[s.key].key, s.key).toBeDefined();
      expect(fields, s.field).toContain(s.field);
      expect(except, s.word).toContain(s.word);
      expect(listingHead, s.word).toContain(s.word);
    }
    expect(except).toMatch(/방에 들어갈 때/);
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

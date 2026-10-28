// 계정 삭제 웹 페이지 (docs/ACCOUNT_PLAN.md 8절, Play '계정 삭제 URL'): 상태마다 글 · 스크립트 없음 · 처리방침 링크 · 문의처 ·
// 휴대폰 폭에서 가로 스크롤이 생길 고정 폭이 없다 · 백업 보관 기간 문장은 정해질 때까지 없다
import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_BACKUP_RETENTION,
  DELETE_CSRF_FIELD,
  renderDeletePage,
  type DeletePageState,
} from '../../server/src/account/deletePage';
import { contactHtml } from '../../server/src/privacy';

const STATES: DeletePageState[] = [
  { kind: 'off' },
  { kind: 'signed-out' },
  { kind: 'signed-in', level: 7, played: 42, csrf: 'abcDEF0123456789abcDEF0123456789' },
  { kind: 'deleted', deleted: true },
  { kind: 'deleted', deleted: false },
  { kind: 'db' },
  { kind: 'retry' },
];

describe('계정 삭제 페이지', () => {
  it('모든 상태: 한국어 문서 · 스크립트 · 밖으로 가는 요청 없음 · 처리방침 링크 · 지우는 것 · 바로 지운다는 것', () => {
    for (const st of STATES) {
      const html = renderDeletePage(st, null);
      expect(html).toMatch(/^<!doctype html>\n<html lang="ko">/);
      expect(html).toContain(
        '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
      );
      expect(html).toContain(`data-state="${st.kind}"`);
      expect(html).not.toMatch(/<script|\son[a-z]+=|javascript:/i);
      expect(html).not.toMatch(/(src|href)="https?:/);
      expect(html).toContain('href="/privacy"');
      expect(html).toContain('<title>DECOY 계정 삭제</title>');
      expect(html).toContain('바로 지웁니다');
      expect(html).toContain('이메일 · 이름 · 프로필 사진은 처음부터 받지 않았습니다');
      expect(html).toContain("'사이트 데이터 삭제'");
      // 바탕은 처리방침과 같은 어두운 색
      expect(html).toContain('--bg:#0b1622');
    }
  });

  it('상태별 글: 꺼짐 · 로그인 링크 · 레벨과 판 수 + 폼 · 지움 · 장애 · 다시 열기', () => {
    // 꺼짐: 서버는 이메일이 없어 요청한 계정을 찾을 수 없다 — 받는 대로 지운다고 약속하지 않고 할 수 있는 길(잠시 켜 직접 · 전체 지우기)만
    const off = renderDeletePage({ kind: 'off' }, null);
    expect(off).toContain(
      '<strong>예전에 Google 계정으로 로그인한 적이 있다면</strong> 아래 문의처로 알려 주세요. ' +
        '서버는 이메일을 저장하지 않아 요청한 계정을 따로 찾을 수 없으므로, 로그인 기능을 잠시 다시 켜 이 페이지에서 ' +
        '직접 지우실 수 있게 하거나 서버의 계정 기록 전체를 지운 뒤 알려 드립니다.',
    );
    expect(off).not.toContain('받는 대로');
    const out = renderDeletePage({ kind: 'signed-out' }, null);
    expect(out).toContain(
      '<a class="button" data-testid="delete-login" href="/auth/google/start?next=delete">Google 계정으로 로그인해 삭제하기</a>',
    );
    expect(out).not.toContain('<form');
    const inn = renderDeletePage({ kind: 'signed-in', level: 7, played: 42, csrf: 'abc"><x' }, null);
    expect(inn).toContain('레벨 7');
    expect(inn).toContain('한 판 <strong>42번</strong>');
    expect(inn).toContain('<form method="post" action="/account/delete">');
    // CSRF 값은 안전한 글자만 (따옴표로 칸을 깨지 못한다)
    expect(inn).toContain(`<input type="hidden" name="${DELETE_CSRF_FIELD}" value="abcx">`);
    expect(inn).toContain('계정과 기록 삭제');
    expect(inn).toContain('되돌릴 수 없습니다');
    expect(renderDeletePage({ kind: 'deleted', deleted: true }, null)).toContain(
      '계정과 서버의 성장 기록을 지웠습니다',
    );
    expect(renderDeletePage({ kind: 'deleted', deleted: false }, null)).toContain('이미 지워진 계정입니다');
    expect(renderDeletePage({ kind: 'db' }, null)).toContain('잠시 뒤 이 페이지를 다시 열어 주세요');
    expect(renderDeletePage({ kind: 'retry' }, null)).toContain('href="/account/delete"');
    for (const st of STATES.filter((s) => s.kind !== 'signed-in'))
      expect(renderDeletePage(st, null)).not.toContain('<form');
  });

  it('문의처: 처리방침과 같은 조각(PRIVACY_CONTACT, 이스케이프), 없으면 스토어 개발자 연락처', () => {
    expect(renderDeletePage({ kind: 'off' }, null)).toContain('구글 플레이 스토어의 DECOY 개발자 연락처');
    const mail = renderDeletePage({ kind: 'off' }, contactHtml('dev@example.com'));
    expect(mail).toContain('<a href="mailto:dev@example.com">dev@example.com</a>');
    const odd = renderDeletePage({ kind: 'off' }, contactHtml('<b>x</b>'));
    expect(odd).toContain('&lt;b&gt;x&lt;/b&gt;');
  });

  it('지운 기록이 DB 업체의 복원용 기록(백업)에 남는 기간: Neon 무료 복원 기간 6시간을 모든 상태에 보여 준다 (처리방침과 같은 값)', () => {
    expect(ACCOUNT_BACKUP_RETENTION).toBe('6시간');
    for (const st of STATES)
      expect(renderDeletePage(st, null)).toContain(
        '복원용 기록(백업)에 최대 6시간 남았다가 자동으로 지워집니다',
      );
  });

  it('휴대폰 폭: 고정 폭 없이 최대 폭 · 줄바꿈 · 좁은 화면에서 버튼 전체 폭, 터치 대상 48px 이상', () => {
    const html = renderDeletePage(STATES[2]!, null);
    const css = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? '';
    // width: Npx(고정 폭)가 없다 — max-width · min-height만
    expect(css).not.toMatch(/(?<![-a-z])width:\s*\d+px/);
    expect(css).toContain('main{max-width:680px');
    expect(css).toContain('overflow-wrap:anywhere');
    expect(css).toContain('@media (max-width:480px){.button{width:100%}}');
    expect(css).toMatch(/\.button\{[^}]*min-height:52px/);
    expect(css).toMatch(/\.back\{[^}]*min-height:48px/);
    expect(css).toMatch(/p,li\{font-size:17px\}/);
  });
});

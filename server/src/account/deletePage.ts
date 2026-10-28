// 계정 삭제 웹 페이지 /account/delete (docs/ACCOUNT_PLAN.md 8절, Play 데이터 보안 신고 '계정 삭제 URL'). 서버가 그리는 HTML,
// 스크립트 없음(폼 POST만). 처리방침(client/public/privacy.html)과 같은 어두운 바탕 · 넉넉한 글자, 휴대폰 폭에서 가로 스크롤 없게.
// 상태: 로그인 꺼짐 · 로그인 안 함 · 그 구글 계정으로 만든 계정 없음 · 로그인함(삭제 폼) · 지움 · 저장소 장애 · 다시 열기(CSRF 값이 맞지 않음).
// 이 페이지의 로그인은 계정을 만들지 않고 게임 세션도 주지 않는다(삭제 페이지 전용 10분 쿠키 decoy_del — routes.ts)
import { ACCOUNT_DELETE_PATH, AUTH_START_PATH } from '@decoy/shared';

/**
 * 지운 기록이 DB 백업에 남는 기간 (예: '7일'). DB가 정해지면 그 DB의 백업 보관 기간을 넣는다 — null이면 그 문장을 뺀다
 * (처리방침에도 같은 값을 적는다)
 */
export const ACCOUNT_BACKUP_RETENTION: string | null = null;

/** CSRF 값이 드는 숨은 칸 이름 */
export const DELETE_CSRF_FIELD = 'csrf';

export type DeletePageState =
  /**
   * 로그인 기능이 꺼져 있다 — 이 페이지로는 지울 수 없다(켠 적이 있으면 DB에 남아 있을 수 있다). 서버는 이메일이 없어 요청한
   * 계정을 찾을 수 없으므로 문의가 오면 잠시 켜 직접 지우게 하거나 계정 기록 전체를 지운다(docs/LOGIN_GUIDE.md 9단계)
   */
  | { kind: 'off' }
  /** 켜져 있고 로그인하지 않았다 */
  | { kind: 'signed-out' }
  /** 이 페이지에서 로그인한 구글 계정으로 만든 DECOY 계정이 없다 (계정을 만들지 않았다 — 지울 것이 없다) */
  | { kind: 'none' }
  /** 로그인했다: 레벨 · 판 수만 보이고 삭제 폼 */
  | { kind: 'signed-in'; level: number; played: number; csrf: string }
  /** 지웠다 (deleted false = 이미 없었다) */
  | { kind: 'deleted'; deleted: boolean }
  /** 저장소에 닿지 않는다 */
  | { kind: 'db' }
  /** 폼 확인 값이 맞지 않는다 (오래된 페이지) — 다시 열기 */
  | { kind: 'retry' };

function stateBlock(state: DeletePageState): string {
  switch (state.kind) {
    case 'off':
      return (
        '<p data-testid="delete-off">지금 DECOY는 로그인 기능을 쓰지 않아 이 페이지에서 로그인해 지울 수 없습니다. ' +
        '로그인하지 않고 한 기록은 이 기기에만 있으니 아래 「이 기기의 기록」을 따라 지워 주세요. ' +
        '<strong>예전에 Google 계정으로 로그인한 적이 있다면</strong> 아래 문의처로 알려 주세요. ' +
        '서버는 이메일을 저장하지 않아 요청한 계정을 따로 찾을 수 없으므로, 로그인 기능을 잠시 다시 켜 이 페이지에서 ' +
        '직접 지우실 수 있게 하거나 서버의 계정 기록 전체를 지운 뒤 알려 드립니다.</p>'
      );
    case 'signed-out':
      return (
        '<p>계정을 지우려면 먼저 그 Google 계정으로 로그인해 주세요. 로그인하면 이 페이지로 돌아와 삭제 버튼이 보입니다. ' +
        '로그인만으로는 아무것도 지우지 않습니다.</p>' +
        `<p><a class="button" data-testid="delete-login" href="${AUTH_START_PATH}?next=delete">Google 계정으로 로그인해 삭제하기</a></p>`
      );
    case 'none':
      return (
        '<p data-testid="delete-none"><strong>이 Google 계정으로 만든 DECOY 계정이 없습니다.</strong> 서버에 지울 기록이 없고, ' +
        '이 로그인으로 계정을 만들지도 않았습니다. 다른 Google 계정으로 로그인했었다면 그 계정으로 다시 로그인해 주세요.</p>' +
        `<p><a class="button" data-testid="delete-login" href="${AUTH_START_PATH}?next=delete">다른 Google 계정으로 로그인하기</a></p>`
      );
    case 'signed-in':
      return (
        `<p data-testid="delete-account">로그인한 계정: <strong>레벨 ${Math.max(1, Math.floor(state.level))}</strong> · ` +
        `한 판 <strong>${Math.max(0, Math.floor(state.played))}번</strong></p>` +
        '<p>아래 버튼을 누르면 <strong>바로 지우고 되돌릴 수 없습니다.</strong></p>' +
        `<form method="post" action="${ACCOUNT_DELETE_PATH}">` +
        `<input type="hidden" name="${DELETE_CSRF_FIELD}" value="${state.csrf.replace(/[^A-Za-z0-9_-]/g, '')}">` +
        '<button class="button danger" type="submit" data-testid="delete-submit">계정과 기록 삭제</button></form>'
      );
    case 'deleted':
      return state.deleted
        ? '<p data-testid="delete-done"><strong>계정과 서버의 성장 기록을 지웠습니다.</strong> 이 브라우저에서는 로그아웃했습니다.</p>'
        : '<p data-testid="delete-done"><strong>이미 지워진 계정입니다.</strong> 서버에 남은 기록이 없습니다. 이 브라우저에서는 로그아웃했습니다.</p>';
    case 'db':
      return (
        '<p data-testid="delete-db">지금 계정 저장소에 닿지 않아 처리하지 못했습니다. 잠시 뒤 이 페이지를 다시 열어 주세요. ' +
        '계속 안 되면 아래 문의처로 알려 주세요.</p>'
      );
    case 'retry':
      return (
        '<p data-testid="delete-retry">요청을 확인하지 못했습니다(페이지가 오래됐을 수 있습니다). ' +
        `<a href="${ACCOUNT_DELETE_PATH}">이 페이지를 다시 열어</a> 주세요.</p>`
      );
  }
}

const STYLE = `
:root{--bg:#0b1622;--panel:#0f1b27;--edge:#1e3a4a;--text:#e2e8f0;--muted:#94a3b8;--accent-text:#67e8f9;--danger:#b91c1c;
--font:'Noto Sans KR','Apple SD Gothic Neo','Malgun Gothic',system-ui,sans-serif}
*{box-sizing:border-box}
html{background:var(--bg);color:var(--text);font-family:var(--font);line-height:1.7;-webkit-text-size-adjust:100%}
body{margin:0;padding:max(20px,env(safe-area-inset-top)) max(16px,env(safe-area-inset-right)) max(32px,env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left))}
main{max-width:680px;margin:0 auto;overflow-wrap:anywhere}
a{color:var(--accent-text)}
.back{display:inline-flex;align-items:center;min-height:48px;font-size:16px}
h1{margin:12px 0 8px;font-size:26px}
h2{margin:28px 0 8px;padding-top:12px;border-top:1px solid var(--edge);font-size:19px;color:var(--accent-text)}
p,li{font-size:17px}
ul{padding-left:22px}
.state{margin:20px 0;padding:16px;background:var(--panel);border:1px solid var(--edge);border-radius:10px}
.state p:first-child{margin-top:0}
.state p:last-child{margin-bottom:0}
.button{display:inline-flex;align-items:center;justify-content:center;min-height:52px;max-width:100%;padding:10px 20px;border:0;border-radius:10px;
background:#0e7490;color:#fff;font:inherit;font-size:17px;font-weight:700;text-decoration:none;cursor:pointer}
.danger{background:var(--danger)}
.muted{color:var(--muted)}
@media (max-width:480px){.button{width:100%}}
`;

/** 삭제 페이지 HTML. contact: 문의처 조각(server/src/privacy.ts contactHtml, 없으면 기본 문구) */
export function renderDeletePage(state: DeletePageState, contact: string | null): string {
  const backup =
    ACCOUNT_BACKUP_RETENTION === null
      ? ''
      : `<li>지운 기록은 서버 백업에 최대 ${ACCOUNT_BACKUP_RETENTION} 남았다가 자동으로 지워집니다.</li>`;
  const ask = contact ?? '구글 플레이 스토어의 DECOY 개발자 연락처';
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="dark">
<title>DECOY 계정 삭제</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<a class="back" href="/">← DECOY로 돌아가기</a>
<h1>DECOY 계정 삭제</h1>
<p>DECOY는 로그인 없이 할 수 있고, 원하면 Google 계정으로 로그인해 성장 기록을 서버의 계정에 저장해 여러 기기에서 같이 씁니다.
이 페이지에서 그 계정과 서버의 기록을 지울 수 있습니다. 게임 안에서는 설정 › 계정 › 계정 삭제로도 지울 수 있습니다.</p>
<div class="state" data-state="${state.kind}">${stateBlock(state)}</div>
<h2>지우는 것</h2>
<ul>
<li>계정: Google 고유 ID(숫자로 된 식별자)와 이어 둔 DECOY 계정 번호</li>
<li>서버에 저장한 성장 기록 전부: 레벨 · 경험치 · 판 수 · 평가 최고 단계 · 불씨 · 오늘의 도전 · 접속 보상 · 해금하고 입은 의상</li>
</ul>
<ul>
<li><strong>바로 지웁니다.</strong> 삭제 버튼을 누르는 즉시 서버에서 지우고 되돌릴 수 없습니다.</li>
${backup}<li>이메일 · 이름 · 프로필 사진은 처음부터 받지 않았습니다. Google 계정 자체는 지워지지 않습니다.</li>
<li>나중에 같은 Google 계정으로 다시 로그인하면 새 계정으로 시작합니다. 그 기기에 로그인하지 않고 쌓은 기록(아래 「이 기기의 기록」)이 남아 있으면 그 기록을 새 계정에 올립니다.</li>
</ul>
<h2>이 기기의 기록</h2>
<p>로그인하지 않고 쌓은 기록(게스트 기록)은 서버가 아니라 이 기기에만 있어 위 삭제로 지워지지 않습니다.
지우려면 브라우저 설정의 '사이트 데이터 삭제'(이 사이트만 고르면 됩니다), 안드로이드 앱은 설정 › 애플리케이션 › DECOY › 저장공간 ›
데이터 삭제 또는 앱 삭제.</p>
<h2>문의</h2>
<p>문의처: <span data-testid="delete-contact">${ask}</span></p>
<p><a href="/privacy">개인정보 처리방침</a></p>
</main>
</body>
</html>
`;
}

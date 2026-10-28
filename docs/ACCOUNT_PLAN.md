# 선택형 구글 로그인 · 계정 저장 설계

사용자 요청(2026-10-28): 게스트 플레이(로그인 없이 바로 판)는 그대로 두고, 로그인하면 메타 기록(레벨 · 경험치 · 불씨 · 도전 · 접속 보상 · 해금하고 입은 의상)을 계정에 저장해 PC · 휴대폰 · 스토어 앱에서 같이 쓴다. **규칙 · 판정 · `config/balance.json` · `config/progression.json` · 판 안 게임 플레이는 바꾸지 않는다.** 로그인 기능은 환경 변수로 켜고 끄며 **기본은 꺼짐**이다(Play 데이터 보안 신고를 고친 뒤 사용자가 켠다). 사람이 할 일은 `docs/LOGIN_GUIDE.md`, 결정과 이유는 `docs/DECISIONS.md` 15절.

## 1. 큰 그림

| 무엇 | 누가 | 어디에 |
|---|---|---|
| 로그인 | 브라우저가 구글 로그인 화면으로 **페이지째 이동**(팝업 없음) → 구글이 ID 토큰을 서버로 POST → **서버가 토큰을 직접 검증** | 서버 |
| 계정 | 구글 고유 ID(`sub`) + 성장 기록 글 하나. 이메일 · 이름 · 사진은 **받지도 않는다**(요청 범위 `openid`만) | DB (사용자가 고른다 — 저장 부분은 `server/src/account/store.ts` 모양) |
| 세션 | 서버가 서명한 HttpOnly 쿠키(`decoy_sid`). 화면 스크립트는 읽지 못한다 | 브라우저 쿠키 |
| 온라인 판 보상 | **서버가** 판 평가(`rateMatch`)로 공용 `applyRating`을 그대로 불러 계정에 적립. 기기가 보낸 값은 쓰지 않는다 | 서버 → DB, 결과는 그 계정 연결에만 `credit` 메시지 |
| 접속 보상 · 해금 · 입기 | 서버가 공용 `claimLogin` · `buyCostume` · `wearCostume`으로 (기기는 요청만) | 계정 API |
| 첫 로그인 | 이 기기 기록을 계정으로 올린다. 계정에 이미 기록이 있으면 어느 쪽을 쓸지 묻는다 | 계정 API |
| 게스트 · 로그인 실패 · DB 장애 | 지금과 같다: 기기 저장(`decoy:progress`) | 기기 |

## 2. 로그인 방식 — 구글 OpenID Connect 리디렉트

- `GET /auth/google/start[?next=delete]` → 서버가 무작위 `state` · `nonce`를 만들어 짧은 쿠키(`decoy_oauth`, HttpOnly, 10분, Path=/auth)에 두고 구글 인가 주소로 302:
  `https://accounts.google.com/o/oauth2/v2/auth?client_id=…&redirect_uri=<출처>/auth/google/callback&response_type=id_token&response_mode=form_post&scope=openid&state=…&nonce=…&prompt=select_account`
- 구글은 사용자가 계정을 고르면 `id_token` · `state`를 **`/auth/google/callback`으로 POST**(form)한다. 서버: state가 쿠키와 같은지(시간 상수 비교) → ID 토큰 검증(아래) → nonce가 쿠키와 같은지 → 계정 찾기 · 만들기 → 세션 쿠키 → 303으로 `/?login=ok`(삭제 페이지에서 시작했으면 `/account/delete`). 실패는 `/?login=fail|cancel|off|db`
- 구글 스크립트(GIS)를 쓰지 않는다: 페이지 이동만이라 팝업 차단 · 스토어 앱(TWA, Chrome Custom Tabs) · PC · 휴대폰 브라우저에서 같은 길이고, 범위가 `openid`라 **이메일 · 이름 · 사진이 우리 서버에 오지 않는다** — Play 데이터 보안에 '사용자 ID'만 더하면 된다. 구글 '로그인 버튼(GIS)'은 범위가 고정(이메일 · 이름 · 사진 포함)이라 쓰지 않았다(DECISIONS 15절)
- 출처(`<출처>`)는 요청의 `x-forwarded-proto`(Render) + `Host`로 만든다. 구글 클라우드에 등록한 리디렉션 주소와 다르면 구글이 거절한다(무해)
- `decoy_oauth`는 구글에서 돌아오는 **다른 사이트발 POST**에 실려야 하므로 HTTPS에서 `SameSite=None; Secure`, http(개발 · 시험)에서는 `SameSite=Lax`
- 버튼: 글자 버튼 "Google 계정으로 로그인". 구글 'G' 로고는 구글 상표라(CC0 아님, 브랜드 가이드라인이 로그인 버튼에만 허용) CLAUDE.md 외부 에셋 규칙상 사용자 승인 뒤에 넣는다(HUMAN_CHECKS)

### 2.1 ID 토큰 검증 (`server/src/account/googleToken.ts`, 의존성 없음 — `node:crypto`)

- JWT 세 조각 · base64url · JSON 모양, 헤더 `alg`는 **RS256만**(`none` · `HS256` 거절), `kid` 필수
- 공개 키: `https://www.googleapis.com/oauth2/v3/certs`(JWKS)를 받아 `Cache-Control max-age`만큼 둔다. 모르는 `kid`면 한 번 다시 받는다(1분에 한 번까지). 받기 5초 제한. 시험은 키 공급자를 바꿔 끼운다
- 서명 `RSA-SHA256` 확인 → 클레임: `iss` ∈ {`https://accounts.google.com`, `accounts.google.com`}, `aud` = `GOOGLE_CLIENT_ID`(배열이면 포함), `exp` > 지금 − 60초, `iat` ≤ 지금 + 300초, `nonce` = 쿠키 값, `sub`는 1~255자 `[0-9A-Za-z_-]`
- 실패 이유는 로그에 종류만(토큰 · sub를 찍지 않는다)

### 2.2 세션 (`server/src/account/session.ts`)

- 쿠키 `decoy_sid` = `v1.<계정ID>.<발급 초>.<HMAC-SHA256(DECOY_SESSION_SECRET, 앞 세 칸) base64url>`. HttpOnly · SameSite=Lax · Path=/ · 180일 · HTTPS면 Secure. DB 없이 서명만으로 확인한다(DB가 죽어도 소켓 연결이 늦어지지 않게)
- 발급 7일이 지난 세션은 `GET /api/account` 때 새로 발급한다(쓰는 동안 끝나지 않게)
- 계정 ID는 무작위 32자 16진수(`store.ts newAccountId`) — 구글 `sub`는 쿠키 · 화면 · 메시지에 가지 않는다. 계정을 지우면 행이 없어 그 세션은 쓸모가 없다(다시 로그인하면 새 계정 ID)
- 이 기기 표시 `tag` = HMAC(비밀, 'tag:' + 계정ID) 앞 16자 — 화면이 "이 기기에서 이 계정에 기록 올리기를 이미 했다"를 기억하는 데만 쓴다(`decoy:account`)

## 3. 환경 변수 (기본 꺼짐)

| 키 | 값 | 없으면 |
|---|---|---|
| `DECOY_LOGIN` | `1`이면 켠다 | 꺼짐 (계정 화면 없음, 계정 요청 `{on:false}`) |
| `GOOGLE_CLIENT_ID` | 구글 클라우드 OAuth 클라이언트 ID(`…apps.googleusercontent.com`) | 켜지 않는다(로그에 이유) |
| `DECOY_SESSION_SECRET` | 32자 이상 무작위(render.yaml `generateValue: true`가 만든다) | 켜지 않는다 |
| DB 접속 값 | 사용자가 고른 DB(DECISIONS 15절) | 켜지 않는다 |
| `DECOY_ACCOUNT_TIMEZONE` | 계정 하루가 바뀌는 시간대, 기본 `Asia/Seoul` | 기본값 |

- 켜졌는데 하나라도 없거나 틀리면 **꺼진 채로** 뜨고 서버 로그에 빠진 **이름만** 적는다(값은 찍지 않는다)
- 시험 전용(`--test-hooks`): `DECOY_ACCOUNT_STORE=memory`(메모리 저장소) · 가짜 구글(`/test/google/authorize` — 시험 키로 서명한 ID 토큰을 같은 콜백으로 POST). 배포 서버(훅 없음)는 둘 다 받지 않는다(단위 시험)

## 4. 계정 API (`shared/src/account.ts` 경로, 타입은 `shared/src/types.ts` '계정' 절)

| 요청 | 하는 일 | 응답 |
|---|---|---|
| `GET /api/account` | 상태 | `AccountStatus`. DB 장애 503 `{error:'db'}` |
| `POST /api/account/import` `{choice, device}` | 첫 로그인: 계정이 비었으면 기기 기록을 올린다(choice 무관). 계정 기록이 있으면 `device`면 기기 기록으로 바꾸고 `account`면 그대로 | `AccountProfileBody` |
| `POST /api/account/claim-login` | 계정 날짜로 접속 보상 (본문 없음 — 날짜를 기기에서 받지 않는다) | `AccountClaimResponse` |
| `POST /api/account/costume` `{action, team, id}` | 해금(불씨) · 입기(가진 것만) | `AccountCostumeResponse` |
| `POST /api/account/logout` | 세션 쿠키 지우기 | `{ok:true}` |
| `POST /api/account/delete` | **계정 행을 바로 지운다** + 쿠키 지우기 | `AccountDeleteResponse` |

- POST는 `x-decoy-account: 1` 헤더 + `Origin`(있으면 같은 출처) 필수, 아니면 403 `csrf`. JSON 본문 상한: import 32KB, 그 밖 2KB(넘으면 413). CORS 허용 없음
- 로그인 안 함 · 세션 끝 · 지워진 계정 → POST는 401 `auth`(쿠키도 지운다), `GET /api/account`는 200 `{on:true, signedIn:false}`(쿠키를 지운다). 꺼짐 → `GET /api/account`는 200 `{on:false}`, 그 밖은 404 `off`
- 너무 잦은 요청: IP마다 `/auth/*` 1분 20번, 계정마다 POST 1분 60번 → 429 `rate`
- 모든 DB 호출은 3초 제한. 넘거나 실패하면 503 `db`
- 응답은 `cache-control: no-store`

## 5. 서버 적립 (`server/src/account/service.ts`)

- WebSocket 연결 때 `decoy_sid` 쿠키를 서명으로 확인해 `Conn.account`에 계정 ID를 둔다(로그인이 꺼졌거나 `Origin` 호스트가 이 서버와 다르면 두지 않는다 — 다른 사이트에서 연 소켓은 게스트). 방은 자리에 붙은 마지막 연결의 계정을 `Seat.account`로 들고 있다가 판이 끝나 결과를 보낸 뒤 `RoomHooks.rated(room, seat, rating)`으로 넘긴다
- 서비스: 계정마다 한 줄로 세워(같은 프로세스 — 인스턴스 1개) 읽기 → `parseProfile`(없으면 `emptyProfile`) → `applyRating(profile, rating, 서버 시각, PROGRESSION, 계정 날짜)` → 저장. 같은 판 ID면 저장 없이 성공(재접속). 지워진 계정은 **다시 만들지 않는다**
- 결과는 그 계정의 **모든 연결**(같은 사람의 다른 탭)에 `{t:'credit', matchId, ok, profile}`. DB 실패는 0.5 · 2 · 6초 뒤 다시 시도하고 그래도 안 되면 `ok:false`
- 계정 날짜 = `dayKeyInZone(서버 시각, DECOY_ACCOUNT_TIMEZONE)`(공용 `shared/src/meta/daily.ts`). 기기 시계를 쓰지 않는다 — 시계를 돌려 도전 · 접속 보상을 다시 받을 수 없다. 기기 기록(게스트)은 지금처럼 기기 자정
- 봇과 연습(기기 안 서버)은 서버가 판정하지 않으므로 **계정에 적립하지 않는다**(평가는 보인다, 결과에 한 줄 안내). 빠른 매칭 봇 판 · 친구 방은 서버 판이라 적립한다
- 서버 로그에 sub · 계정 ID · 토큰을 남기지 않는다(로그인 · 적립 수만)

## 6. 정보 숨김

괴물 화면 · 빠른 매칭에 계정이 단서가 되는 길이 **없다**고 판단했다(바뀌면 사용자에게 먼저 알린다).

| 길 | 막는 법 | 시험 |
|---|---|---|
| 로비 · 판 시작 명단 · 스냅샷 · 결과 | `Seat.account`를 어떤 메시지에도 싣지 않는다. 계정 레벨 · 기록은 서버 메시지에 없다 | 단위: 모든 메시지 원문에 계정 ID · tag 없음 |
| `credit` 메시지 | 그 계정의 연결에만 | 단위: 다른 자리 연결은 받지 않음 |
| 빠른 매칭 | 로그인한 사람이 있는 판과 없는 판에서 다른 자리가 받는 메시지가 같다(의상은 메타 c 그대로 — 자기 것만) | 단위: 같은 시드 두 판의 다른 자리 메시지 비교 |
| 의상 | 계정의 입은 의상도 지금처럼 `join` · `quick` · `costume`으로 보낸다(같은 길) | 기존 시험 |
| 시간 | 적립은 결과를 보낸 뒤 비동기 — 다른 사람에게 보내는 메시지의 시각 · 순서를 바꾸지 않는다 | — |

## 7. 화면 (클라이언트)

- **첫 묶음(작게, +3KiB 안쪽)**: `client/src/account/api.ts` · `mark.ts` · `boot.ts` — 상태 읽기 · 계정 API 호출(`fetch`, 5초 제한) · 표시 `decoy:account`. 계정 흐름(`controller.ts`) · `ServerProfileStore`(`serverStore.ts`) · 호출(`calls.ts`)은 예산 때문에 조각 `account`로 옮겼다 — 로그인한 기기는 부팅 때 그 조각을 받은 뒤 계정 모드로 들어간다(셸 캐시에 있다, 못 받으면 이번 접속은 게스트 + '새 버전이 있어요'). 부팅 때 **`decoy:account`가 있거나 주소에 `?login=`이 있을 때만** `GET /api/account`를 부른다(게스트 · 기능 꺼짐은 요청 없음). 표시가 있으면 레벨 칩은 계정을 읽을 때까지 '…'(최대 3초, 넘으면 기기 기록)
- **나눠 받는 조각 `account`**: 설정 화면의 '계정' 칸(로그인 · 로그아웃 · 계정 삭제 두 번 확인 · 삭제 페이지 · 처리방침 링크), 첫 로그인 기록 고르기 창, 로그인 결과 안내. 설정을 열 때 · 고르기 창이 필요할 때 받는다. 못 받으면 "새 버전이 있어요"
- `MetaState`는 저장소를 바꿔 끼운다(`device` ↔ `server`). 계정 모드에서는 받기 · 해금 · 입기를 서버 API로, 온라인 판 결과는 `credit`을 기다린다(미리보기 숫자는 같은 공용 함수로 그리고 "계정에 저장하는 중…" → "저장했어요" / "저장하지 못했어요"). 20초 안에 `credit`이 없으면 상태를 다시 읽어 판 ID가 있으면 저장된 것으로 본다. 날짜 · 자정 타이머는 계정 시간대
- 첫 로그인(이 기기 `decoy:account` tag ≠ 계정 tag): 기기 기록이 비었으면 묻지 않는다. 계정이 비었으면 기기 기록을 올리고 "이 기기 기록을 계정에 올렸어요". 둘 다 있으면 고르기 창(계정 기록 · 이 기기 기록 — 레벨 · 불씨 · 의상 수 · 판 수). 고른 뒤 tag를 적는다. 기기 기록(`decoy:progress`)은 지우지 않는다 — 로그아웃하면 다시 게스트 기록
- 로그인 · 로그아웃 · 삭제는 판 밖에서만(로그인은 페이지를 떠난다). 판 중 설정에서는 '계정' 칸을 숨긴다
- 로그아웃 · 삭제 뒤 첫 화면이면 소켓을 새로 연다(서버는 소켓을 열 때의 쿠키로 계정을 정한다). 친구 방 로비 · 결과에 있는 동안 로그아웃하면 그 방의 다음 판은 옛 계정에 적립될 수 있다(그 판의 보상이 그 사람 계정에 들어갈 뿐이라 막지 않았다 — DECISIONS 15절)
- `GET /api/account`가 `signedIn:false` · `on:false`면 표시를 지우고 게스트로, 실패 · 503이면 이번 접속은 게스트(기기 기록)로 하고 한 줄 안내 — 판은 그대로
- 서비스 워커는 `/api/` · `/auth/` · `/account/`를 가로채지 않는다(캐시 없음)

## 8. 계정 삭제

- 설정 › 계정 › 계정 삭제(두 번 확인) → `POST /api/account/delete` → 서버 행 바로 삭제 → 게스트로
- 웹 페이지 `/account/delete`(서버가 그리는 HTML, 스크립트 없음): 로그인 안 했으면 설명 + "Google 계정으로 로그인해 삭제하기"(`/auth/google/start?next=delete`), 했으면 "계정과 기록 삭제" 폼(POST, 세션에서 만든 CSRF 값 + Origin) → 바로 삭제 → "지웠어요". 로그인 기능이 꺼져 있으면 "여기서는 지울 수 없다 — 예전에 로그인했다면 문의처로 요청(받는 대로 지움)" 안내(켰다 끈 뒤에는 DB에 기록이 남아 있을 수 있다). Play 데이터 보안 '계정 삭제 URL'에 이 주소를 적는다
- 백업에 남는 기간은 고른 DB의 백업 보관 기간을 처리방침 · 삭제 페이지에 적는다

## 9. 시험

- 단위: 토큰 검증(정상 · 가짜 서명 · 다른 키 · alg none/HS256 · 만료 · 미래 iat · aud · iss · nonce · 모양 깨짐 · 모르는 kid 다시 받기), 세션(위조 · 만료 · 다른 비밀), 쿠키 읽기, 설정(기본 꺼짐 · 빠진 값 · 배포에서 메모리 저장소 · 가짜 구글 거절), 서비스(첫 로그인 · 서버 적립 = 공용 함수 결과 · 같은 판 한 번 · 지운 계정 다시 안 만듦 · 동시 적립 순서 · DB 실패 다시 시도 · 계정 날짜), 라우트(꺼짐 · CSRF · 크기 · 401 · 503 · 삭제 즉시 · 삭제 페이지 · 기기 기록 올리기 두 갈래), 방(계정 ID가 메시지에 없음 · rated 훅 · 빠른 매칭 메시지 같음), 클라이언트(계정 모드 MetaState · 연습 판 적립 안 함 · credit · 실패 시 게스트), 서비스 워커 PASS
- E2E(가짜 구글 · 메모리 저장소): 로그인 → 기기 기록 올리기 · 고르기 → 서버 판 적립 → 다른 브라우저(새 컨텍스트)에서 같은 기록 → 로그아웃 → 계정 삭제(설정 · 웹 페이지), 로그인 꺼짐(계정 요청 없음 · 칸 없음), DB 장애에서 게스트로 판 끝까지, 괴물이 받은 원문에 계정 단서 없음, 번들 두 줄 · 조각 따로, 오프라인 시작

## 10. 번들

첫 로딩 JS 여유 약 28KiB · 전체 JS 여유 약 56KiB(PR #31 병합 기준). 이번 예산: 첫 로딩 +3KiB, 전체 +12KiB. 구글 스크립트는 없다.

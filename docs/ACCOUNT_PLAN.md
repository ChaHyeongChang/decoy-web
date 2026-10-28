# 선택형 구글 로그인 · 계정 저장 설계

사용자 요청(2026-10-28): 게스트 플레이(로그인 없이 바로 판)는 그대로 두고, 로그인하면 메타 기록(레벨 · 경험치 · 불씨 · 도전 · 접속 보상 · 해금하고 입은 의상)을 계정에 저장해 PC · 휴대폰 · 스토어 앱에서 같이 쓴다. **규칙 · 판정 · `config/balance.json` · `config/progression.json` · 판 안 게임 플레이는 바꾸지 않는다.** 로그인 기능은 환경 변수로 켜고 끄며 **기본은 꺼짐**이다(Play 데이터 보안 신고를 고친 뒤 사용자가 켠다). 사람이 할 일은 `docs/LOGIN_GUIDE.md`, 결정과 이유는 `docs/DECISIONS.md` 15절.

## 1. 큰 그림

| 무엇 | 누가 | 어디에 |
|---|---|---|
| 로그인 | 브라우저가 구글 로그인 화면으로 **페이지째 이동**(팝업 없음) → 구글이 ID 토큰을 서버로 POST → **서버가 토큰을 직접 검증** | 서버 |
| 계정 | 구글 고유 ID(`sub`) + 성장 기록 글 하나. 이메일 · 이름 · 사진은 **받지도 않는다**(요청 범위 `openid`만) | DB — **Neon** PostgreSQL(무료, 싱가포르 `aws-ap-southeast-1`, 사용자 결정 2026-10-28). `server/src/account/pgStore.ts` `PgAccountStore`(`store.ts` `AccountStore` 모양) — 3.1절 |
| 세션 | 서버가 서명한 HttpOnly 쿠키(`decoy_sid`). 화면 스크립트는 읽지 못한다 | 브라우저 쿠키 |
| 온라인 판 보상 | **서버가** 판 평가(`rateMatch`)로 공용 `applyRating`을 그대로 불러 계정에 적립 — **화면이 들어갈 때 밝힌 계정 tag와 그 소켓의 세션 쿠키 계정이 같을 때만**. 기기가 보낸 값은 쓰지 않는다 | 서버 → DB, 받아들였는지는 그 자리 본인 `welcome.account`로, 판 끝에 적립한 계정은 본인 `result.account`로, 결과는 그 계정 연결에만 `credit` 메시지 |
| 접속 보상 · 해금 · 입기 | 서버가 공용 `claimLogin` · `buyCostume` · `wearCostume`으로 (기기는 요청만) | 계정 API |
| 첫 로그인 | 이 기기 기록을 계정으로 올린다. 계정에 이미 기록이 있으면 어느 쪽을 쓸지 묻는다 | 계정 API |
| 게스트 · 로그인 실패 · DB 장애 | 지금과 같다: 기기 저장(`decoy:progress`) | 기기 |

## 2. 로그인 방식 — 구글 OpenID Connect 리디렉트

- `GET /auth/google/start[?next=delete]` → 서버가 무작위 `state` · `nonce`를 만들어 짧은 쿠키(`decoy_oauth`, HttpOnly, 10분, Path=/auth)에 두고 구글 인가 주소로 302:
  `https://accounts.google.com/o/oauth2/v2/auth?client_id=…&redirect_uri=<출처>/auth/google/callback&response_type=id_token&response_mode=form_post&scope=openid&state=…&nonce=…&prompt=select_account`
- 구글은 사용자가 계정을 고르면 `id_token` · `state`를 **`/auth/google/callback`으로 POST**(form)한다. 서버: state가 쿠키와 같은지(시간 상수 비교) → ID 토큰 검증(아래) → nonce가 쿠키와 같은지 → 계정 찾기 · 만들기 → 세션 쿠키 → 303으로 `/?login=ok`. 실패는 `/?login=fail|cancel|off|db`
- 삭제 페이지에서 시작했으면(`next=delete`) 계정을 **만들지 않고** 찾기만 한다(`service.find` — `findBySub`만): 없으면 세션 쿠키 없이(남은 삭제 전용 쿠키 `decoy_del`은 지우고 — 같은 브라우저가 10분 안에 다른 계정으로 로그인해 둔 것이 '계정 없음' 페이지에 그 계정의 삭제 폼을 그리지 않게) `/account/delete?none=1`('이 Google 계정으로 만든 DECOY 계정이 없습니다' + 다른 계정으로 로그인 링크), 있으면 게임 세션(`decoy_sid`) 대신 **삭제 페이지 전용 쿠키** `decoy_del`(같은 서명 형식 · 앞말 `d1`, `Path=/account/delete`, 10분, HttpOnly, SameSite=Lax, HTTPS면 Secure)를 주고 `/account/delete`로. 이 쿠키는 `/ws` · `/api`에 실리지 않고, 실어 보내도(이름을 바꿔도) 게임 세션으로 받지 않는다 — 삭제하려고 로그인한 브라우저가 게임에서 몰래 계정 모드 · 계정 적립이 되지 않게(DECISIONS 15절)
- 구글 스크립트(GIS)를 쓰지 않는다: 페이지 이동만이라 팝업 차단 · 스토어 앱(TWA, Chrome Custom Tabs) · PC · 휴대폰 브라우저에서 같은 길이고, 범위가 `openid`라 **이메일 · 이름 · 사진이 우리 서버에 오지 않는다** — Play 데이터 보안에 '사용자 ID'만 더하면 된다. 구글 '로그인 버튼(GIS)'은 범위가 고정(이메일 · 이름 · 사진 포함)이라 쓰지 않았다(DECISIONS 15절)
- 출처(`<출처>`)는 요청의 `x-forwarded-proto`(Render) + `Host`로 만든다. 구글 클라우드에 등록한 리디렉션 주소와 다르면 구글이 거절한다(무해)
- `decoy_oauth`는 구글에서 돌아오는 **다른 사이트발 POST**에 실려야 하므로 HTTPS에서 `SameSite=None; Secure`, http(개발 · 시험)에서는 `SameSite=Lax`
- 버튼: 흰 배경 단추에 구글 공식 'G' 로고 + "Google 계정으로 로그인". 'G' 로고는 구글 상표라(CC0 아님, 브랜드 가이드라인이 로그인 버튼에만 허용) 사용자 승인(2026-10-28)을 받아 가이드라인대로 색 · 비율을 바꾸지 않고 쓴다 — 출처 · 조건 `docs/CREDITS.md` 6절, 결정 DECISIONS 15절

### 2.1 ID 토큰 검증 (`server/src/account/googleToken.ts`, 의존성 없음 — `node:crypto`)

- JWT 세 조각 · base64url · JSON 모양, 헤더 `alg`는 **RS256만**(`none` · `HS256` 거절), `kid` 필수
- 공개 키: `https://www.googleapis.com/oauth2/v3/certs`(JWKS)를 받아 `Cache-Control max-age`만큼 둔다. 모르는 `kid`면 한 번 다시 받는다(1분에 한 번까지). 받기 5초 제한. 시험은 키 공급자를 바꿔 끼운다
- 서명 `RSA-SHA256` 확인 → 클레임: `iss` ∈ {`https://accounts.google.com`, `accounts.google.com`}, `aud` = `GOOGLE_CLIENT_ID`(배열이면 포함), `exp` > 지금 − 60초, `iat` ≤ 지금 + 300초, `nonce` = 쿠키 값, `sub`는 1~255자 `[0-9A-Za-z_-]`
- 실패 이유는 로그에 종류만(토큰 · sub를 찍지 않는다)

### 2.2 세션 (`server/src/account/session.ts`)

- 쿠키 `decoy_sid` = `v2.<계정ID>.<발급 초>.<로그인 초>.<HMAC-SHA256(DECOY_SESSION_SECRET, 앞 네 칸) base64url>`. HttpOnly · SameSite=Lax · Path=/ · 180일 · HTTPS면 Secure. DB 없이 서명만으로 확인한다(DB가 죽어도 소켓 연결이 늦어지지 않게). 로그인 초 = 구글 로그인을 마친 때(기기 기록 올리기 10분 창 — 4절)
- 발급 7일이 지난 세션은 `GET /api/account` 때 새로 발급한다(쓰는 동안 끝나지 않게). 로그인 초는 그대로 둔다(새로 발급해도 10분 창이 다시 열리지 않게)
- 삭제 페이지 전용 `decoy_del` = `d1.<계정ID>.<발급 초>.<서명>`, 10분(2절). 앞말이 달라 서명이 서로 맞지 않는다 — 게임 세션 ↔ 삭제 전용 값으로 바꿔 쓸 수 없다
- 계정 ID는 무작위 32자 16진수(`store.ts newAccountId`) — 구글 `sub`는 쿠키 · 화면 · 메시지에 가지 않는다. 계정을 지우면 행이 없어 그 세션은 쓸모가 없다(다시 로그인하면 새 계정 ID)
- 이 기기 표시 `tag` = HMAC(비밀, 'tag:' + 계정ID) 앞 16자 — 화면이 "이 기기에서 이 계정에 기록 올리기를 이미 했다"를 기억하고(`decoy:account`), 온라인 판에 들어갈 때 `join` · `quick`의 `account`로 "이 계정 모드로 들어간다"를 밝히는 데 쓴다(5절). 서버는 소켓을 열 때 세션 비밀로 같은 값을 만들어(DB 없이) 견준다

## 3. 환경 변수 (기본 꺼짐)

| 키 | 값 | 없으면 |
|---|---|---|
| `DECOY_LOGIN` | `1`이면 켠다 | 꺼짐 (계정 화면 없음, 계정 요청 `{on:false}`) |
| `GOOGLE_CLIENT_ID` | 구글 클라우드 OAuth 클라이언트 ID(`…apps.googleusercontent.com`) | 켜지 않는다(로그에 이유) |
| `DECOY_SESSION_SECRET` | 32자 이상 무작위(render.yaml `generateValue: true`가 만든다) | 켜지 않는다 |
| `DATABASE_URL` | 계정 기록 저장소 PostgreSQL 접속 문자열 — Neon 대시보드 Connect에서 복사한 그대로(`postgresql://…-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require`). Render 대시보드에만(`render.yaml`은 `sync: false` 키만) | 켜지 않는다(`DATABASE_URL 없음`, 모양이 틀리면 — 여러 호스트 · IPv6 숫자 주소 · 상대 경로 `sslrootcert` 포함 — 또는 저장소를 만들지 못하면 `DATABASE_URL 틀림`) |
| `DECOY_ACCOUNT_TIMEZONE` | 계정 하루가 바뀌는 시간대, 기본 `Asia/Seoul` | 기본값 |

- 켜졌는데 하나라도 없거나 틀리면 **꺼진 채로** 뜨고 서버 로그에 빠진 **이름만** 적는다(값은 찍지 않는다 — 예: `계정 로그인: 꺼짐 (DATABASE_URL 없음)`). 켜지면 `계정 로그인: 켜짐 (postgres)`
- 시험 전용(`--test-hooks`): `DECOY_ACCOUNT_STORE=memory`(메모리 저장소) · 가짜 구글(`/test/google/authorize` — 시험 키로 서명한 ID 토큰을 같은 콜백으로 POST). 배포 서버(훅 없음)는 둘 다 받지 않는다(단위 시험)

### 3.1 계정 기록 저장소 (Neon PostgreSQL, `server/src/account/pgStore.ts`)

사용자 결정(2026-10-28): **Neon 무료 플랜, 지역 AWS Asia Pacific 1 (Singapore) `aws-ap-southeast-1`**(Render 서버와 같은 싱가포르). 표준 PostgreSQL 접속만 쓰므로 유료 · 다른 Postgres로 옮길 때 `DATABASE_URL`만 바꾼다(코드 그대로 — `docs/LOGIN_GUIDE.md` 11절). 이유와 대안은 DECISIONS 15절.

- 드라이버: npm `postgres` 3.4.9(의존 패키지 0개, Unlicense). esbuild가 서버 한 파일에 묶는다. 준비된 문장(prepare)을 끄고 써 Neon 풀러(`-pooler`) 주소 · 직접 주소 둘 다 된다
- 표: 서버가 시작할 때 `CREATE TABLE IF NOT EXISTS decoy_accounts (id text PRIMARY KEY, sub text NOT NULL UNIQUE, profile text, created bigint NOT NULL, updated bigint NOT NULL, rev bigint NOT NULL DEFAULT 0)` — 사람이 표를 만들지 않는다. 이메일 · 이름 칸은 없다. `rev`는 기록을 바꾼 횟수
- **조건부 쓰기**: 서비스는 기록을 쓸 때 읽은 `rev`를 함께 넘기고, 저장소는 `UPDATE … SET profile = …, updated = …, rev = rev + 1 WHERE id = $1 AND rev = <읽은 rev>`로 쓴다. 시간을 넘겨 버린 옛 쓰기가 늦게 도착해도 그 사이의 새 기록을 덮지 못한다. 맞는 행이 없으면: 계정이 없으면(지워짐) `false`, 지금 글이 쓰려던 글과 같으면(앞 시도가 이미 썼다) 성공, 그 밖에는 그새 바뀐 것(`AccountConflict`) → 503 `db`(판 적립은 다시 읽고 다시 시도 — 5절)
- TLS: `sslmode` `require` · `verify-ca` · `verify-full`이면 TLS + **인증서 확인**(libpq `require`보다 엄격 — Neon은 공인 인증서). 없거나 `prefer` · `allow`면 TLS를 먼저 시도하고 거절되면 암호화 없이(인증서 확인 없음, libpq 기본 — Render 내부 주소용), `disable`이면 암호화 없이. `sslrootcert=<절대 경로>`면 그 인증 기관 파일로 확인하고(자체 인증 기관을 쓰는 DB — 예: Render Secret Files의 `/etc/secrets/…`, 상대 경로는 틀림), `sslrootcert=system`이면 공인 인증서로 확인한다(둘 다 `disable`이 아니면 인증서 확인으로 올린다). `channel_binding`은 드라이버가 지원하지 않아 무시한다(대신 인증서 확인)
- 인증서를 확인하지 않는 연결이면 서버가 켤 때 경고를 찍는다(처리방침 10번은 'TLS + 인증서 확인'이다): `계정 DB 연결: 인증서를 확인하지 않음 (DATABASE_URL에 sslmode=require가 없다 — 처리방침 10번 확인)` · `계정 DB 연결: 암호화하지 않음 (DATABASE_URL이 sslmode=disable — 처리방침 10번 확인)`
- 주소 해석: 호스트 이름 하나만(여러 호스트 · IPv6 숫자 주소 `[::1]`은 틀림 — 드라이버가 호스트를 `:`로 다시 나눠 잘못된 포트로 접속하다 서버를 죽인다). 저장소를 만들 수 없으면(`sslrootcert` 파일을 읽지 못함 · 드라이버가 PG* 환경 변수 값을 거절) 로그 `계정 저장소를 만들지 못함 (DATABASE_URL 확인)` → `계정 로그인: 꺼짐 (DATABASE_URL 틀림)`, 서버 · 판은 그대로 뜬다
- 시간: 시도 하나(접속 + 질의) 4.5초 — 그중 접속 제한 4초. 시도 시간이 넘으면 그 연결 묶음을 통째로 버리고 새로 만든다(코드 `QUERY_TIMEOUT` — 소리 없이 죽은 연결에 매달린 질의, 서버가 시작 중 오류 없이 접속을 닫을 때 드라이버가 끝없이 다시 접속하는 것을 끊는다). 연결 오류(접속 끊김 · 시간 넘김 등)면 0.3초 뒤 한 번 더 — 저장소 호출 하나의 예산 9초가 1초 넘게 남을 때만, 두 번째 시도는 남은 시간만(예: 첫 시도가 4.5초를 다 쓰면 4.2초). 저장소가 9초 안에 끝나므로 서비스의 호출 제한 10초 · 화면 요청 제한 12초보다 먼저 끝나, 서비스가 포기한 뒤 옛 쓰기를 다시 보내지 않는다. 메모리 저장소는 3초 그대로. 드라이버 자체의 접속 미루기(backoff)는 끈다 — 장애 중 요청이 매달리지 않게. 쉬는 연결은 60초 뒤 닫고(연결을 붙잡아 compute를 깨워 두지 않게) 연결은 최대 2개. Neon 무료는 5분 쉬면 compute가 잠들고 다음 첫 요청에서 깨느라 보통 1초 안팎, 드물게 몇 초 늦다
- **DB 쉬기**: 호출 하나의 시도가 모두 시간을 넘기면(`CONNECT_TIMEOUT` · `QUERY_TIMEOUT`) 15초 동안 DB를 쉰다 — 그동안 계정 요청은 접속 없이 바로 503(코드 `PAUSED`, 로그 없음). 이어지면 두 배씩 최대 5분, 한 번이라도 성공하면 처음으로. 로그 `계정 DB 오류 <코드> — 응답이 없어 15초 동안 DB를 쉰다 (계정 요청은 503, 판은 그대로)`
- 서버 시작 때 DB에 못 닿으면 `계정 저장소 시작 실패 (계정 요청은 503, 판은 그대로)` 로그 뒤, 요청이 올 때 30초에 한 번 다시 시도한다
- 무료 한도를 넘으면 다시 시도하지 않고 로그 `계정 DB 오류 … — DB 무료 한도 초과 (Neon 사용량 확인)` → 그 요청은 503 `db`. 판은 그대로(판 중 로그인한 사람의 그 판 보상은 적립 실패로 보일 수 있다)
  - compute(월 100 CU-시간)를 넘으면 Neon이 그달 남은 동안 compute를 멈춘다 → 계정 요청이 모두 503 → 화면은 게스트(이 기기 기록). 다음 달에 풀리거나 유료로 올린다
  - 저장 용량(0.5GB)을 넘으면 읽기는 되고 쓰기만 실패한다(판 적립 · 접속 보상 · 의상 '저장하지 못했어요', 첫 로그인 올리기 · 새 계정 만들기 실패). 다음 달에 풀리지 않는다 — 행을 지우거나 유료로 올릴 때까지. 계정 행은 작아 드문 일이다
- 로그: 오류 코드(SQLSTATE 5자리 또는 연결 오류 이름 — `CONNECT_TIMEOUT` · `QUERY_TIMEOUT` · `28P01` 등)와 짧은 힌트만, 같은 코드는 1분에 한 번. DB 주소 · 비밀번호 · 호스트는 찍지 않는다. 힌트의 뜻 · 할 일은 LOGIN_GUIDE 10단계 표
- `/healthz`는 DB에 닿지 않는다(잠든 compute를 깨우지 않는다)
- 복원(PITR) 기간 6시간: 지운 계정 기록은 Neon의 복원용 기록에 최대 6시간 남았다가 자동으로 지워진다 — 처리방침 3 · 7 · 8번 · 삭제 페이지(`ACCOUNT_BACKUP_RETENTION`, 8절)

## 4. 계정 API (`shared/src/account.ts` 경로, 타입은 `shared/src/types.ts` '계정' 절)

| 요청 | 하는 일 | 응답 |
|---|---|---|
| `GET /api/account` | 상태 | `AccountStatus`. DB 장애 503 `{error:'db'}` |
| `POST /api/account/import` `{choice, device}` | 첫 로그인: 계정이 비었으면 기기 기록을 올린다(choice 무관, `device:null`이면 빈 기록). 계정 기록이 있으면 `device`이고 기기 글이 있을 때만 기기 기록으로 바꾸고 그 밖에는 그대로 — `device:null`은 비어 있지 않은 계정 기록을 절대 덮지 않는다. **기기 글이 있으면 구글 로그인 뒤 10분 안일 때만**(세션의 로그인 초) 받고 아니면 403 `relogin`(화면은 표시를 지우고 '다시 로그인해 주세요') | `AccountProfileBody` |
| `POST /api/account/claim-login` | 계정 날짜로 접속 보상 (본문 없음 — 날짜를 기기에서 받지 않는다) | `AccountClaimResponse` |
| `POST /api/account/costume` `{action, team, id}` | 해금(불씨) · 입기(가진 것만) | `AccountCostumeResponse` |
| `POST /api/account/logout` | 세션 쿠키 · 삭제 페이지 전용 쿠키(`decoy_del`) 지우기 | `{ok:true}` |
| `POST /api/account/delete` | **계정 행을 바로 지운다** + 세션 쿠키 · 삭제 페이지 전용 쿠키 지우기 | `AccountDeleteResponse` |

- POST는 `x-decoy-account: 1` 헤더 + `Origin`(있으면 같은 출처) 필수, 아니면 403 `csrf`. JSON 본문 상한: import 32KB, 그 밖 2KB(넘으면 413). CORS 허용 없음
- 로그인 안 함 · 세션 끝 · 지워진 계정 → POST는 401 `auth`(쿠키도 지운다), `GET /api/account`는 200 `{on:true, signedIn:false}`(쿠키를 지운다). 꺼짐 → `GET /api/account`는 200 `{on:false}`, 그 밖은 404 `off`. 삭제 전용 쿠키(`decoy_del`)만 있으면 로그인 안 함과 같다
  - 예외: `logout`은 세션과 상관없이 200 `{ok:true}`(쿠키를 지운다). `delete`는 서명이 유효한 세션이면 계정이 이미 없어도 200 `{deleted:false}`(삭제 페이지도 같다 — '이미 지워진 계정')
- 너무 잦은 요청: IP마다 `/auth/*` 1분 20번, 계정마다 POST 1분 60번 → 429 `rate`. 열쇠(IP · 계정 ID)는 서버 메모리에만 두고 창이 끝나면 늦어도 다음 창에 지운다(최대 2분 — 처리방침 3번). 로그인이 꺼져 있으면 `/auth/*`는 IP를 담지 않고 바로 `/?login=off`
- 저장소 호출 하나 제한: PostgreSQL 10초(저장소가 먼저 9초 예산 안에서 끝낸다 — 시도 하나 4.5초 · 연결 오류면 0.3초 뒤 한 번 더, 3.1절), 메모리 저장소 3초. 넘거나 실패하면(조건부 쓰기 어긋남 · DB 쉬는 중 포함) 503 `db`
- 응답은 `cache-control: no-store`

## 5. 서버 적립 (`server/src/account/service.ts`, `shared/src/sim/core.ts`)

**불변식: 서버는 화면이 그 자리에 들어갈 때 계정 모드라고 밝혔고(계정 tag) 그 연결의 세션 쿠키가 같은 계정일 때만 그 자리의 판을 계정에 적립한다.** 받아들였는지는 그 자리 본인에게만 `welcome.account`로, 판이 끝날 때 적립한 계정은 본인 `result.account`로 알린다(결과 단계에 다시 붙어도 판 끝 값 그대로). 다른 참가자에게 가는 메시지는 하나도 바뀌지 않는다(6절). 소켓 쿠키만으로 적립하던 때는 화면이 그 소켓이 어느 계정인지 몰라 이중 적립 · 적립 사라짐 · 다른 계정 `credit`이 화면을 덮음 · 삭제 페이지 로그인 세션이 게스트 판을 몰래 적립 같은 구멍이 같은 뿌리에서 나왔다(DECISIONS 15절)

- WebSocket 연결 때 `decoy_sid` 쿠키를 서명으로 확인해 `Conn.account`(계정 ID) · `Conn.accountTag`(세션 비밀로 만든 tag — DB 없이)를 둔다(로그인이 꺼졌거나 `Origin` 호스트가 이 서버와 다르면 두지 않는다 — 다른 사이트에서 연 소켓은 게스트, `decoy_del`은 게임 세션이 아니다)
- 화면은 계정 모드일 때만 `join` · `quick`에 `account: tag`를 싣는다(게스트면 칸 없음 — 게스트가 보내는 메시지는 전과 같다). `ServerCore.connect`는 연결마다 마지막 `join` · `quick` · 빠른 매칭 `rematch`의 `account`를 기억하고(다시 하기 재대기열은 그때 `rematch`가 밝힌 값 — 화면은 `rematch`에도 지금 모드의 tag를 싣는다. 결과에서 로그아웃 · 계정 삭제했으면 새 자리는 게스트), 자리를 묶을 때 효과 계정 = `conn.account && conn.accountTag && 밝힌 값 === conn.accountTag ? 계정 : 없음`. 새 자리(`addSeat`) · 재접속(`attach` — 그때 밝힌 값으로 다시 정한다)에 그 값을 넘겨 `Seat.account` · `Seat.accountTag`를 정한다. 봇은 늘 없음, 기기 안 연습(`LocalTransport`)은 연결에 계정이 없어 늘 없음
- `Room.welcome(seat)`이 `account: seat.accountTag`(없으면 null)를 그 자리 연결에만 싣는다. 방은 판이 끝나 결과를 보낸 뒤 `RoomHooks.rated(room, seat, rating)`으로 넘기고, 서버는 `seat.account`(효과 계정)가 있을 때만 적립한다
- 판이 끝난 순간의 자리 계정 tag를 평가와 함께 고정한다(`Room.ratedTags`, 게스트 자리 null). `resultFor`가 받는 사람 **본인** 결과에만 `account`로 싣는다 — 결과 단계에 tag 없이 다시 붙어(새로고침 · 다른 탭 넘겨받기 · 재연결) `attach`가 자리 계정을 비워도 다시 보내는 결과는 적립한 계정 그대로라, 화면이 그 판을 기기 기록에 또 적립하지 않는다(반대로 게스트 자리 판 뒤 tag를 밝혀 다시 붙어도 `null` — 기기 기록에). 로비로 돌아가거나 새 판이 시작하면 비운다
- 서비스: 계정마다 한 줄로 세워(같은 프로세스 — 인스턴스 1개) 읽기 → `parseProfile`(없으면 `emptyProfile`) → `applyRating(profile, rating, 서버 시각, PROGRESSION, 계정 날짜)` → 저장(읽은 `rev`일 때만 — 3.1절 조건부 쓰기. 접속 보상 · 의상 · 첫 로그인 올리기도 같다). 같은 판 ID면 저장 없이 성공(재접속). 지워진 계정은 **다시 만들지 않는다**
- 결과는 그 계정의 **모든 연결**(같은 사람의 다른 탭)에 `{t:'credit', tag, matchId, ok, profile}` — `tag`는 적립한 계정의 표시로, 다른 계정 모드 화면 · 탭은 거른다. DB 실패(조건부 쓰기 어긋남 포함 — 처음부터 다시 읽는다)는 0.5 · 2 · 6초 뒤 다시 시도하고 그래도 안 되면 `ok:false`
- 계정 날짜 = `dayKeyInZone(서버 시각, DECOY_ACCOUNT_TIMEZONE)`(공용 `shared/src/meta/daily.ts`). 기기 시계를 쓰지 않는다 — 시계를 돌려 도전 · 접속 보상을 다시 받을 수 없다. 기기 기록(게스트)은 지금처럼 기기 자정
- 봇과 연습(기기 안 서버)은 서버가 판정하지 않으므로 **계정에 적립하지 않는다**(평가는 보인다, 결과에 한 줄 안내). 빠른 매칭 봇 판 · 친구 방은 서버 판이라 적립한다
- 서버 로그에 sub · 계정 ID · 토큰을 남기지 않는다(로그인 · 적립 횟수와 실패 종류만)

## 6. 정보 숨김

괴물 화면 · 빠른 매칭에 계정이 단서가 되는 길이 **없다**고 판단했다(바뀌면 사용자에게 먼저 알린다).

| 길 | 막는 법 | 시험 |
|---|---|---|
| 로비 · 판 시작 명단 · 스냅샷 · 결과 · 남의 welcome | 다른 참가자에게 가는 게임 메시지에 계정 · 로그인 여부 · 레벨을 싣지 않는다 — 계정 ID(`Seat.account`)는 어떤 메시지에도 없고, 계정 tag는 본인이 보내는 `join` · `quick` · `rematch`의 `account`와 본인 `welcome` · `result`의 `account`에만, 계정 기록 글은 그 계정 연결의 `credit`에만 | 단위: 모든 메시지 원문에 계정 ID 없음, 남의 tag 없음, `"account"` 칸은 본인 welcome · 본인 result에만 |
| `welcome.account` · `result.account` | 그 자리 **본인** 연결에만(받아들인 tag · 판 끝에 적립한 tag 또는 null). 받는 사람별로 만드는 메시지라 다른 자리 것은 서로 보지 못한다 | 단위 · E2E: 본인 welcome · result만 다르고 다른 자리 메시지는 같다 |
| `credit` 메시지 | 그 계정의 연결에만 | 단위: 다른 자리 연결은 받지 않음 |
| 친구 방 · 빠른 매칭 | 로그인한 사람이 있는 판과 없는 판에서 모든 자리가 받는 메시지가 본인 welcome · result의 `account` 말고는 같다(게스트 자리는 글자 하나 다르지 않다, 의상은 메타 c 그대로 — 자기 것만) | 단위: 같은 시드 두 판의 메시지 비교 |
| 의상 | 계정의 입은 의상도 지금처럼 `join` · `quick` · `costume`으로 보낸다(같은 길) | 기존 시험 |
| 시간 | 적립은 결과를 보낸 뒤 비동기 — 다른 사람에게 보내는 메시지의 시각 · 순서를 바꾸지 않는다 | — |

## 7. 화면 (클라이언트)

- **첫 묶음(작게, +3KiB 안쪽)**: `client/src/account/api.ts` · `mark.ts` · `boot.ts` — 상태 읽기 · 계정 API 호출(`fetch`, 12초 제한 — 서버가 잠든 DB를 깨우며 기다리는 동안 먼저 포기하지 않게) · 표시 `decoy:account`. 계정 문구(`ACCOUNT_TEXT`)는 나눠 받는 조각에서만 쓰여 조각 `accountText`(`client/src/data/accountText.ts`)에 따로 둔다. 계정 흐름(`controller.ts`) · `ServerProfileStore`(`serverStore.ts`) · 호출(`calls.ts`)은 예산 때문에 조각 `account`로 옮겼다 — 로그인한 기기는 부팅 때 그 조각을 받은 뒤 계정 모드로 들어간다(셸 캐시에 있다, 못 받으면 이번 접속은 게스트 + '새 버전이 있어요'). 부팅 때 **`decoy:account`가 있거나 주소에 `?login=`이 있을 때만** `GET /api/account`를 부른다(표시 없는 기기는 요청 없음 — 꺼짐을 알린 표시 기기는 부팅마다 상태 요청 하나). 표시가 있으면 레벨 칩은 계정을 읽을 때까지 '…'(최대 3초, 넘으면 기기 기록 — 꺼짐을 알린 표시면 기다리지 않는다). 방 주소(`?room=` · 마지막 방 복귀)로 연 부팅은 이 읽기가 끝난 뒤(최대 3초 — 꺼짐을 알린 표시 기기도) 방에 들어간다 — 들어갈 때의 모드를 밝혀야 새로고침한 판도 계정에 적립된다. 잠든 Neon이 3초 안에 깨지 못하면 그 판은 게스트 자리로 이 기기 기록에 쌓인다(받아들인 한계 — 사람이 볼 것은 HUMAN_CHECKS '잠든 뒤 첫 로그인')
- **나눠 받는 조각 `account`**: 설정 화면의 '계정' 칸(로그인 · 로그아웃 · 계정 삭제 두 번 확인 · 삭제 페이지 · 처리방침 링크), 첫 로그인 기록 고르기 창, 로그인 결과 안내. 설정을 열 때 · 고르기 창이 필요할 때 받는다. 못 받으면 "새 버전이 있어요"
- `MetaState`는 저장소를 바꿔 끼운다(`device` ↔ `server`). 계정 모드에서는 받기 · 해금 · 입기를 서버 API로 한다. 계정 모드면 `join` · `quick`(재접속 포함) · `rematch`에 `account: tag`(`MetaState.tag`)를 싣고, `welcome`을 받을 때마다 `seatAccount = welcome.account ?? null`(다음 판용)
- **온라인 판 결과 적립은 그 판의 계정 `ratedSeat(result.account, seatAccount)`로 정한다** — 결과에 실린 판 끝 값이 먼저, 칸이 없는 옛 서버면 `seatAccount`. 이 화면에서 지운 계정 tag(설정 › 계정 삭제가 된 것 — 앱의 `goneTags`)면 없음과 같이 기기 기록에(서버는 지운 계정에 적립하지 않는다 — 두 번 쌓이지 않는다, 결과에 '이 판은 이 기기 기록에 적립했어요'). 서버가 적립하는 곳과 화면이 적립하는 곳이 늘 하나:
  - `null`(게스트 자리 — 계정 모드가 되기 전에 들어온 판 · 쿠키가 다른 소켓): 기기 기록에 적립(계정 모드여도) + '이 판은 이 기기 기록에 적립했어요'
  - 지금 계정 tag와 같음: `credit`을 기다린다(미리보기 숫자는 같은 공용 함수로 그리고 "계정에 저장하는 중…" → "저장했어요" / "저장하지 못했어요"). 20초 안에 `credit`이 없으면 상태를 다시 읽어 판 ID가 있으면 저장된 것으로 본다
  - 있는데 지금 모드와 다름(그사이 로그아웃 · 계정이 바뀜): 어디에도 적립하지 않고 '이 판은 들어올 때의 계정에 적립돼요'(서버가 그 계정에 적립한다)
  - 연습 판은 지금처럼: 계정 모드면 적립하지 않음, 게스트면 기기
- `credit`은 `msg.tag === 지금 계정 tag`일 때만 받는다(같은 사람의 다른 탭 판이면 기록만 바꾼다). 날짜 · 자정 타이머는 계정 시간대
- 첫 로그인(이 기기 `decoy:account` tag ≠ 계정 tag): 기기 기록이 비었으면 묻지 않는다(계정도 비었으면 `{choice:'account', device:null}`로 빈 기록 계정을 연다 — 그사이 다른 기기가 올린 기록을 덮지 않게). 계정이 비었으면 기기 기록을 올리고 "이 기기 기록을 계정에 올렸어요". 서버가 `relogin`(로그인 뒤 10분이 지남)으로 거절하면 표시를 지우고 게스트 + "이 기기 기록을 올리려면 다시 로그인해 주세요". 둘 다 있으면 고르기 창(계정 기록 · 이 기기 기록 — 레벨 · 불씨 · 의상 수 · 판 수) — 고른 대로 올린다('계정 기록'이면 기기 기록 글을 보내지 않는다). 고른 뒤 tag를 적는다. 기기 기록(`decoy:progress`)은 지우지 않는다 — 로그아웃하면 다시 게스트 기록
- 로그인 시도 중 표시: 표시 없이 `?login=ok`로 돌아오면 상태를 읽기 전에(첫 묶음) `decoy:account`를 tag `''`로 적는다. 상태 읽기 · 올리기 · 조각 받기가 실패해 이번 접속이 게스트가 돼도 다음 부팅이 이 표시로 상태를 읽고, 어느 계정 tag와도 달라 첫 로그인으로 잇는다. 성공하면 계정 tag로, 로그인 안 됨이면 지운다(DECISIONS 15절)
- 로그인 · 로그아웃 · 삭제는 판 밖에서만(로그인은 페이지를 떠난다). 판 중 설정에서는 '계정' 칸을 숨긴다
- 서버는 밝힌 tag가 소켓을 열 때의 쿠키 계정과 같을 때만 받아들인다. 그래서 부팅이 아닌 때 계정 모드가 바뀌면(로그아웃 · 삭제 · 세션 끝 · 꺼짐 · 다른 탭에서 로그인한 뒤 설정을 열어 계정 모드 · 다른 탭이 다른 계정으로 바꿈) 새 쿠키를 싣게 소켓을 다시 연다: 첫 화면이면 바로, 방 로비 · 빠른 매칭 대기 · 판 · 결과 중이면 방을 떠나 첫 화면에 돌아올 때(나가기 · 대기 취소 · 대기열에서 빠짐 · 결과 '홈으로'). 그사이의 판은 위 결과 적립 갈래로 정해져 두 번 쌓이지 않는다. 받아들인 한계: 다른 탭 · 웹 페이지(`/account/delete`)에서 지운 계정은 이 화면이 로그아웃과 구별하지 못해(`goneTags`에 없다), 방 안에서 이어진 판은 서버 적립이 실패하고(지운 계정을 다시 만들지 않는다) '들어올 때의 계정에 적립돼요'로 기기에도 쌓이지 않을 수 있다(DECISIONS 15절)
- `GET /api/account`가 `signedIn:false`(POST는 401)면 표시를 지우고 게스트로. 다시 읽은 상태가 로그인함인데 tag가 다르면(다른 탭이 다른 계정으로 로그인) 세션 끝이 아니라 바뀜: 표시를 지우지 않고 상태를 다시 읽어 새 계정 모드로(표시가 이미 새 tag면 묻지 않는다). `on:false`면 게스트로 하되 표시는 남기고 `off`를 적는다 — '지금은 로그인을 쓸 수 없어요'는 처음 알았을 때 한 번만(부팅 · 계정 모드 중 다시 읽기 · 부팅 읽기가 실패한 뒤 설정을 열어 다시 읽기 어느 길이든 — '로그인이 끝나…'가 아니다), 그 뒤 부팅은 안내 · 레벨 칩 기다림 없이 상태만 뒤에서 읽고, 다시 켜져 같은 tag면 `off`를 지우고 묻지 않고 계정 모드. 꺼진 동안은 화면이 계정을 밝히지 않아(서버도 소켓에 계정을 붙이지 않는다) 판은 기기 기록에만 쌓인다. 실패 · 503이면 이번 접속은 게스트(기기 기록)로 하고 한 줄 안내 — 판은 그대로(그 접속의 판은 게스트 자리라 서버도 계정에 적립하지 않는다)
- 서비스 워커는 `/api/` · `/auth/` · `/account/`를 가로채지 않는다(캐시 없음)

## 8. 계정 삭제

- 설정 › 계정 › 계정 삭제(두 번 확인) → `POST /api/account/delete` → 서버 행 바로 삭제 → 게스트로
- 웹 페이지 `/account/delete`(서버가 그리는 HTML, 스크립트 없음): 로그인 안 했으면 설명 + "Google 계정으로 로그인해 삭제하기"(`/auth/google/start?next=delete`), 했으면 "계정과 기록 삭제" 폼(POST, 쿠키 값에서 만든 CSRF 값 + Origin) → 바로 삭제 → "지웠어요". 로그인만으로는 지우지 않는다. Play 데이터 보안 '계정 삭제 URL'에 이 주소를 적는다
  - 이 페이지의 로그인은 계정을 만들지 않고 게임 세션도 주지 않는다(2절 — 없으면 '계정 없음', 있으면 `decoy_del`). 페이지는 `decoy_del`을 먼저, 없으면 `decoy_sid`(게임에서 로그인한 브라우저)를 읽고 CSRF 값도 그 값으로 만든다. 지우거나 401이면 두 쿠키를 모두 지운다
  - 지운 뒤 같은 구글 계정으로 다시 로그인하면 새 계정으로 시작한다. 그 기기에 로그인하지 않고 쌓은 기록이 남아 있으면 첫 로그인 규칙(7절)대로 새 계정에 올린다
  - 응답은 `Referrer-Policy: same-origin`이다. `no-referrer`면 브라우저가 같은 출처 폼 POST의 `Origin`을 `null`로 보내 출처 확인이 늘 403으로 거절한다(`same-origin`은 다른 사이트로는 주소 · 출처를 보내지 않는다)
- 로그인 기능이 꺼져 있으면 페이지는 "여기서는 지울 수 없다 — 예전에 로그인했다면 문의처로 알려 달라"고 안내한다(켰다 끈 뒤에는 DB에 기록이 남아 있을 수 있다). 서버는 이메일을 저장하지 않아 요청한 계정을 따로 찾을 수 없으므로 "받는 대로 지운다"고 약속하지 않고, 할 수 있는 일만 적는다
- **꺼진 동안 삭제 요청이 오면** (운영자, `docs/LOGIN_GUIDE.md` 9단계): (가) 로그인 기능을 잠깐 다시 켜고(Play 신고는 로그인을 켤 때 값 그대로일 때만) 요청자가 `/account/delete`에서 직접 로그인해 지우게 한 뒤 다시 끄거나, (나) DB의 계정 기록 전체를 지운다(Neon 콘솔 SQL Editor에서 `DELETE FROM decoy_accounts;` — 표는 남긴다. DB에 이메일이 없어 특정 사람의 행만 골라 지울 수는 없다). 처리한 뒤 요청자에게 답장한다
- 지운 계정 기록은 DB 업체(Neon)의 복원용 기록(PITR)에 **최대 6시간** 남았다가 자동으로 지워진다 — 처리방침 3 · 7 · 8번(7번은 DB 표의 '목적 · 보유 기간')과 삭제 페이지(`server/src/account/deletePage.ts` `ACCOUNT_BACKUP_RETENTION`)에 같은 값을 적는다. 유료로 올리거나 다른 DB로 옮겨 기간이 바뀌면 처리방침 3 · 7 · 8번과 `ACCOUNT_BACKUP_RETENTION`을 함께 고친다(LOGIN_GUIDE 11절 (가)2 · ⑥). 복원(되돌리기)은 원칙적으로 하지 않는다 — 그 시점 뒤에 지운 계정이 되살아난다(LOGIN_GUIDE 10단계)

## 9. 시험

- 단위: 토큰 검증(정상 · 가짜 서명 · 다른 키 · alg none/HS256 · 만료 · 미래 iat · aud · iss · nonce · 모양 깨짐 · 모르는 kid 다시 받기), 세션(위조 · 만료 · 다른 비밀 · 로그인 초 그대로 · 삭제 전용 값과 서로 바꿔 쓸 수 없음), 쿠키 읽기, 설정(기본 꺼짐 · 빠진 값 · 배포에서 메모리 저장소 · 가짜 구글 거절), 서비스(첫 로그인 · 서버 적립 = 공용 함수 결과 · 같은 판 한 번 · 지운 계정 다시 안 만듦 · 동시 적립 순서 · DB 실패 다시 시도 · 계정 날짜 · credit에 tag · 찾기는 만들지 않음 · 기기 글 null은 덮지 않음), 라우트(꺼짐 · CSRF · 크기 · 401 · 503 · 삭제 즉시 · 삭제 페이지 · 기기 기록 올리기 두 갈래 · 10분 창 · 삭제 페이지 로그인은 계정을 만들지 않고 `decoy_del`만 — 계정 없으면 남은 `decoy_del`을 지움 · 로그아웃 · 삭제는 `decoy_del`도 지움), 방 · 연결 처리(자리 계정 = 밝힌 tag와 쿠키 tag가 같을 때만 — 같음 · 다름 · 안 밝힘 · 쿠키 없음 · 재접속 · 다시 하기(rematch가 밝힌 값), 결과 단계 재접속에도 result.account는 판 끝 값, 본인 welcome · result만 다르고 다른 자리 메시지 같음 · rated 훅은 효과 계정만), 실제 서버(밝힘 · 안 밝힘 · 다른 tag · 다른 출처 · `decoy_del` 소켓), 클라이언트(계정 모드 MetaState · join/quick tag · 결과 세 갈래(result.account 먼저) · 지운 계정 자리는 기기 · credit tag 거르기 · 연습 판 적립 안 함 · switched · 꺼짐 안내 한 번(부팅 · 다시 읽기 · 설정) · relogin · 실패 시 게스트), 서비스 워커 PASS, PostgreSQL 저장소(가짜 연결 · 닫힌 포트로 `DATABASE_URL` 해석(IPv6 숫자 주소 · 여러 호스트 거절) · 시간 제한 사슬(접속 4초 < 시도 4.5초, 시도 + 0.3초 + 시도 ≤ 예산 9초 < 호출 10초 < 화면 12초) · 연결 오류 한 번 더(예산 안에서만) · DB 쉬기(15초부터 두 배 · 최대 5분 · 성공하면 처음) · 조건부 쓰기(`rev`) · 늦게 도착한 옛 쓰기가 새 기록을 덮지 않음 · 오류 없이 접속을 닫는 서버 · 답하지 않는 서버(연결 묶음 버리기) · 오류 분류(연결 · 한도 초과 · 힌트) · 같은 로그 1분에 한 번 · 로그에 주소 없음 · 인증서를 확인하지 않는 주소의 시작 경고 · `sslrootcert` · 저장소를 만들지 못하면 로그인 꺼짐 · 닿지 않는 DB에서도 서버는 뜨고 계정 요청만 503) + 실제 PostgreSQL(환경 변수 `DECOY_TEST_DATABASE_URL`이 있을 때만, 그리고 이 컴퓨터의 PostgreSQL(`localhost` · `127.0.0.1`)일 때만 — 시험이 표를 지우므로 배포 DB 주소는 받지 않는다. CI 빠른 검사는 러너의 PostgreSQL을 켜고 실행마다 만든 무작위 비밀번호로). Neon 자체(잠들기 · 한도)는 시험할 수 없어 HUMAN_CHECKS
- E2E(가짜 구글 · 메모리 저장소): 로그인 → 기기 기록 올리기 · 고르기 → 서버 판 적립(join에 tag · 본인 welcome에 tag) → 다른 브라우저(새 컨텍스트)에서 같은 기록 → 로그아웃 → 계정 삭제(설정 · 웹 페이지 — 없던 구글 계정은 만들지 않음), 삭제 페이지로 로그인만 한 브라우저의 게임 판은 계정에 적립되지 않음, 탭 A가 계정 모드로 들어간 판 중에 탭 B가 로그아웃해도 그 판은 계정에만(기기에 두 번 쌓이지 않음), 계정 자리 판의 결과 화면에서 계정 읽기가 늦은 새로고침(게스트로 다시 붙음)에도 그 판은 기기에 쌓이지 않고 계정 적립은 한 번(`result.account`), 로그인 꺼짐(계정 요청 없음 · 칸 없음 · 예전 로그인 기기의 꺼짐 안내는 한 번), DB 장애에서 게스트로 판 끝까지(서버도 적립하지 않음), 괴물이 받은 원문에 계정 단서 없음, 번들 두 줄 · 조각 따로, 오프라인 시작

## 10. 번들

첫 로딩 JS 여유 약 28KiB · 전체 JS 여유 약 56KiB(PR #31 병합 기준). 이번 예산: 첫 로딩 +3KiB, 전체 +12KiB. 구글 스크립트는 없다.

# 실행과 배포

DECOY 서버는 프로세스 하나가 정적 클라이언트(`client/dist`)와 WebSocket(`/ws`)을 함께 서빙한다. 주소 하나만 알려 주면 4명이 들어온다.

> **방은 서버 메모리에 있다.** 그래서 인터넷 배포 때 인스턴스는 **반드시 1개**로 고정한다(자동 확장 끄기). 인스턴스가 둘 이상이면 같은 방 코드로 들어와도 서로 다른 서버에 붙는다. 서버가 잠들거나 재시작하면 진행 중인 판도 사라진다.

## 0. 공통 준비

Node 22 이상, npm.

```bash
npm ci
npm run build          # client/dist (정적 파일) + server/dist/index.js (서버 한 파일)
npm start              # 기본 포트 8080. PORT=3000 npm start 처럼 바꿀 수 있다
```

- 헬스 체크: `GET /healthz` → `ok` (모든 응답에 `x-decoy-server: 1` 헤더가 붙는다. 깨우기 화면이 호스팅 서비스의 대기 화면과 이 서버의 응답을 구별하는 표시)
- 서버 옵션: `--port` (또는 `PORT`), `--host` (또는 `HOST`, 기본 `0.0.0.0`), `--balance <파일>` (또는 `DECOY_BALANCE`), `--dev` (또는 `DECOY_DEV_BOTS=1`, 개발용 봇 방 `?bots=1`을 받는다 — 배포 서버에서는 넣지 않는다)
- 배포 전 확인: `npm run verify:deploy` — Docker가 있으면 이미지를 빌드해 컨테이너로 띄우고, 없으면 빌드 결과물을 `PORT`로 띄워서 첫 화면 HTTP 200 · 스크립트 · WebSocket 방 만들기까지 확인한다

## 1. 로컬 (한 컴퓨터)

1. `npm start`
2. 브라우저에서 `http://localhost:8080` → **방 만들기**
3. 탭 3개를 더 열어 로비의 **링크 복사** 주소로 들어간다 (탭마다 다른 자리가 된다)
4. 혼자 시험할 때는 첫 화면의 **빠른 매칭**(20초 뒤 빈자리를 봇이 채움)이나 **봇과 연습**을 쓴다. 개발용 봇 방(`?bots=1`, 방장 시작 때 빈 역할을 순찰 봇이 채움)은 개발 서버에서만 된다: `DECOY_DEV_BOTS=1 npm start`(또는 `npm start -- --dev`)로 띄운 뒤 `http://localhost:8080/?bots=1`로 방을 만든다. 플래그 없이 띄운 서버(배포)는 `?bots=1`을 무시하고 일반 방을 만든다

## 2. 같은 와이파이 (발표장 · 강의실)

1. 서버를 띄울 컴퓨터에서 `npm start`
2. 그 컴퓨터의 내부 IP를 확인한다
   - Windows: `ipconfig` → "IPv4 주소" (예: `192.168.0.12`)
   - macOS: `ipconfig getifaddr en0`
   - Linux: `hostname -I`
3. 다른 사람들은 `http://192.168.0.12:8080` 으로 접속한다. 방을 만든 뒤 로비의 **링크 복사** 주소(`...?room=ABCD`)를 보내면 된다
4. 접속이 안 되면
   - 방화벽에서 8080 포트(또는 Node)를 허용한다 (Windows는 첫 실행 때 뜨는 "액세스 허용"에서 **개인 네트워크** 체크)
   - 학교 · 회사 와이파이는 기기끼리 통신을 막는 경우가 있다(AP 격리). 그러면 휴대폰 핫스팟에 모두 붙거나 인터넷 배포를 쓴다

## 3. 인터넷 배포

목표 핑은 30~60ms다. 플레이어와 가까운 **서울** 또는 **도쿄** 리전이 가장 좋다. 돈을 들이지 않고 먼저 해 보려면 **Render 무료 플랜(싱가포르)** 을 쓴다 — 저장소에 설정 파일(`render.yaml`)이 들어 있어 태블릿 브라우저만으로 배포할 수 있다 → [3.4 Render](#34-render-무료--싱가포르--태블릿으로-따라-하기). 서비스마다 무료 플랜 · 리전 · 요금 조건이 자주 바뀌므로 배포 시점에 확인한다. 어느 서비스든 조건은 같다.

| 조건 | 이유 |
|---|---|
| WebSocket 지원 | 실시간 통신. HTTPS로 배포하면 클라이언트가 자동으로 `wss://`를 쓴다 |
| 인스턴스 1개 고정 | 방 상태가 메모리에 있다 |
| 잠들지 않게(최소 1개 유지) | 잠들면 첫 접속이 느리고, 판 중에 잠들면 판이 사라진다. 무료 플랜이 잠드는 서비스라면 **테스트 전에 한 번 접속해 깨운다** (깨어나는 동안 게임이 "서버를 깨우는 중" 안내를 띄운다) |
| 요청 · 유휴 시간 제한이 길 것 | WebSocket 연결이 오래 유지된다. 끊겨도 클라이언트가 자동으로 다시 붙고 30초 유예가 있다 |
| `PORT` 환경 변수 | 서비스가 정한 포트로 뜬다 (기본 8080) |

### 3.1 Google Cloud Run (서울 `asia-northeast3` / 도쿄 `asia-northeast1`)

Dockerfile로 바로 빌드 · 배포된다. gcloud CLI 로그인과 결제 계정이 필요하다.

```bash
gcloud run deploy decoy \
  --source . \
  --region asia-northeast3 \
  --allow-unauthenticated \
  --port 8080 \
  --min-instances 1 --max-instances 1 \
  --timeout 3600 \
  --session-affinity
```

- `--max-instances 1`: 방이 메모리에 있으므로 꼭 1
- `--min-instances 1`: 잠들지 않게 (끄면 비용은 줄지만 첫 접속이 느리고, 아무도 없을 때 판 기록이 사라진다)
- `--timeout 3600`: WebSocket 연결 최대 시간(60분). 넘으면 끊기지만 클라이언트가 바로 다시 붙는다
- 배포가 끝나면 나오는 `https://decoy-xxxx.a.run.app` 주소를 공유한다

### 3.2 Fly.io (도쿄 `nrt`)

flyctl 로그인이 필요하다.

```bash
fly launch --no-deploy --region nrt     # 앱 이름을 정하고 fly.toml을 만든다 (Dockerfile 자동 인식)
```

`fly.toml`에서 다음을 확인한다.

```toml
[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = "off"   # 잠들지 않게 (켜 두면 테스트 전에 한 번 접속해 깨운다)
  min_machines_running = 1
```

```bash
fly deploy
fly scale count 1                       # 인스턴스 1개 고정
```

### 3.3 가상 서버 (AWS Lightsail · Vultr 등 서울 / 도쿄 리전)

Docker가 설치된 리눅스 서버 한 대면 된다.

```bash
git clone <이 저장소> decoy && cd decoy
docker build -t decoy-web .
docker run -d --name decoy --restart unless-stopped -p 80:8080 decoy-web
```

- `http://<서버 공인 IP>/` 로 접속한다. 서버 방화벽(보안 그룹)에서 80 포트를 연다
- HTTPS가 필요하면 Caddy 같은 리버스 프록시를 앞에 둔다(WebSocket은 그대로 통과한다). 예: `Caddyfile`에 `decoy.example.com { reverse_proxy localhost:8080 }` 후 컨테이너를 `-p 8080:8080`으로 띄운다

### 3.4 Render (무료 · 싱가포르) — 태블릿으로 따라 하기

저장소 맨 위의 `render.yaml`(Render Blueprint)에 설정이 모두 들어 있다. 화면에서 고를 것은 저장소 하나뿐이다.

| `render.yaml` 설정 | 값 | 이유 |
|---|---|---|
| 실행 방식 | Docker (`./Dockerfile`) | 로컬 · CI(`npm run verify:deploy`)와 같은 이미지 |
| 리전 | 싱가포르 (`singapore`) | Render의 아시아 리전. 서비스를 만든 뒤에는 바꿀 수 없다 |
| 요금제 | 무료 (`free`) | 15분 동안 접속이 없으면 잠든다 (아래 "무료 플랜에서 알아 둘 것") |
| 인스턴스 | 1개 | 방이 서버 메모리에 있다 |
| 헬스 체크 | `/healthz` | Render가 새 버전이 떴는지 확인하는 주소 |
| 자동 배포 | `main`, 검사 통과 뒤 (`checksPass`) | GitHub Actions 검사가 모두 통과한 커밋만 배포한다 |
| `PORT` | `10000` | 서버는 `PORT` 환경 변수로 뜬다. Render 웹 서비스 기본값을 적어 둔다 |
| `TWA_PACKAGE_NAME` · `TWA_SHA256_FINGERPRINTS` | 값 없음 (`sync: false`, 대시보드에서 넣는다) | 안드로이드 앱이 주소창 없이 열리게 하는 `/.well-known/assetlinks.json`(M14). 비어 있으면 404. 넣는 때와 값은 `docs/PLAY_STORE_GUIDE.md` 8단계 |
| `PRIVACY_CONTACT` | 값 없음 (`sync: false`, 대시보드에서 넣는다) | 개인정보 처리방침(`/privacy`, M15)의 문의처. 비어 있으면 "스토어의 개발자 연락처로 문의" |
| `DECOY_MAX_BOT_ROOMS` | (넣지 않음 — 기본 6) | 빠른 매칭에서 동시에 봇을 채울 방 수(M13c). 유료 플랜이면 늘려도 된다 |
| `DECOY_DEV_BOTS` | **넣지 않는다** | 개발용 봇 방(`?bots=1`)을 켠다. 이 방은 봇 방 상한 밖이라 배포 서버에서 켜면 연결 하나가 봇 판을 계속 만들 수 있다 |

환경 변수는 Render 대시보드 → 서비스 → **Environment**에서 넣는다. **저장하면 서버가 다시 배포되어 열려 있던 방이 사라진다** — 아무도 없을 때 넣는다.

**준비물**: 저장소 주인의 GitHub 계정(Render에 저장소 접근 권한을 줄 수 있어야 한다), 태블릿 브라우저(사파리 · 크롬). Render 화면은 영어이고 버튼 이름은 화면 개편에 따라 조금 다를 수 있다. 메뉴가 잘려 보이면 브라우저에서 **데스크톱 웹사이트 요청**을 켠다(사파리: 주소창 왼쪽 `가가` 버튼, 크롬: `⋮` 메뉴).

#### 처음 한 번: 서비스 만들기 (10~15분)

1. 태블릿 브라우저에서 `https://dashboard.render.com` 을 연다
2. **GitHub** 버튼으로 가입 · 로그인한다 (GitHub 로그인 화면이 뜨면 로그인 → **Authorize Render**)
3. 대시보드 오른쪽 위 **New** (`+ New`) → **Blueprint** 를 누른다
4. 저장소 목록에 `decoy-web`이 없으면 **Configure account**(또는 **Connect GitHub**) → GitHub 화면에서 **Only select repositories** → `decoy-web` 선택 → **Install**(또는 **Save**) 후 Render 화면으로 돌아온다
5. 목록의 `decoy-web` 옆 **Connect** 를 누른다
6. 다음 화면에서 확인한다
   - **Blueprint Name**: 아무 이름 (예: `decoy`)
   - **Branch**: `main`
   - 만들 서비스 목록에 `decoy-web` — **Web Service · Docker · Free · Singapore** 가 보인다
7. 맨 아래 **Deploy Blueprint**(또는 **Apply**) 를 누른다
8. 빌드를 기다린다 (5~10분). 서비스 `decoy-web`을 눌러 **Logs** 에 `DECOY 서버 시작`이 나오고, 위쪽 상태가 **Live**(초록)이면 끝
9. 서비스 화면 위쪽의 주소(`https://decoy-web-xxxx.onrender.com`)를 눌러 연다
   - 주소 끝에 `/healthz`를 붙여 `ok`가 나오면 서버가 살아 있다
   - 첫 화면에서 **방 만들기** → 로비의 **링크 복사** 주소를 단톡방에 보낸다

> 빠른 길: 태블릿 브라우저에서 `https://render.com/deploy?repo=https://github.com/chahyeongchang/decoy-web` 을 열면 3~5번을 건너뛰고 6번 화면으로 바로 간다 (로그인은 필요하고, 저장소가 비공개면 4번의 GitHub 연결도 먼저 해 둔다).

#### 그 뒤: 고친 내용 올리기

- `main`에 병합하면 GitHub Actions 검사가 모두 통과한 뒤 **자동으로 다시 배포**된다 (2~10분). 검사가 실패하면 배포하지 않고 이전 버전이 그대로 돈다
- **다시 배포하면 진행 중인 판과 방이 사라진다.** 플레이테스트 중에는 병합하지 않는다
- 바로 다시 띄우고 싶으면 서비스 화면 **Manual Deploy** → **Deploy latest commit**
- 문서만 고친 커밋도 `main`에 들어가면 다시 배포된다(방이 사라진다). 플레이테스트가 없는 시간에 병합한다
- 설정을 바꾸려면 `render.yaml`을 고쳐 `main`에 병합한다. Render가 Blueprint 변경을 읽어 적용한다 (리전은 바꿀 수 없다 — 새 서비스를 만든다)
- 맵 · 이동 · 스냅샷 · 메시지 형식을 바꾸거나 `config/balance.json` 키를 지우는 · 이름을 바꾸는 배포는 **7장**을 먼저 본다 (옛 화면을 걸러야 한다)

#### 무료 플랜에서 알아 둘 것

- **15분 동안 아무도 접속하지 않으면 서버가 잠든다.** 다음 접속 때 깨어나는 데 1분쯤 걸린다. 접속해 있는 탭이 하나라도 있으면(로비 포함) 게임이 1초마다 서버와 시계를 맞추므로 잠들지 않는다
- **깨어나는 동안 보이는 화면**
  - 이 기기에서 **처음** 여는 주소: Render가 띄우는 영어 대기 화면이 보인다. 그대로 기다리면 게임이 열린다 (1~2분 넘게 그대로면 새로고침)
  - **한 번이라도 들어와 본** 기기 · 브라우저: DECOY의 **"서버를 깨우는 중…"** 화면이 뜨고, 깨어나면 저절로 원래 주소로 다시 연다. 처음 접속 때 서비스 워커(`client/public/sw.js`)가 이 화면을 받아 둔다(HTTPS 주소에서만)
  - 이미 열려 있던 페이지(태블릿이 잠자기에서 깨어난 경우 등): 화면 가운데에 **"서버에 다시 연결하는 중…"** 안내가 뜨고, 연결되면 저절로 다시 들어간다
  - **잠들기 전의 방은 사라진다.** 깨어난 뒤 방 링크로 들어가면 "방을 찾을 수 없습니다. 서버가 잠들었다 깨어나거나 다시 시작하면 방이 사라져요…" 안내와 함께 첫 화면이 나온다. 방장이 새 방을 만들어 링크를 다시 보낸다 (서버가 잠들지 않은 짧은 끊김이면 같은 방으로 돌아간다)
- **플레이테스트 1~2분 전에 개발자가 주소를 한 번 열어** 깨워 둔다
- 잠들거나 다시 배포되면 **방과 진행 중인 판이 사라진다** (메모리에만 있다). 판이 끝나면 새로 방을 만든다
- 싱가포르라 한국에서 핑이 70~100ms 안팎 나올 수 있다(목표 30~60ms보다 높다). 게임은 예측 · 보간으로 지연을 가리고 lag 100 · 200 봇 전체 판 검사를 통과하지만, 손맛은 `&debug=1`로 핑을 보며 확인한다 (`docs/HUMAN_CHECKS.md`)
- 무료 인스턴스 시간은 한 달 750시간(워크스페이스의 무료 서비스 합산)이다. 서비스 하나는 한 달 내내 깨어 있어도(최대 744시간) 넘지 않는다. 무료 인스턴스는 CPU 0.1개 · 메모리 512MB다. 작업 환경에서 WebSocket 봇 4명으로 판을 돌렸을 때 서버는 CPU 한 코어의 약 3% · 메모리 약 70MB를 썼으니 여유는 있다. 그래도 판 중에 끊기는 느낌이 들면 유료(Starter) 플랜으로 올린다(`render.yaml`의 `plan: starter` → 잠들지도 않는다)
- 무료 플랜 조건(잠드는 시간, 무료 시간, 리전)은 Render 요금 · 문서 페이지에서 배포 시점에 다시 확인한다

### 3.5 그 밖의 서비스

Railway 같은 서비스도 Dockerfile로 배포된다. 다만 아시아 리전이 싱가포르뿐인 경우가 많아 한국에서 핑이 70~100ms 이상 나올 수 있다. 인스턴스 1개 · 잠들지 않게 설정은 똑같이 필요하다.

## 4. Docker 이미지

- 빌드: `docker build -t decoy-web .` (빌드 단계 Node 22, 실행 단계는 서버 한 파일 + 정적 파일 + `ws`만 담는다. 약 330MB)
- 실행: `docker run -p 8080:8080 decoy-web` (`-e PORT=3000`처럼 포트를 바꿀 수 있다). 컨테이너 안에 헬스 체크(`/healthz`)가 들어 있다
- **Docker Hub 요청 제한**(429)에 걸리면 미러 이미지를 쓴다: `docker build --build-arg NODE_IMAGE=mirror.gcr.io/library/node:22-bookworm-slim -t decoy-web .`
- **회사 프록시 · 사설 인증서** 환경에서 `npm ci`가 실패하면 `npm run verify:deploy`에 환경 변수 `HTTPS_PROXY`(프록시 주소), `NPM_CA`(인증서 파일)를 주고 돌린다. 이때만 인증서를 빌드 비밀로 넘기는 임시 Dockerfile을 써서 빌드하므로 BuildKit(최신 Docker 기본)이 필요하다. 기본 `Dockerfile`은 BuildKit 없이도 빌드된다
- `NODE_IMAGE` 환경 변수로 `npm run verify:deploy`의 베이스 이미지도 바꿀 수 있다
- 컨테이너는 SIGTERM을 받으면 바로 끝난다(`docker stop`, Ctrl+C)

## 5. 배포 뒤 확인

1. `https://<주소>/healthz` → `ok`
2. 방을 만들고 4명이 들어와 역할 선택 · 시작
3. 주소에 `&debug=1`을 붙이면 왼쪽 아래에 FPS · 핑이 보인다. 핑이 80ms를 넘으면 더 가까운 리전을 고른다
4. 느린 노트북은 로비의 그래픽 품질을 낮음으로(또는 주소에 `&quality=low`)

## 6. 문제 해결

| 증상 | 확인할 것 |
|---|---|
| 로비에서 "연결이 끊겼습니다"가 반복된다 | 서비스가 WebSocket을 지원하는지, 프록시가 `/ws` 업그레이드를 막지 않는지 |
| 같은 방 코드인데 서로 안 보인다 | 인스턴스가 2개 이상이다 → 1개로 고정 |
| 판 중에 갑자기 로비로 돌아간다 | 서버가 잠들었거나 재시작했다 → 최소 1개 유지, 재배포는 판이 없을 때 |
| 첫 접속이 몇십 초 걸린다 | 무료 플랜이 잠들어 있었다 → 테스트 전에 한 번 접속해 깨운다 |
| "서버를 깨우는 중…"이 2분 넘게 이어진다 | 호스팅 서비스 화면(Render 대시보드)에서 서비스 상태 · 로그 확인. 배포가 실패했거나 무료 시간을 다 썼을 수 있다 |
| 서버는 깨어 있는데 한 번 들어왔던 기기에서만 깨우기 화면이 계속 뜬다 | 화면의 **다시 시도**(90초 뒤 나타남, M13d부터는 새로고침만)를 누른다. 그래도 같으면 브라우저 설정에서 그 사이트의 데이터를 지운다(서비스 워커 · 앱 셸 캐시가 지워진다). 깨우기 화면은 서버 응답의 `x-decoy-server` 표시로 서버가 깨어난 것을 알아보는데, 표시가 없는 서버(이 기능 이전 버전으로 되돌린 경우)를 만나면 스스로 서비스 워커를 지운다 |
| 깨우기 기능을 아예 빼고 싶다 | `client/public/sw.js`를 지우기만 하면 이미 설치된 기기에 남는다. 대신 내용을 `self.addEventListener('install', () => self.skipWaiting()); self.addEventListener('activate', () => self.registration.unregister());`로 바꿔 배포하고, `client/src/main.ts`의 등록 코드를 뺀다 |
| Render 배포가 "Waiting for checks"에서 멈춰 있다 | `main`의 GitHub Actions 검사가 실패했거나 아직 도는 중이다 (`autoDeployTrigger: checksPass`). 검사를 고치거나 **Manual Deploy** |
| 화면이 끊긴다 | 로비의 그래픽 품질을 낮음으로(또는 주소에 `&quality=low`), 다른 탭 · 프로그램 닫기, `&debug=1`로 FPS 확인 |

## 7. 옛 화면과 맞지 않는 배포 (프로토콜 버전)

지금은 서버와 화면의 빌드가 달라도(배포 전에 열어 둔 탭, 설치한 앱의 앱 셸 캐시) 방 만들기 · 입장 · 빠른 매칭이 그대로 된다. 화면 위에 **"새 버전이 있어요"** 띠만 뜬다(M13d, welcome · pong의 빌드 ID 비교). 바뀐 내용이 옛 화면과 맞으면 이것으로 충분하다.

다음 가운데 하나라도 바꾸는 배포는 옛 화면과 맞지 않는다. 옛 화면이 그대로 들어오면 그 판이 깨진다 (예측이 서버 판정과 어긋나 캐릭터가 끌려감, 모르는 필드 · 메시지로 화면 오류, 없는 balance 키로 화면이 멈춤).

- 맵: 벽 · 거점 · 탈출구 · 감옥 위치 (화면의 예측 · 그리기가 같은 맵 코드를 쓴다)
- 이동: `shared/movement.ts` (내 캐릭터 예측과 서버 판정이 같은 코드여야 한다)
- 스냅샷 · 메시지 형식: `shared/src/types.ts`의 필드를 지우거나 이름 · 뜻을 바꿈 (필드 추가만은 대개 맞는다)
- `config/balance.json` 키 삭제 · 개명 (화면은 welcome으로 받은 balance를 `validateBalance`로 읽는다)

그런 배포에는 **같은 배포 안에** 다음을 넣는다. 지금 코드에는 없다 — 첫 비호환 배포 때 넣으면 된다(아래 4 때문에 소급해서 된다).

1. `shared/src/types.ts`에 `export const PROTOCOL_VERSION = 1`을 두고, 그 뒤 비호환 배포마다 1씩 올린다
2. 클라이언트가 보내는 `join` · `quick`에 `proto: PROTOCOL_VERSION`을 싣는다 (`ClientMessage` 타입에 필드를 더한다)
3. 서버 `ServerCore.connect()`(`shared/src/sim/core.ts`)의 join · quick 분기 맨 앞에서 `proto`가 없거나 다르면 자리에 묶지 않고 오류로 거절한다. 문구는 새로고침 안내(예: "새 버전이 나왔어요. 새로고침해 주세요")이고 `docs/STORY_TEXT.md` · `client/src/data/storyText.ts`에 함께 적는다. 새 오류 코드(예: `update-required`)를 `ErrorCode`에 더하면 새 화면은 그 코드에서 "새 버전이 있어요" 띠를 띄울 수 있다
4. **지금 화면은 `proto`를 보내지 않는다.** 그래서 그 배포가 나가면 지금 화면(과 그 전 화면)은 모두 "없음 = 옛 화면"으로 걸러진다. 옛 화면은 모르는 오류 코드도 받은 문구를 오류 줄에 띄우므로(`client/src/app.ts` error 처리의 마지막 줄) 새로고침 안내가 그대로 보인다
5. 기기 안 연습(봇과 연습, `RoomConfig.practice` 서버)은 화면과 같은 빌드에 들어 있어 어긋날 수 없으므로 검사하지 않고 통과시킨다 — 오프라인 연습이 막히지 않게
6. 첫 화면 자동 새로고침은 넣지 않는다: 앱 셸 캐시(`?practice=1` 캐시 먼저) · 깨우기 화면(`wake.html`)과 엮이면 새로고침이 되풀이될 수 있다

배포 뒤 확인: 배포 전 빌드로 열어 둔 탭에서 빠른 매칭 · 방 만들기를 눌러 새로고침 안내가 뜨는지, 새로고침한 탭은 그대로 들어가는지, 비행기 모드에서 봇과 연습이 되는지 본다.

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

- 헬스 체크: `GET /healthz` → `ok`
- 서버 옵션: `--port` (또는 `PORT`), `--host` (또는 `HOST`, 기본 `0.0.0.0`), `--balance <파일>` (또는 `DECOY_BALANCE`)
- 배포 전 확인: `npm run verify:deploy` — Docker가 있으면 이미지를 빌드해 컨테이너로 띄우고, 없으면 빌드 결과물을 `PORT`로 띄워서 첫 화면 HTTP 200 · 스크립트 · WebSocket 방 만들기까지 확인한다

## 1. 로컬 (한 컴퓨터)

1. `npm start`
2. 브라우저에서 `http://localhost:8080` → **방 만들기**
3. 탭 3개를 더 열어 로비의 **링크 복사** 주소로 들어간다 (탭마다 다른 자리가 된다)
4. 혼자 시험할 때는 `http://localhost:8080/?bots=1`로 방을 만들면 시작할 때 빈 역할을 봇이 채운다

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

## 3. 인터넷 배포 (한국 · 일본 리전)

목표 핑은 30~60ms다. 플레이어와 가까운 **서울** 또는 **도쿄** 리전을 고른다. 서비스마다 무료 플랜 · 리전 · 요금 조건이 자주 바뀌므로 배포 시점에 확인한다. 어느 서비스든 조건은 같다.

| 조건 | 이유 |
|---|---|
| WebSocket 지원 | 실시간 통신. HTTPS로 배포하면 클라이언트가 자동으로 `wss://`를 쓴다 |
| 인스턴스 1개 고정 | 방 상태가 메모리에 있다 |
| 잠들지 않게(최소 1개 유지) | 잠들면 첫 접속이 느리고, 판 중에 잠들면 판이 사라진다. 무료 플랜이 잠드는 서비스라면 **테스트 전에 한 번 접속해 깨운다** |
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

### 3.4 그 밖의 서비스

Render · Railway 같은 서비스도 Dockerfile로 배포된다. 다만 아시아 리전이 싱가포르뿐인 경우가 많아 한국에서 핑이 70~100ms 이상 나올 수 있다. 인스턴스 1개 · 잠들지 않게 설정은 똑같이 필요하다.

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
4. 느린 노트북은 `&scale=0.5`(저사양 모드)

## 6. 문제 해결

| 증상 | 확인할 것 |
|---|---|
| 로비에서 "연결이 끊겼습니다"가 반복된다 | 서비스가 WebSocket을 지원하는지, 프록시가 `/ws` 업그레이드를 막지 않는지 |
| 같은 방 코드인데 서로 안 보인다 | 인스턴스가 2개 이상이다 → 1개로 고정 |
| 판 중에 갑자기 로비로 돌아간다 | 서버가 잠들었거나 재시작했다 → 최소 1개 유지, 재배포는 판이 없을 때 |
| 첫 접속이 몇십 초 걸린다 | 무료 플랜이 잠들어 있었다 → 테스트 전에 한 번 접속해 깨운다 |
| 화면이 끊긴다 | `&scale=0.5`, 다른 탭 · 프로그램 닫기, `&debug=1`로 FPS 확인 |

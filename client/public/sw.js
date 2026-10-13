// DECOY 서비스 워커: 앱 셸 캐시 (M13d) + 서버 깨우기 화면.
//  - 앱 셸: 빌드 때 dist 파일 목록(sw.js · wake.html · build-id.json · icons/ 제외 — client/shellBuild.ts)과 빌드 ID가 아래 두 줄에
//    들어간다(client/vite.config.ts). 설치할 때 모두 받아 `decoy-shell-<빌드ID>`에 넣는다. 응답이 정상이고 content-type이 맞고
//    `x-decoy-build`가 이 빌드와 같을 때만 넣고, 하나라도 어긋나면 설치를 실패시켜 다음에 다시 한다(옛 HTML이 JS 자리에 들어가지 않게).
//    받을 때는 'no-cache'(조건부 재검증): 페이지가 방금 받은 같은 파일은 304로 끝나고, 304의 새 x-decoy-build가 저장된 헤더에
//    합쳐져 빌드 검사도 그대로 맞는다('default'는 안 된다 — immutable 자산이 옛 빌드 헤더를 단 채 HTTP 캐시에서 나와 설치가 막힌다)
//  - 페이지 이동 세 갈래: 5초 안에 이 서버(x-decoy-server: 1)가 답하면 그대로 / 네트워크 자체가 실패(오프라인 · 서버 꺼짐)하면
//    캐시한 앱 셸 → 첫 화면이 상태 줄 안내 + "봇과 연습" / 느리거나 표시 없는 응답(잠든 Render의 대기 화면)이면 wake.html.
//    `?practice=1` 이동은 캐시 먼저(잠든 서버를 기다리지 않는다).
//    처리방침(M15 /privacy)은 네트워크 먼저: 이 서버의 응답이면 그대로 내고, 같은 빌드의 200이면 셸 사본도 그 판으로 바꾼다
//    (문의처 환경 변수만 바꾼 재배포처럼 빌드 ID가 같아도 따라가게). 실패 · 느림 · 표시 없는 응답이면 깨우기 화면이 아니라 셸 사본
//  - 자산(같은 출처 GET, 페이지 이동 아님)은 이 빌드 셸에 있으면 캐시, 없으면 네트워크
//  - /ws · /healthz · /test/* · /.well-known/*는 가로채지 않는다
//  - 옛 `decoy-shell-*`는 새 워커가 켜질 때 지운다(동적 import가 없어 열린 화면은 더 받을 자산이 없다)
// 빌드하지 않은 원본(개발 · 시험)에서는 BUILD가 null이라 앱 셸 없이 깨우기 화면만 한다

const BUILD = null; // 빌드 때 바뀐다 (vite.config.ts decoyBuild)
const SHELL = []; // 빌드 때 바뀐다

const WAKE_CACHE = 'decoy-wake-v2';
const SHELL_CACHE = BUILD ? `decoy-shell-${BUILD}` : null;
const SCOPE = new URL('./', self.location.href);
const WAKE_URL = new URL('wake.html', SCOPE).href;
const INDEX_URL = new URL('index.html', SCOPE).href;
const PRIVACY_URL = new URL('privacy.html', SCOPE).href;
const NETWORK_WAIT_MS = 5000;
const MARK_HEADER = 'x-decoy-server';
const BUILD_HEADER = 'x-decoy-build';
/** 가로채지 않는 경로 (앞부분) */
const PASS = ['/ws', '/healthz', '/test/', '/.well-known/'];

/** 확장자별로 와야 하는 content-type 앞부분 (JS 자리에 HTML이 오면 설치 실패) */
const TYPE_PREFIX = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain',
};

function extOf(path) {
  const m = /\.[a-z0-9]+$/i.exec(path);
  return m ? m[0].toLowerCase() : '';
}

/** 사전 캐시에 넣어도 되는 응답인가 */
function goodShellResponse(path, res) {
  if (!(res instanceof Response) || res.status !== 200) return false;
  if (res.headers.get(BUILD_HEADER) !== BUILD) return false;
  const want = TYPE_PREFIX[extOf(path)];
  const type = res.headers.get('content-type') || '';
  return want ? type.startsWith(want) : true;
}

async function precacheShell() {
  if (!SHELL_CACHE) return;
  const fetched = await Promise.all(
    SHELL.map(async (path) => {
      const url = new URL(path, SCOPE).href;
      // 조건부 재검증: 같은 파일은 304로 끝난다 (머리 주석)
      const res = await fetch(new Request(url, { cache: 'no-cache' }));
      if (!goodShellResponse(path, res)) throw new Error(`앱 셸 사전 캐시 실패: ${path}`);
      return [url, res];
    }),
  );
  // 모두 맞을 때만 넣는다 (일부만 든 셸로 오프라인 화면이 깨지지 않게)
  const cache = await caches.open(SHELL_CACHE);
  await Promise.all(fetched.map(([url, res]) => cache.put(url, res)));
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(WAKE_CACHE)
      .then((cache) => cache.add(new Request(WAKE_URL, { cache: 'reload' })))
      .then(() => precacheShell())
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (k) =>
                (k.startsWith('decoy-wake-') && k !== WAKE_CACHE) ||
                (k.startsWith('decoy-shell-') && k !== SHELL_CACHE),
            )
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (PASS.some((p) => url.pathname === p || url.pathname.startsWith(p))) return;
  if (url.href === WAKE_URL) return;
  if (req.mode === 'navigate') {
    event.respondWith(navigate(event, url));
    return;
  }
  if (SHELL_CACHE) event.respondWith(asset(req));
});

function fromServer(res) {
  return res instanceof Response && res.headers.get(MARK_HEADER) === '1';
}

async function shellMatch(url) {
  if (!SHELL_CACHE) return undefined;
  const cache = await caches.open(SHELL_CACHE);
  return cache.match(url, { ignoreSearch: true });
}

/** 자산: 이 빌드 셸에 있으면 캐시, 없으면 네트워크 */
async function asset(req) {
  const cached = await shellMatch(req.url);
  return cached || fetch(req);
}

async function navigate(event, url) {
  // 봇과 연습: 캐시 먼저 (잠든 서버를 기다리지 않는다)
  if (url.searchParams.get('practice') === '1') {
    const shell = await shellMatch(INDEX_URL);
    if (shell) return shell;
  }
  const privacy = url.pathname === '/privacy' || url.pathname === '/privacy.html';
  const network = fetch(event.request);
  // 늦게 온 응답도 끝까지 받는다 (이 요청이 잠든 서버를 깨운다). 이 반응은 아래 경주보다 먼저 걸려 있어 먼저 돈다:
  // 처리방침 사본은 응답 본문이 화면으로 넘어가기 전에 복제한다
  event.waitUntil(
    network.then(
      (res) => {
        if (!fromServer(res) || !res.ok) return undefined;
        return Promise.all([refreshWakePage(), privacy ? refreshPrivacy(res.clone()) : undefined]);
      },
      () => undefined,
    ),
  );
  const first = await Promise.race([
    network.then(
      (res) => ({ kind: 'response', res }),
      () => ({ kind: 'failed' }),
    ),
    new Promise((resolve) => setTimeout(() => resolve({ kind: 'slow' }), NETWORK_WAIT_MS)),
  ]);
  if (first.kind === 'response' && fromServer(first.res)) return first.res;
  // 처리방침: 실패 · 느림 · 표시 없는 응답이면 셸 사본 (읽으러 온 문서를 보여 준다 — 깨우기 화면이 아니다)
  if (privacy) {
    const page = await shellMatch(PRIVACY_URL);
    if (page) return page;
  }
  // 네트워크 자체가 실패(오프라인 · 서버 꺼짐): 앱 셸 → 첫 화면이 상태 줄 안내 + 봇과 연습
  if (first.kind === 'failed') {
    const shell = await shellMatch(INDEX_URL);
    if (shell) return shell;
  }
  // 느리거나 이 서버가 아닌 응답(잠든 서버의 대기 화면): 깨우기 화면
  const wake = await caches.match(WAKE_URL);
  if (wake) return wake;
  // 깨우기 화면이 아직 없으면(설치 직후 등) 원래대로 기다린다
  return network;
}

/** 처리방침 셸 사본을 이 서버 · 같은 빌드의 정상 응답으로 바꾼다 (다른 빌드 · 오류 응답은 넣지 않는다) */
async function refreshPrivacy(res) {
  if (!SHELL_CACHE || !goodShellResponse('privacy.html', res)) return;
  try {
    const cache = await caches.open(SHELL_CACHE);
    await cache.put(PRIVACY_URL, res);
  } catch {
    // 다음 기회에
  }
}

/** 서버가 깨어 있을 때 깨우기 화면을 새로 받아 둔다 (배포로 wake.html이 바뀌어도 따라가게) */
async function refreshWakePage() {
  try {
    const cache = await caches.open(WAKE_CACHE);
    await cache.add(new Request(WAKE_URL, { cache: 'no-cache' }));
  } catch {
    // 다음 기회에
  }
}

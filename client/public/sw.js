// 서버 깨우기 화면용 서비스 워커.
// Render 무료 플랜처럼 잠드는 서버는 깨어나는 동안(1분쯤) 첫 화면을 바로 주지 못하고, 호스팅 서비스의 영어 대기 화면이 뜬다.
// 한 번이라도 접속한 기기에서는 이 워커가 페이지 이동을 가로채,
//   - 서버가 5초 안에 답하고 그 응답이 이 서버의 것(x-decoy-server: 1)이면 그대로 보여 주고
//   - 늦거나 실패하거나 다른 곳(호스팅 서비스)이 답했으면 미리 받아 둔 wake.html('서버를 깨우는 중…')을 보여 준다.
// wake.html은 서버가 깨어나면(healthz) 스스로 새로고침해서 원래 주소로 돌아간다.
// 페이지 이동만 다룬다. 스크립트 · 이미지 · WebSocket은 건드리지 않는다 (게임 코드는 캐시하지 않는다)

const CACHE = 'decoy-wake-v2';
const WAKE_URL = new URL('wake.html', self.location.href).href;
const NETWORK_WAIT_MS = 5000;
const MARK_HEADER = 'x-decoy-server';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.add(new Request(WAKE_URL, { cache: 'reload' })))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k.startsWith('decoy-wake-') && k !== CACHE).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.mode !== 'navigate' || req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // 테스트 훅과 깨우기 화면 자체는 그대로 둔다
  if (url.pathname.includes('/test/') || url.href === WAKE_URL) return;
  event.respondWith(navigate(event));
});

function fromServer(res) {
  return res instanceof Response && res.headers.get(MARK_HEADER) === '1';
}

async function navigate(event) {
  const network = fetch(event.request);
  // 늦게 온 응답도 끝까지 받는다 (이 요청이 잠든 서버를 깨운다)
  event.waitUntil(
    network.then(
      (res) => (fromServer(res) && res.ok ? refreshWakePage() : undefined),
      () => undefined,
    ),
  );
  const first = await Promise.race([
    network.catch(() => null),
    new Promise((resolve) => setTimeout(() => resolve(null), NETWORK_WAIT_MS)),
  ]);
  if (fromServer(first)) return first;
  const cached = await caches.match(WAKE_URL);
  if (cached) return cached;
  // 깨우기 화면이 아직 없으면(설치 직후 등) 원래대로 기다린다
  return network;
}

/** 서버가 깨어 있을 때 깨우기 화면을 새로 받아 둔다 (배포로 wake.html이 바뀌어도 따라가게) */
async function refreshWakePage() {
  try {
    const cache = await caches.open(CACHE);
    await cache.add(new Request(WAKE_URL, { cache: 'no-cache' }));
  } catch {
    // 다음 기회에
  }
}

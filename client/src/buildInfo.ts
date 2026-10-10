// 이 화면의 빌드 ID (M13d, Vite 플러그인이 빌드마다 정해 넣는다 — client/vite.config.ts). 서버 빌드 ID(welcome · pong)와
// 다르면 앱 셸 캐시가 옛 화면을 준 것이라 "새 버전이 있어요"를 띄운다. 개발 서버 · 단위 시험은 'dev'
declare const __DECOY_BUILD__: string | undefined;

export const CLIENT_BUILD: string = typeof __DECOY_BUILD__ === 'string' ? __DECOY_BUILD__ : 'dev';

/** 서버 빌드와 화면 빌드가 다른가 (어느 한쪽을 모르거나 개발 빌드면 비교하지 않는다) */
export function buildMismatch(server: string | null | undefined, client: string = CLIENT_BUILD): boolean {
  if (!server || client === 'dev') return false;
  return server !== client;
}

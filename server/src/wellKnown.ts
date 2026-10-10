// 안드로이드 앱(TWA) 도메인 연결: /.well-known/assetlinks.json (M14, docs/PLAY_STORE_GUIDE.md 2부)
// 구글 플레이 앱이 주소창 없이 이 사이트를 열려면 사이트가 "이 앱(패키지 + 서명 키 지문)은 내 것"이라고 밝혀야 한다.
// 값은 저장소에 두지 않고 배포 환경 변수로 받는다(Render 대시보드): TWA_PACKAGE_NAME, TWA_SHA256_FINGERPRINTS(쉼표로 여러 개 —
// 업로드 키 + Play 앱 서명 키). 값이 없거나 형식이 틀리면 null → 서버는 404(게임 HTML로 새지 않게)

export const ASSETLINKS_PATH = '/.well-known/assetlinks.json';
export const TWA_PACKAGE_ENV = 'TWA_PACKAGE_NAME';
export const TWA_FINGERPRINTS_ENV = 'TWA_SHA256_FINGERPRINTS';

/** SHA-256 인증서 지문: 대문자 16진수 두 자리 32쌍을 콜론으로 (Play Console · keytool 표시 그대로) */
const FINGERPRINT = /^[0-9A-F]{2}(?::[0-9A-F]{2}){31}$/;
/** 안드로이드 패키지 이름: 점으로 나눈 두 마디 이상, 마디는 글자로 시작 */
const PACKAGE = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/;

export interface AssetLink {
  relation: string[];
  target: { namespace: 'android_app'; package_name: string; sha256_cert_fingerprints: string[] };
}

export function isFingerprint(value: string): boolean {
  return FINGERPRINT.test(value);
}

export function isPackageName(value: string): boolean {
  return PACKAGE.test(value);
}

/** 쉼표로 나눈 지문 목록 (앞뒤 공백 무시, 빈 칸 제외). 하나라도 형식이 틀리면 null */
export function parseFingerprints(raw: string | undefined): string[] | null {
  const list = (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
  if (list.length === 0 || !list.every(isFingerprint)) return null;
  return [...new Set(list)];
}

/** assetlinks.json 내용. 패키지나 지문이 없거나 틀리면 null */
export function buildAssetLinks(
  packageName: string | undefined,
  fingerprints: readonly string[] | null,
): AssetLink[] | null {
  const pkg = (packageName ?? '').trim();
  if (!isPackageName(pkg) || !fingerprints || fingerprints.length === 0 || !fingerprints.every(isFingerprint))
    return null;
  return [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: { namespace: 'android_app', package_name: pkg, sha256_cert_fingerprints: [...fingerprints] },
    },
  ];
}

/** 환경 변수에서: 응답 본문(JSON 문자열) 또는 null, 그리고 값이 있는데 틀렸으면 그 이유(서버 시작 로그용) */
export function assetLinksFromEnv(env: Record<string, string | undefined>): {
  body: string | null;
  problem: string | null;
} {
  const pkg = env[TWA_PACKAGE_ENV];
  const raw = env[TWA_FINGERPRINTS_ENV];
  const given = (pkg ?? '').trim() !== '' || (raw ?? '').trim() !== '';
  const links = buildAssetLinks(pkg, parseFingerprints(raw));
  if (links) return { body: JSON.stringify(links), problem: null };
  if (!given) return { body: null, problem: null };
  return {
    body: null,
    problem: `${TWA_PACKAGE_ENV} · ${TWA_FINGERPRINTS_ENV} 형식이 맞지 않아 ${ASSETLINKS_PATH}를 내지 않습니다 (패키지 예: com.example.decoy, 지문: 대문자 16진수 32쌍을 콜론으로, 여러 개는 쉼표)`,
  };
}

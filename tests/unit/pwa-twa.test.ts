// M14 PWA · TWA 준비: manifest 필드, 아이콘 PNG(선언 크기 · 불투명 · maskable 안전 영역), assetlinks.json 만들기 ·
// 환경 변수, 서버 경로(200 JSON · 404), render.yaml 키 자리, 서명 키 가드(.gitignore · 추적 파일)
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { request } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import {
  ASSETLINKS_PATH,
  TWA_FINGERPRINTS_ENV,
  TWA_PACKAGE_ENV,
  assetLinksFromEnv,
  buildAssetLinks,
  isPackageName,
  parseFingerprints,
} from '../../server/src/wellKnown';
import { decodePng, readPngInfo } from '../helpers/png';
import { startServer, type RunningServer } from '../helpers/serverProcess';

interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose: string;
}
const manifest = JSON.parse(readFileSync('client/public/manifest.webmanifest', 'utf8')) as Record<
  string,
  unknown
> & { icons: ManifestIcon[] };

const FP_A = Array.from({ length: 32 }, (_, i) => ((i * 7 + 3) & 255).toString(16).padStart(2, '0'))
  .join(':')
  .toUpperCase();
const FP_B = Array.from({ length: 32 }, (_, i) => ((i * 11 + 5) & 255).toString(16).padStart(2, '0'))
  .join(':')
  .toUpperCase();

describe('manifest.webmanifest', () => {
  it('필드: 가로 · 전체 화면 · 시작 주소 · 범위 · 색 · 언어 · 게임 분류', () => {
    expect(manifest).toMatchObject({
      id: '/',
      name: 'DECOY',
      short_name: 'DECOY',
      lang: 'ko',
      start_url: '/?source=pwa',
      scope: '/',
      display: 'fullscreen',
      orientation: 'landscape',
      background_color: '#0B1622',
      categories: ['games'],
    });
    expect(String(manifest.theme_color).toLowerCase()).toBe('#0b1622');
    expect(String(manifest.description).length).toBeGreaterThan(10);
  });

  it('index.html이 manifest와 theme-color를 건다', () => {
    const html = readFileSync('client/index.html', 'utf8');
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest" />');
    expect(html).toContain('<meta name="theme-color" content="#0b1622" />');
  });

  it('아이콘: any 192 · 512 + maskable 192 · 512, 파일의 실제 PNG 크기가 선언과 같다', () => {
    const want = ['any 192', 'any 512', 'maskable 192', 'maskable 512'];
    expect(manifest.icons.map((i) => `${i.purpose} ${i.sizes.split('x')[0]}`).sort()).toEqual(want.sort());
    for (const icon of manifest.icons) {
      expect(icon.type).toBe('image/png');
      const info = readPngInfo(readFileSync(`client/public/${icon.src}`));
      const [w, h] = icon.sizes.split('x').map(Number);
      expect([info.width, info.height], icon.src).toEqual([w, h]);
    }
  });
});

/** 화소 (x, y)의 [r, g, b, a] */
function px(img: ReturnType<typeof decodePng>, x: number, y: number): number[] {
  const o = (y * img.width + x) * 4;
  return [img.rgba[o] ?? 0, img.rgba[o + 1] ?? 0, img.rgba[o + 2] ?? 0, img.rgba[o + 3] ?? 0];
}

describe('아이콘 PNG', () => {
  const files = [
    'client/public/icons/icon-192.png',
    'client/public/icons/icon-512.png',
    'client/public/icons/maskable-192.png',
    'client/public/icons/maskable-512.png',
    'artifacts/store/app-icon-512.png',
  ];

  it('모두 32비트 RGBA이고 완전 불투명 (네 모서리 포함)', () => {
    for (const f of files) {
      const img = decodePng(readFileSync(f));
      expect([img.bitDepth, img.colorType], f).toEqual([8, 6]);
      let minAlpha = 255;
      for (let i = 3; i < img.rgba.length; i += 4) minAlpha = Math.min(minAlpha, img.rgba[i] ?? 0);
      expect(minAlpha, f).toBe(255);
      for (const [x, y] of [
        [0, 0],
        [img.width - 1, 0],
        [0, img.height - 1],
        [img.width - 1, img.height - 1],
      ] as const)
        expect(px(img, x, y)[3], `${f} 모서리`).toBe(255);
    }
  });

  it('maskable: 가운데 80% 안전 원 밖은 바탕(어두운 청회색)만 — 로고 네온이 잘릴 자리에 없다', () => {
    for (const f of ['client/public/icons/maskable-192.png', 'client/public/icons/maskable-512.png']) {
      const img = decodePng(readFileSync(f));
      const c = img.width / 2;
      let outside = 0;
      for (let y = 0; y < img.height; y += 1)
        for (let x = 0; x < img.width; x += 1) {
          if (Math.hypot(x + 0.5 - c, y + 0.5 - c) <= img.width * 0.4) continue;
          outside += 1;
          const [r, g, b] = px(img, x, y);
          // 바탕 #0B1622 + 은은한 청록 빛: 어둡고(채널 60 이하) 네온(밝은 청록)이 아니다
          expect(Math.max(r ?? 0, g ?? 0, b ?? 0), `${f} (${x},${y})`).toBeLessThanOrEqual(60);
        }
      expect(outside).toBeGreaterThan(img.width * img.width * 0.4);
    }
  });

  it('스토어 아이콘은 512×512 · 1MB 이하', () => {
    const buf = readFileSync('artifacts/store/app-icon-512.png');
    const info = readPngInfo(buf);
    expect([info.width, info.height]).toEqual([512, 512]);
    expect(buf.length).toBeLessThan(1024 * 1024);
  });
});

describe('assetlinks.json 만들기', () => {
  it('패키지 + 지문 여러 개로 정확한 JSON (handle_all_urls)', () => {
    expect(buildAssetLinks('com.example.decoy', [FP_A, FP_B])).toEqual([
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: 'com.example.decoy',
          sha256_cert_fingerprints: [FP_A, FP_B],
        },
      },
    ]);
  });

  it('지문: 쉼표로 여러 개 · 공백 무시 · 중복 제거, 소문자 · 길이 · 구분자 오류면 거부', () => {
    expect(parseFingerprints(` ${FP_A} , ${FP_B},${FP_A}, `)).toEqual([FP_A, FP_B]);
    expect(parseFingerprints(FP_A.toLowerCase())).toBeNull();
    expect(parseFingerprints(FP_A.slice(3))).toBeNull();
    expect(parseFingerprints(FP_A.replaceAll(':', ''))).toBeNull();
    expect(parseFingerprints(`${FP_A},${FP_B.slice(0, -1)}`)).toBeNull();
    expect(parseFingerprints('')).toBeNull();
    expect(parseFingerprints(undefined)).toBeNull();
  });

  it('패키지 이름 형식', () => {
    expect(isPackageName('com.example.decoy')).toBe(true);
    expect(isPackageName('kr.decoy_game.app2')).toBe(true);
    for (const bad of ['decoy', 'com..decoy', '1com.decoy', 'com.1decoy', 'com.decoy.', 'com decoy.app', ''])
      expect(isPackageName(bad), bad).toBe(false);
  });

  it('비거나 틀리면 null (환경 변수: 값이 있는데 틀리면 이유를 알린다)', () => {
    expect(buildAssetLinks('', [FP_A])).toBeNull();
    expect(buildAssetLinks('com.example.decoy', [])).toBeNull();
    expect(buildAssetLinks('com.example.decoy', null)).toBeNull();
    expect(assetLinksFromEnv({})).toEqual({ body: null, problem: null });
    const bad = assetLinksFromEnv({ [TWA_PACKAGE_ENV]: 'com.example.decoy', [TWA_FINGERPRINTS_ENV]: 'abc' });
    expect(bad.body).toBeNull();
    expect(bad.problem).toContain(TWA_FINGERPRINTS_ENV);
    const ok = assetLinksFromEnv({
      [TWA_PACKAGE_ENV]: 'com.example.decoy',
      [TWA_FINGERPRINTS_ENV]: `${FP_A},${FP_B}`,
    });
    expect(JSON.parse(ok.body ?? 'null')).toEqual(buildAssetLinks('com.example.decoy', [FP_A, FP_B]));
  });
});

function get(
  port: number,
  path: string,
): Promise<{ status: number; headers: Record<string, unknown>; body: string }> {
  return new Promise((resolve, reject) => {
    request({ host: '127.0.0.1', port, path }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c: string) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    })
      .on('error', reject)
      .end();
  });
}

describe('서버 경로 (실제 서버 프로세스)', () => {
  let withEnv: RunningServer;
  let without: RunningServer;
  beforeAll(async () => {
    withEnv = await startServer([], {
      env: { [TWA_PACKAGE_ENV]: 'com.example.decoy', [TWA_FINGERPRINTS_ENV]: `${FP_A}, ${FP_B}` },
    });
    without = await startServer([], { env: { [TWA_PACKAGE_ENV]: '', [TWA_FINGERPRINTS_ENV]: '' } });
  });
  afterAll(async () => {
    await withEnv.stop();
    await without.stop();
  });

  it('환경 변수가 있으면 assetlinks 200 · application/json · 리다이렉트 없음 · 본문 일치', async () => {
    const r = await get(withEnv.port, ASSETLINKS_PATH);
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe('application/json');
    expect(r.headers.location).toBeUndefined();
    expect(JSON.parse(r.body)).toEqual(buildAssetLinks('com.example.decoy', [FP_A, FP_B]));
  });

  it('없으면 404 · HTML이 아니다 (게임 첫 화면이 새지 않게)', async () => {
    const r = await get(without.port, ASSETLINKS_PATH);
    expect(r.status).toBe(404);
    expect(String(r.headers['content-type'])).toContain('text/plain');
    expect(r.body).not.toContain('<html');
    const other = await get(without.port, '/.well-known/other.json');
    expect(other.status).toBe(404);
  });
});

describe('render.yaml', () => {
  it('assetlinks 환경 변수는 값 없이 키 자리만 (sync: false), 플랜은 free 그대로', () => {
    const doc = parse(readFileSync('render.yaml', 'utf8')) as {
      services: { plan: string; envVars: { key: string; value?: string; sync?: boolean }[] }[];
    };
    const svc = doc.services[0];
    expect(svc?.plan).toBe('free');
    for (const key of [TWA_PACKAGE_ENV, TWA_FINGERPRINTS_ENV]) {
      const v = svc?.envVars.find((e) => e.key === key);
      expect(v, key).toEqual({ key, sync: false });
    }
  });
});

describe('서명 키 가드 (MOBILE_PLAN 제안 21)', () => {
  const ignored = (path: string): boolean => {
    try {
      execFileSync('git', ['check-ignore', '-q', '--no-index', path]);
      return true;
    } catch {
      return false;
    }
  };

  it('.gitignore가 서명 키 · 패키지 파일을 막는다', () => {
    for (const p of [
      'upload.jks',
      'android/signing.keystore',
      'release.keystore',
      'app-release-bundle.aab',
      'app-release-signed.apk',
      'signing-key-info.txt',
      'pwabuilder/signing-key-info.txt',
    ])
      expect(ignored(p), p).toBe(true);
    // 스토어 이미지 폴더는 커밋한다
    expect(ignored('artifacts/store/app-icon-512.png')).toBe(false);
  });

  it('추적 파일에 키 · 패키지 파일, JKS 매직 · 개인 키 문자열이 없다', () => {
    const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
    expect(files.filter((f) => /\.(jks|keystore|aab|apk)$|signing-key-info\.txt$/i.test(f))).toEqual([]);
    const magic = Buffer.from([0xfe, 0xed, 0xfe, 0xed]);
    const marker = ['PRIVATE', 'KEY-----'].join(' ');
    for (const f of files) {
      let buf: Buffer;
      try {
        buf = readFileSync(f);
      } catch {
        continue;
      }
      expect(buf.subarray(0, 4).equals(magic), `${f} JKS`).toBe(false);
      expect(buf.includes(marker), `${f} 개인 키`).toBe(false);
    }
  });
});

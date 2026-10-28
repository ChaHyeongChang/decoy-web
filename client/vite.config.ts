import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { listShellFiles, precompressDist, swWithBuild } from './shellBuild';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const serverPort = Number(process.env.DECOY_SERVER_PORT ?? 8080);

/**
 * Phaser 사용자 빌드 (배포 빌드만): 'phaser'를 코어 + 쓰는 게임 오브젝트만 담은 `src/phaserCore.js`로 바꾼다.
 * 물리 · 타일맵 · 사운드 · 파티클 · 3D 카메라 등을 빼서 JS gzip이 약 140KB 줄어든다(휴대폰 첫 접속). 개발 서버는 전체 Phaser 그대로
 */
const PHASER_FLAGS: Readonly<Record<string, boolean>> = {
  WEBGL_RENDERER: true,
  CANVAS_RENDERER: true,
  FEATURE_SOUND: false,
  WEBGL_DEBUG: false,
  PLUGIN_CAMERA3D: false,
  PLUGIN_FBINSTANT: false,
  EXPERIMENTAL: false,
};

/**
 * 사용자 빌드에서 빈 모듈로 바꾸는 Phaser 파일 (phaser/src 기준): 미리 FX(preFX) 파이프라인 · FX 셰이더 묶음 · FX 컨트롤러.
 * 게임 설정이 disablePreFX · disablePostFX를 켜(main.ts) 부팅 때 만들지 않고, 게임 오브젝트의 FX 추가 함수(addGlow 등)는 부르지 않는다.
 * 만들려 하면 바로 알 수 있게 생성자는 오류를 던진다 (DECISIONS 11절 '번들 줄이기')
 */
const PHASER_STUBS: Readonly<Record<string, string>> = {
  'renderer/webgl/pipelines/fx/index.js': 'module.exports = {};',
  'fx/index.js': 'module.exports = {};',
  'renderer/webgl/pipelines/FXPipeline.js':
    "module.exports = function FXPipeline () { throw new Error('FXPipeline: Phaser 사용자 빌드에 없다 (disablePreFX)'); };",
  'renderer/webgl/pipelines/PreFXPipeline.js':
    "module.exports = function PreFXPipeline () { throw new Error('PreFXPipeline: Phaser 사용자 빌드에 없다 (disablePreFX)'); };",
  // math 묶음(행렬 · 사원수 · 3D 벡터 · 보간 등)을 통째로 부르는 곳은 Config(RND를 만든다) · GetAdvancedValue(RND를 읽는다) 둘뿐이다.
  // 그 둘이 쓰는 칸만 둔다 — 다른 Phaser 모듈은 math 파일을 하나씩 부른다(Vector2 · 각도 · 이징 등은 그대로 들어간다)
  'math/index.js':
    "module.exports = { RandomDataGenerator: require('./random-data-generator/RandomDataGenerator'), RND: null };",
};

/** Phaser 소스의 빌드 깃발 `typeof X`(Phaser 자체 빌드의 DefinePlugin과 같은 값)와 `global.Phaser`를 바꾼다. define으로는 `typeof X` 꼴을 못 바꾼다 */
const phaserFlags: Plugin = {
  name: 'decoy-phaser-flags',
  apply: 'build',
  load(id) {
    const m = /\/node_modules\/phaser\/src\/(.+)$/.exec(id.split('?')[0] ?? '');
    return m ? (PHASER_STUBS[m[1] ?? ''] ?? null) : null;
  },
  transform(code, id) {
    if (!id.includes('/node_modules/phaser/src/')) return null;
    const out = code
      .replace(
        /typeof (WEBGL_RENDERER|CANVAS_RENDERER|FEATURE_SOUND|WEBGL_DEBUG|PLUGIN_CAMERA3D|PLUGIN_FBINSTANT|EXPERIMENTAL)\b/g,
        (_m, k: string) => String(PHASER_FLAGS[k]),
      )
      .replace(/\bglobal\.Phaser\b/g, 'globalThis.Phaser');
    return out === code ? null : { code: out, map: null };
  },
};

/**
 * 빌드 ID · 앱 셸 (M13d) · 미리 압축(번들 줄이기): 빌드마다 새 ID를 정해 화면 코드(`__DECOY_BUILD__`)와 `dist/build-id.json`(서버가 읽어
 * `x-decoy-build` 헤더 · welcome · pong에 싣는다)에 넣고, dist 전체 파일 목록(sw.js · wake.html · build-id.json 제외)을
 * 빌드 ID와 함께 `dist/sw.js`에 넣는다(앱 셸 사전 캐시). 새 파일(M14 manifest · 아이콘, M15 처리방침)은 저절로 들어간다.
 * DECOY_BUILD_ID 환경 변수로 ID를 정할 수 있다(시험). 개발 서버는 'dev'(서비스 워커를 등록하지 않는다)
 */
function decoyBuild(command: 'build' | 'serve'): Plugin {
  const fromEnv = process.env.DECOY_BUILD_ID;
  const id =
    command === 'build'
      ? fromEnv && /^[0-9a-z]{6,40}$/.test(fromEnv)
        ? fromEnv
        : randomBytes(6).toString('hex')
      : 'dev';
  let outDir = '';
  return {
    name: 'decoy-build-id',
    config: () => ({ define: { __DECOY_BUILD__: JSON.stringify(id) } }),
    configResolved(c) {
      outDir = c.build.outDir.startsWith('/') ? c.build.outDir : join(c.root, c.build.outDir);
    },
    closeBundle() {
      if (command !== 'build') return;
      const shell = listShellFiles(outDir);
      writeFileSync(join(outDir, 'build-id.json'), `${JSON.stringify({ id })}\n`);
      const swPath = join(outDir, 'sw.js');
      writeFileSync(swPath, swWithBuild(readFileSync(swPath, 'utf8'), id, shell));
      // 텍스트 자산마다 brotli · gzip 사본 (서버가 Accept-Encoding으로 고른다 — server/src/static.ts). 셸 목록 · sw.js를 쓴 뒤에
      precompressDist(outDir);
    },
  };
}

export default defineConfig(({ command }) => ({
  plugins: [phaserFlags, decoyBuild(command)],
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: './',
  // public/의 sw.js · wake.html은 이름을 바꾸지 않고 dist 맨 위에 복사한다 (서비스 워커 범위가 사이트 전체가 되도록)
  publicDir: 'public',
  resolve:
    command === 'build'
      ? {
          alias: [
            { find: /^phaser$/, replacement: fileURLToPath(new URL('./src/phaserCore.js', import.meta.url)) },
            // WEBGL_DEBUG 분기의 디버그 도구 (깃발이 false라 실행되지 않지만 번들러가 경로를 찾는다)
            {
              find: /^phaser3spectorjs$/,
              replacement: fileURLToPath(new URL('./src/empty.js', import.meta.url)),
            },
          ],
        }
      : {},
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000,
    // 첫 묶음은 한 조각 (메타 c): 나눠 받는 조각(결과 · '내 기록' · 옷장 · 의상 그림)이 첫 묶음 모듈을 함께 쓰면 번들러가 첫 묶음을
    // 공용 조각 넷으로 쪼갰다 — 어차피 첫 화면에 모두 받는 코드라 나눌 이득이 없고 조각마다 gzip 사전이 끊겨 약 3.8KiB 컸다.
    // 처음부터 불러오는 모듈($initial)을 한 묶음으로 모으면 진입 조각에 들어간다 (DECISIONS 14절 c '번들 예산')
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [{ name: 'boot', tags: ['$initial'] }],
        },
      },
    },
  },
  server: {
    port: 5173,
    host: true,
    fs: { allow: [repoRoot] },
    proxy: {
      '/ws': { target: `ws://localhost:${serverPort}`, ws: true },
    },
  },
}));

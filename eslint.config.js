// ESLint 설정 (flat config). TypeScript strict 규칙과 any 금지를 강제한다.
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      'artifacts/**',
      'test-results/**',
      'playwright-report/**',
      'tests/e2e/.results/**',
      // 병렬 작업자의 git worktree (커밋하지 않음)
      '.claude/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      eqeqeq: ['error', 'always'],
      'no-console': 'off',
    },
  },
  {
    files: ['client/**/*.ts', 'tests/e2e/**/*.ts'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
  {
    // 그림 · 연출은 결정적이어야 한다 (스크린샷 · 픽셀 검사 · 전후 비교가 흔들리지 않게): 시드 고정 난수와 gfxNow만
    files: ['client/src/art/**/*.ts', 'client/src/render/**/*.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message: '그림 · 연출에는 시드 고정 난수(@decoy/shared Rng · art/noise)를 쓴다',
        },
        {
          object: 'Date',
          property: 'now',
          message: '장식 시계는 gfxNow(), 연출 시간은 FrameView.nowMs를 쓴다',
        },
      ],
    },
  },
  {
    // 빌드 없이 그대로 복사되는 서비스 워커 (client/public/sw.js)
    files: ['client/public/**/*.js'],
    languageOptions: { sourceType: 'script', globals: { ...globals.serviceworker } },
  },
  {
    // server에는 Phaser를 들이지 않는다 (시뮬레이션과 렌더링 분리)
    files: ['server/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { paths: [{ name: 'phaser', message: 'shared/server에서 Phaser 금지' }] },
      ],
    },
  },
  {
    // shared는 서버와 브라우저(기기 안 연습)가 같이 돌린다 (M13a): Phaser도, Node 전용 모듈도 들이지 않는다.
    // 소켓 · 파일 · 타이머 같은 바깥 일은 server/src가 맡는다
    files: ['shared/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'phaser', message: 'shared/server에서 Phaser 금지' },
            { name: 'ws', message: 'shared에서 ws 금지 (소켓은 server/src)' },
            { name: 'fs', message: 'shared에서 fs 금지 (파일은 server/src)' },
          ],
          patterns: [
            {
              group: ['node:*'],
              message:
                'shared에서 Node 전용 모듈 금지 (브라우저에서도 돈다, globalThis.crypto 등 공통 API만)',
            },
          ],
        },
      ],
    },
  },
);

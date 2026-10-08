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
    // 빌드 없이 그대로 복사되는 서비스 워커 (client/public/sw.js)
    files: ['client/public/**/*.js'],
    languageOptions: { sourceType: 'script', globals: { ...globals.serviceworker } },
  },
  {
    // shared · server에는 Phaser를 들이지 않는다 (시뮬레이션과 렌더링 분리)
    files: ['shared/**/*.ts', 'server/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { paths: [{ name: 'phaser', message: 'shared/server에서 Phaser 금지' }] },
      ],
    },
  },
);

import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/** Build artefacts, generated code and tool output are never linted. */
export const baseIgnores = [
  '**/node_modules/**',
  '**/.next/**',
  '**/dist/**',
  '**/build/**',
  '**/coverage/**',
  '**/test-results/**',
  '**/playwright-report/**',
  '**/blob-report/**',
  '**/.turbo/**',
  '**/.pgdata/**',
  '**/*.d.ts',
  '**/next-env.d.ts',
  '**/prisma/generated/**',
  'packages/db/prisma/migrations/**',
];

/**
 * Shared flat ESLint config. Apps import it from `@curenear/config/eslint`:
 *
 *   import { createEslintConfig } from '@curenear/config/eslint';
 *   export default createEslintConfig({ react: true });
 */
export function createEslintConfig({ react = false, extraIgnores = [] } = {}) {
  const config = [
    { ignores: [...baseIgnores, ...extraIgnores] },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
      files: ['**/*.{js,mjs,cjs}'],
      languageOptions: {
        globals: { ...globals.node, ...globals.browser },
      },
    },
    {
      files: ['**/*.{ts,tsx,mts,cts}'],
      languageOptions: {
        globals: { ...globals.node },
      },
      rules: {
        '@typescript-eslint/no-unused-vars': [
          'error',
          { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
        ],
        '@typescript-eslint/no-explicit-any': 'warn',
        'no-console': ['warn', { allow: ['warn', 'error'] }],
        eqeqeq: ['error', 'smart'],
        'prefer-const': 'error',
      },
    },
  ];

  if (react) {
    config.push({
      files: ['**/*.{tsx,jsx}'],
      plugins: { 'react-hooks': reactHooks },
      rules: {
        'react-hooks/rules-of-hooks': 'error',
        'react-hooks/exhaustive-deps': 'warn',
      },
    });
  }

  // Must stay last: turns off stylistic rules that Prettier owns.
  config.push(prettier);
  return config;
}

export default createEslintConfig;

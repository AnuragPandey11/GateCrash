/**
 * Shared ESLint flat config.
 *
 * The one rule here that is architecture and not style: `no-restricted-globals: fetch`
 * outside `packages/api` (FRONTEND.md §3). Nothing in `apps/*` may talk to the backend
 * directly; if it did, correlation ids, the auth header and the single-flight refresh
 * would all be silently bypassed.
 */
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

const NO_DIRECT_FETCH = {
  name: 'gatecrash/no-direct-fetch',
  rules: {
    'no-restricted-globals': [
      'error',
      {
        name: 'fetch',
        message:
          'Use the client from @gatecrash/api. Direct fetch bypasses auth, correlation ids and refresh (FRONTEND.md §3).',
      },
      {
        name: 'XMLHttpRequest',
        message: 'Use the client from @gatecrash/api (FRONTEND.md §3).',
      },
    ],
  },
};

/**
 * @param {{ restrictFetch?: boolean, react?: boolean }} [opts]
 * @returns {import('eslint').Linter.Config[]}
 */
export function gatecrashConfig(opts = {}) {
  const { restrictFetch = true, react = false } = opts;
  return [
    { ignores: ['dist/**', 'coverage/**', 'src/generated/**', 'node_modules/**'] },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
      languageOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
      rules: {
        '@typescript-eslint/consistent-type-imports': [
          'error',
          { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
        ],
        '@typescript-eslint/no-unused-vars': [
          'error',
          { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
        ],
        'no-console': ['warn', { allow: ['warn', 'error'] }],
        eqeqeq: ['error', 'smart'],
      },
    },
    ...(restrictFetch ? [NO_DIRECT_FETCH] : []),
    ...(react
      ? [
          {
            name: 'gatecrash/react',
            plugins: { 'react-hooks': reactHooks },
            rules: {
              ...reactHooks.configs.recommended.rules,
            },
          },
        ]
      : []),
  ];
}

export default gatecrashConfig;

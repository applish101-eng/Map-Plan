import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import globals from 'globals'

/**
 * Flat ESLint config.
 *
 * Three rules are non-default and all three are load-bearing for this codebase
 * rather than stylistic:
 *
 *  - no-restricted-imports on the public OSM tile host. Spec 9.3 forbids it in
 *    production; a hard lint failure is the only reliable way to stop one
 *    creeping into a style JSON or a MapLibre source unnoticed.
 *  - no-restricted-syntax on interpolated SQL. Spec 16.2 permits parameterised
 *    SQL only, and a template literal with `${}` inside a query is how
 *    injection arrives.
 *  - eqeqeq. Loose equality has produced coordinate and id comparison bugs.
 */
export default [
  {
    // Non-source files: excluded from linting entirely. JSON and JSONC are data,
    // not code, and running JS rules over them reports an object literal as an
    // "unused expression", which is noise that trains people to ignore the linter.
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '**/*.json',
      '**/*.jsonc',
      'infra/tiles/**',
      'data/raw/**',
      'data/processed/**',
      'pnpm-lock.yaml',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      eqeqeq: ['error', 'always'],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
    },
  },

  {
    // Local-first guard (spec 3, 9.3). Any reference to the public OSM tile
    // server is an error, at every layer of the project.
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'tile.openstreetmap.org',
              message:
                'The public OSM tile server must not be used. Serve basemap tiles from local PMTiles (spec 9.3).',
            },
          ],
          patterns: [
            {
              group: ['**/tile.openstreetmap.org/**', '**/*.openstreetmap.org*'],
              message:
                'The public OSM tile server must not be used. Serve basemap tiles from local PMTiles (spec 9.3).',
            },
          ],
        },
      ],
    },
  },

  {
    // SQL injection guard (spec 16.2): parameterised statements only.
    files: ['**/*.ts', '**/*.mjs'],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'CallExpression[callee.name=/^(query|queryOne|execute)$/] > TemplateLiteral',
          message:
            'Do not interpolate values into SQL. Use $1, $2 placeholders and pass a params array (spec 16.2).',
        },
      ],
    },
  },

  {
    // Node-side tooling and scripts.
    files: ['**/*.mjs', '**/*.cjs', '**/*.config.js'],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      'no-console': 'off',
    },
  },
]
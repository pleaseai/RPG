import antfu from '@antfu/eslint-config'
import pluginImportX from 'eslint-plugin-import-x'

export default antfu({
  typescript: true,
  stylistic: {
    indent: 2,
    quotes: 'single',
    semi: false,
  },
  ignores: [
    'dist/**',
    'node_modules/**',
    'vendor/**',
    'tests/fixtures/**',
    'docs/**',
    '.please/**',
    '**/*.md',
    '**/*.json',
  ],
  plugins: {
    'import-x': pluginImportX,
  },
  rules: {
    'import-x/no-cycle': 'error',
    'no-console': 'off',
    'ts/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    // Bun globals
    'node/prefer-global/process': 'off',
    'node/prefer-global/buffer': 'off',
    // Allow require for native modules (tree-sitter)
    'ts/no-require-imports': 'off',
    // Regex backtracking (false positive for simple patterns)
    'regexp/no-super-linear-backtracking': 'warn',
    // Allow TypeScript const/type with same name pattern
    'ts/no-redeclare': 'off',
  },
})

import { defineWorkspace } from 'vitest/config'

export default defineWorkspace([
  {
    test: {
      name: 'unit',
      globals: true,
      environment: 'node',
      include: ['tests/**/*.test.ts'],
      exclude: ['tests/fixtures/**', 'tests/**/*.integration.test.ts', 'tests/**/*.ladybug.test.ts'],
      testTimeout: 10000,
    },
    resolve: {
      alias: {
        '@': './src',
      },
    },
  },
  {
    test: {
      name: 'ladybug',
      globals: true,
      environment: 'node',
      include: ['tests/**/*.ladybug.test.ts'],
      exclude: ['tests/fixtures/**'],
      testTimeout: 10000,
      isolate: false,
    },
    resolve: {
      alias: {
        '@': './src',
      },
    },
  },
  {
    test: {
      name: 'integration',
      globals: true,
      environment: 'node',
      include: ['tests/**/*.integration.test.ts'],
      exclude: ['tests/fixtures/**'],
      testTimeout: 30000,
    },
    resolve: {
      alias: {
        '@': './src',
      },
    },
  },
])

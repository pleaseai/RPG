import { defineWorkspace } from 'vitest/config'

export default defineWorkspace([
  {
    test: {
      name: 'unit',
      globals: true,
      environment: 'node',
      include: ['tests/**/*.test.ts'],
      exclude: ['tests/fixtures/**', 'tests/**/*.integration.test.ts'],
      testTimeout: 15000,
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
  },
])

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/fixtures/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/cli.ts'],
    },
    testTimeout: 10000,
    server: {
      deps: {
        external: [/^bun:/],
      },
    },
  },
  resolve: {
    alias: {
      '@': './src',
    },
  },
})

import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // `import 'server-only'` throws outside a React Server Component context, so
    // the modules under test get a no-op stub. The tests here exercise pure
    // logic; the import guard is a build-time concern, not a runtime one.
    alias: {
      'server-only': path.resolve(__dirname, 'src/lib/__tests__/stubs/server-only.ts'),
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
})

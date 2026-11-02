import { defineConfig } from 'vitest/config'

// Separate from vite.config.ts, whose `serve` branch points at the examples.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // The inspector records in development only (as TanStack's event client does).
    env: { NODE_ENV: 'development' },
  },
})

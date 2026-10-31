import { defineConfig } from 'vitest/config'

// Separate from vite.config.ts, whose `serve` branch points at the demo app.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
  },
})

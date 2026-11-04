import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // PGlite 首次加载 wasm 较慢
    testTimeout: 20_000,
  },
})

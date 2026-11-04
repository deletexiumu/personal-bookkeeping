import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // PGlite 首次加载 wasm 较慢
    testTimeout: 20_000,
    // 连真实 PostgreSQL（TEST_DATABASE_URL）时各测试文件共用一个库：
    // 并行会同时执行迁移、互相清空数据，所以按文件依次运行。PGlite 每个文件一个内存库，可以并行。
    fileParallelism: !process.env.TEST_DATABASE_URL,
  },
})

import { defineConfig } from 'drizzle-kit'

// 只用来根据 schema 生成迁移 SQL（pnpm db:generate），不连数据库
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
})

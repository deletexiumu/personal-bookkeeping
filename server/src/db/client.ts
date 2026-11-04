import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite'
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator'
import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js'
import { migrate as migratePostgres } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import * as schema from './schema.ts'

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>

export interface Database {
  db: Db
  /** 'postgres'：外部 PostgreSQL；'pglite'：内嵌数据库（数据目录或内存） */
  kind: 'postgres' | 'pglite'
  close(): Promise<void>
}

/** 迁移 SQL 位于包根目录的 drizzle/（源码和编译产物都在两层之下） */
const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url))

/**
 * 打开数据库并执行迁移。
 * - 传入 databaseUrl：连接 PostgreSQL
 * - 否则用 PGlite：dataDir 为数据目录；dataDir 为 'memory://' 时只在内存里（测试用）
 */
export async function openDatabase(opts: { databaseUrl?: string; dataDir: string }): Promise<Database> {
  if (opts.databaseUrl) {
    const client = postgres(opts.databaseUrl, { max: 10, onnotice: () => {} })
    const db = drizzlePostgres(client, { schema })
    await migratePostgres(db, { migrationsFolder })
    return { db: db as unknown as Db, kind: 'postgres', close: () => client.end() }
  }
  if (!opts.dataDir.startsWith('memory://')) mkdirSync(opts.dataDir, { recursive: true })
  const client = new PGlite(opts.dataDir)
  const db = drizzlePglite(client, { schema })
  await migratePglite(db, { migrationsFolder })
  return { db: db as unknown as Db, kind: 'pglite', close: () => client.close() }
}

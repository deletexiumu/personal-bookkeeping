import { sql } from 'drizzle-orm'
import { createApp } from '../src/app.ts'
import { loadConfig, type Config } from '../src/config.ts'
import { openDatabase, type Database } from '../src/db/client.ts'

export interface TestServer {
  database: Database
  config: Config
  request: (path: string, init?: { method?: string; json?: unknown; cookie?: string; token?: string; headers?: Record<string, string> }) => Promise<Response>
  clock: { now: Date }
}

// 默认用内存里的 PGlite；设置 TEST_DATABASE_URL 时改用真实的 PostgreSQL。
// 同一测试文件共用一个数据库（PGlite 每次启动要一两秒），每次 startTestServer 前清空。
const databaseUrl = process.env.TEST_DATABASE_URL ?? ''
let shared: Promise<Database> | undefined

export async function startTestServer(env: Record<string, string> = {}): Promise<TestServer> {
  const config = loadConfig({ DATA_DIR: 'memory://', DATABASE_URL: databaseUrl, COOKIE_SECURE: 'true', ...env })
  shared ??= openDatabase(config)
  const database = await shared
  await database.db.execute(sql`truncate users, sessions, invites, sync_records cascade`)
  const clock = { now: new Date('2026-11-04T10:00:00Z') }
  const app = createApp({ db: database.db, config, now: () => clock.now })
  let ip = 0
  return {
    database,
    config,
    clock,
    request: async (path, init = {}) => {
      const headers: Record<string, string> = { 'x-real-ip': `10.0.0.${++ip % 250}`, ...init.headers }
      if (init.json !== undefined) headers['content-type'] = 'application/json'
      if (init.cookie) headers.cookie = init.cookie
      if (init.token) headers.authorization = `Bearer ${init.token}`
      return app.request(path, {
        method: init.method ?? (init.json !== undefined ? 'POST' : 'GET'),
        headers,
        body: init.json !== undefined ? JSON.stringify(init.json) : undefined,
      })
    },
  }
}

/** 从 Set-Cookie 里取出会话 Cookie，作为下次请求的 Cookie 头 */
export function sessionCookie(res: Response): string {
  const header = res.headers.getSetCookie().find((c) => c.startsWith('tzb_session='))
  if (!header) throw new Error('响应里没有会话 Cookie')
  return header.split(';')[0]
}

/** 测试里直接读响应 JSON 的字段 */
// oxlint-disable-next-line no-explicit-any
export type Json = any

import { and, asc, count, eq, gt, inArray, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { requireAuth, type AuthDeps, type AuthEnv } from '../auth/routes.ts'
import { syncRecords, users } from '../db/schema.ts'
import { ApiError, readJson } from '../http.ts'

/** 客户端会同步的表（与 src/db/sync.ts 的 SYNC_TABLES 一致） */
export const SYNC_TABLES = [
  'accounts',
  'categories',
  'importBatches',
  'transactions',
  'budgets',
  'rules',
  'importTemplates',
  'tags',
  'tagRules',
  'plans',
] as const

/** 一次推送最多多少条改动 */
export const MAX_PUSH = 500
/** 一次拉取最多多少条改动 */
export const MAX_PULL = 1000
/** 单条记录的 JSON 上限 */
const MAX_RECORD_BYTES = 64 * 1024

const change = z.object({
  table: z.enum(SYNC_TABLES, { error: '不支持的表' }),
  uid: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[\w-]+$/, 'uid 格式不正确'),
  /** 客户端修改时间（毫秒），冲突时大的为准 */
  modifiedAt: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  /** 一行数据（外键已换成 uid）；null 表示已删除 */
  data: z.record(z.string(), z.unknown()).nullable(),
})
export type SyncChange = z.infer<typeof change>

const pushBody = z.object({ changes: z.array(change).max(MAX_PUSH, `一次最多推送 ${MAX_PUSH} 条`) })
const pullQuery = z.object({
  since: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(MAX_PULL).default(MAX_PULL),
})

type RecordRow = typeof syncRecords.$inferSelect

function recordView(r: Pick<RecordRow, 'table' | 'uid' | 'data' | 'modifiedAt' | 'rev'>) {
  return { table: r.table, uid: r.uid, modifiedAt: r.modifiedAt, data: r.data ?? null, rev: r.rev }
}

/**
 * 云同步：
 * - POST /sync/push 上传本机改动，按 modifiedAt 后写为准；没被采纳的（云端更新）在 conflicts 里返回云端版本
 * - GET /sync/pull?since=rev 增量拉取 rev 之后的改动，按 rev 升序，more 为 true 时用 cursor 接着拉
 * - GET /sync/status 云端各表的记录数
 */
export function syncRoutes(deps: AuthDeps) {
  const { db, config } = deps
  const now = deps.now ?? (() => new Date())
  const app = new Hono<AuthEnv>()
  app.use(requireAuth(deps))

  app.post('/push', async (c) => {
    const { changes } = await readJson(c, pushBody)
    const userId = c.get('session').userId
    // 同一条在一次推送里出现多次时只留最新的
    const latest = new Map<string, SyncChange>()
    for (const ch of changes) {
      const key = `${ch.table}\u0000${ch.uid}`
      const prev = latest.get(key)
      if (!prev || ch.modifiedAt >= prev.modifiedAt) latest.set(key, ch)
    }
    const list = [...latest.values()]
    for (const ch of list) {
      if (ch.data && JSON.stringify(ch.data).length > MAX_RECORD_BYTES) {
        throw new ApiError(413, 'record_too_large', '有一条记录内容太大', { table: ch.table, uid: ch.uid })
      }
    }
    if (list.length === 0) return c.json({ accepted: 0, conflicts: [] })

    const result = await db.transaction(async (tx) => {
      // 同一账号的推送排队执行，保证 rev 按提交顺序递增，拉取时不会跳过还没提交的改动
      await tx.execute(sql`select 1 from ${users} where ${users.id} = ${userId} for update`)
      const [{ total }] = await tx.select({ total: count() }).from(syncRecords).where(eq(syncRecords.userId, userId))
      if (total + list.length > config.syncMaxRecords) {
        const existing = await tx
          .select({ table: syncRecords.table, uid: syncRecords.uid })
          .from(syncRecords)
          .where(and(eq(syncRecords.userId, userId), inArray(syncRecords.uid, list.map((ch) => ch.uid))))
        const known = new Set(existing.map((r) => `${r.table}\u0000${r.uid}`))
        const added = list.filter((ch) => !known.has(`${ch.table}\u0000${ch.uid}`)).length
        if (total + added > config.syncMaxRecords) {
          throw new ApiError(413, 'quota_exceeded', `云端最多保存 ${config.syncMaxRecords} 条记录，已经存满了`)
        }
      }
      const at = now()
      const written = await tx
        .insert(syncRecords)
        .values(
          list.map((ch) => ({
            userId,
            table: ch.table,
            uid: ch.uid,
            data: ch.data,
            modifiedAt: ch.modifiedAt,
            rev: sql`nextval('sync_rev')`,
            updatedAt: at,
          })),
        )
        .onConflictDoUpdate({
          target: [syncRecords.userId, syncRecords.table, syncRecords.uid],
          set: {
            data: sql`excluded.data`,
            modifiedAt: sql`excluded.modified_at`,
            rev: sql`excluded.rev`,
            updatedAt: sql`excluded.updated_at`,
          },
          // 后写为准：云端的修改时间更晚（或相同）时保留云端
          setWhere: sql`${syncRecords.modifiedAt} < excluded.modified_at`,
        })
        .returning({ table: syncRecords.table, uid: syncRecords.uid })
      const accepted = new Set(written.map((r) => `${r.table}\u0000${r.uid}`))
      const rejected = list.filter((ch) => !accepted.has(`${ch.table}\u0000${ch.uid}`))
      const conflicts = rejected.length
        ? (
            await tx
              .select()
              .from(syncRecords)
              .where(and(eq(syncRecords.userId, userId), inArray(syncRecords.uid, rejected.map((ch) => ch.uid))))
          ).filter((r) => rejected.some((ch) => ch.table === r.table && ch.uid === r.uid))
        : []
      return { accepted: written.length, conflicts: conflicts.map(recordView) }
    })
    return c.json(result)
  })

  app.get('/pull', async (c) => {
    const parsed = pullQuery.safeParse(c.req.query())
    if (!parsed.success) throw new ApiError(400, 'invalid_input', '请求参数不正确')
    const { since, limit } = parsed.data
    const rows = await db
      .select()
      .from(syncRecords)
      .where(and(eq(syncRecords.userId, c.get('session').userId), gt(syncRecords.rev, since)))
      .orderBy(asc(syncRecords.rev))
      .limit(limit + 1)
    const page = rows.slice(0, limit)
    return c.json({
      changes: page.map(recordView),
      cursor: page.at(-1)?.rev ?? since,
      more: rows.length > limit,
    })
  })

  app.get('/status', async (c) => {
    const rows = await db
      .select({
        table: syncRecords.table,
        records: count(),
        deleted: sql<number>`count(*) filter (where ${syncRecords.data} is null)`.mapWith(Number),
      })
      .from(syncRecords)
      .where(eq(syncRecords.userId, c.get('session').userId))
      .groupBy(syncRecords.table)
    const tables = Object.fromEntries(rows.map((r) => [r.table, { records: r.records - r.deleted, deleted: r.deleted }]))
    return c.json({ tables, limit: config.syncMaxRecords })
  })

  return app
}

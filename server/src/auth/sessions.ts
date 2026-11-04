import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { and, desc, eq, gt, lt, ne } from 'drizzle-orm'
import type { Db } from '../db/client.ts'
import { sessions, users } from '../db/schema.ts'

/** 令牌前缀，便于在日志、密钥扫描里认出来 */
const TOKEN_PREFIX = 'tzb_'
/** 会话「最后使用时间」最多每小时写一次，避免每个请求都写库 */
const TOUCH_INTERVAL_MS = 60 * 60 * 1000

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export interface SessionUser {
  sessionId: string
  userId: string
  email: string
  emailVerified: boolean
}

export async function createSession(
  db: Db,
  input: { userId: string; ttlMs: number; userAgent?: string; ip?: string; now?: Date },
): Promise<{ id: string; token: string; expiresAt: Date }> {
  const now = input.now ?? new Date()
  const token = TOKEN_PREFIX + randomBytes(32).toString('base64url')
  const id = randomUUID()
  const expiresAt = new Date(now.getTime() + input.ttlMs)
  await db.insert(sessions).values({
    id,
    userId: input.userId,
    tokenHash: hashToken(token),
    userAgent: input.userAgent?.slice(0, 300),
    ip: input.ip,
    createdAt: now,
    lastUsedAt: now,
    expiresAt,
  })
  return { id, token, expiresAt }
}

/** 校验令牌；有效则顺带续期（滑动过期） */
export async function resolveSession(
  db: Db,
  token: string,
  opts: { ttlMs: number; now?: Date },
): Promise<SessionUser | null> {
  if (!token.startsWith(TOKEN_PREFIX)) return null
  const now = opts.now ?? new Date()
  const [row] = await db
    .select({
      sessionId: sessions.id,
      userId: users.id,
      email: users.email,
      emailVerifiedAt: users.emailVerifiedAt,
      lastUsedAt: sessions.lastUsedAt,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, now)))
    .limit(1)
  if (!row) return null
  if (now.getTime() - row.lastUsedAt.getTime() > TOUCH_INTERVAL_MS) {
    await db
      .update(sessions)
      .set({ lastUsedAt: now, expiresAt: new Date(now.getTime() + opts.ttlMs) })
      .where(eq(sessions.id, row.sessionId))
  }
  return { sessionId: row.sessionId, userId: row.userId, email: row.email, emailVerified: row.emailVerifiedAt !== null }
}

export async function listSessions(db: Db, userId: string, now = new Date()) {
  return db
    .select({
      id: sessions.id,
      userAgent: sessions.userAgent,
      ip: sessions.ip,
      createdAt: sessions.createdAt,
      lastUsedAt: sessions.lastUsedAt,
    })
    .from(sessions)
    .where(and(eq(sessions.userId, userId), gt(sessions.expiresAt, now)))
    .orderBy(desc(sessions.lastUsedAt))
}

/** 删除一个会话；只能删自己的。返回是否删到 */
export async function revokeSession(db: Db, userId: string, sessionId: string): Promise<boolean> {
  const rows = await db
    .delete(sessions)
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)))
    .returning({ id: sessions.id })
  return rows.length > 0
}

/** 删除该账号的其他会话（改密码后让其他设备下线）；不传 keep 则全部删除 */
export async function revokeOtherSessions(db: Db, userId: string, keep?: string): Promise<void> {
  await db
    .delete(sessions)
    .where(keep ? and(eq(sessions.userId, userId), ne(sessions.id, keep)) : eq(sessions.userId, userId))
}

/** 清理过期会话 */
export async function purgeExpiredSessions(db: Db, now = new Date()): Promise<number> {
  const rows = await db.delete(sessions).where(lt(sessions.expiresAt, now)).returning({ id: sessions.id })
  return rows.length
}

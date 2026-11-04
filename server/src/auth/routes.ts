import { and, eq, gt, isNull, or } from 'drizzle-orm'
import { Hono, type Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { createMiddleware } from 'hono/factory'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { Config } from '../config.ts'
import type { Db } from '../db/client.ts'
import { invites, users } from '../db/schema.ts'
import { ApiError, readJson, tooManyRequests } from '../http.ts'
import { dummyPasswordHash, hashPassword, verifyPassword } from './password.ts'
import { RateLimiter } from './rateLimit.ts'
import {
  createSession,
  listSessions,
  resolveSession,
  revokeOtherSessions,
  revokeSession,
  type SessionUser,
} from './sessions.ts'

export const SESSION_COOKIE = 'tzb_session'

export interface AuthEnv {
  Variables: {
    session: SessionUser
    /** 本次请求的令牌来自 Cookie 还是 Authorization 头 */
    via: 'cookie' | 'bearer'
  }
}

const email = z
  .string({ error: '请填写邮箱' })
  .trim()
  .toLowerCase()
  .max(254, '邮箱太长')
  .pipe(z.email({ error: '邮箱格式不正确' }))
const password = z.string({ error: '请填写密码' }).min(8, '密码至少 8 位').max(128, '密码最多 128 位')
/** cookie：Web 端，令牌写进 HttpOnly Cookie；bearer：桌面端、小程序，令牌放在响应里 */
const tokenMode = z.enum(['cookie', 'bearer']).default('cookie')

const registerBody = z.object({ email, password, inviteCode: z.string().trim().max(64).optional(), tokenMode })
const loginBody = z.object({ email, password: z.string({ error: '请填写密码' }).max(128), tokenMode })
const changePasswordBody = z.object({ currentPassword: z.string().max(128), newPassword: password })
const deleteAccountBody = z.object({ password: z.string().max(128) })

export interface AuthDeps {
  db: Db
  config: Config
  now?: () => Date
}

function userView(u: { id: string; email: string; emailVerifiedAt: Date | null; createdAt: Date }) {
  return { id: u.id, email: u.email, emailVerified: u.emailVerifiedAt !== null, createdAt: u.createdAt.toISOString() }
}

export function clientIp(c: Context, trustProxy: boolean): string | undefined {
  if (trustProxy) {
    const real = c.req.header('x-real-ip')?.trim()
    if (real) return real
    const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
    if (forwarded) return forwarded
  }
  const incoming = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming
  return incoming?.socket?.remoteAddress
}

/** 读取令牌并校验会话，失败返回 401 */
export function requireAuth(deps: AuthDeps) {
  const now = deps.now ?? (() => new Date())
  return createMiddleware<AuthEnv>(async (c, next) => {
    const header = c.req.header('authorization')
    const bearer = header?.match(/^Bearer\s+(\S+)$/i)?.[1]
    const token = bearer ?? getCookie(c, SESSION_COOKIE)
    const session = token ? await resolveSession(deps.db, token, { ttlMs: deps.config.sessionTtlMs, now: now() }) : null
    if (!session) {
      if (!bearer && token) clearSessionCookie(c, deps.config)
      throw new ApiError(401, 'unauthorized', '请先登录')
    }
    const via = bearer ? 'bearer' : 'cookie'
    // 用 Cookie 时，改动类请求必须是 JSON：浏览器不允许跨站表单发 JSON，配合 SameSite=Strict 防 CSRF
    if (via === 'cookie' && !['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
      const type = c.req.header('content-type') ?? ''
      if (!type.toLowerCase().startsWith('application/json')) {
        throw new ApiError(415, 'unsupported_media_type', '请求必须是 JSON')
      }
    }
    c.set('session', session)
    c.set('via', via)
    // 滑动过期：Cookie 的有效期跟着会话续上
    if (via === 'cookie') setSessionCookie(c, deps.config, token!)
    await next()
  })
}

function setSessionCookie(c: Context, config: Config, token: string) {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'Strict',
    path: '/api',
    maxAge: Math.floor(config.sessionTtlMs / 1000),
  })
}

function clearSessionCookie(c: Context, config: Config) {
  deleteCookie(c, SESSION_COOKIE, { path: '/api', secure: config.cookieSecure })
}

export function authRoutes(deps: AuthDeps) {
  const { db, config } = deps
  const now = deps.now ?? (() => new Date())
  const app = new Hono<AuthEnv>()
  const auth = requireAuth(deps)

  // 限频：登录按邮箱数失败次数、按 IP 数尝试次数；注册按 IP
  const loginFailuresByEmail = new RateLimiter(10, 15 * 60 * 1000)
  const loginAttemptsByIp = new RateLimiter(50, 15 * 60 * 1000)
  const registerByIp = new RateLimiter(10, 60 * 60 * 1000)
  const passwordFailuresByUser = new RateLimiter(10, 15 * 60 * 1000)

  async function issueSession(c: Context, userId: string, mode: 'cookie' | 'bearer') {
    const session = await createSession(db, {
      userId,
      ttlMs: config.sessionTtlMs,
      userAgent: c.req.header('user-agent'),
      ip: clientIp(c, config.trustProxy),
      now: now(),
    })
    if (mode === 'cookie') {
      setSessionCookie(c, config, session.token)
      return { expiresAt: session.expiresAt.toISOString() }
    }
    return { token: session.token, expiresAt: session.expiresAt.toISOString() }
  }

  /** 前端据此决定注册页是否显示、是否要填邀请码 */
  app.get('/config', (c) => c.json({ registration: config.registration }))

  app.post('/register', async (c) => {
    if (config.registration === 'closed') throw new ApiError(403, 'registration_closed', '暂不开放注册')
    const ip = clientIp(c, config.trustProxy) ?? 'unknown'
    const wait = registerByIp.hit(ip)
    if (wait) tooManyRequests(c, wait)
    const body = await readJson(c, registerBody)
    if (config.registration === 'invite' && !body.inviteCode) {
      throw new ApiError(400, 'invite_required', '需要邀请码才能注册', { field: 'inviteCode' })
    }
    const passwordHash = await hashPassword(body.password)
    const id = randomUUID()
    const at = now()
    const user = await db.transaction(async (tx) => {
      const [existing] = await tx.select({ id: users.id }).from(users).where(eq(users.email, body.email)).limit(1)
      if (existing) throw new ApiError(409, 'email_taken', '该邮箱已注册，请直接登录', { field: 'email' })
      const [created] = await tx
        .insert(users)
        .values({ id, email: body.email, passwordHash, createdAt: at, updatedAt: at })
        .onConflictDoNothing({ target: users.email })
        .returning()
      if (!created) throw new ApiError(409, 'email_taken', '该邮箱已注册，请直接登录', { field: 'email' })
      if (config.registration === 'invite') {
        const used = await tx
          .update(invites)
          .set({ usedBy: id, usedAt: at })
          .where(
            and(
              eq(invites.code, body.inviteCode!),
              isNull(invites.usedBy),
              isNull(invites.usedAt),
              or(isNull(invites.expiresAt), gt(invites.expiresAt, at)),
            ),
          )
          .returning({ code: invites.code })
        if (used.length === 0) throw new ApiError(400, 'invalid_invite', '邀请码无效或已被使用', { field: 'inviteCode' })
      }
      return created
    })
    const session = await issueSession(c, user.id, body.tokenMode)
    return c.json({ user: userView(user), ...session }, 201)
  })

  app.post('/login', async (c) => {
    const ip = clientIp(c, config.trustProxy) ?? 'unknown'
    const ipWait = loginAttemptsByIp.hit(ip)
    if (ipWait) tooManyRequests(c, ipWait)
    const body = await readJson(c, loginBody)
    const emailWait = loginFailuresByEmail.blocked(body.email)
    if (emailWait) tooManyRequests(c, emailWait)
    const [user] = await db.select().from(users).where(eq(users.email, body.email)).limit(1)
    const ok = await verifyPassword(body.password, user?.passwordHash ?? (await dummyPasswordHash()))
    if (!user || !ok) {
      loginFailuresByEmail.hit(body.email)
      throw new ApiError(401, 'invalid_credentials', '邮箱或密码不正确')
    }
    loginFailuresByEmail.reset(body.email)
    const session = await issueSession(c, user.id, body.tokenMode)
    return c.json({ user: userView(user), ...session })
  })

  app.post('/logout', auth, async (c) => {
    const { userId, sessionId } = c.get('session')
    await revokeSession(db, userId, sessionId)
    clearSessionCookie(c, config)
    return c.body(null, 204)
  })

  app.get('/me', auth, async (c) => {
    const [user] = await db.select().from(users).where(eq(users.id, c.get('session').userId)).limit(1)
    if (!user) throw new ApiError(401, 'unauthorized', '请先登录')
    return c.json({ user: userView(user) })
  })

  app.post('/password', auth, async (c) => {
    const { userId, sessionId } = c.get('session')
    const wait = passwordFailuresByUser.blocked(userId)
    if (wait) tooManyRequests(c, wait)
    const body = await readJson(c, changePasswordBody)
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1)
    if (!user || !(await verifyPassword(body.currentPassword, user.passwordHash))) {
      passwordFailuresByUser.hit(userId)
      throw new ApiError(400, 'wrong_password', '当前密码不正确', { field: 'currentPassword' })
    }
    await db
      .update(users)
      .set({ passwordHash: await hashPassword(body.newPassword), updatedAt: now() })
      .where(eq(users.id, userId))
    // 改密码后其他设备全部下线，当前设备保留
    await revokeOtherSessions(db, userId, sessionId)
    return c.body(null, 204)
  })

  app.get('/sessions', auth, async (c) => {
    const { userId, sessionId } = c.get('session')
    const rows = await listSessions(db, userId, now())
    return c.json({
      sessions: rows.map((s) => ({
        id: s.id,
        userAgent: s.userAgent,
        ip: s.ip,
        createdAt: s.createdAt.toISOString(),
        lastUsedAt: s.lastUsedAt.toISOString(),
        current: s.id === sessionId,
      })),
    })
  })

  app.delete('/sessions/:id', auth, async (c) => {
    const { userId, sessionId } = c.get('session')
    const id = c.req.param('id')
    if (!z.uuid().safeParse(id).success || !(await revokeSession(db, userId, id))) {
      throw new ApiError(404, 'not_found', '没有这个登录设备')
    }
    if (id === sessionId) clearSessionCookie(c, config)
    return c.body(null, 204)
  })

  /** 注销账号：删除账号和全部云端数据（外键级联），本机数据不受影响 */
  app.delete('/account', auth, async (c) => {
    const { userId } = c.get('session')
    const wait = passwordFailuresByUser.blocked(userId)
    if (wait) tooManyRequests(c, wait)
    const body = await readJson(c, deleteAccountBody)
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1)
    if (!user || !(await verifyPassword(body.password, user.passwordHash))) {
      passwordFailuresByUser.hit(userId)
      throw new ApiError(400, 'wrong_password', '密码不正确', { field: 'password' })
    }
    await db.delete(users).where(eq(users.id, userId))
    clearSessionCookie(c, config)
    return c.body(null, 204)
  })

  return app
}

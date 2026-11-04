import { sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { secureHeaders } from 'hono/secure-headers'
import { authRoutes, type AuthDeps } from './auth/routes.ts'
import { ApiError } from './http.ts'

/**
 * 所有接口都在 /api 下：线上由 nginx 把同域名的 /api/ 转给本服务，Web 端同源访问。
 */
export function createApp(deps: AuthDeps) {
  const app = new Hono().basePath('/api')

  app.use(secureHeaders())
  app.use(bodyLimit({ maxSize: 1024 * 1024, onError: (c) => c.json(errorBody('payload_too_large', '请求内容太大'), 413) }))
  // 接口响应都不缓存，避免会话相关内容进入 Service Worker 或代理缓存
  app.use(async (c, next) => {
    await next()
    c.header('Cache-Control', 'no-store')
  })

  app.get('/healthz', async (c) => {
    await deps.db.execute(sql`select 1`)
    return c.json({ status: 'ok' })
  })

  app.route('/auth', authRoutes(deps))

  app.notFound((c) => c.json(errorBody('not_found', '接口不存在'), 404))
  app.onError((err, c) => {
    if (err instanceof ApiError) return c.json(errorBody(err.code, err.message, err.extra), err.status)
    console.error(err)
    return c.json(errorBody('internal_error', '服务器出错了，请稍后再试'), 500)
  })

  return app
}

function errorBody(code: string, message: string, extra?: Record<string, unknown>) {
  return { error: { code, message, ...extra } }
}

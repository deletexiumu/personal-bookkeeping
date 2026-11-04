import type { Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { z } from 'zod'

/** 统一的错误响应：{ error: { code, message } }，message 直接给用户看 */
export class ApiError extends HTTPException {
  readonly code: string
  readonly extra?: Record<string, unknown>

  constructor(status: ContentfulStatusCode, code: string, message: string, extra?: Record<string, unknown>) {
    super(status, { message })
    this.code = code
    this.extra = extra
  }
}

/** 读取并校验 JSON 请求体；不是 JSON 一律拒绝（同时挡住表单式的跨站请求） */
export async function readJson<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  const type = c.req.header('content-type') ?? ''
  if (!type.toLowerCase().startsWith('application/json')) {
    throw new ApiError(415, 'unsupported_media_type', '请求必须是 JSON')
  }
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    throw new ApiError(400, 'invalid_json', '请求内容不是有效的 JSON')
  }
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    throw new ApiError(400, 'invalid_input', first?.message ?? '请求参数不正确', {
      field: first?.path.join('.'),
    })
  }
  return parsed.data
}

export function tooManyRequests(c: Context, retryAfter: number): never {
  c.header('Retry-After', String(retryAfter))
  throw new ApiError(429, 'rate_limited', `操作太频繁，请 ${Math.ceil(retryAfter / 60)} 分钟后再试`, { retryAfter })
}

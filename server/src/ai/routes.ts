import { eq } from 'drizzle-orm'
import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { requireAuth, type AuthDeps, type AuthEnv } from '../auth/routes.ts'
import { RateLimiter } from '../auth/rateLimit.ts'
import { aiSettings } from '../db/schema.ts'
import { ApiError, readJson, tooManyRequests } from '../http.ts'
import {
  ANTHROPIC_BLOCK_TYPES,
  checkSequence,
  DEFAULT_MODELS,
  LIMITS,
  TOOL_NAMES,
  type AiFormat,
  type ChatItem,
} from './core.ts'
import { decryptSecret, encryptSecret, keyHint, loadSecretKey } from './secret.ts'
import { callUpstream, checkUrl, type Upstream, type UpstreamFetch } from './upstream.ts'

export interface AiDeps extends AuthDeps {
  /** 测试时替换请求 AI 接口的函数 */
  aiFetch?: UpstreamFetch
}

const format = z.enum(['anthropic', 'openai'], { error: '接口格式只能是 anthropic 或 openai' })

const settingsBody = z
  .object({
    format,
    baseUrl: z.string().trim().max(500, '接入地址太长').default(''),
    model: z.string().trim().max(200, '模型名称太长').default(''),
    /** 不传表示保留已保存的 Key，空字符串表示清除 */
    apiKey: z.string().trim().max(1000, 'API Key 太长').optional(),
    proxyUrl: z.string().trim().max(500, '代理地址太长').default(''),
  })
  .refine((s) => s.format !== 'openai' || s.model !== '', { message: 'OpenAI 兼容接口需要填写模型名称', path: ['model'] })

const userItem = z.object({
  role: z.literal('user'),
  text: z.string().trim().min(1, '请输入问题').max(LIMITS.question, `问题最多 ${LIMITS.question} 字`),
  context: z.string().max(LIMITS.context, '附带的账本数据太多了，请缩短时间段').optional(),
})
const toolCall = z.object({
  id: z.string().min(1).max(200),
  name: z.enum(TOOL_NAMES, { error: '不支持的工具' }),
  args: z.record(z.string(), z.unknown()),
})
const assistantItem = z.object({
  role: z.literal('assistant'),
  text: z.string().max(LIMITS.assistantText),
  toolCalls: z.array(toolCall).max(LIMITS.toolCalls).optional(),
  raw: z
    .array(z.looseObject({ type: z.enum(ANTHROPIC_BLOCK_TYPES, { error: '不支持的内容块' }) }))
    .max(64)
    .optional(),
  stop: z.string().max(50).optional(),
})
const toolItem = z.object({
  role: z.literal('tool'),
  results: z
    .array(z.object({ id: z.string().min(1).max(200), content: z.string().max(LIMITS.toolResult, '查询结果太长') }))
    .min(1)
    .max(LIMITS.toolCalls),
})
const chatBody = z.object({
  items: z
    .array(z.discriminatedUnion('role', [userItem, assistantItem, toolItem]))
    .min(1, '对话是空的')
    .max(LIMITS.items, '这次对话太长了，请新开一个对话'),
})

/** 原样回传的 Anthropic 内容块：大小有限，里面的工具调用必须和 toolCalls 一致（不能夹带别的工具） */
function checkRaw(items: ChatItem[]) {
  for (const item of items) {
    if (item.role !== 'assistant' || !item.raw) continue
    if (JSON.stringify(item.raw).length > LIMITS.raw) throw new ApiError(400, 'invalid_conversation', '这次对话太长了，请新开一个对话')
    const rawIds = item.raw
      .filter((b) => (b as { type?: string }).type === 'tool_use')
      .map((b) => String((b as { id?: unknown }).id))
      .sort()
    const ids = (item.toolCalls ?? []).map((c) => c.id).sort()
    if (rawIds.join('\u0000') !== ids.join('\u0000')) throw new ApiError(400, 'invalid_conversation', '回答内容和工具调用对不上')
  }
}

/**
 * AI 助手（服务器转发）：
 * - GET /ai/config 当前接入点（不含 API Key 明文）与服务器默认接入点是否可用
 * - POST /ai/settings 保存自己的接入点；DELETE /ai/settings 删除，改用服务器默认
 * - POST /ai/test 用固定的问题测试接入点
 * - POST /ai/chat 转发一轮对话
 *
 * 防止被当成通用大模型中转：只有登录用户能用；系统提示词和工具在服务端固定，客户端只能提交结构化的问题、
 * 账本数据和工具结果，问题和数据都有长度上限，不能指定模型参数；每个账号按分钟和按天限次；
 * 服务器默认的 API Key 只发往服务器配置的地址，绝不会发往用户填写的地址。
 */
export function aiRoutes(deps: AiDeps) {
  const { db, config } = deps
  const now = deps.now ?? (() => new Date())
  const ai = config.ai
  const app = new Hono<AuthEnv>()
  app.use(requireAuth(deps))

  const perMinute = new RateLimiter(ai.ratePerMinute, 60 * 1000)
  const perDay = new RateLimiter(ai.dailyLimit, 24 * 60 * 60 * 1000)

  let secretKey: Buffer | undefined
  function secret(): Buffer {
    if (!secretKey) {
      try {
        secretKey = loadSecretKey({ secret: ai.secret, dataDir: config.dataDir })
      } catch (err) {
        console.error('读取 AI 密钥失败', err)
        throw new ApiError(500, 'ai_secret_unavailable', '服务器没法保存 API Key，请管理员配置 AI_SECRET')
      }
    }
    return secretKey
  }

  const serverDefault: Upstream | null = ai.apiKey
    ? {
        format: ai.format,
        baseUrl: ai.baseUrl,
        apiKey: ai.apiKey,
        model: ai.model || DEFAULT_MODELS[ai.format],
        proxyUrl: ai.proxy,
      }
    : null

  async function loadRow(userId: string) {
    const [row] = await db.select().from(aiSettings).where(eq(aiSettings.userId, userId)).limit(1)
    return row
  }

  /** 这个账号用哪个接入点：自己配了就用自己的（只用自己的 Key），否则用服务器默认 */
  async function resolveTarget(userId: string): Promise<Upstream> {
    const row = await loadRow(userId)
    if (row) {
      const apiKey = row.apiKey ? decryptSecret(secret(), row.apiKey) : ''
      if (apiKey === null) throw new ApiError(400, 'ai_key_unreadable', '保存的 API Key 读不出来了（服务器密钥变了），请在设置里重新填写')
      return {
        format: row.format as AiFormat,
        baseUrl: row.baseUrl,
        apiKey,
        model: row.model || DEFAULT_MODELS[row.format as AiFormat],
        proxyUrl: row.proxyUrl || ai.proxy,
      }
    }
    if (serverDefault) return serverDefault
    throw new ApiError(400, 'ai_not_configured', '还没有配置 AI 接入点，请先在设置里填写')
  }

  function limit(ctx: Context, userId: string) {
    const minute = perMinute.hit(userId)
    if (minute !== null) tooManyRequests(ctx, minute)
    const day = perDay.hit(userId)
    if (day !== null) {
      throw new ApiError(429, 'rate_limited', `今天的 AI 助手次数已用完（每天 ${ai.dailyLimit} 次），明天再来吧`, { retryAfter: day })
    }
  }
  app.get('/config', async (ctx) => {
    const row = await loadRow(ctx.get('session').userId)
    let settings = null
    if (row) {
      const key = row.apiKey ? decryptSecret(secret(), row.apiKey) : ''
      settings = {
        format: row.format,
        baseUrl: row.baseUrl,
        model: row.model,
        proxyUrl: row.proxyUrl ?? '',
        hasKey: !!row.apiKey,
        keyHint: key ? keyHint(key) : key === null ? '（读不出来，请重新填写）' : '',
      }
    }
    return ctx.json({
      server: { available: !!serverDefault, format: serverDefault?.format ?? null, model: serverDefault?.model ?? null },
      settings,
      limits: { question: LIMITS.question, perMinute: ai.ratePerMinute, perDay: ai.dailyLimit },
    })
  })

  async function parseSettings(body: z.infer<typeof settingsBody>, userId: string) {
    const baseUrl = checkUrl(body.baseUrl, 'baseUrl', ai.allowPrivate)
    const proxyUrl = checkUrl(body.proxyUrl, 'proxyUrl', ai.allowPrivate)
    let apiKey: string | null
    if (body.apiKey === undefined) {
      const row = await loadRow(userId)
      apiKey = row?.apiKey ?? null
    } else {
      apiKey = body.apiKey ? encryptSecret(secret(), body.apiKey) : null
    }
    return { format: body.format, baseUrl, model: body.model, apiKey, proxyUrl: proxyUrl || null }
  }

  app.post('/settings', async (ctx) => {
    const userId = ctx.get('session').userId
    const values = await parseSettings(await readJson(ctx, settingsBody), userId)
    await db
      .insert(aiSettings)
      .values({ userId, ...values, updatedAt: now() })
      .onConflictDoUpdate({ target: aiSettings.userId, set: { ...values, updatedAt: now() } })
    return ctx.json({ ok: true })
  })

  app.delete('/settings', async (ctx) => {
    await db.delete(aiSettings).where(eq(aiSettings.userId, ctx.get('session').userId))
    return ctx.body(null, 204)
  })

  app.post('/test', async (ctx) => {
    const userId = ctx.get('session').userId
    const body = await readJson(ctx, z.object({ settings: settingsBody.optional() }))
    let target: Upstream
    if (body.settings) {
      const values = await parseSettings(body.settings, userId)
      const apiKey = values.apiKey ? decryptSecret(secret(), values.apiKey) : ''
      target = {
        format: values.format,
        baseUrl: values.baseUrl,
        apiKey: apiKey ?? '',
        model: values.model || DEFAULT_MODELS[values.format],
        proxyUrl: values.proxyUrl || ai.proxy,
      }
    } else {
      target = await resolveTarget(userId)
    }
    limit(ctx, userId)
    const started = Date.now()
    const item = await callUpstream(target, [{ role: 'user', text: '用一句话介绍你能帮我做什么。' }], {
      timeoutMs: ai.timeoutMs,
      fetch: deps.aiFetch,
    })
    return ctx.json({ ok: true, model: target.model, ms: Date.now() - started, reply: item.text.slice(0, 200) })
  })

  app.post('/chat', async (ctx) => {
    const userId = ctx.get('session').userId
    const { items } = await readJson(ctx, chatBody)
    const problem = checkSequence(items)
    if (problem) throw new ApiError(400, 'invalid_conversation', problem)
    checkRaw(items)
    const target = await resolveTarget(userId)
    limit(ctx, userId)
    // OpenAI 兼容接口没有原始内容块，回传了也丢掉
    const forward = target.format === 'anthropic' ? items : items.map((i) => (i.role === 'assistant' ? { ...i, raw: undefined } : i))
    const item = await callUpstream(target, forward, { timeoutMs: ai.timeoutMs, fetch: deps.aiFetch })
    return ctx.json({ item, model: target.model })
  })

  return app
}

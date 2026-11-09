import { z } from 'zod'

/** 注册开关：open 任何人可注册，invite 需要邀请码，closed 关闭注册 */
export type RegistrationMode = 'open' | 'invite' | 'closed'

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1')

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  /** PostgreSQL 连接串；不填时使用内嵌的 PGlite，数据存在 DATA_DIR */
  DATABASE_URL: z.string().optional(),
  DATA_DIR: z.string().default('/data'),
  REGISTRATION: z.enum(['open', 'invite', 'closed']).default('open'),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  /** 会话 Cookie 是否带 Secure；本地用 http 调试时设为 false */
  COOKIE_SECURE: bool.default(true),
  /** 是否信任反向代理传来的 X-Real-IP / X-Forwarded-For，用于按 IP 限频 */
  TRUST_PROXY: bool.default(true),
  /**
   * 允许跨域访问的来源，逗号分隔。默认是桌面端（Tauri）的 WebView 来源；
   * Web 端与接口同源，不需要列在这里。跨域请求只能用 Bearer 令牌，不带 Cookie。
   */
  CORS_ORIGINS: z.string().default('tauri://localhost,http://tauri.localhost,https://tauri.localhost'),
  /** 每个账号在云端最多存多少条记录（流水、分类等合计，含删除记录），防止滥用 */
  SYNC_MAX_RECORDS: z.coerce.number().int().min(1000).default(200000),
  /** 服务器默认的 AI 接入点：配了 AI_API_KEY 后，没有自己配置接入点的用户也能用 AI 助手 */
  AI_FORMAT: z.enum(['anthropic', 'openai']).default('anthropic'),
  AI_BASE_URL: z.string().optional(),
  AI_API_KEY: z.string().optional(),
  AI_MODEL: z.string().optional(),
  /** 访问 AI 接口时走的代理，http://、https:// 或 socks5://，用户在设置里填的优先 */
  AI_PROXY: z.string().optional(),
  /** 加密保存用户 API Key 的密钥；不填时自动生成，存在 DATA_DIR/ai-secret.key */
  AI_SECRET: z.string().optional(),
  /** 是否允许接入地址、代理指向内网或本机地址（默认不允许，防止被用来探测内网） */
  AI_ALLOW_PRIVATE: bool.default(false),
  /** 每个账号每分钟、每天最多请求 AI 多少次（一个问题查数据时会请求多次） */
  AI_RATE_PER_MINUTE: z.coerce.number().int().min(1).default(20),
  AI_DAILY_LIMIT: z.coerce.number().int().min(1).default(300),
  /** 单次请求 AI 接口的超时秒数；默认比 nginx 默认的 proxy_read_timeout（60 秒）短，超时能给出可读的提示 */
  AI_TIMEOUT_SECONDS: z.coerce.number().int().min(5).max(600).default(55),
})

export interface Config {
  port: number
  databaseUrl?: string
  dataDir: string
  registration: RegistrationMode
  sessionTtlMs: number
  cookieSecure: boolean
  trustProxy: boolean
  corsOrigins: string[]
  syncMaxRecords: number
  ai: AiConfig
}

export interface AiConfig {
  format: 'anthropic' | 'openai'
  baseUrl: string
  apiKey?: string
  model: string
  proxy?: string
  secret?: string
  allowPrivate: boolean
  ratePerMinute: number
  dailyLimit: number
  timeoutMs: number
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = envSchema.safeParse(Object.fromEntries(Object.entries(env).filter(([, v]) => v !== '')))
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
    throw new Error(`环境变量不正确：${issues}`)
  }
  const e = parsed.data
  return {
    port: e.PORT,
    databaseUrl: e.DATABASE_URL,
    dataDir: e.DATA_DIR,
    registration: e.REGISTRATION,
    sessionTtlMs: e.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
    cookieSecure: e.COOKIE_SECURE,
    trustProxy: e.TRUST_PROXY,
    corsOrigins: e.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean),
    syncMaxRecords: e.SYNC_MAX_RECORDS,
    ai: {
      format: e.AI_FORMAT,
      baseUrl: e.AI_BASE_URL ?? '',
      apiKey: e.AI_API_KEY,
      model: e.AI_MODEL ?? '',
      proxy: e.AI_PROXY,
      secret: e.AI_SECRET,
      allowPrivate: e.AI_ALLOW_PRIVATE,
      ratePerMinute: e.AI_RATE_PER_MINUTE,
      dailyLimit: e.AI_DAILY_LIMIT,
      timeoutMs: e.AI_TIMEOUT_SECONDS * 1000,
    },
  }
}

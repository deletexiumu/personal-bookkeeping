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
  }
}

/**
 * 陶朱簿后端接口的最小客户端。不依赖 React，便于以后搬到 packages/ 给小程序复用。
 *
 * - baseUrl 为空：与页面同源，请求 /api/...，令牌在 HttpOnly Cookie 里（Web 端）
 * - baseUrl 为完整地址：跨域，令牌放在 Authorization 头里（桌面端、自填服务器）
 */

export interface ApiTarget {
  /** 服务器地址，如 https://example.com；空字符串表示与页面同源 */
  baseUrl: string
  /** Bearer 令牌；同源时不需要 */
  token?: string
}

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly field?: string

  constructor(status: number, code: string, message: string, field?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.field = field
  }
}

/** 规范化用户填写的服务器地址：去掉空白和结尾的斜杠，只接受 http(s) */
export function normalizeServerUrl(input: string): string {
  const value = input.trim().replace(/\/+$/, '')
  if (!value) return ''
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new ApiError(0, 'invalid_server', '服务器地址格式不正确，例如 https://example.com')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new ApiError(0, 'invalid_server', '服务器地址需要以 https:// 开头')
  }
  return value
}

export function tokenMode(target: ApiTarget): 'cookie' | 'bearer' {
  return target.baseUrl ? 'bearer' : 'cookie'
}

export async function apiRequest<T>(
  target: ApiTarget,
  path: string,
  init: { method?: 'GET' | 'POST' | 'DELETE'; body?: unknown } = {},
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' }
  if (init.body !== undefined) headers['content-type'] = 'application/json'
  if (target.baseUrl && target.token) headers.authorization = `Bearer ${target.token}`
  let res: Response
  try {
    res = await fetchImpl(`${target.baseUrl}/api${path}`, {
      method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      credentials: target.baseUrl ? 'omit' : 'same-origin',
      cache: 'no-store',
    })
  } catch {
    throw new ApiError(0, 'network', '连不上服务器，请检查网络或服务器地址')
  }
  if (res.status === 204) return undefined as T
  const isJson = (res.headers.get('content-type') ?? '').includes('application/json')
  // 静态托管（如 GitHub Pages）没有后端：/api 返回的是网页或 404
  if (!isJson) throw new ApiError(res.status, 'no_server', '这个地址没有陶朱簿云服务')
  const data = (await res.json()) as { error?: { code?: string; message?: string; field?: string } }
  if (!res.ok) {
    throw new ApiError(
      res.status,
      data.error?.code ?? 'unknown',
      data.error?.message ?? `请求失败（${res.status}）`,
      data.error?.field,
    )
  }
  return data as T
}

export interface AccountUser {
  id: string
  email: string
  emailVerified: boolean
  createdAt: string
}

export interface DeviceSession {
  id: string
  userAgent: string | null
  ip: string | null
  createdAt: string
  lastUsedAt: string
  current: boolean
}

export type RegistrationMode = 'open' | 'invite' | 'closed'

/** 把 User-Agent 粗略翻成「Chrome · macOS」这样的设备描述 */
export function describeDevice(userAgent: string | null): string {
  if (!userAgent) return '未知设备'
  const ua = userAgent
  const os = /iPhone|iPad/.test(ua)
    ? 'iOS'
    : /Android/.test(ua)
      ? 'Android'
      : /Mac OS X|Macintosh/.test(ua)
        ? 'macOS'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Linux/.test(ua)
            ? 'Linux'
            : ''
  const app = /Taozhubu|Tauri/i.test(ua)
    ? '陶朱簿桌面端'
    : /MicroMessenger/.test(ua)
      ? '微信'
      : /Edg\//.test(ua)
        ? 'Edge'
        : /Firefox\//.test(ua)
          ? 'Firefox'
          : /Chrome\//.test(ua)
            ? 'Chrome'
            : /Safari\//.test(ua)
              ? 'Safari'
              : ''
  return [app, os].filter(Boolean).join(' · ') || '未知设备'
}

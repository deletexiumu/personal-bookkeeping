import { isIP } from 'node:net'
import { fetch as undiciFetch, ProxyAgent, Socks5ProxyAgent, type Dispatcher } from 'undici'
import { ApiError } from '../http.ts'
import {
  AiResponseError,
  endpointUrl,
  parseResponse,
  requestBody,
  requestHeaders,
  upstreamErrorMessage,
  type AiFormat,
  type AssistantItem,
  type ChatItem,
} from './core.ts'

/** 一个可用的 AI 接入点（API Key 已解密） */
export interface Upstream {
  format: AiFormat
  baseUrl: string
  apiKey: string
  model: string
  proxyUrl?: string
}

export interface UpstreamResponse {
  ok: boolean
  status: number
  text(): Promise<string>
}

/** 发请求的函数，测试时替换成假的 */
export type UpstreamFetch = (
  url: string,
  init: { method: 'POST'; headers: Record<string, string>; body: string; signal: AbortSignal; dispatcher?: Dispatcher },
) => Promise<UpstreamResponse>

const defaultFetch: UpstreamFetch = (url, init) => undiciFetch(url, init)

const PROXY_PROTOCOLS = ['http:', 'https:', 'socks5:', 'socks:']

/** 内网、本机、链路本地地址（含云厂商的元数据地址 169.254.169.254） */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return true
  const kind = isIP(host)
  if (kind === 4) {
    const [a, b] = host.split('.').map(Number)
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    )
  }
  if (kind === 6) {
    if (host === '::' || host === '::1') return true
    if (host.startsWith('::ffff:')) return isPrivateHost(host.slice(7))
    return /^f[cd]/.test(host) || /^fe[89ab]/.test(host)
  }
  return false
}

/**
 * 校验并规范化接入地址或代理地址；不合格时抛出 400（field 指明是哪一项）。
 * 默认不允许指向内网和本机，防止服务器被用来探测内网（AI_ALLOW_PRIVATE=true 时放开）。
 */
export function checkUrl(value: string, kind: 'baseUrl' | 'proxyUrl', allowPrivate: boolean): string {
  const text = value.trim().replace(/\/+$/, '')
  if (!text) return ''
  const label = kind === 'baseUrl' ? '接入地址' : '代理地址'
  let url: URL
  try {
    url = new URL(text)
  } catch {
    throw new ApiError(400, 'invalid_input', `${label}格式不正确`, { field: kind })
  }
  const protocols = kind === 'baseUrl' ? ['http:', 'https:'] : PROXY_PROTOCOLS
  if (!protocols.includes(url.protocol)) {
    const hint = kind === 'baseUrl' ? '需要以 https:// 开头' : '只支持 http://、https:// 和 socks5://'
    throw new ApiError(400, 'invalid_input', `${label}${hint}`, { field: kind })
  }
  if (kind === 'baseUrl' && (url.username || url.password)) {
    throw new ApiError(400, 'invalid_input', '接入地址里不要带用户名和密码，API Key 单独填写', { field: kind })
  }
  if (!allowPrivate && isPrivateHost(url.hostname)) {
    throw new ApiError(400, 'invalid_input', `${label}不能是内网或本机地址`, { field: kind })
  }
  return text
}

const dispatchers = new Map<string, Dispatcher>()

function dispatcherFor(proxyUrl: string): Dispatcher {
  let d = dispatchers.get(proxyUrl)
  if (!d) {
    const protocol = new URL(proxyUrl).protocol
    d = protocol === 'socks5:' || protocol === 'socks:' ? new Socks5ProxyAgent(proxyUrl) : new ProxyAgent(proxyUrl)
    if (dispatchers.size >= 20) {
      const [oldest] = dispatchers.keys()
      void dispatchers.get(oldest)?.close()
      dispatchers.delete(oldest)
    }
    dispatchers.set(proxyUrl, d)
  }
  return d
}

function causeOf(err: unknown): string {
  const cause = (err as { cause?: { code?: string; message?: string } })?.cause
  return cause?.code ?? cause?.message ?? (err instanceof Error ? err.message : String(err))
}

/** 请求 AI 接口，返回统一格式的回答；网络、超时、接口错误都换成给用户看的 ApiError */
export async function callUpstream(
  target: Upstream,
  items: ChatItem[],
  opts: { timeoutMs: number; fetch?: UpstreamFetch },
): Promise<AssistantItem> {
  const url = endpointUrl(target.format, target.baseUrl)
  const host = new URL(url).host
  const via = target.proxyUrl ? '（经代理）' : ''
  let res: UpstreamResponse
  try {
    res = await (opts.fetch ?? defaultFetch)(url, {
      method: 'POST',
      headers: requestHeaders(target.format, target.apiKey, false),
      body: JSON.stringify(requestBody(target.format, items, target.model)),
      signal: AbortSignal.timeout(opts.timeoutMs),
      dispatcher: target.proxyUrl ? dispatcherFor(target.proxyUrl) : undefined,
    })
  } catch (err) {
    const name = (err as { name?: string })?.name
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new ApiError(504, 'ai_timeout', `AI 接口 ${host}${via} 超过 ${Math.round(opts.timeoutMs / 1000)} 秒没有响应`)
    }
    throw new ApiError(502, 'ai_unreachable', `连不上 AI 接口 ${host}${via}：${causeOf(err)}`)
  }
  let json: unknown
  const text = await res.text().catch(() => '')
  try {
    json = JSON.parse(text)
  } catch {
    json = undefined
  }
  if (!res.ok) {
    throw new ApiError(502, 'ai_upstream_error', upstreamErrorMessage(res.status, json, target.apiKey), {
      upstreamStatus: res.status,
    })
  }
  if (json === undefined) throw new ApiError(502, 'ai_bad_response', `AI 接口 ${host} 返回的不是 JSON，请检查接入地址`)
  try {
    return parseResponse(target.format, json)
  } catch (err) {
    if (err instanceof AiResponseError) throw new ApiError(502, 'ai_bad_response', `${err.message}，请检查接口格式`)
    throw err
  }
}

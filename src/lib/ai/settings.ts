import { useSyncExternalStore } from 'react'
import { DEFAULT_MODELS, type AiFormat } from '../../../server/src/ai/core.ts'

/**
 * AI 助手在这台设备上的设置（localStorage）：
 * - server：经陶朱簿服务器转发。需要登录，接入点、API Key 和代理保存在服务器上（Key 加密），浏览器拿不到 Key
 * - direct：浏览器直连 AI 接口。不需要登录，Key 只存在这台设备的浏览器里；接口要允许跨域，浏览器无法走 HTTP 代理
 */
export type AiMode = 'server' | 'direct'

export interface DirectConfig {
  format: AiFormat
  baseUrl: string
  model: string
  apiKey: string
}

export interface AiLocalSettings {
  mode: AiMode
  direct: DirectConfig
}

const KEY = 'taozhubu:ai'
const listeners = new Set<() => void>()
let cached: AiLocalSettings | undefined

const EMPTY_DIRECT: DirectConfig = { format: 'anthropic', baseUrl: '', model: '', apiKey: '' }

function read(): AiLocalSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<AiLocalSettings>
    const d = (raw.direct ?? {}) as Partial<DirectConfig>
    return {
      mode: raw.mode === 'direct' ? 'direct' : 'server',
      direct: {
        format: d.format === 'openai' ? 'openai' : 'anthropic',
        baseUrl: typeof d.baseUrl === 'string' ? d.baseUrl : '',
        model: typeof d.model === 'string' ? d.model : '',
        apiKey: typeof d.apiKey === 'string' ? d.apiKey : '',
      },
    }
  } catch {
    return { mode: 'server', direct: EMPTY_DIRECT }
  }
}

export function getAiSettings(): AiLocalSettings {
  cached ??= read()
  return cached
}

export function setAiSettings(patch: Partial<AiLocalSettings>) {
  cached = { ...getAiSettings(), ...patch }
  try {
    localStorage.setItem(KEY, JSON.stringify(cached))
  } catch {
    // 写不进去时只在本次会话有效
  }
  for (const l of listeners) l()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEY) return
    cached = read()
    listener()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

export function useAiSettings(): AiLocalSettings {
  return useSyncExternalStore(subscribe, getAiSettings, getAiSettings)
}

/** 测试用 */
export function resetAiSettingsCache() {
  cached = undefined
}

/** 直连配置是否能用；不能用时返回原因 */
export function directProblem(d: DirectConfig): string | null {
  if (d.format === 'openai' && !d.model.trim()) return '还没有填写模型名称'
  if (!d.apiKey.trim() && !d.baseUrl.trim()) return '还没有填写 API Key'
  return null
}

export function directModel(d: DirectConfig): string {
  return d.model.trim() || DEFAULT_MODELS[d.format]
}

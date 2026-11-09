import type { AiFormat, AssistantItem, ChatItem } from '../../server/src/ai/core.ts'
import { call } from './account'

/** 服务器上的 AI 接入点（GET /api/ai/config），不含 API Key 明文 */
export interface AiServerConfig {
  server: { available: boolean; format: AiFormat | null; model: string | null }
  settings: {
    format: AiFormat
    baseUrl: string
    model: string
    proxyUrl: string
    hasKey: boolean
    keyHint: string
  } | null
  limits: { question: number; perMinute: number; perDay: number }
}

export interface AiSettingsInput {
  format: AiFormat
  baseUrl: string
  model: string
  /** 不传表示保留已保存的 Key，空字符串表示清除 */
  apiKey?: string
  proxyUrl: string
}

export function fetchAiConfig(): Promise<AiServerConfig> {
  return call<AiServerConfig>('/ai/config')
}

export async function saveAiSettings(input: AiSettingsInput): Promise<void> {
  await call('/ai/settings', { body: input })
}

export async function deleteAiSettings(): Promise<void> {
  await call('/ai/settings', { method: 'DELETE', body: {} })
}

export function testAiSettings(settings?: AiSettingsInput): Promise<{ model: string; ms: number; reply: string }> {
  return call('/ai/test', { body: settings ? { settings } : {} })
}

export async function serverChat(items: ChatItem[]): Promise<AssistantItem> {
  const res = await call<{ item: AssistantItem }>('/ai/chat', { body: { items } })
  return res.item
}

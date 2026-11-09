import {
  AiResponseError,
  checkSequence,
  endpointUrl,
  LIMITS,
  parseResponse,
  requestBody,
  requestHeaders,
  upstreamErrorMessage,
  type AssistantItem,
  type ChatItem,
  type ToolCall,
  type UserItem,
} from '../../../server/src/ai/core.ts'
import { directModel, type DirectConfig } from './settings'

/** 把一轮对话发给 AI，拿回一条回答 */
export type Transport = (items: ChatItem[], signal: AbortSignal) => Promise<AssistantItem>

export class AssistantError extends Error {}

/** 浏览器直连 AI 接口 */
export function directTransport(config: DirectConfig, fetchImpl: typeof fetch = fetch): Transport {
  return async (items, signal) => {
    const url = endpointUrl(config.format, config.baseUrl)
    const host = new URL(url).host
    let res: Response
    try {
      res = await fetchImpl(url, {
        method: 'POST',
        headers: requestHeaders(config.format, config.apiKey.trim(), true),
        body: JSON.stringify(requestBody(config.format, items, directModel(config))),
        signal,
        credentials: 'omit',
      })
    } catch (err) {
      if (signal.aborted) throw err
      throw new AssistantError(
        `浏览器连不上 ${host}：可能是网络不通，或者这个接口不允许浏览器跨域访问。可以换一个支持跨域的中转地址，或登录后改用服务器转发（服务器转发还能设置代理）。`,
      )
    }
    const text = await res.text().catch(() => '')
    let json: unknown
    try {
      json = JSON.parse(text)
    } catch {
      json = undefined
    }
    if (!res.ok) throw new AssistantError(upstreamErrorMessage(res.status, json, config.apiKey.trim()))
    if (json === undefined) throw new AssistantError(`${host} 返回的不是 JSON，请检查接入地址`)
    try {
      return parseResponse(config.format, json)
    } catch (err) {
      if (err instanceof AiResponseError) throw new AssistantError(`${err.message}，请检查接口格式`)
      throw err
    }
  }
}

export interface AskOptions {
  transport: Transport
  runTool: (call: ToolCall) => Promise<string>
  /** 每多一条（回答或工具结果）就回调一次，用来实时显示查询进度 */
  onProgress?: (items: ChatItem[]) => void
  signal?: AbortSignal
}

/**
 * 问一个问题：发给 AI，需要数据时在本机执行工具、把结果发回去，直到拿到最终回答（最多 LIMITS.steps 轮）。
 * 返回加上这个问题和回答后的完整对话。出错时抛出异常，调用方保留原来的对话不变（对话只追加，不改动已有条目）。
 */
export async function ask(history: ChatItem[], question: UserItem, opts: AskOptions): Promise<ChatItem[]> {
  const signal = opts.signal ?? new AbortController().signal
  const items: ChatItem[] = [...history, question]
  const problem = checkSequence(items)
  if (problem) throw new AssistantError(problem)
  for (let step = 0; step < LIMITS.steps; step++) {
    const reply = await opts.transport(items, signal)
    if (signal.aborted) throw new DOMException('已停止', 'AbortError')
    items.push(reply)
    opts.onProgress?.([...items])
    if (!reply.toolCalls?.length) {
      if (!reply.text) reply.text = reply.stop === 'max_tokens' ? '（回答太长被截断了）' : '（没有回答内容）'
      return items
    }
    const results = []
    for (const call of reply.toolCalls) results.push({ id: call.id, content: await opts.runTool(call) })
    if (signal.aborted) throw new DOMException('已停止', 'AbortError')
    items.push({ role: 'tool', results })
    opts.onProgress?.([...items])
  }
  // 查询轮数用完：补一条说明，对话仍然完整（以工具结果结尾也能接着问）
  items.push({ role: 'assistant', text: '查询的步骤太多了，没能得出结论。换个更具体的问法试试，比如指明时间段和分类。' })
  return items
}

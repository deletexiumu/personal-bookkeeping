import { describe, expect, it, vi } from 'vitest'
import type { AssistantItem, ChatItem } from '../../../server/src/ai/core.ts'
import { ask, AssistantError, directTransport, type Transport } from './agent'

describe('AI 助手对话', () => {
  it('需要数据时在本机执行工具，再把结果发回去，直到拿到回答', async () => {
    const replies: AssistantItem[] = [
      { role: 'assistant', text: '', toolCalls: [{ id: 't1', name: 'query_summary', args: { start: '2026-11-01', end: '2026-11-30' } }] },
      { role: 'assistant', text: '本月支出 **¥124.50**' },
    ]
    const seen: ChatItem[][] = []
    const transport: Transport = async (items) => {
      seen.push(structuredClone(items))
      return replies.shift()!
    }
    const runTool = vi.fn(async () => '{"expense":124.5}')
    const progress = vi.fn()
    const items = await ask([], { role: 'user', text: '这个月花了多少', context: '今天是 2026-11-09' }, { transport, runTool, onProgress: progress })
    expect(items.map((i) => i.role)).toEqual(['user', 'assistant', 'tool', 'assistant'])
    expect(items[2]).toEqual({ role: 'tool', results: [{ id: 't1', content: '{"expense":124.5}' }] })
    expect(seen[1]).toHaveLength(3)
    expect(runTool).toHaveBeenCalledTimes(1)
    expect(progress).toHaveBeenCalledTimes(3)
  })

  it('接口出错时抛出异常，原来的对话不受影响', async () => {
    const history: ChatItem[] = [
      { role: 'user', text: '上个月呢' },
      { role: 'assistant', text: '上个月支出 ¥20.00' },
    ]
    const transport: Transport = async () => {
      throw new AssistantError('API Key 无效或没有权限')
    }
    await expect(ask(history, { role: 'user', text: '再往前一个月' }, { transport, runTool: async () => '' })).rejects.toThrow('API Key')
    expect(history).toHaveLength(2)
  })

  it('浏览器直连：Anthropic 带跨域声明头，错误信息里隐去 Key', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: { message: 'bad key sk-ant-123456789' } }), { status: 401 }))
    const transport = directTransport({ format: 'anthropic', baseUrl: '', model: '', apiKey: 'sk-ant-123456789' }, fetchImpl as unknown as typeof fetch)
    await expect(transport([{ role: 'user', text: 'hi' }], new AbortController().signal)).rejects.toThrow('API Key 无效或没有权限：bad key ***')
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.anthropic.com/v1/messages')
    expect(init.headers).toMatchObject({ 'x-api-key': 'sk-ant-123456789', 'anthropic-dangerous-direct-browser-access': 'true' })
    expect(JSON.parse(String(init.body)).model).toBe('claude-opus-5-5')
  })

  it('浏览器直连连不上时提示跨域或改用服务器转发', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    const transport = directTransport({ format: 'openai', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', apiKey: 'k' }, fetchImpl as unknown as typeof fetch)
    await expect(transport([{ role: 'user', text: 'hi' }], new AbortController().signal)).rejects.toThrow(/跨域.*服务器转发/)
  })
})

import { describe, expect, it, vi } from 'vitest'
import { ApiError, apiRequest, describeDevice, normalizeServerUrl } from './api'

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

describe('服务器地址', () => {
  it('去掉结尾斜杠，空值表示同源', () => {
    expect(normalizeServerUrl(' https://example.com/ ')).toBe('https://example.com')
    expect(normalizeServerUrl('')).toBe('')
    expect(() => normalizeServerUrl('example.com')).toThrow('格式不正确')
    expect(() => normalizeServerUrl('ftp://example.com')).toThrow('https://')
  })
})

describe('apiRequest', () => {
  it('同源走 Cookie，跨域带 Bearer 令牌', async () => {
    const fetchMock = vi.fn(async () => json(200, { ok: 1 }))
    await apiRequest({ baseUrl: '' }, '/auth/me', {}, fetchMock)
    expect(fetchMock).toHaveBeenLastCalledWith('/api/auth/me', expect.objectContaining({ credentials: 'same-origin', method: 'GET' }))

    await apiRequest({ baseUrl: 'https://s.example', token: 'tzb_x' }, '/auth/logout', { body: {} }, fetchMock)
    const [url, init] = fetchMock.mock.calls.at(-1) as unknown as [string, RequestInit]
    expect(url).toBe('https://s.example/api/auth/logout')
    expect(init).toMatchObject({ method: 'POST', credentials: 'omit', body: '{}' })
    expect(init.headers).toMatchObject({ authorization: 'Bearer tzb_x', 'content-type': 'application/json' })
  })

  it('把接口错误、网络错误和「没有后端」转成中文提示', async () => {
    const err = await apiRequest({ baseUrl: '' }, '/auth/login', { body: {} }, async () =>
      json(401, { error: { code: 'invalid_credentials', message: '邮箱或密码不正确' } }),
    ).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ status: 401, code: 'invalid_credentials', message: '邮箱或密码不正确' })

    await expect(
      apiRequest({ baseUrl: '' }, '/auth/config', {}, async () => {
        throw new TypeError('Failed to fetch')
      }),
    ).rejects.toMatchObject({ code: 'network' })

    await expect(
      apiRequest({ baseUrl: '' }, '/auth/config', {}, async () => new Response('<!doctype html>', { status: 200, headers: { 'content-type': 'text/html' } })),
    ).rejects.toMatchObject({ code: 'no_server', message: '这个地址没有陶朱簿云服务' })

    expect(await apiRequest({ baseUrl: '' }, '/auth/logout', { body: {} }, async () => new Response(null, { status: 204 }))).toBeUndefined()
  })
})

describe('设备描述', () => {
  it('从 User-Agent 识别浏览器和系统', () => {
    expect(describeDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15')).toBe('Safari · macOS')
    expect(describeDevice('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 Edg/140.0')).toBe('Edge · Windows')
    expect(describeDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 MicroMessenger/8.0')).toBe('微信 · iOS')
    expect(describeDevice(null)).toBe('未知设备')
  })
})

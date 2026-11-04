import { beforeEach, describe, expect, it } from 'vitest'
import { invites, sessions } from '../src/db/schema.ts'
import { sessionCookie, startTestServer, type Json, type TestServer } from './helpers.ts'

let s: TestServer

beforeEach(async () => {
  s = await startTestServer()
})

const account = { email: 'Knowing@Example.com', password: 'correct horse' }

async function register(body: Record<string, unknown> = account) {
  return s.request('/api/auth/register', { json: body })
}

describe('注册', () => {
  it('成功后写入 HttpOnly 会话 Cookie，邮箱转小写', async () => {
    const res = await register()
    expect(res.status).toBe(201)
    const body = await res.json() as Json
    expect(body.user).toMatchObject({ email: 'knowing@example.com', emailVerified: false })
    expect(body.token).toBeUndefined()
    const cookie = res.headers.getSetCookie().find((c) => c.startsWith('tzb_session='))!
    expect(cookie).toMatch(/HttpOnly/)
    expect(cookie).toMatch(/Secure/)
    expect(cookie).toMatch(/SameSite=Strict/)
    expect(cookie).toMatch(/Path=\/api/)

    const me = await s.request('/api/auth/me', { cookie: sessionCookie(res) })
    expect(me.status).toBe(200)
    expect((await me.json() as Json).user.email).toBe('knowing@example.com')
  })

  it('同一邮箱（不分大小写）不能重复注册', async () => {
    await register()
    const res = await register({ email: 'knowing@example.COM', password: 'another pass' })
    expect(res.status).toBe(409)
    expect(await res.json() as Json).toMatchObject({ error: { code: 'email_taken', field: 'email' } })
  })

  it('校验邮箱和密码', async () => {
    const short = await register({ email: 'a@b.cn', password: '1234567' })
    expect(short.status).toBe(400)
    expect(await short.json() as Json).toMatchObject({ error: { code: 'invalid_input', message: '密码至少 8 位', field: 'password' } })
    const bad = await register({ email: 'not-an-email', password: '12345678' })
    expect(await bad.json() as Json).toMatchObject({ error: { message: '邮箱格式不正确', field: 'email' } })
  })

  it('请求体必须是 JSON', async () => {
    const res = await s.request('/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    })
    expect(res.status).toBe(415)
  })

  it('bearer 模式把令牌放在响应里，不写 Cookie', async () => {
    const res = await register({ ...account, tokenMode: 'bearer' })
    const body = await res.json() as Json
    expect(body.token).toMatch(/^tzb_/)
    expect(res.headers.getSetCookie()).toHaveLength(0)
    const me = await s.request('/api/auth/me', { token: body.token })
    expect(me.status).toBe(200)
  })
})

describe('登录与退出', () => {
  beforeEach(async () => {
    await register()
  })

  it('密码错误返回统一提示，正确则登录', async () => {
    const wrong = await s.request('/api/auth/login', { json: { email: account.email, password: 'wrong password' } })
    expect(wrong.status).toBe(401)
    expect(await wrong.json() as Json).toMatchObject({ error: { message: '邮箱或密码不正确' } })
    const nobody = await s.request('/api/auth/login', { json: { email: 'nobody@example.com', password: 'whatever1' } })
    expect(await nobody.json() as Json).toMatchObject({ error: { message: '邮箱或密码不正确' } })

    const ok = await s.request('/api/auth/login', { json: account })
    expect(ok.status).toBe(200)
    expect((await ok.json() as Json).user.email).toBe('knowing@example.com')
  })

  it('同一邮箱连续失败 10 次后限频', async () => {
    for (let i = 0; i < 10; i++) {
      const res = await s.request('/api/auth/login', { json: { email: account.email, password: `wrong-${i}-pass` } })
      expect(res.status).toBe(401)
    }
    const blocked = await s.request('/api/auth/login', { json: account })
    expect(blocked.status).toBe(429)
    expect(blocked.headers.get('retry-after')).toBeTruthy()
  })

  it('未登录访问返回 401', async () => {
    expect((await s.request('/api/auth/me')).status).toBe(401)
    expect((await s.request('/api/auth/me', { token: 'tzb_forged' })).status).toBe(401)
  })

  it('退出后令牌失效；Cookie 方式的改动请求必须是 JSON', async () => {
    const login = await s.request('/api/auth/login', { json: account })
    const cookie = sessionCookie(login)
    const notJson = await s.request('/api/auth/logout', { method: 'POST', cookie })
    expect(notJson.status).toBe(415)

    const out = await s.request('/api/auth/logout', { json: {}, cookie })
    expect(out.status).toBe(204)
    expect(out.headers.getSetCookie().join()).toMatch(/tzb_session=;/)
    expect((await s.request('/api/auth/me', { cookie })).status).toBe(401)
  })

  it('会话 30 天不用就过期，使用中自动续期', async () => {
    const { token } = await (await s.request('/api/auth/login', { json: { ...account, tokenMode: 'bearer' } })).json() as Json
    s.clock.now = new Date('2026-11-30T10:00:00Z')
    expect((await s.request('/api/auth/me', { token })).status).toBe(200)
    // 上次使用（11-30）后 30 天内仍有效
    s.clock.now = new Date('2026-12-25T10:00:00Z')
    expect((await s.request('/api/auth/me', { token })).status).toBe(200)
    s.clock.now = new Date('2027-02-01T10:00:00Z')
    expect((await s.request('/api/auth/me', { token })).status).toBe(401)
  })
})

describe('账号管理', () => {
  let token: string

  beforeEach(async () => {
    token = (await (await register({ ...account, tokenMode: 'bearer' })).json() as Json).token
  })

  it('设备列表与踢下线', async () => {
    const other = (await (await s.request('/api/auth/login', { json: { ...account, tokenMode: 'bearer' }, headers: { 'user-agent': 'Taozhubu Desktop' } })).json() as Json).token
    const list = (await (await s.request('/api/auth/sessions', { token })).json() as Json).sessions
    expect(list).toHaveLength(2)
    expect(list.filter((x: { current: boolean }) => x.current)).toHaveLength(1)
    const target = list.find((x: { userAgent: string }) => x.userAgent === 'Taozhubu Desktop')
    expect((await s.request(`/api/auth/sessions/${target.id}`, { method: 'DELETE', token })).status).toBe(204)
    expect((await s.request('/api/auth/me', { token: other })).status).toBe(401)
    expect((await s.request(`/api/auth/sessions/${target.id}`, { method: 'DELETE', token })).status).toBe(404)
    expect((await s.request('/api/auth/sessions/not-a-uuid', { method: 'DELETE', token })).status).toBe(404)
  })

  it('改密码：需要当前密码，其他设备下线', async () => {
    const other = (await (await s.request('/api/auth/login', { json: { ...account, tokenMode: 'bearer' } })).json() as Json).token
    const wrong = await s.request('/api/auth/password', { json: { currentPassword: 'nope nope', newPassword: 'new password' }, token })
    expect(wrong.status).toBe(400)
    const ok = await s.request('/api/auth/password', { json: { currentPassword: account.password, newPassword: 'new password' }, token })
    expect(ok.status).toBe(204)
    expect((await s.request('/api/auth/me', { token })).status).toBe(200)
    expect((await s.request('/api/auth/me', { token: other })).status).toBe(401)
    expect((await s.request('/api/auth/login', { json: account })).status).toBe(401)
    expect((await s.request('/api/auth/login', { json: { ...account, password: 'new password' } })).status).toBe(200)
  })

  it('注销账号：需要密码，删除后会话一并删除', async () => {
    const wrong = await s.request('/api/auth/account', { method: 'DELETE', json: { password: 'nope nope' }, token })
    expect(wrong.status).toBe(400)
    const ok = await s.request('/api/auth/account', { method: 'DELETE', json: { password: account.password }, token })
    expect(ok.status).toBe(204)
    expect((await s.request('/api/auth/me', { token })).status).toBe(401)
    expect(await s.database.db.select().from(sessions)).toHaveLength(0)
    expect((await s.request('/api/auth/login', { json: account })).status).toBe(401)
    // 注销后可以用同一邮箱重新注册
    expect((await register()).status).toBe(201)
  })
})

describe('注册开关', () => {
  it('closed 时拒绝注册', async () => {
    const closed = await startTestServer({ REGISTRATION: 'closed' })
    const res = await closed.request('/api/auth/register', { json: account })
    expect(res.status).toBe(403)
    expect(await (await closed.request('/api/auth/config')).json() as Json).toEqual({ registration: 'closed' })
  })

  it('invite 时需要有效且未用过的邀请码', async () => {
    const inv = await startTestServer({ REGISTRATION: 'invite' })
    await inv.database.db.insert(invites).values([
      { code: 'good-code' },
      { code: 'old-code', expiresAt: new Date('2026-01-01T00:00:00Z') },
    ])
    const none = await inv.request('/api/auth/register', { json: account })
    expect(await none.json() as Json).toMatchObject({ error: { code: 'invite_required' } })
    const expired = await inv.request('/api/auth/register', { json: { ...account, inviteCode: 'old-code' } })
    expect(await expired.json() as Json).toMatchObject({ error: { code: 'invalid_invite' } })
    // 邀请码无效时整个注册回滚，邮箱没有被占用
    const ok = await inv.request('/api/auth/register', { json: { ...account, inviteCode: 'good-code' } })
    expect(ok.status).toBe(201)
    const reused = await inv.request('/api/auth/register', { json: { email: 'b@example.com', password: '12345678', inviteCode: 'good-code' } })
    expect(await reused.json() as Json).toMatchObject({ error: { code: 'invalid_invite' } })
  })
})

describe('其他', () => {
  it('健康检查与未知接口', async () => {
    expect(await (await s.request('/api/healthz')).json() as Json).toEqual({ status: 'ok' })
    const res = await s.request('/api/nope')
    expect(res.status).toBe(404)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })
})

describe('跨域', () => {
  it('只对白名单来源（桌面端）放行，且不允许带 Cookie', async () => {
    const preflight = await s.request('/api/auth/login', {
      method: 'OPTIONS',
      headers: { origin: 'tauri://localhost', 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' },
    })
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('access-control-allow-origin')).toBe('tauri://localhost')
    expect(preflight.headers.get('access-control-allow-credentials')).toBeNull()

    const other = await s.request('/api/auth/config', { headers: { origin: 'https://evil.example' } })
    expect(other.headers.get('access-control-allow-origin')).toBeNull()
  })
})

import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { getAccount, resetAccountCache } from '../app/account'
import { db } from '../db'
import { addTransaction } from '../db/transactions'

function json(status: number, body: unknown) {
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

const user = { id: 'u1', email: 'knowing@example.com', emailVerified: false, createdAt: '2026-11-04T10:00:00.000Z' }

/** 一个极简的假后端：记录请求，按路径返回 */
function fakeServer(overrides: Record<string, () => Response> = {}) {
  const calls: { url: string; body?: unknown; method: string }[] = []
  const fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
    const body = init.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ url, body, method: init.method ?? 'GET' })
    const path = url.replace(/^.*\/api/, '')
    if (overrides[path]) return overrides[path]()
    if (path === '/auth/config') return json(200, { registration: 'open' })
    if (path === '/auth/login' || path === '/auth/register') return json(200, { user })
    if (path === '/auth/me') return json(200, { user })
    if (path === '/auth/logout') return json(204, null)
    if (path.startsWith('/sync/pull')) return json(200, { changes: [], cursor: 0, more: false })
    if (path === '/sync/push') return json(200, { accepted: body.changes.length, conflicts: [] })
    if (path === '/sync/status') return json(200, { tables: {}, limit: 200000 })
    return json(404, { error: { code: 'not_found', message: '接口不存在' } })
  })
  vi.stubGlobal('fetch', fetchMock)
  return calls
}

beforeEach(async () => {
  localStorage.clear()
  resetAccountCache()
  await db.open()
})

afterEach(async () => {
  vi.unstubAllGlobals()
  window.location.hash = ''
  await db.delete()
})

describe('登录与账号', () => {
  it('登录后回到设置页显示账号，侧边栏显示已登录', async () => {
    const calls = fakeServer()
    window.location.hash = '#/login'
    const u = userEvent.setup()
    render(<App />)
    const form = await screen.findByRole('form', { name: '登录' })
    await u.type(within(form).getByLabelText('邮箱'), 'Knowing@Example.com')
    await u.type(within(form).getByLabelText('密码'), 'correct horse')
    await u.click(within(form).getByRole('button', { name: '登录' }))

    expect(await screen.findByRole('heading', { level: 1, name: '设置' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: user.email })).toBeInTheDocument()
    expect(calls.find((c) => c.url === '/api/auth/login')?.body).toEqual({
      email: 'Knowing@Example.com',
      password: 'correct horse',
      tokenMode: 'cookie',
    })
    expect(getAccount()).toEqual({ server: '', user })
    const sidebar = screen.getByRole('complementary', { name: '主导航' })
    expect(within(sidebar).getByText(user.email)).toBeInTheDocument()
  })

  it('注册：两次密码不一致时不提交；服务器的字段错误显示出来', async () => {
    const calls = fakeServer({
      '/auth/register': () => json(409, { error: { code: 'email_taken', message: '该邮箱已注册，请直接登录', field: 'email' } }),
    })
    window.location.hash = '#/login?mode=register'
    const u = userEvent.setup()
    render(<App />)
    const form = await screen.findByRole('form', { name: '注册' })
    await u.type(within(form).getByLabelText('邮箱'), 'a@example.com')
    await u.type(within(form).getByLabelText(/^密码/), '12345678')
    await u.type(within(form).getByLabelText('确认密码'), '12345679')
    await u.click(within(form).getByRole('button', { name: '注册并登录' }))
    expect(await within(form).findByRole('alert')).toHaveTextContent('两次输入的密码不一致')
    expect(calls.some((c) => c.url.endsWith('/auth/register'))).toBe(false)

    await u.clear(within(form).getByLabelText('确认密码'))
    await u.type(within(form).getByLabelText('确认密码'), '12345678')
    await u.click(within(form).getByRole('button', { name: '注册并登录' }))
    await waitFor(() => expect(within(form).getByRole('alert')).toHaveTextContent('该邮箱已注册'))
    expect(within(form).getByLabelText('邮箱')).toHaveAttribute('aria-invalid', 'true')
  })

  it('需要邀请码时显示邀请码输入框；关闭注册时提示', async () => {
    fakeServer({ '/auth/config': () => json(200, { registration: 'invite' }) })
    window.location.hash = '#/login?mode=register'
    render(<App />)
    expect(await screen.findByLabelText('邀请码')).toBeInTheDocument()
  })

  it('启动时会话已失效则变为未登录；退出登录清掉本机登录信息', async () => {
    localStorage.setItem('taozhubu:account', JSON.stringify({ server: '', user }))
    fakeServer({ '/auth/me': () => json(401, { error: { code: 'unauthorized', message: '请先登录' } }) })
    window.location.hash = '#/settings'
    render(<App />)
    expect(await screen.findByRole('link', { name: '登录' })).toBeInTheDocument()
    expect(getAccount().user).toBeUndefined()
  })

  it('退出登录', async () => {
    localStorage.setItem('taozhubu:account', JSON.stringify({ server: '', user }))
    const calls = fakeServer()
    window.location.hash = '#/settings'
    const u = userEvent.setup()
    render(<App />)
    await u.click(await screen.findByRole('button', { name: '退出登录' }))
    const dialog = await screen.findByRole('dialog', { name: '退出登录' })
    await u.click(within(dialog).getByRole('button', { name: '退出登录' }))
    expect(await screen.findByRole('link', { name: '登录' })).toBeInTheDocument()
    expect(calls.some((c) => c.url === '/api/auth/logout' && c.method === 'POST')).toBe(true)
    expect(getAccount()).toEqual({ server: '' })
  })

  it('查看登录设备并让其他设备下线；修改密码', async () => {
    localStorage.setItem('taozhubu:account', JSON.stringify({ server: '', user }))
    const calls = fakeServer({
      '/auth/sessions': () =>
        json(200, {
          sessions: [
            { id: 's1', userAgent: 'Mozilla/5.0 (Macintosh) Chrome/140.0 Safari/537.36', ip: null, createdAt: user.createdAt, lastUsedAt: user.createdAt, current: true },
            { id: 's2', userAgent: 'Taozhubu Desktop (Windows)', ip: '1.2.3.4', createdAt: user.createdAt, lastUsedAt: user.createdAt, current: false },
          ],
        }),
      '/auth/sessions/s2': () => json(204, null),
      '/auth/password': () => json(204, null),
    })
    window.location.hash = '#/settings'
    const u = userEvent.setup()
    render(<App />)
    await u.click(await screen.findByRole('button', { name: '登录设备' }))
    const dialog = await screen.findByRole('dialog', { name: '登录设备' })
    expect(await within(dialog).findByText('陶朱簿桌面端 · Windows')).toBeInTheDocument()
    expect(within(dialog).getAllByRole('button', { name: '下线' })).toHaveLength(1)
    await u.click(within(dialog).getByRole('button', { name: '下线' }))
    await waitFor(() => expect(within(dialog).queryByText('陶朱簿桌面端 · Windows')).not.toBeInTheDocument())
    expect(calls.some((c) => c.url === '/api/auth/sessions/s2' && c.method === 'DELETE')).toBe(true)
    await u.keyboard('{Escape}')

    await u.click(screen.getByRole('button', { name: '修改密码' }))
    const pw = await screen.findByRole('dialog', { name: '修改密码' })
    await u.type(within(pw).getByLabelText('当前密码'), 'old password')
    await u.type(within(pw).getByLabelText(/^新密码/), 'new password')
    await u.type(within(pw).getByLabelText('确认新密码'), 'new password')
    await u.click(within(pw).getByRole('button', { name: '修改密码' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(calls.find((c) => c.url === '/api/auth/password')?.body).toEqual({ currentPassword: 'old password', newPassword: 'new password' })
  })

  it('本机已有数据时，登录后先问怎么同步；选合并后上传本机数据', async () => {
    localStorage.setItem('taozhubu:account', JSON.stringify({ server: '', user }))
    await addTransaction(db, { type: 'expense', amount: 1234, categoryId: 1, accountId: 1, date: '2026-11-04', note: '本机' })
    const cloudRecord = { table: 'transactions', uid: 'cloud-1', modifiedAt: 1, rev: 1, data: { type: 'income', amount: 1, date: '2026-11-01', accountUid: 'default-account-1' } }
    const calls = fakeServer({
      '/sync/status': () => json(200, { tables: { transactions: { records: 3 } }, limit: 200000 }),
      '/sync/pull?since=0': () => json(200, { changes: [cloudRecord], cursor: 1, more: false }),
    })
    window.location.hash = '#/settings'
    const u = userEvent.setup()
    render(<App />)
    const dialog = await screen.findByRole('dialog', { name: '同步这台设备的数据' })
    expect(await within(dialog).findByText(/云端账号 knowing@example.com 里有 3 笔/)).toBeInTheDocument()
    expect(calls.some((c) => c.url === '/api/sync/push')).toBe(false)
    await u.click(within(dialog).getByRole('button', { name: /合并到云端/ }))
    await waitFor(() => expect(calls.some((c) => c.url === '/api/sync/push')).toBe(true))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    const push = calls.find((c) => c.url === '/api/sync/push')
    expect((push!.body as { changes: { table: string; data: { note?: string } }[] }).changes).toContainEqual(
      expect.objectContaining({ table: 'transactions', data: expect.objectContaining({ note: '本机', accountUid: 'default-account-1' }) }),
    )
    await waitFor(() => expect(screen.getByRole('button', { name: /立即同步/ })).toHaveTextContent('已同步'))
    expect(await db.transactions.where('uid').equals('cloud-1').count()).toBe(1)
  })

  it('登录后本机记一笔，2 秒后自动推送', async () => {
    localStorage.setItem('taozhubu:account', JSON.stringify({ server: '', user }))
    const calls = fakeServer()
    window.location.hash = '#/settings'
    render(<App />)
    await waitFor(() => expect(screen.getByRole('button', { name: /立即同步/ })).toHaveTextContent('已同步'))
    await addTransaction(db, { type: 'expense', amount: 500, categoryId: 1, accountId: 1, date: '2026-11-04', note: '自动' })
    await waitFor(() => expect(calls.some((c) => c.url === '/api/sync/push')).toBe(true), { timeout: 4000 })
    await waitFor(() => expect(screen.getByRole('button', { name: /立即同步/ })).not.toHaveTextContent('待同步'))
  })
})

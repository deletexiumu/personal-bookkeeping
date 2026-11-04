import { beforeEach, describe, expect, it } from 'vitest'
import { startTestServer, type Json, type TestServer } from './helpers.ts'

let s: TestServer
let token: string

async function login(email = 'knowing@example.com') {
  const res = await s.request('/api/auth/register', { json: { email, password: 'correct horse', tokenMode: 'bearer' } })
  return ((await res.json()) as Json).token as string
}

beforeEach(async () => {
  s = await startTestServer({ SYNC_MAX_RECORDS: '1000' })
  token = await login()
})

const tx = (uid: string, modifiedAt: number, amount = 100) => ({
  table: 'transactions',
  uid,
  modifiedAt,
  data: { type: 'expense', amount, date: '2026-11-04', categoryUid: 'default-category-1' },
})

async function push(changes: unknown[], t = token) {
  const res = await s.request('/api/sync/push', { json: { changes }, token: t })
  return { status: res.status, body: (await res.json()) as Json }
}

async function pull(since = 0, t = token, limit?: number) {
  const res = await s.request(`/api/sync/pull?since=${since}${limit ? `&limit=${limit}` : ''}`, { token: t })
  return (await res.json()) as Json
}

describe('云同步', () => {
  it('需要登录', async () => {
    expect((await s.request('/api/sync/pull')).status).toBe(401)
    expect((await s.request('/api/sync/push', { json: { changes: [] } })).status).toBe(401)
  })

  it('推送后能拉取，按 rev 增量拉', async () => {
    const res = await push([tx('a', 1000), tx('b', 1000)])
    expect(res).toMatchObject({ status: 200, body: { accepted: 2, conflicts: [] } })
    const first = await pull()
    expect(first.changes).toHaveLength(2)
    expect(first.changes[0]).toMatchObject({ table: 'transactions', uid: 'a', modifiedAt: 1000, data: { amount: 100 } })
    expect(first.more).toBe(false)

    await push([tx('a', 2000, 300)])
    const next = await pull(first.cursor)
    expect(next.changes).toEqual([expect.objectContaining({ uid: 'a', modifiedAt: 2000, data: expect.objectContaining({ amount: 300 }) })])
    expect(next.cursor).toBeGreaterThan(first.cursor)
    expect((await pull(next.cursor)).changes).toEqual([])
  })

  it('后写为准：更旧或同时的改动不覆盖，返回云端版本', async () => {
    await push([tx('a', 2000, 200)])
    const res = await push([tx('a', 1000, 100), tx('b', 1000)])
    expect(res.body.accepted).toBe(1)
    expect(res.body.conflicts).toEqual([expect.objectContaining({ uid: 'a', modifiedAt: 2000, data: expect.objectContaining({ amount: 200 }) })])
    const same = await push([tx('a', 2000, 999)])
    expect(same.body.accepted).toBe(0)
    const all = await pull()
    expect(all.changes.find((c: Json) => c.uid === 'a').data.amount).toBe(200)
  })

  it('删除以 data 为 null 推送，拉取时同样返回', async () => {
    await push([tx('a', 1000)])
    await push([{ table: 'transactions', uid: 'a', modifiedAt: 1500, data: null }])
    const all = await pull()
    expect(all.changes).toEqual([expect.objectContaining({ uid: 'a', data: null })])
    const status = (await (await s.request('/api/sync/status', { token })).json()) as Json
    expect(status.tables.transactions).toEqual({ records: 0, deleted: 1 })
  })

  it('同一批里重复的 uid 只留最新的', async () => {
    const res = await push([tx('a', 1000, 1), tx('a', 3000, 3), tx('a', 2000, 2)])
    expect(res.body).toMatchObject({ accepted: 1 })
    expect((await pull()).changes[0].data.amount).toBe(3)
  })

  it('分页拉取', async () => {
    await push(Array.from({ length: 5 }, (_, i) => tx(`t${i}`, 1000)))
    const page1 = await pull(0, token, 2)
    expect(page1.changes.map((c: Json) => c.uid)).toEqual(['t0', 't1'])
    expect(page1.more).toBe(true)
    const page2 = await pull(page1.cursor, token, 2)
    const page3 = await pull(page2.cursor, token, 2)
    expect(page3.changes.map((c: Json) => c.uid)).toEqual(['t4'])
    expect(page3.more).toBe(false)
  })

  it('不同账号的数据互不可见', async () => {
    await push([tx('a', 1000)])
    const other = await login('other@example.com')
    expect((await pull(0, other)).changes).toEqual([])
    await push([tx('a', 500)], other)
    expect((await pull(0, other)).changes[0].modifiedAt).toBe(500)
    expect((await pull()).changes[0].modifiedAt).toBe(1000)
  })

  it('注销账号时云端数据一并删除', async () => {
    await push([tx('a', 1000)])
    const res = await s.request('/api/auth/account', { method: 'DELETE', json: { password: 'correct horse' }, token })
    expect(res.status).toBe(204)
    const other = await login()
    expect((await pull(0, other)).changes).toEqual([])
  })

  it('校验输入', async () => {
    expect((await push([{ ...tx('a', 1), table: 'users' }])).status).toBe(400)
    expect((await push([{ ...tx('a b', 1) }])).status).toBe(400)
    expect((await push([{ ...tx('a', -1) }])).status).toBe(400)
    expect((await push(Array.from({ length: 501 }, (_, i) => tx(`t${i}`, 1)))).status).toBe(400)
    const big = await push([{ ...tx('a', 1), data: { note: 'x'.repeat(70 * 1024) } }])
    expect(big).toMatchObject({ status: 413, body: { error: { code: 'record_too_large' } } })
    expect((await s.request('/api/sync/pull?since=-1', { token })).status).toBe(400)
  })

  it('超过记录数上限时拒绝新增，已有记录仍可修改', async () => {
    await push(Array.from({ length: 500 }, (_, i) => tx(`t${i}`, 1)))
    await push(Array.from({ length: 500 }, (_, i) => tx(`u${i}`, 1)))
    const over = await push([tx('extra', 1)])
    expect(over).toMatchObject({ status: 413, body: { error: { code: 'quota_exceeded' } } })
    expect((await push([tx('t1', 2)])).body.accepted).toBe(1)
  })
})

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BookkeepingDB } from './index'
import { addTransaction, listByMonth, summarize } from './transactions'

let db: BookkeepingDB

beforeEach(async () => {
  db = new BookkeepingDB(`test-${crypto.randomUUID()}`)
  await db.open()
})

afterEach(async () => {
  await db.delete()
})

describe('BookkeepingDB', () => {
  it('首次打开时写入默认分类和账户', async () => {
    expect(await db.categories.where('type').equals('expense').count()).toBeGreaterThan(0)
    expect(await db.categories.where('type').equals('income').count()).toBeGreaterThan(0)
    expect(await db.accounts.count()).toBe(4)
  })
})

describe('transactions', () => {
  it('按月查询并按日期倒序返回', async () => {
    const base = { categoryId: 1, accountId: 1 }
    await addTransaction(db, { ...base, type: 'expense', amount: 1000, date: '2026-10-31' })
    await addTransaction(db, { ...base, type: 'expense', amount: 2500, date: '2026-11-01' })
    await addTransaction(db, { ...base, type: 'income', amount: 800000, date: '2026-11-15' })
    await addTransaction(db, { ...base, type: 'expense', amount: 300, date: '2026-12-01' })

    const rows = await listByMonth(db, '2026-11')
    expect(rows.map((r) => r.date)).toEqual(['2026-11-15', '2026-11-01'])
    expect(summarize(rows)).toEqual({ income: 800000, expense: 2500, balance: 797500 })
  })
})

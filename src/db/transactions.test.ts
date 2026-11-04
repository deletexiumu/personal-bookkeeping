import { Dexie } from 'dexie'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BookkeepingDB } from './index'
import {
  addTransaction,
  addTransfer,
  categoryUsage,
  deleteTransaction,
  groupByDay,
  listByMonth,
  restoreTransactions,
  summarize,
  updateTransaction,
} from './transactions'

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

describe('groupByDay', () => {
  it('按天分组并计算每日小计', () => {
    const base = { categoryId: 1, accountId: 1, source: 'manual' as const, createdAt: 0, updatedAt: 0 }
    const groups = groupByDay([
      { ...base, id: 1, type: 'expense', amount: 3200, date: '2026-11-04' },
      { ...base, id: 2, type: 'expense', amount: 600, date: '2026-11-04' },
      { ...base, id: 3, type: 'income', amount: 1200000, date: '2026-11-03' },
    ])
    expect(groups.map((g) => [g.date, g.items.length, g.expense, g.income])).toEqual([
      ['2026-11-04', 2, 3800, 0],
      ['2026-11-03', 1, 0, 1200000],
    ])
  })
})

describe('v2 数据模型', () => {
  it('从 v1 升级时为旧记录补上 source', async () => {
    const name = `test-upgrade-${crypto.randomUUID()}`
    const v1 = new Dexie(name)
    v1.version(1).stores({ transactions: '++id, date, type, categoryId, accountId', categories: '++id, type, name', accounts: '++id, name' })
    await v1.table('transactions').add({ type: 'expense', amount: 100, categoryId: 1, accountId: 1, date: '2026-11-01', createdAt: 1, updatedAt: 1 })
    v1.close()

    const upgraded = new BookkeepingDB(name)
    const [row] = await upgraded.transactions.toArray()
    expect(row.source).toBe('manual')
    expect(await upgraded.transactions.where('source').equals('manual').count()).toBe(1)
    await upgraded.delete()
  })

  it('新记录默认来源为手动，保存时间和标签', async () => {
    const id = await addTransaction(db, {
      type: 'expense',
      amount: 3200,
      categoryId: 1,
      accountId: 1,
      date: '2026-11-04',
      time: '12:30',
      tags: ['家庭'],
    })
    const row = await db.transactions.get(id)
    expect(row).toMatchObject({ source: 'manual', time: '12:30', tags: ['家庭'] })
    expect(await db.transactions.where('tags').equals('家庭').count()).toBe(1)
  })

  it('转账不计入收支，手续费另记一笔支出', async () => {
    const ids = await addTransfer(db, {
      fromAccountId: 4,
      toAccountId: 2,
      amount: 500000,
      fee: 200,
      feeCategoryId: 7,
      date: '2026-11-04',
    })
    expect(ids).toHaveLength(2)
    const rows = await listByMonth(db, '2026-11')
    expect(rows.find((r) => r.type === 'transfer')).toMatchObject({ accountId: 4, transferAccountId: 2, amount: 500000 })
    expect(rows.find((r) => r.type === 'expense')).toMatchObject({ amount: 200, categoryId: 7, note: '转账手续费' })
    expect(summarize(rows)).toEqual({ income: 0, expense: 200, balance: -200 })
  })

  it('转出和转入账户相同时报错', async () => {
    await expect(addTransfer(db, { fromAccountId: 1, toAccountId: 1, amount: 100, date: '2026-11-04' })).rejects.toThrow()
  })

  it('同一天按时间倒序', async () => {
    const base = { type: 'expense' as const, amount: 100, categoryId: 1, accountId: 1, date: '2026-11-04' }
    await addTransaction(db, { ...base, time: '08:00', note: 'a' })
    await addTransaction(db, { ...base, time: '12:30', note: 'b' })
    await addTransaction(db, { ...base, note: 'c' })
    expect((await listByMonth(db, '2026-11')).map((r) => r.note)).toEqual(['b', 'a', 'c'])
  })

  it('统计分类使用次数', async () => {
    const base = { type: 'expense' as const, amount: 100, accountId: 1, date: '2026-11-04' }
    await addTransaction(db, { ...base, categoryId: 2 })
    await addTransaction(db, { ...base, categoryId: 2 })
    await addTransaction(db, { ...base, categoryId: 3 })
    await addTransfer(db, { fromAccountId: 1, toAccountId: 2, amount: 100, date: '2026-11-04' })
    const usage = await categoryUsage(db)
    expect(usage.get(2)).toBe(2)
    expect(usage.get(3)).toBe(1)
    expect(usage.size).toBe(2)
  })
})

describe('编辑与撤销删除', () => {
  it('修改字段并清除传 undefined 的字段', async () => {
    const id = await addTransaction(db, { type: 'expense', amount: 100, categoryId: 1, accountId: 1, date: '2026-11-04', note: '旧备注' })
    await updateTransaction(db, id, { amount: 250, note: undefined, merchant: '瑞幸' })
    const row = await db.transactions.get(id)
    expect(row).toMatchObject({ amount: 250, merchant: '瑞幸' })
    expect(row).not.toHaveProperty('note')
    expect(row!.updatedAt).toBeGreaterThanOrEqual(row!.createdAt)
  })

  it('删除后按原 ID 恢复', async () => {
    const id = await addTransaction(db, { type: 'expense', amount: 100, categoryId: 1, accountId: 1, date: '2026-11-04' })
    const row = (await db.transactions.get(id))!
    await deleteTransaction(db, id)
    expect(await db.transactions.count()).toBe(0)
    await restoreTransactions(db, [row])
    expect(await db.transactions.get(id)).toEqual(row)
  })

  it('修改不存在的记录时报错', async () => {
    await expect(updateTransaction(db, 999, { amount: 1 })).rejects.toThrow('记录不存在')
  })
})

describe('v3 分类与账户', () => {
  it('新库的默认分类和账户带图标、类型和排序', async () => {
    const food = await db.categories.get(1)
    expect(food).toMatchObject({ name: '餐饮', icon: 'utensils', color: 'orange', order: 1 })
    const wechat = await db.accounts.get(4)
    expect(wechat).toMatchObject({ name: '微信', type: 'wechat', initialBalance: 0, order: 4 })
  })

  it('从 v2 升级时补上图标、类型和排序', async () => {
    const name = `test-upgrade3-${crypto.randomUUID()}`
    const v2 = new Dexie(name)
    v2.version(2).stores({ transactions: '++id, date', categories: '++id, type, name', accounts: '++id, name' })
    await v2.table('categories').bulkAdd([{ name: '餐饮', type: 'expense' }, { name: '宠物', type: 'expense' }])
    await v2.table('accounts').bulkAdd([{ name: '微信' }, { name: '招行信用卡' }])
    v2.close()

    const upgraded = new BookkeepingDB(name)
    expect(await upgraded.categories.toArray()).toEqual([
      { id: 1, name: '餐饮', type: 'expense', icon: 'utensils', color: 'orange', order: 1 },
      { id: 2, name: '宠物', type: 'expense', order: 2 },
    ])
    expect(await upgraded.accounts.toArray()).toEqual([
      { id: 1, name: '微信', type: 'wechat', initialBalance: 0, order: 1 },
      { id: 2, name: '招行信用卡', type: 'other', initialBalance: 0, order: 2 },
    ])
    await upgraded.delete()
  })
})

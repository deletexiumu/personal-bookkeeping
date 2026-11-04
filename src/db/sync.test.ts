import { Dexie } from 'dexie'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { latestUpgradeBackup } from './backup'
import { setBudget } from './budgets'
import { deleteCategory, saveCategory } from './catalog'
import { BookkeepingDB } from './index'
import { addTransaction, deleteTransaction, restoreTransactions, updateTransaction } from './transactions'
import { applyRemoteChanges } from './sync'

let db: BookkeepingDB

beforeEach(async () => {
  db = new BookkeepingDB(`test-${crypto.randomUUID()}`)
  await db.open()
})

afterEach(async () => {
  await db.delete()
})

const UUID = /^[0-9a-f-]{36}$/

describe('同步元数据', () => {
  it('新库的默认分类和账户用固定 uid，不推送，也没有升级前备份', async () => {
    expect(await latestUpgradeBackup(db)).toBeUndefined()
    const food = await db.categories.get(1)
    expect(food).toMatchObject({ name: '餐饮', uid: 'default-category-1', modifiedAt: 0 })
    expect(food?.dirty).toBeUndefined()
    expect(await db.accounts.get(1)).toMatchObject({ name: '现金', uid: 'default-account-1', modifiedAt: 0 })
    expect(await db.categories.where('dirty').equals(1).count()).toBe(0)
  })

  it('新增时分配 uid 并标记待推送；修改时 uid 不变、修改时间更新', async () => {
    const id = await addTransaction(db, { type: 'expense', amount: 100, categoryId: 1, accountId: 1, date: '2026-11-04' })
    const row = (await db.transactions.get(id))!
    expect(row.uid).toMatch(UUID)
    expect(row.dirty).toBe(1)
    expect(row.modifiedAt).toBeGreaterThan(0)

    await new Promise((r) => setTimeout(r, 2))
    await updateTransaction(db, id, { amount: 200 })
    const updated = (await db.transactions.get(id))!
    expect(updated.uid).toBe(row.uid)
    expect(updated.modifiedAt).toBeGreaterThan(row.modifiedAt!)

    // 改默认分类后它也要推送
    await saveCategory(db, { ...(await db.categories.get(1))!, name: '吃饭' })
    expect(await db.categories.get(1)).toMatchObject({ uid: 'default-category-1', dirty: 1 })
  })

  it('删除留下删除记录；撤销删除（按原 uid 加回）时撤掉删除记录', async () => {
    const id = await addTransaction(db, { type: 'expense', amount: 100, categoryId: 1, accountId: 1, date: '2026-11-04' })
    const row = (await db.transactions.get(id))!
    await deleteTransaction(db, id)
    expect(await db.syncTombstones.toArray()).toEqual([{ table: 'transactions', uid: row.uid, deletedAt: expect.any(Number) }])

    await restoreTransactions(db, [row])
    expect(await db.syncTombstones.count()).toBe(0)

    await deleteCategory(db, 5)
    expect(await db.syncTombstones.get(['categories', 'default-category-5'])).toBeTruthy()
  })

  it('按条件批量删除（where().delete()）和清空表也留下删除记录', async () => {
    for (const date of ['2026-11-01', '2026-11-02', '2026-11-03']) {
      await addTransaction(db, { type: 'expense', amount: 1, categoryId: 1, accountId: 1, date })
    }
    await db.transactions.where('date').below('2026-11-03').delete()
    expect(await db.syncTombstones.count()).toBe(2)
    await db.transactions.clear()
    expect(await db.syncTombstones.count()).toBe(3)
  })

  it('预算按分类用固定 uid，删了再设回来是同一条', async () => {
    await setBudget(db, undefined, 500000)
    await setBudget(db, 1, 100000)
    const budgets = await db.budgets.toArray()
    expect(budgets.map((b) => b.uid).sort()).toEqual(['budget-default-category-1', 'budget-total'])
    await setBudget(db, 1, null)
    expect(await db.syncTombstones.get(['budgets', 'budget-default-category-1'])).toBeTruthy()
    await setBudget(db, 1, 120000)
    expect(await db.syncTombstones.count()).toBe(0)
  })

  it('按 id 覆盖成另一条记录时，原来那条记为删除', async () => {
    const id = await addTransaction(db, { type: 'income', amount: 1, accountId: 1, date: '2026-01-01' })
    const old = (await db.transactions.get(id))!
    await db.transactions.put({ ...old, uid: 'from-backup', amount: 9 })
    expect(await db.syncTombstones.get(['transactions', old.uid!])).toBeTruthy()
    // 不带 uid 的覆盖（旧格式备份）沿用原有 uid，不算删除
    const { uid: _uid, ...withoutUid } = (await db.transactions.get(id))!
    await db.transactions.put({ ...withoutUid, amount: 10 })
    expect((await db.transactions.get(id))!.uid).toBe('from-backup')
    expect(await db.syncTombstones.count()).toBe(1)
  })

  it('写入云端拉下来的改动：不标记待推送，保留传入的修改时间，删除不留记录', async () => {
    await applyRemoteChanges(db, ['transactions', 'categories'], async () => {
      await db.transactions.add({
        uid: 'remote-1',
        modifiedAt: 1234,
        type: 'expense',
        amount: 100,
        categoryId: 1,
        accountId: 1,
        date: '2026-11-04',
        source: 'manual',
        createdAt: 1,
        updatedAt: 1,
      })
      await db.categories.delete(2)
    })
    const remote = await db.transactions.where('uid').equals('remote-1').first()
    expect(remote).toMatchObject({ modifiedAt: 1234 })
    expect(remote?.dirty).toBeUndefined()
    expect(await db.syncTombstones.count()).toBe(0)

    // 之后的本机修改照常标记
    await updateTransaction(db, remote!.id!, { note: '本机改的' })
    expect(await db.transactions.get(remote!.id!)).toMatchObject({ dirty: 1 })
  })
})

describe('从 v6 升级到 v7', () => {
  it('补上 uid：默认数据用固定 uid，预算跟随分类，其余随机并标记待推送', async () => {
    const name = `test-upgrade7-${crypto.randomUUID()}`
    const v6 = new Dexie(name)
    v6.version(6).stores({
      transactions: '++id, date, type, categoryId, accountId, transferAccountId, source, importBatchId, *tags, externalId',
      categories: '++id, type, name, order',
      accounts: '++id, name, order',
      budgets: '++id, categoryId',
      importBatches: '++id, createdAt',
      rules: '++id, order, categoryId',
      importTemplates: '++id, name',
    })
    await v6.table('categories').bulkAdd([
      { name: '餐饮', type: 'expense', icon: 'utensils', color: 'orange', order: 1 },
      { name: '出行', type: 'expense', icon: 'bus', color: 'blue', order: 2 },
      { name: '宠物', type: 'expense', order: 3 },
    ])
    await v6.table('accounts').bulkAdd([{ name: '现金', type: 'cash', initialBalance: 5000, order: 1 }])
    await v6.table('budgets').bulkAdd([{ amount: 100 }, { categoryId: 3, amount: 50 }])
    await v6.table('transactions').add({ type: 'expense', amount: 1, categoryId: 3, accountId: 1, date: '2026-11-04', source: 'manual', createdAt: 1, updatedAt: 1 })
    v6.close()

    const upgraded = new BookkeepingDB(name)
    const categories = await upgraded.categories.toArray()
    // 餐饮没改过：固定 uid、不推送；交通改名为出行：仍是默认那条，但要推送；宠物是自己加的
    expect(categories[0]).toMatchObject({ uid: 'default-category-1', modifiedAt: 0 })
    expect(categories[0].dirty).toBeUndefined()
    expect(categories[1]).toMatchObject({ dirty: 1 })
    expect(categories[1].uid).not.toBe('default-category-2')
    expect(categories[2].uid).toMatch(UUID)
    // 现金改过初始余额：固定 uid，但要推送
    expect(await upgraded.accounts.get(1)).toMatchObject({ uid: 'default-account-1', dirty: 1 })
    const budgets = await upgraded.budgets.toArray()
    expect(budgets.map((b) => b.uid)).toEqual(['budget-total', `budget-${categories[2].uid}`])
    expect(await upgraded.transactions.where('dirty').equals(1).count()).toBe(1)
    expect(await upgraded.syncTombstones.count()).toBe(0)

    // 升级前的数据原样留了一份
    const before = await latestUpgradeBackup(upgraded)
    expect(before).toMatchObject({ app: 'taozhubu', schema: 6 })
    expect(before?.data.categories).toHaveLength(3)
    expect(before?.data.categories[0]).not.toHaveProperty('uid')
    expect(before?.data.transactions).toHaveLength(1)
    await upgraded.delete()
  })
})

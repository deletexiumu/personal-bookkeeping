import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { deleteAccount, deleteCategory, listAccounts, listCategories, moveItem, saveAccount, saveCategory } from './catalog'
import { BookkeepingDB } from './index'
import { addTransaction, addTransfer } from './transactions'

let db: BookkeepingDB

beforeEach(async () => {
  db = new BookkeepingDB(`test-${crypto.randomUUID()}`)
  await db.open()
})

afterEach(async () => {
  await db.delete()
})

describe('分类', () => {
  it('新增排在最后，同类型不能重名', async () => {
    const id = await saveCategory(db, { name: ' 宠物 ', type: 'expense', icon: 'paw-print', color: 'purple' })
    const list = await listCategories(db)
    expect(list.at(-1)).toMatchObject({ id, name: '宠物', order: 12 })
    await expect(saveCategory(db, { name: '宠物', type: 'expense' })).rejects.toThrow('已有同名分类')
    // 收入里可以有同名
    await expect(saveCategory(db, { name: '宠物', type: 'income' })).resolves.toBeTypeOf('number')
    await expect(saveCategory(db, { name: '  ', type: 'income' })).rejects.toThrow('名称不能为空')
  })

  it('编辑保留 ID 和排序', async () => {
    await saveCategory(db, { id: 1, name: '吃饭', type: 'expense', icon: 'coffee', color: 'orange', order: 1 })
    expect(await db.categories.get(1)).toMatchObject({ name: '吃饭', icon: 'coffee', order: 1 })
  })

  it('有流水的分类不能删除', async () => {
    await addTransaction(db, { type: 'expense', amount: 100, categoryId: 1, accountId: 1, date: '2026-11-04' })
    await expect(deleteCategory(db, 1)).rejects.toThrow('有 1 笔流水')
    await deleteCategory(db, 2)
    expect(await db.categories.get(2)).toBeUndefined()
  })

  it('只在同类型内移动', async () => {
    await moveItem(db, 'categories', 2, -1)
    const expense = (await listCategories(db)).filter((c) => c.type === 'expense').map((c) => c.name)
    expect(expense.slice(0, 3)).toEqual(['交通', '餐饮', '购物'])
    // 收入第一个再上移不变
    await moveItem(db, 'categories', 8, -1)
    expect((await listCategories(db)).find((c) => c.type === 'income')?.name).toBe('工资')
  })
})

describe('账户', () => {
  it('新增与重名校验', async () => {
    const id = await saveAccount(db, { name: '招行信用卡', type: 'credit', initialBalance: -50000 })
    expect((await listAccounts(db)).at(-1)).toMatchObject({ id, type: 'credit', initialBalance: -50000, order: 5 })
    await expect(saveAccount(db, { name: '微信' })).rejects.toThrow('已有同名账户')
  })

  it('转账两端用到的账户都不能删除', async () => {
    await addTransfer(db, { fromAccountId: 1, toAccountId: 2, amount: 100, date: '2026-11-04' })
    await expect(deleteAccount(db, 2)).rejects.toThrow('不能删除')
    await deleteAccount(db, 3)
    expect(await db.accounts.count()).toBe(3)
  })

  it('下移', async () => {
    await moveItem(db, 'accounts', 1, 1)
    expect((await listAccounts(db)).map((a) => a.name)).toEqual(['银行卡', '现金', '支付宝', '微信'])
  })
})

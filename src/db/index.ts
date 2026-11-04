import { Dexie, type EntityTable } from 'dexie'
import type { Account, Budget, Category, Transaction } from '../types'
import { DEFAULT_ACCOUNT_TYPES, DEFAULT_ACCOUNTS, DEFAULT_CATEGORIES } from './defaults'

export { DEFAULT_ACCOUNTS, DEFAULT_CATEGORIES }

/** 本地数据库，基于浏览器 IndexedDB。数据只存在本机，不上传。 */
export class BookkeepingDB extends Dexie {
  transactions!: EntityTable<Transaction, 'id'>
  categories!: EntityTable<Category, 'id'>
  accounts!: EntityTable<Account, 'id'>
  budgets!: EntityTable<Budget, 'id'>

  constructor(name = 'personal-bookkeeping') {
    super(name)
    this.version(1).stores({
      transactions: '++id, date, type, categoryId, accountId',
      categories: '++id, type, name',
      accounts: '++id, name',
    })
    // v2：转账、时间、商户、标签、来源、导入批次。旧记录补上 source = 'manual'。
    this.version(2)
      .stores({
        transactions: '++id, date, type, categoryId, accountId, transferAccountId, source, importBatchId, *tags',
      })
      .upgrade((tx) =>
        tx
          .table('transactions')
          .toCollection()
          .modify((row: Partial<Transaction>) => {
            row.source ??= 'manual'
          }),
      )
    // v3：分类图标 / 颜色 / 排序 / 归档，账户类型 / 初始余额 / 排序 / 归档
    this.version(3)
      .stores({
        categories: '++id, type, name, order',
        accounts: '++id, name, order',
      })
      .upgrade(async (tx) => {
        const presets = new Map(DEFAULT_CATEGORIES.map((c) => [c.name, c]))
        await tx
          .table('categories')
          .toCollection()
          .modify((c: Category) => {
            const preset = presets.get(c.name)
            c.icon ??= preset?.icon
            c.color ??= preset?.color
            c.order ??= c.id
            if (c.icon === undefined) delete c.icon
            if (c.color === undefined) delete c.color
          })
        await tx
          .table('accounts')
          .toCollection()
          .modify((a: Account) => {
            a.type ??= DEFAULT_ACCOUNT_TYPES[a.name] ?? 'other'
            a.initialBalance ??= 0
            a.order ??= a.id
          })
      })
    // v4：月度预算
    this.version(4).stores({ budgets: '++id, categoryId' })
    this.on('populate', (tx) => {
      tx.table('categories').bulkAdd(DEFAULT_CATEGORIES)
      tx.table('accounts').bulkAdd(DEFAULT_ACCOUNTS)
    })
  }
}

export const db = new BookkeepingDB()

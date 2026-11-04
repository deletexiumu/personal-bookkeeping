import { Dexie, type EntityTable } from 'dexie'
import type { Account, Category, Transaction } from '../types'

/** 本地数据库，基于浏览器 IndexedDB。数据只存在本机，不上传。 */
export class BookkeepingDB extends Dexie {
  transactions!: EntityTable<Transaction, 'id'>
  categories!: EntityTable<Category, 'id'>
  accounts!: EntityTable<Account, 'id'>

  constructor(name = 'personal-bookkeeping') {
    super(name)
    this.version(1).stores({
      transactions: '++id, date, type, categoryId, accountId',
      categories: '++id, type, name',
      accounts: '++id, name',
    })
    this.on('populate', (tx) => {
      tx.table('categories').bulkAdd(DEFAULT_CATEGORIES)
      tx.table('accounts').bulkAdd(DEFAULT_ACCOUNTS)
    })
  }
}

export const DEFAULT_CATEGORIES: Category[] = [
  { name: '餐饮', type: 'expense' },
  { name: '交通', type: 'expense' },
  { name: '购物', type: 'expense' },
  { name: '居住', type: 'expense' },
  { name: '娱乐', type: 'expense' },
  { name: '医疗', type: 'expense' },
  { name: '其他支出', type: 'expense' },
  { name: '工资', type: 'income' },
  { name: '奖金', type: 'income' },
  { name: '理财', type: 'income' },
  { name: '其他收入', type: 'income' },
]

export const DEFAULT_ACCOUNTS: Account[] = [
  { name: '现金' },
  { name: '银行卡' },
  { name: '支付宝' },
  { name: '微信' },
]

export const db = new BookkeepingDB()

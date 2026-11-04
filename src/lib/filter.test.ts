import { describe, expect, it } from 'vitest'
import type { Transaction } from '../types'
import { filterTransactions, isFilterEmpty } from './filter'

const base = { accountId: 1, date: '2026-11-04', source: 'manual' as const, createdAt: 0, updatedAt: 0 }
const rows: Transaction[] = [
  { ...base, id: 1, type: 'expense', amount: 3200, categoryId: 1, note: '午饭', tags: ['工作日'] },
  { ...base, id: 2, type: 'expense', amount: 18650, categoryId: 3, merchant: '盒马鲜生', accountId: 3, source: 'import', externalId: '2026102823001181821409885170' },
  { ...base, id: 3, type: 'income', amount: 1200000, categoryId: 8, accountId: 2 },
  { ...base, id: 4, type: 'transfer', amount: 50000, accountId: 4, transferAccountId: 2 },
]
const categories = [
  { id: 1, name: '餐饮', type: 'expense' as const },
  { id: 3, name: '购物', type: 'expense' as const },
  { id: 8, name: '工资', type: 'income' as const },
]
const ids = (filter: Parameters<typeof filterTransactions>[1]) =>
  filterTransactions(rows, filter, categories).map((t) => t.id)

describe('filterTransactions', () => {
  it('空条件返回全部', () => {
    expect(ids({})).toEqual([1, 2, 3, 4])
    expect(isFilterEmpty({ query: '  ' })).toBe(true)
    expect(isFilterEmpty({ accountId: 0 })).toBe(false)
  })

  it('关键字匹配备注、商户、分类、标签、金额、交易单号', () => {
    expect(ids({ query: '午饭' })).toEqual([1])
    expect(ids({ query: '盒马' })).toEqual([2])
    expect(ids({ query: '工资' })).toEqual([3])
    expect(ids({ query: '#工作日' })).toEqual([1])
    expect(ids({ query: '186.5' })).toEqual([2])
    expect(ids({ query: '12000' })).toEqual([3])
    expect(ids({ query: '转账' })).toEqual([4])
    expect(ids({ query: '2026102823001181821409885170' })).toEqual([2])
  })

  it('按类型、分类、来源筛选', () => {
    expect(ids({ type: 'expense' })).toEqual([1, 2])
    expect(ids({ categoryId: 3 })).toEqual([2])
    expect(ids({ source: 'import' })).toEqual([2])
  })

  it('账户同时匹配转账两端', () => {
    expect(ids({ accountId: 2 })).toEqual([3, 4])
    expect(ids({ accountId: 4 })).toEqual([4])
  })
})

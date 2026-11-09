import { describe, expect, it } from 'vitest'
import type { Transaction } from '../types'
import { filterTransactions, isFilterEmpty, parseTransactionsHash, UNTAGGED } from './filter'
import { makeTagResolver } from './tags'

const base = { accountId: 1, date: '2026-11-04', source: 'manual' as const, createdAt: 0, updatedAt: 0 }
const rows: Transaction[] = [
  { ...base, id: 1, type: 'expense', amount: 3200, categoryId: 1, note: '午饭', tags: ['工作日'] },
  { ...base, id: 2, type: 'expense', amount: 18650, categoryId: 3, merchant: '盒马鲜生', accountId: 3, source: 'import', externalId: '2026102823001181821409885170', goods: '盒马鲜生(中铁西城店)外卖订单', merchantOrderNo: '13180600726102885069996412054', payMethod: '中信银行储蓄卡(1145)' },
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

describe('按标签筛选', () => {
  const resolve = makeTagResolver([{ merchant: '盒马鲜生', tags: ['买菜'] }])
  const tagged = (filter: Parameters<typeof filterTransactions>[1]) =>
    filterTransactions(rows, filter, categories, resolve).map((t) => t.id)

  it('按实际生效的标签（含商户标签）筛选；未打标签不含转账', () => {
    expect(tagged({ tag: '买菜' })).toEqual([2])
    expect(tagged({ tag: '工作日' })).toEqual([1])
    expect(tagged({ tag: UNTAGGED })).toEqual([3])
    expect(tagged({ query: '#买菜' })).toEqual([2])
    expect(isFilterEmpty({ tag: '买菜' })).toBe(false)
  })

  it('链接里带标签', () => {
    expect(parseTransactionsHash('#/transactions?month=2026-11&tag=游戏').filter).toEqual({ tag: '游戏' })
  })
})

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

  it('关键字也匹配商品说明、商户单号、付款方式和合并进来的流水', () => {
    expect(ids({ query: '外卖订单' })).toEqual([2])
    expect(ids({ query: '13180600726102885069996412054' })).toEqual([2])
    expect(ids({ query: '1145' })).toEqual([2])
    const merged: Transaction = { ...base, id: 9, type: 'expense', amount: 100, merged: [{ label: '招商银行流水', date: '2026-11-04', note: '快捷支付', ref: 'B9' }] }
    expect(filterTransactions([merged], { query: '快捷支付' }).map((t) => t.id)).toEqual([9])
    expect(filterTransactions([merged], { query: 'B9' }).map((t) => t.id)).toEqual([9])
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

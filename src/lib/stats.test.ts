import { describe, expect, it } from 'vitest'
import { summarize } from '../db/transactions'
import type { Transaction } from '../types'
import { merchantNet, periodStats, trendSeries } from './analysis'
import { computeBalances } from './balance'
import { expenseByCategory } from './budget'
import { filterTransactions } from './filter'
import { statType } from './stats'

const tx = (patch: Partial<Transaction>): Transaction => ({
  id: 1,
  type: 'expense',
  amount: 1000,
  accountId: 1,
  categoryId: 1,
  date: '2026-11-01',
  source: 'import',
  merchant: '余额宝',
  createdAt: 1,
  updatedAt: 1,
  ...patch,
})

describe('不计收支', () => {
  const rows = [tx({}), tx({ id: 2, type: 'income', amount: 5000, excluded: true }), tx({ id: 3, amount: 300, excluded: true })]

  it('不计入收入、支出、分析和预算', () => {
    expect(statType(rows[1])).toBeUndefined()
    expect(statType({ type: 'transfer' })).toBeUndefined()
    expect(statType(rows[0])).toBe('expense')
    expect(periodStats(rows)).toMatchObject({ income: 0, expense: 1000, count: 1 })
    expect(summarize(rows)).toEqual({ income: 0, expense: 1000, balance: -1000 })
    expect(trendSeries(rows, [{ key: 'a', label: 'a', start: '2026-11-01', end: '2026-11-30' }] as never)[0]).toMatchObject({ income: 0, expense: 1000 })
    expect(merchantNet(rows)).toMatchObject([{ name: '余额宝', income: 0, expense: 1000, count: 1 }])
    expect(expenseByCategory(rows).total).toBe(1000)
  })

  it('仍计入账户余额，可以按「不计收支」搜索', () => {
    expect(computeBalances([{ id: 1, name: '支付宝', initialBalance: 0 }], rows).get(1)).toBe(-1000 + 5000 - 300)
    expect(filterTransactions(rows, { query: '不计收支' }).map((t) => t.id)).toEqual([2, 3])
  })
})

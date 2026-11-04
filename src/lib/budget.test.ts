import { describe, expect, it } from 'vitest'
import type { Transaction } from '../types'
import { budgetStatus, daysLeftInMonth, monthBudgets } from './budget'

const t = (row: Partial<Transaction>): Transaction => ({
  type: 'expense',
  amount: 0,
  accountId: 1,
  date: '2026-11-04',
  source: 'manual',
  createdAt: 0,
  updatedAt: 0,
  ...row,
})

describe('budget', () => {
  it('预警与超支阈值', () => {
    expect(budgetStatus(10000, 8000).level).toBe('ok')
    expect(budgetStatus(10000, 8001).level).toBe('warning')
    expect(budgetStatus(10000, 10000).level).toBe('warning')
    expect(budgetStatus(10000, 10001)).toMatchObject({ level: 'over', remaining: -1 })
  })

  it('汇总总预算和分类预算，超支分类置顶，忽略收入和转账', () => {
    const result = monthBudgets(
      [{ amount: 600000 }, { categoryId: 1, amount: 150000 }, { categoryId: 3, amount: 100000 }],
      [
        t({ categoryId: 1, amount: 132000 }),
        t({ categoryId: 3, amount: 115000 }),
        t({ categoryId: 2, amount: 42000 }),
        t({ type: 'income', categoryId: 8, amount: 1200000 }),
        t({ type: 'transfer', amount: 50000 }),
      ],
    )
    expect(result.total).toMatchObject({ amount: 600000, spent: 289000, level: 'ok' })
    expect(result.categories.map((c) => [c.categoryId, c.level])).toEqual([
      [3, 'over'],
      [1, 'warning'],
    ])
  })

  it('剩余天数', () => {
    expect(daysLeftInMonth('2026-11', '2026-11-04')).toBe(27)
    expect(daysLeftInMonth('2026-11', '2026-11-30')).toBe(1)
    expect(daysLeftInMonth('2026-10', '2026-11-04')).toBe(0)
    expect(daysLeftInMonth('2026-12', '2026-11-04')).toBe(31)
    expect(daysLeftInMonth('2028-02', '2028-02-01')).toBe(29)
  })
})

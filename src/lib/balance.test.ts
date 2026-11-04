import { describe, expect, it } from 'vitest'
import type { Transaction } from '../types'
import { computeBalances, netWorth } from './balance'

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

describe('computeBalances', () => {
  it('初始余额 + 收入 − 支出，转账两端各记一次', () => {
    const accounts = [
      { id: 1, name: '微信', initialBalance: 10000 },
      { id: 2, name: '银行卡' },
      { id: 3, name: '信用卡', initialBalance: -50000 },
    ]
    const balances = computeBalances(accounts, [
      t({ type: 'income', amount: 1200000, accountId: 2 }),
      t({ type: 'expense', amount: 3200, accountId: 1 }),
      t({ type: 'transfer', amount: 50000, accountId: 2, transferAccountId: 3 }),
      t({ type: 'expense', amount: 999, accountId: 99 }),
    ])
    expect(Object.fromEntries(balances)).toEqual({ 1: 6800, 2: 1150000, 3: 0 })
  })

  it('netWorth 区分资产和负债', () => {
    expect(netWorth([1000, -300, 0])).toEqual({ assets: 1000, liabilities: 300, net: 700 })
  })
})

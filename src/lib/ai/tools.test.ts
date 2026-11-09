import { describe, expect, it } from 'vitest'
import type { Account, Budget, Category, Transaction } from '../../types'
import { describeToolCall, listLedger, querySummary, queryTransactions, runTool, type LedgerSource } from './tools'

const categories: Category[] = [
  { id: 1, name: '餐饮', type: 'expense' },
  { id: 2, name: '交通', type: 'expense' },
  { id: 3, name: '工资', type: 'income' },
]
const accounts: Account[] = [
  { id: 1, name: '招商银行', initialBalance: 100000 },
  { id: 2, name: '支付宝', initialBalance: 0 },
]
const budgets: Budget[] = [{ id: 1, amount: 300000 }, { id: 2, categoryId: 1, amount: 100000 }]

let nextId = 1
const tx = (t: Partial<Transaction>): Transaction => ({
  id: nextId++,
  type: 'expense',
  amount: 1000,
  accountId: 1,
  date: '2026-11-01',
  source: 'manual',
  createdAt: 0,
  updatedAt: 0,
  ...t,
})

const rows: Transaction[] = [
  tx({ categoryId: 1, amount: 3250, merchant: '美团外卖', date: '2026-11-02' }),
  tx({ categoryId: 1, amount: 8800, merchant: '海底捞', date: '2026-11-05' }),
  tx({ categoryId: 2, amount: 400, merchant: '地铁', date: '2026-11-05', accountId: 2 }),
  tx({ type: 'income', categoryId: 3, amount: 1500000, date: '2026-11-10', note: '十月工资' }),
  tx({ type: 'transfer', amount: 200000, accountId: 1, transferAccountId: 2, date: '2026-11-11' }),
  tx({ categoryId: 1, amount: 50000, merchant: '余额宝', excluded: true, date: '2026-11-12' }),
  tx({ categoryId: 1, amount: 2000, merchant: '美团外卖', date: '2026-10-20' }),
]

const source: LedgerSource = {
  listRange: async (start, end) => rows.filter((t) => t.date >= start && t.date <= end),
  allTransactions: async () => rows,
  categories: async () => categories,
  accounts: async () => accounts,
  budgets: async () => budgets,
}

interface TxResult {
  matched: number
  transactions: Record<string, unknown>[]
}
const list = async (args: Record<string, unknown>) => (await queryTransactions(source, args)) as unknown as TxResult

describe('AI 工具', () => {
  it('汇总按口径排除转账和不计收支，按分类分组', async () => {
    const r = (await querySummary(source, { start: '2026-11-01', end: '2026-11-30' })) as Record<string, unknown>
    expect(r).toMatchObject({ income: 15000, expense: 124.5, balance: 14875.5, count: 4, notCounted: { transfers: 1, excluded: 1 } })
    expect(r.groups).toEqual([
      { name: '餐饮', amount: 120.5, count: 2, share: 0.968 },
      { name: '交通', amount: 4, count: 1, share: 0.032 },
    ])
  })

  it('汇总：关键字、分类名、按月合计；日期颠倒自动交换', async () => {
    const byKeyword = (await querySummary(source, { start: '2026-11-30', end: '2026-10-01', groupBy: 'merchant', keyword: '美团 海底' })) as Record<string, unknown>
    expect(byKeyword.groups).toEqual([
      { name: '海底捞', amount: 88, count: 1, share: 0.626 },
      { name: '美团外卖', amount: 52.5, count: 2, share: 0.374 },
    ])
    const months = (await querySummary(source, { start: '2026-10-01', end: '2026-11-30', groupBy: 'month', type: 'all', category: '餐饮' })) as Record<string, unknown>
    expect(months.groups).toEqual([
      { name: '2026-10', income: 0, expense: 20, net: -20, count: 1 },
      { name: '2026-11', income: 0, expense: 120.5, net: -120.5, count: 2 },
    ])
    expect(await querySummary(source, { start: '2026-10-01', end: '2026-11-30', category: '旅行' })).toMatchObject({ error: '没有叫「旅行」的分类' })
  })

  it('明细：默认不含转账和不计收支，可按金额排序、按账户筛选', async () => {
    const r = await list({ start: '2026-11-01', end: '2026-11-30', type: 'expense', sort: 'amount', limit: 2 })
    expect(r).toMatchObject({ matched: 3, matchedExpense: 124.5, returned: 2 })
    expect(r.transactions.map((t) => [t.merchant, t.amount])).toEqual([
      ['海底捞', 88],
      ['美团外卖', 32.5],
    ])
    const alipay = await list({ start: '2026-11-01', end: '2026-11-30', account: '支付宝', type: 'all' })
    expect(alipay.transactions.map((t) => t.merchant)).toEqual(['地铁'])
    const transfers = await list({ start: '2026-11-01', end: '2026-11-30', type: 'transfer', account: '支付宝' })
    expect(transfers.transactions).toEqual([expect.objectContaining({ type: '转账', account: '招商银行', toAccount: '支付宝', amount: 2000 })])
    const withExcluded = await list({ start: '2026-11-01', end: '2026-11-30', includeExcluded: true, minAmount: 100 })
    expect(withExcluded.transactions.map((t) => [t.amount, t.excluded])).toEqual([
      [500, true],
      [15000, undefined],
    ])
  })

  it('账本概况：分类、账户余额、预算和日期范围', async () => {
    const r = await listLedger(source)
    expect(r.transactions).toEqual({ count: 7, firstDate: '2026-10-20', lastDate: '2026-11-12' })
    expect(r.monthlyBudgets).toEqual([{ category: '总预算', amount: 3000 }, { category: '餐饮', amount: 1000 }])
    expect(r.accounts[1]).toMatchObject({ name: '支付宝', balance: expect.any(Number) })
  })

  it('参数不对时返回错误让模型重试，未知工具也不抛异常', async () => {
    expect(JSON.parse(await runTool(source, { id: '1', name: 'query_summary', args: { start: '11月', end: '2026-11-30' } }))).toEqual({
      error: 'start 和 end 必须是 YYYY-MM-DD 格式的日期',
    })
    expect(JSON.parse(await runTool(source, { id: '2', name: 'rm_rf', args: {} }))).toEqual({ error: '没有 rm_rf 这个工具' })
  })

  it('工具调用的中文说明', () => {
    expect(describeToolCall({ id: '1', name: 'query_summary', args: { start: '2026-11-01', end: '2026-11-30', groupBy: 'merchant', keyword: '美团' } })).toBe(
      '汇总 2026-11-01 至 2026-11-30「美团」 按商户',
    )
    expect(describeToolCall({ id: '2', name: 'list_ledger', args: {} })).toBe('查看分类、账户和预算')
  })
})

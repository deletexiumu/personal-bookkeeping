import type { PeriodStats, ShareItem, MerchantNet, TrendPoint } from '../analysis'
import { SOURCE_LABEL, type TransactionFilter } from '../filter'
import type { Account, Category, Transaction } from '../../types'
import { transactionView, yuan } from './tools'

/** 各页面交给 AI 助手的「当前页面数据」，都是 JSON，金额为元 */

const TYPE_TEXT = { expense: '支出', income: '收入', transfer: '转账' } as const

function namesOf(categories: Category[], accounts: Account[]) {
  return {
    category: new Map<number | undefined, string>(categories.map((c) => [c.id, c.name])),
    account: new Map<number | undefined, string>(accounts.map((a) => [a.id, a.name])),
  }
}

/** 明细页最多附带多少条流水 */
const MAX_ROWS = 80

export function transactionsPageData(opts: {
  month: string
  filter: TransactionFilter
  summary: { income: number; expense: number; balance: number }
  totalCount: number
  visible: Transaction[]
  categories: Category[]
  accounts: Account[]
  budget?: number
}): string {
  const n = namesOf(opts.categories, opts.accounts)
  const f = opts.filter
  const filter = {
    keyword: f.query?.trim() || undefined,
    type: f.type ? TYPE_TEXT[f.type] : undefined,
    category: f.categoryId !== undefined ? n.category.get(f.categoryId) : undefined,
    account: f.accountId !== undefined ? n.account.get(f.accountId) : undefined,
    source: f.source ? SOURCE_LABEL[f.source] : undefined,
  }
  return JSON.stringify({
    page: '明细',
    month: opts.month,
    filter: Object.values(filter).some(Boolean) ? filter : undefined,
    summary: { income: yuan(opts.summary.income), expense: yuan(opts.summary.expense), balance: yuan(opts.summary.balance) },
    monthlyBudget: opts.budget ? yuan(opts.budget) : undefined,
    monthCount: opts.totalCount,
    shownCount: opts.visible.length,
    transactions: opts.visible.slice(0, MAX_ROWS).map((t) => transactionView(t, n)),
    note: opts.visible.length > MAX_ROWS ? `只附带了前 ${MAX_ROWS} 条，更多请用工具查询` : undefined,
  })
}

const stats = (s: PeriodStats) => ({ income: yuan(s.income), expense: yuan(s.expense), balance: yuan(s.balance), count: s.count })
const shares = (list: ShareItem[], limit: number) =>
  list.slice(0, limit).map((s) => ({ name: s.name, amount: yuan(s.amount), count: s.count, share: Math.round(s.share * 1000) / 1000 }))

export function analysisPageData(opts: {
  period: { start: string; end: string; label: string }
  compareLabel: string
  view: 'expense' | 'income' | 'all'
  keywords: string[]
  current: PeriodStats
  previous: PeriodStats
  average: { label: string; value: number }
  expenseShares: ShareItem[]
  incomeShares: ShareItem[]
  merchants: ShareItem[]
  nets: MerchantNet[]
  points: TrendPoint[]
}): string {
  return JSON.stringify({
    page: '分析',
    period: opts.period,
    view: { expense: '支出', income: '收入', all: '收支合计' }[opts.view],
    keywords: opts.keywords.length ? opts.keywords : undefined,
    stats: stats(opts.current),
    previousPeriod: { compare: opts.compareLabel, ...stats(opts.previous) },
    [opts.average.label]: yuan(opts.average.value),
    expenseByCategory: shares(opts.expenseShares, 12),
    incomeByCategory: shares(opts.incomeShares, 6),
    topMerchants: opts.view === 'all' ? undefined : shares(opts.merchants, 10),
    merchantNet:
      opts.view === 'all'
        ? opts.nets.slice(0, 10).map((m) => ({ name: m.name, income: yuan(m.income), expense: yuan(m.expense), net: yuan(m.net), count: m.count }))
        : undefined,
    trend: opts.points.slice(0, 62).map((p) => ({ title: p.title, income: yuan(p.income), expense: yuan(p.expense) })),
  })
}

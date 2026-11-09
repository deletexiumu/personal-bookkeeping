import { useEffect, useSyncExternalStore } from 'react'
import { LIMITS } from '../../../server/src/ai/core.ts'
import { shiftMonth, today } from '../date'
import { periodOf } from '../period'
import { querySummary, type LedgerSource } from './tools'

/**
 * 随问题附带给 AI 的账本数据：今天的日期、当前页面的数据（页面通过 useAssistantPage 登记）、选定时间段的汇总。
 */

export interface PageContext {
  /** 显示在输入框上方，如「分析 · 2026年11月 · 支出」 */
  label: string
  /** 生成当前页面的数据（JSON 文本） */
  build: () => string
}

let current: PageContext | null = null
const listeners = new Set<() => void>()

function setPage(next: PageContext | null) {
  const changed = current?.label !== next?.label
  current = next
  if (changed) for (const l of listeners) l()
}

/** 页面登记自己的数据；离开页面时自动注销。build 每次渲染都会更新，取数时总是最新的 */
export function useAssistantPage(label: string, build: () => string) {
  useEffect(() => {
    setPage({ label, build })
  })
  useEffect(() => () => setPage(null), [])
}

export function useCurrentPage(): PageContext | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => current,
    () => null,
  )
}

export function getCurrentPage(): PageContext | null {
  return current
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

export function todayLine(date = today()): string {
  const [y, m, d] = date.split('-').map(Number)
  return `今天是 ${date}（周${WEEKDAYS[new Date(y, m - 1, d).getDay()]}）。金额单位：元。`
}

export type RangePreset = 'none' | 'this-month' | 'last-month' | 'last-3-months' | 'this-year' | 'last-year' | 'custom'

export const RANGE_LABELS: Record<RangePreset, string> = {
  none: '不附加',
  'this-month': '本月',
  'last-month': '上月',
  'last-3-months': '近三个月',
  'this-year': '今年',
  'last-year': '去年',
  custom: '自定义',
}

export function presetRange(preset: Exclude<RangePreset, 'none' | 'custom'>, date = today()): { start: string; end: string } {
  const month = date.slice(0, 7)
  if (preset === 'this-month') return periodOf('month', date)
  if (preset === 'last-month') return periodOf('month', `${shiftMonth(month, -1)}-01`)
  if (preset === 'last-3-months') return { start: `${shiftMonth(month, -2)}-01`, end: periodOf('month', date).end }
  if (preset === 'this-year') return periodOf('year', date)
  const year = String(Number(date.slice(0, 4)) - 1)
  return { start: `${year}-01-01`, end: `${year}-12-31` }
}

/** 一个时间段的汇总：总收支、支出分类、收入分类、支出商户，跨月时加上按月的收支 */
export async function rangeSummary(source: LedgerSource, start: string, end: string): Promise<string> {
  const base = { start, end }
  const [expense, income, merchants] = await Promise.all([
    querySummary(source, { ...base, groupBy: 'category', type: 'expense', limit: 15 }),
    querySummary(source, { ...base, groupBy: 'category', type: 'income', limit: 8 }),
    querySummary(source, { ...base, groupBy: 'merchant', type: 'expense', limit: 10 }),
  ])
  const summary: Record<string, unknown> = {
    range: base,
    income: expense.income,
    expense: expense.expense,
    balance: expense.balance,
    count: expense.count,
    notCounted: expense.notCounted,
    expenseByCategory: expense.groups,
    incomeByCategory: income.groups,
    topExpenseMerchants: merchants.groups,
  }
  if (start.slice(0, 7) !== end.slice(0, 7)) {
    const months = await querySummary(source, { ...base, groupBy: 'month', type: 'all', limit: 36 })
    summary.byMonth = months.groups
  }
  return JSON.stringify(summary)
}

/** 拼出一个问题要附带的数据 */
export async function buildContext(opts: {
  source: LedgerSource
  page?: PageContext | null
  range?: { start: string; end: string } | null
  date?: string
}): Promise<string> {
  const parts = [todayLine(opts.date)]
  if (opts.page) parts.push(`当前页面（${opts.page.label}）：${opts.page.build()}`)
  if (opts.range) parts.push(`${opts.range.start} 至 ${opts.range.end} 的汇总：${await rangeSummary(opts.source, opts.range.start, opts.range.end)}`)
  const text = parts.join('\n\n')
  return text.length > LIMITS.context ? `${text.slice(0, LIMITS.context - 20)}…（数据太多，已截断）` : text
}

import type { Category, CategoryType, Transaction } from '../types'
import type { Bucket } from './period'

/** 一个区间的收支概况；转账不计入 */
export interface PeriodStats {
  income: number
  expense: number
  balance: number
  /** 结余 / 收入；没有收入时为 null */
  savingsRate: number | null
  /** 收支笔数 */
  count: number
}

export function periodStats(rows: Transaction[]): PeriodStats {
  let income = 0
  let expense = 0
  let count = 0
  for (const t of rows) {
    if (t.type === 'income') income += t.amount
    else if (t.type === 'expense') expense += t.amount
    else continue
    count++
  }
  const balance = income - expense
  return { income, expense, balance, savingsRate: income > 0 ? balance / income : null, count }
}

/** 与上一期相比的变化比例；上一期为 0 时无法比较，返回 null */
export function changeRatio(current: number, previous: number): number | null {
  if (previous === 0) return null
  return (current - previous) / Math.abs(previous)
}

/** '+12.3%' / '-4%' / '持平' */
export function formatChange(ratio: number): string {
  const percent = Math.round(ratio * 1000) / 10
  if (percent === 0) return '持平'
  return `${percent > 0 ? '+' : ''}${percent}%`
}

/** 0.234 -> '23.4%' */
export function formatPercent(ratio: number): string {
  return `${Math.round(ratio * 1000) / 10}%`
}

/** 坐标轴上的紧凑金额：820、1.2k、3.5万 */
export function formatAxisAmount(cents: number): string {
  const yuan = cents / 100
  const trim = (n: number) => String(Math.round(n * 10) / 10)
  if (Math.abs(yuan) >= 10_000) return `${trim(yuan / 10_000)}万`
  if (Math.abs(yuan) >= 1_000) return `${trim(yuan / 1_000)}k`
  return trim(yuan)
}

export interface TrendPoint extends Bucket {
  income: number
  expense: number
}

/** 按柱子汇总收入和支出 */
export function trendSeries(rows: Transaction[], buckets: Bucket[]): TrendPoint[] {
  const points = buckets.map((b) => ({ ...b, income: 0, expense: 0 }))
  for (const t of rows) {
    if (t.type === 'transfer') continue
    const point = points.find((p) => t.date >= p.start && t.date <= p.end)
    if (point) point[t.type] += t.amount
  }
  return points
}

/** 让坐标轴刻度落在 1 / 2 / 2.5 / 5 × 10ⁿ 上，返回刻度值（含 0） */
export function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0]
  const rough = max / count
  const power = 10 ** Math.floor(Math.log10(rough))
  const step = [1, 2, 2.5, 5, 10].map((f) => f * power).find((s) => s >= rough) ?? 10 * power
  const ticks: number[] = []
  for (let v = 0; v < max + step; v += step) {
    ticks.push(v)
    if (v >= max) break
  }
  return ticks
}

/** 构成 / 排行中的一项 */
export interface ShareItem {
  /** 分类 ID 或商户名，用于下钻 */
  key: string
  name: string
  amount: number
  count: number
  /** 占该方向总额的比例 */
  share: number
  categoryId?: number
  merchant?: string
}

const UNCATEGORIZED = '未分类'

/** 按分类汇总某个方向的金额，从大到小 */
export function categoryShares(rows: Transaction[], categories: Category[], type: CategoryType): ShareItem[] {
  const names = new Map(categories.map((c) => [c.id, c.name]))
  const groups = new Map<number | undefined, { amount: number; count: number }>()
  let total = 0
  for (const t of rows) {
    if (t.type !== type) continue
    const group = groups.get(t.categoryId) ?? { amount: 0, count: 0 }
    group.amount += t.amount
    group.count++
    groups.set(t.categoryId, group)
    total += t.amount
  }
  return [...groups]
    .map(([categoryId, g]) => ({
      key: categoryId === undefined ? 'none' : String(categoryId),
      name: (categoryId !== undefined && names.get(categoryId)) || UNCATEGORIZED,
      amount: g.amount,
      count: g.count,
      share: total > 0 ? g.amount / total : 0,
      categoryId,
    }))
    .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name, 'zh-CN'))
}

/** 商户名：优先商户，没有时用备注；两者都没有的不参与排行 */
export function merchantOf(t: Transaction): string | undefined {
  return t.merchant?.trim() || t.note?.trim() || undefined
}

/** 商户排行（按金额），取前 limit 个 */
export function merchantTop(rows: Transaction[], type: CategoryType, limit = 5): ShareItem[] {
  const groups = new Map<string, { amount: number; count: number }>()
  let total = 0
  for (const t of rows) {
    if (t.type !== type) continue
    total += t.amount
    const name = merchantOf(t)
    if (!name) continue
    const group = groups.get(name) ?? { amount: 0, count: 0 }
    group.amount += t.amount
    group.count++
    groups.set(name, group)
  }
  return [...groups]
    .map(([name, g]) => ({
      key: name,
      name,
      amount: g.amount,
      count: g.count,
      share: total > 0 ? g.amount / total : 0,
      merchant: name,
    }))
    .sort((a, b) => b.amount - a.amount || b.count - a.count)
    .slice(0, limit)
}

/** 图表下钻：区间 + 方向 + 可选的分类 / 商户 */
export interface Drill {
  title: string
  start: string
  end: string
  type?: CategoryType
  /** null 表示「未分类」 */
  categoryId?: number | null
  merchant?: string
}

export function matchDrill(t: Transaction, drill: Drill): boolean {
  if (t.date < drill.start || t.date > drill.end) return false
  if (drill.type ? t.type !== drill.type : t.type === 'transfer') return false
  if (drill.categoryId === null && t.categoryId !== undefined) return false
  if (typeof drill.categoryId === 'number' && t.categoryId !== drill.categoryId) return false
  if (drill.merchant !== undefined && merchantOf(t) !== drill.merchant) return false
  return true
}

/** 明细页带筛选条件的链接，例如 #/transactions?month=2026-11&type=expense&category=1 */
export function transactionsHref(month: string, drill: Pick<Drill, 'type' | 'categoryId' | 'merchant'>): string {
  const params = new URLSearchParams({ month })
  if (drill.type) params.set('type', drill.type)
  if (typeof drill.categoryId === 'number') params.set('category', String(drill.categoryId))
  if (drill.merchant) params.set('q', drill.merchant)
  return `#/transactions?${params}`
}

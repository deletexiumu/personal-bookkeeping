import type { Category, CategoryType, Transaction } from '../types'
import { formatCents } from './money'
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

/** 净额带正负号：收入多为 +，支出多为 −；0 不带符号 */
export function formatNet(cents: number): string {
  if (cents === 0) return formatCents(0)
  return `${cents > 0 ? '+' : '−'}${formatCents(Math.abs(cents))}`
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

/** 分析页的口径：只看支出、只看收入，或收支合计 */
export type AnalysisView = CategoryType | 'all'

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

/**
 * 拆分分析页的关键字：空格、逗号、顿号、竖线都可分隔，多个关键字之间是「或」。
 * 用来把同一商户的不同叫法（如「美团」「三快科技」）合在一起统计。
 */
export function parseKeywords(input: string): string[] {
  const words = input
    .toLowerCase()
    .split(/[\s,，、|｜;；]+/)
    .map((w) => w.trim())
    .filter(Boolean)
  return [...new Set(words)]
}

/** 商户或备注包含任一关键字（不区分大小写）；没有关键字时都算匹配 */
export function matchKeywords(t: Transaction, keywords: string[]): boolean {
  if (keywords.length === 0) return true
  const texts = [t.merchant, t.note].filter((s): s is string => !!s).map((s) => s.toLowerCase())
  return keywords.some((k) => texts.some((text) => text.includes(k)))
}

/** 合计视图中一个商户的收支 */
export interface MerchantNet {
  key: string
  name: string
  income: number
  expense: number
  /** 收入 - 支出 */
  net: number
  count: number
}

/** 按商户（没有时按备注）合并收入和支出，按收支总额从大到小；不含转账 */
export function merchantNet(rows: Transaction[]): MerchantNet[] {
  const groups = new Map<string, MerchantNet>()
  for (const t of rows) {
    if (t.type === 'transfer') continue
    const name = merchantOf(t)
    if (!name) continue
    const group = groups.get(name) ?? { key: name, name, income: 0, expense: 0, net: 0, count: 0 }
    group[t.type] += t.amount
    group.net = group.income - group.expense
    group.count++
    groups.set(name, group)
  }
  return [...groups.values()].sort(
    (a, b) => b.income + b.expense - (a.income + a.expense) || b.count - a.count || a.name.localeCompare(b.name, 'zh-CN'),
  )
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
  /** 跳到明细页时带上的搜索词（分析页关键字只有一个时） */
  query?: string
  /** 明细页复现不了这组筛选（如多个关键字），不提供跳转 */
  noLink?: boolean
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
export function transactionsHref(month: string, drill: Pick<Drill, 'type' | 'categoryId' | 'merchant' | 'query'>): string {
  const params = new URLSearchParams({ month })
  if (drill.type) params.set('type', drill.type)
  if (typeof drill.categoryId === 'number') params.set('category', String(drill.categoryId))
  if (drill.merchant) params.set('q', drill.merchant)
  else if (drill.query) params.set('q', drill.query)
  return `#/transactions?${params}`
}

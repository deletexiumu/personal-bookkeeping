import type { Category, CategoryType, Plan, Transaction } from '../types'
import type { Bucket } from './period'
import { planTotals, type PlanOccurrence, type PlanTotals } from './plans'
import { statType } from './stats'
import { normalizeText } from './import/similarity'

/**
 * 分析页「预算对比」口径：区间里预算账单的计划与实际收支对比。
 * - 计划：区间内各期的计划金额（跳过的不算）
 * - 实际：区间内全部实际收支（与其他口径一致）；其中关联了预算的为「预算内」，其余为「预算外」
 */

export interface PlanSide extends PlanTotals {
  /** 区间内实际收支合计 */
  actualAll: number
  /** 其中关联了预算的 */
  inPlan: number
  /** 没有关联预算的 */
  outPlan: number
}

export interface CategoryCompare {
  key: string
  categoryId?: number
  name: string
  planned: number
  actual: number
  /** 计划里还没到期（待发生）的部分，比差额时不算 */
  pending?: number
  /** 实际笔数（预算外排行用） */
  count?: number
}

export interface PlanRow {
  plan: Plan
  /** 区间内的期数（不含跳过） */
  count: number
  done: number
  overdue: number
  skipped: number
  planned: number
  /** 已实现各期的实际合计 */
  actual: number
  /** 已实现各期的计划合计，和 actual 比差额 */
  donePlanned: number
}

export interface PlanPoint extends Bucket {
  planned: number
  actual: number
}

export function planSide(occurrences: PlanOccurrence[], rows: Transaction[], type: CategoryType): PlanSide {
  const totals = planTotals(occurrences, type)
  let actualAll = 0
  let inPlan = 0
  for (const t of rows) {
    if (statType(t) !== type) continue
    actualAll += t.amount
    if (t.planRef) inPlan += t.amount
  }
  return { ...totals, actualAll, inPlan, outPlan: actualAll - inPlan }
}

/**
 * 按分类对比：有预算的分类列出计划与该分类的全部实际，按差额（实际减到期的计划，绝对值）从大到小；
 * 没有指定分类的预算归入「未指定分类」，实际取对上这些预算的流水。
 */
export function categoryCompare(occurrences: PlanOccurrence[], rows: Transaction[], categories: Category[], type: CategoryType): CategoryCompare[] {
  const planned = new Map<string, CategoryCompare>()
  const names = new Map(categories.map((c) => [c.id, c.name]))
  for (const o of occurrences) {
    if (o.plan.type !== type || o.status === 'skipped') continue
    const id = o.plan.categoryId
    const key = id === undefined ? 'none' : String(id)
    const item = planned.get(key) ?? { key, categoryId: id, name: id === undefined ? '未指定分类' : (names.get(id) ?? '已删除的分类'), planned: 0, actual: 0, pending: 0 }
    item.planned += o.amount
    if (o.status === 'pending') item.pending = (item.pending ?? 0) + o.amount
    planned.set(key, item)
  }
  for (const t of rows) {
    if (statType(t) !== type || t.categoryId === undefined) continue
    const item = planned.get(String(t.categoryId))
    if (item) item.actual += t.amount
  }
  // 没指定分类的预算：实际取对上它们的流水
  const none = planned.get('none')
  if (none) {
    for (const o of occurrences) if (o.plan.type === type && o.plan.categoryId === undefined && o.status === 'done') none.actual += o.actual
  }
  return [...planned.values()].sort((a, b) => Math.abs(compareDiff(b)) - Math.abs(compareDiff(a)) || b.planned - a.planned)
}

/** 实际减到期了的计划（不算还没到期的） */
export function compareDiff(c: Pick<CategoryCompare, 'actual' | 'planned' | 'pending'>): number {
  return c.actual - (c.planned - (c.pending ?? 0))
}

/** 预算外的实际收支按分类汇总，从大到小 */
export function unplannedByCategory(rows: Transaction[], categories: Category[], type: CategoryType): CategoryCompare[] {
  const names = new Map(categories.map((c) => [c.id, c.name]))
  const groups = new Map<string, CategoryCompare>()
  for (const t of rows) {
    if (statType(t) !== type || t.planRef) continue
    const key = t.categoryId === undefined ? 'none' : String(t.categoryId)
    const item = groups.get(key) ?? { key, categoryId: t.categoryId, name: t.categoryId === undefined ? '未分类' : (names.get(t.categoryId) ?? '已删除的分类'), planned: 0, actual: 0, count: 0 }
    item.actual += t.amount
    item.count = (item.count ?? 0) + 1
    groups.set(key, item)
  }
  return [...groups.values()].sort((a, b) => b.actual - a.actual)
}

/** 按预算账单汇总区间内的各期，支出在前、按计划金额从大到小 */
export function planRows(occurrences: PlanOccurrence[]): PlanRow[] {
  const byPlan = new Map<string, PlanRow>()
  for (const o of occurrences) {
    const key = o.plan.uid ?? String(o.plan.id)
    const row = byPlan.get(key) ?? { plan: o.plan, count: 0, done: 0, overdue: 0, skipped: 0, planned: 0, actual: 0, donePlanned: 0 }
    if (o.status === 'skipped') row.skipped++
    else {
      row.count++
      row.planned += o.amount
      if (o.status === 'done') {
        row.done++
        row.actual += o.actual
        row.donePlanned += o.amount
      } else if (o.status === 'overdue') row.overdue++
    }
    byPlan.set(key, row)
  }
  return [...byPlan.values()].sort((a, b) => (a.plan.type === b.plan.type ? b.planned - a.planned : a.plan.type === 'expense' ? -1 : 1))
}

/** 每根柱子的计划与实际（某个方向） */
export function planSeries(occurrences: PlanOccurrence[], rows: Transaction[], buckets: Bucket[], type: CategoryType): PlanPoint[] {
  const points = buckets.map((b) => ({ ...b, planned: 0, actual: 0 }))
  const at = (date: string) => points.find((p) => date >= p.start && date <= p.end)
  for (const o of occurrences) {
    if (o.plan.type !== type || o.status === 'skipped') continue
    const p = at(o.date)
    if (p) p.planned += o.amount
  }
  for (const t of rows) {
    if (statType(t) !== type) continue
    const p = at(t.date)
    if (p) p.actual += t.amount
  }
  return points
}

/** 分析页的关键字 / 标签筛选作用到预算上：名称、关键字或备注包含任一关键字；标签看预算自己的标签 */
export function matchPlanFilter(plan: Plan, keywords: string[], tag: string | undefined, untagged: string): boolean {
  if (keywords.length > 0) {
    const text = normalizeText([plan.name, plan.note, ...(plan.keywords ?? [])].join(' '))
    if (!keywords.some((k) => text.includes(normalizeText(k)))) return false
  }
  if (tag === undefined) return true
  if (tag === untagged) return !plan.tags?.length
  return !!plan.tags?.includes(tag)
}

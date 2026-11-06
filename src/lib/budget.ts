import type { Budget, Transaction } from '../types'
import { statType } from './stats'

export type BudgetLevel = 'ok' | 'warning' | 'over'

export interface BudgetStatus {
  amount: number
  spent: number
  /** 剩余（分），超支时为负 */
  remaining: number
  /** 已用比例，0–∞ */
  ratio: number
  /** > 80% 预警，> 100% 超支（设计文档 M01） */
  level: BudgetLevel
}

export function budgetStatus(amount: number, spent: number): BudgetStatus {
  const ratio = amount > 0 ? spent / amount : 0
  const level: BudgetLevel = ratio > 1 ? 'over' : ratio > 0.8 ? 'warning' : 'ok'
  return { amount, spent, remaining: amount - spent, ratio, level }
}

/** 本月支出：总支出与按分类的支出 */
export function expenseByCategory(rows: Transaction[]): { total: number; byCategory: Map<number, number> } {
  let total = 0
  const byCategory = new Map<number, number>()
  for (const t of rows) {
    if (statType(t) !== 'expense') continue
    total += t.amount
    if (t.categoryId !== undefined) byCategory.set(t.categoryId, (byCategory.get(t.categoryId) ?? 0) + t.amount)
  }
  return { total, byCategory }
}

export interface MonthBudgets {
  total?: BudgetStatus
  categories: (BudgetStatus & { categoryId: number })[]
}

/** 汇总某月预算执行情况；分类预算按已用比例从高到低排（超支置顶） */
export function monthBudgets(budgets: Budget[], rows: Transaction[]): MonthBudgets {
  const spent = expenseByCategory(rows)
  const totalBudget = budgets.find((b) => b.categoryId === undefined)
  const categories = budgets
    .filter((b): b is Budget & { categoryId: number } => b.categoryId !== undefined)
    .map((b) => ({ categoryId: b.categoryId, ...budgetStatus(b.amount, spent.byCategory.get(b.categoryId) ?? 0) }))
    .sort((a, b) => b.ratio - a.ratio)
  return { total: totalBudget && budgetStatus(totalBudget.amount, spent.total), categories }
}

/** 某月剩余天数（含今天）；过去的月份为 0，未来的月份为整月天数 */
export function daysLeftInMonth(month: string, todayDate: string): number {
  const [y, m] = month.split('-').map(Number)
  const days = new Date(y, m, 0).getDate()
  const current = todayDate.slice(0, 7)
  if (month < current) return 0
  if (month > current) return days
  return days - Number(todayDate.slice(8, 10)) + 1
}

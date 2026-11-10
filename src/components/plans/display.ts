import { formatCents } from '../../lib/money'
import type { PlanOccurrence, PlanStatus } from '../../lib/plans'
import type { BadgeTone } from '../ui/Badge'

export const STATUS_TONE: Record<PlanStatus, BadgeTone> = { done: 'income', skipped: 'neutral', overdue: 'warning', pending: 'brand' }

/** 实际减计划的差额文字：「多 50.00」「少 20.00」「持平」 */
export function diffText(o: Pick<PlanOccurrence, 'actual' | 'amount'>): string {
  const d = o.actual - o.amount
  if (d === 0) return '持平'
  return `${d > 0 ? '多' : '少'} ${formatCents(Math.abs(d))}`
}

/** 日历格子里的简短金额：不带 ¥、千分位和小数，过万用「万」 */
export function compactCents(cents: number): string {
  const yuan = cents / 100
  if (yuan >= 10000) return `${(yuan / 10000).toFixed(yuan >= 100000 ? 0 : 1).replace(/\.0$/, '')}万`
  return String(Math.round(yuan))
}

/** '2026-11-15' -> '11月15日' */
export function dayText(date: string): string {
  return `${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日`
}

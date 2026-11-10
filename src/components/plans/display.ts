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

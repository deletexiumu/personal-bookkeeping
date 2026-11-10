import { CalendarClock } from 'lucide-react'
import { formatCents } from '../../lib/money'
import { planTotals, type PlanOccurrence } from '../../lib/plans'

interface Props {
  /** 这个月的各期预算 */
  occurrences: PlanOccurrence[]
  /** 这个月的实际支出 */
  actualExpense: number
}

/**
 * 明细汇总下面的一行预算账单：本月计划支出、已实现、待发生（含逾期），以及预计月末支出 = 实际支出 + 还没发生的预算支出。
 * 预算不计入上面的实际收支。
 */
export function PlanStrip({ occurrences, actualExpense }: Props) {
  const expense = planTotals(occurrences, 'expense')
  const income = planTotals(occurrences, 'income')
  if (expense.planned + income.planned === 0) return null
  return (
    <a className="card plan-strip t-body-s" href="#/budget?tab=plans" aria-label="本月预算账单">
      <CalendarClock size={18} aria-hidden="true" className="text-brand" />
      <span className="plan-strip-items">
        {expense.planned > 0 && (
          <span>
            预算支出 <strong className="t-num-s">{formatCents(expense.planned)}</strong>
            <span className="text-tertiary">
              {' '}
              · 已实现 {formatCents(expense.actual)} · 待发生 {formatCents(expense.open)}
            </span>
            {expense.overdue > 0 && <span className="text-warning"> · {expense.overdue} 笔逾期</span>}
          </span>
        )}
        {income.planned > 0 && (
          <span>
            预算收入 <strong className="t-num-s">{formatCents(income.planned)}</strong>
            <span className="text-tertiary"> · 待发生 {formatCents(income.open)}</span>
          </span>
        )}
        {expense.open > 0 && (
          <span>
            预计月末支出 <strong className="t-num-s">{formatCents(actualExpense + expense.open)}</strong>
          </span>
        )}
      </span>
    </a>
  )
}

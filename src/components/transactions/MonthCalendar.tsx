import { summarize } from '../../db/transactions'
import { today } from '../../lib/date'
import type { PlanOccurrence } from '../../lib/plans'
import type { Transaction } from '../../types'
import { compactCents } from '../plans/display'

interface Props {
  /** YYYY-MM */
  month: string
  transactions: Transaction[]
  /** 这个月的各期预算（含已实现的） */
  plans: PlanOccurrence[]
  selected?: string
  onSelect: (date: string) => void
}

const WEEK = ['一', '二', '三', '四', '五', '六', '日']

interface Cell {
  date: string
  expense: number
  income: number
  /** 还没发生的预算（待发生 + 逾期）合计，按方向 */
  planExpense: number
  planIncome: number
  overdue: boolean
  done: number
}

/**
 * 明细的日历视图：一周从周一开始，每天显示实际支出 / 收入（实色），以及还没发生的预算（虚线框「预」，逾期为橙色）。
 * 已实现的预算只在右上角打个勾，它的金额已经算在实际里。点某天在下方列出当天的流水和预算。
 */
export function MonthCalendar({ month, transactions, plans, selected, onSelect }: Props) {
  const [y, m] = month.split('-').map(Number)
  const days = new Date(y, m, 0).getDate()
  const lead = (new Date(y, m - 1, 1).getDay() + 6) % 7
  const todayDate = today()
  const cells: Cell[] = Array.from({ length: days }, (_, i) => {
    const date = `${month}-${String(i + 1).padStart(2, '0')}`
    const s = summarize(transactions.filter((t) => t.date === date))
    const cell: Cell = { date, expense: s.expense, income: s.income, planExpense: 0, planIncome: 0, overdue: false, done: 0 }
    for (const o of plans) {
      if (o.date !== date || o.status === 'skipped') continue
      if (o.status === 'done') cell.done++
      else {
        if (o.plan.type === 'income') cell.planIncome += o.amount
        else cell.planExpense += o.amount
        if (o.status === 'overdue') cell.overdue = true
      }
    }
    return cell
  })

  return (
    <div className="card month-calendar" role="grid" aria-label={`${y}年${m}月日历`}>
      <div className="cal-week t-caption text-tertiary" role="row">
        {WEEK.map((w) => (
          <span key={w} role="columnheader">
            {w}
          </span>
        ))}
      </div>
      <div className="cal-days" role="rowgroup">
        {Array.from({ length: lead }, (_, i) => (
          <span key={`lead-${i}`} className="cal-day cal-day-empty" aria-hidden="true" />
        ))}
        {cells.map((c) => {
          const day = Number(c.date.slice(8))
          const parts = [
            c.expense > 0 && `支出 ${compactCents(c.expense)}`,
            c.income > 0 && `收入 ${compactCents(c.income)}`,
            c.planExpense > 0 && `预算支出 ${compactCents(c.planExpense)}`,
            c.planIncome > 0 && `预算收入 ${compactCents(c.planIncome)}`,
            c.overdue && '有逾期预算',
            c.done > 0 && `${c.done} 笔预算已实现`,
          ].filter(Boolean)
          return (
            <button
              key={c.date}
              type="button"
              role="gridcell"
              className="cal-day"
              aria-selected={selected === c.date}
              data-today={c.date === todayDate || undefined}
              aria-label={`${m}月${day}日${parts.length ? `，${parts.join('，')}` : ''}`}
              onClick={() => onSelect(c.date)}
            >
              <span className="cal-day-num t-caption">
                {day}
                {c.done > 0 && <span className="cal-done" aria-hidden="true">✓</span>}
              </span>
              {c.expense > 0 && <span className="cal-amount amount-expense t-num-s">-{compactCents(c.expense)}</span>}
              {c.income > 0 && <span className="cal-amount amount-income t-num-s">+{compactCents(c.income)}</span>}
              {c.planExpense + c.planIncome > 0 && (
                <span className={`cal-plan t-num-s ${c.overdue ? 'is-overdue' : ''}`}>
                  <span className="cal-plan-prefix">预 </span>
                  {c.planIncome > 0 && c.planExpense === 0 ? '+' : ''}
                  {compactCents(c.planExpense || c.planIncome)}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

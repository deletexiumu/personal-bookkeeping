import type { MonthSummary } from '../db/transactions'
import { formatCents } from '../lib/money'

export function MonthSummaryCard({ summary }: { summary: MonthSummary }) {
  return (
    <section className="card summary" aria-label="本月汇总">
      <div>
        <span className="label">收入</span>
        <strong className="income">{formatCents(summary.income)}</strong>
      </div>
      <div>
        <span className="label">支出</span>
        <strong className="expense">{formatCents(summary.expense)}</strong>
      </div>
      <div>
        <span className="label">结余</span>
        <strong>{formatCents(summary.balance)}</strong>
      </div>
    </section>
  )
}

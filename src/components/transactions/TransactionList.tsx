import { groupByDay, type DayGroup } from '../../db/transactions'
import { formatDayLabel } from '../../lib/date'
import { formatCents } from '../../lib/money'
import type { PlanOccurrence } from '../../lib/plans'
import type { Transaction } from '../../types'
import { PlanListRow } from '../plans/PlanRows'
import type { Lookup } from './display'
import { TransactionRow } from './TransactionRow'

interface Props {
  transactions: Transaction[]
  lookup: Lookup
  onOpen: (t: Transaction) => void
  onDelete: (t: Transaction) => void
  /** 还没发生的预算（待发生、逾期），排在当天的实际流水前面，不计入当天小计 */
  plans?: PlanOccurrence[]
  onOpenPlan?: (o: PlanOccurrence) => void
}

/** 明细列表（移动端 / 窄窗口）：按天分组，组标题显示当天支出 / 收入小计 */
export function TransactionList({ transactions, lookup, onOpen, onDelete, plans = [], onOpenPlan }: Props) {
  const groups = new Map(groupByDay(transactions).map((g) => [g.date, g]))
  const plansByDate = new Map<string, PlanOccurrence[]>()
  for (const o of plans) plansByDate.set(o.date, [...(plansByDate.get(o.date) ?? []), o])
  const dates = [...new Set([...groups.keys(), ...plansByDate.keys()])].sort().reverse()
  const empty = (date: string): DayGroup => ({ date, items: [], income: 0, expense: 0, balance: 0 })
  return (
    <div className="day-groups" aria-label="收支明细">
      {dates.map((date) => {
        const group = groups.get(date) ?? empty(date)
        const dayPlans = plansByDate.get(date) ?? []
        return (
          <section key={date} className="day-group" aria-label={formatDayLabel(date)}>
            <header className="day-header t-caption text-secondary">
              <span>{formatDayLabel(date)}</span>
              <span className="t-num-s">
                {group.expense > 0 && `支出 ${formatCents(group.expense)}`}
                {group.expense > 0 && group.income > 0 && '　'}
                {group.income > 0 && `收入 ${formatCents(group.income)}`}
              </span>
            </header>
            <ul className="card tx-list">
              {dayPlans.map((o) => (
                <PlanListRow key={o.ref} occurrence={o} lookup={lookup} onOpen={(x) => onOpenPlan?.(x)} />
              ))}
              {group.items.map((t) => (
                <TransactionRow key={t.id} transaction={t} lookup={lookup} onOpen={onOpen} onDelete={onDelete} />
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}

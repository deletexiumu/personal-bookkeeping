import { groupByDay } from '../../db/transactions'
import { formatDayLabel } from '../../lib/date'
import { formatCents } from '../../lib/money'
import type { Transaction } from '../../types'
import type { Lookup } from './display'
import { TransactionRow } from './TransactionRow'

interface Props {
  transactions: Transaction[]
  lookup: Lookup
  onOpen: (t: Transaction) => void
  onDelete: (t: Transaction) => void
}

/** 明细列表（移动端 / 窄窗口）：按天分组，组标题显示当天支出 / 收入小计 */
export function TransactionList({ transactions, lookup, onOpen, onDelete }: Props) {
  return (
    <div className="day-groups" aria-label="收支明细">
      {groupByDay(transactions).map((group) => (
        <section key={group.date} className="day-group" aria-label={formatDayLabel(group.date)}>
          <header className="day-header t-caption text-secondary">
            <span>{formatDayLabel(group.date)}</span>
            <span className="t-num-s">
              {group.expense > 0 && `支出 ${formatCents(group.expense)}`}
              {group.expense > 0 && group.income > 0 && '　'}
              {group.income > 0 && `收入 ${formatCents(group.income)}`}
            </span>
          </header>
          <ul className="card tx-list">
            {group.items.map((t) => (
              <TransactionRow key={t.id} transaction={t} lookup={lookup} onOpen={onOpen} onDelete={onDelete} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

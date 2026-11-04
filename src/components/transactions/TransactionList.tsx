import { NotebookPen } from 'lucide-react'
import { groupByDay } from '../../db/transactions'
import { formatDayLabel } from '../../lib/date'
import { formatCents } from '../../lib/money'
import type { Account, Category, Transaction } from '../../types'
import { Button } from '../ui/Button'
import { TransactionRow } from './TransactionRow'

interface Props {
  transactions: Transaction[]
  categories: Category[]
  accounts: Account[]
  onDelete: (t: Transaction) => void
  onQuickAdd: () => void
}

/** 明细列表：按天分组，组标题显示当天支出 / 收入小计 */
export function TransactionList({ transactions, categories, accounts, onDelete, onQuickAdd }: Props) {
  if (transactions.length === 0) {
    return (
      <div className="empty-state">
        <NotebookPen size={40} aria-hidden="true" />
        <p className="t-body-m text-secondary">这个月还没有记录，记下第一笔吧。</p>
        <Button variant="primary" onClick={onQuickAdd}>
          记一笔
        </Button>
      </div>
    )
  }
  const categoryById = new Map(categories.map((c) => [c.id, c]))
  const accountById = new Map(accounts.map((a) => [a.id, a]))

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
              <TransactionRow
                key={t.id}
                transaction={t}
                category={categoryById.get(t.categoryId)}
                account={accountById.get(t.accountId)}
                onDelete={onDelete}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

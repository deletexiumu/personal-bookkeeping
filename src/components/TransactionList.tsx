import { db } from '../db'
import { deleteTransaction } from '../db/transactions'
import { formatCents } from '../lib/money'
import type { Account, Category, Transaction } from '../types'

interface Props {
  transactions: Transaction[]
  categories: Category[]
  accounts: Account[]
}

export function TransactionList({ transactions, categories, accounts }: Props) {
  if (transactions.length === 0) {
    return <p className="empty">这个月还没有记录，记下第一笔吧。</p>
  }
  const categoryName = new Map(categories.map((c) => [c.id, c.name]))
  const accountName = new Map(accounts.map((a) => [a.id, a.name]))

  return (
    <ul className="card list" aria-label="收支明细">
      {transactions.map((t) => (
        <li key={t.id}>
          <div className="meta">
            <strong>{categoryName.get(t.categoryId) ?? '未分类'}</strong>
            <span>
              {t.date} · {accountName.get(t.accountId) ?? '未知账户'}
              {t.note ? ` · ${t.note}` : ''}
            </span>
          </div>
          <span className={t.type}>
            {t.type === 'expense' ? '-' : '+'}
            {formatCents(t.amount)}
          </span>
          <button
            type="button"
            className="link"
            aria-label="删除这条记录"
            onClick={() => {
              if (t.id !== undefined && confirm('确定删除这条记录吗？')) void deleteTransaction(db, t.id)
            }}
          >
            删除
          </button>
        </li>
      ))}
    </ul>
  )
}

import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { PageHeader } from '../components/layout/AppShell'
import { MonthSummary } from '../components/transactions/MonthSummary'
import { MonthSwitcher } from '../components/transactions/MonthSwitcher'
import { TransactionList } from '../components/transactions/TransactionList'
import { db } from '../db'
import { deleteTransaction, listByMonth, summarize } from '../db/transactions'
import { monthOf, today } from '../lib/date'
import type { Account, Category, Transaction } from '../types'

interface Props {
  categories: Category[]
  accounts: Account[]
  onQuickAdd: () => void
}

/** 明细页（M01 / D01）：月份切换、本月汇总、按天分组的流水 */
export function TransactionsPage({ categories, accounts, onQuickAdd }: Props) {
  const [month, setMonth] = useState(() => monthOf(today()))
  const transactions = useLiveQuery(() => listByMonth(db, month), [month], [])

  function handleDelete(t: Transaction) {
    if (t.id !== undefined && confirm('确定删除这条记录吗？')) void deleteTransaction(db, t.id)
  }

  return (
    <div className="page">
      <PageHeader title="明细" actions={<MonthSwitcher month={month} onChange={setMonth} />} />
      <MonthSummary summary={summarize(transactions)} />
      <TransactionList
        transactions={transactions}
        categories={categories}
        accounts={accounts}
        onDelete={handleDelete}
        onQuickAdd={onQuickAdd}
      />
    </div>
  )
}

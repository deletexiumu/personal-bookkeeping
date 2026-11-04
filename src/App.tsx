import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { MonthSummaryCard } from './components/MonthSummaryCard'
import { TransactionForm } from './components/TransactionForm'
import { TransactionList } from './components/TransactionList'
import { db } from './db'
import { listByMonth, summarize } from './db/transactions'
import { monthOf, today } from './lib/date'

export default function App() {
  const [month, setMonth] = useState(() => monthOf(today()))
  const categories = useLiveQuery(() => db.categories.toArray(), [], [])
  const accounts = useLiveQuery(() => db.accounts.toArray(), [], [])
  const transactions = useLiveQuery(() => listByMonth(db, month), [month], [])

  return (
    <main className="app">
      <header className="app-header">
        <h1>陶朱簿</h1>
        <input
          type="month"
          aria-label="选择月份"
          value={month}
          onChange={(e) => e.target.value && setMonth(e.target.value)}
        />
      </header>
      <MonthSummaryCard summary={summarize(transactions)} />
      <TransactionForm categories={categories} accounts={accounts} />
      <TransactionList transactions={transactions} categories={categories} accounts={accounts} />
    </main>
  )
}

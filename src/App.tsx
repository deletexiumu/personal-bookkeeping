import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useState } from 'react'
import { useRoute } from './app/router'
import { useHotkey } from './app/useHotkey'
import { AppShell } from './components/layout/AppShell'
import { TransactionForm } from './components/transactions/TransactionForm'
import { Dialog } from './components/ui/Dialog'
import { db } from './db'
import { PlaceholderPage } from './pages/PlaceholderPage'
import { SettingsPage } from './pages/SettingsPage'
import { TransactionsPage } from './pages/TransactionsPage'

export default function App() {
  const route = useRoute()
  const [quickAddOpen, setQuickAddOpen] = useState(false)
  const categories = useLiveQuery(() => db.categories.toArray(), [], [])
  const accounts = useLiveQuery(() => db.accounts.toArray(), [], [])

  const openQuickAdd = useCallback(() => setQuickAddOpen(true), [])
  const closeQuickAdd = useCallback(() => setQuickAddOpen(false), [])
  useHotkey('n', openQuickAdd, !quickAddOpen)

  let page
  if (route === 'transactions') {
    page = <TransactionsPage categories={categories} accounts={accounts} onQuickAdd={openQuickAdd} />
  } else if (route === 'settings') {
    page = <SettingsPage />
  } else {
    page = <PlaceholderPage route={route} />
  }

  return (
    <AppShell route={route} onQuickAdd={openQuickAdd}>
      {page}
      <Dialog open={quickAddOpen} title="记一笔" onClose={closeQuickAdd}>
        <TransactionForm categories={categories} accounts={accounts} onDone={closeQuickAdd} />
      </Dialog>
    </AppShell>
  )
}

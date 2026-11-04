import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useMemo, useState } from 'react'
import { usePwaUpdatePrompt } from './app/pwa'
import { useRoute } from './app/router'
import { useHotkey } from './app/useHotkey'
import { AppShell } from './components/layout/AppShell'
import { TransactionForm } from './components/transactions/TransactionForm'
import { Dialog } from './components/ui/Dialog'
import { ToastProvider } from './components/ui/Toast'
import { db } from './db'
import { listAccounts, listCategories } from './db/catalog'
import { AccountsPage } from './pages/AccountsPage'
import { AnalysisPage } from './pages/AnalysisPage'
import { BudgetPage } from './pages/BudgetPage'
import { CategoriesPage } from './pages/CategoriesPage'
import { ImportPage } from './pages/ImportPage'
import { PlaceholderPage } from './pages/PlaceholderPage'
import { RulesPage } from './pages/RulesPage'
import { SettingsPage } from './pages/SettingsPage'
import { TransactionsPage } from './pages/TransactionsPage'

export default function App() {
  const route = useRoute()
  const [quickAddOpen, setQuickAddOpen] = useState(false)
  const categories = useLiveQuery(() => listCategories(db), [], [])
  const accounts = useLiveQuery(() => listAccounts(db), [], [])
  // 记一笔只提供未归档的分类和账户；明细和详情仍用全部，以显示历史记录
  const activeCategories = useMemo(() => categories.filter((c) => !c.archived), [categories])
  const activeAccounts = useMemo(() => accounts.filter((a) => !a.archived), [accounts])

  const openQuickAdd = useCallback(() => setQuickAddOpen(true), [])
  const closeQuickAdd = useCallback(() => setQuickAddOpen(false), [])
  useHotkey('n', openQuickAdd, !quickAddOpen)

  let page
  if (route === 'transactions') {
    page = <TransactionsPage categories={categories} accounts={accounts} onQuickAdd={openQuickAdd} />
  } else if (route === 'analysis') {
    page = <AnalysisPage categories={categories} accounts={accounts} />
  } else if (route === 'accounts') {
    page = <AccountsPage accounts={accounts} />
  } else if (route === 'budget') {
    page = <BudgetPage categories={categories} />
  } else if (route === 'categories') {
    page = <CategoriesPage categories={categories} />
  } else if (route === 'import') {
    page = <ImportPage categories={activeCategories} accounts={activeAccounts} />
  } else if (route === 'rules') {
    page = <RulesPage categories={categories} />
  } else if (route === 'settings') {
    page = <SettingsPage />
  } else {
    page = <PlaceholderPage route={route} />
  }

  return (
    <ToastProvider>
      <PwaUpdatePrompt />
      <AppShell route={route} onQuickAdd={openQuickAdd}>
      {page}
      <Dialog open={quickAddOpen} title="记一笔" onClose={closeQuickAdd}>
        <TransactionForm categories={activeCategories} accounts={activeAccounts} onDone={closeQuickAdd} />
        </Dialog>
      </AppShell>
    </ToastProvider>
  )
}

/** 在 ToastProvider 里订阅 Service Worker 的更新通知 */
function PwaUpdatePrompt() {
  usePwaUpdatePrompt()
  return null
}

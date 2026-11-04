import { useLiveQuery } from 'dexie-react-hooks'
import { NotebookPen, SearchX } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useMediaQuery, WIDE_QUERY } from '../app/useMediaQuery'
import { PageHeader } from '../components/layout/AppShell'
import { makeLookup, signedAmount, titleOf } from '../components/transactions/display'
import { FilterBar } from '../components/transactions/FilterBar'
import { MonthSummary } from '../components/transactions/MonthSummary'
import { MonthSwitcher } from '../components/transactions/MonthSwitcher'
import { TransactionDetail } from '../components/transactions/TransactionDetail'
import { TransactionList } from '../components/transactions/TransactionList'
import { TransactionTable } from '../components/transactions/TransactionTable'
import { Button } from '../components/ui/Button'
import { Dialog } from '../components/ui/Dialog'
import { useToast } from '../components/ui/toast-context'
import { db } from '../db'
import { deleteTransaction, listByMonth, restoreTransactions, summarize } from '../db/transactions'
import { monthOf, today } from '../lib/date'
import { filterTransactions, isFilterEmpty, type TransactionFilter } from '../lib/filter'
import type { Account, Category, Transaction } from '../types'

interface Props {
  categories: Category[]
  accounts: Account[]
  onQuickAdd: () => void
}

/**
 * 明细页（M01 / D01）：月份切换、本月汇总、搜索筛选、流水列表。
 * 宽屏（≥ 1280）用表格 + 右侧详情面板，其余宽度用按天分组的列表 + 详情弹窗。
 */
export function TransactionsPage({ categories, accounts, onQuickAdd }: Props) {
  const toast = useToast()
  const wide = useMediaQuery(WIDE_QUERY)
  const [month, setMonth] = useState(() => monthOf(today()))
  const [filter, setFilter] = useState<TransactionFilter>({})
  const [selectedId, setSelectedId] = useState<number>()
  const transactions = useLiveQuery(() => listByMonth(db, month), [month], [])
  const lookup = useMemo(() => makeLookup(categories, accounts), [categories, accounts])
  const visible = useMemo(
    () => filterTransactions(transactions, filter, categories),
    [transactions, filter, categories],
  )
  const selected = transactions.find((t) => t.id === selectedId)
  const closeDetail = useCallback(() => setSelectedId(undefined), [])

  const handleDelete = useCallback(
    async (t: Transaction) => {
      if (t.id === undefined) return
      await deleteTransaction(db, t.id)
      setSelectedId((id) => (id === t.id ? undefined : id))
      toast.show({
        message: `已删除 ${titleOf(t, lookup)} ${signedAmount(t)}`,
        action: { label: '撤销', onClick: () => void restoreTransactions(db, [t]) },
      })
    },
    [lookup, toast],
  )

  const open = (t: Transaction) => setSelectedId(t.id)
  const onDelete = (t: Transaction) => void handleDelete(t)

  let body
  if (transactions.length === 0) {
    body = (
      <div className="empty-state">
        <NotebookPen size={40} aria-hidden="true" />
        <p className="t-body-m text-secondary">这个月还没有记录，记下第一笔吧。</p>
        <Button variant="primary" onClick={onQuickAdd}>
          记一笔
        </Button>
      </div>
    )
  } else if (visible.length === 0) {
    body = (
      <div className="empty-state">
        <SearchX size={40} aria-hidden="true" />
        <p className="t-body-m text-secondary">没有符合条件的记录</p>
        <Button onClick={() => setFilter({})}>清除筛选</Button>
      </div>
    )
  } else if (wide) {
    body = <TransactionTable transactions={visible} lookup={lookup} selectedId={selectedId} onOpen={open} />
  } else {
    body = <TransactionList transactions={visible} lookup={lookup} onOpen={open} onDelete={onDelete} />
  }

  const detailProps = selected && {
    transaction: selected,
    categories,
    accounts,
    lookup,
    onClose: closeDetail,
    onDelete,
  }

  return (
    <div className={`page ${wide && selected ? 'page-with-panel' : ''}`}>
      <div className="page-main">
        <PageHeader title="明细" actions={<MonthSwitcher month={month} onChange={setMonth} />} />
        <MonthSummary summary={summarize(isFilterEmpty(filter) ? transactions : visible)} filtered={!isFilterEmpty(filter)} />
        {transactions.length > 0 && (
          <FilterBar
            filter={filter}
            onChange={setFilter}
            categories={categories}
            accounts={accounts}
            count={visible.length}
          />
        )}
        {body}
      </div>
      {detailProps && wide && (
        <aside className="detail-panel card" aria-label="流水详情面板">
          <TransactionDetail key={selected.id} {...detailProps} variant="panel" />
        </aside>
      )}
      {detailProps && !wide && (
        <Dialog open title="流水详情" onClose={closeDetail}>
          <TransactionDetail key={selected.id} {...detailProps} variant="dialog" />
        </Dialog>
      )}
    </div>
  )
}

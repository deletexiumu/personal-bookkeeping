import { useLiveQuery } from 'dexie-react-hooks'
import { NotebookPen, SearchX } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useMediaQuery, WIDE_QUERY } from '../app/useMediaQuery'
import { PageHeader } from '../components/layout/AppShell'
import { makeLookup, signedAmount, titleOf } from '../components/transactions/display'
import { FilterBar } from '../components/transactions/FilterBar'
import { MonthSummary } from '../components/transactions/MonthSummary'
import { MonthSwitcher, type ListUnit } from '../components/transactions/MonthSwitcher'
import { TransactionDetail } from '../components/transactions/TransactionDetail'
import { TransactionList } from '../components/transactions/TransactionList'
import { TransactionTable } from '../components/transactions/TransactionTable'
import { useTags } from '../components/tags/useTags'
import { Button } from '../components/ui/Button'
import { Dialog } from '../components/ui/Dialog'
import { useToast } from '../components/ui/toast-context'
import { db } from '../db'
import { listBudgets } from '../db/budgets'
import { deleteTransaction, listByRange, restoreTransactions, summarize } from '../db/transactions'
import { daysLeftInMonth, monthBudgets } from '../lib/budget'
import { useAssistantPage } from '../lib/ai/context'
import { transactionsPageData } from '../lib/ai/pages'
import { formatMonth, monthOf, today } from '../lib/date'
import { withEffectiveTags } from '../lib/tags'
import { filterTransactions, isFilterEmpty, parseTransactionsHash, type TransactionFilter } from '../lib/filter'
import type { Account, Category, Transaction } from '../types'

interface Props {
  categories: Category[]
  accounts: Account[]
  onQuickAdd: () => void
}

/**
 * 明细页（M01 / D01）：月份切换（可切到按年看整年）、本月 / 本年汇总、搜索筛选、流水列表。
 * 宽屏（≥ 1280）用表格 + 右侧详情面板，其余宽度用按天分组的列表 + 详情弹窗。
 */
export function TransactionsPage({ categories, accounts, onQuickAdd }: Props) {
  const toast = useToast()
  const wide = useMediaQuery(WIDE_QUERY)
  // 从分析页下钻过来时，链接里带着月份和筛选条件
  const [initial] = useState(() => parseTransactionsHash(window.location.hash))
  // 按年查看时 month 仍记着一个月份（今年为本月，其余年份为 1 月），切回按月时回到这个月
  const [unit, setUnit] = useState<ListUnit>(() => (initial.year && !initial.month ? 'year' : 'month'))
  const [month, setMonth] = useState(() => {
    if (initial.month) return initial.month
    const current = monthOf(today())
    if (initial.year && initial.year !== current.slice(0, 4)) return `${initial.year}-01`
    return current
  })
  const [filter, setFilter] = useState<TransactionFilter>(initial.filter)
  const [selectedId, setSelectedId] = useState<number>()
  const byYear = unit === 'year'
  const year = month.slice(0, 4)
  const [start, end] = byYear ? [`${year}-01-01`, `${year}-12-31`] : [`${month}-01`, `${month}-31`]
  const transactions = useLiveQuery(() => listByRange(db, start, end), [start, end], [])
  const budgets = useLiveQuery(() => listBudgets(db), [], [])
  // 预算按月，按年查看时不显示
  const totalBudget = useMemo(
    () => (byYear ? undefined : monthBudgets(budgets, transactions).total),
    [byYear, budgets, transactions],
  )
  const { tags, resolve } = useTags()
  const lookup = useMemo(() => makeLookup(categories, accounts, resolve), [categories, accounts, resolve])
  const visible = useMemo(
    () => filterTransactions(transactions, filter, categories, resolve),
    [transactions, filter, categories, resolve],
  )
  const tagNames = useMemo(() => tags.map((t) => t.name), [tags])
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

  const filtered = !isFilterEmpty(filter)
  useAssistantPage(`明细 · ${byYear ? `${year}年` : formatMonth(month)}${filtered ? ' · 已筛选' : ''}`, () =>
    transactionsPageData({
      scope: byYear ? year : month,
      filter,
      summary: summarize(filtered ? visible : transactions),
      totalCount: transactions.length,
      visible: withEffectiveTags(visible, resolve),
      categories,
      accounts,
      budget: filtered ? undefined : totalBudget?.amount,
    }),
  )

  const open = (t: Transaction) => setSelectedId(t.id)
  const onDelete = (t: Transaction) => void handleDelete(t)

  let body
  if (transactions.length === 0) {
    body = (
      <div className="empty-state">
        <NotebookPen size={40} aria-hidden="true" />
        <p className="t-body-m text-secondary">{byYear ? '这一年' : '这个月'}还没有记录，记下第一笔吧。</p>
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
        <PageHeader
          title="明细"
          actions={<MonthSwitcher month={month} onChange={setMonth} unit={unit} onUnitChange={setUnit} />}
        />
        <MonthSummary
          summary={summarize(isFilterEmpty(filter) ? transactions : visible)}
          filtered={!isFilterEmpty(filter)}
          byYear={byYear}
          budget={isFilterEmpty(filter) ? totalBudget : undefined}
          daysLeft={byYear ? undefined : daysLeftInMonth(month, today())}
        />
        {transactions.length > 0 && (
          <FilterBar
            filter={filter}
            onChange={setFilter}
            categories={categories}
            accounts={accounts}
            tags={tagNames}
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

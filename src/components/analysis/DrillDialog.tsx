import { ArrowLeft, ExternalLink } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { db } from '../../db'
import { deleteTransaction, restoreTransactions, summarize } from '../../db/transactions'
import { matchDrill, transactionsHref, type Drill } from '../../lib/analysis'
import { formatCents } from '../../lib/money'
import { monthOfPeriod } from '../../lib/period'
import type { Account, Category, Transaction } from '../../types'
import { signedAmount, titleOf, type Lookup } from '../transactions/display'
import { TransactionDetail } from '../transactions/TransactionDetail'
import { TransactionList } from '../transactions/TransactionList'
import { Button } from '../ui/Button'
import { Dialog } from '../ui/Dialog'
import { useToast } from '../ui/toast-context'

interface Props {
  drill: Drill
  /** 当前区间的全部流水，从中筛出下钻的部分 */
  rows: Transaction[]
  categories: Category[]
  accounts: Account[]
  lookup: Lookup
  onClose: () => void
}

/** 图表下钻：列出对应的流水，可直接查看 / 编辑 / 删除；只在一个月内时可跳到明细页继续筛选 */
export function DrillDialog({ drill, rows, categories, accounts, lookup, onClose }: Props) {
  const toast = useToast()
  const [selectedId, setSelectedId] = useState<number>()
  const items = useMemo(() => rows.filter((t) => matchDrill(t, drill)), [rows, drill])
  const selected = items.find((t) => t.id === selectedId)
  const summary = summarize(items)
  const month = monthOfPeriod({ kind: 'custom', start: drill.start, end: drill.end })
  const back = useCallback(() => setSelectedId(undefined), [])

  const handleDelete = useCallback(
    async (t: Transaction) => {
      if (t.id === undefined) return
      await deleteTransaction(db, t.id)
      setSelectedId(undefined)
      toast.show({
        message: `已删除 ${titleOf(t, lookup)} ${signedAmount(t)}`,
        action: { label: '撤销', onClick: () => void restoreTransactions(db, [t]) },
      })
    },
    [lookup, toast],
  )

  if (selected) {
    return (
      <Dialog open title="流水详情" onClose={back}>
        <Button variant="ghost" size="sm" onClick={back} className="drill-back">
          <ArrowLeft size={16} aria-hidden="true" />
          返回{drill.title}
        </Button>
        <TransactionDetail
          key={selected.id}
          transaction={selected}
          categories={categories}
          accounts={accounts}
          lookup={lookup}
          onClose={back}
          onDelete={(t) => void handleDelete(t)}
          variant="dialog"
        />
      </Dialog>
    )
  }

  return (
    <Dialog open title={drill.title} onClose={onClose}>
      <div className="drill">
        <p className="drill-summary t-body-s text-secondary">
          共 {items.length} 笔
          {summary.expense > 0 && ` · 支出 ${formatCents(summary.expense)}`}
          {summary.income > 0 && ` · 收入 ${formatCents(summary.income)}`}
        </p>
        {items.length === 0 ? (
          <p className="chart-empty t-body-s text-tertiary">这段时间没有对应的记录</p>
        ) : (
          <TransactionList
            transactions={items}
            lookup={lookup}
            onOpen={(t) => setSelectedId(t.id)}
            onDelete={(t) => void handleDelete(t)}
          />
        )}
        {month && items.length > 0 && !drill.noLink && (
          <a className="btn btn-secondary btn-md btn-block" href={transactionsHref(month, drill)}>
            <ExternalLink size={16} aria-hidden="true" />
            在明细页中筛选
          </a>
        )}
      </div>
    </Dialog>
  )
}

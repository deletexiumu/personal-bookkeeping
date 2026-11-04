import type { KeyboardEvent } from 'react'
import type { Transaction } from '../../types'
import { CategoryIcon } from '../CategoryIcon'
import { accountLabel, amountClass, signedAmount, titleOf, type Lookup } from './display'
import { SourceBadge } from './SourceBadge'

interface Props {
  transactions: Transaction[]
  lookup: Lookup
  selectedId?: number
  onOpen: (t: Transaction) => void
}

/**
 * 明细表格（D01，宽屏）：日期、分类、备注 / 商户、账户、来源、金额。
 * 点击或回车打开右侧详情，方向键上下移动。
 */
export function TransactionTable({ transactions, lookup, selectedId, onOpen }: Props) {
  function handleKeyDown(e: KeyboardEvent<HTMLTableRowElement>, t: Transaction) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onOpen(t)
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const row = e.key === 'ArrowDown' ? e.currentTarget.nextElementSibling : e.currentTarget.previousElementSibling
      ;(row as HTMLElement | null)?.focus()
    }
  }

  return (
    <div className="card tx-table-wrap">
      <table className="tx-table" aria-label="收支明细">
        <thead>
          <tr className="t-caption text-tertiary">
            <th scope="col">日期</th>
            <th scope="col">分类</th>
            <th scope="col">备注 / 商户</th>
            <th scope="col">账户</th>
            <th scope="col">来源</th>
            <th scope="col" className="num">
              金额
            </th>
          </tr>
        </thead>
        <tbody>
          {transactions.map((t) => (
            <tr
              key={t.id}
              tabIndex={0}
              aria-selected={selectedId === t.id}
              onClick={() => onOpen(t)}
              onKeyDown={(e) => handleKeyDown(e, t)}
            >
              <td className="t-num-s text-secondary nowrap">
                {t.date.slice(5)}
                {t.time && ` ${t.time}`}
              </td>
              <td>
                <span className="tx-table-category">
                  <CategoryIcon category={lookup.category(t.categoryId)} transfer={t.type === 'transfer'} size={28} />
                  {titleOf(t, lookup)}
                </span>
              </td>
              <td className="tx-table-note">{[t.note, t.merchant].filter(Boolean).join(' · ') || '—'}</td>
              <td className="text-secondary nowrap">{accountLabel(t, lookup)}</td>
              <td>
                <SourceBadge source={t.source} />
              </td>
              <td className={`num t-num-m ${amountClass(t)}`}>{signedAmount(t)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

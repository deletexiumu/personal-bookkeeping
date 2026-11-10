import type { KeyboardEvent } from 'react'
import type { Transaction } from '../../types'
import { describe } from '../../lib/merchant'
import type { PlanOccurrence } from '../../lib/plans'
import { CategoryIcon } from '../CategoryIcon'
import { PlanTableRow } from '../plans/PlanRows'
import { TagChips } from '../tags/TagChips'
import { accountLabel, amountClass, signedAmount, titleOf, type Lookup } from './display'
import { SourceBadge } from './SourceBadge'

interface Props {
  transactions: Transaction[]
  lookup: Lookup
  selectedId?: number
  onOpen: (t: Transaction) => void
  /** 还没发生的预算，按日期插在当天的实际流水前面 */
  plans?: PlanOccurrence[]
  onOpenPlan?: (o: PlanOccurrence) => void
}

/**
 * 明细表格（D01，宽屏）：日期、分类、备注 / 商户、账户、来源、金额。
 * 点击或回车打开右侧详情，方向键上下移动。
 */
export function TransactionTable({ transactions, lookup, selectedId, onOpen, plans = [], onOpenPlan }: Props) {
  // 流水已按日期倒序；预算按日期倒序插进去，同一天的排在流水前面
  const pending = [...plans].sort((a, b) => b.date.localeCompare(a.date))
  const rows: ({ plan: PlanOccurrence } | { tx: Transaction })[] = []
  for (const t of transactions) {
    while (pending.length && pending[0].date >= t.date) rows.push({ plan: pending.shift()! })
    rows.push({ tx: t })
  }
  for (const o of pending) rows.push({ plan: o })

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
            <th scope="col">备注 / 商户 / 标签</th>
            <th scope="col">账户</th>
            <th scope="col">来源</th>
            <th scope="col" className="num">
              金额
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            if ('plan' in r)
              return <PlanTableRow key={r.plan.ref} occurrence={r.plan} lookup={lookup} onOpen={(o) => onOpenPlan?.(o)} />
            const t = r.tx
            return (
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
              <td className="tx-table-note">
                {[describe(t), t.merchant].filter(Boolean).join(' · ') || '—'}
                <TagChips tags={lookup.tags(t)} inherited={lookup.tags.origin(t) === 'merchant'} />
              </td>
              <td className="text-secondary nowrap">{accountLabel(t, lookup)}</td>
              <td>
                <SourceBadge source={t.source} />
              </td>
              <td className={`num t-num-m ${amountClass(t)}`} title={t.excluded ? '不计收支' : undefined}>
                {signedAmount(t)}
                {t.excluded && <span className="t-caption text-tertiary"> 不计收支</span>}
              </td>
            </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

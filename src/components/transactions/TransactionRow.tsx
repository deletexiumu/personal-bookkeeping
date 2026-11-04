import { Trash2 } from 'lucide-react'
import type { Transaction } from '../../types'
import { CategoryIcon } from '../CategoryIcon'
import { IconButton } from '../ui/Button'
import { accountLabel, amountClass, signedAmount, titleOf, type Lookup } from './display'

interface Props {
  transaction: Transaction
  lookup: Lookup
  onOpen: (t: Transaction) => void
  onDelete: (t: Transaction) => void
}

/**
 * 流水行（Figma 组件 TransactionRow），点击打开详情。
 * 支出用主文字色加「-」，收入用收入色加「+」，转账不带符号、用次要文字色。
 */
export function TransactionRow({ transaction: t, lookup, onOpen, onDelete }: Props) {
  const isTransfer = t.type === 'transfer'
  const title = titleOf(t, lookup)
  const sub = (isTransfer ? [accountLabel(t, lookup), t.note, t.time] : [t.note || t.merchant, t.time])
    .filter(Boolean)
    .join(' · ')
  const account = lookup.account(t.accountId)?.name ?? '未知账户'

  return (
    <li className="tx-row">
      <button type="button" className="tx-open" onClick={() => onOpen(t)} aria-label={`${title} ${signedAmount(t)}，查看详情`}>
        <CategoryIcon category={lookup.category(t.categoryId)} transfer={isTransfer} />
        <span className="tx-main">
          <span className="t-body-m-strong">{title}</span>
          <span className="t-caption text-tertiary tx-sub">{sub || account}</span>
        </span>
        <span className="tx-side">
          <span className={`t-num-m ${amountClass(t)}`}>{signedAmount(t)}</span>
          <span className="t-caption text-tertiary">{isTransfer ? '转账' : account}</span>
        </span>
      </button>
      <IconButton label="删除这条记录" className="tx-delete" onClick={() => onDelete(t)}>
        <Trash2 size={16} />
      </IconButton>
    </li>
  )
}

import { Trash2 } from 'lucide-react'
import { formatCents } from '../../lib/money'
import type { Account, Category, Transaction } from '../../types'
import { CategoryIcon } from '../CategoryIcon'
import { IconButton } from '../ui/Button'

interface Props {
  transaction: Transaction
  category: Category | undefined
  account: Account | undefined
  /** 转账的转入账户 */
  toAccount?: Account
  onDelete: (t: Transaction) => void
}

/**
 * 流水行（Figma 组件 TransactionRow）。
 * 支出用主文字色加「-」，收入用收入色加「+」，转账不带符号、用次要文字色。
 */
export function TransactionRow({ transaction: t, category, account, toAccount, onDelete }: Props) {
  const accountName = account?.name ?? '未知账户'
  const isTransfer = t.type === 'transfer'
  const title = isTransfer ? '转账' : (category?.name ?? '未分类')
  const detail = isTransfer
    ? [`${accountName} → ${toAccount?.name ?? '未知账户'}`, t.note]
    : [t.note || t.merchant, t.time]
  const sub = (isTransfer ? [...detail, t.time] : detail).filter(Boolean).join(' · ')
  const sign = t.type === 'expense' ? '-' : t.type === 'income' ? '+' : ''
  const amountClass = t.type === 'income' ? 'text-income' : isTransfer ? 'text-secondary' : ''

  return (
    <li className="tx-row">
      <CategoryIcon category={category} transfer={isTransfer} />
      <div className="tx-main">
        <span className="t-body-m-strong">{title}</span>
        <span className="t-caption text-tertiary tx-sub">{sub || accountName}</span>
      </div>
      <div className="tx-side">
        <span className={`t-num-m ${amountClass}`}>
          {sign}
          {formatCents(t.amount)}
        </span>
        <span className="t-caption text-tertiary">{isTransfer ? '转账' : accountName}</span>
      </div>
      <IconButton label="删除这条记录" className="tx-delete" onClick={() => onDelete(t)}>
        <Trash2 size={16} />
      </IconButton>
    </li>
  )
}

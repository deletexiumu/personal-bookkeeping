import { Trash2 } from 'lucide-react'
import { formatCents } from '../../lib/money'
import type { Account, Category, Transaction } from '../../types'
import { CategoryIcon } from '../CategoryIcon'
import { IconButton } from '../ui/Button'

interface Props {
  transaction: Transaction
  category: Category | undefined
  account: Account | undefined
  onDelete: (t: Transaction) => void
}

/** 流水行（Figma 组件 TransactionRow）。支出用主文字色加「-」，收入用收入色加「+」。 */
export function TransactionRow({ transaction: t, category, account, onDelete }: Props) {
  const accountName = account?.name ?? '未知账户'
  return (
    <li className="tx-row">
      <CategoryIcon category={category} />
      <div className="tx-main">
        <span className="t-body-m-strong">{category?.name ?? '未分类'}</span>
        <span className="t-caption text-tertiary tx-sub">{t.note || accountName}</span>
      </div>
      <div className="tx-side">
        <span className={`t-num-m ${t.type === 'income' ? 'text-income' : ''}`}>
          {t.type === 'expense' ? '-' : '+'}
          {formatCents(t.amount)}
        </span>
        <span className="t-caption text-tertiary">{accountName}</span>
      </div>
      <IconButton label="删除这条记录" className="tx-delete" onClick={() => onDelete(t)}>
        <Trash2 size={16} />
      </IconButton>
    </li>
  )
}

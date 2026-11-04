import type { Account, Category } from '../types'
import { ACCOUNT_TYPES, categoryVisual, TRANSFER_VISUAL, type Visual } from './icons'

function ToneIcon({ visual, size }: { visual: Visual; size: number }) {
  const { icon: Icon, tone } = visual
  return (
    <span className={`cat-icon tone-${tone}`} style={{ width: size, height: size }} aria-hidden="true">
      <Icon size={Math.round(size * 0.5)} strokeWidth={2} />
    </span>
  )
}

interface Props {
  category: Category | undefined
  /** 转账没有分类，显示转账图标 */
  transfer?: boolean
  size?: number
}

/** 分类图标（TransactionRow / CategoryChip） */
export function CategoryIcon({ category, transfer = false, size = 40 }: Props) {
  return <ToneIcon visual={transfer ? TRANSFER_VISUAL : categoryVisual(category)} size={size} />
}

/** 账户图标，按账户类型 */
export function AccountIcon({ account, size = 40 }: { account: Account | undefined; size?: number }) {
  const preset = ACCOUNT_TYPES[account?.type ?? 'other']
  return <ToneIcon visual={{ icon: preset.icon, tone: preset.tone }} size={size} />
}

/** 任意图标 + 配色（图标选择器用） */
export function TonePreview({ visual, size = 40 }: { visual: Visual; size?: number }) {
  return <ToneIcon visual={visual} size={size} />
}


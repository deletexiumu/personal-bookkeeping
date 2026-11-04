import {
  ArrowLeftRight,
  Banknote,
  Bus,
  Clapperboard,
  Coins,
  Ellipsis,
  Gift,
  HeartPulse,
  House,
  ShoppingBag,
  TrendingUp,
  Utensils,
  type LucideIcon,
} from 'lucide-react'
import type { Category } from '../types'

type Tone = 'orange' | 'blue' | 'red' | 'green' | 'purple' | 'cyan' | 'gray'

interface Visual {
  icon: LucideIcon
  tone: Tone
}

/**
 * 默认分类的图标与配色（与 Figma 的 TransactionRow / CategoryChip 一致）。
 * W3 分类管理上线后改为读取分类上保存的图标和颜色，这里作为回退。
 */
const VISUALS: Record<string, Visual> = {
  餐饮: { icon: Utensils, tone: 'orange' },
  交通: { icon: Bus, tone: 'blue' },
  购物: { icon: ShoppingBag, tone: 'red' },
  居住: { icon: House, tone: 'blue' },
  娱乐: { icon: Clapperboard, tone: 'cyan' },
  医疗: { icon: HeartPulse, tone: 'red' },
  工资: { icon: Banknote, tone: 'green' },
  奖金: { icon: Gift, tone: 'green' },
  理财: { icon: TrendingUp, tone: 'green' },
}

const FALLBACK: Record<Category['type'], Visual> = {
  expense: { icon: Ellipsis, tone: 'gray' },
  income: { icon: Coins, tone: 'green' },
}

function categoryVisual(category: Pick<Category, 'name' | 'type'> | undefined): Visual {
  if (!category) return FALLBACK.expense
  return VISUALS[category.name] ?? FALLBACK[category.type]
}

const TRANSFER: Visual = { icon: ArrowLeftRight, tone: 'gray' }

interface Props {
  category: Category | undefined
  /** 转账没有分类，显示转账图标 */
  transfer?: boolean
  size?: number
}

export function CategoryIcon({ category, transfer = false, size = 40 }: Props) {
  const { icon: Icon, tone } = transfer ? TRANSFER : categoryVisual(category)
  return (
    <span className={`cat-icon tone-${tone}`} style={{ width: size, height: size }} aria-hidden="true">
      <Icon size={Math.round(size * 0.5)} strokeWidth={2} />
    </span>
  )
}

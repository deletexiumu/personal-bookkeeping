import {
  ArrowLeftRight,
  Baby,
  Banknote,
  BookOpen,
  Briefcase,
  Bus,
  Car,
  Clapperboard,
  Coffee,
  Coins,
  CreditCard,
  Dumbbell,
  Ellipsis,
  Gamepad2,
  Gift,
  GraduationCap,
  HeartPulse,
  House,
  Landmark,
  PawPrint,
  Plane,
  Receipt,
  Shirt,
  ShoppingBag,
  Smartphone,
  TrendingUp,
  Users,
  Utensils,
  Wallet,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import { DEFAULT_CATEGORIES } from '../db/defaults'
import type { AccountType, Category, Tone } from '../types'

/** 分类可选图标（键名存进数据库，换图标库时只改这里） */
export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  utensils: Utensils,
  coffee: Coffee,
  bus: Bus,
  car: Car,
  plane: Plane,
  'shopping-bag': ShoppingBag,
  shirt: Shirt,
  house: House,
  zap: Zap,
  smartphone: Smartphone,
  clapperboard: Clapperboard,
  gamepad: Gamepad2,
  'heart-pulse': HeartPulse,
  'graduation-cap': GraduationCap,
  book: BookOpen,
  baby: Baby,
  'paw-print': PawPrint,
  dumbbell: Dumbbell,
  gift: Gift,
  users: Users,
  receipt: Receipt,
  banknote: Banknote,
  'trending-up': TrendingUp,
  coins: Coins,
  briefcase: Briefcase,
  ellipsis: Ellipsis,
}

export const TONES: Tone[] = ['orange', 'red', 'blue', 'cyan', 'green', 'purple', 'gray']

export interface Visual {
  icon: LucideIcon
  tone: Tone
}

/** 默认分类的图标与配色（与 Figma 的 TransactionRow / CategoryChip 一致），用于旧数据回退 */
const DEFAULT_CATEGORY_VISUALS = new Map(DEFAULT_CATEGORIES.map((c) => [c.name, c]))

export const TRANSFER_VISUAL: Visual = { icon: ArrowLeftRight, tone: 'gray' }

/** 分类的图标：优先用分类上保存的图标和颜色，其次按默认分类名，最后按类型回退 */
export function categoryVisual(category: Pick<Category, 'name' | 'type' | 'icon' | 'color'> | undefined): Visual {
  if (!category) return { icon: Ellipsis, tone: 'gray' }
  const preset = DEFAULT_CATEGORY_VISUALS.get(category.name)
  const key = category.icon ?? preset?.icon
  const tone = category.color ?? preset?.color ?? (category.type === 'income' ? 'green' : 'gray')
  const icon = (key && CATEGORY_ICONS[key]) || (category.type === 'income' ? Coins : Ellipsis)
  return { icon, tone }
}

export const ACCOUNT_TYPES: Record<AccountType, { label: string; icon: LucideIcon; tone: Tone }> = {
  cash: { label: '现金', icon: Banknote, tone: 'orange' },
  debit: { label: '储蓄卡', icon: Landmark, tone: 'blue' },
  credit: { label: '信用卡', icon: CreditCard, tone: 'red' },
  alipay: { label: '支付宝', icon: Smartphone, tone: 'blue' },
  wechat: { label: '微信', icon: Smartphone, tone: 'green' },
  other: { label: '其他', icon: Wallet, tone: 'gray' },
}

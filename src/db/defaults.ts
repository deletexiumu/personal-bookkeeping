import type { Account, AccountType, Category, Tone } from '../types'

/**
 * 默认分类和账户用固定的 uid：每台设备首次打开都会写入同样的一套，同步时认作同一条记录，不会出现两份「餐饮」。
 */
export const defaultCategoryUid = (order: number) => `default-category-${order}`
export const defaultAccountUid = (order: number) => `default-account-${order}`

const category = (name: string, type: Category['type'], icon: string, color: Tone, order: number): Category => ({
  uid: defaultCategoryUid(order),
  name,
  type,
  icon,
  color,
  order,
})

/** 首次打开时写入的默认分类（顺序即 ID 顺序，测试依赖：1 餐饮 … 8 工资） */
export const DEFAULT_CATEGORIES: Category[] = [
  category('餐饮', 'expense', 'utensils', 'orange', 1),
  category('交通', 'expense', 'bus', 'blue', 2),
  category('购物', 'expense', 'shopping-bag', 'red', 3),
  category('居住', 'expense', 'house', 'blue', 4),
  category('娱乐', 'expense', 'clapperboard', 'cyan', 5),
  category('医疗', 'expense', 'heart-pulse', 'red', 6),
  category('其他支出', 'expense', 'ellipsis', 'gray', 7),
  category('工资', 'income', 'banknote', 'green', 8),
  category('奖金', 'income', 'gift', 'green', 9),
  category('理财', 'income', 'trending-up', 'green', 10),
  category('其他收入', 'income', 'coins', 'green', 11),
]

/** 默认账户；按名称推断类型，也用于 v3 升级 */
export const DEFAULT_ACCOUNT_TYPES: Record<string, AccountType> = {
  现金: 'cash',
  银行卡: 'debit',
  支付宝: 'alipay',
  微信: 'wechat',
}

export const DEFAULT_ACCOUNTS: Account[] = Object.entries(DEFAULT_ACCOUNT_TYPES).map(([name, type], i) => ({
  uid: defaultAccountUid(i + 1),
  name,
  type,
  initialBalance: 0,
  order: i + 1,
}))

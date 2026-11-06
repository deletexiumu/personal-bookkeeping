import { formatCents } from '../../lib/money'
import type { Account, Category, Transaction } from '../../types'

/** 列表、表格和详情共用的展示文案 */
export interface Lookup {
  category: (id: number | undefined) => Category | undefined
  account: (id: number | undefined) => Account | undefined
}

export function makeLookup(categories: Category[], accounts: Account[]): Lookup {
  const categoryById = new Map(categories.map((c) => [c.id, c]))
  const accountById = new Map(accounts.map((a) => [a.id, a]))
  return {
    category: (id) => (id === undefined ? undefined : categoryById.get(id)),
    account: (id) => (id === undefined ? undefined : accountById.get(id)),
  }
}

export function titleOf(t: Transaction, lookup: Lookup): string {
  return t.type === 'transfer' ? '转账' : (lookup.category(t.categoryId)?.name ?? '未分类')
}

export function accountLabel(t: Transaction, lookup: Lookup): string {
  const from = lookup.account(t.accountId)?.name ?? '未知账户'
  if (t.type !== 'transfer') return from
  return `${from} → ${lookup.account(t.transferAccountId)?.name ?? '未知账户'}`
}

/** 带符号的金额：支出「-」、收入「+」、转账不带符号 */
export function signedAmount(t: Transaction): string {
  const sign = t.type === 'expense' ? '-' : t.type === 'income' ? '+' : ''
  return sign + formatCents(t.amount)
}

/** 收入、支出按金额颜色；转账和不计收支的用次要文字色 */
export function amountClass(t: Transaction): string {
  if (t.type === 'transfer' || t.excluded) return 'text-secondary'
  return t.type === 'income' ? 'amount-income' : 'amount-expense'
}

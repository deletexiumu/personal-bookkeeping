import type { Category, Transaction, TransactionSource, TransactionType } from '../types'
import { formatCents } from './money'

/** 明细筛选条件；字段为空表示不限 */
export interface TransactionFilter {
  /** 关键字：匹配备注、商户、分类名、标签和金额 */
  query?: string
  type?: TransactionType
  accountId?: number
  categoryId?: number
  source?: TransactionSource
}

export function isFilterEmpty(filter: TransactionFilter): boolean {
  return !filter.query?.trim() && !filter.type && filter.accountId === undefined && filter.categoryId === undefined && !filter.source
}

/** 按条件筛选流水。账户条件同时匹配转账的转出和转入账户。 */
export function filterTransactions(
  rows: Transaction[],
  filter: TransactionFilter,
  categories: Category[] = [],
): Transaction[] {
  const query = filter.query?.trim().toLowerCase().replace(/^[#＃]/, '')
  const categoryName = new Map(categories.map((c) => [c.id, c.name.toLowerCase()]))
  return rows.filter((t) => {
    if (filter.type && t.type !== filter.type) return false
    if (filter.source && t.source !== filter.source) return false
    if (filter.categoryId !== undefined && t.categoryId !== filter.categoryId) return false
    if (filter.accountId !== undefined && t.accountId !== filter.accountId && t.transferAccountId !== filter.accountId) {
      return false
    }
    if (!query) return true
    const amount = formatCents(t.amount).slice(1).replace(/,/g, '')
    const haystack = [
      t.note,
      t.merchant,
      t.categoryId === undefined ? '转账' : categoryName.get(t.categoryId),
      ...(t.tags ?? []),
      amount,
    ]
    return haystack.some((text) => text?.toLowerCase().includes(query))
  })
}

export const SOURCE_LABEL: Record<TransactionSource, string> = {
  manual: '手动',
  import: '导入',
  api: '接口',
  rule: '规则',
}

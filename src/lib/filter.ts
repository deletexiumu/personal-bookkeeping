import type { Category, Transaction, TransactionSource, TransactionType } from '../types'
import { formatCents } from './money'
import { statType } from './stats'
import { ownTagsOnly, type TagResolver } from './tags'

/** 标签筛选里「未打标签」的取值 */
export const UNTAGGED = '__untagged__'

/** 明细筛选条件；字段为空表示不限 */
export interface TransactionFilter {
  /** 关键字：匹配备注、商户、商品说明、分类名、标签、金额、订单号、商户单号、付款方式、合并进来的流水和「不计收支」 */
  query?: string
  type?: TransactionType
  accountId?: number
  categoryId?: number
  source?: TransactionSource
  /** 标签名，或 UNTAGGED 表示还没有标签的收支（不含转账和不计收支的） */
  tag?: string
}

export function isFilterEmpty(filter: TransactionFilter): boolean {
  return (
    !filter.query?.trim() &&
    !filter.type &&
    filter.accountId === undefined &&
    filter.categoryId === undefined &&
    !filter.source &&
    !filter.tag
  )
}

/** 按条件筛选流水。账户条件同时匹配转账的转出和转入账户；标签按实际生效的标签（含商户标签）。 */
export function filterTransactions(
  rows: Transaction[],
  filter: TransactionFilter,
  categories: Category[] = [],
  resolveTags: TagResolver = ownTagsOnly,
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
    if (filter.tag === UNTAGGED) {
      if (!statType(t) || resolveTags(t).length > 0) return false
    } else if (filter.tag && !resolveTags(t).includes(filter.tag)) {
      return false
    }
    if (!query) return true
    const amount = formatCents(t.amount).slice(1).replace(/,/g, '')
    const haystack = [
      t.note,
      t.merchant,
      t.categoryId === undefined ? '转账' : categoryName.get(t.categoryId),
      ...resolveTags(t),
      amount,
      t.externalId,
      t.goods,
      t.merchantOrderNo,
      t.payMethod,
      ...(t.merged ?? []).flatMap((m) => [m.merchant, m.note, m.ref]),
      t.excluded ? '不计收支' : undefined,
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

/**
 * 从明细页链接中读出月份（或整年）和筛选条件，
 * 例如 #/transactions?month=2026-11&type=expense&category=1&q=星巴克&tag=游戏、#/transactions?year=2026&tag=房租
 */
export function parseTransactionsHash(hash: string): { month?: string; year?: string; filter: TransactionFilter } {
  const query = hash.split('?')[1]
  const filter: TransactionFilter = {}
  if (!query) return { filter }
  const params = new URLSearchParams(query)
  const month = params.get('month') ?? undefined
  const type = params.get('type')
  if (type === 'expense' || type === 'income' || type === 'transfer') filter.type = type
  const category = Number(params.get('category'))
  if (Number.isInteger(category) && category > 0) filter.categoryId = category
  const account = Number(params.get('account'))
  if (Number.isInteger(account) && account > 0) filter.accountId = account
  const q = params.get('q')?.trim()
  if (q) filter.query = q
  const tag = params.get('tag')?.trim()
  if (tag) filter.tag = tag
  const year = params.get('year') ?? undefined
  return {
    month: month && /^\d{4}-\d{2}$/.test(month) ? month : undefined,
    year: year && /^\d{4}$/.test(year) ? year : undefined,
    filter,
  }
}

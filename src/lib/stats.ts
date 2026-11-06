import type { CategoryType, Transaction } from '../types'

/**
 * 这笔流水在收支统计里算收入还是支出；转账和标为不计收支的不算（返回 undefined）。
 * 所有收入、支出、预算、分析的汇总都经过这里，账户余额不经过（不计收支的钱仍然进出了账户）。
 */
export function statType(t: Pick<Transaction, 'type' | 'excluded'>): CategoryType | undefined {
  if (t.type === 'transfer' || t.excluded) return undefined
  return t.type
}

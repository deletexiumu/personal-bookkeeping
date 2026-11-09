import type { LedgerSource } from '../lib/ai/tools'
import { listBudgets } from './budgets'
import { listAccounts, listCategories } from './catalog'
import type { BookkeepingDB } from './index'
import { listTagRules } from './tags'
import { listByRange } from './transactions'
import { makeTagResolver, withEffectiveTags } from '../lib/tags'
import type { Transaction } from '../types'

/** 给流水填上实际生效的标签（含商户标签），助手看到的标签与页面一致 */
async function tagged(db: BookkeepingDB, rows: Promise<Transaction[]>): Promise<Transaction[]> {
  const [list, rules] = await Promise.all([rows, listTagRules(db)])
  return withEffectiveTags(list, makeTagResolver(rules))
}

/** AI 助手的工具从本机 IndexedDB 读账本 */
export function ledgerSource(db: BookkeepingDB): LedgerSource {
  return {
    listRange: (start, end) => tagged(db, listByRange(db, start, end)),
    allTransactions: () => tagged(db, db.transactions.toArray()),
    categories: () => listCategories(db),
    accounts: () => listAccounts(db),
    budgets: () => listBudgets(db),
  }
}

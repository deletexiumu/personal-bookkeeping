import type { LedgerSource } from '../lib/ai/tools'
import { listBudgets } from './budgets'
import { listAccounts, listCategories } from './catalog'
import type { BookkeepingDB } from './index'
import { listByRange } from './transactions'

/** AI 助手的工具从本机 IndexedDB 读账本 */
export function ledgerSource(db: BookkeepingDB): LedgerSource {
  return {
    listRange: (start, end) => listByRange(db, start, end),
    allTransactions: () => db.transactions.toArray(),
    categories: () => listCategories(db),
    accounts: () => listAccounts(db),
    budgets: () => listBudgets(db),
  }
}

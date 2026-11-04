import type { Transaction } from '../types'
import type { BookkeepingDB } from './index'

export type NewTransaction = Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>

export async function addTransaction(db: BookkeepingDB, input: NewTransaction): Promise<number> {
  const now = Date.now()
  const id = await db.transactions.add({ ...input, createdAt: now, updatedAt: now })
  return id as number
}

export async function deleteTransaction(db: BookkeepingDB, id: number): Promise<void> {
  await db.transactions.delete(id)
}

/** 查询某月（YYYY-MM）的记录，按日期倒序、同日按创建时间倒序 */
export async function listByMonth(db: BookkeepingDB, month: string): Promise<Transaction[]> {
  const rows = await db.transactions
    .where('date')
    .between(`${month}-01`, `${month}-31`, true, true)
    .toArray()
  return rows.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)
}

export interface MonthSummary {
  income: number
  expense: number
  balance: number
}

export function summarize(rows: Transaction[]): MonthSummary {
  let income = 0
  let expense = 0
  for (const row of rows) {
    if (row.type === 'income') income += row.amount
    else expense += row.amount
  }
  return { income, expense, balance: income - expense }
}

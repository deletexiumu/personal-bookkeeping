import type { Budget } from '../types'
import type { BookkeepingDB } from './index'

export async function listBudgets(db: BookkeepingDB): Promise<Budget[]> {
  return db.budgets.toArray()
}

/**
 * 设置某个分类（不传为总预算）的月度预算；金额为 0 或 null 时删除。
 */
export async function setBudget(db: BookkeepingDB, categoryId: number | undefined, amount: number | null): Promise<void> {
  await db.transaction('rw', db.budgets, async () => {
    const existing = (await db.budgets.toArray()).find((b) => b.categoryId === categoryId)
    if (!amount) {
      if (existing?.id !== undefined) await db.budgets.delete(existing.id)
      return
    }
    if (amount < 0 || !Number.isSafeInteger(amount)) throw new Error('预算金额不正确')
    if (existing?.id !== undefined) await db.budgets.update(existing.id, { amount })
    else await db.budgets.add(categoryId === undefined ? { amount } : { categoryId, amount })
  })
}

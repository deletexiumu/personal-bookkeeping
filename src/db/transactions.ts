import type { Transaction } from '../types'
import type { BookkeepingDB } from './index'

export type NewTransaction = Omit<Transaction, 'id' | 'createdAt' | 'updatedAt' | 'source'> &
  Partial<Pick<Transaction, 'source'>>

function stamp(input: NewTransaction, now: number): Transaction {
  return { source: 'manual', ...input, createdAt: now, updatedAt: now }
}

export async function addTransaction(db: BookkeepingDB, input: NewTransaction): Promise<number> {
  const id = await db.transactions.add(stamp(input, Date.now()))
  return id as number
}

export interface NewTransfer {
  fromAccountId: number
  toAccountId: number
  /** 转账金额（分） */
  amount: number
  /** 手续费（分），大于 0 时另记一笔支出 */
  fee?: number
  /** 手续费记到哪个支出分类 */
  feeCategoryId?: number
  date: string
  time?: string
  note?: string
  tags?: string[]
}

/** 记一笔转账；有手续费时在同一事务里另记一笔支出。返回新增记录的 ID。 */
export async function addTransfer(db: BookkeepingDB, input: NewTransfer): Promise<number[]> {
  if (input.fromAccountId === input.toAccountId) throw new Error('转出和转入账户不能相同')
  const now = Date.now()
  const { date, time, note, tags } = input
  return db.transaction('rw', db.transactions, async () => {
    const ids = [
      (await db.transactions.add(
        stamp(
          {
            type: 'transfer',
            amount: input.amount,
            accountId: input.fromAccountId,
            transferAccountId: input.toAccountId,
            date,
            time,
            note,
            tags,
          },
          now,
        ),
      )) as number,
    ]
    if (input.fee && input.fee > 0) {
      ids.push(
        (await db.transactions.add(
          stamp(
            {
              type: 'expense',
              amount: input.fee,
              categoryId: input.feeCategoryId,
              accountId: input.fromAccountId,
              date,
              time,
              note: '转账手续费',
            },
            now + 1,
          ),
        )) as number,
      )
    }
    return ids
  })
}

export async function deleteTransaction(db: BookkeepingDB, id: number): Promise<void> {
  await db.transactions.delete(id)
}

export async function deleteTransactions(db: BookkeepingDB, ids: number[]): Promise<void> {
  await db.transactions.bulkDelete(ids)
}

/** 排序：日期倒序，同日按时间倒序（无时间的排在后面），再按创建时间倒序 */
export function compareTransactions(a: Transaction, b: Transaction): number {
  return (
    b.date.localeCompare(a.date) ||
    (b.time ?? '').localeCompare(a.time ?? '') ||
    b.createdAt - a.createdAt
  )
}

/** 查询某月（YYYY-MM）的记录 */
export async function listByMonth(db: BookkeepingDB, month: string): Promise<Transaction[]> {
  const rows = await db.transactions
    .where('date')
    .between(`${month}-01`, `${month}-31`, true, true)
    .toArray()
  return rows.sort(compareTransactions)
}

/** 查询日期区间（含首尾，YYYY-MM-DD）内的记录 */
export async function listByRange(db: BookkeepingDB, start: string, end: string): Promise<Transaction[]> {
  const rows = await db.transactions.where('date').between(start, end, true, true).toArray()
  return rows.sort(compareTransactions)
}

/** 各分类被使用的次数，用于记一笔时按使用频次排序分类 */
export async function categoryUsage(db: BookkeepingDB): Promise<Map<number, number>> {
  const usage = new Map<number, number>()
  await db.transactions.orderBy('categoryId').eachKey((key) => {
    const id = key as number
    usage.set(id, (usage.get(id) ?? 0) + 1)
  })
  return usage
}

export interface MonthSummary {
  income: number
  expense: number
  balance: number
}

/** 汇总收入、支出和结余；转账不计入 */
export function summarize(rows: Transaction[]): MonthSummary {
  let income = 0
  let expense = 0
  for (const row of rows) {
    if (row.type === 'income') income += row.amount
    else if (row.type === 'expense') expense += row.amount
  }
  return { income, expense, balance: income - expense }
}

export interface DayGroup extends MonthSummary {
  date: string
  items: Transaction[]
}

/** 把已排好序的记录按天分组，并算出每天的收支小计 */
export function groupByDay(rows: Transaction[]): DayGroup[] {
  const groups: DayGroup[] = []
  for (const row of rows) {
    let group = groups.at(-1)
    if (!group || group.date !== row.date) {
      group = { date: row.date, items: [], income: 0, expense: 0, balance: 0 }
      groups.push(group)
    }
    group.items.push(row)
  }
  for (const group of groups) Object.assign(group, summarize(group.items))
  return groups
}

export type TransactionPatch = Partial<Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>>

/** 修改一笔记录。传 undefined 的字段会被清除（例如清空备注）。 */
export async function updateTransaction(db: BookkeepingDB, id: number, patch: TransactionPatch): Promise<void> {
  await db.transaction('rw', db.transactions, async () => {
    const current = await db.transactions.get(id)
    if (!current) throw new Error('记录不存在或已被删除')
    const next: Transaction = { ...current, ...patch, id, updatedAt: Date.now() }
    for (const key of Object.keys(next) as (keyof Transaction)[]) {
      if (next[key] === undefined) delete next[key]
    }
    await db.transactions.put(next)
  })
}

/** 撤销删除：按原 ID 放回 */
export async function restoreTransactions(db: BookkeepingDB, rows: Transaction[]): Promise<void> {
  await db.transactions.bulkPut(rows)
}

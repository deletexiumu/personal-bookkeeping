import type { Account, Category } from '../types'
import type { BookkeepingDB } from './index'

/** 分类和账户的增删改与排序 */

type Table = 'categories' | 'accounts'

async function nextOrder(db: BookkeepingDB, table: Table): Promise<number> {
  const last = await db[table].orderBy('order').last()
  return (last?.order ?? 0) + 1
}

/** 按 order 排序；没有 order 的排在后面，按 ID */
export function byOrder<T extends { id?: number; order?: number }>(a: T, b: T): number {
  return (a.order ?? Infinity) - (b.order ?? Infinity) || (a.id ?? 0) - (b.id ?? 0)
}

export async function listCategories(db: BookkeepingDB): Promise<Category[]> {
  return (await db.categories.toArray()).sort(byOrder)
}

export async function listAccounts(db: BookkeepingDB): Promise<Account[]> {
  return (await db.accounts.toArray()).sort(byOrder)
}

function assertName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('名称不能为空')
  if (trimmed.length > 12) throw new Error('名称最多 12 个字')
  return trimmed
}

export async function saveCategory(db: BookkeepingDB, input: Category): Promise<number> {
  const name = assertName(input.name)
  return db.transaction('rw', db.categories, async () => {
    const duplicate = await db.categories
      .where('name')
      .equals(name)
      .filter((c) => c.type === input.type && c.id !== input.id)
      .first()
    if (duplicate) throw new Error(`已有同名分类「${name}」`)
    if (input.id !== undefined) {
      await db.categories.update(input.id, { ...input, name })
      return input.id
    }
    return (await db.categories.add({ ...input, name, order: await nextOrder(db, 'categories') })) as number
  })
}

export async function saveAccount(db: BookkeepingDB, input: Account): Promise<number> {
  const name = assertName(input.name)
  return db.transaction('rw', db.accounts, async () => {
    const duplicate = await db.accounts
      .where('name')
      .equals(name)
      .filter((a) => a.id !== input.id)
      .first()
    if (duplicate) throw new Error(`已有同名账户「${name}」`)
    if (input.id !== undefined) {
      await db.accounts.update(input.id, { ...input, name })
      return input.id
    }
    return (await db.accounts.add({ initialBalance: 0, ...input, name, order: await nextOrder(db, 'accounts') })) as number
  })
}

/** 删除分类：已有流水使用时拒绝，提示改为归档 */
export async function deleteCategory(db: BookkeepingDB, id: number): Promise<void> {
  const used = await db.transactions.where('categoryId').equals(id).count()
  if (used > 0) throw new Error(`有 ${used} 笔流水使用这个分类，不能删除，可以归档`)
  await db.categories.delete(id)
}

export async function deleteAccount(db: BookkeepingDB, id: number): Promise<void> {
  const used =
    (await db.transactions.where('accountId').equals(id).count()) +
    (await db.transactions.where('transferAccountId').equals(id).count())
  if (used > 0) throw new Error(`有 ${used} 笔流水使用这个账户，不能删除，可以归档`)
  await db.accounts.delete(id)
}

/**
 * 在同组（分类按收支类型，账户全部）内上移或下移一位。
 * 移动时把整组的 order 重排为 1..n，顺带修复缺失或重复的 order。
 */
export async function moveItem(db: BookkeepingDB, table: Table, id: number, delta: -1 | 1): Promise<void> {
  await db.transaction('rw', db[table], async () => {
    const all = ((await db[table].toArray()) as (Category | Account)[]).sort(byOrder)
    const current = all.find((x) => x.id === id)
    if (!current) return
    const group =
      table === 'categories' ? all.filter((x) => (x as Category).type === (current as Category).type) : all
    const index = group.indexOf(current)
    const target = index + delta
    if (target < 0 || target >= group.length) return
    ;[group[index], group[target]] = [group[target], group[index]]
    await Promise.all(group.map((x, i) => db[table].update(x.id!, { order: i + 1 })))
  })
}

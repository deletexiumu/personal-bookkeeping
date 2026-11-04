import type { CategoryRule, ImportTemplate } from '../types'
import { byOrder } from './catalog'
import type { BookkeepingDB } from './index'

export async function listRules(db: BookkeepingDB): Promise<CategoryRule[]> {
  return (await db.rules.toArray()).sort(byOrder)
}

/**
 * 新增或修改规则。关键词去首尾空白、不能为空、不超过 40 字；
 * 同字段、同方式、同关键词的规则只保留一条（新增时改为更新原规则的分类）。
 */
export async function saveRule(db: BookkeepingDB, input: CategoryRule): Promise<number> {
  const keyword = input.keyword.trim()
  if (!keyword) throw new Error('关键词不能为空')
  if (keyword.length > 40) throw new Error('关键词最多 40 个字')
  return db.transaction('rw', db.rules, db.categories, async () => {
    if (!(await db.categories.get(input.categoryId))) throw new Error('分类不存在')
    const all = await db.rules.toArray()
    const same = all.find(
      (r) => r.id !== input.id && r.field === input.field && r.match === input.match && r.keyword.toLowerCase() === keyword.toLowerCase(),
    )
    if (same && input.id === undefined) {
      await db.rules.update(same.id!, { categoryId: input.categoryId })
      return same.id!
    }
    if (same) throw new Error('已有相同条件的规则')
    if (input.id !== undefined) {
      await db.rules.update(input.id, { field: input.field, match: input.match, keyword, categoryId: input.categoryId })
      return input.id
    }
    const order = Math.max(0, ...all.map((r) => r.order ?? 0)) + 1
    return (await db.rules.add({ field: input.field, match: input.match, keyword, categoryId: input.categoryId, order, createdAt: Date.now() })) as number
  })
}

export async function deleteRule(db: BookkeepingDB, id: number): Promise<void> {
  await db.rules.delete(id)
}

/** 调整优先级：与上一条 / 下一条交换 */
export async function moveRule(db: BookkeepingDB, id: number, delta: -1 | 1): Promise<void> {
  await db.transaction('rw', db.rules, async () => {
    const all = (await db.rules.toArray()).sort(byOrder)
    const index = all.findIndex((r) => r.id === id)
    const target = index + delta
    if (index < 0 || target < 0 || target >= all.length) return
    ;[all[index], all[target]] = [all[target], all[index]]
    await Promise.all(all.map((r, i) => db.rules.update(r.id!, { order: i + 1 })))
  })
}

export async function listImportTemplates(db: BookkeepingDB): Promise<ImportTemplate[]> {
  return db.importTemplates.orderBy('name').toArray()
}

/** 保存字段映射模板；同名模板覆盖 */
export async function saveImportTemplate(db: BookkeepingDB, input: Omit<ImportTemplate, 'id' | 'createdAt'>): Promise<number> {
  const name = input.name.trim()
  if (!name) throw new Error('模板名称不能为空')
  if (name.length > 20) throw new Error('模板名称最多 20 个字')
  return db.transaction('rw', db.importTemplates, async () => {
    const existing = await db.importTemplates.where('name').equals(name).first()
    const row: ImportTemplate = { ...input, name, createdAt: Date.now() }
    if (existing?.id !== undefined) {
      await db.importTemplates.put({ ...row, id: existing.id })
      return existing.id
    }
    return (await db.importTemplates.add(row)) as number
  })
}

export async function deleteImportTemplate(db: BookkeepingDB, id: number): Promise<void> {
  await db.importTemplates.delete(id)
}

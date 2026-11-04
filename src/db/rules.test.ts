import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BookkeepingDB } from './index'
import { deleteRule, listImportTemplates, listRules, moveRule, saveImportTemplate, saveRule } from './rules'

let db: BookkeepingDB

beforeEach(async () => {
  db = new BookkeepingDB(`test-${crypto.randomUUID()}`)
  await db.open()
})

afterEach(async () => {
  await db.delete()
})

describe('规则', () => {
  it('新增排在最后；相同条件的规则改为更新分类', async () => {
    const a = await saveRule(db, { field: 'merchant', match: 'contains', keyword: ' 星巴克 ', categoryId: 1 })
    const b = await saveRule(db, { field: 'note', match: 'contains', keyword: '午饭', categoryId: 1 })
    expect(await saveRule(db, { field: 'merchant', match: 'contains', keyword: '星巴克', categoryId: 3 })).toBe(a)
    const rules = await listRules(db)
    expect(rules.map((r) => [r.id, r.keyword, r.categoryId, r.order])).toEqual([
      [a, '星巴克', 3, 1],
      [b, '午饭', 1, 2],
    ])
    await expect(saveRule(db, { id: b, field: 'merchant', match: 'contains', keyword: '星巴克', categoryId: 1 })).rejects.toThrow('已有相同条件的规则')
    await expect(saveRule(db, { field: 'merchant', match: 'contains', keyword: ' ', categoryId: 1 })).rejects.toThrow('关键词不能为空')
    await expect(saveRule(db, { field: 'merchant', match: 'contains', keyword: 'x', categoryId: 999 })).rejects.toThrow('分类不存在')
  })

  it('调整优先级与删除', async () => {
    const a = await saveRule(db, { field: 'merchant', match: 'contains', keyword: 'A', categoryId: 1 })
    const b = await saveRule(db, { field: 'merchant', match: 'contains', keyword: 'B', categoryId: 1 })
    await moveRule(db, b, -1)
    expect((await listRules(db)).map((r) => r.id)).toEqual([b, a])
    await moveRule(db, b, -1)
    expect((await listRules(db)).map((r) => r.id)).toEqual([b, a])
    await deleteRule(db, b)
    expect((await listRules(db)).map((r) => r.id)).toEqual([a])
  })
})

describe('映射模板', () => {
  it('同名覆盖', async () => {
    const input = { name: '招行', headers: ['日期', '金额'], columns: ['date', 'amount'] as ('date' | 'amount')[], amountSign: 'negative-expense' as const }
    const id = await saveImportTemplate(db, input)
    expect(await saveImportTemplate(db, { ...input, name: ' 招行 ', amountSign: 'positive-expense' })).toBe(id)
    const list = await listImportTemplates(db)
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ name: '招行', amountSign: 'positive-expense' })
    await expect(saveImportTemplate(db, { ...input, name: '' })).rejects.toThrow('模板名称不能为空')
  })
})

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseBackup } from '../lib/backup'
import { exportBackup, planRestore, restoreBackup } from './backup'
import { BookkeepingDB } from './index'
import { saveRule } from './rules'
import { addTransaction } from './transactions'

let source: BookkeepingDB
let target: BookkeepingDB

beforeEach(async () => {
  source = new BookkeepingDB(`test-${crypto.randomUUID()}`)
  target = new BookkeepingDB(`test-${crypto.randomUUID()}`)
  await Promise.all([source.open(), target.open()])
})

afterEach(async () => {
  await Promise.all([source.delete(), target.delete()])
})

describe('备份与恢复', () => {
  it('导出后在另一台设备按 ID 合并恢复', async () => {
    await addTransaction(source, { type: 'expense', amount: 3200, categoryId: 1, accountId: 4, date: '2026-11-04', note: '午饭' })
    await saveRule(source, { field: 'any', match: 'contains', keyword: '星巴克', categoryId: 1 })
    await source.categories.update(1, { name: '吃饭' })
    const backup = await exportBackup(source, new Date('2026-11-04T08:00:00Z'))
    expect(backup).toMatchObject({ app: 'taozhubu', format: 1, schema: source.verno, exportedAt: '2026-11-04T08:00:00.000Z' })

    // 目标设备已有一笔流水（ID 1），会被覆盖；ID 2 的本地流水保留
    await addTransaction(target, { type: 'income', amount: 1, accountId: 1, date: '2026-01-01' })
    await addTransaction(target, { type: 'income', amount: 2, accountId: 1, date: '2026-01-02' })

    const { backup: parsed } = parseBackup(JSON.stringify(backup))
    const plan = await planRestore(target, parsed)
    expect(plan.transactions).toEqual({ added: 0, updated: 1 })
    expect(plan.categories).toEqual({ added: 0, updated: 11 })
    expect(plan.rules).toEqual({ added: 1, updated: 0 })

    await restoreBackup(target, parsed)
    expect(await target.transactions.get(1)).toMatchObject({ note: '午饭', amount: 3200 })
    expect(await target.transactions.get(2)).toMatchObject({ amount: 2 })
    expect((await target.categories.get(1))?.name).toBe('吃饭')
    expect(await target.rules.count()).toBe(1)
  })
})

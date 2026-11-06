import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { PreviewItem } from '../lib/import/preview'
import { commitImport, listImportBatches, loadDedupeCandidates, revertImport } from './imports'
import { BookkeepingDB } from './index'
import { addTransaction } from './transactions'

let db: BookkeepingDB

beforeEach(async () => {
  db = new BookkeepingDB(`test-${crypto.randomUUID()}`)
  await db.open()
})

afterEach(async () => {
  await db.delete()
})

const item = (key: number, selected = true): PreviewItem => ({
  key,
  row: { line: key + 2, date: '2026-10-31', time: '12:08', type: 'expense', amount: 100 * (key + 1), merchant: `商户${key}`, ref: `R${key}` },
  accountId: 2,
  categoryId: key === 0 ? 1 : undefined,
  selected,
})

describe('导入批次', () => {
  it('只写入勾选的行，记来源和批次', async () => {
    const batchId = await commitImport(db, { source: 'csv', fileName: 'a.csv', rowCount: 3, items: [item(0), item(1), item(2, false)] })
    const rows = await db.transactions.where('importBatchId').equals(batchId).toArray()
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ source: 'import', merchant: '商户0', categoryId: 1, accountId: 2, externalId: 'R0', time: '12:08' })
    expect(rows[1].categoryId).toBeUndefined()
    const [batch] = await listImportBatches(db)
    expect(batch).toMatchObject({ id: batchId, fileName: 'a.csv', rowCount: 3, importedCount: 2, status: 'done' })
  })

  it('保存时按交易单号去重：账本里已有的单号和本次重复的单号都不再写入', async () => {
    await addTransaction(db, { type: 'expense', amount: 100, accountId: 2, date: '2026-10-31', externalId: 'R0' })
    const dupInBatch = { ...item(2), key: 3 }
    const batchId = await commitImport(db, { source: 'wechat', fileName: 'b.xlsx', rowCount: 4, items: [item(0), item(1), item(2), dupInBatch] })
    const rows = await db.transactions.where('importBatchId').equals(batchId).toArray()
    expect(rows.map((r) => r.externalId)).toEqual(['R1', 'R2'])
    expect(await db.importBatches.get(batchId)).toMatchObject({ importedCount: 2 })
    expect(await db.transactions.where('externalId').equals('R0').count()).toBe(1)
  })

  it('能合并的行更新已有流水，不新增，并记合并条数', async () => {
    await db.accounts.bulkPut([
      { id: 2, name: '招行卡' },
      { id: 3, name: '支付宝' },
    ])
    const walletId = await addTransaction(db, { type: 'expense', amount: 600, accountId: 3, date: '2026-10-31', merchant: '家和鲜包点', externalId: 'W1', categoryId: 1 })
    const wallet = (await db.transactions.get(walletId))!
    const bankRow: PreviewItem = {
      key: 0,
      row: { line: 2, date: '2026-10-31', type: 'expense', amount: 600, merchant: '家和鲜包点', note: '快捷支付' },
      accountId: 2,
      mergeWith: wallet,
      selected: true,
    }
    const batchId = await commitImport(db, { source: 'bank', fileName: '招商银行交易流水.pdf', rowCount: 2, items: [bankRow, item(1)], sourceLabel: '招商银行流水' })
    expect(await db.transactions.count()).toBe(2)
    expect(await db.importBatches.get(batchId)).toMatchObject({ importedCount: 1, mergedCount: 1 })
    const merged = (await db.transactions.get(walletId))!
    expect(merged).toMatchObject({ accountId: 2, externalId: 'W1', categoryId: 1, dirty: 1 })
    expect(merged.merged).toEqual([{ label: '招商银行流水', date: '2026-10-31', merchant: '家和鲜包点', note: '快捷支付', account: '招行卡' }])
  })

  it('要合并的已有流水已被删除时照常新增', async () => {
    const ghost = { id: 999, type: 'expense', amount: 600, accountId: 3, date: '2026-10-31', source: 'import', externalId: 'W1', createdAt: 1, updatedAt: 1 } as const
    const bankRow: PreviewItem = { key: 0, row: { line: 2, date: '2026-10-31', type: 'expense', amount: 600, note: '快捷支付' }, accountId: 2, mergeWith: ghost, selected: true }
    const batchId = await commitImport(db, { source: 'bank', fileName: 'b.pdf', rowCount: 1, items: [bankRow] })
    expect(await db.importBatches.get(batchId)).toMatchObject({ importedCount: 1 })
    expect(await db.transactions.count()).toBe(1)
  })

  it('整批撤销删除该批次流水，不影响其他记录', async () => {
    await addTransaction(db, { type: 'expense', amount: 1, accountId: 1, date: '2026-10-31' })
    const batchId = await commitImport(db, { source: 'csv', fileName: 'a.csv', rowCount: 2, items: [item(0), item(1)] })
    expect(await revertImport(db, batchId)).toBe(2)
    expect(await db.transactions.count()).toBe(1)
    expect(await db.importBatches.get(batchId)).toMatchObject({ status: 'reverted' })
    expect(await revertImport(db, batchId)).toBe(0)
  })

  it('去重候选：日期前后各一天，加上单号相同的流水', async () => {
    await addTransaction(db, { type: 'expense', amount: 1, accountId: 1, date: '2026-10-29' })
    await addTransaction(db, { type: 'expense', amount: 1, accountId: 1, date: '2026-10-30' })
    await addTransaction(db, { type: 'expense', amount: 1, accountId: 1, date: '2026-11-02' })
    await addTransaction(db, { type: 'expense', amount: 1, accountId: 1, date: '2025-01-01', externalId: 'OLD' })
    const found = await loadDedupeCandidates(db, ['2026-11-01', '2026-10-31'], ['OLD'])
    expect(found.map((t) => t.date).sort()).toEqual(['2025-01-01', '2026-10-30', '2026-11-02'])
  })
})

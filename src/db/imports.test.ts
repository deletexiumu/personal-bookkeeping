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

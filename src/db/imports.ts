import { shiftDate } from '../lib/date'
import { toTransaction, type PreviewItem } from '../lib/import/preview'
import type { ImportBatch, ImportSource, Transaction } from '../types'
import type { BookkeepingDB } from './index'

/** 去重候选：日期范围前后各多 1 天的已有流水，加上单号相同的流水 */
export async function loadDedupeCandidates(db: BookkeepingDB, dates: string[], refs: string[]): Promise<Transaction[]> {
  if (dates.length === 0) return []
  const sorted = [...dates].sort()
  const inRange = await db.transactions
    .where('date')
    .between(shiftDate(sorted[0], -1), shiftDate(sorted.at(-1)!, 1), true, true)
    .toArray()
  const byRef = refs.length > 0 ? await db.transactions.where('externalId').anyOf(refs).toArray() : []
  const seen = new Set(inRange.map((t) => t.id))
  return [...inRange, ...byRef.filter((t) => !seen.has(t.id))]
}

/** 有商户的流水，用于「历史同商户」自动分类 */
export async function loadMerchantTransactions(db: BookkeepingDB): Promise<Transaction[]> {
  return db.transactions.filter((t) => !!t.merchant).toArray()
}

export interface CommitInput {
  source: ImportSource
  fileName: string
  rowCount: number
  items: PreviewItem[]
}

/** 把勾选的预览行写入账本并记一条导入批次，返回批次 ID */
export async function commitImport(db: BookkeepingDB, input: CommitInput): Promise<number> {
  const chosen = input.items.filter((i) => i.selected)
  const now = Date.now()
  return db.transaction('rw', db.transactions, db.importBatches, async () => {
    const batchId = (await db.importBatches.add({
      source: input.source,
      fileName: input.fileName,
      rowCount: input.rowCount,
      importedCount: chosen.length,
      createdAt: now,
      status: 'done',
    })) as number
    await db.transactions.bulkAdd(
      // createdAt 递减，让同一时间的行在明细中保持文件里的先后顺序
      chosen.map((item, i) => ({ ...toTransaction(item), importBatchId: batchId, createdAt: now - i, updatedAt: now })),
    )
    return batchId
  })
}

export async function listImportBatches(db: BookkeepingDB): Promise<ImportBatch[]> {
  return db.importBatches.orderBy('createdAt').reverse().toArray()
}

/** 整批撤销：删除该批次写入的全部流水（含导入后编辑过的），返回删除条数 */
export async function revertImport(db: BookkeepingDB, batchId: number): Promise<number> {
  return db.transaction('rw', db.transactions, db.importBatches, async () => {
    const batch = await db.importBatches.get(batchId)
    if (!batch) throw new Error('导入记录不存在')
    if (batch.status === 'reverted') return 0
    const removed = await db.transactions.where('importBatchId').equals(batchId).delete()
    await db.importBatches.update(batchId, { status: 'reverted', revertedAt: Date.now() })
    return removed
  })
}

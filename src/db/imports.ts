import { shiftDate } from '../lib/date'
import { flowOf, mergeTransaction, stillMergeable, transferFee, toTransaction, type PreviewItem } from '../lib/import/preview'
import { purchaseEntry, REFUND_WINDOW_DAYS, refundEntry } from '../lib/import/refund'
import type { ImportBatch, ImportSource, MergedEntry, Transaction } from '../types'
import type { BookkeepingDB } from './index'

/** 去重候选：日期范围前后各多 2 天的已有流水（本人账户间转账两边最多差 2 天），加上单号相同的流水 */
export async function loadDedupeCandidates(db: BookkeepingDB, dates: string[], refs: string[]): Promise<Transaction[]> {
  if (dates.length === 0) return []
  const sorted = [...dates].sort()
  const inRange = await db.transactions
    .where('date')
    .between(shiftDate(sorted[0], -2), shiftDate(sorted.at(-1)!, 2), true, true)
    .toArray()
  const byRef = refs.length > 0 ? await db.transactions.where('externalId').anyOf(refs).toArray() : []
  const seen = new Set(inRange.map((t) => t.id))
  return [...inRange, ...byRef.filter((t) => !seen.has(t.id))]
}

/** 退款可能对应的原支出：最早一笔退款之前 120 天到最晚一笔退款之间的支出 */
export async function loadRefundPurchases(db: BookkeepingDB, refundDates: string[]): Promise<Transaction[]> {
  if (refundDates.length === 0) return []
  const sorted = [...refundDates].sort()
  return db.transactions
    .where('date')
    .between(shiftDate(sorted[0], -REFUND_WINDOW_DAYS), sorted.at(-1)!, true, true)
    .filter((t) => t.type === 'expense')
    .toArray()
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
  /** 本次账单的名称，合并时记在明细里，如「招商银行流水」 */
  sourceLabel?: string
}

/** 已有流水的来源说明：手记，或导入它的账单（银行流水按文件名里的银行名） */
export function sourceLabelOf(t: Transaction, batch: ImportBatch | undefined): string {
  if (t.source === 'manual') return '手记'
  if (!batch) return '导入流水'
  const named = { wechat: '微信账单', alipay: '支付宝账单', douyin: '抖音支付账单', bank: '银行流水', csv: '导入流水', json: '导入流水' }[batch.source]
  if (batch.source !== 'bank' && batch.source !== 'csv') return named
  const bank = /(?:招商|中信|工商|建设|农业|交通|中国|邮储|浦发|广发|平安|兴业|民生|光大|华夏)银行/.exec(batch.fileName)?.[0]
  return bank ? `${bank}流水` : named
}

/**
 * 把勾选的预览行写入账本并记一条导入批次，返回批次 ID。
 * 能合并的行（mergeWith）不新增，而是更新已有那条（见 mergeTransaction）；已有那条被删了或已不能合并时照常新增。
 * 退款（refundOf）：全额退款时退款照常写入，它和原支出都标为不计收支；部分退款不写入，原支出减掉退款金额，
 * 退款记进原支出的明细。原支出已变（被删、金额不对）时退款按普通收入写入。
 * 写入前按交易单号再去重一次：账本里已有同单号的流水（例如预览之后在别处又导入了一份重叠的账单），
 * 或本次勾选里单号重复的行，都不再写入。
 */
export async function commitImport(db: BookkeepingDB, input: CommitInput): Promise<number> {
  const selected = input.items.filter((i) => i.selected)
  const now = Date.now()
  return db.transaction('rw', [db.transactions, db.importBatches, db.accounts], async () => {
    const refs = [...new Set(selected.flatMap((i) => (i.row.ref ? [i.row.ref] : [])))]
    const taken = new Set(
      refs.length > 0 ? (await db.transactions.where('externalId').anyOf(refs).toArray()).map((t) => t.externalId) : [],
    )
    const chosen = selected.filter((item) => {
      const ref = item.row.ref
      if (!ref) return true
      if (taken.has(ref)) return false
      taken.add(ref)
      return true
    })
    const accountNames = new Map((await db.accounts.toArray()).map((a) => [a.id, a.name]))
    const batchCache = new Map<number, ImportBatch | undefined>()
    const batchOf = async (id: number | undefined) => {
      if (id === undefined) return undefined
      if (!batchCache.has(id)) batchCache.set(id, await db.importBatches.get(id))
      return batchCache.get(id)
    }
    type Draft = Omit<Transaction, 'id' | 'createdAt' | 'updatedAt' | 'importBatchId'>
    const label = input.sourceLabel ?? input.fileName
    const drafts: Draft[] = []
    const draftOf = new Map<number, Draft>()
    const fees: Draft[] = []
    let mergedRows = 0
    const chosenKeys = new Set(chosen.map((i) => i.key))
    const insert = (item: PreviewItem, patch: Partial<Draft> = {}) => {
      const draft: Draft = { ...toTransaction(item), ...patch }
      if (draft.categoryId === undefined) delete draft.categoryId
      drafts.push(draft)
      draftOf.set(item.key, draft)
    }
    /** 本次要改的已有流水：同一条可能先被合并、又被退款，后一步要在前一步的结果上改 */
    const pending = new Map<number, Transaction>()
    const load = async (id: number | undefined) => (id === undefined ? undefined : (pending.get(id) ?? (await db.transactions.get(id))))
    const save = (t: Transaction) => pending.set(t.id!, { ...t, updatedAt: now })
    // 退款放到最后、按日期先后处理：原支出可能是本批次里的行，或刚被合并过的已有流水
    const refunds = chosen.filter((i) => i.refundOf).sort((a, b) => a.row.date.localeCompare(b.row.date))
    for (const item of chosen) {
      if (item.refundOf) continue
      const current = await load(item.mergeWith?.id)
      const currentSource = (await batchOf(current?.importBatchId))?.source
      // 预览之后已有那条被删了，或在别处已经合并过：照常新增
      if (!current || !stillMergeable(current, item, input.source, () => currentSource)) {
        insert(item)
        continue
      }
      const merged = mergeTransaction(current, item, {
        incoming: label,
        existing: sourceLabelOf(current, await batchOf(current.importBatchId)),
        accountName: (id) => accountNames.get(id),
      })
      save(merged)
      mergedRows++
      // 提现扣的手续费：转账按到账金额记，差额记一笔支出
      if (item.transferPair) {
        const rowOut = flowOf(item.row, !!item.row.ref) === 'expense'
        const [out, inn] = rowOut ? [item.row.amount, current.amount] : [current.amount, item.row.amount]
        const fee = transferFee(out, inn, item.row.note, current.note)
        if (fee) fees.push({ type: 'expense', amount: fee, accountId: merged.accountId, date: merged.date, time: merged.time, note: '提现手续费', source: 'import' })
      }
    }
    // 退款：按原支出现在的金额决定全额还是部分；原支出不在了、已不计收支或金额不够时，退款按普通收入写入
    for (const item of refunds) {
      const target = item.refundOf!
      const entry = refundEntry(item.row, label, accountNames.get(item.accountId))
      const asExcludedRefund = (from: MergedEntry): Partial<Draft> => ({ excluded: true, categoryId: undefined, merged: [from] })
      if (target.key !== undefined) {
        const draft = chosenKeys.has(target.key) ? draftOf.get(target.key) : undefined
        if (!draft || draft.excluded || draft.type !== 'expense' || draft.amount < item.row.amount) {
          insert(item)
          continue
        }
        draft.merged = [...(draft.merged ?? []), entry]
        if (draft.amount === item.row.amount) {
          draft.excluded = true
          insert(item, asExcludedRefund(purchaseEntry({ ...draft, ref: draft.externalId }, label)))
        } else {
          draft.amount -= item.row.amount
          mergedRows++
        }
        continue
      }
      const current = await load(target.tx?.id)
      if (!current || current.type !== 'expense' || current.excluded || current.amount < item.row.amount) {
        insert(item)
        continue
      }
      if (current.amount === item.row.amount) {
        save({ ...current, excluded: true, merged: [...(current.merged ?? []), entry] })
        const from = purchaseEntry({ ...current, ref: current.externalId }, sourceLabelOf(current, await batchOf(current.importBatchId)))
        insert(item, asExcludedRefund(from))
      } else {
        save({ ...current, amount: current.amount - item.row.amount, merged: [...(current.merged ?? []), entry] })
        mergedRows++
      }
    }
    const merges = [...pending.values()]
    const batchId = (await db.importBatches.add({
      source: input.source,
      fileName: input.fileName,
      rowCount: input.rowCount,
      importedCount: drafts.length,
      ...(mergedRows > 0 ? { mergedCount: mergedRows } : {}),
      createdAt: now,
      status: 'done',
    })) as number
    await db.transactions.bulkAdd(
      // createdAt 递减，让同一时间的行在明细中保持文件里的先后顺序
      [...drafts, ...fees].map((t, i) => ({ ...t, importBatchId: batchId, createdAt: now - i, updatedAt: now })),
    )
    if (merges.length > 0) await db.transactions.bulkPut(merges)
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

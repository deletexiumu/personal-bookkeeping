import { shiftDate } from '../lib/date'
import { flowOf, mergeTransaction, stillMergeable, transferFee, toTransaction, type PreviewItem } from '../lib/import/preview'
import { purchaseEntry, refundEntry } from '../lib/import/refund'
import type { ImportBatch, ImportSource, Transaction } from '../types'
import type { BookkeepingDB } from './index'

/**
 * 去重候选：日期范围前后各多 2 天的已有流水（本人账户间转账两边最多差 2 天），加上单号相同的流水。
 * 有退款时 lookbackDays 传退款窗口，往前多取，找得到原支出。
 */
export async function loadDedupeCandidates(db: BookkeepingDB, dates: string[], refs: string[], lookbackDays = 2): Promise<Transaction[]> {
  if (dates.length === 0) return []
  const sorted = [...dates].sort()
  const inRange = await db.transactions
    .where('date')
    .between(shiftDate(sorted[0], -Math.max(2, lookbackDays)), shiftDate(sorted.at(-1)!, 2), true, true)
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
    const merges: Transaction[] = []
    const fees: Draft[] = []
    let mergedRows = 0
    const chosenKeys = new Set(chosen.map((i) => i.key))
    /** 本批次里的原支出（按序号）→ 退它的行 */
    const batchRefunds = new Map<number, PreviewItem[]>()
    const insert = (item: PreviewItem, patch: Partial<Draft> = {}) => {
      const draft = { ...toTransaction(item), ...patch }
      drafts.push(draft)
      draftOf.set(item.key, draft)
    }
    for (const item of chosen) {
      const refund = item.refundOf
      if (refund?.tx?.id !== undefined) {
        const current = await db.transactions.get(refund.tx.id)
        const fits =
          !!current && current.type === 'expense' && !current.excluded && (refund.full ? current.amount === item.row.amount : current.amount > item.row.amount)
        if (!current || !fits) {
          insert(item)
          continue
        }
        const entry = refundEntry(item.row, label, accountNames.get(item.accountId))
        if (refund.full) {
          merges.push({ ...current, excluded: true, merged: [...(current.merged ?? []), entry], updatedAt: now })
          const from = purchaseEntry({ ...current, ref: current.externalId }, sourceLabelOf(current, await batchOf(current.importBatchId)))
          insert(item, { excluded: true, merged: [from] })
        } else {
          merges.push({ ...current, amount: current.amount - item.row.amount, merged: [...(current.merged ?? []), entry], updatedAt: now })
          mergedRows++
        }
        continue
      }
      if (refund?.key !== undefined) {
        if (!chosenKeys.has(refund.key)) {
          insert(item)
          continue
        }
        batchRefunds.set(refund.key, [...(batchRefunds.get(refund.key) ?? []), item])
        if (refund.full) {
          const p = refund.purchase
          insert(item, { excluded: true, merged: [purchaseEntry({ ...p, ref: input.items.find((i) => i.key === p.key)?.row.ref }, label)] })
        } else mergedRows++
        continue
      }
      const current = item.mergeWith?.id === undefined ? undefined : await db.transactions.get(item.mergeWith.id)
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
      merges.push({ ...merged, updatedAt: now })
      mergedRows++
      // 提现扣的手续费：转账按到账金额记，差额记一笔支出
      if (item.transferPair) {
        const rowOut = flowOf(item.row, !!item.row.ref) === 'expense'
        const [out, inn] = rowOut ? [item.row.amount, current.amount] : [current.amount, item.row.amount]
        const fee = transferFee(out, inn, item.row.note, current.note)
        if (fee) fees.push({ type: 'expense', amount: fee, accountId: merged.accountId, date: merged.date, time: merged.time, note: '提现手续费', source: 'import' })
      }
    }
    // 本批次里先买后退：全额退款时原支出标为不计收支；部分退款从原支出里扣
    for (const [key, refunds] of batchRefunds) {
      const draft = draftOf.get(key)
      if (!draft) continue
      for (const r of refunds) {
        draft.merged = [...(draft.merged ?? []), refundEntry(r.row, label, accountNames.get(r.accountId))]
        if (r.refundOf!.full) draft.excluded = true
        else draft.amount -= r.row.amount
      }
    }
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

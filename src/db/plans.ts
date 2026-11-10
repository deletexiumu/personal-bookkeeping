import { shiftDate } from '../lib/date'
import {
  assignPlans,
  candidateOf,
  expandPlans,
  isOpen,
  MAX_PLAN_WINDOW,
  parsePlanRef,
  plannable,
  planWindow,
  type PlanOccurrence,
} from '../lib/plans'
import { normalizeTags } from '../lib/tags'
import type { Plan, Transaction } from '../types'
import type { BookkeepingDB } from './index'
import { ensureTags } from './tags'

/** 预算账单的读写，以及把实际流水关联到某一期（写流水的 planRef） */

export async function listPlans(db: BookkeepingDB): Promise<Plan[]> {
  return (await db.plans.toArray()).sort((a, b) => a.startDate.localeCompare(b.startDate) || a.name.localeCompare(b.name, 'zh-CN'))
}

/** 关联了预算的流水 */
export async function listLinked(db: BookkeepingDB): Promise<Transaction[]> {
  return db.transactions.where('planRef').above('').toArray()
}

/** [from, to] 里的各期（含状态和对应的实际流水） */
export async function loadOccurrences(db: BookkeepingDB, from: string, to: string, todayDate: string): Promise<PlanOccurrence[]> {
  const plans = await db.plans.toArray()
  if (plans.length === 0) return []
  return expandPlans(plans, from, to, await listLinked(db), todayDate)
}

/** 一批日期附近（前后各多日期容差上限）还能对上的期，导入预览用 */
export async function loadOpenOccurrences(db: BookkeepingDB, dates: string[], todayDate: string): Promise<PlanOccurrence[]> {
  if (dates.length === 0) return []
  const sorted = [...dates].sort()
  const all = await loadOccurrences(db, shiftDate(sorted[0], -MAX_PLAN_WINDOW), shiftDate(sorted.at(-1)!, MAX_PLAN_WINDOW), todayDate)
  return all.filter(isOpen)
}

export type PlanInput = Omit<Plan, 'id' | 'uid' | 'createdAt' | 'updatedAt' | 'modifiedAt' | 'dirty'>

function clean(input: PlanInput): PlanInput {
  const name = input.name.trim()
  if (!name) throw new Error('请填写名称')
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) throw new Error('金额不正确')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startDate)) throw new Error('日期不正确')
  if (input.endDate && input.endDate < input.startDate) throw new Error('结束日期不能早于第一期')
  const plan: PlanInput = { ...input, name }
  const tags = normalizeTags(input.tags ?? [])
  if (tags) plan.tags = tags
  else delete plan.tags
  if (plan.repeat === 'none') {
    delete plan.interval
    delete plan.endDate
  } else if (!plan.interval || plan.interval <= 1) delete plan.interval
  for (const key of Object.keys(plan) as (keyof PlanInput)[]) {
    const v = plan[key]
    if (v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) delete plan[key]
  }
  if (!plan.tolerance) delete plan.tolerance
  if (plan.window === undefined || plan.window === 3) delete plan.window
  return plan
}

/**
 * 新建或修改预算账单；保存后对开始日期以来已有的流水跑一遍匹配，强对应的直接关联。返回 ID 和新关联的条数。
 * 修改时保留跳过的期和单期改过的金额。
 */
export async function savePlan(
  db: BookkeepingDB,
  input: PlanInput,
  id: number | undefined,
  todayDate: string,
): Promise<{ id: number; linked: number }> {
  const plan = clean(input)
  if (plan.tags) await ensureTags(db, plan.tags)
  return db.transaction('rw', db.plans, db.transactions, async () => {
    const now = Date.now()
    let planId: number
    if (id !== undefined) {
      const current = await db.plans.get(id)
      if (!current) throw new Error('预算不存在或已被删除')
      const next: Plan = { ...plan, id, uid: current.uid, createdAt: current.createdAt, updatedAt: now }
      if (current.skipped?.length) next.skipped = current.skipped
      if (current.overrides && Object.keys(current.overrides).length) next.overrides = current.overrides
      await db.plans.put(next)
      planId = id
    } else {
      planId = (await db.plans.add({ ...plan, createdAt: now, updatedAt: now })) as number
    }
    const saved = (await db.plans.get(planId))!
    return { id: planId, linked: await linkExisting(db, saved, todayDate) }
  })
}

/** 已有流水里能对上这条预算各期的（强对应），写上 planRef；返回关联条数 */
export async function linkExisting(db: BookkeepingDB, plan: Plan, todayDate: string): Promise<number> {
  const window = planWindow(plan)
  const until = plan.endDate && plan.endDate < todayDate ? plan.endDate : todayDate
  if (plan.startDate > shiftDate(until, window)) return 0
  const linked = await listLinked(db)
  const occurrences = expandPlans([plan], plan.startDate, shiftDate(until, window), linked, todayDate)
  const txs = (await db.transactions.where('date').between(shiftDate(plan.startDate, -window), shiftDate(until, window), true, true).toArray()).filter(
    plannable,
  )
  const assigned = assignPlans(
    txs.map((t) => ({ key: t.id!, candidate: candidateOf(t) })),
    occurrences,
  )
  const now = Date.now()
  let n = 0
  for (const [txId, a] of assigned) {
    if (!a.linked) continue
    await db.transactions.update(txId, { planRef: a.occurrence.ref, updatedAt: now })
    n++
  }
  return n
}

/** 删除预算账单；对应过它的流水取消关联（流水本身保留） */
export async function deletePlan(db: BookkeepingDB, id: number): Promise<void> {
  await db.transaction('rw', db.plans, db.transactions, async () => {
    const plan = await db.plans.get(id)
    if (!plan) return
    if (plan.uid) await unlinkWhere(db, (ref) => parsePlanRef(ref)?.uid === plan.uid)
    await db.plans.delete(id)
  })
}

async function unlinkWhere(db: BookkeepingDB, test: (ref: string) => boolean): Promise<void> {
  const now = Date.now()
  await db.transactions
    .where('planRef')
    .above('')
    .modify((t) => {
      if (!t.planRef || !test(t.planRef)) return
      delete t.planRef
      t.updatedAt = now
    })
}

/** 跳过 / 恢复某一期 */
export async function setOccurrenceSkipped(db: BookkeepingDB, planId: number, date: string, skipped: boolean): Promise<void> {
  await db.transaction('rw', db.plans, async () => {
    const plan = await db.plans.get(planId)
    if (!plan) return
    const set = new Set(plan.skipped ?? [])
    if (skipped) set.add(date)
    else set.delete(date)
    const list = [...set].sort()
    const next: Plan = { ...plan, updatedAt: Date.now() }
    if (list.length) next.skipped = list
    else delete next.skipped
    await db.plans.put(next)
  })
}

/** 手动把流水关联到某一期，或取消关联（ref 为 undefined） */
export async function setTransactionPlan(db: BookkeepingDB, txId: number, ref: string | undefined): Promise<void> {
  await db.transaction('rw', db.transactions, async () => {
    const t = await db.transactions.get(txId)
    if (!t) throw new Error('记录不存在或已被删除')
    const next: Transaction = { ...t, updatedAt: Date.now() }
    if (ref) next.planRef = ref
    else delete next.planRef
    await db.transactions.put(next)
  })
}

/**
 * 记一笔后自动对预算：只认强对应。对上时写入 planRef 并返回那一期，没有返回 undefined。
 */
export async function autoLinkTransaction(db: BookkeepingDB, txId: number, todayDate: string): Promise<PlanOccurrence | undefined> {
  return db.transaction('rw', db.plans, db.transactions, async () => {
    const t = await db.transactions.get(txId)
    if (!t || !plannable(t)) return undefined
    const open = await loadOpenOccurrences(db, [t.date], todayDate)
    const a = assignPlans([{ key: txId, candidate: candidateOf(t) }], open).get(txId)
    if (!a?.linked) return undefined
    await db.transactions.update(txId, { planRef: a.occurrence.ref, updatedAt: Date.now() })
    return a.occurrence
  })
}

export interface RealizeInput {
  amount: number
  accountId: number
  date: string
  note?: string
}

/**
 * 「已发生」：按这一期预算记一笔实际流水并直接关联（分类、标签沿用预算），返回新流水 ID。
 * 之后导入的钱包账单会按现有规则和这条手记合并。
 */
export async function realizeOccurrence(db: BookkeepingDB, o: PlanOccurrence, input: RealizeInput): Promise<number> {
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) throw new Error('金额不正确')
  const { plan } = o
  const now = Date.now()
  const tx: Transaction = {
    type: plan.type,
    amount: input.amount,
    accountId: input.accountId,
    date: input.date,
    note: input.note ?? plan.note ?? plan.name,
    source: 'manual',
    planRef: o.ref,
    createdAt: now,
    updatedAt: now,
  }
  if (plan.categoryId !== undefined) tx.categoryId = plan.categoryId
  if (plan.tags?.length) tx.tags = plan.tags
  return (await db.transactions.add(tx)) as number
}

/** 改某一期的计划金额；amount 为 undefined 或等于每期金额时恢复默认 */
export async function setOccurrenceAmount(db: BookkeepingDB, planId: number, date: string, amount: number | undefined): Promise<void> {
  await db.transaction('rw', db.plans, async () => {
    const plan = await db.plans.get(planId)
    if (!plan) return
    const overrides = { ...plan.overrides }
    if (amount === undefined || amount === plan.amount) delete overrides[date]
    else {
      if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('金额不正确')
      overrides[date] = amount
    }
    const next: Plan = { ...plan, updatedAt: Date.now() }
    if (Object.keys(overrides).length) next.overrides = overrides
    else delete next.overrides
    await db.plans.put(next)
  })
}

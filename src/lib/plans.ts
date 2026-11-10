import type { PreviewItem } from './import/preview'
import { shiftDate, shiftMonth } from './date'
import { normalizeText } from './import/similarity'
import { statType } from './stats'
import type { Plan, PlanRepeat, Transaction } from '../types'

/**
 * 预算账单的纯逻辑：按重复规则展开每一期、每期的状态，以及实际流水与某一期的匹配。
 *
 * 一期的标识是 `${预算 uid}@${期日期}`，记在实现它的流水的 planRef 上。期本身不存，状态读取时算：
 * - done 已实现：有流水指向它
 * - skipped 已跳过
 * - overdue 已逾期：过了期日期再加日期容差仍没对上
 * - pending 待发生
 */

export const DEFAULT_PLAN_WINDOW = 3
/** 日期容差上限（天），也决定读取已有流水时前后多看几天 */
export const MAX_PLAN_WINDOW = 31
/** 展开时最多生成多少期，防止异常规则卡住 */
const MAX_OCCURRENCES = 5000

export const REPEAT_LABELS: Record<PlanRepeat, string> = {
  none: '不重复',
  weekly: '每周',
  monthly: '每月',
  yearly: '每年',
}

const UNIT_LABELS: Record<Exclude<PlanRepeat, 'none'>, string> = { weekly: '周', monthly: '个月', yearly: '年' }

export type PlanStatus = 'done' | 'skipped' | 'overdue' | 'pending'

export const PLAN_STATUS_LABELS: Record<PlanStatus, string> = {
  done: '已实现',
  skipped: '已跳过',
  overdue: '已逾期',
  pending: '待发生',
}

export interface PlanOccurrence {
  plan: Plan
  /** `${plan.uid}@${date}` */
  ref: string
  date: string
  /** 这一期的计划金额（分），单期改过时取改过的 */
  amount: number
  status: PlanStatus
  /** 对应的实际流水 */
  transactions: Transaction[]
  /** 实际金额合计（分） */
  actual: number
}

/** 「每月 15 日」「每 2 周 · 周三」「2026-11-15 一次」这样的说明 */
export function repeatText(plan: Pick<Plan, 'repeat' | 'interval' | 'startDate'>): string {
  const [, m, d] = plan.startDate.split('-').map(Number)
  if (plan.repeat === 'none') return `${plan.startDate} 一次`
  const n = plan.interval && plan.interval > 1 ? plan.interval : 1
  const every = n > 1 ? `每 ${n} ${UNIT_LABELS[plan.repeat]}` : REPEAT_LABELS[plan.repeat]
  if (plan.repeat === 'weekly') return `${every} · 周${'日一二三四五六'[weekdayOf(plan.startDate)]}`
  if (plan.repeat === 'monthly') return `${every} ${d >= 31 ? '月末' : `${d} 日`}`
  return `${every} ${m} 月 ${d} 日`
}

function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d).getDay()
}

function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number)
  return new Date(y, m, 0).getDate()
}

/** 某月里按「每月 day 日」取的日期，没有这一天时取月末 */
function dayIn(month: string, day: number): string {
  return `${month}-${String(Math.min(day, daysInMonth(month))).padStart(2, '0')}`
}

/** 第 n 期（从 0 起）的日期 */
function nthDate(plan: Pick<Plan, 'repeat' | 'interval' | 'startDate'>, n: number): string {
  const step = Math.max(1, Math.floor(plan.interval ?? 1)) * n
  const day = Number(plan.startDate.slice(8, 10))
  switch (plan.repeat) {
    case 'weekly':
      return shiftDate(plan.startDate, 7 * step)
    case 'monthly':
      return dayIn(shiftMonth(plan.startDate.slice(0, 7), step), day)
    case 'yearly':
      return dayIn(shiftMonth(plan.startDate.slice(0, 7), 12 * step), day)
    default:
      return plan.startDate
  }
}

/** 落在 [from, to]（含首尾）里的各期日期，按先后 */
export function occurrenceDates(plan: Pick<Plan, 'repeat' | 'interval' | 'startDate' | 'endDate'>, from: string, to: string): string[] {
  const last = plan.endDate && plan.endDate < to ? plan.endDate : to
  if (plan.repeat === 'none') return plan.startDate >= from && plan.startDate <= last ? [plan.startDate] : []
  const dates: string[] = []
  for (let n = 0; n < MAX_OCCURRENCES; n++) {
    const date = nthDate(plan, n)
    if (date > last) break
    if (date >= from) dates.push(date)
  }
  return dates
}

export function planRefOf(plan: Pick<Plan, 'uid'>, date: string): string {
  return `${plan.uid}@${date}`
}

export function parsePlanRef(ref: string): { uid: string; date: string } | undefined {
  const at = ref.lastIndexOf('@')
  if (at <= 0) return undefined
  return { uid: ref.slice(0, at), date: ref.slice(at + 1) }
}

export function planWindow(plan: Pick<Plan, 'window'>): number {
  const w = plan.window ?? DEFAULT_PLAN_WINDOW
  return Math.min(MAX_PLAN_WINDOW, Math.max(0, Math.floor(w)))
}

export function planAmountOn(plan: Pick<Plan, 'amount' | 'overrides'>, date: string): number {
  return plan.overrides?.[date] ?? plan.amount
}

/**
 * 展开 [from, to] 里的各期。linked 是带 planRef 的流水（可以多给，不相干的会忽略）。
 * 已有流水指向、但已不在重复规则上的期（改过开始日期等）也列出来，算已实现，历史不丢。
 */
export function expandPlans(plans: Plan[], from: string, to: string, linked: Transaction[], todayDate: string): PlanOccurrence[] {
  const byRef = new Map<string, Transaction[]>()
  for (const t of linked) {
    if (!t.planRef) continue
    const list = byRef.get(t.planRef)
    if (list) list.push(t)
    else byRef.set(t.planRef, [t])
  }
  const out: PlanOccurrence[] = []
  for (const plan of plans) {
    if (!plan.uid) continue
    const dates = new Set(occurrenceDates(plan, from, to))
    const prefix = `${plan.uid}@`
    for (const ref of byRef.keys()) {
      const date = ref.startsWith(prefix) ? ref.slice(prefix.length) : undefined
      if (date && date >= from && date <= to) dates.add(date)
    }
    const window = planWindow(plan)
    for (const date of dates) {
      const ref = planRefOf(plan, date)
      const transactions = byRef.get(ref) ?? []
      const status: PlanStatus = transactions.length
        ? 'done'
        : plan.skipped?.includes(date)
          ? 'skipped'
          : shiftDate(date, window) < todayDate
            ? 'overdue'
            : 'pending'
      out.push({
        plan,
        ref,
        date,
        amount: planAmountOn(plan, date),
        status,
        transactions,
        actual: transactions.reduce((sum, t) => sum + t.amount, 0),
      })
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.plan.name.localeCompare(b.plan.name, 'zh-CN'))
}

/** 还能被实际流水对上的期：待发生和已逾期 */
export function isOpen(o: Pick<PlanOccurrence, 'status'>): boolean {
  return o.status === 'pending' || o.status === 'overdue'
}

/** 下一期：今天及以后第一期还没实现、没跳过的；都没有时为 undefined */
export function nextOccurrence(plan: Plan, todayDate: string, linked: Transaction[]): PlanOccurrence | undefined {
  const horizon = plan.repeat === 'yearly' ? shiftMonth(todayDate.slice(0, 7), 12 * Math.max(1, plan.interval ?? 1) + 1) : shiftMonth(todayDate.slice(0, 7), 13)
  return expandPlans([plan], todayDate, `${horizon}-31`, linked, todayDate).find((o) => o.status === 'pending')
}

/** 参与匹配的一笔实际收支 */
export interface PlanCandidate {
  type: Transaction['type']
  amount: number
  date: string
  merchant?: string
  note?: string
  goods?: string
  categoryId?: number
  /** 可能的账户（合并时钱包和银行两边都算） */
  accountIds: number[]
}

export interface PlanMatch {
  /** 关键字（或名称）命中，或指定的账户和分类都对上且金额相等 */
  strong: boolean
  score: number
}

function dayDiff(a: string, b: string): number {
  return Math.round(Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000)
}

/** 金额在计划金额的容差内 */
export function amountWithin(amount: number, planned: number, tolerance = 0): boolean {
  return Math.abs(amount - planned) <= Math.round((planned * Math.max(0, tolerance)) / 100)
}

/**
 * 一笔实际收支与某一期能不能对上：
 * 同收支方向、日期相差不超过日期容差、金额在容差内；设了关键字时商户 / 备注 / 商品说明必须包含其一（名称也算）；
 * 没有文字命中时，预算指定的分类、账户都要相同。
 * 文字命中，或账户和分类都指定且对上、金额正好相等时为强对应（导入时默认转为实际），否则为疑似。
 */
export function matchPlan(c: PlanCandidate, o: Pick<PlanOccurrence, 'plan' | 'date' | 'amount'>): PlanMatch | undefined {
  const { plan } = o
  if (c.type !== plan.type) return undefined
  const days = dayDiff(c.date, o.date)
  if (days > planWindow(plan)) return undefined
  if (!amountWithin(c.amount, o.amount, plan.tolerance)) return undefined
  const text = normalizeText(`${c.merchant ?? ''} ${c.note ?? ''} ${c.goods ?? ''}`)
  const words = [...(plan.keywords ?? []), plan.name].map((w) => normalizeText(w)).filter(Boolean)
  const textHit = words.some((w) => text.includes(w))
  if (plan.keywords?.length && !textHit) return undefined
  const categoryOk = plan.categoryId === undefined || c.categoryId === plan.categoryId
  const accountOk = plan.accountId === undefined || c.accountIds.includes(plan.accountId)
  if (!textHit && (!categoryOk || !accountOk)) return undefined
  const exact = c.amount === o.amount
  const strong = textHit || (plan.accountId !== undefined && plan.categoryId !== undefined && exact)
  const score = (strong ? 1000 : 0) + (textHit ? 100 : 0) - days * 10 - (exact ? 0 : 5 + Math.abs(c.amount - o.amount) / o.amount)
  return { strong, score }
}

/** 用户对某一行的选择：on 强制对应（疑似时），off 不对应 */
export type PlanChoice = 'on' | 'off'

export interface PlanAssignment {
  occurrence: PlanOccurrence
  strong: boolean
  /** true：保存时写入 planRef；false：只是提示（疑似、或用户选了不对应） */
  linked: boolean
}

/**
 * 给一批实际收支分配预算期，一期只分给一笔：
 * 先按匹配度分配强对应（用户选了 off 的除外），再给用户选了 on 的疑似分配；
 * 剩下的给出还没被占用的最佳候选作提示（linked 为 false）。
 */
export function assignPlans<K>(
  candidates: { key: K; candidate: PlanCandidate; choice?: PlanChoice }[],
  occurrences: PlanOccurrence[],
): Map<K, PlanAssignment> {
  const open = occurrences.filter(isOpen)
  const result = new Map<K, PlanAssignment>()
  const claimed = new Set<string>()
  const pairs = candidates.flatMap(({ key, candidate, choice }) =>
    open.flatMap((occurrence) => {
      const m = matchPlan(candidate, occurrence)
      return m ? [{ key, choice, occurrence, ...m }] : []
    }),
  )
  pairs.sort((a, b) => b.score - a.score)
  const take = (pick: (p: (typeof pairs)[number]) => boolean, linked: boolean) => {
    for (const p of pairs) {
      if (result.has(p.key) || claimed.has(p.occurrence.ref) || !pick(p)) continue
      result.set(p.key, { occurrence: p.occurrence, strong: p.strong, linked })
      if (linked) claimed.add(p.occurrence.ref)
    }
  }
  take((p) => p.strong && p.choice !== 'off', true)
  take((p) => p.choice === 'on', true)
  take(() => true, false)
  return result
}

/** 已有流水能不能去对预算：收支（不含转账、不计收支），还没对应别的预算 */
export function plannable(t: Pick<Transaction, 'type' | 'excluded' | 'planRef'>): boolean {
  return !t.planRef && statType(t) !== undefined
}

export function candidateOf(t: Transaction): PlanCandidate {
  return {
    type: t.type,
    amount: t.amount,
    date: t.date,
    merchant: t.merchant,
    note: t.note,
    goods: t.goods,
    categoryId: t.categoryId,
    accountIds: [t.accountId],
  }
}

/**
 * 导入预览行 → 参与匹配的收支；不参与的返回 undefined：没勾选、忽略 / 不计收支、退款、本人账户间转账，
 * 以及要合并进的已有流水已经对应了预算
 */
export function previewCandidateOf(item: PreviewItem): PlanCandidate | undefined {
  const { row } = item
  if (!item.selected || row.skipReason || item.refundOf || item.transferPair || item.mergeAsTransfer) return undefined
  if (item.mergeWith?.planRef) return undefined
  const other = item.mergeWith
  return {
    type: row.type,
    amount: row.amount,
    date: row.date,
    merchant: row.merchant ?? other?.merchant,
    note: [row.note, other?.note].filter(Boolean).join(' '),
    goods: row.goods ?? other?.goods,
    categoryId: item.categoryId ?? other?.categoryId,
    accountIds: other ? [item.accountId, other.accountId] : [item.accountId],
  }
}

/** 导入预览里各行对应的预算期 */
export function assignPreviewPlans(items: PreviewItem[], occurrences: PlanOccurrence[]): Map<number, PlanAssignment> {
  if (occurrences.length === 0) return new Map()
  const candidates = items.flatMap((item) => {
    const candidate = previewCandidateOf(item)
    return candidate ? [{ key: item.key, candidate, choice: item.planChoice }] : []
  })
  return assignPlans(candidates, occurrences)
}

export interface PlanTotals {
  /** 计划合计（不含跳过的期） */
  planned: number
  /** 已实现的期的实际合计 */
  actual: number
  /** 待发生（含逾期）的计划合计 */
  open: number
  /** 其中还没到期（待发生）的计划合计；planned - pendingAmount 是到期了的计划 */
  pendingAmount: number
  /** 已实现各期的计划合计，和 actual 比差额 */
  donePlanned: number
  done: number
  overdue: number
  pending: number
  skipped: number
}

/** 某个方向（支出 / 收入）的各期汇总 */
export function planTotals(occurrences: PlanOccurrence[], type: Plan['type']): PlanTotals {
  const s: PlanTotals = { planned: 0, actual: 0, open: 0, pendingAmount: 0, donePlanned: 0, done: 0, overdue: 0, pending: 0, skipped: 0 }
  for (const o of occurrences) {
    if (o.plan.type !== type) continue
    s[o.status]++
    if (o.status === 'skipped') continue
    s.planned += o.amount
    if (o.status === 'done') {
      s.actual += o.actual
      s.donePlanned += o.amount
    } else s.open += o.amount
    if (o.status === 'pending') s.pendingAmount += o.amount
  }
  return s
}

/** 解析关键字输入：空格、逗号、顿号分隔，去重 */
export function parsePlanKeywords(text: string): string[] | undefined {
  const list = [...new Set(text.split(/[\s,，、]+/).map((w) => w.trim()).filter(Boolean))]
  return list.length ? list : undefined
}

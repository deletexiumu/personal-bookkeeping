import type { MergedEntry, Transaction } from '../../types'
import { similarity } from './similarity'
import type { ParsedRow } from './table'

/** 退款最晚在原支出之后多少天到账 */
export const REFUND_WINDOW_DAYS = 120

const REFUND = /退款|退货|退回/

/** 退款到账的行：收入，并且类型、商户或备注里写着退款 */
export function isRefundRow(row: ParsedRow): boolean {
  return row.type === 'income' && !row.skipReason && REFUND.test(`${row.kind ?? ''} ${row.merchant ?? ''} ${row.note ?? ''}`)
}

/** 全额退款的一对（原支出和退款）：两条都不计收支，余额里一正一负照常计入，互相抵消 */
export function isRefundPair(t: Pick<Transaction, 'merged'>): boolean {
  return !!t.merged?.some((m) => m.refund || m.purchase)
}

/** 已从金额里扣掉的部分退款之和（退完剩余的那笔不扣金额，不算） */
export function refundedAmount(t: Pick<Transaction, 'merged'>): number {
  return (t.merged ?? []).reduce((sum, m) => sum + (m.refund && !m.full ? (m.amount ?? 0) : 0), 0)
}

/** 原金额：部分退款扣掉之前的金额，用于重复导入时比对 */
export function originalAmount(t: Pick<Transaction, 'amount' | 'merged'>): number {
  return t.amount + refundedAmount(t)
}

/** 去掉「退款-」前缀和公司名里的通用字，「退款-盒马鲜生(某店)」与「盒马鲜生(某店)」才比得上 */
const clean = (text: string | undefined) =>
  text?.replace(/^退款[-－:：\s]*/, '').replace(/有限责任公司|有限公司|股份|集团|科技|信息|网络|技术|快捷退款|快捷支付|京东自营|自营|官方|旗舰店|专营店|专卖店/g, '')

/**
 * 退款与原支出是不是同一个商户的同一单：双方都有商户时商户要相似；双方都有备注（去掉「退款-」后）时备注也要相似。
 * 「淘宝闪购」这类平台商户下有很多单，所以有备注时一定比备注。
 */
function orderMatch(refund: { merchant?: string; note?: string }, purchase: { merchant?: string; note?: string }): 'note' | 'merchant' | undefined {
  const merchant = clean(refund.merchant) && clean(purchase.merchant) ? similarity(clean(refund.merchant), clean(purchase.merchant)) >= 0.5 : undefined
  const note = clean(refund.note) && clean(purchase.note) ? similarity(clean(refund.note), clean(purchase.note)) >= 0.6 : undefined
  if (merchant === false || note === false) return undefined
  return note ? 'note' : merchant ? 'merchant' : undefined
}

/** 平台或支付渠道：同一个商户名下有很多单，只按商户对上时不能确定是哪一单 */
const PLATFORM = /平台商户|淘宝|天猫|美团|饿了么|拼多多|抖音|支付宝|财付通|微信|京东商城|网联|银联/

/** 退款的原支出：已有流水（tx），或本批次前面的行（key） */
export interface RefundTarget {
  tx?: Transaction
  key?: number
  /** 全额退款：两条都标为不计收支；部分退款：退款并进原支出，支出金额减掉退款 */
  full: boolean
}

export interface Purchase {
  tx?: Transaction
  key?: number
  accountId: number
  date: string
  /** 现在的金额（已扣掉之前并进来的部分退款） */
  amount: number
  merchant?: string
  note?: string
}

const days = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / 86_400_000

/**
 * 找退款对应的原支出：同一个账户，支出在退款之前不超过 120 天，同一个商户的同一单（见 orderMatch），
 * 金额不小于退款。先找金额相等的（全额退款），再找金额更大的（部分退款），各自取日期最近的。
 * 部分退款只按商户对上、而商户是平台或支付渠道时，猜不准是哪一单，不配对。
 * full 里的原支出（已被全额退款认领）不再参与。
 */
export function findRefundTarget(
  row: ParsedRow,
  accountId: number,
  purchases: Purchase[],
  full: ReadonlySet<Purchase>,
): Purchase | undefined {
  if (!isRefundRow(row)) return undefined
  const fits = purchases.filter((p) => {
    if (full.has(p) || p.accountId !== accountId || p.amount < row.amount) return false
    const d = days(p.date, row.date)
    if (d < 0 || d > REFUND_WINDOW_DAYS) return false
    const match = orderMatch(row, p)
    if (!match) return false
    return p.amount === row.amount || match === 'note' || !PLATFORM.test(`${row.merchant ?? ''} ${p.merchant ?? ''}`)
  })
  const nearest = (list: Purchase[]) => list.sort((a, b) => days(a.date, row.date) - days(b.date, row.date))[0]
  return nearest(fits.filter((p) => p.amount === row.amount)) ?? nearest(fits.filter((p) => p.amount > row.amount))
}

/** 退款这一行记进原支出的明细 */
export function refundEntry(row: ParsedRow, label: string, account: string | undefined, full = false): MergedEntry {
  const entry: MergedEntry = { label, date: row.date, amount: row.amount, refund: true }
  if (full) entry.full = true
  if (row.time) entry.time = row.time
  if (row.merchant) entry.merchant = row.merchant
  if (row.note) entry.note = row.note
  if (account) entry.account = account
  if (row.ref) entry.ref = row.ref
  return entry
}

/** 原支出记进全额退款那条的明细，方便从退款找到原来那笔 */
export function purchaseEntry(p: { date: string; time?: string; merchant?: string; note?: string; amount: number; ref?: string }, label: string): MergedEntry {
  const entry: MergedEntry = { label, date: p.date, amount: p.amount, purchase: true }
  if (p.time) entry.time = p.time
  if (p.merchant) entry.merchant = p.merchant
  if (p.note) entry.note = p.note
  if (p.ref) entry.ref = p.ref
  return entry
}

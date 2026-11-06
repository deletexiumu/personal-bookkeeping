import { describe, expect, it } from 'vitest'
import type { Transaction } from '../../types'
import { buildPreview, findDuplicate, statusOf, summarizePreview } from './preview'
import { findRefundTarget, isRefundRow, originalAmount, type Purchase } from './refund'
import type { ParsedRow } from './table'

const row = (patch: Partial<ParsedRow>): ParsedRow => ({ line: 2, date: '2026-04-21', type: 'income', amount: 1998300, ...patch })
const tx = (patch: Partial<Transaction>): Transaction => ({
  id: 100,
  type: 'expense',
  amount: 1998300,
  accountId: 2,
  date: '2026-04-21',
  source: 'import',
  merchant: '机械革命京东自营旗舰店',
  note: '快捷支付',
  createdAt: 1,
  updatedAt: 1,
  ...patch,
})
const ctx = (existing: Transaction[]) => ({ categories: [], merchantHistory: new Map(), accounts: [{ id: 2, name: '招行卡' }], defaultAccountId: 2, existing })

describe('退款', () => {
  it('识别退款行', () => {
    expect(isRefundRow(row({ note: '快捷退款' }))).toBe(true)
    expect(isRefundRow(row({ note: '退款-盒马鲜生' }))).toBe(true)
    expect(isRefundRow(row({ note: '工资' }))).toBe(false)
    expect(isRefundRow(row({ type: 'expense', note: '退款' }))).toBe(false)
    expect(isRefundRow(row({ note: '退款', skipReason: '交易关闭' }))).toBe(false)
  })

  it('找原支出：同账户、同一单、之前 120 天内、金额不小于退款；全额优先，其次日期最近', () => {
    const p = (patch: Partial<Purchase>): Purchase => ({ accountId: 2, date: '2026-04-21', amount: 1998300, merchant: '机械革命京东自营旗舰店', note: '快捷支付', ...patch })
    const refund = row({ merchant: '机械革命京东自营旗舰店', note: '快捷退款' })
    const exact = p({})
    const bigger = p({ amount: 2799108 })
    expect(findRefundTarget(refund, 2, [bigger, exact], new Set())).toBe(exact)
    expect(findRefundTarget(refund, 2, [bigger], new Set())).toBe(bigger)
    expect(findRefundTarget(refund, 2, [exact], new Set([exact]))).toBeUndefined()
    expect(findRefundTarget(refund, 5, [exact], new Set())).toBeUndefined()
    expect(findRefundTarget(refund, 2, [p({ date: '2026-04-22' })], new Set())).toBeUndefined()
    expect(findRefundTarget(refund, 2, [p({ date: '2025-12-01' })], new Set())).toBeUndefined()
    expect(findRefundTarget(refund, 2, [p({ amount: 100 })], new Set())).toBeUndefined()
    expect(findRefundTarget(refund, 2, [p({ merchant: '某超市' })], new Set())).toBeUndefined()
  })

  it('平台商户（淘宝闪购）按备注里的店名比对', () => {
    const purchases: Purchase[] = [
      { accountId: 3, date: '2026-10-21', amount: 4086, merchant: '淘宝闪购', note: '盒马鲜生(中铁西城店)' },
      { accountId: 3, date: '2026-10-21', amount: 4086, merchant: '淘宝闪购', note: '某某烧烤' },
    ]
    const refund = row({ date: '2026-10-21', amount: 19, merchant: '淘宝闪购', note: '退款-盒马鲜生(中铁西城店)', ref: 'R1' })
    expect(findRefundTarget(refund, 3, purchases, new Set())).toBe(purchases[0])
  })

  it('预览：已有原支出时，全额退款两条都不计收支、部分退款从原支出里扣', () => {
    const items = buildPreview([row({ merchant: '机械革命京东自营旗舰店', note: '快捷退款' })], ctx([tx({})]))
    expect(statusOf(items[0])).toBe('merge')
    expect(items[0]).toMatchObject({ selected: true, refundOf: { full: true, tx: { id: 100 } } })
    expect(summarizePreview(items)).toMatchObject({ merge: 1, selectedUncategorized: 0 })
    const partial = buildPreview([row({ merchant: '机械革命京东自营旗舰店', note: '快捷退款', amount: 100 })], ctx([tx({})]))
    expect(partial[0].refundOf).toMatchObject({ full: false, tx: { id: 100 } })
  })

  it('预览：同一份账单里先买后退；两次部分退款依次扣，不超过原金额', () => {
    const items = buildPreview(
      [
        row({ type: 'expense', amount: 62890, date: '2026-10-10', merchant: '小北租电动车', note: '服务费' }),
        row({ amount: 17457, date: '2026-10-13', merchant: '小北租电动车', note: '退款-服务费' }),
        row({ amount: 5990, date: '2026-10-13', merchant: '小北租电动车', note: '退款-服务费' }),
        row({ amount: 50000, date: '2026-10-14', merchant: '小北租电动车', note: '退款-服务费' }),
      ],
      ctx([]),
    )
    expect(items.map((i) => i.refundOf && [i.refundOf.key, i.refundOf.full])).toEqual([undefined, [0, false], [0, false], undefined])
  })

  it('部分退款并进原支出后，重复导入原支出和退款都算重复', () => {
    const refund = { label: '招商银行流水', date: '2026-04-22', merchant: '机械革命京东自营旗舰店', note: '快捷退款', amount: 100, refund: true }
    const t = tx({ amount: 1998200, merged: [refund] })
    expect(originalAmount(t)).toBe(1998300)
    expect(findDuplicate(row({ type: 'expense', merchant: '机械革命京东自营旗舰店', note: '快捷支付' }), [t])).toBe(t)
    expect(findDuplicate(row({ date: '2026-04-22', amount: 100, merchant: '机械革命京东自营旗舰店', note: '快捷退款' }), [t])).toBe(t)
  })
})

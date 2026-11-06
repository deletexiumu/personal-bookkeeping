import { describe, expect, it } from 'vitest'
import type { Transaction } from '../../types'
import { computeBalances } from '../balance'
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

  it('部分退款只按平台商户对上时不配对；全额退款可以', () => {
    const purchases: Purchase[] = [{ accountId: 2, date: '2026-10-12', amount: 3000, merchant: '支付宝（中国）网络技术有限公司', note: '快捷支付' }]
    const refund = (amount: number) => row({ date: '2026-10-13', amount, merchant: '支付宝（中国）网络技术有限公司', note: '快捷退款' })
    expect(findRefundTarget(refund(1000), 2, purchases, new Set())).toBeUndefined()
    expect(findRefundTarget(refund(3000), 2, purchases, new Set())).toBe(purchases[0])
  })

  it('预览：手记和已被合并认领的已有支出不作为原支出', () => {
    const manual = tx({ source: 'manual' })
    expect(buildPreview([row({ merchant: '机械革命京东自营旗舰店', note: '快捷退款' })], ctx([manual]))[0].refundOf).toBeUndefined()
    // 同一份钱包账单里，付款行要合并进这条银行支出，退款行就不能再拿它当原支出
    const bank = tx({ amount: 5000, merchant: '某店', note: '快捷支付' })
    const items = buildPreview(
      [
        row({ amount: 5000, merchant: '某店', note: '退款', ref: 'F1' }),
        row({ type: 'expense', amount: 5000, merchant: '某店', ref: 'P1', accountName: '招商银行(1234)' }),
      ],
      { ...ctx([bank]), accounts: [{ id: 2, name: '招行卡 1234', type: 'debit' as const }], source: 'alipay' as const },
    )
    expect(items[1].mergeWith).toBe(bank)
    expect(items[0].refundOf?.tx).toBeUndefined()
  })

  it('预览：更早的支出从 purchases 里找', () => {
    const old = tx({ id: 9, date: '2026-02-01' })
    const items = buildPreview([row({ date: '2026-03-01', merchant: '机械革命京东自营旗舰店', note: '快捷退款' })], { ...ctx([]), purchases: [old] })
    expect(items[0].refundOf).toMatchObject({ full: true, tx: { id: 9 } })
  })

  it('部分退款已并进原支出，另一个渠道的同一笔退款算重复', () => {
    const t = tx({ amount: 45433, merged: [{ label: '支付宝账单', date: '2026-10-13', merchant: '小北租电动车', note: '退款-服务费', amount: 17457, ref: 'R1', refund: true }] })
    const bankRefund = row({ date: '2026-10-13', amount: 17457, merchant: '支付宝（中国）网络技术有限公司', note: '快捷退款' })
    expect(buildPreview([bankRefund], ctx([t]))[0].duplicateOf).toBe(t)
  })

  it('全额退款的一对：来源不同（一条有交易单号、一条没有）余额照样抵消', () => {
    const buy = tx({ id: 1, amount: 5000, excluded: true, merged: [{ label: '支付宝账单', date: '2026-04-21', amount: 5000, refund: true, ref: 'F1' }] })
    const refund = tx({ id: 2, type: 'income', amount: 5000, externalId: 'F1', excluded: true, merged: [{ label: '招商银行流水', date: '2026-04-21', amount: 5000, purchase: true }] })
    expect(computeBalances([{ id: 2, name: '招行卡', initialBalance: 0 }], [buy, refund]).get(2)).toBe(0)
  })

  it('部分退款后换格式重新导入原支出：按原金额认出重复', () => {
    const t = tx({
      amount: 1998200,
      merged: [
        { label: '招商银行流水', date: '2026-04-21', merchant: '机械革命京东自营旗舰店', note: '快捷支付', bank: true },
        { label: '招商银行流水', date: '2026-04-22', amount: 100, refund: true },
      ],
      externalId: 'P1',
    })
    const excel = row({ type: 'expense', date: '2026-04-22', merchant: '机械革命京东自营旗舰店', note: '银联快捷支付' })
    expect(buildPreview([excel], ctx([t]))[0].duplicateOf).toBe(t)
  })

  it('先导入支付宝（含部分退款），再导入同时有原支出和退款的银行流水：原支出合并、退款算重复', () => {
    const t = tx({
      amount: 45433,
      externalId: 'P1',
      merchant: '小北租电动车',
      note: '服务费',
      merged: [{ label: '支付宝账单', date: '2026-10-13', merchant: '小北租电动车', note: '退款-服务费', amount: 17457, ref: 'R1', refund: true }],
    })
    const items = buildPreview(
      [
        row({ type: 'expense', date: '2026-10-10', amount: 62890, merchant: '支付宝（中国）网络技术有限公司', note: '快捷支付' }),
        row({ date: '2026-10-13', amount: 17457, merchant: '支付宝（中国）网络技术有限公司', note: '快捷退款' }),
      ],
      { ...ctx([{ ...t, date: '2026-10-10' }]), sourceOf: () => 'alipay' as const },
    )
    expect(items[0].mergeWith?.id).toBe(100)
    expect(items[1].duplicateOf).toMatchObject({ id: 100 })
  })

  it('跨月：原支出在更早的账单里，部分退款并进后，银行的同一笔退款也算重复', () => {
    const old = tx({ date: '2026-09-20', amount: 45433, merged: [{ label: '支付宝账单', date: '2026-10-05', amount: 17457, ref: 'R1', refund: true }] })
    const items = buildPreview([row({ date: '2026-10-05', amount: 17457, merchant: '支付宝（中国）网络技术有限公司', note: '快捷退款' })], { ...ctx([]), purchases: [old] })
    expect(items[0].duplicateOf).toBe(old)
  })

  it('先部分退款、再退完剩下的：原金额仍按全部原金额算', () => {
    const t = tx({
      amount: 7000,
      excluded: true,
      merged: [
        { label: '支付宝账单', date: '2026-10-11', amount: 3000, refund: true },
        { label: '支付宝账单', date: '2026-10-12', amount: 7000, refund: true, full: true },
      ],
    })
    expect(originalAmount(t)).toBe(10000)
    expect(originalAmount(tx({ amount: 5000, excluded: true, merged: [{ label: 'x', date: '2026-10-12', amount: 5000, refund: true, full: true }] }))).toBe(5000)
  })

  it('重新导出的账单里又有原支出（算重复）和退款：退款仍对上原支出', () => {
    const p = tx({ externalId: 'B1', merchant: '某店', note: '某商品', amount: 5000 })
    const items = buildPreview(
      [row({ type: 'expense', amount: 5000, merchant: '某店', note: '某商品', ref: 'B1' }), row({ amount: 5000, merchant: '某店', note: '退款-某商品', ref: 'R1' })],
      ctx([p]),
    )
    expect(items[0].duplicateOf).toBe(p)
    expect(items[1].refundOf).toMatchObject({ full: true, tx: { id: 100 } })
  })
})

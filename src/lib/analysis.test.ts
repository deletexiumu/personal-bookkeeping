import { describe, expect, it } from 'vitest'
import type { Category, Transaction } from '../types'
import {
  categoryShares,
  changeRatio,
  formatAxisAmount,
  formatChange,
  matchDrill,
  merchantTop,
  niceTicks,
  periodStats,
  transactionsHref,
  trendSeries,
} from './analysis'
import { parseTransactionsHash } from './filter'
import {
  bucketsOf,
  customPeriod,
  daysBetween,
  elapsedDays,
  monthOfPeriod,
  periodLabel,
  periodOf,
  shiftPeriod,
} from './period'

let nextId = 1
function tx(patch: Partial<Transaction>): Transaction {
  return {
    id: nextId++,
    type: 'expense',
    amount: 1000,
    accountId: 1,
    date: '2026-11-04',
    source: 'manual',
    createdAt: 0,
    updatedAt: 0,
    ...patch,
  }
}

const categories: Category[] = [
  { id: 1, name: '餐饮', type: 'expense' },
  { id: 2, name: '交通', type: 'expense' },
  { id: 8, name: '工资', type: 'income' },
]

describe('统计区间', () => {
  it('周从周一开始，月和年取自然周期', () => {
    // 2026-11-04 是周三
    expect(periodOf('week', '2026-11-04')).toEqual({ kind: 'week', start: '2026-11-02', end: '2026-11-08' })
    expect(periodOf('week', '2026-11-01')).toMatchObject({ start: '2026-10-26', end: '2026-11-01' })
    expect(periodOf('month', '2026-02-10')).toMatchObject({ start: '2026-02-01', end: '2026-02-28' })
    expect(periodOf('year', '2026-11-04')).toMatchObject({ start: '2026-01-01', end: '2026-12-31' })
  })

  it('前后切换：月跨年、自定义按天数平移', () => {
    expect(shiftPeriod(periodOf('month', '2026-01-15'), -1)).toMatchObject({ start: '2025-12-01', end: '2025-12-31' })
    expect(shiftPeriod(periodOf('week', '2026-11-04'), 1)).toMatchObject({ start: '2026-11-09', end: '2026-11-15' })
    expect(shiftPeriod(periodOf('year', '2026-11-04'), -1)).toMatchObject({ start: '2025-01-01', end: '2025-12-31' })
    expect(shiftPeriod(customPeriod('2026-11-01', '2026-11-10'), -1)).toMatchObject({ start: '2026-10-22', end: '2026-10-31' })
  })

  it('自定义起止颠倒时交换，天数含首尾', () => {
    expect(customPeriod('2026-11-10', '2026-11-01')).toMatchObject({ start: '2026-11-01', end: '2026-11-10' })
    expect(daysBetween('2026-10-30', '2026-11-02')).toBe(4)
  })

  it('标题', () => {
    expect(periodLabel(periodOf('month', '2026-11-04'), '2026-11-04')).toBe('2026年11月')
    expect(periodLabel(periodOf('week', '2026-11-04'), '2026-11-04')).toBe('11月2日 – 8日')
    expect(periodLabel(periodOf('week', '2026-11-01'), '2026-11-04')).toBe('10月26日 – 11月1日')
    expect(periodLabel(customPeriod('2025-12-20', '2026-01-05'), '2026-11-04')).toBe('2025年12月20日 – 2026年1月5日')
  })

  it('已过天数只算到今天', () => {
    expect(elapsedDays(periodOf('month', '2026-11-04'), '2026-11-04')).toBe(4)
    expect(elapsedDays(periodOf('month', '2026-10-01'), '2026-11-04')).toBe(31)
    expect(elapsedDays(periodOf('month', '2026-12-01'), '2026-11-04')).toBe(0)
  })

  it('是否在同一个月', () => {
    expect(monthOfPeriod(periodOf('week', '2026-11-04'))).toBe('2026-11')
    expect(monthOfPeriod(periodOf('week', '2026-11-01'))).toBeUndefined()
  })

  it('柱子：周 7 天、月按天、年 12 个月，长自定义区间按月并裁到区间内', () => {
    expect(bucketsOf(periodOf('week', '2026-11-04')).map((b) => b.label)).toEqual(['周一', '周二', '周三', '周四', '周五', '周六', '周日'])
    const month = bucketsOf(periodOf('month', '2026-11-04'))
    expect(month).toHaveLength(30)
    expect(month[0]).toMatchObject({ label: '1', title: '11月1日 周日' })
    expect(bucketsOf(periodOf('year', '2026-11-04')).map((b) => b.label).slice(0, 2)).toEqual(['1月', '2月'])
    const long = bucketsOf(customPeriod('2025-11-15', '2026-02-10'))
    expect(long.map((b) => [b.label, b.start, b.end])).toEqual([
      ['11月', '2025-11-15', '2025-11-30'],
      ['12月', '2025-12-01', '2025-12-31'],
      ['2026年1月', '2026-01-01', '2026-01-31'],
      ['2月', '2026-02-01', '2026-02-10'],
    ])
    expect(bucketsOf(customPeriod('2026-10-01', '2026-11-04'))).toHaveLength(35)
  })
})

describe('汇总与对比', () => {
  const rows = [
    tx({ type: 'income', amount: 1_000_000, categoryId: 8, date: '2026-11-01' }),
    tx({ amount: 3000, categoryId: 1, merchant: '星巴克', date: '2026-11-02' }),
    tx({ amount: 2000, categoryId: 1, merchant: '星巴克', date: '2026-11-04' }),
    tx({ amount: 8000, categoryId: 2, note: '打车', date: '2026-11-04' }),
    tx({ amount: 500, date: '2026-11-04' }),
    tx({ type: 'transfer', amount: 99_999, transferAccountId: 2, date: '2026-11-03' }),
  ]

  it('转账不计入，储蓄率 = 结余 / 收入', () => {
    expect(periodStats(rows)).toEqual({
      income: 1_000_000,
      expense: 13_500,
      balance: 986_500,
      savingsRate: 0.9865,
      count: 5,
    })
    expect(periodStats([]).savingsRate).toBeNull()
  })

  it('变化比例与格式', () => {
    expect(changeRatio(120, 100)).toBeCloseTo(0.2)
    expect(changeRatio(5, 0)).toBeNull()
    expect(changeRatio(-50, -100)).toBeCloseTo(0.5)
    expect(formatChange(0.1234)).toBe('+12.3%')
    expect(formatChange(-0.04)).toBe('-4%')
    expect(formatChange(0.0001)).toBe('持平')
  })

  it('坐标轴刻度与紧凑金额', () => {
    expect(niceTicks(13_500)).toEqual([0, 5000, 10_000, 15_000])
    expect(niceTicks(0)).toEqual([0])
    expect(niceTicks(100_000)).toEqual([0, 25_000, 50_000, 75_000, 100_000])
    expect(formatAxisAmount(82_000)).toBe('820')
    expect(formatAxisAmount(120_000)).toBe('1.2k')
    expect(formatAxisAmount(3_500_000)).toBe('3.5万')
  })

  it('趋势按柱子汇总', () => {
    const points = trendSeries(rows, bucketsOf(periodOf('week', '2026-11-04')))
    expect(points.map((p) => [p.key, p.expense, p.income]).slice(0, 3)).toEqual([
      ['2026-11-02', 3000, 0],
      ['2026-11-03', 0, 0],
      ['2026-11-04', 10_500, 0],
    ])
  })

  it('分类构成从大到小，无分类归为「未分类」', () => {
    const shares = categoryShares(rows, categories, 'expense')
    expect(shares.map((s) => [s.name, s.amount, s.count])).toEqual([
      ['交通', 8000, 1],
      ['餐饮', 5000, 2],
      ['未分类', 500, 1],
    ])
    expect(shares[1].share).toBeCloseTo(5000 / 13_500)
    expect(categoryShares(rows, categories, 'income')[0]).toMatchObject({ name: '工资', share: 1, categoryId: 8 })
  })

  it('商户排行：没有商户时用备注，都没有的不参与', () => {
    expect(merchantTop(rows, 'expense').map((m) => [m.name, m.amount, m.count])).toEqual([
      ['打车', 8000, 1],
      ['星巴克', 5000, 2],
    ])
    expect(merchantTop(rows, 'expense', 1)).toHaveLength(1)
  })

  it('下钻条件', () => {
    const base = { title: '', start: '2026-11-01', end: '2026-11-30' }
    expect(rows.filter((t) => matchDrill(t, base))).toHaveLength(5)
    expect(rows.filter((t) => matchDrill(t, { ...base, type: 'expense', categoryId: 1 }))).toHaveLength(2)
    expect(rows.filter((t) => matchDrill(t, { ...base, type: 'expense', categoryId: null }))).toHaveLength(1)
    expect(rows.filter((t) => matchDrill(t, { ...base, type: 'expense', merchant: '打车' }))).toHaveLength(1)
    expect(rows.filter((t) => matchDrill(t, { ...base, start: '2026-11-04', end: '2026-11-04' }))).toHaveLength(3)
  })

  it('明细页链接可以往返解析', () => {
    const href = transactionsHref('2026-11', { type: 'expense', categoryId: 1, merchant: '星巴克' })
    expect(href).toBe('#/transactions?month=2026-11&type=expense&category=1&q=%E6%98%9F%E5%B7%B4%E5%85%8B')
    expect(parseTransactionsHash(href)).toEqual({
      month: '2026-11',
      filter: { type: 'expense', categoryId: 1, query: '星巴克' },
    })
    expect(parseTransactionsHash('#/transactions')).toEqual({ filter: {} })
    expect(parseTransactionsHash('#/transactions?month=bad&type=x')).toEqual({ month: undefined, filter: {} })
  })
})

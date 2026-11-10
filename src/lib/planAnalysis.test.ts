import { describe, expect, it } from 'vitest'
import { categoryCompare, matchPlanFilter, planRows, planSeries, planSide, unplannedByCategory } from './planAnalysis'
import { expandPlans } from './plans'
import type { Category, Plan, Transaction } from '../types'

const plan = (patch: Partial<Plan>): Plan => ({
  id: 1,
  uid: 'p1',
  name: '房租',
  type: 'expense',
  amount: 450000,
  categoryId: 4,
  repeat: 'monthly',
  startDate: '2026-10-15',
  createdAt: 0,
  updatedAt: 0,
  ...patch,
})
const tx = (patch: Partial<Transaction>): Transaction => ({
  type: 'expense',
  amount: 100,
  accountId: 1,
  date: '2026-11-01',
  source: 'manual',
  createdAt: 0,
  updatedAt: 0,
  ...patch,
})
const categories: Category[] = [
  { id: 1, name: '餐饮', type: 'expense' },
  { id: 4, name: '居住', type: 'expense' },
]

const rent = plan({})
const salary = plan({ id: 2, uid: 'p2', name: '工资', type: 'income', amount: 2000000, categoryId: undefined, startDate: '2026-11-10' })
const phone = plan({ id: 3, uid: 'p3', name: '话费', amount: 9900, categoryId: undefined, startDate: '2026-11-28', skipped: ['2026-11-28'] })
const rows = [
  tx({ id: 1, amount: 460000, categoryId: 4, date: '2026-11-15', planRef: 'p1@2026-11-15' }),
  tx({ id: 2, amount: 20000, categoryId: 4, date: '2026-11-20' }),
  tx({ id: 3, amount: 3800, categoryId: 1, date: '2026-11-09' }),
  tx({ id: 4, amount: 3000, categoryId: 1, date: '2026-11-03', excluded: true }),
]
const occurrences = expandPlans([rent, salary, phone], '2026-11-01', '2026-11-30', rows, '2026-11-25')

describe('预算对比', () => {
  it('计划、实际、预算内外', () => {
    expect(planSide(occurrences, rows, 'expense')).toMatchObject({ planned: 450000, actual: 460000, actualAll: 483800, inPlan: 460000, outPlan: 23800, done: 1, skipped: 1 })
    expect(planSide(occurrences, rows, 'income')).toMatchObject({ planned: 2000000, open: 2000000, overdue: 1, actualAll: 0 })
  })

  it('按分类：计划与该分类全部实际；预算外按分类', () => {
    expect(categoryCompare(occurrences, rows, categories, 'expense')).toEqual([
      { key: '4', categoryId: 4, name: '居住', planned: 450000, actual: 480000, pending: 0 },
    ])
    expect(unplannedByCategory(rows, categories, 'expense').map((c) => [c.name, c.actual, c.count])).toEqual([
      ['居住', 20000, 1],
      ['餐饮', 3800, 1],
    ])
  })

  it('各条预算与每段的计划 / 实际', () => {
    const list = planRows(occurrences)
    expect(list.map((r) => [r.plan.name, r.count, r.done, r.skipped, r.planned, r.actual, r.donePlanned])).toEqual([
      ['房租', 1, 1, 0, 450000, 460000, 450000],
      ['话费', 0, 0, 1, 0, 0, 0],
      ['工资', 1, 0, 0, 2000000, 0, 0],
    ])
    const buckets = [
      { key: 'a', start: '2026-11-01', end: '2026-11-15', label: '上', title: '上半月' },
      { key: 'b', start: '2026-11-16', end: '2026-11-30', label: '下', title: '下半月' },
    ]
    expect(planSeries(occurrences, rows, buckets, 'expense').map((p) => [p.planned, p.actual])).toEqual([
      [450000, 463800],
      [0, 20000],
    ])
  })

  it('关键字、标签筛选作用到预算', () => {
    expect(matchPlanFilter(plan({ keywords: ['谢志英'] }), ['谢志英'], undefined, '__u')).toBe(true)
    expect(matchPlanFilter(rent, ['工资'], undefined, '__u')).toBe(false)
    expect(matchPlanFilter(plan({ tags: ['房租'] }), [], '房租', '__u')).toBe(true)
    expect(matchPlanFilter(rent, [], '__u', '__u')).toBe(true)
  })
})

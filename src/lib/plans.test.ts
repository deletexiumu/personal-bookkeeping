import { describe, expect, it } from 'vitest'
import type { PreviewItem } from './import/preview'
import {
  assignPlans,
  assignPreviewPlans,
  expandPlans,
  matchPlan,
  nextOccurrence,
  occurrenceDates,
  parsePlanRef,
  planTotals,
  repeatText,
  type PlanCandidate,
} from './plans'
import type { Plan, Transaction } from '../types'

const plan = (patch: Partial<Plan> = {}): Plan => ({
  id: 1,
  uid: 'p1',
  name: '房租',
  type: 'expense',
  amount: 450000,
  categoryId: 5,
  repeat: 'monthly',
  startDate: '2026-01-15',
  createdAt: 0,
  updatedAt: 0,
  ...patch,
})

const tx = (patch: Partial<Transaction> = {}): Transaction => ({
  id: 10,
  type: 'expense',
  amount: 450000,
  accountId: 2,
  date: '2026-11-15',
  source: 'import',
  createdAt: 0,
  updatedAt: 0,
  ...patch,
})

const cand = (patch: Partial<PlanCandidate> = {}): PlanCandidate => ({
  type: 'expense',
  amount: 450000,
  date: '2026-11-15',
  categoryId: 5,
  accountIds: [2],
  ...patch,
})

describe('展开各期', () => {
  it('每月按开始那天重复，没有这一天的月份取月末', () => {
    expect(occurrenceDates(plan({ startDate: '2026-01-31' }), '2026-01-01', '2026-04-30')).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
    ])
  })

  it('每 N 周 / 每年 / 一次性，结束日期之后不再生成', () => {
    expect(occurrenceDates(plan({ repeat: 'weekly', interval: 2, startDate: '2026-11-02' }), '2026-11-01', '2026-11-30')).toEqual([
      '2026-11-02',
      '2026-11-16',
      '2026-11-30',
    ])
    expect(occurrenceDates(plan({ repeat: 'yearly', startDate: '2024-02-29' }), '2025-01-01', '2028-12-31')).toEqual([
      '2025-02-28',
      '2026-02-28',
      '2027-02-28',
      '2028-02-29',
    ])
    expect(occurrenceDates(plan({ repeat: 'none', startDate: '2026-12-01' }), '2026-11-01', '2026-11-30')).toEqual([])
    expect(occurrenceDates(plan({ endDate: '2026-03-20' }), '2026-01-01', '2026-12-31')).toEqual(['2026-01-15', '2026-02-15', '2026-03-15'])
  })

  it('状态：有流水对应为已实现，跳过的、过了容差天数的、其余待发生；单期改过的金额', () => {
    const p = plan({ skipped: ['2026-09-15'], overrides: { '2026-11-15': 460000 } })
    const linked = [tx({ planRef: 'p1@2026-10-15', amount: 440000 }), tx({ id: 11, planRef: 'p1@2026-10-15', amount: 10000 })]
    const list = expandPlans([p], '2026-08-01', '2026-11-30', linked, '2026-11-10')
    expect(list.map((o) => [o.date, o.status, o.amount, o.actual])).toEqual([
      ['2026-08-15', 'overdue', 450000, 0],
      ['2026-09-15', 'skipped', 450000, 0],
      ['2026-10-15', 'done', 450000, 450000],
      ['2026-11-15', 'pending', 460000, 0],
    ])
    expect(planTotals(list, 'expense')).toMatchObject({ planned: 1360000, actual: 450000, open: 910000, pendingAmount: 460000, donePlanned: 450000, done: 1, overdue: 1, skipped: 1 })
  })

  it('已不在规则上的期（改过日期）只要有流水对应仍列出', () => {
    const list = expandPlans([plan({ startDate: '2026-11-20', repeat: 'none' })], '2026-11-01', '2026-11-30', [tx({ planRef: 'p1@2026-11-15' })], '2026-11-21')
    expect(list.map((o) => [o.date, o.status])).toEqual([
      ['2026-11-15', 'done'],
      ['2026-11-20', 'pending'],
    ])
  })

  it('下一期与说明文字', () => {
    expect(nextOccurrence(plan(), '2026-11-10', [])?.date).toBe('2026-11-15')
    expect(nextOccurrence(plan(), '2026-11-10', [tx({ planRef: 'p1@2026-11-15' })])?.date).toBe('2026-12-15')
    expect(repeatText(plan())).toBe('每月 15 日')
    expect(repeatText(plan({ startDate: '2026-01-31' }))).toBe('每月 月末')
    expect(repeatText(plan({ repeat: 'weekly', interval: 2, startDate: '2026-11-11' }))).toBe('每 2 周 · 周三')
    expect(repeatText(plan({ repeat: 'none', startDate: '2026-11-11' }))).toBe('2026-11-11 一次')
    expect(parsePlanRef('a-b@2026-11-15')).toEqual({ uid: 'a-b', date: '2026-11-15' })
  })
})

describe('匹配', () => {
  const occ = (p: Plan = plan(), date = '2026-11-15') => ({ plan: p, date, amount: p.amount })

  it('名称或关键字命中商户 / 备注为强对应，日期在容差内、金额相等', () => {
    expect(matchPlan(cand({ merchant: '谢志英', date: '2026-11-17' }), occ(plan({ keywords: ['谢志英'] })))?.strong).toBe(true)
    expect(matchPlan(cand({ note: '11月房租', categoryId: 1 }), occ())?.strong).toBe(true)
    // 超出日期容差、金额不同、方向不同都对不上
    expect(matchPlan(cand({ merchant: '谢志英', date: '2026-11-19' }), occ(plan({ keywords: ['谢志英'] })))).toBeUndefined()
    expect(matchPlan(cand({ note: '房租', amount: 450001 }), occ())).toBeUndefined()
    expect(matchPlan(cand({ note: '房租', type: 'income' }), occ())).toBeUndefined()
  })

  it('设了关键字时必须命中；金额容差按百分比', () => {
    expect(matchPlan(cand({ merchant: '别人' }), occ(plan({ keywords: ['谢志英'] })))).toBeUndefined()
    const water = plan({ name: '水费', amount: 10000, tolerance: 30, keywords: ['自来水'] })
    expect(matchPlan(cand({ merchant: '成都市自来水公司', amount: 12900 }), occ(water))?.strong).toBe(true)
    expect(matchPlan(cand({ merchant: '成都市自来水公司', amount: 13100 }), occ(water))).toBeUndefined()
  })

  it('没有文字命中：分类（和指定的账户）相同为疑似；指定了账户和分类且金额相等为强对应', () => {
    expect(matchPlan(cand(), occ())?.strong).toBe(false)
    expect(matchPlan(cand({ categoryId: 6 }), occ())).toBeUndefined()
    expect(matchPlan(cand({ accountIds: [3] }), occ(plan({ accountId: 2 })))).toBeUndefined()
    expect(matchPlan(cand(), occ(plan({ accountId: 2 })))?.strong).toBe(true)
  })

  it('一期只分给一笔：先分强对应，选了 on 的疑似也分，off 的不分；剩下的给出提示', () => {
    const occurrences = expandPlans([plan({ keywords: ['谢志英'] }), plan({ uid: 'p2', name: '物业', amount: 30000, keywords: undefined })], '2026-11-01', '2026-11-30', [], '2026-11-10')
    const result = assignPlans(
      [
        { key: 'a', candidate: cand({ merchant: '谢志英', date: '2026-11-16' }) },
        { key: 'b', candidate: cand({ merchant: '谢志英', date: '2026-11-15' }) },
        { key: 'c', candidate: cand({ amount: 30000 }) },
        { key: 'd', candidate: cand({ amount: 30000 }), choice: 'on' },
      ],
      occurrences,
    )
    expect(result.get('b')).toMatchObject({ strong: true, linked: true })
    // 房租那期已被 b 占用，a 没有别的候选
    expect(result.get('a')).toBeUndefined()
    expect(result.get('d')).toMatchObject({ strong: false, linked: true, occurrence: { ref: 'p2@2026-11-15' } })
    expect(result.get('c')).toBeUndefined()
    const off = assignPlans([{ key: 'b', candidate: cand({ merchant: '谢志英' }), choice: 'off' }], occurrences)
    expect(off.get('b')).toMatchObject({ strong: true, linked: false })
  })

  it('导入预览：合并进已对应预算的流水、不计收支、没勾选的不参与；合并时两边的账户都算', () => {
    const occurrences = expandPlans([plan({ accountId: 2 })], '2026-11-01', '2026-11-30', [], '2026-11-10')
    const row = { line: 2, date: '2026-11-15', type: 'expense' as const, amount: 450000, merchant: '转账', ref: 'W1' }
    const items: PreviewItem[] = [
      { key: 0, row, accountId: 7, categoryId: 5, mergeWith: tx({ accountId: 2, externalId: undefined }), selected: true },
      { key: 1, row, accountId: 2, categoryId: 5, mergeWith: tx({ planRef: 'p1@2026-11-15' }), selected: true },
      { key: 2, row: { ...row, skipReason: '不计收支' }, accountId: 2, categoryId: 5, selected: true },
      { key: 3, row, accountId: 2, categoryId: 5, selected: false },
    ]
    const result = assignPreviewPlans(items, occurrences)
    expect([...result.keys()]).toEqual([0])
    expect(result.get(0)).toMatchObject({ strong: true, linked: true })
  })
})

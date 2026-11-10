import { CalendarClock } from 'lucide-react'
import { useMemo } from 'react'
import { formatPercent, type Drill, type ShareItem, type TrendPoint } from '../../lib/analysis'
import { formatCents } from '../../lib/money'
import type { Bucket } from '../../lib/period'
import { categoryCompare, compareDiff, planRows, planSeries, planSide, unplannedByCategory, type CategoryCompare } from '../../lib/planAnalysis'
import { repeatText, type PlanOccurrence } from '../../lib/plans'
import type { Category, Transaction } from '../../types'
import { CategoryIcon } from '../CategoryIcon'
import { Button } from '../ui/Button'
import { RankedBars } from './RankedBars'
import { TrendChart } from './TrendChart'

interface Props {
  /** 区间说明，如「2026年11月」 */
  label: string
  start: string
  end: string
  buckets: Bucket[]
  /** 区间内的实际流水（已按关键字 / 标签筛过） */
  rows: Transaction[]
  /** 区间内的各期预算（已按关键字 / 标签筛过） */
  occurrences: PlanOccurrence[]
  categories: Category[]
  onDrill: (drill: Drill) => void
}

/** 差额：实际比计划多为正 */
function diffClass(diff: number, type: 'expense' | 'income'): string {
  if (diff === 0) return 'text-secondary'
  const bad = type === 'expense' ? diff > 0 : diff < 0
  return bad ? 'text-expense' : 'text-income'
}

/**
 * 分析页「预算」口径：区间里预算账单的计划与实际对比。
 * KPI（计划 / 实际 / 差额 / 收入）、每段时间计划与实际支出、按分类对比、各条预算的执行情况、预算外支出排行，
 * 点击下钻到对应流水。
 */
export function PlanAnalysis({ label, start, end, buckets, rows, occurrences, categories, onDrill }: Props) {
  const expense = useMemo(() => planSide(occurrences, rows, 'expense'), [occurrences, rows])
  const income = useMemo(() => planSide(occurrences, rows, 'income'), [occurrences, rows])
  const points = useMemo<TrendPoint[]>(
    () => planSeries(occurrences, rows, buckets, 'expense').map((p) => ({ ...p, income: p.planned, expense: p.actual })),
    [occurrences, rows, buckets],
  )
  const byCategory = useMemo(() => categoryCompare(occurrences, rows, categories, 'expense'), [occurrences, rows, categories])
  const plans = useMemo(() => planRows(occurrences), [occurrences])
  const unplanned = useMemo<ShareItem[]>(() => {
    const list = unplannedByCategory(rows, categories, 'expense')
    const total = list.reduce((s, i) => s + i.actual, 0)
    return list.map((i) => ({
      key: i.key,
      name: i.name,
      amount: i.actual,
      count: i.count ?? 0,
      share: total > 0 ? i.actual / total : 0,
      categoryId: i.categoryId,
    }))
  }, [rows, categories])
  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories])
  const base = { start, end, noLink: true }

  if (occurrences.length === 0) {
    return (
      <div className="card empty-state">
        <CalendarClock size={40} aria-hidden="true" />
        <p className="t-body-m text-secondary">{label}没有预算账单</p>
        <p className="t-body-s text-tertiary">在「预算 · 预算账单」里把房租、工资这类计划中的收支记下来，这里就能和实际对比。</p>
        <Button onClick={() => (window.location.hash = '#/budget?tab=plans')}>去添加预算账单</Button>
      </div>
    )
  }

  /** 实际减计划，带「多 / 少」 */
  const more = (diff: number) => (diff === 0 ? '持平' : `${diff > 0 ? '多' : '少'} ${formatCents(Math.abs(diff))}`)
  const inPlanDiff = expense.actual - expense.donePlanned
  const incomeDue = income.planned - income.pendingAmount
  const incomeDiff = income.actualAll - incomeDue
  const tiles = [
    {
      label: '计划支出',
      value: formatCents(expense.planned),
      meta: `已实现 ${expense.done}/${expense.done + expense.pending + expense.overdue} 期${expense.overdue ? ` · 逾期 ${expense.overdue}` : ''}${expense.pendingAmount ? ` · 待发生 ${formatCents(expense.pendingAmount)}` : ''}`,
      metaClass: expense.overdue ? 'text-warning' : 'text-secondary',
    },
    {
      label: '预算内实际支出',
      value: formatCents(expense.inPlan),
      meta: expense.done ? `已实现 ${expense.done} 期计划 ${formatCents(expense.donePlanned)} · ${more(inPlanDiff)}` : '还没有对上实际的预算',
      metaClass: expense.done ? diffClass(inPlanDiff, 'expense') : 'text-secondary',
    },
    {
      label: '实际支出',
      value: formatCents(expense.actualAll),
      meta: `预算外 ${formatCents(expense.outPlan)}${expense.actualAll ? `（${formatPercent(expense.outPlan / expense.actualAll)}）` : ''}`,
      metaClass: 'text-secondary',
    },
    {
      label: '实际收入',
      value: formatCents(income.actualAll),
      meta: income.planned > 0 ? `到期计划 ${formatCents(incomeDue)} · ${more(incomeDiff)}${income.pendingAmount ? ` · 待发生 ${formatCents(income.pendingAmount)}` : ''}` : '没有计划收入',
      metaClass: income.planned > 0 && incomeDue > 0 ? diffClass(incomeDiff, 'income') : 'text-secondary',
    },
  ]

  const drillCategory = (item: CategoryCompare, plan?: 'out') =>
    onDrill({ ...base, title: `${label} · ${item.name}${plan ? ' · 预算外' : ''}`, type: 'expense', categoryId: item.categoryId ?? null, plan })

  const maxCategory = Math.max(0, ...byCategory.flatMap((c) => [c.planned, c.actual]))

  return (
    <>
      <section className="analysis-kpis" aria-label="预算对比概况">
        {tiles.map((tile) => (
          <div key={tile.label} className="card stat-tile">
            <span className="t-body-s text-secondary">{tile.label}</span>
            <strong className="stat-value">{tile.value}</strong>
            <span className="stat-meta">
              <span className={`t-caption ${tile.metaClass}`}>{tile.meta}</span>
            </span>
          </div>
        ))}
      </section>
      <div className="analysis-grid">
        <TrendChart
          title="计划与实际支出"
          hint={`${label} · 虚线柱为计划，实色为实际（含预算外）；点柱子看实际明细`}
          points={points}
          series={['income', 'expense']}
          labels={{ income: '计划', expense: '实际' }}
          className="chart-plan"
          onDrill={(p) => onDrill({ ...base, start: p.start, end: p.end, title: `${p.title} · 实际支出`, type: 'expense' })}
        />
        <div className="analysis-col">
          <section className="card chart-card" aria-label="按分类对比">
            <header className="chart-head">
              <div>
                <h2 className="t-title-s">按分类对比</h2>
                <p className="t-caption text-tertiary">有预算支出的分类：该分类的全部实际与到期的计划比，按差额排序</p>
              </div>
            </header>
            {byCategory.length === 0 ? (
              <p className="chart-empty t-body-s text-tertiary">{label}没有预算支出</p>
            ) : (
              <ol className="ranked-list">
                {byCategory.map((item) => {
                  const diff = compareDiff(item)
                  return (
                    <li key={item.key}>
                      <button
                        type="button"
                        className="ranked-row"
                        aria-label={`${item.name}，计划 ${formatCents(item.planned)}，实际 ${formatCents(item.actual)}，查看明细`}
                        onClick={() => drillCategory(item)}
                      >
                        <CategoryIcon category={categoryById.get(item.categoryId)} size={32} />
                        <span className="ranked-main">
                          <span className="ranked-line">
                            <span className="ranked-name t-body-m">{item.name}</span>
                            <span className={`ranked-amount t-num-s ${diffClass(diff, 'expense')}`}>
                              {diff === 0 ? '持平' : `${diff > 0 ? '超' : '省'} ${formatCents(Math.abs(diff))}`}
                            </span>
                          </span>
                          <span className="plan-compare-track" aria-hidden="true">
                            <span className="plan-compare-planned" style={{ width: `${maxCategory ? (item.planned / maxCategory) * 100 : 0}%` }} />
                            <span className="ranked-fill bar-expense" style={{ width: `${maxCategory ? (item.actual / maxCategory) * 100 : 0}%` }} />
                          </span>
                          <span className="ranked-meta t-caption text-tertiary">
                            计划 {formatCents(item.planned)}
                            {item.pending ? `（待发生 ${formatCents(item.pending)}）` : ''} · 实际 {formatCents(item.actual)}
                          </span>
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ol>
            )}
          </section>
          <RankedBars
            title="预算外支出"
            hint="没有对应任何预算的实际支出，按分类"
            items={unplanned}
            type="expense"
            empty={`${label}的支出都在预算内`}
            icon={(item) => <CategoryIcon category={categoryById.get(item.categoryId)} size={32} />}
            onDrill={(item) => drillCategory({ key: item.key, categoryId: item.categoryId, name: item.name, planned: 0, actual: item.amount }, 'out')}
          />
        </div>
        <div className="analysis-col">
          <section className="card chart-card" aria-label="各条预算">
            <header className="chart-head">
              <div>
                <h2 className="t-title-s">各条预算</h2>
                <p className="t-caption text-tertiary">差额只比已实现的期；点击看对应的实际流水</p>
              </div>
            </header>
            <ol className="ranked-list">
              {plans.map((r) => {
                const diff = r.actual - r.donePlanned
                return (
                  <li key={r.plan.uid ?? r.plan.id}>
                    <button
                      type="button"
                      className="ranked-row"
                      onClick={() =>
                        onDrill({ ...base, title: `${label} · 预算「${r.plan.name}」的实际`, type: r.plan.type, plan: r.plan.uid })
                      }
                    >
                      <CategoryIcon category={categoryById.get(r.plan.categoryId)} size={32} />
                      <span className="ranked-main">
                        <span className="ranked-line">
                          <span className="ranked-name t-body-m">{r.plan.name}</span>
                          <span className={`ranked-amount t-num-s ${r.plan.type === 'income' ? 'amount-income' : ''}`}>
                            {r.plan.type === 'income' ? '+' : ''}
                            {formatCents(r.planned)}
                          </span>
                        </span>
                        <span className="ranked-meta t-caption text-tertiary">
                          {repeatText(r.plan)} · 已实现 {r.done}/{r.count} 期
                          {r.overdue > 0 && <span className="text-warning"> · 逾期 {r.overdue}</span>}
                          {r.skipped > 0 && ` · 跳过 ${r.skipped}`}
                          {r.done > 0 && (
                            <>
                              {' · 实际 '}
                              {formatCents(r.actual)}
                              <span className={diffClass(diff, r.plan.type)}>{diff === 0 ? ' 持平' : ` ${diff > 0 ? '多' : '少'} ${formatCents(Math.abs(diff))}`}</span>
                            </>
                          )}
                        </span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ol>
          </section>
        </div>
      </div>
    </>
  )
}

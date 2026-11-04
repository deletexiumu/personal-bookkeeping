import { useLiveQuery } from 'dexie-react-hooks'
import { ChartNoAxesColumn, Download } from 'lucide-react'
import { useMemo, useState } from 'react'
import { BudgetCard } from '../components/analysis/BudgetCard'
import { DrillDialog } from '../components/analysis/DrillDialog'
import { KpiRow } from '../components/analysis/KpiRow'
import { PeriodBar } from '../components/analysis/PeriodBar'
import { RankedBars } from '../components/analysis/RankedBars'
import { TrendChart } from '../components/analysis/TrendChart'
import { CategoryIcon } from '../components/CategoryIcon'
import { PageHeader } from '../components/layout/AppShell'
import { makeLookup } from '../components/transactions/display'
import { Button } from '../components/ui/Button'
import { useToast } from '../components/ui/toast-context'
import { db } from '../db'
import { listBudgets } from '../db/budgets'
import { listByMonth, listByRange } from '../db/transactions'
import { categoryShares, merchantTop, periodStats, trendSeries, type Drill, type TrendPoint } from '../lib/analysis'
import { monthOf, today } from '../lib/date'
import { downloadText } from '../lib/download'
import { csvFileName, transactionsToCsv } from '../lib/exportCsv'
import { bucketsOf, COMPARE_LABELS, elapsedDays, periodLabel, periodOf, shiftPeriod, type Period } from '../lib/period'
import type { Account, Category, CategoryType, Transaction } from '../types'

interface Props {
  categories: Category[]
  accounts: Account[]
}

const TYPE_LABEL: Record<CategoryType, string> = { expense: '支出', income: '收入' }

/** 超过这么多根柱子（按天的月视图、长自定义区间）时，趋势只画筛选行选中的方向 */
const MAX_GROUPED_BUCKETS = 16

/** 区间流水；切换区间时 useLiveQuery 会在新数据到达前保留上一份结果，不会闪成空白 */
function useRangeRows(start: string, end: string): Transaction[] {
  return useLiveQuery(() => listByRange(db, start, end), [start, end], [])
}

function monthlyAverage(expense: number, period: Period, todayDate: string): number {
  const months = bucketsOf(period).filter((b) => b.start <= todayDate).length
  return months > 0 ? Math.round(expense / months) : 0
}

function dailyAverage(expense: number, period: Period, todayDate: string): number {
  const days = elapsedDays(period, todayDate)
  return days > 0 ? Math.round(expense / days) : 0
}

/**
 * 分析页（M03 / D02）：一行筛选（区间 + 方向）作用于下面所有内容。
 * KPI 与上一期对比；收支趋势、分类构成、商户排行、预算执行，点击任意图形下钻到对应流水。
 */
export function AnalysisPage({ categories, accounts }: Props) {
  const toast = useToast()
  const todayDate = today()
  const [period, setPeriod] = useState<Period>(() => periodOf('month', todayDate))
  const [type, setType] = useState<CategoryType>('expense')
  const [drill, setDrill] = useState<{ drill: Drill; source: 'period' | 'budget' }>()
  const previous = shiftPeriod(period, -1)
  const rows = useRangeRows(period.start, period.end)
  const previousRows = useRangeRows(previous.start, previous.end)
  // 预算按月循环：显示区间结束（还没到时取今天）所在月份
  const budgetMonth = monthOf(period.end < todayDate ? period.end : period.start > todayDate ? period.start : todayDate)
  const budgetRows = useLiveQuery(() => listByMonth(db, budgetMonth), [budgetMonth], [])
  const budgets = useLiveQuery(() => listBudgets(db), [], [])
  const lookup = useMemo(() => makeLookup(categories, accounts), [categories, accounts])

  const stats = periodStats(rows)
  const previousStats = periodStats(previousRows)
  const buckets = useMemo(() => bucketsOf(period), [period])
  const points = useMemo(() => trendSeries(rows, buckets), [rows, buckets])
  const shares = useMemo(() => categoryShares(rows, categories, type), [rows, categories, type])
  const merchants = useMemo(() => merchantTop(rows, type), [rows, type])
  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories])

  const grouped = buckets.length <= MAX_GROUPED_BUCKETS
  const byMonth = buckets[0] && buckets[0].start !== buckets[0].end
  const label = periodLabel(period, todayDate)
  const typeLabel = TYPE_LABEL[type]
  const average = byMonth
    ? {
        label: '月均支出',
        value: monthlyAverage(stats.expense, period, todayDate),
        previous: monthlyAverage(previousStats.expense, previous, todayDate),
      }
    : {
        label: '日均支出',
        value: dailyAverage(stats.expense, period, todayDate),
        previous: dailyAverage(previousStats.expense, previous, todayDate),
      }

  const openPoint = (p: TrendPoint) =>
    setDrill({
      source: 'period',
      drill: { title: `${p.title}${grouped ? '收支' : typeLabel}`, start: p.start, end: p.end, type: grouped ? undefined : type },
    })

  function exportPeriod() {
    downloadText(csvFileName(period), transactionsToCsv(rows, categories, accounts), 'text/csv;charset=utf-8')
    toast.show({ message: `已导出${label}的 ${rows.length} 条流水` })
  }

  return (
    <div className="page analysis-page">
      <PageHeader
        title="分析"
        actions={
          <Button size="sm" onClick={exportPeriod} disabled={rows.length === 0}>
            <Download size={16} aria-hidden="true" />
            导出 CSV
          </Button>
        }
      />
      <PeriodBar period={period} onPeriodChange={setPeriod} type={type} onTypeChange={setType} />
      <KpiRow current={stats} previous={previousStats} compareLabel={COMPARE_LABELS[period.kind]} average={average} />

      {stats.count === 0 ? (
        <div className="card empty-state">
          <ChartNoAxesColumn size={40} aria-hidden="true" />
          <p className="t-body-m text-secondary">{label}还没有收支记录</p>
          <p className="t-body-s text-tertiary">记一笔或导入账单后，这里会出现趋势、构成和排行。</p>
        </div>
      ) : (
        <div className="analysis-grid">
          <TrendChart
            title={grouped ? '收支趋势' : `每日${typeLabel}`}
            hint={grouped ? `${label} · 点柱子看该时段明细` : `${label} · 点柱子看当日明细`}
            points={points}
            series={grouped ? ['expense', 'income'] : [type]}
            onDrill={openPoint}
          />
          <div className="analysis-col">
            <RankedBars
              title={`${typeLabel}构成`}
              hint="按分类，点击查看明细"
              items={shares}
              type={type}
              empty={`${label}没有${typeLabel}`}
              icon={(item) => <CategoryIcon category={categoryById.get(item.categoryId)} size={32} />}
              onDrill={(item) =>
                setDrill({
                  source: 'period',
                  drill: { title: `${label} · ${item.name}`, start: period.start, end: period.end, type, categoryId: item.categoryId ?? null },
                })
              }
            />
            <BudgetCard
              month={budgetMonth}
              budgets={budgets}
              rows={budgetRows}
              categories={categories}
              onDrill={(categoryId) =>
                setDrill({
                  source: 'budget',
                  drill: {
                    title: `${Number(budgetMonth.slice(5))}月 · ${categoryById.get(categoryId)?.name ?? '分类'}`,
                    start: `${budgetMonth}-01`,
                    end: `${budgetMonth}-31`,
                    type: 'expense',
                    categoryId,
                  },
                })
              }
            />
          </div>
          <div className="analysis-col">
            <RankedBars
              title={`商户 Top ${merchants.length || 5}`}
              hint="按金额，没有商户时按备注"
              items={merchants}
              type={type}
              empty={`${label}的${typeLabel}没有商户或备注`}
              onDrill={(item) =>
                setDrill({
                  source: 'period',
                  drill: { title: `${label} · ${item.name}`, start: period.start, end: period.end, type, merchant: item.merchant },
                })
              }
            />
          </div>
        </div>
      )}

      {drill && (
        <DrillDialog
          drill={drill.drill}
          rows={drill.source === 'budget' ? budgetRows : rows}
          categories={categories}
          accounts={accounts}
          lookup={lookup}
          onClose={() => setDrill(undefined)}
        />
      )}
    </div>
  )
}

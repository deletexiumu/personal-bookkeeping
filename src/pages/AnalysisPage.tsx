import { useLiveQuery } from 'dexie-react-hooks'
import { ChartNoAxesColumn, Download, Search, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { BudgetCard } from '../components/analysis/BudgetCard'
import { DrillDialog } from '../components/analysis/DrillDialog'
import { KeywordCard } from '../components/analysis/KeywordCard'
import { KpiRow } from '../components/analysis/KpiRow'
import { MerchantNetList } from '../components/analysis/MerchantNetList'
import { PeriodBar } from '../components/analysis/PeriodBar'
import { RankedBars } from '../components/analysis/RankedBars'
import { TrendChart } from '../components/analysis/TrendChart'
import { CategoryIcon } from '../components/CategoryIcon'
import { PageHeader } from '../components/layout/AppShell'
import { makeLookup } from '../components/transactions/display'
import { Button, IconButton } from '../components/ui/Button'
import { useToast } from '../components/ui/toast-context'
import { db } from '../db'
import { listBudgets } from '../db/budgets'
import { listByMonth, listByRange } from '../db/transactions'
import {
  categoryShares,
  matchKeywords,
  merchantNet,
  merchantTop,
  parseKeywords,
  periodStats,
  trendSeries,
  type AnalysisView,
  type Drill,
  type ShareItem,
  type TrendPoint,
} from '../lib/analysis'
import { useAssistantPage } from '../lib/ai/context'
import { analysisPageData } from '../lib/ai/pages'
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

/** 区间流水（再按关键字筛）；切换区间时 useLiveQuery 会在新数据到达前保留上一份结果，不会闪成空白 */
function useRangeRows(start: string, end: string, keywords: string[]): Transaction[] {
  const rows = useLiveQuery(() => listByRange(db, start, end), [start, end], [])
  return useMemo(() => (keywords.length > 0 ? rows.filter((t) => matchKeywords(t, keywords)) : rows), [rows, keywords])
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
 * 分析页（M03 / D02）：筛选行（区间 + 口径）和关键字作用于下面所有内容。
 * KPI 与上一期对比；收支趋势、分类构成、商户排行、预算执行，点击任意图形下钻到对应流水。
 * 「合计」口径把同一商户的支出和收入放在一起看净额；关键字匹配商户或备注，多个叫法合并统计。
 */
export function AnalysisPage({ categories, accounts }: Props) {
  const toast = useToast()
  const todayDate = today()
  const [period, setPeriod] = useState<Period>(() => periodOf('month', todayDate))
  const [view, setView] = useState<AnalysisView>('expense')
  const [keywordInput, setKeywordInput] = useState('')
  const keywords = useMemo(() => parseKeywords(keywordInput), [keywordInput])
  const [drill, setDrill] = useState<{ drill: Drill; source: 'period' | 'budget' }>()
  const previous = shiftPeriod(period, -1)
  const rows = useRangeRows(period.start, period.end, keywords)
  const previousRows = useRangeRows(previous.start, previous.end, keywords)
  // 预算按月循环：显示区间结束（还没到时取今天）所在月份
  const budgetMonth = monthOf(period.end < todayDate ? period.end : period.start > todayDate ? period.start : todayDate)
  const budgetRows = useLiveQuery(() => listByMonth(db, budgetMonth), [budgetMonth], [])
  const budgets = useLiveQuery(() => listBudgets(db), [], [])
  const lookup = useMemo(() => makeLookup(categories, accounts), [categories, accounts])

  const stats = periodStats(rows)
  const previousStats = periodStats(previousRows)
  const buckets = useMemo(() => bucketsOf(period), [period])
  const points = useMemo(() => trendSeries(rows, buckets), [rows, buckets])
  const expenseShares = useMemo(() => categoryShares(rows, categories, 'expense'), [rows, categories])
  const incomeShares = useMemo(() => categoryShares(rows, categories, 'income'), [rows, categories])
  // 有关键字时列出全部命中的名称，方便核对哪些叫法被合并了
  const merchantLimit = keywords.length > 0 ? Infinity : 5
  const merchants = useMemo(
    () => (view === 'all' ? [] : merchantTop(rows, view, merchantLimit)),
    [rows, view, merchantLimit],
  )
  const nets = useMemo(() => merchantNet(rows), [rows])
  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories])

  const all = view === 'all'
  const both = all || buckets.length <= MAX_GROUPED_BUCKETS
  const byMonth = buckets[0] && buckets[0].start !== buckets[0].end
  const label = periodLabel(period, todayDate)
  // 关键字只有一个时，跳明细页可以带上它继续筛选
  const query = keywords.length === 1 ? keywords[0] : undefined
  const noLink = keywords.length > 1 || undefined
  const keywordLabel = keywords.length > 0 ? `「${keywords.join(' / ')}」` : ''
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
      drill: {
        title: `${p.title}${keywordLabel}${both ? '收支' : TYPE_LABEL[view as CategoryType]}`,
        start: p.start,
        end: p.end,
        type: both ? undefined : (view as CategoryType),
        query,
        noLink,
      },
    })

  const openMerchant = (name: string, type?: CategoryType) =>
    setDrill({
      source: 'period',
      drill: { title: `${label} · ${name}`, start: period.start, end: period.end, type, merchant: name },
    })

  const viewLabel = { expense: '支出', income: '收入', all: '合计' }[view]
  useAssistantPage(`分析 · ${label} · ${viewLabel}${keywordLabel}`, () =>
    analysisPageData({
      period: { start: period.start, end: period.end, label },
      compareLabel: COMPARE_LABELS[period.kind],
      view,
      keywords,
      current: stats,
      previous: previousStats,
      average,
      expenseShares,
      incomeShares,
      merchants,
      nets,
      points,
    }),
  )

  function exportPeriod() {
    downloadText(csvFileName(period), transactionsToCsv(rows, categories, accounts), 'text/csv;charset=utf-8')
    toast.show({ message: `已导出${label}${keywordLabel}的 ${rows.length} 条流水` })
  }

  function compositionCard(type: CategoryType, items: ShareItem[]) {
    const typeLabel = TYPE_LABEL[type]
    return (
      <RankedBars
        key={type}
        title={`${typeLabel}构成`}
        hint="按分类，点击查看明细"
        items={items}
        type={type}
        empty={`${label}没有${typeLabel}`}
        icon={(item) => <CategoryIcon category={categoryById.get(item.categoryId)} size={32} />}
        onDrill={(item) =>
          setDrill({
            source: 'period',
            drill: {
              title: `${label}${keywordLabel} · ${item.name}`,
              start: period.start,
              end: period.end,
              type,
              categoryId: item.categoryId ?? null,
              query,
              noLink,
            },
          })
        }
      />
    )
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
      <PeriodBar period={period} onPeriodChange={setPeriod} type={view} onTypeChange={setView} />
      <label className="search-field analysis-search" role="search">
        <Search size={16} aria-hidden="true" className="text-tertiary" />
        <input
          type="search"
          aria-label="按商户或备注关键字筛选，多个关键字用空格分隔，命中任一个即合并统计"
          placeholder="商户 / 备注关键字，多个用空格分隔"
          value={keywordInput}
          onChange={(e) => setKeywordInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Escape') return
            setKeywordInput('')
            e.currentTarget.blur()
          }}
        />
        {keywordInput && (
          <IconButton label="清除关键字" onClick={() => setKeywordInput('')}>
            <X size={16} />
          </IconButton>
        )}
      </label>
      {keywords.length > 0 && stats.count > 0 && (
        <KeywordCard
          keywords={keywords}
          stats={stats}
          names={nets}
          onDrillAll={() =>
            setDrill({
              source: 'period',
              drill: { title: `${label} · ${keywordLabel}`, start: period.start, end: period.end, query, noLink },
            })
          }
          onDrillName={(item) => openMerchant(item.name)}
        />
      )}
      <KpiRow current={stats} previous={previousStats} compareLabel={COMPARE_LABELS[period.kind]} average={average} />

      {stats.count === 0 ? (
        <div className="card empty-state">
          <ChartNoAxesColumn size={40} aria-hidden="true" />
          {keywords.length > 0 ? (
            <>
              <p className="t-body-m text-secondary">
                {label}没有匹配{keywordLabel}的收支
              </p>
              <p className="t-body-s text-tertiary">关键字匹配商户和备注，换个叫法或多写几个试试。</p>
            </>
          ) : (
            <>
              <p className="t-body-m text-secondary">{label}还没有收支记录</p>
              <p className="t-body-s text-tertiary">记一笔或导入账单后，这里会出现趋势、构成和排行。</p>
            </>
          )}
        </div>
      ) : (
        <div className="analysis-grid">
          <TrendChart
            title={buckets.length <= MAX_GROUPED_BUCKETS ? '收支趋势' : all ? '每日收支' : `每日${TYPE_LABEL[view]}`}
            hint={buckets.length <= MAX_GROUPED_BUCKETS ? `${label} · 点柱子看该时段明细` : `${label} · 点柱子看当日明细`}
            points={points}
            series={both ? ['expense', 'income'] : [view]}
            onDrill={openPoint}
          />
          <div className="analysis-col">
            {all
              ? [compositionCard('expense', expenseShares), compositionCard('income', incomeShares)]
              : compositionCard(view, view === 'expense' ? expenseShares : incomeShares)}
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
            {all ? (
              <MerchantNetList
                title="商户收支"
                hint="同一商户的支出和收入合在一行，右侧为净额"
                items={nets}
                limit={keywords.length > 0 ? 20 : 8}
                empty={`${label}的收支没有商户或备注`}
                onDrill={(item) => openMerchant(item.name)}
              />
            ) : (
              <RankedBars
                title={keywords.length > 0 ? '商户排行' : `商户 Top ${merchants.length || 5}`}
                hint="按金额，没有商户时按备注"
                items={merchants}
                type={view}
                empty={`${label}的${TYPE_LABEL[view]}没有商户或备注`}
                onDrill={(item) => openMerchant(item.merchant ?? item.name, view)}
              />
            )}
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

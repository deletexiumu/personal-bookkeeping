import { useLiveQuery } from 'dexie-react-hooks'
import { ChartNoAxesColumn, Download, Search, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { BudgetCard } from '../components/analysis/BudgetCard'
import { DrillDialog } from '../components/analysis/DrillDialog'
import { KeywordCard } from '../components/analysis/KeywordCard'
import { KpiRow } from '../components/analysis/KpiRow'
import { MerchantNetList } from '../components/analysis/MerchantNetList'
import { PlanAnalysis } from '../components/analysis/PlanAnalysis'
import { PeriodBar } from '../components/analysis/PeriodBar'
import { RankedBars } from '../components/analysis/RankedBars'
import { TrendChart } from '../components/analysis/TrendChart'
import { CategoryIcon } from '../components/CategoryIcon'
import { useTags } from '../components/tags/useTags'
import { PageHeader } from '../components/layout/AppShell'
import { makeLookup } from '../components/transactions/display'
import { Button, IconButton } from '../components/ui/Button'
import { useToast } from '../components/ui/toast-context'
import { db } from '../db'
import { listBudgets } from '../db/budgets'
import { loadOccurrences } from '../db/plans'
import { matchPlanFilter } from '../lib/planAnalysis'
import type { PlanOccurrence } from '../lib/plans'
import { listByMonth, listByRange } from '../db/transactions'
import {
  categoryShares,
  changeRatio,
  formatChange,
  matchKeywords,
  matchTag,
  merchantNet,
  merchantTop,
  parseKeywords,
  periodStats,
  tagNet,
  tagShares,
  trendSeries,
  type AnalysisMode,
  type AnalysisView,
  type Drill,
  type ShareItem,
  type TagNet,
  type TrendPoint,
} from '../lib/analysis'
import { useAssistantPage } from '../lib/ai/context'
import { analysisPageData } from '../lib/ai/pages'
import { monthOf, today } from '../lib/date'
import { UNTAGGED } from '../lib/filter'
import { withEffectiveTags, type TagResolver } from '../lib/tags'
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

/** 区间流水（再按关键字、标签筛）；切换区间时 useLiveQuery 会在新数据到达前保留上一份结果，不会闪成空白 */
function useRangeRows(start: string, end: string, keywords: string[], tag: string | undefined, resolve: TagResolver): Transaction[] {
  const rows = useLiveQuery(() => listByRange(db, start, end), [start, end], [])
  return useMemo(
    () => (keywords.length > 0 || tag ? rows.filter((t) => matchKeywords(t, keywords) && matchTag(t, tag, resolve)) : rows),
    [rows, keywords, tag, resolve],
  )
}

const tagIcon = (item: { tag?: string | null }) => (
  <span className={`ranked-tag-icon ${item.tag === null ? 'is-untagged' : ''}`} aria-hidden="true">
    #
  </span>
)

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
 * 选了标签时整页只看该标签（单笔标签优先，没有时沿用商户标签）的收支，KPI、趋势、构成、商户都随之收窄。
 */
export function AnalysisPage({ categories, accounts }: Props) {
  const toast = useToast()
  const todayDate = today()
  const [period, setPeriod] = useState<Period>(() => periodOf('month', todayDate))
  const [mode, setMode] = useState<AnalysisMode>('expense')
  const planMode = mode === 'plan'
  const view: AnalysisView = planMode ? 'expense' : mode
  const [keywordInput, setKeywordInput] = useState('')
  const keywords = useMemo(() => parseKeywords(keywordInput), [keywordInput])
  const [tagFilter, setTagFilter] = useState<string>()
  const [drill, setDrill] = useState<{ drill: Drill; source: 'period' | 'budget' }>()
  const { tags, resolve } = useTags()
  const previous = shiftPeriod(period, -1)
  const rows = useRangeRows(period.start, period.end, keywords, tagFilter, resolve)
  const previousRows = useRangeRows(previous.start, previous.end, keywords, tagFilter, resolve)
  // 预算按月循环：显示区间结束（还没到时取今天）所在月份
  const budgetMonth = monthOf(period.end < todayDate ? period.end : period.start > todayDate ? period.start : todayDate)
  const budgetRows = useLiveQuery(() => listByMonth(db, budgetMonth), [budgetMonth], [])
  const budgets = useLiveQuery(() => listBudgets(db), [], [])
  const lookup = useMemo(() => makeLookup(categories, accounts, resolve), [categories, accounts, resolve])
  const allOccurrences = useLiveQuery(
    () => loadOccurrences(db, period.start, period.end, todayDate),
    [period.start, period.end, todayDate],
    [] as PlanOccurrence[],
  )
  const occurrences = useMemo(
    () => allOccurrences.filter((o) => matchPlanFilter(o.plan, keywords, tagFilter, UNTAGGED)),
    [allOccurrences, keywords, tagFilter],
  )

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
  const tagView: CategoryType = view === 'all' ? 'expense' : view
  const tagItems = useMemo(() => tagShares(rows, tagView, resolve), [rows, tagView, resolve])
  const previousTagAmounts = useMemo(
    () => new Map(tagShares(previousRows, tagView, resolve).map((item) => [item.key, item.amount])),
    [previousRows, tagView, resolve],
  )
  const tagNets = useMemo(() => tagNet(rows, resolve), [rows, resolve])
  const tagNames = useMemo(() => tags.map((t) => t.name), [tags])
  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories])

  const all = view === 'all'
  const both = all || buckets.length <= MAX_GROUPED_BUCKETS
  const byMonth = buckets[0] && buckets[0].start !== buckets[0].end
  const label = periodLabel(period, todayDate)
  // 关键字只有一个时，跳明细页可以带上它继续筛选
  const query = keywords.length === 1 ? keywords[0] : undefined
  const noLink = keywords.length > 1 || undefined
  // 选了标签时，下钻和跳明细页都带上它
  const tagDrill = tagFilter === undefined ? undefined : tagFilter === UNTAGGED ? null : tagFilter
  const tagLabel = tagFilter === undefined ? '' : tagFilter === UNTAGGED ? '「未打标签」' : `「#${tagFilter}」`
  const keywordLabel = (keywords.length > 0 ? `「${keywords.join(' / ')}」` : '') + tagLabel
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
        tag: tagDrill,
        query,
        noLink,
      },
    })

  const openMerchant = (name: string, type?: CategoryType) =>
    setDrill({
      source: 'period',
      drill: { title: `${label}${tagLabel} · ${name}`, start: period.start, end: period.end, type, merchant: name, tag: tagDrill },
    })

  const openTag = (item: { name: string; tag?: string | null }, type?: CategoryType) =>
    setDrill({
      source: 'period',
      drill: {
        title: `${label}${keywordLabel} · ${item.name}`,
        start: period.start,
        end: period.end,
        type,
        tag: item.tag,
        query,
        // 明细页一次只能筛一个标签：选了标签又点了同时打着的另一个标签时，明细页复现不了
        noLink: noLink || (tagDrill !== undefined && item.tag !== tagDrill) || undefined,
      },
    })

  const viewLabel = { expense: '支出', income: '收入', all: '合计', plan: '预算对比' }[mode]
  useAssistantPage(`分析 · ${label} · ${viewLabel}${keywordLabel}`, () =>
    analysisPageData({
      period: { start: period.start, end: period.end, label },
      compareLabel: COMPARE_LABELS[period.kind],
      view,
      keywords,
      tag: tagFilter === undefined ? undefined : tagFilter === UNTAGGED ? '未打标签' : tagFilter,
      current: stats,
      previous: previousStats,
      average,
      expenseShares,
      incomeShares,
      merchants,
      nets,
      tags: { type: tagView, items: tagItems },
      tagNets: all ? tagNets : undefined,
      points,
      plans: occurrences,
    }),
  )

  function exportPeriod() {
    downloadText(csvFileName(period), transactionsToCsv(withEffectiveTags(rows, resolve), categories, accounts), 'text/csv;charset=utf-8')
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
              tag: tagDrill,
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
      <PeriodBar period={period} onPeriodChange={setPeriod} type={mode} onTypeChange={setMode} />
      <div className="analysis-filters">
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
        <select
          className="filter-select analysis-tag-select"
          aria-label="只看某个标签"
          data-active={tagFilter ? '' : undefined}
          value={tagFilter ?? ''}
          onChange={(e) => setTagFilter(e.target.value || undefined)}
        >
          <option value="">全部标签</option>
          <option value={UNTAGGED}>未打标签</option>
          {tagNames.map((t) => (
            <option key={t} value={t}>
              #{t}
            </option>
          ))}
        </select>
      </div>
      {planMode ? (
        <PlanAnalysis
          label={`${label}${keywordLabel}`}
          start={period.start}
          end={period.end}
          buckets={buckets}
          rows={rows}
          occurrences={occurrences}
          categories={categories}
          onDrill={(d) => setDrill({ source: 'period', drill: { ...d, tag: tagDrill } })}
        />
      ) : (
        <>
      {keywords.length > 0 && stats.count > 0 && (
        <KeywordCard
          keywords={keywords}
          stats={stats}
          names={nets}
          onDrillAll={() =>
            setDrill({
              source: 'period',
              drill: { title: `${label} · ${keywordLabel}`, start: period.start, end: period.end, tag: tagDrill, query, noLink },
            })
          }
          onDrillName={(item) => openMerchant(item.name)}
        />
      )}
      <KpiRow current={stats} previous={previousStats} compareLabel={COMPARE_LABELS[period.kind]} average={average} />

      {stats.count === 0 ? (
        <div className="card empty-state">
          <ChartNoAxesColumn size={40} aria-hidden="true" />
          {keywords.length > 0 || tagFilter ? (
            <>
              <p className="t-body-m text-secondary">
                {label}没有匹配{keywordLabel}的收支
              </p>
              <p className="t-body-s text-tertiary">
                {keywords.length > 0 ? '关键字匹配商户和备注，换个叫法或多写几个试试。' : '换个区间或标签试试。'}
              </p>
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
              <MerchantNetList<TagNet>
                title="标签收支"
                hint="同一标签的支出和收入合在一行，右侧为净额；单笔标签优先，没有时沿用商户标签"
                items={tagNets}
                limit={8}
                empty={`${label}没有收支`}
                icon={tagIcon}
                onDrill={(item) => openTag(item)}
              />
            ) : (
              <RankedBars
                title={`${TYPE_LABEL[tagView]}标签`}
                hint="单笔标签优先，没有时沿用商户标签；一笔多个标签时分别计入"
                items={tagItems}
                type={tagView}
                empty={`${label}没有${TYPE_LABEL[tagView]}`}
                icon={tagIcon}
                extra={(item) => {
                  const ratio = changeRatio(item.amount, previousTagAmounts.get(item.key) ?? 0)
                  return ratio === null ? null : ` · ${COMPARE_LABELS[period.kind]} ${formatChange(ratio)}`
                }}
                onDrill={(item) => openTag(item, tagView)}
              />
            )}
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
        </>
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

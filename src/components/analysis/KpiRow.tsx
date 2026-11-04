import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'
import { changeRatio, formatChange, formatPercent, type PeriodStats } from '../../lib/analysis'
import { formatCents } from '../../lib/money'

interface Props {
  current: PeriodStats
  previous: PeriodStats
  /** 「较上月」等 */
  compareLabel: string
  /** 日均 / 月均支出 */
  average: { label: string; value: number; previous: number }
}

function Delta({ current, previous, compareLabel }: { current: number; previous: number; compareLabel: string }) {
  const ratio = changeRatio(current, previous)
  if (ratio === null) {
    return <span className="kpi-delta t-caption text-tertiary">{current === 0 ? '暂无记录' : `${compareLabel.slice(1)}无记录`}</span>
  }
  const Icon = ratio > 0.0005 ? ArrowUpRight : ratio < -0.0005 ? ArrowDownRight : Minus
  return (
    <span className="kpi-delta t-caption text-secondary">
      <Icon size={14} aria-hidden="true" />
      {compareLabel} {formatChange(ratio)}
    </span>
  )
}

/** 区间 KPI：支出、收入、结余（储蓄率）、日均 / 月均支出，各自与上一期对比 */
export function KpiRow({ current, previous, compareLabel, average }: Props) {
  const tiles = [
    { label: '支出', value: current.expense, previous: previous.expense },
    { label: '收入', value: current.income, previous: previous.income },
    {
      label: '结余',
      value: current.balance,
      previous: previous.balance,
      note: current.savingsRate === null ? undefined : `储蓄率 ${formatPercent(current.savingsRate)}`,
    },
    { label: average.label, value: average.value, previous: average.previous },
  ]
  return (
    <section className="analysis-kpis" aria-label="区间概况">
      {tiles.map((tile) => (
        <div key={tile.label} className="card stat-tile">
          <span className="t-body-s text-secondary">{tile.label}</span>
          <strong className="stat-value">{formatCents(tile.value)}</strong>
          <span className="stat-meta">
            <Delta current={tile.value} previous={tile.previous} compareLabel={compareLabel} />
            {tile.note && <span className="t-caption text-secondary">{tile.note}</span>}
          </span>
        </div>
      ))}
    </section>
  )
}

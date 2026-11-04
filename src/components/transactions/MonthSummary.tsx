import type { MonthSummary as Summary } from '../../db/transactions'
import type { BudgetStatus } from '../../lib/budget'
import { formatCents } from '../../lib/money'
import { ProgressBar } from '../ui/ProgressBar'

interface Props {
  summary: Summary
  /** 有筛选条件时，汇总只统计筛选结果 */
  filtered?: boolean
  /** 本月总预算执行情况（未设置或有筛选时不传） */
  budget?: BudgetStatus
  daysLeft?: number
}

const LEVEL_CLASS = { ok: '', warning: 'text-warning', over: 'text-expense' } as const

/** 本月汇总：移动端为品牌色汇总卡，桌面端为 KPI 条；设置了总预算时显示预算进度 */
export function MonthSummary({ summary, filtered = false, budget, daysLeft }: Props) {
  const prefix = filtered ? '筛选' : '本月'
  const percent = budget && Math.round(budget.ratio * 100)
  const budgetMeta = budget && `已用 ${percent}%${daysLeft ? ` · 剩 ${daysLeft} 天` : ''}`
  return (
    <section className={`summary ${budget ? 'summary-with-budget' : ''}`} aria-label={`${prefix}汇总`}>
      <div className="kpi kpi-main">
        <span className="kpi-label t-body-s">{prefix}支出</span>
        <strong className="kpi-value t-num-xl">{formatCents(summary.expense)}</strong>
      </div>
      <div className="kpi">
        <span className="kpi-label t-body-s">{prefix}收入</span>
        <strong className="kpi-value t-num-l">{formatCents(summary.income)}</strong>
      </div>
      <div className="kpi">
        <span className="kpi-label t-body-s">结余</span>
        <strong className="kpi-value t-num-l">{formatCents(summary.balance)}</strong>
      </div>
      {budget && (
        <a className="kpi kpi-budget" href="#/budget" aria-label={`预算剩余 ${formatCents(budget.remaining)}，${budgetMeta}`}>
          <span className="kpi-label t-body-s">
            <span className="kpi-budget-title">预算剩余</span>
            <span className="kpi-budget-total">月预算 {formatCents(budget.amount)}</span>
          </span>
          <strong className="kpi-value t-num-l">{formatCents(budget.remaining)}</strong>
          <ProgressBar ratio={budget.ratio} level={budget.level} label="本月预算" onBrand />
          <span className={`kpi-budget-meta t-caption ${LEVEL_CLASS[budget.level]}`}>{budgetMeta}</span>
        </a>
      )}
    </section>
  )
}

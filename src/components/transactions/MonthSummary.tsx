import type { MonthSummary as Summary } from '../../db/transactions'
import { formatCents } from '../../lib/money'

interface Props {
  summary: Summary
  /** 有筛选条件时，汇总只统计筛选结果 */
  filtered?: boolean
}

/** 本月汇总：移动端为品牌色汇总卡，桌面端为 KPI 条 */
export function MonthSummary({ summary, filtered = false }: Props) {
  const prefix = filtered ? '筛选' : '本月'
  return (
    <section className="summary" aria-label={`${prefix}汇总`}>
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
    </section>
  )
}

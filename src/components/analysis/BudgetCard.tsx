import { formatPercent } from '../../lib/analysis'
import { monthBudgets } from '../../lib/budget'
import { formatCents } from '../../lib/money'
import type { Budget, Category, Transaction } from '../../types'
import { CategoryIcon } from '../CategoryIcon'
import { ProgressBar } from '../ui/ProgressBar'

interface Props {
  /** 预算按月循环，展示区间结束（或今天）所在的月份 */
  month: string
  budgets: Budget[]
  /** 该月的流水 */
  rows: Transaction[]
  categories: Category[]
  onDrill: (categoryId: number) => void
}

const LEVEL_TEXT = { ok: 'text-tertiary', warning: 'text-warning', over: 'text-expense' } as const

/** 预算执行：总预算与各分类预算的已用比例（> 80% 橙、> 100% 红，同时有文字说明） */
export function BudgetCard({ month, budgets, rows, categories, onDrill }: Props) {
  const { total, categories: items } = monthBudgets(budgets, rows)
  const names = new Map(categories.map((c) => [c.id, c]))
  const monthLabel = `${Number(month.slice(5, 7))}月`

  return (
    <section className="card chart-card" aria-label={`${monthLabel}预算执行`}>
      <header className="chart-head">
        <div>
          <h2 className="t-title-s">{monthLabel}预算执行</h2>
          <p className="t-caption text-tertiary">预算按月循环，点分类看当月流水</p>
        </div>
        <a className="btn btn-ghost btn-sm" href="#/budget">
          调整
        </a>
      </header>
      {!total && items.length === 0 ? (
        <p className="chart-empty t-body-s text-tertiary">
          还没有设置预算。<a className="text-link" href="#/budget">去设置</a>
        </p>
      ) : (
        <ul className="budget-exec">
          {total && (
            <li className="budget-exec-row">
              <span className="budget-exec-line">
                <span className="t-body-m-strong">总预算</span>
                <span className="t-num-s">
                  {formatCents(total.spent)} <span className="text-tertiary">/ {formatCents(total.amount)}</span>
                </span>
              </span>
              <ProgressBar ratio={total.ratio} level={total.level} label="总预算" />
              <span className={`t-caption ${LEVEL_TEXT[total.level]}`}>
                已用 {formatPercent(total.ratio)}
                {total.remaining < 0 ? ` · 超支 ${formatCents(-total.remaining)}` : ` · 剩余 ${formatCents(total.remaining)}`}
              </span>
            </li>
          )}
          {items.map((item) => {
            const category = names.get(item.categoryId)
            const name = category?.name ?? '已删除分类'
            return (
              <li key={item.categoryId}>
                <button
                  type="button"
                  className="budget-exec-row budget-exec-button"
                  onClick={() => onDrill(item.categoryId)}
                  aria-label={`${name}预算，已用 ${formatPercent(item.ratio)}，查看明细`}
                >
                  <span className="budget-exec-line">
                    <span className="budget-exec-name">
                      <CategoryIcon category={category} size={28} />
                      <span className="t-body-m">{name}</span>
                    </span>
                    <span className="t-num-s">
                      {formatCents(item.spent)} <span className="text-tertiary">/ {formatCents(item.amount)}</span>
                    </span>
                  </span>
                  <ProgressBar ratio={item.ratio} level={item.level} label={`${name}预算`} />
                  <span className={`t-caption ${LEVEL_TEXT[item.level]}`}>
                    已用 {formatPercent(item.ratio)}
                    {item.remaining < 0 && ` · 超支 ${formatCents(-item.remaining)}`}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

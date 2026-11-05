import { formatNet, type MerchantNet, type PeriodStats } from '../../lib/analysis'
import { formatCents } from '../../lib/money'

interface Props {
  keywords: string[]
  stats: PeriodStats
  /** 关键字命中的商户 / 备注名称 */
  names: MerchantNet[]
  onDrillAll: () => void
  onDrillName: (item: MerchantNet) => void
}

/** 关键字合并统计：把命中的不同商户名称当作同一个商户，给出合计的支出、收入和净额 */
export function KeywordCard({ keywords, stats, names, onDrillAll, onDrillName }: Props) {
  const title = `「${keywords.join(' / ')}」合并统计`
  return (
    <section className="card chart-card keyword-card" aria-label={title}>
      <header className="chart-head">
        <div>
          <h2 className="t-title-s">{title}</h2>
          <p className="t-caption text-tertiary">
            匹配商户或备注，共 {names.length} 个名称 · {stats.count} 笔
          </p>
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          aria-label={`查看${title}的全部明细`}
          onClick={onDrillAll}
          disabled={stats.count === 0}
        >
          查看明细
        </button>
      </header>
      <dl className="keyword-totals">
        <div>
          <dt className="t-caption text-tertiary">支出</dt>
          <dd className="t-num-m amount-expense">{formatCents(stats.expense)}</dd>
        </div>
        <div>
          <dt className="t-caption text-tertiary">收入</dt>
          <dd className="t-num-m amount-income">{formatCents(stats.income)}</dd>
        </div>
        <div>
          <dt className="t-caption text-tertiary">净额</dt>
          <dd className="t-num-m">{formatNet(stats.balance)}</dd>
        </div>
      </dl>
      {names.length > 0 && (
        <ul className="keyword-names" aria-label="匹配到的名称">
          {names.map((item) => (
            <li key={item.key}>
              <button type="button" className="filter-chip" onClick={() => onDrillName(item)}>
                {item.name}
                <span className="text-tertiary"> · {item.count}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

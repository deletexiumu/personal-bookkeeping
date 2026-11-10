import type { ReactNode } from 'react'
import { formatPercent, type ShareItem } from '../../lib/analysis'
import { formatCents } from '../../lib/money'
import type { CategoryType } from '../../types'

interface Props {
  title: string
  hint: string
  items: ShareItem[]
  type: CategoryType
  empty: string
  /** 行首图标（分类图标）；不传时显示名次 */
  icon?: (item: ShareItem) => ReactNode
  /** 占比和笔数之后再补充的说明，例如与上一期相比 */
  extra?: (item: ShareItem) => ReactNode
  onDrill: (item: ShareItem) => void
}

/**
 * 排行横条：一个方向一种颜色，按金额从大到小，条长相对最大的一项。
 * 名称、金额、占比和笔数都以文字给出，整行可点击下钻到对应流水。
 */
export function RankedBars({ title, hint, items, type, empty, icon, extra, onDrill }: Props) {
  // 一般第一名最大；标签排行把「未打标签」放在最后，它可能比第一名还大
  const max = Math.max(0, ...items.map((i) => i.amount))
  return (
    <section className="card chart-card" aria-label={title}>
      <header className="chart-head">
        <div>
          <h2 className="t-title-s">{title}</h2>
          <p className="t-caption text-tertiary">{hint}</p>
        </div>
      </header>
      {items.length === 0 ? (
        <p className="chart-empty t-body-s text-tertiary">{empty}</p>
      ) : (
        <ol className="ranked-list">
          {items.map((item, i) => (
            <li key={item.key}>
              <button
                type="button"
                className="ranked-row"
                aria-label={`${item.name}，${formatCents(item.amount)}，占 ${formatPercent(item.share)}，${item.count} 笔，查看明细`}
                onClick={() => onDrill(item)}
              >
                {icon ? icon(item) : <span className="ranked-index t-num-s text-tertiary">{i + 1}</span>}
                <span className="ranked-main">
                  <span className="ranked-line">
                    <span className="ranked-name t-body-m">{item.name}</span>
                    <span className="ranked-amount t-num-s">{formatCents(item.amount)}</span>
                  </span>
                  <span className="ranked-track" aria-hidden="true">
                    <span className={`ranked-fill bar-${type}`} style={{ width: `${max > 0 ? (item.amount / max) * 100 : 0}%` }} />
                  </span>
                  <span className="ranked-meta t-caption text-tertiary">
                    {formatPercent(item.share)} · {item.count} 笔
                    {extra?.(item)}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

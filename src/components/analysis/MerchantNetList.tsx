import { useState } from 'react'
import { formatNet, type MerchantNet } from '../../lib/analysis'
import { formatCents } from '../../lib/money'

interface Props {
  title: string
  hint: string
  items: MerchantNet[]
  empty: string
  /** 默认显示前几个，其余折叠 */
  limit?: number
  onDrill: (item: MerchantNet) => void
}

/**
 * 合计视图的商户排行：同一商户的支出和收入放在一行，给出净额。
 * 横条长度按收支总额（相对第一名），支出段和收入段各用方向色；数字都以文字给出，整行可下钻。
 */
export function MerchantNetList({ title, hint, items, empty, limit = 5, onDrill }: Props) {
  const [expanded, setExpanded] = useState(false)
  const max = items.reduce((m, item) => Math.max(m, item.income + item.expense), 0)
  const shown = expanded ? items : items.slice(0, limit)
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
        <>
          <ol className="ranked-list">
            {shown.map((item, i) => (
              <li key={item.key}>
                <button
                  type="button"
                  className="ranked-row"
                  aria-label={`${item.name}，支出 ${formatCents(item.expense)}，收入 ${formatCents(item.income)}，净额 ${formatNet(item.net)}，${item.count} 笔，查看明细`}
                  onClick={() => onDrill(item)}
                >
                  <span className="ranked-index t-num-s text-tertiary">{i + 1}</span>
                  <span className="ranked-main">
                    <span className="ranked-line">
                      <span className="ranked-name t-body-m">{item.name}</span>
                      <span className={`ranked-amount t-num-s ${item.net > 0 ? 'amount-income' : item.net < 0 ? 'amount-expense' : ''}`}>
                        {formatNet(item.net)}
                      </span>
                    </span>
                    <span className="ranked-track net-track" aria-hidden="true">
                      {item.expense > 0 && <span className="ranked-fill bar-expense" style={{ width: `${(item.expense / max) * 100}%` }} />}
                      {item.income > 0 && <span className="ranked-fill bar-income" style={{ width: `${(item.income / max) * 100}%` }} />}
                    </span>
                    <span className="ranked-meta t-caption text-tertiary">
                      支出 {formatCents(item.expense)} · 收入 {formatCents(item.income)} · {item.count} 笔
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
          {items.length > limit && (
            <button type="button" className="btn btn-ghost btn-sm ranked-more" onClick={() => setExpanded((v) => !v)}>
              {expanded ? '收起' : `展开全部 ${items.length} 个`}
            </button>
          )}
        </>
      )}
    </section>
  )
}

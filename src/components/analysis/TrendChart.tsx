import { BarChart3, Table2 } from 'lucide-react'
import { useState } from 'react'
import { formatAxisAmount, niceTicks, type TrendPoint } from '../../lib/analysis'
import { formatCents } from '../../lib/money'
import type { CategoryType } from '../../types'

interface Props {
  title: string
  points: TrendPoint[]
  /** 两个方向并排，或只看一个方向 */
  series: CategoryType[]
  hint: string
  onDrill: (point: TrendPoint) => void
}

const SERIES_LABEL: Record<CategoryType, string> = { income: '收入', expense: '支出' }

/** 超过这么多根柱子时，横轴标签隔几个显示一个，避免挤在一起 */
const MAX_X_LABELS = 12

function showLabel(index: number, count: number): boolean {
  if (count <= MAX_X_LABELS) return true
  const step = Math.ceil(count / 7)
  // 按天的月视图显示 1、5、10、15…；其余等距
  return count <= 31 ? index === 0 || (index + 1) % 5 === 0 : index % step === 0
}

/** 提示框放在悬停列旁边（左半边的列放右侧，右半边的列放左侧），不遮挡这一列和卡片标题 */
function tooltipPosition(index: number, count: number) {
  return index < count / 2
    ? { left: `calc(${((index + 1) / count) * 100}% + 8px)` }
    : { right: `calc(${(1 - index / count) * 100}% + 8px)` }
}

/**
 * 收支趋势柱状图：细柱（≤ 24px、顶端 4px 圆角、组内 2px 间隔）+ 发丝网格线。
 * 每根柱子所在的整列都是点击 / 悬停 / 键盘焦点的目标，点击下钻到该时间段的流水；可切换为数据表。
 */
export function TrendChart({ title, points, series, hint, onDrill }: Props) {
  const [hover, setHover] = useState<number>()
  const [asTable, setAsTable] = useState(false)
  const max = Math.max(0, ...points.flatMap((p) => series.map((s) => p[s])))
  const ticks = niceTicks(max)
  const top = ticks[ticks.length - 1] || 1
  const hovered = hover === undefined ? undefined : points[hover]
  const describe = (p: TrendPoint) => `${p.title}，${series.map((s) => `${SERIES_LABEL[s]} ${formatCents(p[s])}`).join('，')}`

  return (
    <section className="card chart-card" aria-label={title}>
      <header className="chart-head">
        <div>
          <h2 className="t-title-s">{title}</h2>
          <p className="t-caption text-tertiary">{hint}</p>
        </div>
        <div className="chart-tools">
          {series.length > 1 && (
            <ul className="chart-legend t-caption text-secondary" aria-label="图例">
              {series.map((s) => (
                <li key={s}>
                  <span className={`legend-key legend-${s}`} aria-hidden="true" />
                  {SERIES_LABEL[s]}
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            aria-pressed={asTable}
            onClick={() => setAsTable((v) => !v)}
          >
            {asTable ? <BarChart3 size={16} aria-hidden="true" /> : <Table2 size={16} aria-hidden="true" />}
            {asTable ? '图表' : '表格'}
          </button>
        </div>
      </header>

      {asTable ? (
        <div className="data-table-wrap">
          <table className="data-table t-body-s">
            <thead>
              <tr>
                <th scope="col">时间</th>
                {series.map((s) => (
                  <th key={s} scope="col" className="num">
                    {SERIES_LABEL[s]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.key}>
                  <th scope="row">
                    <button type="button" className="link-button" onClick={() => onDrill(p)}>
                      {p.title}
                    </button>
                  </th>
                  {series.map((s) => (
                    <td key={s} className="num t-num-s">
                      {formatCents(p[s])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">合计</th>
                {series.map((s) => (
                  <td key={s} className="num t-num-s">
                    {formatCents(points.reduce((sum, p) => sum + p[s], 0))}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      ) : (
        <div className="bar-chart">
          <div className="bar-chart-y t-caption text-tertiary" aria-hidden="true">
            {ticks.map((v) => (
              <span key={v} style={{ bottom: `${(v / top) * 100}%` }}>
                {formatAxisAmount(v)}
              </span>
            ))}
          </div>
          <div className="bar-chart-plot" onMouseLeave={() => setHover(undefined)}>
            {ticks.map((v) => (
              <span key={v} className="bar-chart-grid" style={{ bottom: `${(v / top) * 100}%` }} aria-hidden="true" />
            ))}
            <div className="bar-chart-cols" style={{ gridTemplateColumns: `repeat(${points.length}, minmax(0, 1fr))` }}>
              {points.map((p, i) => (
                <button
                  key={p.key}
                  type="button"
                  className="bar-col"
                  aria-label={`${describe(p)}，查看明细`}
                  data-active={hover === i || undefined}
                  onMouseEnter={() => setHover(i)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(undefined)}
                  onClick={() => onDrill(p)}
                >
                  {series.map((s) => (
                    <span
                      key={s}
                      className={`bar bar-${s}`}
                      style={{ height: p[s] > 0 ? `max(2px, ${(p[s] / top) * 100}%)` : 0 }}
                    />
                  ))}
                </button>
              ))}
            </div>
            {hovered && (
              <div
                className="chart-tooltip"
                role="presentation"
                style={tooltipPosition(hover!, points.length)}
              >
                <span className="t-caption text-secondary">{hovered.title}</span>
                {series.map((s) => (
                  <span key={s} className="chart-tooltip-row">
                    <strong className="t-num-s">{formatCents(hovered[s])}</strong>
                    <span className="t-caption text-secondary">
                      <span className={`tooltip-key legend-${s}`} aria-hidden="true" />
                      {SERIES_LABEL[s]}
                    </span>
                  </span>
                ))}
              </div>
            )}
          </div>
          <div
            className="bar-chart-x t-caption text-tertiary"
            style={{ gridTemplateColumns: `repeat(${points.length}, minmax(0, 1fr))` }}
            aria-hidden="true"
          >
            {points.map((p, i) => (
              <span key={p.key}>{showLabel(i, points.length) ? p.label : ''}</span>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

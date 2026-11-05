import { ChevronLeft, ChevronRight } from 'lucide-react'
import { today } from '../../lib/date'
import type { AnalysisView } from '../../lib/analysis'
import { customPeriod, PERIOD_LABELS, periodLabel, periodOf, shiftPeriod, type Period, type PeriodKind } from '../../lib/period'
import { IconButton } from '../ui/Button'

interface Props {
  period: Period
  onPeriodChange: (period: Period) => void
  type: AnalysisView
  onTypeChange: (type: AnalysisView) => void
}

const KINDS: PeriodKind[] = ['week', 'month', 'year', 'custom']
const TYPES: { value: AnalysisView; label: string }[] = [
  { value: 'expense', label: '支出' },
  { value: 'income', label: '收入' },
  { value: 'all', label: '合计' },
]

/** 分析页的筛选行：区间粒度、前后切换（或起止日期）、看支出、收入还是收支合计 */
export function PeriodBar({ period, onPeriodChange, type, onTypeChange }: Props) {
  function changeKind(kind: PeriodKind) {
    if (kind === period.kind) return
    if (kind === 'custom') {
      // 自定义默认沿用当前区间，方便在此基础上微调
      onPeriodChange(customPeriod(period.start, period.end))
      return
    }
    const anchor = today() >= period.start && today() <= period.end ? today() : period.start
    onPeriodChange(periodOf(kind, anchor))
  }

  return (
    <div className="period-bar" role="group" aria-label="统计区间">
      <div className="segmented period-kinds" role="radiogroup" aria-label="区间粒度">
        {KINDS.map((kind) => (
          <button
            key={kind}
            type="button"
            role="radio"
            aria-checked={period.kind === kind}
            className="segmented-item"
            onClick={() => changeKind(kind)}
          >
            {PERIOD_LABELS[kind]}
          </button>
        ))}
      </div>

      {period.kind === 'custom' ? (
        <div className="period-range">
          <input
            type="date"
            className="input"
            aria-label="开始日期"
            value={period.start}
            max={period.end}
            onChange={(e) => e.target.value && onPeriodChange(customPeriod(e.target.value, period.end))}
          />
          <span className="text-tertiary" aria-hidden="true">
            –
          </span>
          <input
            type="date"
            className="input"
            aria-label="结束日期"
            value={period.end}
            min={period.start}
            onChange={(e) => e.target.value && onPeriodChange(customPeriod(period.start, e.target.value))}
          />
        </div>
      ) : (
        <div className="month-switcher period-switcher">
          <IconButton label={`上一${PERIOD_LABELS[period.kind]}`} onClick={() => onPeriodChange(shiftPeriod(period, -1))}>
            <ChevronLeft size={18} />
          </IconButton>
          <span className="period-label t-body-m-strong" aria-live="polite">
            {periodLabel(period)}
          </span>
          <IconButton label={`下一${PERIOD_LABELS[period.kind]}`} onClick={() => onPeriodChange(shiftPeriod(period, 1))}>
            <ChevronRight size={18} />
          </IconButton>
        </div>
      )}

      <div className="segmented period-types" role="radiogroup" aria-label="构成与排行的口径">
        {TYPES.map((t) => (
          <button
            key={t.value}
            type="button"
            role="radio"
            aria-checked={type === t.value}
            className="segmented-item"
            onClick={() => onTypeChange(t.value)}
          >
            {t.label}
          </button>
        ))}
      </div>
    </div>
  )
}

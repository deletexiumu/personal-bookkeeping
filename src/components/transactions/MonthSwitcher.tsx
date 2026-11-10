import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { useRef } from 'react'
import { formatMonth, shiftMonth } from '../../lib/date'
import { IconButton } from '../ui/Button'

/** 明细按月还是按年查看 */
export type ListUnit = 'month' | 'year'

interface Props {
  /** YYYY-MM；按年查看时取它所在的年份，切回按月时回到这个月 */
  month: string
  onChange: (month: string) => void
  unit?: ListUnit
  onUnitChange?: (unit: ListUnit) => void
}

const UNITS: { value: ListUnit; label: string }[] = [
  { value: 'month', label: '月' },
  { value: 'year', label: '年' },
]

/**
 * 月份切换：左右箭头切换上 / 下月，点击月份打开系统月份选择器。
 * 传了 onUnitChange 时前面多一个「月 / 年」切换，按年时箭头切换上 / 下一年。
 */
export function MonthSwitcher({ month, onChange, unit = 'month', onUnitChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const byYear = unit === 'year'
  const step = byYear ? 12 : 1

  function openPicker() {
    const input = inputRef.current
    if (!input) return
    try {
      input.showPicker()
    } catch {
      input.focus()
    }
  }

  return (
    <div className="month-switcher-group">
      {onUnitChange && (
        <div className="segmented month-switcher-units" role="radiogroup" aria-label="按月或按年查看">
          {UNITS.map((u) => (
            <button
              key={u.value}
              type="button"
              role="radio"
              aria-checked={unit === u.value}
              className="segmented-item"
              onClick={() => onUnitChange(u.value)}
            >
              {u.label}
            </button>
          ))}
        </div>
      )}
      <div className="month-switcher">
        <IconButton label={byYear ? '上一年' : '上个月'} onClick={() => onChange(shiftMonth(month, -step))}>
          <ChevronLeft size={18} />
        </IconButton>
        {byYear ? (
          <span className="month-switcher-label t-body-m-strong" aria-live="polite">
            {month.slice(0, 4)}年
          </span>
        ) : (
          <>
            <button type="button" className="month-switcher-label t-body-m-strong" onClick={openPicker}>
              {formatMonth(month)}
              <ChevronDown size={16} aria-hidden="true" />
            </button>
            <input
              ref={inputRef}
              type="month"
              className="month-switcher-input"
              aria-label="选择月份"
              tabIndex={-1}
              value={month}
              onChange={(e) => e.target.value && onChange(e.target.value)}
            />
          </>
        )}
        <IconButton label={byYear ? '下一年' : '下个月'} onClick={() => onChange(shiftMonth(month, step))}>
          <ChevronRight size={18} />
        </IconButton>
      </div>
    </div>
  )
}

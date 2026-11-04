import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { useRef } from 'react'
import { formatMonth, shiftMonth } from '../../lib/date'
import { IconButton } from '../ui/Button'

interface Props {
  month: string
  onChange: (month: string) => void
}

/** 月份切换：左右箭头切换上 / 下月，点击月份打开系统月份选择器 */
export function MonthSwitcher({ month, onChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)

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
    <div className="month-switcher">
      <IconButton label="上个月" onClick={() => onChange(shiftMonth(month, -1))}>
        <ChevronLeft size={18} />
      </IconButton>
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
      <IconButton label="下个月" onClick={() => onChange(shiftMonth(month, 1))}>
        <ChevronRight size={18} />
      </IconButton>
    </div>
  )
}

import type { BudgetLevel } from '../../lib/budget'

interface Props {
  ratio: number
  level: BudgetLevel
  label: string
  /** 在品牌色背景上（移动端汇总卡） */
  onBrand?: boolean
}

/** 预算进度条：≤ 80% 品牌色，> 80% 橙，> 100% 红 */
export function ProgressBar({ ratio, level, label, onBrand = false }: Props) {
  const percent = Math.round(ratio * 100)
  return (
    <div
      className={`progress progress-${level} ${onBrand ? 'progress-on-brand' : ''}`}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.min(percent, 100)}
      aria-valuetext={`已用 ${percent}%`}
    >
      <span style={{ width: `${Math.min(ratio, 1) * 100}%` }} />
    </div>
  )
}

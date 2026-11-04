import { ArrowDown, ArrowUp, ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'
import { IconButton } from '../ui/Button'

interface Props {
  icon: ReactNode
  title: ReactNode
  subtitle?: ReactNode
  value?: ReactNode
  /** 点击行（编辑） */
  onOpen: () => void
  onMoveUp?: () => void
  onMoveDown?: () => void
  label: string
}

/** 管理列表行：图标、名称、副标题、右侧数值，带上移 / 下移 */
export function ManageRow({ icon, title, subtitle, value, onOpen, onMoveUp, onMoveDown, label }: Props) {
  return (
    <li className="manage-row">
      <button type="button" className="manage-open" onClick={onOpen} aria-label={`编辑${label}`}>
        {icon}
        <span className="manage-main">
          <span className="t-body-m-strong">{title}</span>
          {subtitle && <span className="t-caption text-tertiary">{subtitle}</span>}
        </span>
        {value !== undefined && <span className="manage-value">{value}</span>}
        <ChevronRight size={18} aria-hidden="true" className="text-tertiary" />
      </button>
      {(onMoveUp || onMoveDown) && (
        <span className="manage-move">
          <IconButton label={`上移${label}`} onClick={onMoveUp} disabled={!onMoveUp}>
            <ArrowUp size={16} />
          </IconButton>
          <IconButton label={`下移${label}`} onClick={onMoveDown} disabled={!onMoveDown}>
            <ArrowDown size={16} />
          </IconButton>
        </span>
      )}
    </li>
  )
}

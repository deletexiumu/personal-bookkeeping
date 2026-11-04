import { X } from 'lucide-react'
import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { IconButton } from './Button'

interface DialogProps {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * 对话框：桌面端居中弹窗，移动端（< 768）为底部半屏弹层。
 * Esc 或点击遮罩关闭；打开时聚焦第一个可交互元素，Tab 焦点限制在弹窗内，关闭后焦点回到触发处。
 */
export function Dialog({ open, title, onClose, children }: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = useId()

  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    const panel = panelRef.current
    const first = panel?.querySelector<HTMLElement>('[data-autofocus]') ?? panel?.querySelector<HTMLElement>(FOCUSABLE)
    first?.focus()
    const { overflow } = document.body.style
    document.body.style.overflow = 'hidden'
    document.body.dataset.dialogOpen = ''
    return () => {
      document.body.style.overflow = overflow
      delete document.body.dataset.dialogOpen
      previous?.focus?.()
    }
  }, [open])

  if (!open) return null

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onClose()
      return
    }
    if (e.key !== 'Tab' || !panelRef.current) return
    const items = [...panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)]
    if (items.length === 0) return
    const first = items[0]
    const last = items[items.length - 1]
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  return createPortal(
    <div className="dialog-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={panelRef}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={handleKeyDown}
      >
        <header className="dialog-header">
          <h2 id={titleId} className="t-title-s">
            {title}
          </h2>
          <IconButton label="关闭" onClick={onClose}>
            <X size={20} />
          </IconButton>
        </header>
        <div className="dialog-body">{children}</div>
      </div>
    </div>,
    document.body,
  )
}

import type { ReactNode } from 'react'

export type BadgeTone = 'brand' | 'income' | 'expense' | 'warning' | 'neutral'

/** 标签（Figma 组件 Badge：Brand / Income / Expense / Warning / Neutral） */
export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>
}

/** 键盘快捷键提示 */
export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>
}

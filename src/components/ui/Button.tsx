import type { ButtonHTMLAttributes, ReactNode } from 'react'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: 'md' | 'sm'
  block?: boolean
  icon?: ReactNode
}

/** 按钮（Figma 组件 Button：Primary / Secondary / Ghost / Danger） */
export function Button({
  variant = 'secondary',
  size = 'md',
  block = false,
  icon,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  const classes = ['btn', `btn-${variant}`, `btn-${size}`, block && 'btn-block', className]
    .filter(Boolean)
    .join(' ')
  return (
    <button type={type} className={classes} {...rest}>
      {icon}
      {children}
    </button>
  )
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** 读屏与悬停提示文字，必填 */
  label: string
  children: ReactNode
}

/** 只有图标的按钮，触控区域 40×40 */
export function IconButton({ label, className, children, type = 'button', ...rest }: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={['icon-btn', className].filter(Boolean).join(' ')}
      {...rest}
    >
      {children}
    </button>
  )
}

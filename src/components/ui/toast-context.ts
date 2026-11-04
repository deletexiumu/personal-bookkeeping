import { createContext, useContext } from 'react'

export interface ToastOptions {
  message: string
  /** 例如「撤销」 */
  action?: { label: string; onClick: () => void }
  /** 显示时长（毫秒），默认 5000 */
  duration?: number
}

export interface ToastApi {
  show: (options: ToastOptions) => void
  dismiss: () => void
}

export const ToastContext = createContext<ToastApi | null>(null)

/** 显示轻提示；同一时间只显示一条，新的替换旧的 */
export function useToast(): ToastApi {
  const api = useContext(ToastContext)
  if (!api) throw new Error('useToast 需要在 <ToastProvider> 内使用')
  return api
}

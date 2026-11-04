import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ToastContext, type ToastApi, type ToastOptions } from './toast-context'

interface ActiveToast extends ToastOptions {
  key: number
}

/** 轻提示容器：底部居中（移动端在底部 Tab 之上），默认 5 秒后消失，可带一个操作按钮 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ActiveToast | null>(null)
  const seq = useRef(0)

  const dismiss = useCallback(() => setToast(null), [])
  const show = useCallback((options: ToastOptions) => {
    seq.current += 1
    setToast({ ...options, key: seq.current })
  }, [])
  const api = useMemo<ToastApi>(() => ({ show, dismiss }), [show, dismiss])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(dismiss, toast.duration ?? 5000)
    return () => window.clearTimeout(timer)
  }, [toast, dismiss])

  return (
    <ToastContext.Provider value={api}>
      {children}
      {createPortal(
        <div className="toast-region" role="status" aria-live="polite">
          {toast && (
            <div key={toast.key} className="toast">
              <span className="t-body-s">{toast.message}</span>
              {toast.action && (
                <button
                  type="button"
                  className="toast-action"
                  onClick={() => {
                    toast.action?.onClick()
                    dismiss()
                  }}
                >
                  {toast.action.label}
                </button>
              )}
            </div>
          )}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  )
}

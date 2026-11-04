import { useEffect } from 'react'
import { useToast } from '../components/ui/toast-context'

/**
 * PWA 更新提示。main.tsx 注册 Service Worker，发现新版本时调用 notifyUpdate；
 * App 里用 usePwaUpdatePrompt 显示「有新版本 · 刷新」，不在用户记账时自动刷新页面。
 */
type Listener = (event: PwaEvent) => void
export type PwaEvent = { type: 'need-refresh'; update: () => void } | { type: 'offline-ready' }

let pending: PwaEvent | undefined
const listeners = new Set<Listener>()

export function notifyPwa(event: PwaEvent) {
  if (listeners.size === 0) pending = event
  listeners.forEach((listener) => listener(event))
}

export function subscribePwa(listener: Listener): () => void {
  listeners.add(listener)
  if (pending) {
    listener(pending)
    pending = undefined
  }
  return () => listeners.delete(listener)
}

/** 一直显示到用户点击，避免错过 */
const STICKY = 24 * 60 * 60 * 1000

export function usePwaUpdatePrompt() {
  const toast = useToast()
  useEffect(
    () =>
      subscribePwa((event) => {
        if (event.type === 'need-refresh') {
          toast.show({ message: '陶朱簿有新版本', action: { label: '刷新', onClick: event.update }, duration: STICKY })
        } else {
          toast.show({ message: '已缓存到本机，断网也能打开' })
        }
      }),
    [toast],
  )
}

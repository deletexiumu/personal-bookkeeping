import { useEffect } from 'react'

/** 正在输入时（输入框、下拉框、可编辑区域）不响应单键快捷键 */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)
}

/**
 * 注册单键快捷键（不带修饰键），例如 N 打开记一笔。
 * 浏览器占用了 ⌘N / Ctrl+N，所以 Web 端用单键 N（见设计文档跨端适配）。
 */
export function useHotkey(key: string, handler: () => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || isTyping(e.target)) return
      if (e.key.toLowerCase() !== key.toLowerCase()) return
      e.preventDefault()
      handler()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [key, handler, enabled])
}

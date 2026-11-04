import { useSyncExternalStore } from 'react'

/** 订阅 CSS 媒体查询；不支持 matchMedia 的环境（如测试）返回 false */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window.matchMedia !== 'function') return () => {}
      const mql = window.matchMedia(query)
      mql.addEventListener('change', onChange)
      return () => mql.removeEventListener('change', onChange)
    },
    () => (typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : false),
    () => false,
  )
}

/** 完整桌面布局：明细用表格 + 右侧详情面板 */
export const WIDE_QUERY = '(min-width: 1280px)'

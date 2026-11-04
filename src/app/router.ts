import { useSyncExternalStore } from 'react'

/**
 * 极简 Hash 路由。
 * 用 hash 而不是 History API：GitHub Pages 子路径、Docker 静态托管和 Tauri 自定义协议下都无需服务端回退配置。
 */

export const ROUTES = [
  'transactions',
  'analysis',
  'import',
  'budget',
  'accounts',
  'categories',
  'rules',
  'api',
  'settings',
  'login',
] as const

export type RouteName = (typeof ROUTES)[number]

export const DEFAULT_ROUTE: RouteName = 'transactions'

/** 把 location.hash 解析为路由名，未知路径回退到默认页 */
export function parseHash(hash: string): RouteName {
  const path = hash.replace(/^#\/?/, '').split(/[/?]/)[0]
  return (ROUTES as readonly string[]).includes(path) ? (path as RouteName) : DEFAULT_ROUTE
}

export function hrefOf(route: RouteName): string {
  return `#/${route}`
}

function subscribe(onChange: () => void) {
  window.addEventListener('hashchange', onChange)
  return () => window.removeEventListener('hashchange', onChange)
}

export function useRoute(): RouteName {
  return useSyncExternalStore(
    subscribe,
    () => parseHash(window.location.hash),
    () => DEFAULT_ROUTE,
  )
}

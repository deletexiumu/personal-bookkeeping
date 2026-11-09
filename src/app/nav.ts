import {
  ChartColumn,
  ChartPie,
  CodeXml,
  Download,
  List,
  Shapes,
  SlidersHorizontal,
  Hash,
  Tag,
  Target,
  User,
  Wallet,
  type LucideIcon,
} from 'lucide-react'
import type { RouteName } from './router'

export interface NavItem {
  route: RouteName
  label: string
  icon: LucideIcon
}

/** 桌面端侧边栏（Figma 组件 Desktop/Sidebar） */
export const SIDEBAR_ITEMS: NavItem[] = [
  { route: 'transactions', label: '明细', icon: List },
  { route: 'analysis', label: '分析', icon: ChartColumn },
  { route: 'import', label: '导入', icon: Download },
  { route: 'budget', label: '预算', icon: Target },
  { route: 'accounts', label: '账户', icon: Wallet },
  { route: 'tags', label: '标签', icon: Hash },
  { route: 'rules', label: '规则', icon: Tag },
  { route: 'api', label: '开放接口', icon: CodeXml },
  { route: 'settings', label: '设置', icon: SlidersHorizontal },
]

/** 移动端底部 Tab（Figma 组件 Mobile/TabBar），中间为「记一笔」悬浮按钮 */
export const TAB_ITEMS_LEFT: NavItem[] = [
  { route: 'transactions', label: '明细', icon: List },
  { route: 'analysis', label: '统计', icon: ChartPie },
]

export const TAB_ITEMS_RIGHT: NavItem[] = [
  { route: 'import', label: '导入', icon: Download },
  { route: 'settings', label: '我的', icon: User },
]

/** 不在侧边栏里、从设置页进入的页面 */
export const EXTRA_ITEMS: NavItem[] = [{ route: 'categories', label: '分类', icon: Shapes }]

export function navItemOf(route: RouteName): NavItem {
  return [...SIDEBAR_ITEMS, ...EXTRA_ITEMS].find((item) => item.route === route)!
}

/** 侧边栏要高亮的入口：分类、登录归在设置下 */
export function sidebarRouteOf(route: RouteName): RouteName {
  return route === 'categories' || route === 'login' ? 'settings' : route
}

/** 移动端 Tab 没有的页面，高亮「我的」 */
export function tabRouteOf(route: RouteName): RouteName {
  return ['budget', 'accounts', 'categories', 'rules', 'tags', 'api', 'login'].includes(route) ? 'settings' : route
}

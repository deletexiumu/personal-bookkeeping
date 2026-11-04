import type { ReactNode } from 'react'
import type { RouteName } from '../../app/router'
import { Sidebar } from './Sidebar'
import { TabBar } from './TabBar'

interface Props {
  route: RouteName
  onQuickAdd: () => void
  children: ReactNode
}

/** 应用外壳：宽屏为侧边栏 + 内容区，窄屏为内容区 + 底部 Tab。两种导航都渲染，由 CSS 断点切换。 */
export function AppShell({ route, onQuickAdd, children }: Props) {
  return (
    <div className="shell">
      <Sidebar route={route} onQuickAdd={onQuickAdd} />
      <main className="shell-main" id="main">
        {children}
      </main>
      <TabBar route={route} onQuickAdd={onQuickAdd} />
    </div>
  )
}

/** 页面标题栏：左侧标题，右侧操作 */
export function PageHeader({ title, actions }: { title: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-header">
      <h1 className="t-title-l">{title}</h1>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  )
}

import { CloudCheck, Plus } from 'lucide-react'
import { SIDEBAR_ITEMS } from '../../app/nav'
import { hrefOf, type RouteName } from '../../app/router'
import { Kbd } from '../ui/Badge'
import { Brand } from './Brand'

interface Props {
  route: RouteName
  onQuickAdd: () => void
}

/** 桌面端侧边栏（≥ 768 显示；768–1279 折叠为 72px 图标栏） */
export function Sidebar({ route, onQuickAdd }: Props) {
  return (
    <aside className="sidebar" aria-label="主导航">
      <Brand />
      <button type="button" className="btn btn-primary btn-md btn-block sidebar-add" onClick={onQuickAdd} title="记一笔（N）">
        <Plus size={18} aria-hidden="true" />
        <span className="sidebar-label">记一笔</span>
        <Kbd>N</Kbd>
      </button>
      <nav className="sidebar-nav">
        {SIDEBAR_ITEMS.map(({ route: r, label, icon: Icon }) => (
          <a
            key={r}
            href={hrefOf(r)}
            className="sidebar-item"
            aria-current={route === r ? 'page' : undefined}
            title={label}
          >
            <Icon size={20} aria-hidden="true" />
            <span className="sidebar-label">{label}</span>
          </a>
        ))}
      </nav>
      <div className="sidebar-status" title="数据仅保存在本机浏览器中">
        <CloudCheck size={18} className="text-income" aria-hidden="true" />
        <div className="sidebar-label">
          <span className="t-caption">本地优先</span>
          <span className="t-caption text-tertiary">数据仅存本机</span>
        </div>
      </div>
    </aside>
  )
}

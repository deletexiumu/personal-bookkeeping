import { CloudAlert, CloudCheck, Plus, RefreshCw, UserRound } from 'lucide-react'
import { useAccount } from '../../app/account'
import { describeSync, useSyncStatus } from '../../app/sync'
import { SIDEBAR_ITEMS, sidebarRouteOf } from '../../app/nav'
import { hrefOf, type RouteName } from '../../app/router'
import { Kbd } from '../ui/Badge'
import { Brand } from './Brand'

interface Props {
  route: RouteName
  onQuickAdd: () => void
}

/** 桌面端侧边栏（≥ 768 显示；768–1279 折叠为 72px 图标栏） */
export function Sidebar({ route, onQuickAdd }: Props) {
  const active = sidebarRouteOf(route)
  const { user } = useAccount()
  const sync = useSyncStatus()
  const SyncIcon = sync.phase === 'error' || sync.phase === 'needs-choice' ? CloudAlert : sync.phase === 'syncing' ? RefreshCw : UserRound
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
            aria-current={active === r ? 'page' : undefined}
            title={label}
          >
            <Icon size={20} aria-hidden="true" />
            <span className="sidebar-label">{label}</span>
          </a>
        ))}
      </nav>
      {user ? (
        <a className="sidebar-status" href={hrefOf('settings')} title={`已登录 ${user.email}`}>
          <SyncIcon size={18} className={sync.phase === 'error' ? 'text-expense' : 'text-income'} aria-hidden="true" />
          <div className="sidebar-label">
            <span className="t-caption sidebar-email">{user.email}</span>
            <span className="t-caption text-tertiary">{describeSync(sync)}</span>
          </div>
        </a>
      ) : (
        <a className="sidebar-status" href={hrefOf('login')} title="数据仅保存在本机浏览器中，登录后可同步">
          <CloudCheck size={18} className="text-income" aria-hidden="true" />
          <div className="sidebar-label">
            <span className="t-caption">本地优先</span>
            <span className="t-caption text-tertiary">数据仅存本机 · 登录</span>
          </div>
        </a>
      )}
    </aside>
  )
}

import { Plus } from 'lucide-react'
import { TAB_ITEMS_LEFT, TAB_ITEMS_RIGHT, tabRouteOf, type NavItem } from '../../app/nav'
import { hrefOf, type RouteName } from '../../app/router'

interface Props {
  route: RouteName
  onQuickAdd: () => void
}

/** 移动端底部 Tab（< 768 显示）：明细 / 统计 / ＋ / 导入 / 我的 */
export function TabBar({ route, onQuickAdd }: Props) {
  const active = tabRouteOf(route)
  const renderItem = ({ route: r, label, icon: Icon }: NavItem) => (
    <a key={r} href={hrefOf(r)} className="tab-item" aria-current={active === r ? 'page' : undefined}>
      <Icon size={22} aria-hidden="true" />
      <span>{label}</span>
    </a>
  )
  return (
    <nav className="tabbar" aria-label="底部导航">
      {TAB_ITEMS_LEFT.map(renderItem)}
      <div className="tab-item">
        <button type="button" className="tab-add" aria-label="记一笔" onClick={onQuickAdd}>
          <Plus size={26} aria-hidden="true" />
        </button>
      </div>
      {TAB_ITEMS_RIGHT.map(renderItem)}
    </nav>
  )
}

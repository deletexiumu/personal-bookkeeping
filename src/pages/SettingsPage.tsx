import { ChevronRight } from 'lucide-react'
import { navItemOf } from '../app/nav'
import { hrefOf, type RouteName } from '../app/router'
import { PageHeader } from '../components/layout/AppShell'
import { Badge } from '../components/ui/Badge'

const GROUPS: { title: string; routes: RouteName[] }[] = [
  { title: '账本管理', routes: ['accounts', 'categories', 'budget', 'rules'] },
  { title: '数据', routes: ['import', 'api'] },
]

/** 设置 / 我的（M06）。移动端「我的」Tab 也指向这里，汇总侧边栏中的次级入口。 */
export function SettingsPage() {
  return (
    <div className="page">
      <PageHeader title="设置" />
      <section className="card profile">
        <div>
          <h2 className="t-title-s">我的账本</h2>
          <p className="t-caption text-tertiary">数据保存在本机浏览器（IndexedDB），不会上传</p>
        </div>
        <Badge tone="brand">个人版 · 免费</Badge>
      </section>
      {GROUPS.map((group) => (
        <section key={group.title} className="settings-group">
          <h2 className="t-caption text-tertiary settings-group-title">{group.title}</h2>
          <ul className="card settings-list">
            {group.routes.map((route) => {
              const item = navItemOf(route)
              const Icon = item.icon
              return (
                <li key={route}>
                  <a href={hrefOf(route)} className="settings-item">
                    <Icon size={20} aria-hidden="true" className="settings-item-icon" />
                    <span className="t-body-m">{item.label}</span>
                    <ChevronRight size={18} aria-hidden="true" className="text-tertiary" />
                  </a>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
      <section className="settings-group">
        <h2 className="t-caption text-tertiary settings-group-title">关于</h2>
        <div className="card settings-about t-body-s text-secondary">
          <p>陶朱簿 v{__APP_VERSION__} · 笔笔分明，自有陶朱</p>
          <p>个人使用免费，商业使用需要授权。外观目前跟随系统浅色 / 深色，手动切换将在 W6 提供。</p>
        </div>
      </section>
    </div>
  )
}

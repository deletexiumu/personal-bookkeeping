import { ChevronRight, DatabaseBackup, Download } from 'lucide-react'
import { navItemOf } from '../app/nav'
import { hrefOf, type RouteName } from '../app/router'
import { PageHeader } from '../components/layout/AppShell'
import { Badge } from '../components/ui/Badge'
import { useToast } from '../components/ui/toast-context'
import { db } from '../db'
import { exportBackup } from '../db/backup'
import { backupFileName } from '../lib/backup'
import { downloadText } from '../lib/download'

const GROUPS: { title: string; routes: RouteName[] }[] = [
  { title: '账本管理', routes: ['accounts', 'categories', 'budget', 'rules'] },
  { title: '数据', routes: ['import', 'api'] },
]

/** 设置 / 我的（M06）。移动端「我的」Tab 也指向这里，汇总侧边栏中的次级入口。 */
export function SettingsPage() {
  const toast = useToast()

  async function handleExport() {
    try {
      const backup = await exportBackup(db)
      downloadText(backupFileName(), JSON.stringify(backup, null, 2))
      toast.show({ message: `已导出 ${backup.data.transactions.length} 条流水的备份` })
    } catch (e) {
      toast.show({ message: e instanceof Error ? `导出失败：${e.message}` : '导出失败' })
    }
  }

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
        <h2 className="t-caption text-tertiary settings-group-title">数据备份</h2>
        <ul className="card settings-list">
          <li>
            <button type="button" className="settings-item" onClick={() => void handleExport()}>
              <Download size={20} aria-hidden="true" className="settings-item-icon" />
              <span className="t-body-m">导出备份（JSON）</span>
              <ChevronRight size={18} aria-hidden="true" className="text-tertiary" />
            </button>
          </li>
          <li>
            <a href="#/import/json" className="settings-item">
              <DatabaseBackup size={20} aria-hidden="true" className="settings-item-icon" />
              <span className="t-body-m">从备份恢复</span>
              <ChevronRight size={18} aria-hidden="true" className="text-tertiary" />
            </a>
          </li>
        </ul>
        <p className="t-caption text-tertiary">数据只存在这台设备的浏览器里，清理浏览器数据会一并删除，建议定期导出备份。</p>
      </section>
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

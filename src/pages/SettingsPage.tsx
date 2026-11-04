import { ChevronRight, DatabaseBackup, Download, FileSpreadsheet, Scale } from 'lucide-react'
import { useState } from 'react'
import { navItemOf } from '../app/nav'
import { usePreferences, type MoneyColors, type ThemePreference } from '../app/preferences'
import { hrefOf, type RouteName } from '../app/router'
import { PageHeader } from '../components/layout/AppShell'
import { AccountSection } from '../components/settings/AccountSection'
import { LicenseInfo } from '../components/settings/LicenseInfo'
import { Dialog } from '../components/ui/Dialog'
import { useToast } from '../components/ui/toast-context'
import { db } from '../db'
import { exportBackup } from '../db/backup'
import { listAccounts, listCategories } from '../db/catalog'
import { backupFileName } from '../lib/backup'
import { downloadText } from '../lib/download'
import { csvFileName, transactionsToCsv } from '../lib/exportCsv'

const GROUPS: { title: string; routes: RouteName[] }[] = [
  { title: '账本管理', routes: ['accounts', 'categories', 'budget', 'rules'] },
  { title: '数据', routes: ['import', 'api'] },
]

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
]

const MONEY_OPTIONS: { value: MoneyColors; label: string }[] = [
  { value: 'default', label: '默认' },
  { value: 'red-income', label: '红收绿支' },
  { value: 'green-income', label: '绿收红支' },
]

function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          className="segmented-item"
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

/** 设置 / 我的（M06）。移动端「我的」Tab 也指向这里，汇总侧边栏中的次级入口。 */
export function SettingsPage() {
  const toast = useToast()
  const [preferences, setPreferences] = usePreferences()
  const [licenseOpen, setLicenseOpen] = useState(false)

  async function handleExportCsv() {
    try {
      const [rows, categories, accounts] = await Promise.all([
        db.transactions.toArray(),
        listCategories(db),
        listAccounts(db),
      ])
      downloadText(csvFileName(), transactionsToCsv(rows, categories, accounts), 'text/csv;charset=utf-8')
      toast.show({ message: `已导出 ${rows.length} 条流水` })
    } catch (e) {
      toast.show({ message: e instanceof Error ? `导出失败：${e.message}` : '导出失败' })
    }
  }

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
      <AccountSection />
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
        <h2 className="t-caption text-tertiary settings-group-title">外观</h2>
        <div className="card settings-form">
          <div className="settings-field">
            <span className="t-body-m">主题</span>
            <Segmented
              label="主题"
              options={THEME_OPTIONS}
              value={preferences.theme}
              onChange={(theme) => setPreferences({ theme })}
            />
          </div>
          <div className="settings-field">
            <span className="settings-field-label">
              <span className="t-body-m">金额颜色</span>
              <span className="t-caption text-tertiary">
                预览 <span className="t-num-s amount-income">+¥8,000.00</span>{' '}
                <span className="t-num-s amount-expense">-¥32.50</span>
              </span>
            </span>
            <Segmented
              label="金额颜色"
              options={MONEY_OPTIONS}
              value={preferences.moneyColors}
              onChange={(moneyColors) => setPreferences({ moneyColors })}
            />
          </div>
        </div>
        <p className="t-caption text-tertiary">外观只保存在这台设备上。图表的收支颜色保持蓝 / 绿，方便色弱用户区分。</p>
      </section>
      <section className="settings-group">
        <h2 className="t-caption text-tertiary settings-group-title">导出与备份</h2>
        <ul className="card settings-list">
          <li>
            <button type="button" className="settings-item" onClick={() => void handleExportCsv()}>
              <FileSpreadsheet size={20} aria-hidden="true" className="settings-item-icon" />
              <span className="t-body-m">导出流水（CSV）</span>
              <ChevronRight size={18} aria-hidden="true" className="text-tertiary" />
            </button>
          </li>
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
        <p className="t-caption text-tertiary">
          CSV 可以用 Excel 打开，也能在导入中心按「通用表格」导回。JSON 备份包含分类、账户、预算和规则，用于完整恢复。数据只存在这台设备的浏览器里，清理浏览器数据会一并删除，建议定期导出备份。
        </p>
      </section>
      <section className="settings-group">
        <h2 className="t-caption text-tertiary settings-group-title">关于</h2>
        <ul className="card settings-list">
          <li>
            <button type="button" className="settings-item" onClick={() => setLicenseOpen(true)}>
              <Scale size={20} aria-hidden="true" className="settings-item-icon" />
              <span className="t-body-m">许可与授权</span>
              <span className="settings-item-value t-body-s text-tertiary">个人免费 · 商用需授权</span>
              <ChevronRight size={18} aria-hidden="true" className="text-tertiary" />
            </button>
          </li>
        </ul>
        <p className="t-caption text-tertiary">陶朱簿 v{__APP_VERSION__} · 笔笔分明，自有陶朱</p>
      </section>
      <Dialog open={licenseOpen} title="许可与授权" onClose={() => setLicenseOpen(false)}>
        <LicenseInfo />
      </Dialog>
    </div>
  )
}

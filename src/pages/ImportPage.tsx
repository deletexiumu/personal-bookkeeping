import { useState } from 'react'
import { PageHeader } from '../components/layout/AppShell'
import { ImportCenter } from '../components/import/ImportCenter'
import { ImportWizard } from '../components/import/ImportWizard'
import { RestoreWizard } from '../components/import/RestoreWizard'
import type { Account, Category, ImportSource } from '../types'

interface Props {
  categories: Category[]
  accounts: Account[]
}

/** 导入（M04 / M05 / D03）：导入中心与导入向导 */
export function ImportPage({ categories, accounts }: Props) {
  // 从设置页「从备份恢复」进入时带 #/import/json
  const [source, setSource] = useState<ImportSource | null>(() => (window.location.hash === '#/import/json' ? 'json' : null))

  if (source === 'json') return <RestoreWizard onExit={() => setSource(null)} />
  if (source) {
    return <ImportWizard source={source} categories={categories} accounts={accounts} onExit={() => setSource(null)} />
  }
  return (
    <div className="page">
      <PageHeader title="导入" />
      <ImportCenter onStart={setSource} />
    </div>
  )
}

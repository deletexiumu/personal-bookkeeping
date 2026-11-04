import { useState } from 'react'
import { PageHeader } from '../components/layout/AppShell'
import { ImportCenter } from '../components/import/ImportCenter'
import { ImportWizard } from '../components/import/ImportWizard'
import type { Account, Category, ImportSource } from '../types'

interface Props {
  categories: Category[]
  accounts: Account[]
}

/** 导入（M04 / M05 / D03）：导入中心与导入向导 */
export function ImportPage({ categories, accounts }: Props) {
  const [source, setSource] = useState<ImportSource | null>(null)

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

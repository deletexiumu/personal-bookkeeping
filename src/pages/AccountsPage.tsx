import { useLiveQuery } from 'dexie-react-hooks'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { PageHeader } from '../components/layout/AppShell'
import { AccountIcon } from '../components/CategoryIcon'
import { ACCOUNT_TYPES } from '../components/icons'
import { AccountForm } from '../components/manage/AccountForm'
import { ManageRow } from '../components/manage/ManageRow'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Dialog } from '../components/ui/Dialog'
import { db } from '../db'
import { moveItem } from '../db/catalog'
import { computeBalances, netWorth } from '../lib/balance'
import { formatCents } from '../lib/money'
import type { Account } from '../types'

/** 账户管理：净资产、各账户余额，新增 / 编辑 / 归档 / 排序 */
export function AccountsPage({ accounts }: { accounts: Account[] }) {
  const transactions = useLiveQuery(() => db.transactions.toArray(), [], [])
  const [editing, setEditing] = useState<Account | 'new' | null>(null)
  const balances = computeBalances(accounts, transactions)
  const active = accounts.filter((a) => !a.archived)
  const archived = accounts.filter((a) => a.archived)
  const worth = netWorth(active.map((a) => balances.get(a.id!) ?? 0))

  const row = (a: Account, list: Account[], index: number) => {
    const balance = balances.get(a.id!) ?? 0
    return (
      <ManageRow
        key={a.id}
        label={`账户 ${a.name}`}
        icon={<AccountIcon account={a} />}
        title={a.name}
        subtitle={[ACCOUNT_TYPES[a.type ?? 'other'].label, a.note]
          .filter((text) => text && text !== a.name)
          .join(' · ')}
        value={<span className={`t-num-m ${balance < 0 ? 'text-expense' : ''}`}>{formatCents(balance)}</span>}
        onOpen={() => setEditing(a)}
        onMoveUp={index > 0 ? () => void moveItem(db, 'accounts', a.id!, -1) : undefined}
        onMoveDown={index < list.length - 1 ? () => void moveItem(db, 'accounts', a.id!, 1) : undefined}
      />
    )
  }

  return (
    <div className="page">
      <PageHeader
        title="账户"
        actions={
          <Button variant="primary" icon={<Plus size={18} aria-hidden="true" />} onClick={() => setEditing('new')}>
            新增账户
          </Button>
        }
      />
      <section className="summary" aria-label="净资产">
        <div className="kpi kpi-main">
          <span className="kpi-label t-body-s">净资产</span>
          <strong className="kpi-value t-num-xl">{formatCents(worth.net)}</strong>
        </div>
        <div className="kpi">
          <span className="kpi-label t-body-s">资产</span>
          <strong className="kpi-value t-num-l">{formatCents(worth.assets)}</strong>
        </div>
        <div className="kpi">
          <span className="kpi-label t-body-s">负债</span>
          <strong className="kpi-value t-num-l">{formatCents(worth.liabilities)}</strong>
        </div>
      </section>
      <ul className="card manage-list" aria-label="账户列表">
        {active.map((a, i) => row(a, active, i))}
      </ul>
      {archived.length > 0 && (
        <section className="settings-group">
          <h2 className="t-caption text-tertiary settings-group-title">
            已归档 <Badge>{archived.length}</Badge>
          </h2>
          <ul className="card manage-list" aria-label="已归档账户">
            {archived.map((a) => row(a, archived, -1))}
          </ul>
        </section>
      )}
      <p className="t-caption text-tertiary">余额 = 初始余额 + 收入 − 支出 ± 转账；信用卡余额为负表示欠款。</p>
      <Dialog open={editing !== null} title={editing === 'new' ? '新增账户' : '编辑账户'} onClose={() => setEditing(null)}>
        {editing !== null && (
          <AccountForm account={editing === 'new' ? undefined : editing} onDone={() => setEditing(null)} />
        )}
      </Dialog>
    </div>
  )
}

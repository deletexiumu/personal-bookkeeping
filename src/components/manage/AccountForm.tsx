import { useState, type FormEvent } from 'react'
import { db } from '../../db'
import { deleteAccount, saveAccount } from '../../db/catalog'
import { parseBalanceToCents } from '../../lib/money'
import type { Account, AccountType } from '../../types'
import { AccountIcon } from '../CategoryIcon'
import { ACCOUNT_TYPES } from '../icons'
import { Button } from '../ui/Button'

interface Props {
  /** 不传表示新增 */
  account?: Account
  onDone: () => void
}

function centsToInput(cents: number | undefined): string {
  if (!cents) return ''
  return (cents / 100).toFixed(2).replace(/\.00$/, '')
}

/** 新增 / 编辑账户：名称、类型、初始余额、备注、归档；没有流水时可删除 */
export function AccountForm({ account, onDone }: Props) {
  const [name, setName] = useState(account?.name ?? '')
  const [type, setType] = useState<AccountType>(account?.type ?? 'debit')
  const [initial, setInitial] = useState(() => centsToInput(account?.initialBalance))
  const [note, setNote] = useState(account?.note ?? '')
  const [archived, setArchived] = useState(account?.archived ?? false)
  const [error, setError] = useState('')

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const initialBalance = parseBalanceToCents(initial)
    if (initialBalance === null) {
      setError('初始余额格式不正确，最多两位小数；欠款可填负数')
      return
    }
    try {
      await saveAccount(db, {
        ...account,
        name,
        type,
        initialBalance,
        note: note.trim() || undefined,
        archived: archived || undefined,
      })
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
    }
  }

  async function handleDelete() {
    if (account?.id === undefined || !confirm(`确定删除账户「${account.name}」吗？`)) return
    try {
      await deleteAccount(db, account.id)
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败')
    }
  }

  return (
    <form className="form" onSubmit={handleSubmit} aria-label={account ? '编辑账户' : '新增账户'}>
      <div className="manage-preview">
        <AccountIcon account={{ name, type }} size={48} />
        <span className="t-title-s">{name.trim() || '账户名称'}</span>
      </div>
      <label className="field">
        <span className="field-label">名称</span>
        <input
          data-autofocus
          className="input"
          value={name}
          maxLength={12}
          onChange={(e) => setName(e.target.value)}
          placeholder="如：招行储蓄卡"
          required
        />
      </label>
      <div className="field-row">
        <label className="field">
          <span className="field-label">类型</span>
          <select className="input" value={type} onChange={(e) => setType(e.target.value as AccountType)}>
            {(Object.keys(ACCOUNT_TYPES) as AccountType[]).map((t) => (
              <option key={t} value={t}>
                {ACCOUNT_TYPES[t].label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">初始余额（元）</span>
          <input
            className="input t-num-m"
            inputMode="decimal"
            value={initial}
            onChange={(e) => setInitial(e.target.value)}
            placeholder={type === 'credit' ? '欠款填负数' : '0.00'}
          />
        </label>
      </div>
      <label className="field">
        <span className="field-label">备注</span>
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="可选，如：尾号 1234" />
      </label>
      {account && (
        <label className="check-field t-body-s">
          <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} />
          归档（不再出现在记一笔中，历史流水保留）
        </label>
      )}
      {error && (
        <p className="form-error t-body-s" role="alert">
          {error}
        </p>
      )}
      <div className="manage-actions">
        {account && (
          <Button variant="danger" onClick={() => void handleDelete()}>
            删除
          </Button>
        )}
        <Button type="submit" variant="primary">
          保存
        </Button>
      </div>
    </form>
  )
}

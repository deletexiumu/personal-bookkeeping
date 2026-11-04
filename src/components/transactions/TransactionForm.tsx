import { useState, type FormEvent } from 'react'
import { db } from '../../db'
import { addTransaction } from '../../db/transactions'
import { today } from '../../lib/date'
import { parseAmountToCents } from '../../lib/money'
import type { Account, Category, TransactionType } from '../../types'
import { CategoryIcon } from '../CategoryIcon'
import { Button } from '../ui/Button'

interface Props {
  categories: Category[]
  accounts: Account[]
  /** 点「完成」保存成功后调用（用于关闭弹窗） */
  onDone?: () => void
}

const TYPE_LABEL: Record<TransactionType, string> = { expense: '支出', income: '收入' }

/**
 * 记一笔表单。只有金额必填；「再记」保存后只清空金额和备注，便于连续记账。
 * W2 会换成设计稿中的金额键盘（支持四则运算）与「沿用上次」。
 */
export function TransactionForm({ categories, accounts, onDone }: Props) {
  const [type, setType] = useState<TransactionType>('expense')
  const [amount, setAmount] = useState('')
  const [categoryId, setCategoryId] = useState<number | ''>('')
  const [accountId, setAccountId] = useState<number | ''>('')
  const [date, setDate] = useState(today)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const options = categories.filter((c) => c.type === type)
  const selectedCategory = options.some((c) => c.id === categoryId) ? categoryId : (options[0]?.id ?? '')
  const selectedAccount = accountId === '' ? (accounts[0]?.id ?? '') : accountId

  async function save(closeAfter: boolean) {
    const cents = parseAmountToCents(amount)
    if (cents === null) {
      setError('请输入大于 0 的金额，最多两位小数')
      return
    }
    if (selectedCategory === '' || selectedAccount === '') {
      setError('请选择分类和账户')
      return
    }
    setSaving(true)
    try {
      await addTransaction(db, {
        type,
        amount: cents,
        categoryId: selectedCategory,
        accountId: selectedAccount,
        date,
        note: note.trim() || undefined,
      })
    } finally {
      setSaving(false)
    }
    setAmount('')
    setNote('')
    setError('')
    if (closeAfter) onDone?.()
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    void save(true)
  }

  return (
    <form className="form" onSubmit={handleSubmit} aria-label="记一笔">
      <div className="segmented" role="radiogroup" aria-label="收支类型">
        {(['expense', 'income'] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={type === t}
            className="segmented-item"
            onClick={() => setType(t)}
          >
            {TYPE_LABEL[t]}
          </button>
        ))}
      </div>

      <div className="amount-field">
        <span className="amount-prefix t-num-l" aria-hidden="true">
          ¥
        </span>
        <input
          data-autofocus
          aria-label="金额（元）"
          className="amount-input t-num-xl"
          inputMode="decimal"
          placeholder="0.00"
          autoComplete="off"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </div>

      <fieldset className="field">
        <legend className="field-label">分类</legend>
        <div className="chip-grid">
          {options.map((c) => (
            <button
              key={c.id}
              type="button"
              className="category-chip"
              aria-pressed={selectedCategory === c.id}
              onClick={() => c.id !== undefined && setCategoryId(c.id)}
            >
              <CategoryIcon category={c} size={44} />
              <span className="t-caption">{c.name}</span>
            </button>
          ))}
        </div>
      </fieldset>

      <div className="field-row">
        <label className="field">
          <span className="field-label">账户</span>
          <select className="input" value={selectedAccount} onChange={(e) => setAccountId(Number(e.target.value))}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">日期</span>
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </label>
      </div>
      <label className="field">
        <span className="field-label">备注</span>
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="可选，如：午饭" />
      </label>

      {error && (
        <p className="form-error t-body-s" role="alert">
          {error}
        </p>
      )}

      <div className="form-actions">
        <Button disabled={saving} onClick={() => void save(false)}>
          再记
        </Button>
        <Button type="submit" variant="primary" disabled={saving}>
          完成
        </Button>
      </div>
    </form>
  )
}

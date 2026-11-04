import { useState, type FormEvent } from 'react'
import { db } from '../db'
import { addTransaction } from '../db/transactions'
import { today } from '../lib/date'
import { parseAmountToCents } from '../lib/money'
import type { Account, Category, TransactionType } from '../types'

interface Props {
  categories: Category[]
  accounts: Account[]
}

export function TransactionForm({ categories, accounts }: Props) {
  const [type, setType] = useState<TransactionType>('expense')
  const [amount, setAmount] = useState('')
  const [categoryId, setCategoryId] = useState<number | ''>('')
  const [accountId, setAccountId] = useState<number | ''>('')
  const [date, setDate] = useState(today)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')

  const options = categories.filter((c) => c.type === type)
  const selectedCategory = options.some((c) => c.id === categoryId) ? categoryId : (options[0]?.id ?? '')
  const selectedAccount = accountId === '' ? (accounts[0]?.id ?? '') : accountId

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const cents = parseAmountToCents(amount)
    if (cents === null) {
      setError('请输入大于 0 的金额，最多两位小数')
      return
    }
    if (selectedCategory === '' || selectedAccount === '') {
      setError('请选择分类和账户')
      return
    }
    await addTransaction(db, {
      type,
      amount: cents,
      categoryId: selectedCategory,
      accountId: selectedAccount,
      date,
      note: note.trim() || undefined,
    })
    setAmount('')
    setNote('')
    setError('')
  }

  return (
    <form className="card form" onSubmit={handleSubmit} aria-label="记一笔">
      <div className="segmented" role="radiogroup" aria-label="收支类型">
        {(['expense', 'income'] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={type === t}
            className={type === t ? 'active' : ''}
            onClick={() => setType(t)}
          >
            {t === 'expense' ? '支出' : '收入'}
          </button>
        ))}
      </div>
      <label>
        金额（元）
        <input
          inputMode="decimal"
          placeholder="0.00"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </label>
      <div className="row">
        <label>
          分类
          <select value={selectedCategory} onChange={(e) => setCategoryId(Number(e.target.value))}>
            {options.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          账户
          <select value={selectedAccount} onChange={(e) => setAccountId(Number(e.target.value))}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="row">
        <label>
          日期
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </label>
        <label>
          备注
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="可选" />
        </label>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="primary">
        保存
      </button>
    </form>
  )
}

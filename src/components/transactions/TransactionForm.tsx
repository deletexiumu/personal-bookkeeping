import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowRight } from 'lucide-react'
import { useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { db } from '../../db'
import { addTransaction, addTransfer, categoryUsage, deleteTransactions } from '../../db/transactions'
import { nowTime, today } from '../../lib/date'
import { applyKey, evaluateAmount, hasOperation, keyFromKeyboard, normalizeExpression } from '../../lib/expression'
import { loadLastEntry, saveLastEntry } from '../../lib/lastEntry'
import { formatCents, parseAmountToCents } from '../../lib/money'
import { parseTags } from '../../lib/tags'
import { ensureTags } from '../../db/tags'
import type { Account, Category, CategoryType, TransactionType } from '../../types'
import { CategoryIcon } from '../CategoryIcon'
import { useToast } from '../ui/toast-context'
import { AmountKeypad } from './AmountKeypad'

interface Props {
  categories: Category[]
  accounts: Account[]
  /** 点「完成」保存成功后调用（用于关闭弹窗） */
  onDone?: () => void
}

const TYPE_LABEL: Record<TransactionType, string> = { expense: '支出', income: '收入', transfer: '转账' }

/** 手续费记入的分类：优先「手续费」，其次「其他支出」 */
function feeCategoryOf(categories: Category[]): number | undefined {
  const expense = categories.filter((c) => c.type === 'expense')
  return (expense.find((c) => c.name === '手续费') ?? expense.find((c) => c.name === '其他支出'))?.id
}

/**
 * 记一笔（M02）。打开即聚焦金额；金额支持 12+8.5 这样的四则运算；
 * 分类按使用频次排序，分类和账户沿用上次；「再记」保存后只清空金额和备注；
 * 转账模式下分类区换成「转出 → 转入账户」并可填手续费。
 */
export function TransactionForm({ categories, accounts, onDone }: Props) {
  const toast = useToast()
  const [last] = useState(loadLastEntry)
  const [type, setType] = useState<TransactionType>('expense')
  const [expr, setExpr] = useState('')
  const [categoryId, setCategoryId] = useState<Partial<Record<CategoryType, number>>>(() => ({
    expense: last.expenseCategoryId,
    income: last.incomeCategoryId,
  }))
  const [accountId, setAccountId] = useState<number | undefined>(last.accountId)
  const [toAccountId, setToAccountId] = useState<number | undefined>(last.toAccountId)
  const [fee, setFee] = useState('')
  const [date, setDate] = useState(today)
  const [time, setTime] = useState(() => nowTime())
  const [note, setNote] = useState('')
  const [tags, setTags] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const amountRef = useRef<HTMLInputElement>(null)
  const usage = useLiveQuery(() => categoryUsage(db), [], new Map<number, number>())

  const options = useMemo(() => {
    if (type === 'transfer') return []
    const list = categories.filter((c) => c.type === type)
    // 按使用次数降序；次数相同保持默认顺序
    return list
      .map((c, i) => ({ c, i, n: usage.get(c.id ?? -1) ?? 0 }))
      .sort((a, b) => b.n - a.n || a.i - b.i)
      .map(({ c }) => c)
  }, [categories, type, usage])

  const pick = <T extends { id?: number }>(list: T[], id: number | undefined, fallback = 0) =>
    list.some((x) => x.id === id) ? id : list[fallback]?.id

  const selectedCategory = type === 'transfer' ? undefined : pick(options, categoryId[type])
  const selectedAccount = pick(accounts, accountId)
  const pickedTo = pick(accounts, toAccountId)
  const selectedToAccount =
    pickedTo !== undefined && pickedTo !== selectedAccount
      ? pickedTo
      : accounts.find((a) => a.id !== selectedAccount)?.id

  const result = evaluateAmount(expr)
  const isFuture = date > today()

  function reset(keepOpen: boolean) {
    setExpr('')
    setNote('')
    setFee('')
    setError('')
    if (keepOpen) setTime(nowTime())
  }

  async function save(closeAfter: boolean) {
    if (!result.ok) {
      setError(result.error === '请输入金额' ? '请输入大于 0 的金额' : result.error)
      return
    }
    if (selectedAccount === undefined) {
      setError('请先添加账户')
      return
    }
    const tagList = parseTags(tags)
    const base = {
      date,
      time: time || undefined,
      note: note.trim() || undefined,
      ...(tagList.length > 0 ? { tags: tagList } : {}),
    }

    let ids: number[]
    setSaving(true)
    try {
      if (type === 'transfer') {
        if (selectedToAccount === undefined || selectedToAccount === selectedAccount) {
          setError('请选择不同的转出和转入账户')
          return
        }
        const feeCents = fee.trim() ? parseAmountToCents(fee) : 0
        if (feeCents === null) {
          setError('手续费格式不正确，最多两位小数')
          return
        }
        ids = await addTransfer(db, {
          ...base,
          fromAccountId: selectedAccount,
          toAccountId: selectedToAccount,
          amount: result.cents,
          fee: feeCents,
          feeCategoryId: feeCategoryOf(categories),
        })
        saveLastEntry({ accountId: selectedAccount, toAccountId: selectedToAccount })
      } else {
        if (selectedCategory === undefined) {
          setError('请选择分类')
          return
        }
        ids = [
          await addTransaction(db, {
            ...base,
            type,
            amount: result.cents,
            categoryId: selectedCategory,
            accountId: selectedAccount,
          }),
        ]
        saveLastEntry({
          accountId: selectedAccount,
          [type === 'expense' ? 'expenseCategoryId' : 'incomeCategoryId']: selectedCategory,
        })
      }
      // 新写的标签加进标签目录，下次可以直接点选
      if (tagList.length > 0) await ensureTags(db, tagList)
    } finally {
      setSaving(false)
    }

    toast.show({
      message: `已记${TYPE_LABEL[type]} ${formatCents(result.cents)}`,
      action: { label: '撤销', onClick: () => void deleteTransactions(db, ids) },
    })
    reset(!closeAfter)
    if (closeAfter) onDone?.()
  }

  /** 焦点不在文本框时（如刚点了分类），直接敲数字和运算符也会输入到金额 */
  function handleKeyDown(e: KeyboardEvent<HTMLFormElement>) {
    const target = e.target as HTMLElement
    if (e.metaKey || e.ctrlKey || e.altKey || ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return
    const key = keyFromKeyboard(e.key)
    if (!key) return
    e.preventDefault()
    setExpr((prev) => applyKey(prev, key))
    setError('')
    amountRef.current?.focus()
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    void save(true)
  }

  return (
    <form className="form quick-add" onSubmit={handleSubmit} onKeyDown={handleKeyDown} aria-label="记一笔">
      <div className="segmented" role="radiogroup" aria-label="收支类型">
        {(['expense', 'income', 'transfer'] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={type === t}
            className="segmented-item"
            onClick={() => {
              setType(t)
              setError('')
              amountRef.current?.focus()
            }}
          >
            {TYPE_LABEL[t]}
          </button>
        ))}
      </div>

      <div className="amount-block">
        <div className="amount-field">
          <span className="amount-prefix t-num-l" aria-hidden="true">
            ¥
          </span>
          <input
            ref={amountRef}
            data-autofocus
            aria-label="金额（元）"
            aria-describedby="amount-hint"
            className="amount-input t-num-xl"
            inputMode="none"
            placeholder="0.00"
            autoComplete="off"
            value={expr.replace(/\*/g, '×').replace(/\//g, '÷')}
            onChange={(e) => setExpr(normalizeExpression(e.target.value).replace(/[^0-9.+\-*/]/g, ''))}
          />
        </div>
        <p id="amount-hint" className="amount-hint t-caption text-tertiary">
          {hasOperation(expr) && result.ok ? `= ${formatCents(result.cents)}` : '支持输入 12+8.5 自动计算'}
        </p>
      </div>

      {type === 'transfer' ? (
        <div className="transfer-row">
          <label className="field">
            <span className="field-label">转出账户</span>
            <select
              className="input"
              value={selectedAccount ?? ''}
              onChange={(e) => setAccountId(Number(e.target.value))}
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <ArrowRight size={18} className="transfer-arrow text-tertiary" aria-hidden="true" />
          <label className="field">
            <span className="field-label">转入账户</span>
            <select
              className="input"
              value={selectedToAccount ?? ''}
              onChange={(e) => setToAccountId(Number(e.target.value))}
            >
              {accounts
                .filter((a) => a.id !== selectedAccount)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="field transfer-fee">
            <span className="field-label">手续费</span>
            <input
              className="input"
              inputMode="decimal"
              placeholder="0.00"
              value={fee}
              onChange={(e) => setFee(e.target.value)}
            />
          </label>
        </div>
      ) : (
        <fieldset className="field">
          <legend className="sr-only">分类</legend>
          <div className="chip-grid">
            {options.map((c) => (
              <button
                key={c.id}
                type="button"
                className="category-chip"
                aria-pressed={selectedCategory === c.id}
                onClick={() => c.id !== undefined && setCategoryId((prev) => ({ ...prev, [type]: c.id }))}
              >
                <CategoryIcon category={c} size={44} />
                <span className="t-caption">{c.name}</span>
              </button>
            ))}
          </div>
        </fieldset>
      )}

      <div className="field-bar">
        {type !== 'transfer' && (
          <label className="field">
            <span className="field-label">账户</span>
            <select
              className="input"
              value={selectedAccount ?? ''}
              onChange={(e) => setAccountId(Number(e.target.value))}
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="field">
          <span className="field-label">日期</span>
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </label>
        <label className="field">
          <span className="field-label">时间</span>
          <input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </label>
      </div>
      <div className="field-row">
        <label className="field">
          <span className="field-label">备注</span>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="如：午饭" />
        </label>
        <label className="field">
          <span className="field-label">标签</span>
          <input className="input" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="#家庭 #周末" />
        </label>
      </div>

      {isFuture && <p className="form-warning t-caption">日期在未来，确认无误后再保存。</p>}
      {error && (
        <p className="form-error t-body-s" role="alert">
          {error}
        </p>
      )}

      <AmountKeypad
        disabled={saving}
        onKey={(key) => {
          setExpr((prev) => applyKey(prev, key))
          setError('')
        }}
        onAgain={() => void save(false)}
      />
    </form>
  )
}

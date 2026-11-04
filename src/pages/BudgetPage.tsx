import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { PageHeader } from '../components/layout/AppShell'
import { CategoryIcon } from '../components/CategoryIcon'
import { ProgressBar } from '../components/ui/ProgressBar'
import { useToast } from '../components/ui/toast-context'
import { db } from '../db'
import { listBudgets, setBudget } from '../db/budgets'
import { listByMonth } from '../db/transactions'
import { budgetStatus, daysLeftInMonth, expenseByCategory, type BudgetStatus } from '../lib/budget'
import { formatMonth, monthOf, today } from '../lib/date'
import { formatCents, parseAmountToCents } from '../lib/money'
import type { Category } from '../types'

const LEVEL_TEXT = { ok: '', warning: 'text-warning', over: 'text-expense' } as const

function centsToInput(cents: number | undefined): string {
  return cents ? (cents / 100).toFixed(2).replace(/\.00$/, '') : ''
}

interface AmountInputProps {
  label: string
  value: number | undefined
  onCommit: (cents: number | null) => Promise<void>
}

/** 预算金额输入：失焦或回车保存，清空即取消预算 */
function BudgetInput({ label, value, onCommit }: AmountInputProps) {
  const [draft, setDraft] = useState<string | null>(null)
  const [error, setError] = useState(false)
  const text = draft ?? centsToInput(value)

  async function commit() {
    if (draft === null) return
    const cents = draft.trim() === '' ? null : parseAmountToCents(draft)
    if (cents === null && draft.trim() !== '') {
      setError(true)
      return
    }
    setError(false)
    if (cents !== (value ?? null)) await onCommit(cents)
    setDraft(null)
  }

  return (
    <input
      className={`input budget-input t-num-m ${error ? 'input-error' : ''}`}
      aria-label={label}
      aria-invalid={error || undefined}
      inputMode="decimal"
      placeholder="未设置"
      value={text}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') {
          setDraft(null)
          setError(false)
        }
      }}
    />
  )
}

function StatusLine({ status, daysLeft }: { status: BudgetStatus; daysLeft?: number }) {
  const percent = Math.round(status.ratio * 100)
  return (
    <p className={`t-caption budget-status ${LEVEL_TEXT[status.level] || 'text-tertiary'}`}>
      已用 {formatCents(status.spent)} · {percent}%
      {status.remaining >= 0 ? ` · 剩余 ${formatCents(status.remaining)}` : ` · 超支 ${formatCents(-status.remaining)}`}
      {daysLeft !== undefined && daysLeft > 0 && status.remaining > 0 && ` · 日均可用 ${formatCents(Math.floor(status.remaining / daysLeft))}`}
    </p>
  )
}

/** 预算（M03 / D02 预算执行）：本月总预算与分类预算，每月循环生效 */
export function BudgetPage({ categories }: { categories: Category[] }) {
  const toast = useToast()
  const month = monthOf(today())
  const budgets = useLiveQuery(() => listBudgets(db), [], [])
  const transactions = useLiveQuery(() => listByMonth(db, month), [month], [])
  const spent = expenseByCategory(transactions)
  const daysLeft = daysLeftInMonth(month, today())
  const total = budgets.find((b) => b.categoryId === undefined)
  const totalStatus = total && budgetStatus(total.amount, spent.total)
  const byCategory = new Map(budgets.filter((b) => b.categoryId !== undefined).map((b) => [b.categoryId!, b.amount]))
  const categoryBudgetSum = [...byCategory.values()].reduce((a, b) => a + b, 0)

  // 已设预算的分类按已用比例排前面（超支置顶），其余按分类顺序
  const expenseCategories = categories
    .filter((c) => c.type === 'expense' && (!c.archived || byCategory.has(c.id!)))
    .map((c, i) => {
      const amount = byCategory.get(c.id!)
      return { c, i, amount, status: amount ? budgetStatus(amount, spent.byCategory.get(c.id!) ?? 0) : undefined }
    })
    .sort((a, b) => (b.status?.ratio ?? -1) - (a.status?.ratio ?? -1) || a.i - b.i)

  const commit = (categoryId: number | undefined, name: string) => async (cents: number | null) => {
    await setBudget(db, categoryId, cents)
    toast.show({ message: cents ? `已设置${name}预算 ${formatCents(cents)}` : `已取消${name}预算` })
  }

  return (
    <div className="page">
      <PageHeader title="预算" actions={<span className="t-body-s text-secondary">{formatMonth(month)} · 每月循环</span>} />

      <section className="card budget-total" aria-label="总预算">
        <div className="budget-row-head">
          <div>
            <h2 className="t-title-s">月度总预算</h2>
            <p className="t-caption text-tertiary">本月支出 {formatCents(spent.total)} · 剩 {daysLeft} 天</p>
          </div>
          <BudgetInput label="月度总预算（元）" value={total?.amount} onCommit={commit(undefined, '总')} />
        </div>
        {totalStatus && (
          <>
            <ProgressBar ratio={totalStatus.ratio} level={totalStatus.level} label="总预算" />
            <StatusLine status={totalStatus} daysLeft={daysLeft} />
          </>
        )}
        {total && categoryBudgetSum > total.amount && (
          <p className="t-caption text-warning">分类预算合计 {formatCents(categoryBudgetSum)}，超过了总预算。</p>
        )}
      </section>

      <section className="settings-group">
        <h2 className="t-caption text-tertiary settings-group-title">分类预算</h2>
        <ul className="card manage-list" aria-label="分类预算">
          {expenseCategories.map(({ c, amount, status }) => (
            <li key={c.id} className="budget-row">
              <div className="budget-row-head">
                <span className="budget-row-name">
                  <CategoryIcon category={c} size={32} />
                  <span className="t-body-m-strong">{c.name}</span>
                </span>
                <BudgetInput label={`${c.name}预算（元）`} value={amount} onCommit={commit(c.id, c.name)} />
              </div>
              {status ? (
                <>
                  <ProgressBar ratio={status.ratio} level={status.level} label={`${c.name}预算`} />
                  <StatusLine status={status} />
                </>
              ) : (
                (spent.byCategory.get(c.id!) ?? 0) > 0 && (
                  <p className="t-caption text-tertiary budget-status">本月已支出 {formatCents(spent.byCategory.get(c.id!)!)}</p>
                )
              )}
            </li>
          ))}
        </ul>
      </section>
      <p className="t-caption text-tertiary">已用超过 80% 显示橙色，超过 100% 显示红色。输入框清空即取消该预算。</p>
    </div>
  )
}

import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db'
import { loadOccurrences, setTransactionPlan } from '../../db/plans'
import { shiftDate, today } from '../../lib/date'
import { formatCents } from '../../lib/money'
import { isOpen, MAX_PLAN_WINDOW, plannable, type PlanOccurrence } from '../../lib/plans'
import type { Transaction } from '../../types'
import { useToast } from '../ui/toast-context'
import { diffText } from './display'

/**
 * 流水详情里的「预算」：已对应某一期时显示计划与实际（这一期的合计）和差额，可取消关联；
 * 没对应时列出前后一个月内同方向、还没实现的期，可手动关联。没有可选的期时不显示。
 */
export function PlanLink({ transaction: t }: { transaction: Transaction }) {
  const toast = useToast()
  const todayDate = today()
  const occurrences = useLiveQuery(
    () => loadOccurrences(db, shiftDate(t.date, -MAX_PLAN_WINDOW), shiftDate(t.date, MAX_PLAN_WINDOW), todayDate),
    [t.date, t.planRef, todayDate],
    [] as PlanOccurrence[],
  )
  if (t.id === undefined) return null
  const current = t.planRef ? occurrences.find((o) => o.ref === t.planRef) : undefined
  const link = async (ref: string | undefined, message: string) => {
    await setTransactionPlan(db, t.id!, ref)
    toast.show({ message })
  }

  if (current) {
    return (
      <div className="field">
        <span className="field-label">预算</span>
        <p className="tx-detail-plan t-caption text-secondary">
          <span className="text-brand">
            {current.plan.name} · {current.date}
          </span>
          {' '}计划 {formatCents(current.amount)} · 实际 {formatCents(current.actual)}
          {current.transactions.length > 1 && `（${current.transactions.length} 笔合计）`} · {diffText(current)}{' '}
          <button type="button" className="link-button" onClick={() => void link(undefined, `已取消对应预算「${current.plan.name}」`)}>
            取消关联
          </button>
        </p>
      </div>
    )
  }
  if (!plannable({ ...t, planRef: undefined })) return null
  const options = occurrences
    .filter((o) => isOpen(o) && o.plan.type === t.type)
    .sort((a, b) => Math.abs(Date.parse(a.date) - Date.parse(t.date)) - Math.abs(Date.parse(b.date) - Date.parse(t.date)))
  if (options.length === 0) return null
  return (
    <label className="field">
      <span className="field-label">预算</span>
      <select
        className="input"
        value=""
        onChange={(e) => {
          const o = options.find((x) => x.ref === e.target.value)
          if (o) void link(o.ref, `已对应预算「${o.plan.name}」${o.date.slice(5)}，转为实际`)
        }}
      >
        <option value="">不对应预算</option>
        {options.map((o) => (
          <option key={o.ref} value={o.ref}>
            {o.plan.name} · {o.date} · 计划 {formatCents(o.amount)}
            {o.status === 'overdue' ? '（逾期）' : ''}
          </option>
        ))}
      </select>
    </label>
  )
}

import { useLiveQuery } from 'dexie-react-hooks'
import { Copy, Pencil } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { db } from '../../db'
import { copyOccurrence, deletePlan, hasPlanOn, realizeOccurrence, setOccurrenceAmount, setOccurrenceSkipped } from '../../db/plans'
import { deleteTransactions } from '../../db/transactions'
import { today } from '../../lib/date'
import { formatCents, parseAmountToCents } from '../../lib/money'
import { isOpen, nextPeriodDate, PLAN_STATUS_LABELS, repeatText, type PlanOccurrence } from '../../lib/plans'
import type { Account, Plan } from '../../types'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Dialog } from '../ui/Dialog'
import { useToast } from '../ui/toast-context'
import { dayText, diffText, STATUS_TONE } from './display'

interface Props {
  occurrence: PlanOccurrence
  accounts: Account[]
  onClose: () => void
  /** 传了就多一个「编辑预算」，由外面打开编辑表单 */
  onEdit?: (plan: Plan) => void
}

function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2).replace(/\.00$/, '')
}

/**
 * 点开一期预算：
 * - 复制到下一期（一次性的预算按下个月同一天，周期预算的下一期本来就排好了）、编辑这条预算
 * - 待发生 / 逾期：「已发生」按这一期记一笔实际流水并关联；也可以跳过本期、只改本期计划金额
 * - 已实现：计划和实际的对比
 */
export function PlanOccurrenceDialog({ occurrence: o, accounts, onClose, onEdit }: Props) {
  const toast = useToast()
  const { plan } = o
  const todayDate = today()
  const usable = accounts.filter((a) => !a.archived)
  const [amount, setAmount] = useState(() => centsToInput(o.amount))
  const [accountId, setAccountId] = useState<number | undefined>(plan.accountId ?? usable[0]?.id)
  const [date, setDate] = useState(o.date <= todayDate ? o.date : todayDate)
  const [error, setError] = useState('')
  const cents = parseAmountToCents(amount)
  const open = isOpen(o)
  const nextDate = nextPeriodDate(plan, o.date)
  const nextExists = useLiveQuery(() => hasPlanOn(db, plan, nextDate), [plan.name, plan.type, nextDate], false)

  async function realize(e: FormEvent) {
    e.preventDefault()
    if (cents === null) return setError('请输入正确的金额')
    if (accountId === undefined) return setError('请先添加账户')
    const id = await realizeOccurrence(db, o, { amount: cents, accountId, date })
    toast.show({
      message: `已记${plan.type === 'income' ? '收入' : '支出'} ${formatCents(cents)}，预算「${plan.name}」转为实际`,
      action: { label: '撤销', onClick: () => void deleteTransactions(db, [id]) },
    })
    onClose()
  }

  async function skip() {
    await setOccurrenceSkipped(db, plan.id!, o.date, o.status !== 'skipped')
    toast.show({ message: o.status === 'skipped' ? `已恢复「${plan.name}」${o.date.slice(5)}` : `已跳过「${plan.name}」${o.date.slice(5)}` })
    onClose()
  }

  async function saveAmount() {
    if (cents === null) return setError('请输入正确的金额')
    await setOccurrenceAmount(db, plan.id!, o.date, cents)
    toast.show({ message: `已把「${plan.name}」${o.date.slice(5)} 的计划金额改为 ${formatCents(cents)}` })
    onClose()
  }

  async function copy() {
    const r = await copyOccurrence(db, o, todayDate)
    if ('id' in r) {
      toast.show({
        message: `已把「${plan.name}」复制到 ${dayText(r.date)}，${formatCents(o.amount)}`,
        action: { label: '撤销', onClick: () => void deletePlan(db, r.id) },
      })
    } else toast.show({ message: `${dayText(r.date)} 已经有「${plan.name}」了` })
    onClose()
  }

  return (
    <Dialog open title={`预算 · ${plan.name}`} onClose={onClose}>
      <form className="form" onSubmit={realize} aria-label="预算这一期">
        <p className="plan-occ-head t-body-s text-secondary">
          <Badge tone={STATUS_TONE[o.status]}>{PLAN_STATUS_LABELS[o.status]}</Badge> {o.date} · {plan.repeat === 'none' ? '一次' : repeatText(plan)} · 计划{' '}
          {plan.type === 'income' ? '收入' : '支出'} {formatCents(o.amount)}
          {o.status === 'done' && ` · 实际 ${formatCents(o.actual)}（${diffText(o)}）`}
        </p>
        <div className="plan-occ-tools">
          {nextExists ? (
            <span className="t-caption text-tertiary">
              下一期 {dayText(nextDate)} 已经有了{plan.repeat !== 'none' && '（按周期自动排好）'}
            </span>
          ) : (
            <Button size="sm" icon={<Copy size={14} aria-hidden="true" />} onClick={() => void copy()}>
              复制到下一期（{dayText(nextDate)}）
            </Button>
          )}
          {onEdit && (
            <Button size="sm" icon={<Pencil size={14} aria-hidden="true" />} onClick={() => onEdit(plan)}>
              编辑预算
            </Button>
          )}
        </div>
        {o.status === 'done' && (
          <ul className="plan-occ-linked t-body-s" aria-label="对应的实际流水">
            {o.transactions.map((t) => (
              <li key={t.id}>
                <span className="text-secondary">{t.date}</span>
                <span className="plan-occ-linked-title">{t.merchant ?? t.note ?? plan.name}</span>
                <span className="t-num-s">{formatCents(t.amount)}</span>
              </li>
            ))}
          </ul>
        )}
        {open && (
          <>
            <div className="field-row">
              <label className="field">
                <span className="field-label">实际金额（元）</span>
                <input data-autofocus className="input t-num-m" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </label>
              <label className="field">
                <span className="field-label">日期</span>
                <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
              </label>
            </div>
            <label className="field">
              <span className="field-label">账户</span>
              <select className="input" value={accountId ?? ''} onChange={(e) => setAccountId(Number(e.target.value))}>
                {usable.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <p className="t-caption text-tertiary">
              已发生就记一笔并转为实际；还没发生不用管，导入账单时对得上会自动转。之后导入的钱包账单会和这条手记合并。
            </p>
          </>
        )}
        {error && (
          <p className="form-error t-body-s" role="alert">
            {error}
          </p>
        )}
        {o.status !== 'done' && (
          <div className="manage-actions plan-occ-actions">
            <Button onClick={() => void skip()}>{o.status === 'skipped' ? '恢复本期' : '跳过本期'}</Button>
            {open && (
              <>
                <Button onClick={() => void saveAmount()} disabled={cents === null || cents === o.amount}>
                  只改本期计划
                </Button>
                <Button type="submit" variant="primary">
                  已发生，记一笔
                </Button>
              </>
            )}
          </div>
        )}
        {!onEdit && (
          <a className="link-button t-caption" href="#/budget?tab=plans" onClick={onClose}>
            管理预算账单
          </a>
        )}
      </form>
    </Dialog>
  )
}

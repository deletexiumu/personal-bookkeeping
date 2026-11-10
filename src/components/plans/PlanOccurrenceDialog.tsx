import { useState, type FormEvent } from 'react'
import { db } from '../../db'
import { realizeOccurrence, setOccurrenceAmount, setOccurrenceSkipped } from '../../db/plans'
import { deleteTransactions } from '../../db/transactions'
import { today } from '../../lib/date'
import { formatCents, parseAmountToCents } from '../../lib/money'
import { PLAN_STATUS_LABELS, repeatText, type PlanOccurrence } from '../../lib/plans'
import type { Account } from '../../types'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Dialog } from '../ui/Dialog'
import { useToast } from '../ui/toast-context'
import { STATUS_TONE } from './display'

interface Props {
  occurrence: PlanOccurrence
  accounts: Account[]
  onClose: () => void
}

function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2).replace(/\.00$/, '')
}

/**
 * 明细里点开一期待发生 / 逾期的预算：「已发生」按这一期记一笔实际流水并关联；也可以跳过本期、只改本期计划金额。
 */
export function PlanOccurrenceDialog({ occurrence: o, accounts, onClose }: Props) {
  const toast = useToast()
  const { plan } = o
  const todayDate = today()
  const usable = accounts.filter((a) => !a.archived)
  const [amount, setAmount] = useState(() => centsToInput(o.amount))
  const [accountId, setAccountId] = useState<number | undefined>(plan.accountId ?? usable[0]?.id)
  const [date, setDate] = useState(o.date <= todayDate ? o.date : todayDate)
  const [error, setError] = useState('')
  const cents = parseAmountToCents(amount)

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

  return (
    <Dialog open title={`预算 · ${plan.name}`} onClose={onClose}>
      <form className="form" onSubmit={realize} aria-label="预算这一期">
        <p className="plan-occ-head t-body-s text-secondary">
          <Badge tone={STATUS_TONE[o.status]}>{PLAN_STATUS_LABELS[o.status]}</Badge> {o.date} · {repeatText(plan)} · 计划{' '}
          {plan.type === 'income' ? '收入' : '支出'} {formatCents(o.amount)}
        </p>
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
        {error && (
          <p className="form-error t-body-s" role="alert">
            {error}
          </p>
        )}
        <div className="manage-actions plan-occ-actions">
          <Button onClick={() => void skip()}>{o.status === 'skipped' ? '恢复本期' : '跳过本期'}</Button>
          <Button onClick={() => void saveAmount()} disabled={cents === null || cents === o.amount}>
            只改本期计划
          </Button>
          <Button type="submit" variant="primary">
            已发生，记一笔
          </Button>
        </div>
        <a className="link-button t-caption" href="#/budget?tab=plans" onClick={onClose}>
          管理预算账单
        </a>
      </form>
    </Dialog>
  )
}

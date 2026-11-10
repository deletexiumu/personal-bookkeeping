import { useLiveQuery } from 'dexie-react-hooks'
import { CalendarClock, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { db } from '../../db'
import { listLinked, listPlans, setOccurrenceSkipped, setTransactionPlan } from '../../db/plans'
import { formatMonth, monthOf, shiftDate, shiftMonth, today } from '../../lib/date'
import { formatCents } from '../../lib/money'
import { expandPlans, nextOccurrence, PLAN_STATUS_LABELS, planTotals, repeatText } from '../../lib/plans'
import type { Account, Category, Plan, Transaction } from '../../types'
import { CategoryIcon } from '../CategoryIcon'
import { ManageRow } from '../manage/ManageRow'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Dialog } from '../ui/Dialog'
import { diffText, STATUS_TONE } from './display'
import { PlanForm } from './PlanForm'

interface Props {
  categories: Category[]
  accounts: Account[]
}

const signed = (type: Plan['type'], cents: number) => `${type === 'income' ? '+' : '-'}${formatCents(cents)}`

/**
 * 预算页的「预算账单」：本月计划 / 已实现 / 待发生汇总，各条预算的周期、下一期和本月状态；
 * 点开看各期（计划 vs 实际），可跳过 / 恢复某一期、取消关联、编辑。
 */
export function PlanPanel({ categories, accounts }: Props) {
  const todayDate = today()
  const month = monthOf(todayDate)
  const plans = useLiveQuery(() => listPlans(db), [], [] as Plan[])
  const linked = useLiveQuery(() => listLinked(db), [], [] as Transaction[])
  const [editing, setEditing] = useState<Plan | 'new'>()
  const [openId, setOpenId] = useState<number>()
  const thisMonth = useMemo(() => expandPlans(plans, `${month}-01`, `${month}-31`, linked, todayDate), [plans, linked, month, todayDate])
  const expense = planTotals(thisMonth, 'expense')
  const income = planTotals(thisMonth, 'income')
  const categoryOf = (id: number | undefined) => categories.find((c) => c.id === id)
  const opened = plans.find((p) => p.id === openId)

  return (
    <>
      <section className="card plan-summary" aria-label="本月预算账单">
        <div>
          <h2 className="t-title-s">{formatMonth(month)}</h2>
          <p className="t-caption text-tertiary">预算账单不计入实际收支，导入或记一笔对上后转为实际</p>
        </div>
        <dl className="plan-kpis">
          <div>
            <dt className="t-caption text-secondary">计划支出</dt>
            <dd className="t-num-m">{formatCents(expense.planned)}</dd>
          </div>
          <div>
            <dt className="t-caption text-secondary">已实现</dt>
            <dd className="t-num-m">{formatCents(expense.actual)}</dd>
          </div>
          <div>
            <dt className="t-caption text-secondary">待发生</dt>
            <dd className={`t-num-m ${expense.overdue > 0 ? 'text-warning' : ''}`}>{formatCents(expense.open)}</dd>
          </div>
          <div>
            <dt className="t-caption text-secondary">计划收入</dt>
            <dd className="t-num-m">{formatCents(income.planned)}</dd>
          </div>
        </dl>
      </section>

      <div className="plan-toolbar">
        <h2 className="t-caption text-tertiary settings-group-title">预算账单 {plans.length}</h2>
        <Button size="sm" variant="primary" onClick={() => setEditing('new')}>
          <Plus size={16} aria-hidden="true" /> 新建
        </Button>
      </div>

      {plans.length === 0 ? (
        <div className="card empty-state">
          <CalendarClock size={40} aria-hidden="true" />
          <p className="t-body-m text-secondary">把房租、工资、保险这类计划中的收支记成预算账单，到期后导入的实际账单会自动对上。</p>
          <Button variant="primary" onClick={() => setEditing('new')}>
            新建预算账单
          </Button>
        </div>
      ) : (
        <ul className="card manage-list" aria-label="预算账单">
          {plans.map((p) => {
            const current = thisMonth.filter((o) => o.plan.id === p.id)
            const next = nextOccurrence(p, todayDate, linked)
            const state = current.length ? current.map((o) => PLAN_STATUS_LABELS[o.status]).join('、') : undefined
            return (
              <ManageRow
                key={p.id}
                label={`预算「${p.name}」`}
                icon={<CategoryIcon category={categoryOf(p.categoryId)} size={36} />}
                title={p.name}
                subtitle={[repeatText(p), state && `本月${state}`, next && `下一期 ${next.date.slice(5)}`].filter(Boolean).join(' · ')}
                value={<span className={`t-num-m ${p.type === 'income' ? 'amount-income' : 'amount-expense'}`}>{signed(p.type, p.amount)}</span>}
                onOpen={() => setOpenId(p.id)}
              />
            )
          })}
        </ul>
      )}

      {opened && (
        <Dialog open title={opened.name} onClose={() => setOpenId(undefined)}>
          <PlanHistory
            plan={opened}
            linked={linked}
            onEdit={() => {
              setOpenId(undefined)
              setEditing(opened)
            }}
          />
        </Dialog>
      )}
      {editing && (
        <Dialog open title={editing === 'new' ? '新建预算账单' : '编辑预算账单'} onClose={() => setEditing(undefined)}>
          <PlanForm
            plan={editing === 'new' ? undefined : editing}
            categories={categories}
            accounts={accounts}
            onDone={() => setEditing(undefined)}
          />
        </Dialog>
      )}
    </>
  )
}

/** 一条预算的各期：过去 12 个月到未来 3 个月，新的在上 */
function PlanHistory({ plan, linked, onEdit }: { plan: Plan; linked: Transaction[]; onEdit: () => void }) {
  const todayDate = today()
  const from = plan.startDate > shiftMonth(monthOf(todayDate), -12) ? plan.startDate : `${shiftMonth(monthOf(todayDate), -12)}-01`
  const to = shiftDate(`${shiftMonth(monthOf(todayDate), 3)}-01`, -1)
  const list = expandPlans([plan], from, to, linked, todayDate).reverse()
  const totals = planTotals(list, plan.type)

  return (
    <div className="plan-history">
      <p className="t-body-s text-secondary">
        {repeatText(plan)} · 每期 {formatCents(plan.amount)}
        {plan.keywords?.length ? ` · 关键字 ${plan.keywords.join('、')}` : ''}
      </p>
      <p className="t-caption text-tertiary">
        近期 {totals.done} 期已实现，计划 {formatCents(totals.planned - totals.open)}、实际 {formatCents(totals.actual)}
        {totals.overdue > 0 && `，${totals.overdue} 期逾期未发生`}
      </p>
      <ul className="plan-occurrences" aria-label="各期">
        {list.map((o) => (
          <li key={o.ref} className="plan-occurrence" data-status={o.status}>
            <span className="t-body-m">{o.date}</span>
            <Badge tone={STATUS_TONE[o.status]}>{PLAN_STATUS_LABELS[o.status]}</Badge>
            <span className="plan-occurrence-amounts t-caption text-secondary">
              计划 {formatCents(o.amount)}
              {o.status === 'done' && ` · 实际 ${formatCents(o.actual)} · ${diffText(o)}`}
            </span>
            <span className="plan-occurrence-actions">
              {(o.status === 'pending' || o.status === 'overdue') && (
                <button type="button" className="link-button t-caption" onClick={() => void setOccurrenceSkipped(db, plan.id!, o.date, true)}>
                  跳过
                </button>
              )}
              {o.status === 'skipped' && (
                <button type="button" className="link-button t-caption" onClick={() => void setOccurrenceSkipped(db, plan.id!, o.date, false)}>
                  恢复
                </button>
              )}
              {o.status === 'done' &&
                o.transactions.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className="link-button t-caption"
                    title={`${t.date} ${t.merchant ?? t.note ?? ''} ${formatCents(t.amount)}`}
                    onClick={() => void setTransactionPlan(db, t.id!, undefined)}
                  >
                    取消关联{o.transactions.length > 1 ? ` ${t.date.slice(5)}` : ''}
                  </button>
                ))}
            </span>
          </li>
        ))}
        {list.length === 0 && <li className="t-body-s text-tertiary">近期没有这条预算的期</li>}
      </ul>
      <div className="manage-actions">
        <Button variant="primary" onClick={onEdit}>
          编辑
        </Button>
      </div>
    </div>
  )
}

import { useLiveQuery } from 'dexie-react-hooks'
import { CalendarClock, CopyPlus, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useMediaQuery } from '../../app/useMediaQuery'
import { db } from '../../db'
import { copyOccurrences, deletePlan, listLinked, listPlans, setOccurrenceSkipped, setTransactionPlan, type PlanInput } from '../../db/plans'
import { formatMonth, monthOf, shiftDate, shiftMonth, today } from '../../lib/date'
import { formatCents } from '../../lib/money'
import { expandPlans, nextOccurrence, PLAN_STATUS_LABELS, planTotals, repeatText, type PlanOccurrence } from '../../lib/plans'
import type { Account, Category, Plan, Transaction } from '../../types'
import { CategoryIcon } from '../CategoryIcon'
import { ManageRow } from '../manage/ManageRow'
import { MonthSwitcher } from '../transactions/MonthSwitcher'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Dialog } from '../ui/Dialog'
import { Segmented } from '../ui/Segmented'
import { useToast } from '../ui/toast-context'
import { dayText, diffText, STATUS_TONE } from './display'
import { PlanCalendar } from './PlanCalendar'
import { PlanForm } from './PlanForm'
import { PlanOccurrenceDialog } from './PlanOccurrenceDialog'

interface Props {
  categories: Category[]
  accounts: Account[]
}

type View = 'calendar' | 'list'
const VIEW_KEY = 'taozhubu:plans-view'
const NARROW_QUERY = '(max-width: 767px)'

function savedView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'calendar'
  } catch {
    return 'calendar'
  }
}

const signed = (type: Plan['type'], cents: number) => `${type === 'income' ? '+' : '-'}${formatCents(cents)}`

/** 正在编辑的预算；draft 是新建时预填的内容（在日历上点了某一天） */
type Editing = { plan: Plan } | { draft: Partial<PlanInput> }

/**
 * 预算页的「预算账单」：所选月份的计划 / 已实现 / 待发生汇总，下面按日历或列表看。
 * - 日历：点日期直接在这天新建预算；点某条预算可复制到下一期、编辑、记为已发生；也可以把整个月复制到下一期
 * - 列表：所选月份里有期的各条预算，它们的周期、下一期和当月状态，点开看各期（计划 vs 实际），可跳过 / 恢复某一期、取消关联、编辑
 */
export function PlanPanel({ categories, accounts }: Props) {
  const toast = useToast()
  const compact = useMediaQuery(NARROW_QUERY)
  const todayDate = today()
  const [month, setMonth] = useState(() => monthOf(todayDate))
  const [view, setViewState] = useState<View>(savedView)
  const setView = (v: View) => {
    setViewState(v)
    try {
      localStorage.setItem(VIEW_KEY, v)
    } catch {
      // 存不了时只在本次生效
    }
  }
  const plans = useLiveQuery(() => listPlans(db), [], [] as Plan[])
  const linked = useLiveQuery(() => listLinked(db), [], [] as Transaction[])
  const [editing, setEditing] = useState<Editing>()
  const [openId, setOpenId] = useState<number>()
  const [openRef, setOpenRef] = useState<string>()
  const [openDay, setOpenDay] = useState<string>()
  const inMonth = useMemo(() => expandPlans(plans, `${month}-01`, `${month}-31`, linked, todayDate), [plans, linked, month, todayDate])
  const expense = planTotals(inMonth, 'expense')
  const income = planTotals(inMonth, 'income')
  const categoryOf = (id: number | undefined) => categories.find((c) => c.id === id)
  const opened = plans.find((p) => p.id === openId)
  const openedOccurrence = inMonth.find((o) => o.ref === openRef)
  const dayItems = openDay ? inMonth.filter((o) => o.date === openDay) : []
  const monthLabel = month === monthOf(todayDate) ? '本月' : `${Number(month.slice(5))}月`
  const copyable = inMonth.filter((o) => o.status !== 'skipped').length
  // 列表只列所选月份里有期的预算：复制出来的一次性预算会越攒越多，按月看才不乱
  const listed = plans.filter((p) => inMonth.some((o) => o.plan.id === p.id))

  const addOn = (date: string) => {
    setOpenDay(undefined)
    setEditing({ draft: { startDate: date, repeat: 'none' } })
  }
  const openOccurrence = (o: PlanOccurrence) => {
    setOpenDay(undefined)
    setOpenRef(o.ref)
  }

  async function copyMonth() {
    const { ids, existing } = await copyOccurrences(db, `${month}-01`, `${month}-31`, todayDate)
    if (ids.length === 0) {
      toast.show({ message: `${formatMonth(month)}的预算在下一期都已经有了` })
      return
    }
    toast.show({
      message: `已把 ${ids.length} 条预算复制到下一期${existing ? `，另有 ${existing} 条下一期已经有了` : ''}`,
      action: { label: '撤销', onClick: () => void Promise.all(ids.map((id) => deletePlan(db, id))) },
    })
    setMonth(shiftMonth(month, 1))
  }

  return (
    <>
      <section className="card plan-summary" aria-label={`${formatMonth(month)}预算账单`}>
        <div className="plan-summary-head">
          <MonthSwitcher month={month} onChange={setMonth} />
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
        <Segmented<View>
          label="日历或列表"
          value={view}
          onChange={setView}
          options={[
            { value: 'calendar', label: '日历' },
            { value: 'list', label: '列表' },
          ]}
        />
        <Button size="sm" variant="primary" onClick={() => setEditing({ draft: {} })}>
          <Plus size={16} aria-hidden="true" /> 新建
        </Button>
      </div>

      {view === 'calendar' ? (
        <>
          <PlanCalendar month={month} occurrences={inMonth} compact={compact} onAdd={addOn} onOpen={openOccurrence} onOpenDay={setOpenDay} />
          <div className="plan-calendar-foot">
            <p className="t-caption text-tertiary">点日期在这天新建预算；点已有的预算可以复制到下一期、编辑或记为已发生。</p>
            {copyable > 0 && (
              <Button size="sm" icon={<CopyPlus size={14} aria-hidden="true" />} onClick={() => void copyMonth()}>
                把{monthLabel}的 {copyable} 条都复制到下一期
              </Button>
            )}
          </div>
        </>
      ) : listed.length === 0 ? (
        <div className="card empty-state">
          <CalendarClock size={40} aria-hidden="true" />
          <p className="t-body-m text-secondary">
            {plans.length === 0
              ? '把房租、工资、保险这类计划中的收支记成预算账单，到期后导入的实际账单会自动对上。'
              : `${formatMonth(month)}没有预算账单，可以新建，或者回上个月把预算复制过来。`}
          </p>
          <Button variant="primary" onClick={() => setEditing({ draft: {} })}>
            新建预算账单
          </Button>
        </div>
      ) : (
        <ul className="card manage-list" aria-label="预算账单">
          {listed.map((p) => {
            const current = inMonth.filter((o) => o.plan.id === p.id)
            const next = nextOccurrence(p, todayDate, linked)
            const state = current.length ? current.map((o) => PLAN_STATUS_LABELS[o.status]).join('、') : undefined
            return (
              <ManageRow
                key={p.id}
                label={`预算「${p.name}」`}
                icon={<CategoryIcon category={categoryOf(p.categoryId)} size={36} />}
                title={p.name}
                subtitle={[repeatText(p), state && `${monthLabel}${state}`, next && `下一期 ${next.date.slice(5)}`].filter(Boolean).join(' · ')}
                value={<span className={`t-num-m ${p.type === 'income' ? 'amount-income' : 'amount-expense'}`}>{signed(p.type, p.amount)}</span>}
                onOpen={() => setOpenId(p.id)}
              />
            )
          })}
        </ul>
      )}

      {openDay && (
        <Dialog open title={`${dayText(openDay)}的预算`} onClose={() => setOpenDay(undefined)}>
          <div className="plan-day">
            <ul className="plan-day-list" aria-label={`${dayText(openDay)}的预算`}>
              {dayItems.map((o) => (
                <li key={o.ref}>
                  <button type="button" className="plan-day-row" onClick={() => openOccurrence(o)}>
                    <CategoryIcon category={categoryOf(o.plan.categoryId)} size={32} />
                    <span className="plan-day-name t-body-m">{o.plan.name}</span>
                    <Badge tone={STATUS_TONE[o.status]}>{PLAN_STATUS_LABELS[o.status]}</Badge>
                    <span className={`t-num-m ${o.plan.type === 'income' ? 'amount-income' : ''}`}>{signed(o.plan.type, o.amount)}</span>
                  </button>
                </li>
              ))}
            </ul>
            <Button variant="primary" icon={<Plus size={16} aria-hidden="true" />} onClick={() => addOn(openDay)}>
              在这天新建预算
            </Button>
          </div>
        </Dialog>
      )}
      {openedOccurrence && (
        <PlanOccurrenceDialog
          key={openedOccurrence.ref}
          occurrence={openedOccurrence}
          accounts={accounts}
          onClose={() => setOpenRef(undefined)}
          onEdit={(plan) => {
            setOpenRef(undefined)
            setEditing({ plan })
          }}
        />
      )}
      {opened && (
        <Dialog open title={opened.name} onClose={() => setOpenId(undefined)}>
          <PlanHistory
            plan={opened}
            linked={linked}
            onEdit={() => {
              setOpenId(undefined)
              setEditing({ plan: opened })
            }}
          />
        </Dialog>
      )}
      {editing && (
        <Dialog
          open
          title={'plan' in editing ? '编辑预算账单' : editing.draft.startDate ? `新建预算 · ${dayText(editing.draft.startDate)}` : '新建预算账单'}
          onClose={() => setEditing(undefined)}
        >
          <PlanForm
            plan={'plan' in editing ? editing.plan : undefined}
            draft={'draft' in editing ? editing.draft : undefined}
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

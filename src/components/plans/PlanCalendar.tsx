import { Check, Plus } from 'lucide-react'
import { today } from '../../lib/date'
import { PLAN_STATUS_LABELS, type PlanOccurrence } from '../../lib/plans'
import { compactCents, dayText } from './display'

interface Props {
  /** YYYY-MM */
  month: string
  /** 这个月的各期预算（含已实现、跳过的） */
  occurrences: PlanOccurrence[]
  /** 窄屏：格子里放不下可点的预算，点有预算的日期改为打开当天的列表 */
  compact: boolean
  /** 点日期的空白处：在这天新建预算 */
  onAdd: (date: string) => void
  /** 点某一期预算 */
  onOpen: (o: PlanOccurrence) => void
  /** 窄屏点有预算的日期 */
  onOpenDay: (date: string) => void
}

const WEEK = ['一', '二', '三', '四', '五', '六', '日']
/** 一天最多直接列几条，多的折成「+N」 */
const MAX_CHIPS = 3

const signed = (o: PlanOccurrence) => `${o.plan.type === 'income' ? '+' : '-'}${compactCents(o.amount)}`

/**
 * 预算日历：一周从周一开始，每天列出当天的预算（待发生虚线、逾期橙色、已实现打勾、跳过划掉）。
 * 点日期的空白处直接在这天新建预算，点某条预算打开它（复制到下一期、编辑、记为已发生）。
 * 窄屏的格子太小，点有预算的日期先列出当天的预算。
 */
export function PlanCalendar({ month, occurrences, compact, onAdd, onOpen, onOpenDay }: Props) {
  const [y, m] = month.split('-').map(Number)
  const days = new Date(y, m, 0).getDate()
  const lead = (new Date(y, m - 1, 1).getDay() + 6) % 7
  const todayDate = today()
  const byDate = new Map<string, PlanOccurrence[]>()
  for (const o of occurrences) byDate.set(o.date, [...(byDate.get(o.date) ?? []), o])

  return (
    <div className="card month-calendar plan-calendar" role="grid" aria-label={`${y}年${m}月预算日历`}>
      <div className="cal-week t-caption text-tertiary" role="row">
        {WEEK.map((w) => (
          <span key={w} role="columnheader">
            {w}
          </span>
        ))}
      </div>
      <div className="cal-days" role="rowgroup">
        {Array.from({ length: lead }, (_, i) => (
          <span key={`lead-${i}`} className="cal-day cal-day-empty" aria-hidden="true" />
        ))}
        {Array.from({ length: days }, (_, i) => {
          const date = `${month}-${String(i + 1).padStart(2, '0')}`
          const items = byDate.get(date) ?? []
          const openDay = compact && items.length > 0
          const shown = items.length > MAX_CHIPS ? items.slice(0, MAX_CHIPS - 1) : items
          return (
            <div key={date} role="gridcell" className="pcal-day" data-today={date === todayDate || undefined} data-has={items.length > 0 || undefined}>
              <button
                type="button"
                className="pcal-add"
                aria-label={openDay ? `${dayText(date)}，${items.length} 条预算，查看` : `${dayText(date)}，新建预算`}
                onClick={() => (openDay ? onOpenDay(date) : onAdd(date))}
              >
                <span className="pcal-num t-caption">{i + 1}</span>
                <Plus className="pcal-plus" size={14} aria-hidden="true" />
              </button>
              {shown.map((o) => {
                const label = `预算 ${o.plan.name} ${signed(o)}，${PLAN_STATUS_LABELS[o.status]}`
                const content = (
                  <>
                    {o.status === 'done' && <Check size={11} aria-hidden="true" />}
                    <span className="pcal-chip-name">{o.plan.name}</span>
                    <span className="pcal-chip-amount t-num-s">{signed(o)}</span>
                  </>
                )
                return compact ? (
                  <span key={o.ref} className="pcal-chip" data-status={o.status} data-type={o.plan.type}>
                    {content}
                  </span>
                ) : (
                  <button key={o.ref} type="button" className="pcal-chip" data-status={o.status} data-type={o.plan.type} aria-label={label} title={label} onClick={() => onOpen(o)}>
                    {content}
                  </button>
                )
              })}
              {items.length > shown.length &&
                (compact ? (
                  <span className="pcal-more t-caption">+{items.length - shown.length}</span>
                ) : (
                  <button type="button" className="pcal-more t-caption" onClick={() => onOpenDay(date)} aria-label={`${dayText(date)}还有 ${items.length - shown.length} 条预算`}>
                    +{items.length - shown.length} 条
                  </button>
                ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}

import type { PlanOccurrence } from '../../lib/plans'
import { formatCents } from '../../lib/money'
import { repeatText } from '../../lib/plans'
import { CategoryIcon } from '../CategoryIcon'
import type { Lookup } from '../transactions/display'
import { Badge } from '../ui/Badge'

interface Props {
  occurrence: PlanOccurrence
  lookup: Lookup
  onOpen: (o: PlanOccurrence) => void
}

const planAmount = (o: PlanOccurrence) => `预 ${o.plan.type === 'income' ? '+' : '-'}${formatCents(o.amount)}`
const label = (o: PlanOccurrence) => (o.status === 'overdue' ? '逾期' : '预算')

/** 明细列表里一期还没发生的预算：虚线边框、灰色金额，不计入当天合计 */
export function PlanListRow({ occurrence: o, lookup, onOpen }: Props) {
  return (
    <li className="tx-row plan-row" data-status={o.status}>
      <button type="button" className="tx-open" onClick={() => onOpen(o)} aria-label={`预算 ${o.plan.name} ${planAmount(o)}，${label(o)}`}>
        <CategoryIcon category={lookup.category(o.plan.categoryId)} />
        <span className="tx-main">
          <span className="t-body-m-strong plan-row-title">
            {o.plan.name} <Badge tone={o.status === 'overdue' ? 'warning' : 'neutral'}>{label(o)}</Badge>
          </span>
          <span className="t-caption text-tertiary tx-sub">{repeatText(o.plan)}</span>
        </span>
        <span className="tx-side">
          <span className="t-num-m plan-amount">{planAmount(o)}</span>
          <span className="t-caption text-tertiary">{o.status === 'overdue' ? '还没对上实际' : '待发生'}</span>
        </span>
      </button>
    </li>
  )
}

/** 明细表格里的预算行 */
export function PlanTableRow({ occurrence: o, lookup, onOpen }: Props) {
  return (
    <tr
      className="plan-row"
      data-status={o.status}
      tabIndex={0}
      onClick={() => onOpen(o)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen(o)
        }
      }}
    >
      <td className="t-num-s text-secondary nowrap">{o.date.slice(5)}</td>
      <td>
        <span className="tx-table-category">
          <CategoryIcon category={lookup.category(o.plan.categoryId)} size={28} />
          {o.plan.name}
        </span>
      </td>
      <td className="tx-table-note text-tertiary">{repeatText(o.plan)}</td>
      <td className="text-secondary nowrap">{o.plan.accountId !== undefined ? (lookup.account(o.plan.accountId)?.name ?? '') : ''}</td>
      <td>
        <Badge tone={o.status === 'overdue' ? 'warning' : 'neutral'}>{label(o)}</Badge>
      </td>
      <td className="num t-num-m plan-amount">{planAmount(o)}</td>
    </tr>
  )
}

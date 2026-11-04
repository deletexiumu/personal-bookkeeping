import { PageHeader } from '../components/layout/AppShell'
import { Badge } from '../components/ui/Badge'
import { SIDEBAR_ITEMS } from '../app/nav'
import type { RouteName } from '../app/router'
import { PLANNED_PAGES } from './planned'

/** 尚未实现的一级页面：说明所属里程碑和计划能力，见 docs/web-roadmap.md */
export function PlaceholderPage({ route }: { route: Exclude<RouteName, 'transactions' | 'settings' | 'accounts' | 'categories'> }) {
  const plan = PLANNED_PAGES[route]
  const Icon = SIDEBAR_ITEMS.find((item) => item.route === route)?.icon
  return (
    <div className="page">
      <PageHeader title={plan.title} />
      <section className="card placeholder">
        {Icon && (
          <span className="placeholder-icon" aria-hidden="true">
            <Icon size={28} />
          </span>
        )}
        <div className="placeholder-head">
          <h2 className="t-title-m">即将推出</h2>
          <Badge tone="brand">{plan.milestone}</Badge>
        </div>
        <p className="t-body-m text-secondary">{plan.summary}</p>
        <ul className="placeholder-list t-body-s">
          {plan.features.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      </section>
    </div>
  )
}

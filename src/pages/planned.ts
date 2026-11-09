import type { RouteName } from '../app/router'

export interface PlannedPage {
  title: string
  milestone: string
  summary: string
  features: string[]
}

/** 未实现页面的计划说明，与 docs/web-roadmap.md 保持一致 */
export const PLANNED_PAGES: Record<Exclude<RouteName, 'transactions' | 'analysis' | 'settings' | 'accounts' | 'categories' | 'budget' | 'import' | 'rules' | 'tags' | 'login'>, PlannedPage> = {
  api: {
    title: '开放接口',
    milestone: '规划中',
    summary: '通过 REST API 读写账本，接入 iOS 快捷指令、脚本或自动化平台。需要先完成自托管同步服务。',
    features: ['访问令牌（只在创建时显示一次，可随时撤销）', 'Webhook：transaction.created、import.completed、budget.exceeded', '调用示例：curl / Python / 快捷指令'],
  },
}

import type { RouteName } from '../app/router'

export interface PlannedPage {
  title: string
  milestone: string
  summary: string
  features: string[]
}

/** 未实现页面的计划说明，与 docs/web-roadmap.md 保持一致 */
export const PLANNED_PAGES: Record<Exclude<RouteName, 'transactions' | 'settings' | 'accounts' | 'categories' | 'budget' | 'import' | 'rules'>, PlannedPage> = {
  analysis: {
    title: '分析',
    milestone: 'W5',
    summary: '看得懂的分析：趋势、构成、预算、排行四个视角，所有图表都能下钻到对应流水。',
    features: [
      '周 / 月 / 年 / 自定义区间，KPI 与上一期对比',
      '收支趋势柱状图、支出构成环形图',
      '商户 / 标签 / 账户排行与预算执行',
      '点击图表跳转到带筛选条件的明细',
    ],
  },
  api: {
    title: '开放接口',
    milestone: '规划中',
    summary: '通过 REST API 读写账本，接入 iOS 快捷指令、脚本或自动化平台。需要先完成自托管同步服务。',
    features: ['访问令牌（只在创建时显示一次，可随时撤销）', 'Webhook：transaction.created、import.completed、budget.exceeded', '调用示例：curl / Python / 快捷指令'],
  },
}

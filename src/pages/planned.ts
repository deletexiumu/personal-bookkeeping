import type { RouteName } from '../app/router'

export interface PlannedPage {
  title: string
  milestone: string
  summary: string
  features: string[]
}

/** 未实现页面的计划说明，与 docs/web-roadmap.md 保持一致 */
export const PLANNED_PAGES: Record<Exclude<RouteName, 'transactions' | 'settings'>, PlannedPage> = {
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
  import: {
    title: '导入',
    milestone: 'W4',
    summary: '把账单交给我：自动识别格式、字段映射、去重、智能分类，确认后才入账。',
    features: [
      '微信账单（xlsx / csv）、支付宝账单（csv）',
      '通用 CSV 字段映射，可保存为模板',
      '疑似重复默认不勾选，待分类可「记住」为规则',
      '导入记录可整批撤销；JSON 备份恢复',
    ],
  },
  budget: {
    title: '预算',
    milestone: 'W3',
    summary: '按月设置总预算和分类预算，超支提前提醒。',
    features: ['总预算 + 分类预算', '明细汇总卡显示预算进度：超过 80% 变橙、超过 100% 变红', '超支分类在统计中置顶标红'],
  },
  accounts: {
    title: '账户',
    milestone: 'W3',
    summary: '管理现金、银行卡、支付宝、微信等账户，查看余额。',
    features: ['新增、编辑、归档账户', '初始余额与余额计算', '账户间转账（W2 记一笔支持转账模式）'],
  },
  rules: {
    title: '规则',
    milestone: 'W4',
    summary: '自动分类规则：按商户、备注关键词把导入的流水归到对应分类。',
    features: ['匹配字段 + 匹配方式 + 关键词 → 目标分类', '规则优先级', '导入预览中改分类时一键生成规则'],
  },
  api: {
    title: '开放接口',
    milestone: '规划中',
    summary: '通过 REST API 读写账本，接入 iOS 快捷指令、脚本或自动化平台。需要先完成自托管同步服务。',
    features: ['访问令牌（只在创建时显示一次，可随时撤销）', 'Webhook：transaction.created、import.completed、budget.exceeded', '调用示例：curl / Python / 快捷指令'],
  },
}

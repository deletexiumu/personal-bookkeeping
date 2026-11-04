import type { AccountType, ImportSource } from '../../types'
import type { FieldKey } from './fields'
import type { ColumnMapping } from './table'

/** 内置账单模板：命中后跳过字段映射，直接进入预览 */
export interface BuiltinTemplate {
  id: 'wechat' | 'alipay' | 'alipay-legacy'
  name: string
  source: ImportSource
  /** 默认入账账户的类型 */
  accountType: AccountType
  /** 表头必须包含的列 */
  required: string[]
  columns: Record<string, FieldKey>
}

export const BUILTIN_TEMPLATES: BuiltinTemplate[] = [
  {
    id: 'wechat',
    name: '微信账单',
    source: 'wechat',
    accountType: 'wechat',
    required: ['交易时间', '交易类型', '交易对方', '收/支', '当前状态'],
    columns: {
      交易时间: 'date',
      交易类型: 'kind',
      交易对方: 'merchant',
      商品: 'note',
      '收/支': 'direction',
      '金额(元)': 'amount',
      金额: 'amount',
      支付方式: 'account',
      当前状态: 'status',
      交易单号: 'ref',
      备注: 'note',
    },
  },
  {
    id: 'alipay',
    name: '支付宝账单',
    source: 'alipay',
    accountType: 'alipay',
    required: ['交易时间', '交易对方', '收/支', '交易状态', '交易订单号'],
    columns: {
      交易时间: 'date',
      交易分类: 'category',
      交易对方: 'merchant',
      商品说明: 'note',
      '收/支': 'direction',
      金额: 'amount',
      '收/付款方式': 'account',
      交易状态: 'status',
      交易订单号: 'ref',
      备注: 'note',
    },
  },
  {
    // 旧版「交易记录明细查询」：收/支列常为空，用「资金状态」判断方向
    id: 'alipay-legacy',
    name: '支付宝账单',
    source: 'alipay',
    accountType: 'alipay',
    required: ['交易号', '交易创建时间', '交易对方', '资金状态'],
    columns: {
      交易号: 'ref',
      交易创建时间: 'date',
      类型: 'kind',
      交易对方: 'merchant',
      商品名称: 'note',
      '金额（元）': 'amount',
      '金额(元)': 'amount',
      交易状态: 'status',
      备注: 'note',
      资金状态: 'direction',
    },
  },
]

const clean = (s: string) => s.replace(/\s/g, '')

/** 在文件中找内置模板：表头行包含模板必需的列 */
export function detectTemplate(lines: string[][]): { template: BuiltinTemplate; headerRow: number } | undefined {
  for (let i = 0; i < Math.min(lines.length, 40); i++) {
    const headers = new Set(lines[i].map(clean))
    const template = BUILTIN_TEMPLATES.find((t) => t.required.every((h) => headers.has(h)))
    if (template) return { template, headerRow: i }
  }
  return undefined
}

/** 按模板映射表头；模板没列出的列忽略 */
export function templateMapping(template: BuiltinTemplate, headers: string[]): ColumnMapping[] {
  const used = new Set<FieldKey>()
  return headers.map((h) => {
    const field = template.columns[clean(h)]
    if (!field || (used.has(field) && field !== 'note')) return { field: 'ignore', status: 'skip' }
    used.add(field)
    return { field, status: 'matched' }
  })
}

/** 第三方账单的分类名 → 默认分类名（支付宝「交易分类」等） */
export const CATEGORY_ALIASES: Record<string, string> = {
  餐饮美食: '餐饮',
  交通出行: '交通',
  爱车养车: '交通',
  日用百货: '购物',
  服饰装扮: '购物',
  数码电器: '购物',
  家居家装: '购物',
  美容美发: '购物',
  母婴亲子: '购物',
  宠物: '购物',
  住房物业: '居住',
  充值缴费: '居住',
  文化休闲: '娱乐',
  运动户外: '娱乐',
  酒店旅游: '娱乐',
  医疗健康: '医疗',
  投资理财: '理财',
  收入: '其他收入',
}

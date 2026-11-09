import type { AccountType, ImportSource } from '../../types'
import type { FieldKey } from './fields'
import type { ColumnMapping } from './table'

/** 内置账单模板：命中后跳过字段映射，直接进入预览 */
export interface BuiltinTemplate {
  id: 'wechat' | 'alipay' | 'alipay-legacy' | 'douyin' | 'cmb' | 'citic'
  name: string
  source: ImportSource
  /** 默认入账账户的类型 */
  accountType: AccountType
  /** 默认入账账户名里含这些字时优先（如「抖音」） */
  accountHint?: RegExp
  /** 表头必须包含的列 */
  required: string[]
  columns: Record<string, FieldKey>
  /** 按列清洗单元格（键为去掉空白的表头） */
  clean?: Record<string, (value: string) => string>
  /** 银行流水：对方是本人（户名相同）的标为「本人账户互转」，默认不入账 */
  selfTransfer?: boolean
}

/** 银行流水的对手信息常是「户名 + 账号」，去掉末尾账号；只有账号时清空 */
export function stripAccountNo(value: string): string {
  const text = value.trim()
  if (/^\d{6,}$/.test(text)) return ''
  return text.replace(/\s+\d{6,}$/, '').trim()
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
      商品: 'goods',
      '收/支': 'direction',
      '金额(元)': 'amount',
      金额: 'amount',
      支付方式: 'account',
      当前状态: 'status',
      交易单号: 'ref',
      商户单号: 'merchantRef',
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
      商品说明: 'goods',
      '收/支': 'direction',
      金额: 'amount',
      '收/付款方式': 'account',
      交易状态: 'status',
      交易订单号: 'ref',
      商家订单号: 'merchantRef',
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
      商户订单号: 'merchantRef',
      交易创建时间: 'date',
      类型: 'kind',
      交易对方: 'merchant',
      商品名称: 'goods',
      '金额（元）': 'amount',
      '金额(元)': 'amount',
      交易状态: 'status',
      备注: 'note',
      资金状态: 'direction',
    },
  },
  {
    id: 'douyin',
    name: '抖音支付账单',
    source: 'douyin',
    accountType: 'other',
    accountHint: /抖音/,
    required: ['交易时间', '收/支/其他', '交易单号', '交易对方'],
    columns: {
      交易时间: 'date',
      '收/支/其他': 'direction',
      '金额（元）': 'amount',
      '金额(元)': 'amount',
      '收/付款方式': 'account',
      交易单号: 'ref',
      商家单号: 'merchantRef',
      商户单号: 'merchantRef',
      交易对方: 'merchant',
      商品: 'goods',
      备注: 'note',
    },
    // 退款行的「收/付款方式」写的是「退款」，不是账户
    clean: { '收/付款方式': (v) => (v.trim() === '退款' ? '' : v) },
  },
  {
    // 招商银行 App「交易流水」PDF
    id: 'cmb',
    name: '招商银行流水',
    source: 'bank',
    accountType: 'debit',
    accountHint: /招商|招行/,
    required: ['记账日期', '交易金额', '交易摘要', '对手信息'],
    columns: {
      记账日期: 'date',
      交易金额: 'amount',
      交易摘要: 'note',
      对手信息: 'merchant',
    },
    clean: { 对手信息: stripAccountNo },
    selfTransfer: true,
  },
  {
    // 中信银行「个人账户明细证明书」PDF
    id: 'citic',
    name: '中信银行流水',
    source: 'bank',
    accountType: 'debit',
    accountHint: /中信/,
    required: ['交易日期', '收入金额', '支出金额', '交易摘要', '对方户名'],
    columns: {
      交易日期: 'date',
      收入金额: 'income',
      支出金额: 'expense',
      交易摘要: 'note',
      对方户名: 'merchant',
    },
    selfTransfer: true,
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
  退款: '其他收入',
}

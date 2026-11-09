/** 文件列可以映射到的目标字段 */
export type FieldKey =
  | 'ignore'
  | 'date'
  | 'time'
  | 'amount'
  | 'expense'
  | 'income'
  | 'direction'
  | 'merchant'
  | 'note'
  | 'goods'
  | 'category'
  | 'account'
  | 'status'
  | 'ref'
  | 'merchantRef'
  | 'kind'

export const FIELD_LABELS: Record<FieldKey, string> = {
  ignore: '忽略此列',
  date: '日期（可含时间）',
  time: '时间',
  amount: '金额（带正负）',
  expense: '支出金额',
  income: '收入金额',
  direction: '收支方向',
  merchant: '商户 / 交易对方',
  note: '备注 / 摘要',
  goods: '商品说明',
  category: '分类',
  account: '账户',
  status: '交易状态',
  ref: '交易单号 / 订单号',
  merchantRef: '商户单号',
  kind: '交易类型（仅用于分类）',
}

export const FIELD_ORDER: FieldKey[] = [
  'date',
  'time',
  'amount',
  'expense',
  'income',
  'direction',
  'merchant',
  'note',
  'goods',
  'category',
  'account',
  'status',
  'ref',
  'merchantRef',
  'kind',
  'ignore',
]

/** 可以映射多列的字段，多列内容用「 · 」拼接 */
export const MULTI_FIELDS: ReadonlySet<FieldKey> = new Set(['note'])

/**
 * 表头关键词。按顺序匹配，先命中的字段优先；同一字段只取第一列（备注除外）。
 * 「时间」类表头要结合示例值判断是日期时间还是纯时间，见 autoMap。
 */
export const HEADER_KEYWORDS: [FieldKey, RegExp][] = [
  // 商户单号要在交易单号前面认，否则「商户单号」「商家订单号」会被当成交易单号
  ['merchantRef', /商(户|家)(订)?单号/],
  ['goods', /^商品(说明|名称|描述)?$/],
  ['ref', /(交易|订单|流水|商户)单?号|流水号|订单号|交易号/],
  ['direction', /^收\/支$|收支|借贷|资金流向|收付|方向/],
  ['expense', /支出(金额)?|借方(金额|发生额)?/],
  ['income', /收入(金额)?|贷方(金额|发生额)?/],
  ['amount', /金额|发生额|交易额|amount/i],
  ['date', /日期|date/i],
  ['time', /时间|time/i],
  ['merchant', /商户|商家|交易对方|对方(户名|账户名|名称)?|收款方|付款方|payee|merchant/i],
  ['category', /分类|类别|类目|category/i],
  ['account', /账户|支付方式|付款方式|收\/付款方式|卡号|account/i],
  ['status', /状态|status/i],
  ['note', /备注|摘要|说明|商品|用途|描述|附言|交易类型|memo|note|description/i],
]

export function matchHeader(header: string): FieldKey | undefined {
  const text = header.trim()
  if (text === '' || text.length > 24) return undefined
  return HEADER_KEYWORDS.find(([, re]) => re.test(text))?.[0]
}

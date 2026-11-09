import { describe, expect, it } from 'vitest'
import type { Category } from '../../types'
import { accountByCardTail, buildPreview, cardTail, matchAccount } from './preview'
import { sniffFile, sniffText } from './sniff'
import { parseRows } from './table'
import { makeXlsx, makeZip } from './testZip'
import { excelSerialToText, isZip, readXlsx } from './xlsx'

/** 按公开的微信支付账单格式构造：前 16 行说明 */
const WECHAT_ROWS = [
  ['微信支付账单明细'],
  ['微信昵称：[某某]'],
  ['起始时间：[2026-10-01 00:00:00] 终止时间：[2026-10-31 23:59:59]'],
  ['导出类型：[全部]'],
  ['导出时间：[2026-11-01 10:00:00]'],
  [''],
  ['共128笔记录'],
  ['收入：3笔 88.00元'],
  ['支出：120笔 3000.00元'],
  ['中性交易：5笔 500.00元'],
  ['注：'],
  ['1. 充值/提现/理财通购买/零钱通存取/信用卡还款等交易，将计入中性交易'],
  ['2. 本明细仅展示当前账单中的交易，不包括已删除的记录'],
  ['3. 本明细仅供个人对账使用'],
  [''],
  ['----------------------微信支付账单明细列表--------------------'],
  ['交易时间', '交易类型', '交易对方', '商品', '收/支', '金额(元)', '支付方式', '当前状态', '交易单号', '商户单号', '备注'],
  ['=日期:46326.50555555556', '商户消费', '美团外卖', '美团订单-3381', '支出', '¥36.50', '零钱', '支付成功', '4200001', '10001', '/'],
  ['2026-10-30 09:12:00', '商户消费', '星巴克', '/', '支出', '¥38.00', '招商银行信用卡(1234)', '支付成功', '4200002', '10002', '/'],
  ['2026-10-28 20:40:00', '转账', '张三', '转账备注:微信转账', '支出', '¥200.00', '零钱', '对方已收钱', '4200003', '/', '/'],
  ['2026-10-27 08:00:00', '零钱充值', '招商银行(1234)', '/', '/', '¥500.00', '招商银行(1234)', '充值完成', '4200004', '/', '/'],
  ['2026-10-26 18:00:00', '微信红包', '李四', '/', '收入', '¥88.00', '/', '已存入零钱', '4200005', '/', '/'],
]

/** 按公开的支付宝交易流水格式构造（GBK 编码 CSV，前若干行说明） */
const ALIPAY_CSV = [
  '------------------------------------------------------------------------------------',
  '导出信息：',
  '姓名：某某',
  '支付宝账户：xxx@example.com',
  '起始时间：[2026-10-01 00:00:00]    终止时间：[2026-10-31 23:59:59]',
  '------------------------支付宝（中国）网络技术有限公司  电子客户回单------------------------',
  '交易时间,交易分类,交易对方,对方账号,商品说明,收/支,金额,收/付款方式,交易状态,交易订单号,商家订单号,备注,',
  '2026-10-31 12:00:00,餐饮美食,肯德基,kfc***@x.com,宅急送订单,支出,45.00,花呗,交易成功,2026103122001\t,T001\t,,',
  '2026-10-30 10:00:00,日用百货,盒马,hema***@x.com,盒马鲜生,支出,128.50,招商银行储蓄卡(5678),交易成功,2026103022002\t,T002\t,,',
  '2026-10-29 09:00:00,投资理财,余额宝,,余额宝-收益发放,不计收支,1.23,余额宝,交易成功,2026102922003\t,,,',
  '2026-10-28 15:00:00,日用百货,淘宝商家,tb***@x.com,订单已取消,支出,59.00,花呗,交易关闭,2026102822004\t,T004\t,,',
  '2026-10-27 18:00:00,退款,盒马,/,退款-盒马鲜生,不计收支,12.50,余额宝,退款成功,2026103022002*R005\t,R005\t,,',
].join('\r\n')

/** 把字符串按 GBK 编码（仅测试用）：TextEncoder 只支持 UTF-8，这里由 GBK 解码表反查 */
function gbk(text: string): Uint8Array {
  const decoder = new TextDecoder('gbk')
  const table = new Map<string, number[]>()
  for (let hi = 0x81; hi <= 0xfe; hi++) {
    for (let lo = 0x40; lo <= 0xfe; lo++) {
      if (lo === 0x7f) continue
      const ch = decoder.decode(new Uint8Array([hi, lo]))
      if (ch.length === 1 && !table.has(ch)) table.set(ch, [hi, lo])
    }
  }
  const out: number[] = []
  for (const ch of text) {
    const code = ch.codePointAt(0)!
    if (code < 0x80) out.push(code)
    else out.push(...(table.get(ch) ?? [0x3f]))
  }
  return new Uint8Array(out)
}

const categories: Category[] = [
  { id: 1, name: '餐饮', type: 'expense' },
  { id: 3, name: '购物', type: 'expense' },
  { id: 10, name: '理财', type: 'income' },
]
const accounts = [
  { id: 1, name: '现金', type: 'cash' as const },
  { id: 2, name: '招商信用卡', type: 'credit' as const },
  { id: 3, name: '支付宝', type: 'alipay' as const },
  { id: 4, name: '微信', type: 'wechat' as const },
]

describe('readXlsx', () => {
  it('读取共享字符串、数字和日期格式的单元格，保留行号', async () => {
    const bytes = await makeXlsx([['标题'], [], ['日期', '金额'], ['=日期:46326.5', '12.5']])
    expect(isZip(bytes)).toBe(true)
    expect(await readXlsx(bytes)).toEqual([['标题'], [], ['日期', '金额'], ['2026-10-31 12:00:00', '12.5']])
  })

  it('支持不压缩的条目', async () => {
    const bytes = await makeXlsx([['a', 'b']], false)
    expect(await readXlsx(bytes)).toEqual([['a', 'b']])
  })

  it('不是 xlsx 时报错', async () => {
    await expect(readXlsx(await makeZip({ 'a.txt': 'x' }))).rejects.toThrow('没有工作表')
    await expect(readXlsx(new Uint8Array([1, 2, 3]))).rejects.toThrow('不是有效的 xlsx 文件')
  })

  it('Excel 日期序列号', () => {
    expect(excelSerialToText(46326)).toBe('2026-10-31')
    expect(excelSerialToText(46326.75)).toBe('2026-10-31 18:00:00')
  })
})

describe('微信账单模板', () => {
  it('xlsx 命中模板，按模板映射并识别中性交易', async () => {
    const sniff = await sniffFile(await makeXlsx(WECHAT_ROWS))
    expect(sniff.format).toBe('xlsx')
    expect(sniff.template?.id).toBe('wechat')
    expect(sniff.table.headerRow).toBe(16)
    expect(sniff.mapping.map((m) => m.field)).toEqual([
      'date', 'kind', 'merchant', 'goods', 'direction', 'amount', 'account', 'status', 'ref', 'merchantRef', 'note',
    ])
    const { rows, errors } = parseRows(sniff.table, sniff.mapping)
    expect(errors).toEqual([])
    expect(rows[0]).toEqual({
      line: 18,
      date: '2026-10-31',
      time: '12:08',
      type: 'expense',
      amount: 3650,
      merchant: '美团外卖',
      note: '美团订单-3381',
      goods: '美团订单-3381',
      accountName: '零钱',
      ref: '4200001',
      merchantRef: '10001',
      kind: '商户消费',
    })
    expect(rows[1].note).toBeUndefined()
    expect(rows[3]).toMatchObject({ skipReason: '不计收支' })
    expect(rows[4]).toMatchObject({ type: 'income', amount: 8800 })
    expect(rows[4].accountName).toBeUndefined()
  })

  it('CSV 版同样命中', () => {
    const csv = WECHAT_ROWS.map((r) => r.map((c) => c.replace('=日期:46326.50555555556', '2026-10-31 12:08:00')).join(',')).join('\n')
    expect(sniffText(new TextEncoder().encode(csv)).template?.id).toBe('wechat')
  })

  it('零钱对应微信账户，银行卡按银行名、名称或默认账户', async () => {
    const sniff = await sniffFile(await makeXlsx(WECHAT_ROWS))
    const items = buildPreview(parseRows(sniff.table, sniff.mapping).rows, {
      categories,
      merchantHistory: new Map(),
      accounts,
      defaultAccountId: 4,
      existing: [],
    })
    // 「招商银行信用卡(1234)」「招商银行(1234)」按银行名对应到唯一的招商账户「招商信用卡」
    expect(items.map((i) => i.accountId)).toEqual([4, 2, 4, 2, 4])
    expect(matchAccount('招商银行信用卡(1234)', [...accounts, { id: 5, name: '招商银行信用卡', type: 'credit' }], 4)).toBe(5)
    expect(items.map((i) => i.selected)).toEqual([true, true, true, false, true])
    // 交易类型「微信红包」用于分类：红包收入归为其他收入
    const withRedPacket = buildPreview(parseRows(sniff.table, sniff.mapping).rows, {
      categories: [...categories, { id: 11, name: '其他收入', type: 'income' }],
      merchantHistory: new Map(),
      accounts,
      defaultAccountId: 4,
      existing: [],
    })
    expect(withRedPacket[4]).toMatchObject({ categoryId: 11, categorySource: 'keyword' })
  })
})

describe('支付宝账单模板', () => {
  it('GBK CSV 命中模板，交易分类按别名归类，交易关闭和不计收支默认忽略，退款记为收入', () => {
    const sniff = sniffText(gbk(ALIPAY_CSV))
    expect(sniff.format).toBe('gbk')
    expect(sniff.template?.id).toBe('alipay')
    const { rows } = parseRows(sniff.table, sniff.mapping)
    expect(rows.map((r) => [r.merchant, r.type, r.amount, r.ref, r.skipReason])).toEqual([
      ['肯德基', 'expense', 4500, '2026103122001', undefined],
      ['盒马', 'expense', 12850, '2026103022002', undefined],
      ['余额宝', 'income', 123, '2026102922003', '不计收支'],
      ['淘宝商家', 'expense', 5900, '2026102822004', '交易关闭'],
      ['盒马', 'income', 1250, '2026103022002*R005', undefined],
    ])
    // 商品说明、商家订单号单独解析；匹配用的说明文字仍含商品说明
    expect(rows[0]).toMatchObject({ goods: '宅急送订单', note: '宅急送订单', merchantRef: 'T001', accountName: '花呗' })
    const withOther: Category[] = [...categories, { id: 11, name: '其他收入', type: 'income' }]
    const items = buildPreview(rows, { categories: withOther, merchantHistory: new Map(), accounts, defaultAccountId: 3, existing: [] })
    expect(items.map((i) => i.categoryId)).toEqual([1, 3, 10, 3, 11])
    expect(items.map((i) => i.categorySource)).toEqual(['file', 'file', 'file', 'file', 'file'])
    // 花呗、余额宝对应支付宝账户
    expect(items.map((i) => i.accountId)).toEqual([3, 3, 3, 3, 3])
    // 退款默认勾选
    expect(items.map((i) => i.selected)).toEqual([true, true, false, false, true])
  })

  it('花呗、信用卡还款（不计收支）按支出入账，还款的退款按收入', () => {
    const csv = ALIPAY_CSV.split('\r\n')
      .slice(0, 7)
      .concat([
        '2026-10-15 10:00:00,信用借还,花呗,/,花呗主动还款-2026年10月账单,不计收支,1503.41,招商银行储蓄卡(5678),还款成功,2026101522006\t,,,',
        '2026-10-16 10:00:00,信用借还,浦发银行,/,信用卡还款,不计收支,1200.00,余额宝,还款成功,2026101622007\t,,,',
        '2026-10-17 10:00:00,退款,中国工商银行,/,退款-信用卡还款,不计收支,300.00,余额宝,退款成功,2026101722008\t,,,',
      ])
      .join('\r\n')
    const sniff = sniffText(gbk(csv))
    const { rows } = parseRows(sniff.table, sniff.mapping)
    expect(rows.map((r) => [r.merchant, r.type, r.amount, r.skipReason])).toEqual([
      ['花呗', 'expense', 150341, undefined],
      ['浦发银行', 'expense', 120000, undefined],
      ['中国工商银行', 'income', 30000, undefined],
    ])
  })

  it('旧版交易记录明细按资金状态判断方向', () => {
    const csv = [
      '支付宝交易记录明细查询',
      '账号:[xxx]',
      '交易号,商家订单号,交易创建时间,付款时间,最近修改时间,交易来源地,类型,交易对方,商品名称,金额（元）,收/支,交易状态,服务费（元）,成功退款（元）,备注,资金状态,',
      '2026103122001,T1,2026-10-31 12:00:00,2026-10-31 12:00:01,2026-10-31 12:00:01,其他（包括阿里巴巴和外部商家）,即时到账交易,肯德基,宅急送,45.00,支出,交易成功,0.00,0.00,,已支出,',
      '2026103022002,,2026-10-30 08:00:00,,2026-10-30 08:00:00,支付宝网站,即时到账交易,余额宝,转入,100.00,,交易成功,0.00,0.00,,资金转移,',
    ].join('\n')
    const sniff = sniffText(new TextEncoder().encode(csv))
    expect(sniff.template?.id).toBe('alipay-legacy')
    const { rows } = parseRows(sniff.table, sniff.mapping)
    expect(rows.map((r) => [r.type, r.amount, r.skipReason])).toEqual([
      ['expense', 4500, undefined],
      ['income', 10000, '不计收支'],
    ])
  })
})

describe('抖音支付账单模板', () => {
  /** 按抖音支付「交易流水」CSV 的版式构造（UTF-8 BOM，前若干行说明，数据为虚构） */
  const DOUYIN_CSV = [
    '\ufeff抖音支付交易流水',
    '账户,张三',
    '交易时间段,2026-01-01 00:00:00 至 2026-06-30 23:59:59',
    '交易笔数,4',
    '',
    '交易时间,收/支/其他,金额（元）,收/付款方式,交易单号,交易对方,商家单号',
    '2026-06-30 14:27:02,支出,108.00,抖音月付,2105000000000000001,抖音电商,ONP0001',
    '2026-06-20 03:13:36,支出,15.00,招商银行借记卡（5566）,2100000000000000002,Apple 服务,MMQH04',
    '2026-05-29 22:46:44,收入,32.90,退款,2105000000000000003,抖音生活服务,ONP0003',
    '2026-05-01 10:00:00,其他,50.00,抖音月付,2105000000000000004,抖音月付,ONP0004',
  ].join('\r\n')

  it('命中模板：收/支/其他判断方向，「其他」不计收支，退款行的付款方式不当账户', () => {
    const sniff = sniffText(new TextEncoder().encode(DOUYIN_CSV))
    expect(sniff.template?.id).toBe('douyin')
    expect(sniff.template?.source).toBe('douyin')
    const { rows, errors } = parseRows(sniff.table, sniff.mapping)
    expect(errors).toEqual([])
    expect(rows.map((r) => [r.date, r.time, r.type, r.amount, r.merchant, r.accountName, r.ref, r.skipReason])).toEqual([
      ['2026-06-30', '14:27', 'expense', 10800, '抖音电商', '抖音月付', '2105000000000000001', undefined],
      ['2026-06-20', '03:13', 'expense', 1500, 'Apple 服务', '招商银行借记卡（5566）', '2100000000000000002', undefined],
      ['2026-05-29', '22:46', 'income', 3290, '抖音生活服务', undefined, '2105000000000000003', undefined],
      ['2026-05-01', '10:00', 'income', 5000, '抖音月付', '抖音月付', '2105000000000000004', '不计收支'],
    ])
  })

  it('付款方式按卡号尾号对应账户', () => {
    const list = [
      { id: 7, name: '抖音月付', type: 'credit' as const },
      { id: 8, name: '工资卡', type: 'debit' as const, note: '招行 尾号5566' },
    ]
    expect(cardTail('招商银行借记卡（5566）')).toBe('5566')
    expect(cardTail('招商银行储蓄卡(5566)')).toBe('5566')
    expect(cardTail('6214000000005566')).toBe('5566')
    expect(cardTail('6214 **** 5566')).toBe('5566')
    expect(cardTail('零钱')).toBeUndefined()
    expect(accountByCardTail('招商银行借记卡（5566）', list)).toBe(8)
    expect(matchAccount('招商银行借记卡（5566）', list, 7)).toBe(8)
    expect(matchAccount('抖音月付', list, 1)).toBe(7)
    // 银行名对上、卡种冲突时不采用
    expect(matchAccount('招商银行储蓄卡(5678)', [{ id: 2, name: '招商信用卡', type: 'credit' }], 9)).toBe(9)
    expect(matchAccount('广发银行信用卡(2229)', [{ id: 3, name: '广发卡', type: 'credit' }], 9)).toBe(3)
  })
})

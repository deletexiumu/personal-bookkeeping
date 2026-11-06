import { describe, expect, it } from 'vitest'
import type { Category, Transaction } from '../../types'
import { detectDelimiter, parseCsv } from './csv'
import { decodeText } from './decode'
import { isVoidStatus, parseDateCell, parseDirection, parseMoneyCell, parseTimeCell } from './normalize'
import { buildMerchantHistory, buildPreview, classify, findDuplicate, matchAccount, summarizePreview } from './preview'
import { similarity } from './similarity'
import { sniffText } from './sniff'
import { autoMap, findHeaderRow, mappingProblems, parseRows, toTable, type ParsedRow } from './table'

const utf8 = (text: string) => new TextEncoder().encode(text)

describe('decodeText', () => {
  it('识别 UTF-8 并去掉 BOM', () => {
    expect(decodeText(utf8('﻿日期,金额'))).toEqual({ text: '日期,金额', encoding: 'utf-8' })
  })

  it('UTF-8 解码失败时按 GBK', () => {
    // 「日期,金额」的 GBK 编码
    const bytes = new Uint8Array([0xc8, 0xd5, 0xc6, 0xda, 0x2c, 0xbd, 0xf0, 0xb6, 0xee])
    expect(decodeText(bytes)).toEqual({ text: '日期,金额', encoding: 'gbk' })
  })
})

describe('parseCsv', () => {
  it('处理引号、转义引号、字段内换行和 CRLF', () => {
    const text = 'a,b,c\r\n"x, y","he said ""hi""","line1\nline2"\r\n1,2,3\r\n\r\n'
    expect(parseCsv(text)).toEqual([
      ['a', 'b', 'c'],
      ['x, y', 'he said "hi"', 'line1\nline2'],
      ['1', '2', '3'],
    ])
  })

  it('去掉单元格首尾空白和制表符', () => {
    expect(parseCsv('a ,\tb\t\n', ',')).toEqual([['a', 'b']])
  })

  it('检测分隔符', () => {
    expect(detectDelimiter('说明\na\tb\tc\n1\t2\t3')).toBe('\t')
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';')
    expect(detectDelimiter('a,b\n"1;2",3')).toBe(',')
  })
})

describe('单元格解析', () => {
  it('parseDateCell 支持常见格式', () => {
    expect(parseDateCell('2026-10-31')).toEqual({ date: '2026-10-31' })
    expect(parseDateCell('2026/1/5 9:03')).toEqual({ date: '2026-01-05', time: '09:03' })
    expect(parseDateCell('2026.10.31 12:08:33')).toEqual({ date: '2026-10-31', time: '12:08' })
    expect(parseDateCell('2026年10月31日')).toEqual({ date: '2026-10-31' })
    expect(parseDateCell('20261031')).toEqual({ date: '2026-10-31' })
    expect(parseDateCell('2026-02-30')).toBeNull()
    expect(parseDateCell('消费')).toBeNull()
  })

  it('parseTimeCell', () => {
    expect(parseTimeCell('12:08:33')).toBe('12:08')
    expect(parseTimeCell('0905')).toBe('09:05')
    expect(parseTimeCell('25:00')).toBeNull()
  })

  it('parseMoneyCell 转为带符号的分', () => {
    expect(parseMoneyCell('¥36.50')).toBe(3650)
    expect(parseMoneyCell('-1,234.5')).toBe(-123450)
    expect(parseMoneyCell('+88')).toBe(8800)
    expect(parseMoneyCell('(25.00)')).toBe(-2500)
    expect(parseMoneyCell('25.00-')).toBe(-2500)
    expect(parseMoneyCell('12.345')).toBe(1235)
    expect(parseMoneyCell('36.50元')).toBe(3650)
    expect(parseMoneyCell('abc')).toBeNull()
    expect(parseMoneyCell('')).toBeNull()
  })

  it('parseDirection 与 isVoidStatus', () => {
    expect(parseDirection('支出')).toBe('expense')
    expect(parseDirection('消费')).toBe('expense')
    expect(parseDirection('收入')).toBe('income')
    expect(parseDirection('退款')).toBe('income')
    expect(parseDirection('/')).toBe('neutral')
    expect(parseDirection('不计收支')).toBe('neutral')
    expect(parseDirection('其他')).toBe('neutral')
    expect(parseDirection('其它费用')).toBeNull()
    expect(isVoidStatus('交易关闭')).toBe(true)
    expect(isVoidStatus('支付成功')).toBe(false)
  })
})

describe('similarity', () => {
  it('包含关系视为相同，否则按二元组相似度', () => {
    expect(similarity('美团外卖', '美团外卖-订单 3381')).toBe(1)
    expect(similarity('星巴克咖啡', '星巴克')).toBe(1)
    expect(similarity('滴滴出行', '京东商城')).toBe(0)
    expect(similarity('', '星巴克')).toBe(0)
  })
})

/** 与设计稿 D03 一致的信用卡账单：前 3 行说明 */
const BANK_CSV = [
  '招商银行信用卡账单',
  '账单周期：2026/10/01-2026/10/31',
  '',
  '交易日期,记账时间,交易摘要,人民币金额,卡号末四位,交易类型,交易地点',
  '2026/10/31,12:08:33,美团外卖-订单 3381,-36.50,1234,消费,上海',
  '2026/10/30,23:41:00,滴滴出行,-42.00,1234,消费,上海',
  '2026/10/25,09:00:00,还款,"5,000.00",1234,还款,',
  '合计,,,,,,',
].join('\n')

describe('表头与自动映射', () => {
  it('跳过说明行找到表头，并丢弃汇总行', () => {
    const rows = parseCsv(BANK_CSV)
    expect(findHeaderRow(rows)).toBe(3)
    const table = toTable(rows, 3)
    expect(table.rows.map((r) => r.line)).toEqual([5, 6, 7])
  })

  it('按表头和示例值映射，账户列需确认', () => {
    const { table, mapping } = sniffText(utf8(BANK_CSV))
    expect(table.headers).toHaveLength(7)
    expect(mapping.map((m) => m.field)).toEqual(['date', 'time', 'note', 'amount', 'account', 'direction', 'ignore'])
    expect(mapping[4].status).toBe('confirm')
    expect(mapping[6].status).toBe('skip')
    expect(mappingProblems(mapping)).toEqual([])
  })

  it('「交易时间」里是完整日期时间时当作日期列', () => {
    const table = toTable(parseCsv('交易时间,金额\n2026-10-31 12:08:33,1.00'), 0)
    expect(autoMap(table).map((m) => m.field)).toEqual(['date', 'amount'])
  })

  it('没有表头关键词时按示例值猜测', () => {
    const table = toTable(parseCsv('a,b,c\n2026-10-31,午饭,-12.00\n2026-10-30,地铁,-4.00'), 0)
    expect(autoMap(table)).toEqual([
      { field: 'date', status: 'confirm' },
      { field: 'ignore', status: 'skip' },
      { field: 'amount', status: 'confirm' },
    ])
  })

  it('缺少日期或金额时提示', () => {
    expect(mappingProblems([{ field: 'note', status: 'matched' }])).toEqual(['请指定日期列', '请指定金额列'])
  })
})

describe('parseRows', () => {
  it('按收支方向列判断类型，金额取绝对值', () => {
    const { table, mapping } = sniffText(utf8(BANK_CSV))
    const { rows, errors } = parseRows(table, mapping)
    expect(errors).toEqual([])
    expect(rows[0]).toEqual({
      line: 5,
      date: '2026-10-31',
      time: '12:08',
      type: 'expense',
      amount: 3650,
      note: '美团外卖-订单 3381',
      accountName: '1234',
    })
    // 「还款」不是收支方向词，按金额正负：正数为收入
    expect(rows[2]).toMatchObject({ type: 'income', amount: 500000 })
  })

  it('支持正数为支出的约定、分列的收支金额、交易状态', () => {
    const table = toTable(parseCsv('日期,支出,收入,状态\n2026-10-01,12.00,,成功\n2026-10-02,,100,交易关闭\n2026-10-03,,,成功'), 0)
    const { rows, errors } = parseRows(table, autoMap(table))
    expect(rows.map((r) => [r.type, r.amount, r.skipReason])).toEqual([
      ['expense', 1200, undefined],
      ['income', 10000, '交易关闭'],
    ])
    expect(errors).toEqual([{ line: 4, reason: '金额无法识别或为 0' }])

    const signed = toTable(parseCsv('日期,金额\n2026-10-01,12.00\n2026-10-02,-5'), 0)
    expect(parseRows(signed, autoMap(signed), 'positive-expense').rows.map((r) => r.type)).toEqual(['expense', 'income'])
  })

  it('日期无法识别的行报错', () => {
    const table = toTable(parseCsv('日期,金额\n昨天,1.00'), 0)
    expect(parseRows(table, autoMap(table)).errors).toEqual([{ line: 2, reason: '日期无法识别' }])
  })
})

const categories: Category[] = [
  { id: 1, name: '餐饮', type: 'expense' },
  { id: 2, name: '交通', type: 'expense' },
  { id: 3, name: '咖啡', type: 'expense' },
  { id: 8, name: '工资', type: 'income' },
  { id: 9, name: '旧分类', type: 'expense', archived: true },
]

const tx = (patch: Partial<Transaction>): Transaction => ({
  id: 100,
  type: 'expense',
  amount: 3650,
  accountId: 1,
  date: '2026-10-31',
  source: 'manual',
  createdAt: 1,
  updatedAt: 1,
  ...patch,
})

const row = (patch: Partial<ParsedRow>): ParsedRow => ({ line: 2, date: '2026-10-31', type: 'expense', amount: 3650, ...patch })

describe('去重', () => {
  it('金额相同、日期 ±1 天、商户相似为疑似重复', () => {
    expect(findDuplicate(row({ merchant: '美团外卖' }), [tx({ date: '2026-10-30', note: '外卖' })])).toBeDefined()
    expect(findDuplicate(row({ merchant: '美团外卖' }), [tx({ date: '2026-10-29', note: '外卖' })])).toBeUndefined()
    expect(findDuplicate(row({ merchant: '美团外卖' }), [tx({ source: 'import', merchant: '滴滴' })])).toBeUndefined()
    expect(findDuplicate(row({ merchant: '美团外卖' }), [tx({ date: '2026-10-30', note: '滴滴' })])).toBeUndefined()
    expect(findDuplicate(row({ merchant: '美团外卖' }), [tx({ amount: 3651 })])).toBeUndefined()
  })

  it('与同一天同金额的手记视为疑似重复', () => {
    expect(findDuplicate(row({ merchant: '转账-张三' }), [tx({ note: '还钱' })])).toBeDefined()
  })

  it('任一方没有商户和备注时要求同一天', () => {
    expect(findDuplicate(row({ merchant: '张三' }), [tx({})])).toBeDefined()
    expect(findDuplicate(row({ merchant: '张三' }), [tx({ date: '2026-10-30' })])).toBeUndefined()
  })

  it('有交易单号时按单号精确比对', () => {
    expect(findDuplicate(row({ ref: 'A1', amount: 1 }), [tx({ externalId: 'A1' })])).toBeDefined()
    expect(findDuplicate(row({ ref: 'A2' }), [tx({ externalId: 'A1' })])).toBeUndefined()
  })
})

describe('自动分类', () => {
  const ctx = { categories, merchantHistory: buildMerchantHistory([tx({ merchant: '星巴克', categoryId: 3 })]) }

  it('文件分类列 > 历史同商户 > 关键词', () => {
    expect(classify(row({ categoryName: '交通', merchant: '星巴克' }), ctx)).toEqual({ categoryId: 2, source: 'file' })
    expect(classify(row({ merchant: '星巴克' }), ctx)).toEqual({ categoryId: 3, source: 'history' })
    // 没有商户时用备注匹配历史商户
    expect(classify(row({ note: '星巴克' }), ctx)).toEqual({ categoryId: 3, source: 'history' })
    expect(classify(row({ merchant: '美团外卖' }), ctx)).toEqual({ categoryId: 1, source: 'keyword' })
    expect(classify(row({ type: 'income', note: '10 月工资' }), ctx)).toEqual({ categoryId: 8, source: 'keyword' })
    expect(classify(row({ merchant: '某某公司' }), ctx)).toBeUndefined()
  })

  it('不用归档分类和类型不符的分类', () => {
    expect(classify(row({ categoryName: '旧分类' }), ctx)).toBeUndefined()
    expect(classify(row({ type: 'income', categoryName: '餐饮' }), ctx)).toBeUndefined()
  })
})

describe('buildPreview', () => {
  const accounts = [
    { id: 1, name: '现金' },
    { id: 2, name: '招商信用卡' },
  ]

  it('账户按名称匹配，否则用默认账户', () => {
    expect(matchAccount('招商信用卡(1234)', accounts, 1)).toBe(2)
    expect(matchAccount('1234', accounts, 1)).toBe(1)
    expect(matchAccount(undefined, accounts, 2)).toBe(2)
  })

  it('汇总新增 / 疑似重复 / 待分类 / 忽略，疑似重复和忽略默认不勾选', () => {
    const items = buildPreview(
      [
        row({ merchant: '美团外卖' }),
        row({ merchant: '某某公司', amount: 100 }),
        row({ merchant: '滴滴出行', amount: 4200, date: '2026-10-30' }),
        row({ merchant: '交易关闭', amount: 1, skipReason: '交易关闭' }),
        row({ time: '10:00', amount: 5, merchant: '地铁' }),
        row({ time: '10:00', amount: 5, merchant: '地铁' }),
      ],
      {
        categories,
        merchantHistory: new Map(),
        accounts,
        defaultAccountId: 2,
        existing: [tx({ amount: 4200, date: '2026-10-30', note: '滴滴' })],
      },
    )
    expect(items.map((i) => i.selected)).toEqual([true, true, false, false, true, false])
    expect(items[5].duplicateOf).toBe('batch')
    expect(summarizePreview(items)).toEqual({
      total: 6,
      new: 2,
      duplicate: 2,
      uncategorized: 1,
      ignored: 1,
      selected: 3,
      selectedUncategorized: 1,
    })
  })
})

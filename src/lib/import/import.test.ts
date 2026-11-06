import { describe, expect, it } from 'vitest'
import type { Account, Category, ImportSource, Transaction } from '../../types'
import { detectDelimiter, parseCsv } from './csv'
import { decodeText } from './decode'
import { isVoidStatus, parseDateCell, parseDirection, parseMoneyCell, parseTimeCell } from './normalize'
import {
  buildMerchantHistory,
  buildPreview,
  classify,
  findDuplicate,
  findMergeTarget,
  matchAccount,
  mergeTransaction,
  statusOf,
  summarizePreview,
  type PreviewItem,
} from './preview'
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
      merge: 0,
      duplicate: 2,
      uncategorized: 1,
      ignored: 1,
      selected: 3,
      selectedUncategorized: 1,
    })
  })
})

describe('钱包账单与银行流水合并', () => {
  // 账户 2 招行卡、5 中信卡、3 支付宝、4 微信
  const accounts: Account[] = [
    { id: 2, name: '招行卡 1234', type: 'debit' },
    { id: 5, name: '中信卡', type: 'debit' },
    { id: 3, name: '支付宝', type: 'alipay' },
    { id: 4, name: '微信', type: 'wechat' },
  ]
  const accountTypeOf = (id: number) => accounts.find((a) => a.id === id)?.type
  const bankTx = (patch: Partial<Transaction>) => tx({ id: 200, source: 'import', accountId: 2, note: '快捷支付', ...patch })
  const walletTx = (patch: Partial<Transaction>) => tx({ id: 300, source: 'import', accountId: 3, externalId: 'W1', merchant: '家和鲜包点', ...patch })
  const labels = { incoming: '招商银行流水', existing: '支付宝账单', accountName: (id: number) => accounts.find((a) => a.id === id)?.name }
  const ctx = (existing: Transaction[], source?: ImportSource) => ({
    categories,
    merchantHistory: new Map(),
    accounts,
    defaultAccountId: source ? 3 : 2,
    existing,
    source,
    sourceOf: (t: Transaction) => (t.externalId ? ('alipay' as const) : ('bank' as const)),
  })
  const view = (items: PreviewItem[]) => items.map((i) => [statusOf(i), i.mergeWith?.id, i.selected])

  it('账户不同时，渠道一致或商户相似才算对得上，渠道冲突的不配对', () => {
    const alipay = walletTx({})
    const c = { sourceOf: () => 'alipay' as const, accountTypeOf }
    expect(findMergeTarget(row({ merchant: '家和鲜包点', note: '快捷支付' }), [alipay], 2, c)).toMatchObject({ strong: true })
    expect(findMergeTarget(row({ note: '支付宝' }), [walletTx({ merchant: '淘宝闪购' })], 2, c)).toMatchObject({ strong: true })
    // 只有金额日期对得上：候选，但不默认合并
    expect(findMergeTarget(row({ merchant: '上海拉扎斯信息科技有限公司', note: '快捷支付' }), [walletTx({ merchant: '淘宝闪购' })], 2, c)).toMatchObject({ strong: false })
    // 银行流水写的是微信，对不上支付宝账单
    expect(findMergeTarget(row({ merchant: '微信转账', note: '快捷支付' }), [alipay], 2, c)).toBeUndefined()
    // 都没有单号 / 都有单号 / 日期差 2 天 / 金额不同
    expect(findMergeTarget(row({ merchant: '家和鲜包点' }), [bankTx({})], 2, c)).toBeUndefined()
    expect(findMergeTarget(row({ merchant: '家和鲜包点', ref: 'W2' }), [alipay], 2, c)).toBeUndefined()
    expect(findMergeTarget(row({ merchant: '家和鲜包点', date: '2026-11-02' }), [alipay], 2, c)).toBeUndefined()
    expect(findMergeTarget(row({ merchant: '家和鲜包点', amount: 1 }), [alipay], 2, c)).toBeUndefined()
  })

  it('钱包账单的付款方式是银行卡时算对得上，但不能是另一张卡', () => {
    const bank = bankTx({ merchant: '北京三快在线科技有限公司' })
    const c = { source: 'wechat' as const, accountTypeOf }
    expect(findMergeTarget(row({ ref: 'W9', merchant: '美团', accountName: '招商银行(1234)' }), [bank], 2, c)).toMatchObject({ strong: true })
    expect(findMergeTarget(row({ ref: 'W9', merchant: '美团', accountName: '零钱' }), [bank], 4, c)).toMatchObject({ strong: false })
    // 付款卡对应到招行卡，银行流水是中信卡的：不是同一笔
    expect(findMergeTarget(row({ ref: 'W9', merchant: '美团', accountName: '招商银行(1234)' }), [bankTx({ accountId: 5 })], 2, c)).toBeUndefined()
  })

  it('手记只在同一天或商户相似时作为候选，且不默认合并', () => {
    const manual = tx({ id: 400, source: 'manual', accountId: 4, note: '午饭', date: '2026-10-30' })
    const c = { source: 'wechat' as const, accountTypeOf }
    expect(findMergeTarget(row({ ref: 'W9', merchant: '麦当劳', accountName: '招商银行(1234)' }), [manual], 2, c)).toBeUndefined()
    expect(findMergeTarget(row({ ref: 'W9', merchant: '麦当劳', date: '2026-10-30' }), [manual], 4, c)).toMatchObject({ strong: false })
  })

  it('先导入钱包、再导入银行流水：钱包那条改到银行卡账户，银行流水记进明细', () => {
    const item: PreviewItem = { key: 0, row: row({ merchant: '家和鲜包点', note: '银联快捷支付' }), accountId: 2, categoryId: 2, selected: true }
    const next = mergeTransaction(walletTx({ categoryId: 1, note: '消费6元' }), item, labels)
    expect(next).toMatchObject({ id: 300, accountId: 2, merchant: '家和鲜包点', note: '消费6元', externalId: 'W1', categoryId: 1 })
    expect(next.merged).toEqual([{ label: '招商银行流水', date: '2026-10-31', merchant: '家和鲜包点', note: '银联快捷支付', account: '招行卡 1234', bank: true }])
  })

  it('先导入银行流水、再导入钱包：保留银行那条的账户，换上钱包的商户和单号，钱包没有的沿用', () => {
    const item: PreviewItem = { key: 0, row: row({ ref: 'W7', merchant: '星巴克', date: '2026-10-30' }), accountId: 4, categoryId: 3, selected: true }
    const next = mergeTransaction(bankTx({ merchant: '财付通', date: '2026-10-31', time: '09:00' }), item, { ...labels, existing: '招商银行流水' })
    expect(next).toMatchObject({ id: 200, accountId: 2, date: '2026-10-30', time: '09:00', merchant: '星巴克', note: '快捷支付', externalId: 'W7', categoryId: 3 })
    expect(next.merged).toEqual([{ label: '招商银行流水', date: '2026-10-31', time: '09:00', merchant: '财付通', note: '快捷支付', account: '招行卡 1234', bank: true }])
  })

  it('钱包 × 手记：手记内容不动，钱包那行记进明细', () => {
    const manual = tx({ id: 400, source: 'manual', accountId: 4, note: '午饭' })
    const item: PreviewItem = { key: 0, row: row({ ref: 'W8', merchant: '麦当劳', note: '套餐', time: '12:01' }), accountId: 4, selected: true }
    const next = mergeTransaction(manual, item, { ...labels, incoming: '微信账单', existing: '手记' })
    expect(next).toMatchObject({ id: 400, note: '午饭', merchant: '麦当劳', time: '12:01', externalId: 'W8', source: 'manual' })
    expect(next.merged).toEqual([{ label: '微信账单', date: '2026-10-31', time: '12:01', merchant: '麦当劳', note: '套餐', account: '微信' }])
  })

  it('预览：交易关闭的行不占配对，对得上的行优先认领', () => {
    const bank = bankTx({ merchant: '某餐厅', note: '财付通快捷支付' })
    // 交易关闭后重新付款
    const p1 = buildPreview(
      [row({ ref: 'A1', merchant: '麦当劳', skipReason: '交易关闭' }), row({ ref: 'A2', merchant: '麦当劳', accountName: '招商银行(1234)' })],
      { ...ctx([bank], 'wechat'), defaultAccountId: 4 },
    )
    expect(view(p1)).toEqual([['ignored', undefined, false], ['merge', 200, true]])
    // 前一行只有金额对得上，后一行商户相似：后一行合并，前一行照常新增
    const p2 = buildPreview([row({ ref: 'B1', merchant: '奶茶', accountName: '零钱' }), row({ ref: 'B2', merchant: '某餐厅', accountName: '零钱' })], {
      ...ctx([bankTx({ merchant: '某餐厅', note: '银联消费' })], 'wechat'),
      defaultAccountId: 4,
    })
    expect(view(p2)).toEqual([['new', undefined, true], ['merge', 200, true]])
  })

  it('预览：提现按付款方式落在银行卡上时，转出账户用钱包账户', () => {
    const bank = bankTx({ type: 'income', merchant: '支付宝', note: '网联收款' })
    const items = buildPreview([row({ type: 'income', ref: 'F1', merchant: '招商银行', note: '提现-实时提现', accountName: '招商银行储蓄卡(1234)' })], ctx([bank], 'alipay'))
    expect(items[0]).toMatchObject({ accountId: 2, mergeAsTransfer: { from: 3, to: 2 } })
    const next = mergeTransaction(bank, items[0], { ...labels, existing: '招商银行流水' })
    expect(next).toMatchObject({ type: 'transfer', accountId: 3, transferAccountId: 2 })
    expect(next.categoryId).toBeUndefined()
    // 反过来：先有钱包提现，再导入银行入账
    const wallet = walletTx({ type: 'income', merchant: '招商银行', note: '提现-实时提现', categoryId: 8 })
    const again = buildPreview([row({ type: 'income', merchant: '支付宝', note: '网联收款' })], ctx([wallet]))
    expect(again[0].mergeAsTransfer).toEqual({ from: 3, to: 2 })
  })

  it('预览：已合并过银行流水的不再合并；同一份或换格式的银行流水再导入算重复', () => {
    const fresh = buildPreview([row({ merchant: '家和鲜包点', note: '快捷支付' })], ctx([walletTx({})]))
    expect(view(fresh)).toEqual([['merge', 300, true]])
    expect(summarizePreview(fresh)).toMatchObject({ merge: 1, selected: 1, selectedUncategorized: 1 })

    const merged = walletTx({ accountId: 2, merged: [{ label: '招商银行流水', date: '2026-10-31', merchant: '家和鲜包点', note: '快捷支付', bank: true }] })
    const again = buildPreview([row({ merchant: '家和鲜包点', note: '快捷支付' })], ctx([merged]))
    expect(again[0].mergeWith).toBeUndefined()
    expect(again[0].duplicateOf).toBe(merged)
    // Excel 版流水摘要写法不同、记账日晚一天
    const excel = buildPreview([row({ merchant: '家和鲜包点(某店)', note: '银联快捷支付', date: '2026-11-01' })], ctx([merged]))
    expect(excel[0].duplicateOf).toBe(merged)
  })

  it('钱包 × 手记合并后，银行流水还能再合并进来', () => {
    const t = walletTx({ source: 'manual', merged: [{ label: '微信账单', date: '2026-10-31', merchant: '麦当劳' }], merchant: '麦当劳' })
    const items = buildPreview([row({ merchant: '麦当劳', note: '快捷支付' })], ctx([t]))
    expect(items[0].mergeWith).toBe(t)
  })

  it('一笔已有流水只合并一次', () => {
    const items = buildPreview([row({ merchant: '家和鲜包点', note: '快捷支付' }), row({ merchant: '家和鲜包点', note: '快捷支付' })], ctx([walletTx({})]))
    expect(items.map((i) => i.mergeWith?.id)).toEqual([300, undefined])
  })
})

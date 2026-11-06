import { describe, expect, it } from 'vitest'
import type { Account, Transaction } from '../../types'
import { isPdf, parseToUnicode, readPdfText } from './pdf'
import { pdfItemsToLines } from './pdfTable'
import { buildPreview, statusOf } from './preview'
import { finishRows, sniffFile } from './sniff'
import { parseRows } from './table'
import { makePdf, type PdfText } from './testPdf'

/** 一行表格：各列文字左对齐放在列起点 */
const row = (y: number, cols: number[], cells: string[]): PdfText[] => cells.flatMap((str, i) => (str ? [{ x: cols[i], y, str }] : []))

/** 仿招商银行「交易流水」PDF 的版式（数据为虚构） */
const CMB_COLS = [36, 99, 156, 235, 308, 418]
function cmbPages(): PdfText[][] {
  const header = (y: number) => [
    ...row(y, CMB_COLS, ['记账日期', '货币', '交易金额', '联机余额', '交易摘要', '对手信息']),
    ...row(y + 23, CMB_COLS, ['Date', 'Currency', '', 'Balance', 'Transaction Type', 'Counter Party']),
    { x: 156, y: y + 17, str: 'Transaction' },
    { x: 156, y: y + 29, str: 'Amount' },
  ]
  return [
    [
      { x: 540, y: 812, str: '1/2', font: 'F2' },
      { x: 258, y: 62, str: '招商银行交易流水' },
      { x: 36, y: 137, str: '户  名：' },
      { x: 85, y: 137, str: '张三' },
      { x: 261, y: 137, str: '账号：6214000000005566' },
      ...header(255),
      ...row(301, CMB_COLS, ['2026-01-01', 'CNY', '-46.80', '22.52', '快捷支付', '拼多多平台商户 1321788501']),
      ...row(328, CMB_COLS, ['2026-01-01', 'CNY', '4,300.00', '4,322.52', '汇入汇款', '张三 6217000000007788']),
      // 对手信息折成三行，垂直居中于本行
      ...row(413, CMB_COLS, ['2026-01-02', 'CNY', '-15.00', '4,307.52', '快捷支付', 'International']),
      { x: 418, y: 401, str: 'Apple Distribution' },
      { x: 418, y: 425, str: '6020250512695025' },
      ...row(446, CMB_COLS, ['2026-01-02', 'CNY', '-12.89', '4,294.63', '银联快捷支付', '']),
      { x: 418, y: 440, str: '上海某某网络科技有限公' },
      { x: 418, y: 452, str: '司 6020240527924188' },
    ],
    [
      { x: 540, y: 812, str: '2/2', font: 'F2' },
      ...header(40),
      ...row(86, CMB_COLS, ['2026-01-03', 'CNY', '-1,000.00', '3,294.63', '转账汇款', '李四 6228000000000875']),
    ],
  ]
}

describe('PDF 读取', () => {
  it('识别文件头，解析 ToUnicode 的 bfchar / bfrange', () => {
    expect(isPdf(new TextEncoder().encode('%PDF-1.7\n'))).toBe(true)
    expect(isPdf(new TextEncoder().encode('交易时间,金额'))).toBe(false)
    const map = parseToUnicode('2 beginbfchar <0003> <0020> <0010> <4E2D> endbfchar 1 beginbfrange <0020> <0022> <0041> endbfrange')
    expect(map.get(3)).toBe(' ')
    expect(map.get(0x10)).toBe('中')
    expect(map.get(0x22)).toBe('C')
  })

  it('读出文字和位置；ToUnicode 漏掉的字按同族字体的偏移推断', async () => {
    const bytes = await makePdf(cmbPages(), { F1: { missing: '银转额：' } })
    const items = await readPdfText(bytes)
    const first = items.filter((i) => i.page === 1)
    expect(first.find((i) => i.y === 62)?.str).toBe('招商银行交易流水')
    // 「：」在 F1 里漏了映射，从同族的 F2 推断
    expect(first.find((i) => i.y === 137 && i.x === 36)?.str).toBe('户  名：')
    expect(first.find((i) => i.str === '交易金额')).toMatchObject({ x: 156, y: 255, width: 40, height: 10 })
    expect(items.find((i) => i.page === 2 && i.str === '转账汇款')).toBeTruthy()
  })

  it('还原表格：每页重复的表头和英文注释去掉，折行的单元格拼回一格，页码丢弃', async () => {
    const lines = pdfItemsToLines(await readPdfText(await makePdf(cmbPages())))
    const header = lines.findIndex((l) => l[0] === '记账日期')
    expect(lines.slice(0, header).flat()).toContain('账号：6214000000005566')
    expect(lines.slice(header)).toEqual([
      ['记账日期', '货币', '交易金额', '联机余额', '交易摘要', '对手信息'],
      ['2026-01-01', 'CNY', '-46.80', '22.52', '快捷支付', '拼多多平台商户 1321788501'],
      ['2026-01-01', 'CNY', '4,300.00', '4,322.52', '汇入汇款', '张三 6217000000007788'],
      ['2026-01-02', 'CNY', '-15.00', '4,307.52', '快捷支付', 'Apple Distribution International 6020250512695025'],
      ['2026-01-02', 'CNY', '-12.89', '4,294.63', '银联快捷支付', '上海某某网络科技有限公司 6020240527924188'],
      ['2026-01-03', 'CNY', '-1,000.00', '3,294.63', '转账汇款', '李四 6228000000000875'],
    ])
  })
})

describe('银行流水 PDF 模板', () => {
  it('招商银行：命中模板，对手信息去掉账号，本人账户互转默认不入账', async () => {
    const sniff = await sniffFile(await makePdf(cmbPages(), { F1: { missing: '银转额' } }))
    expect(sniff.format).toBe('pdf')
    expect(sniff.template?.id).toBe('cmb')
    expect(sniff).toMatchObject({ holder: '张三', accountNo: '6214000000005566' })
    const { rows, errors } = finishRows(sniff, parseRows(sniff.table, sniff.mapping))
    expect(errors).toEqual([])
    expect(rows.map((r) => [r.date, r.type, r.amount, r.merchant, r.note, r.skipReason])).toEqual([
      ['2026-01-01', 'expense', 4680, '拼多多平台商户', '快捷支付', undefined],
      ['2026-01-01', 'income', 430000, '张三', '汇入汇款', '本人账户互转'],
      ['2026-01-02', 'expense', 1500, 'Apple Distribution International', '快捷支付', undefined],
      ['2026-01-02', 'expense', 1289, '上海某某网络科技有限公司', '银联快捷支付', undefined],
      ['2026-01-03', 'expense', 100000, '李四', '转账汇款', undefined],
    ])
  })

  it('中信银行：收入 / 支出分两列，单元格居中对齐', async () => {
    // 表头各列中心
    const centers = [40, 112, 177, 243, 313, 420, 528]
    const cell = (y: number, i: number, str: string): PdfText => ({ x: centers[i] - (str.length * 5) / 2, y, str })
    const line = (y: number, cells: string[]) => cells.flatMap((s, i) => (s ? [cell(y, i, s)] : []))
    const page: PdfText[] = [
      { x: 253, y: 45, str: '账户交易明细' },
      { x: 17, y: 99, str: '户名：张三' },
      { x: 17, y: 129, str: '账号：6217000000007788' },
      ...['交易日期', '收入金额', '支出金额', '账户余额', '交易摘要', '对方账号', '对方户名'].map((s, i) => ({ x: centers[i] - 18, y: 214, str: s })),
      { x: 15, y: 225, str: 'Transaction' },
      { x: 31, y: 236, str: 'date' },
      { x: 288, y: 230, str: 'Description' },
      ...line(253, ['20260101', 'RMB 4320.00', '', 'RMB 4325.44', '提取托付', '7442000000000000164', '某市住房公积金管理中心']),
      ...line(276, ['20260101', '', 'RMB 4300.00', 'RMB 25.44', '网银互联跨行转出', '6214000000005566', '张三']),
      ...line(298, ['20260105', '', 'RMB 25.00', 'RMB 0.44', '支付宝', '215500690', '']),
      { x: 15, y: 553, str: '声明：本交易流水证明不能流通' },
      { x: 280, y: 827, str: '第1页/共1页' },
    ]
    const sniff = await sniffFile(await makePdf([page]))
    expect(sniff.template?.id).toBe('citic')
    const { rows } = finishRows(sniff, parseRows(sniff.table, sniff.mapping))
    expect(rows.map((r) => [r.date, r.type, r.amount, r.merchant, r.note, r.skipReason])).toEqual([
      ['2026-01-01', 'income', 432000, '某市住房公积金管理中心', '提取托付', undefined],
      ['2026-01-01', 'expense', 430000, '张三', '网银互联跨行转出', '本人账户互转'],
      ['2026-01-05', 'expense', 2500, undefined, '支付宝', undefined],
    ])
  })

  it('跨账单合并：钱包账单用这张卡付的款，与银行流水里的同一笔对上', async () => {
    const sniff = await sniffFile(await makePdf(cmbPages()))
    const { rows } = finishRows(sniff, parseRows(sniff.table, sniff.mapping))
    const accounts: Account[] = [
      { id: 1, name: '微信', type: 'wechat' },
      { id: 2, name: '招行储蓄卡 5566', type: 'debit' },
    ]
    // 之前导入的微信账单：用招行卡付了拼多多（同一天）和 Apple（前一天晚上，银行次日记账）
    const wallet = (id: number, date: string, amount: number, merchant: string, accountId = 2): Transaction => ({
      id,
      type: 'expense',
      amount,
      date,
      merchant,
      accountId,
      externalId: `42000${id}`,
      source: 'import',
      createdAt: 0,
      updatedAt: 0,
    })
    const existing = [
      wallet(1, '2026-01-01', 4680, '拼多多'),
      wallet(2, '2026-01-01', 1500, 'Apple 服务'),
      // 落在微信账户上的同金额：可能是零钱付的，也可能是付款方式没对应上的银行卡
      wallet(3, '2026-01-02', 1289, '某某超市', 1),
    ]
    const items = buildPreview(rows, { categories: [], merchantHistory: new Map(), accounts, defaultAccountId: 2, existing })
    expect(items.map((i) => i.mergeWith?.id)).toEqual([1, undefined, 2, 3, undefined])
    // 同账户的两笔直接合并；账户对不上的只作为候选（疑似重复），默认不勾选，可改为单独入账
    expect(items.map((i) => statusOf(i))).toEqual(['merge', 'ignored', 'merge', 'duplicate', 'uncategorized'])
    expect(items.map((i) => i.selected)).toEqual([true, false, true, false, true])
  })
})

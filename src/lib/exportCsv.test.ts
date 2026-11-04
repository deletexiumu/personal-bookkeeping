import { describe, expect, it } from 'vitest'
import type { Account, Category, Transaction } from '../types'
import { csvCell, csvFileName, transactionsToCsv } from './exportCsv'
import { sniffText } from './import/sniff'
import { parseRows } from './import/table'

const categories: Category[] = [
  { id: 1, name: '餐饮', type: 'expense' },
  { id: 8, name: '工资', type: 'income' },
]
const accounts: Account[] = [
  { id: 1, name: '现金' },
  { id: 2, name: '银行卡' },
]
const base = { accountId: 1, source: 'manual', createdAt: 0, updatedAt: 0 } as const
const rows: Transaction[] = [
  { ...base, id: 2, type: 'expense', amount: 3250, categoryId: 1, date: '2026-11-04', time: '12:30', merchant: '星巴克', note: '拿铁, 大杯', tags: ['咖啡', '工作'] },
  { ...base, id: 1, type: 'income', amount: 1_200_000, categoryId: 8, accountId: 2, date: '2026-11-01', note: '10 月工资', source: 'import' },
  { ...base, id: 3, type: 'transfer', amount: 50_000, accountId: 2, transferAccountId: 1, date: '2026-11-03', note: '取现' },
]

describe('导出 CSV', () => {
  it('按日期排序，带 BOM，转账写出两端账户', () => {
    const csv = transactionsToCsv(rows, categories, accounts)
    expect(csv.startsWith('﻿日期,时间,收/支,金额,分类,账户,转入账户,商户,备注,标签,来源\r\n')).toBe(true)
    expect(csv.split('\r\n').slice(1, 4)).toEqual([
      '2026-11-01,,收入,12000.00,工资,银行卡,,,10 月工资,,导入',
      '2026-11-03,,转账,500.00,,银行卡,现金,,取现,,手动',
      '2026-11-04,12:30,支出,32.50,餐饮,现金,,星巴克,"拿铁, 大杯",咖啡 工作,手动',
    ])
  })

  it('转义引号，公式开头的内容前置单引号', () => {
    expect(csvCell('他说"好"')).toBe('"他说""好"""')
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)")
    expect(csvCell('普通')).toBe('普通')
  })

  it('导出的文件可以用通用表格再导入', () => {
    const bytes = new TextEncoder().encode(transactionsToCsv(rows, categories, accounts))
    const { table, mapping } = sniffText(bytes)
    const { rows: parsed } = parseRows(table, mapping)
    const expense = parsed.find((r) => r.merchant === '星巴克')
    expect(expense).toMatchObject({ date: '2026-11-04', time: '12:30', type: 'expense', amount: 3250, categoryName: '餐饮', accountName: '现金' })
    expect(parsed.find((r) => r.type === 'income')).toMatchObject({ amount: 1_200_000, categoryName: '工资' })
  })

  it('文件名', () => {
    expect(csvFileName(undefined, new Date(2026, 10, 4))).toBe('taozhubu-20261104.csv')
    expect(csvFileName({ start: '2026-11-01', end: '2026-11-30' })).toBe('taozhubu-20261101-20261130.csv')
  })
})

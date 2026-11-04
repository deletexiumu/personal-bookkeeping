import type { Account, Category, Transaction } from '../types'
import { SOURCE_LABEL } from './filter'

const TYPE_LABEL = { expense: '支出', income: '收入', transfer: '转账' } as const

/** 表头与导入中心「通用表格」的自动识别一致，导出的文件可以再导回来 */
export const CSV_HEADERS = ['日期', '时间', '收/支', '金额', '分类', '账户', '转入账户', '商户', '备注', '标签', '来源']

/** CSV 单元格：含逗号、引号、换行时加引号；以 = + - @ 开头时前置单引号，防止表格软件当公式执行 */
export function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

function yuan(cents: number): string {
  return (cents / 100).toFixed(2)
}

/** 把流水转成 CSV 文本（带 UTF-8 BOM，Excel 直接打开不乱码），按日期从早到晚 */
export function transactionsToCsv(rows: Transaction[], categories: Category[], accounts: Account[]): string {
  const categoryName = new Map(categories.map((c) => [c.id, c.name]))
  const accountName = new Map(accounts.map((a) => [a.id, a.name]))
  const sorted = [...rows].sort(
    (a, b) => a.date.localeCompare(b.date) || (a.time ?? '').localeCompare(b.time ?? '') || a.createdAt - b.createdAt,
  )
  const lines = sorted.map((t) =>
    [
      t.date,
      t.time ?? '',
      TYPE_LABEL[t.type],
      yuan(t.amount),
      t.categoryId === undefined ? '' : (categoryName.get(t.categoryId) ?? ''),
      accountName.get(t.accountId) ?? '',
      t.transferAccountId === undefined ? '' : (accountName.get(t.transferAccountId) ?? ''),
      t.merchant ?? '',
      t.note ?? '',
      (t.tags ?? []).join(' '),
      SOURCE_LABEL[t.source],
    ]
      .map(csvCell)
      .join(','),
  )
  return `﻿${[CSV_HEADERS.join(','), ...lines].join('\r\n')}\r\n`
}

/** 导出文件名，例如 taozhubu-20261104.csv、taozhubu-20261101-20261130.csv */
export function csvFileName(range?: { start: string; end: string }, now: Date = new Date()): string {
  const compact = (date: string) => date.replace(/-/g, '')
  if (range) return `taozhubu-${compact(range.start)}-${compact(range.end)}.csv`
  const pad = (n: number) => String(n).padStart(2, '0')
  return `taozhubu-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}.csv`
}

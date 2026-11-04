import type { Account, Category, Transaction } from '../../types'
import { KEYWORD_DICTIONARY } from './keywords'
import { CATEGORY_ALIASES } from './templates'
import { normalizeText, similarity } from './similarity'
import type { ParsedRow } from './table'

/** 分类来源：文件里的分类列、历史同商户、内置关键词 */
export type CategorySource = 'file' | 'history' | 'keyword' | 'manual'

export interface PreviewItem {
  /** 在本批次中的序号 */
  key: number
  row: ParsedRow
  accountId: number
  categoryId?: number
  categorySource?: CategorySource
  /** 疑似重复：与已有流水或本批次前面的行相同 */
  duplicateOf?: Transaction | 'batch'
  selected: boolean
}

export type PreviewStatus = 'new' | 'duplicate' | 'uncategorized' | 'ignored'

/** 每行只归入一种状态：忽略 > 疑似重复 > 待分类 > 新增 */
export function statusOf(item: PreviewItem): PreviewStatus {
  if (item.row.skipReason) return 'ignored'
  if (item.duplicateOf) return 'duplicate'
  if (item.categoryId === undefined) return 'uncategorized'
  return 'new'
}

function dayDiff(a: string, b: string): number {
  return Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000
}

/**
 * 疑似重复：类型和金额相同，并且满足其一：
 * - 同一天，且已有流水是手记的（手记备注往往和账单商户写法不同）或任一方没有商户 / 备注；
 * - 日期相差不超过 1 天，且商户 / 备注相似（相似度 ≥ 0.5）。
 * 双方都有交易单号时只按单号精确比对。
 */
export function findDuplicate(row: ParsedRow, candidates: Transaction[]): Transaction | undefined {
  return candidates.find((t) => {
    if (row.ref && t.externalId) return row.ref === t.externalId
    if (t.type !== row.type || t.amount !== row.amount) return false
    const diff = dayDiff(t.date, row.date)
    if (diff > 1) return false
    const theirs = t.merchant ?? t.note
    const missingText = !normalizeText(row.merchant ?? row.note) || !normalizeText(theirs)
    if (diff === 0 && (t.source !== 'import' || missingText)) return true
    if (missingText) return false
    return Math.max(similarity(row.merchant, theirs), similarity(row.note, theirs)) >= 0.5
  })
}

/** 同一批次里完全相同的行（单号相同，或日期、时间、金额、商户、备注都相同且有时间）视为重复 */
function batchKey(row: ParsedRow): string | undefined {
  if (row.ref) return `ref:${row.ref}`
  if (!row.time) return undefined
  return [row.date, row.time, row.type, row.amount, normalizeText(row.merchant), normalizeText(row.note)].join('|')
}

export interface ClassifyContext {
  categories: Category[]
  /** 历史同商户：归一化商户名 → 分类 ID（以最近一笔为准） */
  merchantHistory: Map<string, number>
}

/** 用已有流水建立「历史同商户」索引 */
export function buildMerchantHistory(transactions: Transaction[]): Map<string, number> {
  const sorted = [...transactions].sort((a, b) => a.updatedAt - b.updatedAt)
  const map = new Map<string, number>()
  for (const t of sorted) {
    const key = normalizeText(t.merchant)
    if (key && t.categoryId !== undefined && t.type !== 'transfer') map.set(`${t.type}:${key}`, t.categoryId)
  }
  return map
}

/** 自动分类：文件分类列（按名称）> 历史同商户 > 内置关键词 > 未分类。用户规则在 W4-3 加入，优先级最高。 */
export function classify(row: ParsedRow, ctx: ClassifyContext): { categoryId: number; source: CategorySource } | undefined {
  const usable = ctx.categories.filter((c) => c.type === row.type && !c.archived && c.id !== undefined)
  if (row.categoryName) {
    const alias = CATEGORY_ALIASES[row.categoryName]
    const hit = usable.find((c) => c.name === row.categoryName) ?? usable.find((c) => c.name === alias)
    if (hit) return { categoryId: hit.id!, source: 'file' }
  }
  // 没有商户列时用备注（如银行账单的「交易摘要」）
  const merchant = normalizeText(row.merchant ?? row.note)
  if (merchant) {
    const id = ctx.merchantHistory.get(`${row.type}:${merchant}`)
    if (id !== undefined && usable.some((c) => c.id === id)) return { categoryId: id, source: 'history' }
  }
  const text = `${row.merchant ?? ''} ${row.note ?? ''} ${row.kind ?? ''}`.toLowerCase()
  for (const entry of KEYWORD_DICTIONARY) {
    if (entry.type !== row.type) continue
    if (!entry.keywords.some((k) => text.includes(k.toLowerCase()))) continue
    const hit = usable.find((c) => c.name === entry.category)
    if (hit) return { categoryId: hit.id!, source: 'keyword' }
  }
  return undefined
}

/** 钱包内的资金来源对应到账户类型：微信零钱、支付宝余额 / 余额宝 / 花呗 */
const WALLET_HINTS: [RegExp, Account['type']][] = [
  [/零钱/, 'wechat'],
  [/余额宝|账户余额|花呗|支付宝/, 'alipay'],
]

/** 文件里的账户名对应到本地账户：完全相同、互相包含或钱包类型，否则用默认账户 */
export function matchAccount(name: string | undefined, accounts: Account[], fallback: number): number {
  if (!name) return fallback
  const active = accounts.filter((a) => !a.archived && a.id !== undefined)
  const exact = active.find((a) => a.name === name)
  if (exact) return exact.id!
  const loose = active.find((a) => name.includes(a.name) || a.name.includes(name))
  if (loose) return loose.id!
  const hint = WALLET_HINTS.find(([re]) => re.test(name))?.[1]
  return active.find((a) => hint && a.type === hint)?.id ?? fallback
}

export interface PreviewContext extends ClassifyContext {
  accounts: Account[]
  defaultAccountId: number
  /** 日期范围内（前后各多 1 天）的已有流水，用于去重 */
  existing: Transaction[]
}

/** 组装预览：去重、自动分类、匹配账户；疑似重复和忽略的行默认不勾选 */
export function buildPreview(rows: ParsedRow[], ctx: PreviewContext): PreviewItem[] {
  const seen = new Set<string>()
  return rows.map((row, key) => {
    const item: PreviewItem = {
      key,
      row,
      accountId: matchAccount(row.accountName, ctx.accounts, ctx.defaultAccountId),
      selected: false,
    }
    const dup = findDuplicate(row, ctx.existing)
    const bk = batchKey(row)
    if (dup) item.duplicateOf = dup
    else if (bk && seen.has(bk)) item.duplicateOf = 'batch'
    if (bk) seen.add(bk)
    const hit = classify(row, ctx)
    if (hit) {
      item.categoryId = hit.categoryId
      item.categorySource = hit.source
    }
    const status = statusOf(item)
    item.selected = status === 'new' || status === 'uncategorized'
    return item
  })
}

export interface PreviewSummary {
  total: number
  new: number
  duplicate: number
  uncategorized: number
  ignored: number
  selected: number
  /** 已勾选但没有分类的行数，将以「未分类」入账 */
  selectedUncategorized: number
}

export function summarizePreview(items: PreviewItem[]): PreviewSummary {
  const s: PreviewSummary = { total: items.length, new: 0, duplicate: 0, uncategorized: 0, ignored: 0, selected: 0, selectedUncategorized: 0 }
  for (const item of items) {
    s[statusOf(item)]++
    if (item.selected) {
      s.selected++
      if (item.categoryId === undefined) s.selectedUncategorized++
    }
  }
  return s
}

/** 预览行 → 待写入的流水（不含 ID、时间戳、批次） */
export function toTransaction(item: PreviewItem): Omit<Transaction, 'id' | 'createdAt' | 'updatedAt' | 'importBatchId'> {
  const { row } = item
  const tx: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt' | 'importBatchId'> = {
    type: row.type,
    amount: row.amount,
    accountId: item.accountId,
    date: row.date,
    source: 'import',
  }
  if (item.categoryId !== undefined) tx.categoryId = item.categoryId
  if (row.time) tx.time = row.time
  if (row.merchant) tx.merchant = row.merchant
  if (row.note) tx.note = row.note
  if (row.ref) tx.externalId = row.ref
  return tx
}

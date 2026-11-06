import type { Account, Category, CategoryRule, Transaction } from '../../types'
import { KEYWORD_DICTIONARY } from './keywords'
import { findRule } from './rules'
import { CATEGORY_ALIASES } from './templates'
import { normalizeText, similarity } from './similarity'
import type { ParsedRow } from './table'

/** 分类来源：用户规则、文件里的分类列、历史同商户、内置关键词、手动选择 */
export type CategorySource = 'rule' | 'file' | 'history' | 'keyword' | 'manual'

export interface PreviewItem {
  /** 在本批次中的序号 */
  key: number
  row: ParsedRow
  accountId: number
  categoryId?: number
  categorySource?: CategorySource
  /** 命中的用户规则 */
  rule?: CategoryRule
  /** 手动改分类后勾选「记住」，入账时生成规则 */
  remember?: boolean
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
 * - 跨渠道：一方有交易单号（微信、支付宝、抖音等钱包账单）、另一方没有（银行流水、手记），
 *   入账账户相同且日期相差不超过 1 天。钱包用银行卡付款时，同一笔钱会同时出现在钱包账单和银行流水里；
 * - 同一天，且已有流水是手记的（手记备注往往和账单商户写法不同）或任一方没有商户 / 备注；
 * - 日期相差不超过 1 天，且商户 / 备注相似（相似度 ≥ 0.5）。
 * 双方都有交易单号时只按单号精确比对。exclude 里的流水（已被本批次前面的行认领）不再参与比对，
 * 保证一笔已有流水只对应一行。
 */
export function findDuplicate(
  row: ParsedRow,
  candidates: Transaction[],
  accountId?: number,
  exclude?: ReadonlySet<Transaction>,
): Transaction | undefined {
  return candidates.find((t) => {
    if (exclude?.has(t)) return false
    if (row.ref && t.externalId) return row.ref === t.externalId
    if (t.type !== row.type || t.amount !== row.amount) return false
    const diff = dayDiff(t.date, row.date)
    if (diff > 1) return false
    if (accountId !== undefined && t.accountId === accountId && !row.ref !== !t.externalId) return true
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
  /** 用户规则，已按优先级排序 */
  rules?: CategoryRule[]
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

export interface ClassifyResult {
  categoryId: number
  source: CategorySource
  rule?: CategoryRule
}

/** 自动分类：用户规则 > 文件分类列（按名称或别名）> 历史同商户 > 内置关键词 > 未分类 */
export function classify(row: ParsedRow, ctx: ClassifyContext): ClassifyResult | undefined {
  const rule = ctx.rules && findRule(row, ctx.rules, ctx.categories)
  if (rule) return { categoryId: rule.categoryId, source: 'rule', rule }
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

/** 银行全称与简称，用于把「招商银行储蓄卡(1234)」对应到名为「招行卡」的账户 */
const BANKS: RegExp[] = [
  /招商|招行/,
  /中信/,
  /工商|工行/,
  /建设银行|建行/,
  /农业银行|农行/,
  /交通银行|交行/,
  /中国银行|中行/,
  /邮储|邮政/,
  /浦发/,
  /广发/,
  /平安/,
  /兴业/,
  /民生/,
  /光大/,
  /华夏/,
]

/** 账单里的卡号尾号：「招商银行储蓄卡(1234)」「借记卡（1234）」或纯数字卡号的末 4 位 */
export function cardTail(text: string | undefined): string | undefined {
  if (!text) return undefined
  const digits = text.replace(/\s/g, '')
  // 完整或打码的卡号，如 6214836100001234、6214****1234
  if (/^\d[\d*]{6,}\d{4}$/.test(digits)) return digits.slice(-4)
  return /[(（]\s*(?:尾号)?(\d{4})\s*[)）]/.exec(text)?.[1] ?? /尾号\s*(\d{4})/.exec(text)?.[1]
}

/** 账户名或备注里含有该卡号尾号的账户 */
export function accountByCardTail(text: string | undefined, accounts: Account[]): number | undefined {
  const tail = cardTail(text)
  if (!tail) return undefined
  const re = new RegExp(`(?<!\\d)${tail}(?!\\d)`)
  return accounts.find((a) => !a.archived && a.id !== undefined && (re.test(a.name) || re.test(a.note ?? '')))?.id
}

const cardKind = (text: string): 'credit' | 'debit' | undefined => (/信用/.test(text) ? 'credit' : /储蓄|借记/.test(text) ? 'debit' : undefined)

/** 按银行名匹配：同一家银行、卡种不冲突（信用卡 / 储蓄卡）的账户只有一个时采用 */
function accountByBank(name: string, accounts: Account[]): number | undefined {
  const bank = BANKS.find((re) => re.test(name))
  if (!bank) return undefined
  const kind = cardKind(name)
  const hits = accounts.filter((a) => {
    if (!bank.test(a.name)) return false
    const theirs = a.type === 'credit' || a.type === 'debit' ? a.type : cardKind(a.name)
    return !kind || !theirs || kind === theirs
  })
  return hits.length === 1 ? hits[0].id : undefined
}

/** 文件里的账户名对应到本地账户：完全相同、卡号尾号、互相包含、银行名或钱包类型，否则用默认账户 */
export function matchAccount(name: string | undefined, accounts: Account[], fallback: number): number {
  if (!name) return fallback
  const active = accounts.filter((a) => !a.archived && a.id !== undefined)
  const exact = active.find((a) => a.name === name)
  if (exact) return exact.id!
  const byTail = accountByCardTail(name, active)
  if (byTail !== undefined) return byTail
  const loose = active.find((a) => name.includes(a.name) || a.name.includes(name))
  if (loose) return loose.id!
  const byBank = accountByBank(name, active)
  if (byBank !== undefined) return byBank
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
  const claimed = new Set<Transaction>()
  return rows.map((row, key) => {
    const item: PreviewItem = {
      key,
      row,
      accountId: matchAccount(row.accountName, ctx.accounts, ctx.defaultAccountId),
      selected: false,
    }
    const dup = findDuplicate(row, ctx.existing, item.accountId, claimed)
    const bk = batchKey(row)
    if (dup) {
      item.duplicateOf = dup
      claimed.add(dup)
    } else if (bk && seen.has(bk)) item.duplicateOf = 'batch'
    if (bk) seen.add(bk)
    const hit = classify(row, ctx)
    if (hit) {
      item.categoryId = hit.categoryId
      item.categorySource = hit.source
      if (hit.rule) item.rule = hit.rule
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

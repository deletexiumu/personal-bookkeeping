import type { Account, AccountType, Category, CategoryRule, ImportSource, MergedEntry, Transaction } from '../../types'
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
  /** 与已有流水是同一笔钱（钱包账单 × 银行流水 / 手记）：勾选后合并进这条，不新增 */
  mergeWith?: Transaction
  /** 只有金额和日期对得上（或是手记）：显示为疑似重复，默认不勾选，勾选后合并 */
  weakMerge?: boolean
  /** 合并后是本人账户间的转账（钱包提现到银行卡）：从钱包账户转到银行账户 */
  mergeAsTransfer?: { from: number; to: number }
  /** 用户选了「单独入账」：原来的合并候选，可以改回合并 */
  declinedMerge?: Pick<PreviewItem, 'mergeWith' | 'weakMerge' | 'mergeAsTransfer'>
  selected: boolean
}

export type PreviewStatus = 'new' | 'merge' | 'duplicate' | 'uncategorized' | 'ignored'

/** 每行只归入一种状态：忽略 > 合并 > 疑似重复 > 待分类 > 新增 */
export function statusOf(item: PreviewItem): PreviewStatus {
  if (item.row.skipReason) return 'ignored'
  if (item.mergeWith) return item.weakMerge ? 'duplicate' : 'merge'
  if (item.duplicateOf) return 'duplicate'
  if (item.categoryId === undefined) return 'uncategorized'
  return 'new'
}

function dayDiff(a: string, b: string): number {
  return Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000
}

/** 已经合并过银行流水的流水 */
function hasBankEntry(t: Transaction): boolean {
  return !!t.merged?.some((m) => m.bank)
}

/** 已合并进 t 的银行流水里有完全相同的一行（重复导入同一份银行流水） */
function mergedContains(t: Transaction, row: ParsedRow): boolean {
  if (!mergedComparable(t, row)) return false
  return t.merged!.some(
    (m) =>
      m.bank &&
      m.date === row.date &&
      normalizeText(m.merchant) === normalizeText(row.merchant) &&
      normalizeText(m.note) === normalizeText(row.note),
  )
}

function mergedComparable(t: Transaction, row: ParsedRow): boolean {
  if (row.ref || !hasBankEntry(t) || t.amount !== row.amount) return false
  // 合并时可能改成了转账（钱包提现到银行卡），类型不再一致
  return t.type === 'transfer' || t.type === row.type
}

/**
 * 同一份银行流水换了格式再导入（如先 PDF 后 Excel）：摘要、对手写法可能不同，记账日也可能差一天。
 * 同一张卡、日期相差不超过 1 天，并且对手相似（都有对手时比对手，否则比摘要），或这一行没有文字。
 */
function mergedLooselyContains(t: Transaction, row: ParsedRow, accountId: number, maxDiff: number): boolean {
  if (!mergedComparable(t, row) || (t.accountId !== accountId && t.transferAccountId !== accountId)) return false
  return t.merged!.some((m) => {
    if (!m.bank || dayDiff(m.date, row.date) > maxDiff) return false
    if (!normalizeText(row.merchant) && !normalizeText(row.note)) return true
    if (row.merchant && m.merchant) return similarity(companyText(row.merchant), companyText(m.merchant)) >= 0.4
    return similarity(row.merchant ?? row.note, m.merchant ?? m.note) >= 0.5
  })
}

/**
 * 疑似重复：类型和金额相同，并且满足其一：
 * - 已合并进这条流水的银行流水里有完全相同的一行（重复导入同一份银行流水）；
 * - 同一天，且已有流水是手记的（手记备注往往和账单商户写法不同）或任一方没有商户 / 备注；
 * - 日期相差不超过 1 天，且商户 / 备注相似（相似度 ≥ 0.5）。
 * 双方都有交易单号时只按单号精确比对；一方有、一方没有的是钱包账单与银行流水（或手记），见 findMergeTarget。
 * exclude 里的流水（已被本批次前面的行认领）不再参与比对，保证一笔已有流水只对应一行。
 */
export function findDuplicate(row: ParsedRow, candidates: Transaction[], exclude?: ReadonlySet<Transaction>): Transaction | undefined {
  return candidates.find((t) => {
    if (exclude?.has(t)) return false
    if (mergedContains(t, row)) return true
    if (row.ref && t.externalId) return row.ref === t.externalId
    if (!row.ref !== !t.externalId) return false
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

/** 钱包账单的来源 */
const WALLETS: ReadonlySet<ImportSource> = new Set(['wechat', 'alipay', 'douyin'])

/** 银行流水摘要 / 对手里指明的支付渠道 */
const CHANNELS: [RegExp, ImportSource][] = [
  [/财付通|微信/, 'wechat'],
  [/支付宝|蚂蚁|余额宝|网商银行/, 'alipay'],
  [/抖音|字节跳动|合众易宝/, 'douyin'],
]

export function channelOf(text: string): ImportSource | undefined {
  return CHANNELS.find(([re]) => re.test(text))?.[1]
}

/** 钱包账单的付款方式是银行卡，如「招商银行(1234)」「储蓄卡」 */
const CARD_PAID = /银行|信用卡|储蓄卡|借记卡|[(（]\s*(?:尾号)?\d{4}\s*[)）]/

/** 钱包里转到银行卡的钱（提现、余额宝转出等），与银行入账合并后是本人账户间的转账 */
const SELF_TRANSFER = /提现|转出到银行卡|转出到余额|余利宝转出|赎回/

/** 比对商户前去掉公司名里的通用字，「成都西山居世游科技有限公司」与「西山居游戏」才比得上 */
const companyText = (text: string | undefined) => text?.replace(/有限责任公司|有限公司|股份|集团|科技|信息|网络|技术/g, '')

const isCard = (type: AccountType | undefined) => type === 'debit' || type === 'credit'
const isWalletAccount = (type: AccountType | undefined) => type === 'wechat' || type === 'alipay'

export interface MergeContext {
  /** 本次导入的账单来源 */
  source?: ImportSource
  /** 已有流水来自哪种账单（按导入批次）；用来排除渠道对不上的配对 */
  sourceOf?: (t: Transaction) => ImportSource | undefined
  /** 账户 ID → 账户类型；两边都落在银行卡账户却不是同一张卡时不配对 */
  accountTypeOf?: (id: number) => AccountType | undefined
}

export interface MergeMatch {
  tx: Transaction
  /** 账户、渠道或商户对得上；false 表示只有金额和日期对得上，或已有那条是手记 */
  strong: boolean
}

/** 已有流水 t 还能不能和这一行合并：一方有单号、一方没有，类型和金额相同，t 还没合并过银行流水 */
export function canMerge(t: Transaction, row: ParsedRow): boolean {
  if (hasBankEntry(t) || !row.ref === !t.externalId) return false
  return t.type !== 'transfer' && t.type === row.type && t.amount === row.amount
}

/**
 * 钱包账单与银行流水里的同一笔钱：用银行卡付款时，同一笔钱会同时出现在两份账单里。
 * 条件：canMerge，日期相差不超过 1 天；银行流水里写明的渠道（财付通、支付宝等）与钱包来源不冲突；
 * 钱包那一侧落在某张银行卡账户上时，必须就是银行流水那张卡。以下任一成立时算对得上（strong）：
 * - 入账账户相同（钱包付款方式已对应到这张卡）；
 * - 钱包账单的付款方式是银行卡；
 * - 银行流水写明的渠道就是这个钱包；
 * - 商户相似（相似度 ≥ 0.4）。
 * 都不成立时仍作为候选返回（strong 为 false），由用户决定是否合并。
 * 已有那条是手记时，只有同一天或商户相似才作为候选，而且一律不默认合并，免得改动手记的内容。
 * 一行有多个候选时取最像的一个；exclude 里的流水（已被认领）不参与；strongOnly 时只找对得上的。
 */
export function findMergeTarget(
  row: ParsedRow,
  candidates: Transaction[],
  accountId: number,
  ctx: MergeContext = {},
  exclude?: ReadonlySet<Transaction>,
  strongOnly = false,
): MergeMatch | undefined {
  let best: MergeMatch | undefined
  let bestScore = -1
  for (const t of candidates) {
    if (exclude?.has(t) || !canMerge(t, row)) continue
    const diff = dayDiff(t.date, row.date)
    if (diff > 1) continue
    const plain = row.ref ? { merchant: t.merchant, note: t.note } : { merchant: row.merchant, note: row.note }
    const walletText = row.ref ? { merchant: row.merchant, note: row.note } : { merchant: t.merchant, note: t.note }
    const similarity04 =
      Math.max(
        similarity(companyText(plain.merchant), companyText(walletText.merchant)),
        similarity(companyText(plain.merchant), companyText(walletText.note)),
        similarity(plain.note, walletText.merchant),
      ) >= 0.4
    const manual = !!row.ref && t.source === 'manual'
    if (manual && diff > 0 && !similarity04) continue
    const walletSource = row.ref ? ctx.source : ctx.sourceOf?.(t)
    const wallet = walletSource && WALLETS.has(walletSource) ? walletSource : undefined
    const channel = channelOf(`${plain.merchant ?? ''} ${plain.note ?? ''}`)
    if (channel && wallet && channel !== wallet) continue
    const walletAccount = row.ref ? accountId : t.accountId
    const bankAccount = row.ref ? t.accountId : accountId
    if (!manual && walletAccount !== bankAccount && isCard(ctx.accountTypeOf?.(walletAccount))) continue
    const sameAccount = walletAccount === bankAccount
    const cardPaid = !!row.ref && !!row.accountName && CARD_PAID.test(row.accountName)
    const viaChannel = !!channel && channel === wallet
    const strong = !manual && (sameAccount || cardPaid || viaChannel || similarity04)
    if (strongOnly && !strong) continue
    const score = (sameAccount ? 4 : 0) + (viaChannel ? 2 : 0) + (similarity04 ? 2 : 0) + (cardPaid ? 1 : 0) + (diff === 0 ? 1 : 0)
    if (score > bestScore) {
      best = { tx: t, strong }
      bestScore = score
    }
  }
  return best
}

/** 钱包提现、转出到银行卡的收入与银行入账合并时，改成从钱包账户到银行账户的转账 */
function transferOf(
  row: ParsedRow,
  accountId: number,
  target: Transaction,
  ctx: MergeContext & { walletAccountOf: (source: ImportSource | undefined) => number | undefined },
): PreviewItem['mergeAsTransfer'] {
  if (row.type !== 'income' || target.source === 'manual') return undefined
  const walletText = row.ref ? `${row.merchant ?? ''} ${row.note ?? ''}` : `${target.merchant ?? ''} ${target.note ?? ''}`
  if (!SELF_TRANSFER.test(walletText)) return undefined
  const type = ctx.accountTypeOf ?? (() => undefined)
  // 钱包那条按付款方式落到了银行卡上时，转出账户用这个钱包来源对应的钱包账户
  const walletSide = row.ref ? accountId : target.accountId
  const from = isWalletAccount(type(walletSide)) ? walletSide : ctx.walletAccountOf(row.ref ? ctx.source : ctx.sourceOf?.(target)) ?? walletSide
  const to = row.ref ? target.accountId : accountId
  return from !== to ? { from, to } : undefined
}

export interface MergeLabels {
  /** 本次导入的账单名，如「招商银行流水」 */
  incoming: string
  /** 已有那条的来源说明，如「中信银行流水」「手记」 */
  existing: string
  /** 账户 ID → 账户名 */
  accountName: (id: number) => string | undefined
}

function compact<T extends object>(value: T): T {
  for (const key of Object.keys(value) as (keyof T)[]) {
    if (value[key] === undefined) delete value[key]
  }
  return value
}

/**
 * 把预览行合并进已有流水，返回合并后的流水（不含 updatedAt 的更新）：
 * - 钱包 × 银行流水：保留钱包的日期、时间、商户、备注和交易单号（钱包没有的沿用原来的），
 *   账户用银行卡（钱实际从这张卡出），银行流水原文存进 merged（bank 为 true）；
 * - 钱包 × 手记：手记的内容不动，只补上交易单号和手记没写的字段，钱包那行存进 merged；
 * - mergeAsTransfer 时改成本人账户间的转账，去掉分类。
 * 分类以已有那条为准，没有时用预览行的。
 */
export function mergeTransaction(existing: Transaction, item: PreviewItem, labels: MergeLabels): Transaction {
  const { row } = item
  const incomingWallet = !!row.ref
  const line = (t: { date: string; time?: string; merchant?: string; note?: string }, label: string, account: number, bank: boolean): MergedEntry =>
    compact({ label, date: t.date, time: t.time, merchant: t.merchant, note: t.note, account: labels.accountName(account), bank: bank || undefined })
  let next: Transaction
  let entry: MergedEntry
  if (!incomingWallet) {
    next = { ...existing, accountId: item.accountId }
    entry = line(row, labels.incoming, item.accountId, true)
  } else if (existing.source === 'manual') {
    next = {
      ...existing,
      time: existing.time ?? row.time,
      merchant: existing.merchant ?? row.merchant,
      note: existing.note ?? row.note,
      externalId: row.ref,
    }
    entry = line(row, labels.incoming, item.accountId, false)
  } else {
    next = {
      ...existing,
      date: row.date,
      time: row.time ?? existing.time,
      merchant: row.merchant ?? existing.merchant,
      note: row.note ?? existing.note,
      externalId: row.ref,
    }
    entry = line(existing, labels.existing, existing.accountId, true)
  }
  next.categoryId = existing.categoryId ?? item.categoryId
  next.merged = [...(existing.merged ?? []), entry]
  if (item.mergeAsTransfer) {
    next.type = 'transfer'
    next.accountId = item.mergeAsTransfer.from
    next.transferAccountId = item.mergeAsTransfer.to
    delete next.categoryId
  }
  return compact(next)
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

export interface PreviewContext extends ClassifyContext, MergeContext {
  accounts: Account[]
  defaultAccountId: number
  /** 日期范围内（前后各多 1 天）的已有流水，用于去重 */
  existing: Transaction[]
}

/** 钱包来源对应的账户类型 */
const WALLET_ACCOUNT: Partial<Record<ImportSource, AccountType>> = { wechat: 'wechat', alipay: 'alipay' }

/**
 * 组装预览：去重、合并、自动分类、匹配账户。疑似重复和忽略的行默认不勾选，能合并的行默认勾选。
 * 认领已有流水的顺序：精确重复 → 换格式的已合并银行流水 → 对得上的合并 → 只有金额日期对得上的合并候选；
 * 忽略的行不参与合并。
 */
export function buildPreview(rows: ParsedRow[], ctx: PreviewContext): PreviewItem[] {
  const seen = new Set<string>()
  const claimed = new Set<Transaction>()
  const types = new Map(ctx.accounts.map((a) => [a.id, a.type]))
  const mergeCtx = {
    ...ctx,
    accountTypeOf: ctx.accountTypeOf ?? ((id: number) => types.get(id)),
    walletAccountOf: (source: ImportSource | undefined) => {
      const type = source && WALLET_ACCOUNT[source]
      return type ? ctx.accounts.find((a) => a.type === type && !a.archived)?.id : undefined
    },
  }
  const items = rows.map((row, key): PreviewItem => {
    const item: PreviewItem = {
      key,
      row,
      accountId: matchAccount(row.accountName, ctx.accounts, ctx.defaultAccountId),
      selected: false,
    }
    const dup = findDuplicate(row, ctx.existing, claimed)
    const bk = batchKey(row)
    if (dup) {
      item.duplicateOf = dup
      claimed.add(dup)
    } else if (bk && seen.has(bk)) item.duplicateOf = 'batch'
    if (bk) seen.add(bk)
    return item
  })
  // 换格式重新导入已合并的银行流水：等整份文件的精确重复都认领完再找，先找同一天的，再找差一天的；
  // 差一天时，这一行若有对得上的合并对象，留给合并
  for (const maxDiff of [0, 1]) {
    for (const item of items) {
      if (item.duplicateOf || item.row.ref) continue
      if (maxDiff > 0 && findMergeTarget(item.row, ctx.existing, item.accountId, mergeCtx, claimed, true)) continue
      const dup = ctx.existing.find((t) => !claimed.has(t) && mergedLooselyContains(t, item.row, item.accountId, maxDiff))
      if (dup) {
        item.duplicateOf = dup
        claimed.add(dup)
      }
    }
  }
  const open = items.filter((i) => !i.duplicateOf && !i.row.skipReason)
  for (const strongOnly of [true, false]) {
    for (const item of open) {
      if (item.mergeWith) continue
      const merge = findMergeTarget(item.row, ctx.existing, item.accountId, mergeCtx, claimed, strongOnly)
      if (!merge) continue
      item.mergeWith = merge.tx
      if (!merge.strong) item.weakMerge = true
      const transfer = transferOf(item.row, item.accountId, merge.tx, mergeCtx)
      if (transfer) item.mergeAsTransfer = transfer
      claimed.add(merge.tx)
    }
  }
  for (const item of items) {
    const hit = classify(item.row, ctx)
    if (hit) {
      item.categoryId = hit.categoryId
      item.categorySource = hit.source
      if (hit.rule) item.rule = hit.rule
    }
    const status = statusOf(item)
    item.selected = status === 'new' || status === 'uncategorized' || status === 'merge'
  }
  return items
}

/** 合并后仍没有分类：两边都没分类，且不是转账 */
export function mergedUncategorized(item: PreviewItem): boolean {
  return !!item.mergeWith && !item.mergeAsTransfer && item.mergeWith.categoryId === undefined && item.categoryId === undefined
}

export interface PreviewSummary {
  total: number
  new: number
  merge: number
  duplicate: number
  uncategorized: number
  ignored: number
  selected: number
  /** 已勾选但没有分类的行数，将以「未分类」入账 */
  selectedUncategorized: number
}

export function summarizePreview(items: PreviewItem[]): PreviewSummary {
  const s: PreviewSummary = { total: items.length, new: 0, merge: 0, duplicate: 0, uncategorized: 0, ignored: 0, selected: 0, selectedUncategorized: 0 }
  for (const item of items) {
    s[statusOf(item)]++
    if (item.selected) {
      s.selected++
      if (item.mergeWith ? mergedUncategorized(item) : item.categoryId === undefined) s.selectedUncategorized++
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

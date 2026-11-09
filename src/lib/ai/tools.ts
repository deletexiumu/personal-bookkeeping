import type { ToolCall } from '../../../server/src/ai/core.ts'
import type { Account, Budget, Category, Transaction } from '../../types'
import { periodStats, merchantOf, matchKeywords, parseKeywords } from '../analysis'
import { computeBalances } from '../balance'
import { statType } from '../stats'

/**
 * AI 助手的工具在本机执行：账单数据就在这台设备的 IndexedDB 里，模型要什么才查什么，
 * 只把汇总和少量明细发给 AI 接口。工具定义（名称、参数）见 server/src/ai/core.ts 的 TOOLS。
 */

/** 工具读取账本的方式；页面里用 Dexie，测试里用数组 */
export interface LedgerSource {
  listRange(start: string, end: string): Promise<Transaction[]>
  allTransactions(): Promise<Transaction[]>
  categories(): Promise<Category[]>
  accounts(): Promise<Account[]>
  budgets(): Promise<Budget[]>
}

/** 单个工具结果的长度上限（字），超出时减少明细条数 */
export const MAX_TOOL_RESULT = 12_000

const DATE = /^\d{4}-\d{2}-\d{2}$/

/** 分转元，保留两位小数 */
export function yuan(cents: number): number {
  return Math.round(cents) / 100
}

const TYPE_TEXT = { expense: '支出', income: '收入', transfer: '转账' } as const

class ToolInputError extends Error {}

function str(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key]
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}

function num(args: Record<string, unknown>, key: string): number | undefined {
  const v = args[key]
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN
  return Number.isFinite(n) ? n : undefined
}

function range(args: Record<string, unknown>): { start: string; end: string } {
  const start = str(args, 'start')
  const end = str(args, 'end')
  if (!start || !end || !DATE.test(start) || !DATE.test(end)) throw new ToolInputError('start 和 end 必须是 YYYY-MM-DD 格式的日期')
  return start <= end ? { start, end } : { start: end, end: start }
}

function clampLimit(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined) return fallback
  return Math.max(1, Math.min(max, Math.floor(value)))
}

/** 按名称找分类或账户：先精确（不区分大小写），找不到再找包含的 */
function findByName<T extends { id?: number; name: string }>(list: T[], name: string | undefined): Set<number> | undefined {
  if (!name) return undefined
  const lower = name.toLowerCase()
  const exact = list.filter((x) => x.name.toLowerCase() === lower)
  const matched = exact.length ? exact : list.filter((x) => x.name.toLowerCase().includes(lower))
  return new Set(matched.map((x) => x.id!).filter((id) => id !== undefined))
}

interface Names {
  category: Map<number | undefined, string>
  account: Map<number | undefined, string>
}

function names(categories: Category[], accounts: Account[]): Names {
  return {
    category: new Map(categories.map((c) => [c.id, c.name])),
    account: new Map(accounts.map((a) => [a.id, a.name])),
  }
}

// ---------------------------------------------------------------------------
// query_summary
// ---------------------------------------------------------------------------

type GroupBy = 'category' | 'merchant' | 'account' | 'month' | 'day' | 'none'

export async function querySummary(source: LedgerSource, args: Record<string, unknown>) {
  const { start, end } = range(args)
  const groupBy = (['category', 'merchant', 'account', 'month', 'day', 'none'] as const).find((g) => g === args.groupBy) ?? 'category'
  const type = (['expense', 'income', 'all'] as const).find((t) => t === args.type) ?? 'expense'
  const keyword = str(args, 'keyword')
  const categoryName = str(args, 'category')
  const chronological = groupBy === 'month' || groupBy === 'day'
  const limit = clampLimit(num(args, 'limit'), chronological ? 50 : 15, 50)

  const [all, categories, accounts] = await Promise.all([source.listRange(start, end), source.categories(), source.accounts()])
  const n = names(categories, accounts)
  const keywords = keyword ? parseKeywords(keyword) : []
  const categoryIds = findByName(categories, categoryName)
  if (categoryIds && categoryIds.size === 0) {
    return { error: `没有叫「${categoryName}」的分类`, categories: categories.filter((c) => !c.archived).map((c) => c.name) }
  }
  const rows = all.filter((t) => matchKeywords(t, keywords) && (!categoryIds || (t.categoryId !== undefined && categoryIds.has(t.categoryId))))
  const stats = periodStats(rows)
  const notCounted = {
    transfers: rows.filter((t) => t.type === 'transfer').length,
    excluded: rows.filter((t) => t.type !== 'transfer' && t.excluded).length,
  }

  const result: Record<string, unknown> = {
    range: { start, end },
    filter: { keyword: keyword || undefined, category: categoryName || undefined },
    income: yuan(stats.income),
    expense: yuan(stats.expense),
    balance: yuan(stats.balance),
    count: stats.count,
    notCounted,
  }
  if (groupBy === 'none') return result

  const keyOf = (t: Transaction): string => {
    if (groupBy === 'category') return n.category.get(t.categoryId) ?? '未分类'
    if (groupBy === 'merchant') return merchantOf(t) ?? '（无商户）'
    if (groupBy === 'account') return n.account.get(t.accountId) ?? '未知账户'
    if (groupBy === 'month') return t.date.slice(0, 7)
    return t.date
  }
  const groups = new Map<string, { income: number; expense: number; count: number }>()
  for (const t of rows) {
    const st = statType(t)
    if (!st || (type !== 'all' && st !== type)) continue
    const key = keyOf(t)
    const g = groups.get(key) ?? { income: 0, expense: 0, count: 0 }
    g[st] += t.amount
    g.count++
    groups.set(key, g)
  }
  const total = type === 'income' ? stats.income : type === 'expense' ? stats.expense : stats.income + stats.expense
  let list = [...groups].map(([name, g]) => ({ name, ...g, sum: g.income + g.expense }))
  list.sort(chronological ? (a, b) => a.name.localeCompare(b.name) : (a, b) => b.sum - a.sum || b.count - a.count)
  const truncated = list.length > limit ? list.length - limit : 0
  const rest = truncated ? list.slice(limit) : []
  list = list.slice(0, limit)
  result.groupBy = groupBy
  result.groupType = type
  result.groups = list.map((g) =>
    type === 'all'
      ? { name: g.name, income: yuan(g.income), expense: yuan(g.expense), net: yuan(g.income - g.expense), count: g.count }
      : { name: g.name, amount: yuan(g.sum), count: g.count, share: total > 0 ? Math.round((g.sum / total) * 1000) / 1000 : 0 },
  )
  if (truncated) {
    result.otherGroups = { groups: truncated, amount: yuan(rest.reduce((s, g) => s + g.sum, 0)), count: rest.reduce((s, g) => s + g.count, 0) }
  }
  return result
}

// ---------------------------------------------------------------------------
// query_transactions
// ---------------------------------------------------------------------------

export function transactionView(t: Transaction, n: Names) {
  return {
    date: t.date,
    time: t.time,
    type: TYPE_TEXT[t.type],
    amount: yuan(t.amount),
    category: t.type === 'transfer' ? undefined : (n.category.get(t.categoryId) ?? '未分类'),
    account: n.account.get(t.accountId) ?? '未知账户',
    toAccount: t.type === 'transfer' ? (n.account.get(t.transferAccountId) ?? '未知账户') : undefined,
    merchant: t.merchant?.slice(0, 60) || undefined,
    note: t.note?.slice(0, 80) || undefined,
    tags: t.tags?.length ? t.tags : undefined,
    excluded: t.excluded || undefined,
  }
}

export async function queryTransactions(source: LedgerSource, args: Record<string, unknown>) {
  const { start, end } = range(args)
  const type = (['expense', 'income', 'transfer', 'all'] as const).find((t) => t === args.type) ?? 'all'
  const includeExcluded = args.includeExcluded === true
  const keywords = parseKeywords(str(args, 'keyword') ?? '')
  const minAmount = num(args, 'minAmount')
  const sort = args.sort === 'amount' ? 'amount' : 'date'
  const limit = clampLimit(num(args, 'limit'), 30, 100)

  const [all, categories, accounts] = await Promise.all([source.listRange(start, end), source.categories(), source.accounts()])
  const n = names(categories, accounts)
  const categoryIds = findByName(categories, str(args, 'category'))
  const accountIds = findByName(accounts, str(args, 'account'))
  if (categoryIds?.size === 0) return { error: `没有叫「${str(args, 'category')}」的分类`, categories: categories.map((c) => c.name) }
  if (accountIds?.size === 0) return { error: `没有叫「${str(args, 'account')}」的账户`, accounts: accounts.map((a) => a.name) }

  const rows = all.filter((t) => {
    if (type === 'transfer') {
      if (t.type !== 'transfer') return false
    } else {
      if (t.type === 'transfer') return false
      if (t.excluded && !includeExcluded) return false
      if (type !== 'all' && t.type !== type) return false
    }
    if (categoryIds && (t.categoryId === undefined || !categoryIds.has(t.categoryId))) return false
    if (accountIds && !accountIds.has(t.accountId) && (t.transferAccountId === undefined || !accountIds.has(t.transferAccountId))) return false
    if (minAmount !== undefined && t.amount < Math.round(minAmount * 100)) return false
    return matchKeywords(t, keywords)
  })
  rows.sort(
    sort === 'amount'
      ? (a, b) => b.amount - a.amount || b.date.localeCompare(a.date)
      : (a, b) => b.date.localeCompare(a.date) || (b.time ?? '').localeCompare(a.time ?? '') || b.amount - a.amount,
  )
  const stats = periodStats(rows)
  let list = rows.slice(0, limit).map((t) => transactionView(t, n))
  const result = () => ({
    range: { start, end },
    matched: rows.length,
    matchedIncome: yuan(stats.income),
    matchedExpense: yuan(stats.expense),
    sort,
    returned: list.length,
    transactions: list,
  })
  while (JSON.stringify(result()).length > MAX_TOOL_RESULT && list.length > 5) list = list.slice(0, Math.floor(list.length * 0.7))
  return result()
}

// ---------------------------------------------------------------------------
// list_ledger
// ---------------------------------------------------------------------------

export async function listLedger(source: LedgerSource) {
  const [all, categories, accounts, budgets] = await Promise.all([
    source.allTransactions(),
    source.categories(),
    source.accounts(),
    source.budgets(),
  ])
  const balances = computeBalances(accounts, all)
  const n = names(categories, accounts)
  let first: string | undefined
  let last: string | undefined
  for (const t of all) {
    if (!first || t.date < first) first = t.date
    if (!last || t.date > last) last = t.date
  }
  return {
    transactions: { count: all.length, firstDate: first, lastDate: last },
    categories: categories.map((c) => ({ name: c.name, type: TYPE_TEXT[c.type], archived: c.archived || undefined })),
    accounts: accounts.map((a) => ({ name: a.name, type: a.type, balance: yuan(balances.get(a.id!) ?? 0), archived: a.archived || undefined })),
    monthlyBudgets: budgets.map((b) => ({ category: b.categoryId === undefined ? '总预算' : (n.category.get(b.categoryId) ?? '未知分类'), amount: yuan(b.amount) })),
  }
}

// ---------------------------------------------------------------------------

/** 执行一次工具调用，结果为 JSON 文本；参数不对时返回错误说明让模型改了再查 */
export async function runTool(source: LedgerSource, call: ToolCall): Promise<string> {
  let result: unknown
  try {
    if (call.name === 'query_summary') result = await querySummary(source, call.args)
    else if (call.name === 'query_transactions') result = await queryTransactions(source, call.args)
    else if (call.name === 'list_ledger') result = await listLedger(source)
    else result = { error: `没有 ${call.name} 这个工具` }
  } catch (err) {
    result = { error: err instanceof ToolInputError ? err.message : '查询失败' }
    if (!(err instanceof ToolInputError)) console.error(err)
  }
  const text = JSON.stringify(result)
  return text.length > MAX_TOOL_RESULT ? `${text.slice(0, MAX_TOOL_RESULT)}…（结果太长已截断）` : text
}

/** 工具调用的中文说明，显示在对话里 */
export function describeToolCall(call: ToolCall): string {
  const a = call.args
  const span = typeof a.start === 'string' && typeof a.end === 'string' ? `${a.start} 至 ${a.end}` : ''
  const extra = [a.category, a.account, a.keyword].filter((v): v is string => typeof v === 'string' && !!v).map((v) => `「${v}」`).join('')
  if (call.name === 'query_summary') {
    const by = { category: '按分类', merchant: '按商户', account: '按账户', month: '按月', day: '按天', none: '' }[a.groupBy as GroupBy] ?? '按分类'
    return `汇总 ${span}${extra} ${by}`.trim()
  }
  if (call.name === 'query_transactions') return `查看 ${span}${extra} 的明细`
  if (call.name === 'list_ledger') return '查看分类、账户和预算'
  return call.name
}

import type { TagRule, Transaction } from '../types'
import { merchantOf } from './merchant'
import { statType } from './stats'

/** 标签名最长多少字 */
export const MAX_TAG_LENGTH = 12

/** 解析标签输入：「#家庭 #周末」「家庭，周末」都得到 ['家庭', '周末']，去重保序 */
export function parseTags(input: string): string[] {
  const tags = input
    .split(/[\s,，、#＃]+/)
    .map((t) => t.trim())
    .filter(Boolean)
  return [...new Set(tags)]
}

export function formatTags(tags: string[] | undefined): string {
  return (tags ?? []).map((t) => `#${t}`).join(' ')
}

/** 规整一组标签：去空白、去 #、去重保序，空数组返回 undefined（表示没有标签） */
export function normalizeTags(tags: readonly string[] | undefined): string[] | undefined {
  const list = parseTags((tags ?? []).join(' '))
  return list.length > 0 ? list : undefined
}

/**
 * 由文字算出稳定的短编号（16 位十六进制），用作标签和商户标签的 uid：
 * 两台设备各自给同一商户打标签、新建同名标签时，同步时认作同一条，不会出现两份
 */
export function stableHash(text: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 2654435761)
    h2 = Math.imul(h2 ^ c, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, '0')
  return hex(h2) + hex(h1)
}

export const tagUid = (name: string) => `tag-${stableHash(name)}`
export const tagRuleUid = (merchant: string) => `tagrule-${stableHash(merchant)}`

/** 一笔流水实际生效的标签从哪来：单笔自己打的、沿用商户标签，或者还没有标签 */
export type TagOrigin = 'own' | 'merchant' | 'none'

export interface TagResolver {
  /** 实际生效的标签：单笔自己有标签时用自己的，否则用商户标签 */
  (t: Transaction): string[]
  origin(t: Transaction): TagOrigin
  /** 某商户的商户标签 */
  merchantTags(merchant: string | undefined): string[] | undefined
}

/** 按商户标签算出每笔流水实际生效的标签 */
export function makeTagResolver(rules: readonly TagRule[]): TagResolver {
  const byMerchant = new Map<string, string[]>()
  for (const r of rules) {
    const key = r.merchant.trim()
    if (key && r.tags.length > 0) byMerchant.set(key, r.tags)
  }
  const merchantTags = (merchant: string | undefined) => (merchant ? byMerchant.get(merchant) : undefined)
  const resolve = ((t: Transaction) => {
    if (t.tags && t.tags.length > 0) return t.tags
    return merchantTags(merchantOf(t)) ?? []
  }) as TagResolver
  resolve.origin = (t) => {
    if (t.tags && t.tags.length > 0) return 'own'
    return merchantTags(merchantOf(t)) ? 'merchant' : 'none'
  }
  resolve.merchantTags = merchantTags
  return resolve
}

/** 没有任何商户标签时的解析器：只看单笔标签 */
export const ownTagsOnly: TagResolver = makeTagResolver([])

/** 把实际生效的标签写进流水副本（给 AI 助手、导出 CSV 用），不改原对象 */
export function withEffectiveTags(rows: Transaction[], resolve: TagResolver): Transaction[] {
  return rows.map((t) => {
    if (resolve.origin(t) !== 'merchant') return t
    return { ...t, tags: resolve(t) }
  })
}

/** 待标注列表中的一组：同一商户（没有商户时按备注）还没有标签的收支 */
export interface UntaggedGroup {
  /** 商户名；undefined 表示既没有商户也没有备注 */
  merchant?: string
  rows: Transaction[]
  expense: number
  income: number
  /** 最近一笔的日期 */
  lastDate: string
}

/** 还没有标签的收支（不含转账和不计收支的），按商户归组，收支总额大的在前 */
export function untaggedGroups(rows: readonly Transaction[], resolve: TagResolver): UntaggedGroup[] {
  const groups = new Map<string | undefined, UntaggedGroup>()
  for (const t of rows) {
    const type = statType(t)
    if (!type || resolve(t).length > 0) continue
    const merchant = merchantOf(t)
    const group = groups.get(merchant) ?? { merchant, rows: [], expense: 0, income: 0, lastDate: t.date }
    group.rows.push(t)
    group[type] += t.amount
    if (t.date > group.lastDate) group.lastDate = t.date
    groups.set(merchant, group)
  }
  return [...groups.values()].sort(
    (a, b) =>
      Number(a.merchant === undefined) - Number(b.merchant === undefined) ||
      b.expense + b.income - (a.expense + a.income) ||
      b.rows.length - a.rows.length,
  )
}

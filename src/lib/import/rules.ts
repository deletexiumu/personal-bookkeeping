import type { Category, CategoryRule, RuleField, RuleMatch } from '../../types'
import type { ParsedRow } from './table'

export const RULE_FIELD_LABELS: Record<RuleField, string> = {
  merchant: '商户',
  note: '备注',
  any: '商户或备注',
}

export const RULE_MATCH_LABELS: Record<RuleMatch, string> = {
  contains: '包含',
  equals: '等于',
}

const norm = (s: string | undefined) => (s ?? '').trim().toLowerCase()

/** 单条规则是否命中（不区分大小写） */
export function ruleMatches(rule: CategoryRule, row: Pick<ParsedRow, 'merchant' | 'note'>): boolean {
  const keyword = norm(rule.keyword)
  if (!keyword) return false
  const targets = rule.field === 'merchant' ? [row.merchant] : rule.field === 'note' ? [row.note] : [row.merchant, row.note]
  return targets.some((t) => {
    const text = norm(t)
    return rule.match === 'equals' ? text === keyword : text.includes(keyword)
  })
}

/** 按优先级找第一条命中、且分类与流水方向一致的规则 */
export function findRule(row: ParsedRow, rules: CategoryRule[], categories: Category[]): CategoryRule | undefined {
  const usable = new Map(categories.filter((c) => !c.archived && c.type === row.type).map((c) => [c.id, c]))
  return rules.find((r) => usable.has(r.categoryId) && ruleMatches(r, row))
}

/** 规则的可读描述，例如「商户包含「星巴克」」 */
export function describeRule(rule: Pick<CategoryRule, 'field' | 'match' | 'keyword'>): string {
  return `${RULE_FIELD_LABELS[rule.field]}${RULE_MATCH_LABELS[rule.match]}「${rule.keyword}」`
}

/** 预览中「记住」生成的规则：有商户按商户包含，否则按备注包含 */
export function ruleFromRow(row: Pick<ParsedRow, 'merchant' | 'note'>, categoryId: number): Omit<CategoryRule, 'id'> | undefined {
  if (row.merchant?.trim()) return { field: 'merchant', match: 'contains', keyword: row.merchant.trim(), categoryId }
  if (row.note?.trim()) return { field: 'note', match: 'contains', keyword: row.note.trim(), categoryId }
  return undefined
}

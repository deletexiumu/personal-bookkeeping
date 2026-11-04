import { describe, expect, it } from 'vitest'
import type { Category, CategoryRule } from '../../types'
import { classify } from './preview'
import { describeRule, findRule, ruleFromRow, ruleMatches } from './rules'
import { detectUserTemplate, sniffText, suggestTemplateName } from './sniff'
import type { ParsedRow } from './table'

const categories: Category[] = [
  { id: 1, name: '餐饮', type: 'expense' },
  { id: 3, name: '咖啡', type: 'expense' },
  { id: 9, name: '旧', type: 'expense', archived: true },
  { id: 8, name: '工资', type: 'income' },
]
const rule = (patch: Partial<CategoryRule>): CategoryRule => ({ field: 'merchant', match: 'contains', keyword: '星巴克', categoryId: 3, ...patch })
const row = (patch: Partial<ParsedRow>): ParsedRow => ({ line: 2, date: '2026-10-31', type: 'expense', amount: 100, ...patch })

describe('规则匹配', () => {
  it('按字段与方式匹配，不区分大小写', () => {
    expect(ruleMatches(rule({}), { merchant: '星巴克咖啡' })).toBe(true)
    expect(ruleMatches(rule({}), { note: '星巴克' })).toBe(false)
    expect(ruleMatches(rule({ field: 'any' }), { note: '星巴克' })).toBe(true)
    expect(ruleMatches(rule({ match: 'equals' }), { merchant: '星巴克咖啡' })).toBe(false)
    expect(ruleMatches(rule({ keyword: 'KFC' }), { merchant: 'kfc 宅急送' })).toBe(true)
    expect(ruleMatches(rule({ keyword: ' ' }), { merchant: '星巴克' })).toBe(false)
  })

  it('按顺序取第一条命中且方向一致、分类未归档的规则', () => {
    const rules = [rule({ id: 1, categoryId: 9 }), rule({ id: 2, categoryId: 8 }), rule({ id: 3, categoryId: 3 }), rule({ id: 4, categoryId: 1 })]
    expect(findRule(row({ merchant: '星巴克' }), rules, categories)?.id).toBe(3)
  })

  it('规则优先于文件分类和关键词', () => {
    const ctx = { categories, rules: [rule({ keyword: '美团' , categoryId: 3 })], merchantHistory: new Map() }
    expect(classify(row({ merchant: '美团外卖', categoryName: '餐饮' }), ctx)).toMatchObject({ categoryId: 3, source: 'rule' })
  })

  it('描述与「记住」生成的规则', () => {
    expect(describeRule(rule({}))).toBe('商户包含「星巴克」')
    expect(ruleFromRow({ merchant: ' 星巴克 ', note: '拿铁' }, 3)).toEqual({ field: 'merchant', match: 'contains', keyword: '星巴克', categoryId: 3 })
    expect(ruleFromRow({ note: '午饭' }, 1)).toEqual({ field: 'note', match: 'contains', keyword: '午饭', categoryId: 1 })
    expect(ruleFromRow({}, 1)).toBeUndefined()
  })
})

describe('用户模板', () => {
  const template = {
    id: 1,
    name: '招行信用卡',
    headers: ['交易日期', '摘要', '金额'],
    columns: ['date', 'note', 'amount'] as const,
    amountSign: 'positive-expense' as const,
    createdAt: 1,
  }

  it('表头一致（忽略空白和末尾空列）时命中', () => {
    const lines = [['说明'], [' 交易日期', '摘要 ', '金额', ''], ['2026-10-31', '午饭', '12.00']]
    expect(detectUserTemplate(lines, [{ ...template, columns: [...template.columns] }])?.headerRow).toBe(1)
    expect(detectUserTemplate([['交易日期', '摘要']], [{ ...template, columns: [...template.columns] }])).toBeUndefined()
  })

  it('sniffText 套用模板映射', () => {
    const csv = '交易日期,摘要,金额\n2026-10-31,午饭,12.00'
    const sniff = sniffText(new TextEncoder().encode(csv), [{ ...template, columns: [...template.columns] }])
    expect(sniff.userTemplate?.name).toBe('招行信用卡')
    expect(sniff.mapping.map((m) => m.field)).toEqual(['date', 'note', 'amount'])
  })

  it('由文件名推荐模板名', () => {
    expect(suggestTemplateName('招商银行信用卡账单-2026-10.csv')).toBe('招商银行信用卡账单')
    expect(suggestTemplateName('微信支付账单(20261001-20261031).csv')).toBe('微信支付账单')
    expect(suggestTemplateName('2026.csv')).toBe('我的模板')
  })
})

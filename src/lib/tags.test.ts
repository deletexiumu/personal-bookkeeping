import { describe, expect, it } from 'vitest'
import type { Transaction } from '../types'
import { formatTags, makeTagResolver, normalizeTags, parseTags, stableHash, tagRuleUid, untaggedGroups, withEffectiveTags } from './tags'

const tx = (extra: Partial<Transaction>): Transaction => ({
  type: 'expense',
  amount: 100,
  accountId: 1,
  categoryId: 1,
  date: '2026-11-01',
  source: 'import',
  createdAt: 1,
  updatedAt: 1,
  ...extra,
})

describe('tags', () => {
  it('解析多种分隔符并去重', () => {
    expect(parseTags('#家庭 #周末')).toEqual(['家庭', '周末'])
    expect(parseTags('家庭，周末、出差,家庭')).toEqual(['家庭', '周末', '出差'])
    expect(parseTags('  ')).toEqual([])
  })

  it('格式化与规整', () => {
    expect(formatTags(['家庭', '周末'])).toBe('#家庭 #周末')
    expect(formatTags(undefined)).toBe('')
    expect(normalizeTags([' #游戏', '游戏', '房租'])).toEqual(['游戏', '房租'])
    expect(normalizeTags([' '])).toBeUndefined()
  })

  it('由文字算出的 uid 稳定、不同文字不同，且符合云端 uid 格式', () => {
    expect(stableHash('西山居万宝楼')).toBe(stableHash('西山居万宝楼'))
    expect(stableHash('西山居万宝楼')).not.toBe(stableHash('西山居万宝'))
    expect(tagRuleUid('谢志英')).toMatch(/^[\w-]{1,64}$/)
  })

  it('单笔标签优先，其次商户标签；没有商户时按备注匹配', () => {
    const resolve = makeTagResolver([
      { merchant: '西山居万宝楼', tags: ['游戏'] },
      { merchant: '谢志英', tags: ['房租'] },
    ])
    const game = tx({ merchant: '西山居万宝楼' })
    const own = tx({ merchant: '西山居万宝楼', tags: ['礼物'] })
    const byNote = tx({ note: ' 谢志英 ' })
    const none = tx({ merchant: '盒马' })
    expect(resolve(game)).toEqual(['游戏'])
    expect(resolve.origin(game)).toBe('merchant')
    expect(resolve(own)).toEqual(['礼物'])
    expect(resolve.origin(own)).toBe('own')
    expect(resolve(byNote)).toEqual(['房租'])
    expect(resolve(none)).toEqual([])
    expect(resolve.origin(none)).toBe('none')
    // 只把商户标签写进副本，原对象不变
    const [copy, ownCopy] = withEffectiveTags([game, own], resolve)
    expect(copy.tags).toEqual(['游戏'])
    expect(game.tags).toBeUndefined()
    expect(ownCopy).toBe(own)
  })

  it('待标注按商户归组：不含转账、不计收支和已有标签的，没有商户的排最后', () => {
    const resolve = makeTagResolver([{ merchant: '谢志英', tags: ['房租'] }])
    const groups = untaggedGroups(
      [
        tx({ id: 1, merchant: '万宝楼', amount: 500, date: '2026-11-02' }),
        tx({ id: 2, merchant: '万宝楼', amount: 300, date: '2026-11-05' }),
        tx({ id: 3, merchant: '盒马', amount: 1000 }),
        tx({ id: 4, amount: 9999 }),
        tx({ id: 5, merchant: '谢志英', amount: 100 }),
        tx({ id: 6, merchant: '盒马', tags: ['买菜'] }),
        tx({ id: 7, merchant: '余额宝', excluded: true }),
        tx({ id: 8, type: 'transfer', merchant: '转账' }),
        tx({ id: 9, merchant: '万宝楼', type: 'income', amount: 50 }),
      ],
      resolve,
    )
    expect(groups.map((g) => [g.merchant, g.rows.map((t) => t.id), g.expense, g.income, g.lastDate])).toEqual([
      ['盒马', [3], 1000, 0, '2026-11-01'],
      ['万宝楼', [1, 2, 9], 800, 50, '2026-11-05'],
      [undefined, [4], 9999, 0, '2026-11-01'],
    ])
  })
})

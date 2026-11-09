import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { tagRuleUid, tagUid } from '../lib/tags'
import { BookkeepingDB } from './index'
import { addTag, deleteTag, ensureTags, listTagRules, listTags, moveTag, renameTag, setMerchantTags, setTransactionTags } from './tags'
import { addTransaction } from './transactions'

let db: BookkeepingDB

beforeEach(async () => {
  db = new BookkeepingDB(`test-${crypto.randomUUID()}`)
  await db.open()
})

afterEach(async () => {
  await db.delete()
})

const expense = (extra: Record<string, unknown> = {}) =>
  addTransaction(db, { type: 'expense', amount: 100, categoryId: 1, accountId: 1, date: '2026-11-04', ...extra })

describe('标签目录', () => {
  it('新库带内置标签，uid 由名称算出、不推送', async () => {
    const tags = await listTags(db)
    expect(tags.map((t) => t.name)).toContain('游戏')
    expect(tags.map((t) => t.name)).toContain('房租')
    expect(tags.find((t) => t.name === '游戏')).toMatchObject({ uid: tagUid('游戏'), modifiedAt: 0 })
    expect(await db.tags.where('dirty').equals(1).count()).toBe(0)
  })

  it('新建、同名不重复、名称校验；排序', async () => {
    const before = (await listTags(db)).length
    const id = await addTag(db, '#装修')
    expect(await addTag(db, '装修')).toBe(id)
    expect(await listTags(db)).toHaveLength(before + 1)
    expect((await listTags(db)).at(-1)).toMatchObject({ name: '装修', uid: tagUid('装修'), dirty: 1 })
    await expect(addTag(db, ' ')).rejects.toThrow('标签名不能为空')
    await expect(addTag(db, '两个 词')).rejects.toThrow('不能包含空格')
    await moveTag(db, id, -1)
    expect((await listTags(db)).at(-2)?.name).toBe('装修')
  })

  it('改名同步到流水和商户标签；改成已有名字时合并', async () => {
    const a = await expense({ tags: ['游戏', '礼物'] })
    await setMerchantTags(db, '万宝楼', ['游戏'])
    const game = (await db.tags.where('name').equals('游戏').first())!
    await renameTag(db, game.id!, '手游')
    expect((await db.transactions.get(a))?.tags).toEqual(['手游', '礼物'])
    expect((await listTagRules(db))[0].tags).toEqual(['手游'])

    // 手游并进礼物
    await addTag(db, '礼物')
    await renameTag(db, game.id!, '礼物')
    expect((await db.transactions.get(a))?.tags).toEqual(['礼物'])
    expect(await db.tags.where('name').equals('手游').count()).toBe(0)
    expect(await db.tags.where('name').equals('礼物').count()).toBe(1)
  })

  it('删除标签：从流水和商户标签里去掉，商户标签空了就删掉', async () => {
    const a = await expense({ tags: ['房租'] })
    const b = await expense({ tags: ['房租', '人情往来'] })
    await setMerchantTags(db, '谢志英', ['房租'])
    const rent = (await db.tags.where('name').equals('房租').first())!
    await deleteTag(db, rent.id!)
    const rowA = await db.transactions.get(a)
    expect(rowA).not.toHaveProperty('tags')
    expect((await db.transactions.get(b))?.tags).toEqual(['人情往来'])
    expect(await listTagRules(db)).toEqual([])
    expect(await db.syncTombstones.where('table').equals('tags').count()).toBeGreaterThan(0)
  })
})

describe('商户标签与单笔标签', () => {
  it('同一商户只有一条，uid 由商户名算出；空标签即取消', async () => {
    await setMerchantTags(db, ' 西山居万宝楼 ', ['游戏'])
    await setMerchantTags(db, '西山居万宝楼', ['游戏', '会员订阅'])
    const rules = await listTagRules(db)
    expect(rules).toHaveLength(1)
    expect(rules[0]).toMatchObject({ merchant: '西山居万宝楼', tags: ['游戏', '会员订阅'], uid: tagRuleUid('西山居万宝楼') })
    await setMerchantTags(db, '西山居万宝楼', [])
    expect(await listTagRules(db)).toEqual([])
    await expect(setMerchantTags(db, ' ', ['游戏'])).rejects.toThrow('商户不能为空')
  })

  it('新标签自动加进目录', async () => {
    await setMerchantTags(db, '健身房', ['健身'])
    expect((await listTags(db)).map((t) => t.name)).toContain('健身')
    await ensureTags(db, ['健身', '健身'])
    expect(await db.tags.where('name').equals('健身').count()).toBe(1)
  })

  it('批量给流水打单笔标签：覆盖或追加，清空后回到沿用商户标签', async () => {
    const a = await expense({ tags: ['外卖'] })
    const b = await expense()
    await setTransactionTags(db, [a, b], ['周末'], 'add')
    expect((await db.transactions.get(a))?.tags).toEqual(['外卖', '周末'])
    expect((await db.transactions.get(b))?.tags).toEqual(['周末'])
    await setTransactionTags(db, [a], ['出差'])
    expect((await db.transactions.get(a))?.tags).toEqual(['出差'])
    await setTransactionTags(db, [a], [])
    expect(await db.transactions.get(a)).not.toHaveProperty('tags')
    expect((await db.transactions.get(a))?.dirty).toBe(1)
  })
})

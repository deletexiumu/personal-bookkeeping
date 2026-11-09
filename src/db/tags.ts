import { MAX_TAG_LENGTH, normalizeTags, tagRuleUid, tagUid } from '../lib/tags'
import type { Tag, TagRule } from '../types'
import { byOrder } from './catalog'
import type { BookkeepingDB } from './index'

/** 标签目录、商户标签和给流水打标签。标签在流水和商户标签里按名称引用，改名 / 删除时一并更新 */

/** 标签目录：按顺序，同名的只留一条（两台设备分别改名成同一个名字时可能出现） */
export async function listTags(db: BookkeepingDB): Promise<Tag[]> {
  const seen = new Set<string>()
  return (await db.tags.toArray()).sort(byOrder).filter((t) => !seen.has(t.name) && !!seen.add(t.name))
}

export async function listTagRules(db: BookkeepingDB): Promise<TagRule[]> {
  return (await db.tagRules.toArray()).sort((a, b) => a.merchant.localeCompare(b.merchant, 'zh-CN'))
}

function assertTagName(name: string): string {
  const trimmed = name.trim().replace(/^[#＃]+/, '')
  if (!trimmed) throw new Error('标签名不能为空')
  if (/[\s,，、#＃]/.test(trimmed)) throw new Error('标签名不能包含空格、逗号或 #')
  if (trimmed.length > MAX_TAG_LENGTH) throw new Error(`标签名最多 ${MAX_TAG_LENGTH} 个字`)
  return trimmed
}

/** 把还不在目录里的标签加进目录（打标签时顺手新建的） */
export async function ensureTags(db: BookkeepingDB, names: readonly string[]): Promise<void> {
  const list = normalizeTags(names)
  if (!list) return
  await db.transaction('rw', db.tags, async () => {
    const all = await db.tags.toArray()
    const existing = new Set(all.map((t) => t.name))
    let order = Math.max(0, ...all.map((t) => t.order ?? 0))
    const now = Date.now()
    const added = list.filter((name) => !existing.has(name)).map((name) => ({ uid: tagUid(name), name, order: ++order, createdAt: now }))
    if (added.length) await db.tags.bulkAdd(added)
  })
}

/** 新建标签；同名的已存在时直接返回它 */
export async function addTag(db: BookkeepingDB, name: string): Promise<number> {
  const clean = assertTagName(name)
  await ensureTags(db, [clean])
  return (await db.tags.where('name').equals(clean).first())!.id!
}

function replaceIn(tags: string[] | undefined, from: string, to: string | undefined): string[] | undefined {
  if (!tags?.includes(from)) return tags
  return normalizeTags(tags.flatMap((t) => (t === from ? (to ? [to] : []) : [t])))
}

/** 标签改名：流水和商户标签里的旧名一并换成新名；新名已存在时两个标签合并 */
export async function renameTag(db: BookkeepingDB, id: number, name: string): Promise<void> {
  const next = assertTagName(name)
  await db.transaction('rw', db.tags, db.tagRules, db.transactions, async () => {
    const tag = await db.tags.get(id)
    if (!tag) throw new Error('标签不存在')
    const prev = tag.name
    if (prev === next) return
    const duplicate = await db.tags.where('name').equals(next).first()
    if (duplicate) await db.tags.delete(id)
    else await db.tags.update(id, { name: next })
    await retag(db, prev, next)
  })
}

/** 删除标签：同时从流水和商户标签里去掉 */
export async function deleteTag(db: BookkeepingDB, id: number): Promise<void> {
  await db.transaction('rw', db.tags, db.tagRules, db.transactions, async () => {
    const tag = await db.tags.get(id)
    if (!tag) return
    await db.tags.where('name').equals(tag.name).delete()
    await retag(db, tag.name, undefined)
  })
}

async function retag(db: BookkeepingDB, from: string, to: string | undefined): Promise<void> {
  await db.transactions
    .where('tags')
    .equals(from)
    .modify((t) => {
      const tags = replaceIn(t.tags, from, to)
      if (tags) t.tags = tags
      else delete t.tags
    })
  for (const rule of await db.tagRules.toArray()) {
    if (!rule.tags.includes(from)) continue
    const tags = replaceIn(rule.tags, from, to)
    if (tags) await db.tagRules.update(rule.id!, { tags })
    else await db.tagRules.delete(rule.id!)
  }
}

/** 调整顺序：与上一个 / 下一个交换 */
export async function moveTag(db: BookkeepingDB, id: number, delta: -1 | 1): Promise<void> {
  await db.transaction('rw', db.tags, async () => {
    const all = (await db.tags.toArray()).sort(byOrder)
    const index = all.findIndex((t) => t.id === id)
    const target = index + delta
    if (index < 0 || target < 0 || target >= all.length) return
    ;[all[index], all[target]] = [all[target], all[index]]
    await Promise.all(all.map((t, i) => (t.order === i + 1 ? undefined : db.tags.update(t.id!, { order: i + 1 }))))
  })
}

/**
 * 设置商户标签：这个商户的流水（包括以后导入的）都带上这些标签，单笔自己打了标签的除外。
 * tags 为空时取消商户标签。
 */
export async function setMerchantTags(db: BookkeepingDB, merchant: string, tags: readonly string[]): Promise<void> {
  const key = merchant.trim()
  if (!key) throw new Error('商户不能为空')
  const list = normalizeTags(tags)
  await db.transaction('rw', db.tagRules, db.tags, async () => {
    const existing = await db.tagRules.where('merchant').equals(key).toArray()
    if (!list) {
      if (existing.length) await db.tagRules.bulkDelete(existing.map((r) => r.id!))
      return
    }
    await ensureTags(db, list)
    const [first, ...rest] = existing
    if (first) await db.tagRules.update(first.id!, { tags: list })
    else await db.tagRules.add({ uid: tagRuleUid(key), merchant: key, tags: list, createdAt: Date.now() })
    if (rest.length) await db.tagRules.bulkDelete(rest.map((r) => r.id!))
  })
}

/**
 * 给若干笔流水设置单笔标签（覆盖原来的单笔标签）；tags 为空时清掉单笔标签，回到沿用商户标签。
 * mode 为 add 时在原有单笔标签上追加。
 */
export async function setTransactionTags(
  db: BookkeepingDB,
  ids: readonly number[],
  tags: readonly string[],
  mode: 'set' | 'add' = 'set',
): Promise<void> {
  const list = normalizeTags(tags)
  await db.transaction('rw', db.transactions, db.tags, async () => {
    if (list) await ensureTags(db, list)
    const now = Date.now()
    await db.transactions
      .where('id')
      .anyOf([...ids])
      .modify((t) => {
        const next = mode === 'add' ? normalizeTags([...(t.tags ?? []), ...(list ?? [])]) : list
        if (next) t.tags = next
        else delete t.tags
        t.updatedAt = now
      })
  })
}

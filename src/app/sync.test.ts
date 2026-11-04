import { afterEach, describe, expect, it } from 'vitest'
import { BookkeepingDB } from '../db'
import { latestUpgradeBackup } from '../db/backup'
import { setBudget } from '../db/budgets'
import { saveCategory } from '../db/catalog'
import { addTransaction, deleteTransaction, updateTransaction } from '../db/transactions'
import type { WireChange } from '../db/syncData'
import { SyncEngine, type SyncApi, type SyncCursor } from './sync'

/** 与 server/src/sync/routes.ts 相同规则的内存版云端 */
class FakeCloud {
  rev = 0
  records = new Map<string, WireChange & { rev: number }>()
  pushes = 0

  api(pageSize = 1000): SyncApi {
    return {
      pull: async (since) => {
        const all = [...this.records.values()].filter((r) => r.rev > since).sort((a, b) => a.rev - b.rev)
        const page = all.slice(0, pageSize)
        return { changes: page.map((r) => ({ ...r, data: r.data && structuredClone(r.data) })), cursor: page.at(-1)?.rev ?? since, more: all.length > pageSize }
      },
      push: async (changes) => {
        this.pushes++
        let accepted = 0
        const conflicts: WireChange[] = []
        for (const c of changes) {
          const key = `${c.table}/${c.uid}`
          const cur = this.records.get(key)
          if (cur && cur.modifiedAt >= c.modifiedAt) {
            conflicts.push(cur)
            continue
          }
          this.records.set(key, { ...structuredClone(c), rev: ++this.rev })
          accepted++
        }
        return { accepted, conflicts }
      },
    }
  }
}

const dbs: BookkeepingDB[] = []
afterEach(async () => {
  for (const d of dbs.splice(0)) await d.delete()
})

function device(cloud: FakeCloud, opts: { userId?: string; pageSize?: number } = {}) {
  const db = new BookkeepingDB(`test-${crypto.randomUUID()}`)
  dbs.push(db)
  let cursor: SyncCursor = { cursor: 0 }
  let clock = 1_000_000
  const account = { userId: opts.userId ?? 'user-1' as string | undefined }
  const engine = new SyncEngine({
    db,
    api: cloud.api(opts.pageSize),
    userId: () => account.userId,
    loadCursor: () => cursor,
    saveCursor: (c) => (cursor = c),
    now: () => clock++,
  })
  return { db, engine, account, cursor: () => cursor }
}

const expense = (amount: number, extra: Record<string, unknown> = {}) => ({
  type: 'expense' as const,
  amount,
  categoryId: 1,
  accountId: 1,
  date: '2026-11-04',
  ...extra,
})

describe('两台设备同步', () => {
  it('新设备登录后拉到另一台的数据，外键换成本机的 id', async () => {
    const cloud = new FakeCloud()
    const a = device(cloud)
    // A 新建分类和账户，记一笔
    const pet = await saveCategory(a.db, { name: '宠物', type: 'expense', order: 99 })
    const card = await a.db.accounts.add({ name: '信用卡', type: 'credit', initialBalance: 0, order: 9 })
    await addTransaction(a.db, expense(3200, { categoryId: pet, accountId: card, note: '猫粮' }))
    await a.engine.resolveChoice('merge')
    expect(a.engine.status).toMatchObject({ phase: 'idle', pending: 0 })
    expect(await a.db.transactions.where('dirty').equals(1).count()).toBe(0)

    const b = device(cloud)
    await b.engine.sync()
    expect(b.engine.status.phase).toBe('idle')
    const [row] = await b.db.transactions.toArray()
    expect(row).toMatchObject({ amount: 3200, note: '猫粮' })
    expect((await b.db.categories.get(row.categoryId!))?.name).toBe('宠物')
    expect((await b.db.accounts.get(row.accountId))?.name).toBe('信用卡')
    expect(row.dirty).toBeUndefined()
    // 默认分类没改过，不上云，也不会在 B 上多出一份
    expect(await b.db.categories.where('name').equals('餐饮').count()).toBe(1)
  })

  it('修改、删除双向同步；同一条后改的为准', async () => {
    const cloud = new FakeCloud()
    const a = device(cloud)
    const b = device(cloud)
    await a.engine.sync()
    await b.engine.sync()
    const id = await addTransaction(a.db, expense(100))
    await a.engine.sync()
    await b.engine.sync()
    const onB = (await b.db.transactions.toArray())[0]
    expect(onB.amount).toBe(100)

    // 两边都改，B 后改
    await updateTransaction(a.db, id, { amount: 200 })
    await new Promise((r) => setTimeout(r, 5))
    await updateTransaction(b.db, onB.id!, { amount: 300 })
    await a.engine.sync()
    await b.engine.sync()
    await a.engine.sync()
    expect((await a.db.transactions.get(id))?.amount).toBe(300)
    expect((await b.db.transactions.get(onB.id!))?.amount).toBe(300)

    // B 删除，A 同步后也没了
    await deleteTransaction(b.db, onB.id!)
    await b.engine.sync()
    expect(await b.db.syncTombstones.count()).toBe(0)
    await a.engine.sync()
    expect(await a.db.transactions.count()).toBe(0)
  })

  it('本机改得更晚时，拉取不覆盖本机，随后推送本机的', async () => {
    const cloud = new FakeCloud()
    const a = device(cloud)
    const b = device(cloud)
    await a.engine.sync()
    await b.engine.sync()
    await addTransaction(a.db, expense(100))
    await a.engine.sync()
    await b.engine.sync()
    const onB = (await b.db.transactions.toArray())[0]
    const onA = (await a.db.transactions.toArray())[0]
    await updateTransaction(a.db, onA.id!, { amount: 200 })
    await a.engine.sync()
    await new Promise((r) => setTimeout(r, 5))
    await updateTransaction(b.db, onB.id!, { amount: 900 })
    await b.engine.sync()
    expect((await b.db.transactions.get(onB.id!))?.amount).toBe(900)
    await a.engine.sync()
    expect((await a.db.transactions.get(onA.id!))?.amount).toBe(900)
  })

  it('改过的默认分类、预算按分类合并', async () => {
    const cloud = new FakeCloud()
    const a = device(cloud)
    const b = device(cloud)
    await a.engine.sync()
    await b.engine.sync()
    await saveCategory(a.db, { ...(await a.db.categories.get(1))!, name: '吃饭' })
    await setBudget(a.db, 1, 100000)
    await a.engine.sync()
    await setBudget(b.db, 1, 50000)
    await b.engine.sync()
    // B 的预算后设，以 B 为准；两边都只有一条
    await a.engine.sync()
    for (const d of [a, b]) {
      expect((await d.db.categories.get(1))?.name).toBe('吃饭')
      const budgets = await d.db.budgets.toArray()
      expect(budgets).toHaveLength(1)
      expect(budgets[0]).toMatchObject({ categoryId: 1, amount: 50000 })
    }
  })

  it('分页拉取时，外键引用后面几页的记录也能对上', async () => {
    const cloud = new FakeCloud()
    const a = device(cloud)
    await a.engine.sync()
    const pet = await saveCategory(a.db, { name: '宠物', type: 'expense', order: 99 })
    for (let i = 0; i < 5; i++) await addTransaction(a.db, expense(i + 1))
    await a.engine.sync()
    // 分类后改名，rev 排到流水后面
    await saveCategory(a.db, { ...(await a.db.categories.get(pet))!, name: '毛孩子' })
    await updateTransaction(a.db, (await a.db.transactions.toArray())[0].id!, { categoryId: pet })
    await a.engine.sync()

    const b = device(cloud, { pageSize: 2 })
    await b.engine.sync()
    const moved = (await b.db.transactions.toArray()).find((t) => t.amount === 1)!
    expect((await b.db.categories.get(moved.categoryId!))?.name).toBe('毛孩子')
    expect(await b.db.transactions.count()).toBe(5)
  })

  it('推送分批进行', async () => {
    const cloud = new FakeCloud()
    const a = device(cloud)
    await a.engine.sync()
    await a.db.transactions.bulkAdd(
      Array.from({ length: 450 }, (_, i) => ({ ...expense(i + 1), source: 'manual' as const, createdAt: 1, updatedAt: 1 })),
    )
    cloud.pushes = 0
    await a.engine.sync()
    expect(cloud.pushes).toBe(3)
    expect(a.engine.status.pending).toBe(0)
  })
})

describe('第一次和账号同步', () => {
  it('云端是空的（新账号）：直接把本机数据传上去，不用选择', async () => {
    const cloud = new FakeCloud()
    const a = device(cloud)
    await addTransaction(a.db, expense(100))
    await a.engine.sync()
    expect(a.engine.status).toMatchObject({ phase: 'idle', pending: 0 })
    expect(cloud.records.size).toBe(1)
  })

  it('本机和云端都有数据时先让用户选择', async () => {
    const cloud = new FakeCloud()
    const a = device(cloud)
    await addTransaction(a.db, expense(100))
    await a.engine.sync()
    const b = device(cloud)
    await addTransaction(b.db, expense(200))
    await b.engine.sync()
    expect(b.engine.status.phase).toBe('needs-choice')
    expect(cloud.records.size).toBe(1)
  })

  it('合并：本机和云端数据合在一起', async () => {
    const cloud = new FakeCloud()
    const a = device(cloud)
    await a.engine.sync()
    await addTransaction(a.db, expense(100))
    await a.engine.sync()

    const b = device(cloud)
    await addTransaction(b.db, expense(200))
    await b.engine.sync()
    await b.engine.resolveChoice('merge')
    expect((await b.db.transactions.toArray()).map((t) => t.amount).sort()).toEqual([100, 200])
    await a.engine.sync()
    expect(await a.db.transactions.count()).toBe(2)
  })

  it('用云端替换：先自动备份本机数据，再清空并下载云端', async () => {
    const cloud = new FakeCloud()
    const a = device(cloud)
    await a.engine.sync()
    await addTransaction(a.db, expense(100))
    await a.engine.sync()

    const b = device(cloud)
    await addTransaction(b.db, expense(200))
    await saveCategory(b.db, { name: '本机分类', type: 'expense', order: 50 })
    await b.engine.sync()
    await b.engine.resolveChoice('replace')
    expect((await b.db.transactions.toArray()).map((t) => t.amount)).toEqual([100])
    expect(await b.db.categories.where('name').equals('本机分类').count()).toBe(0)
    expect(await b.db.categories.where('name').equals('餐饮').count()).toBe(1)
    const backup = await latestUpgradeBackup(b.db)
    expect(backup?.data.transactions.map((t) => t.amount)).toEqual([200])
    // 本机清空没有产生删除记录，云端不受影响
    await a.engine.sync()
    expect(await a.db.transactions.count()).toBe(1)
  })

  it('换账号登录时，本机属于上一个账号的数据也要选择，合并后全部上传', async () => {
    const cloud1 = new FakeCloud()
    const a = device(cloud1)
    await a.engine.sync()
    await addTransaction(a.db, expense(100))
    await a.engine.sync()
    expect(a.engine.status.pending).toBe(0)

    a.account.userId = 'user-2'
    await a.engine.sync()
    expect(a.engine.status.phase).toBe('needs-choice')
  })

  it('未登录时不同步', async () => {
    const cloud = new FakeCloud()
    const a = device(cloud, { userId: undefined })
    a.account.userId = undefined
    await a.engine.sync()
    expect(a.engine.status.phase).toBe('off')
  })

  it('网络出错时显示错误，保留待推送', async () => {
    const cloud = new FakeCloud()
    const a = device(cloud)
    await a.engine.sync()
    await addTransaction(a.db, expense(100))
    const api = cloud.api()
    api.push = async () => {
      throw new Error('连不上服务器')
    }
    const broken = new SyncEngine({ db: a.db, api, userId: () => 'user-1', loadCursor: a.cursor, saveCursor: () => {} })
    await broken.sync()
    expect(broken.status).toMatchObject({ phase: 'error', error: '连不上服务器', pending: 1 })
  })
})

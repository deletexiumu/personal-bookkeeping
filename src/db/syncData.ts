import { DEFAULT_ACCOUNTS, DEFAULT_CATEGORIES, DEFAULT_TAGS } from './defaults'
import type { BookkeepingDB } from './index'
import { applyRemoteChanges, SYNC_TABLES, TOMBSTONES, type SyncTable, type Tombstone } from './sync'

/**
 * 本地数据和云端同步格式之间的转换，以及拉取 / 推送时的读写。不涉及网络，网络部分在 src/app/sync.ts。
 *
 * 同步格式：一行数据去掉本地字段（id、uid、modifiedAt、dirty），外键从本地数字 id 换成对方的 uid，
 * 字段名 xxxId 改为 xxxUid。删除的记录 data 为 null。
 */
export interface WireChange {
  table: SyncTable
  uid: string
  modifiedAt: number
  /** null 表示已删除 */
  data: Record<string, unknown> | null
}

type RefTable = 'accounts' | 'categories' | 'importBatches'

/** 各表的外键字段指向哪张表 */
const FOREIGN_KEYS: Partial<Record<SyncTable, Record<string, RefTable>>> = {
  transactions: { categoryId: 'categories', accountId: 'accounts', transferAccountId: 'accounts', importBatchId: 'importBatches' },
  budgets: { categoryId: 'categories' },
  rules: { categoryId: 'categories' },
  importTemplates: { accountId: 'accounts' },
  plans: { categoryId: 'categories', accountId: 'accounts' },
}
const REF_TABLES: RefTable[] = ['accounts', 'categories', 'importBatches']
const LOCAL_FIELDS = new Set(['id', 'uid', 'modifiedAt', 'dirty'])

type Row = Record<string, unknown> & { id?: number; uid?: string; modifiedAt?: number; dirty?: 1 }

interface RefMaps {
  uidOf: Record<RefTable, Map<number, string>>
  idOf: Record<RefTable, Map<string, number>>
}

async function loadRefMaps(db: BookkeepingDB, maps?: RefMaps, only: RefTable[] = REF_TABLES): Promise<RefMaps> {
  const next = maps ?? ({ uidOf: {}, idOf: {} } as RefMaps)
  for (const table of only) {
    const rows = (await db.table(table).toArray()) as Row[]
    next.uidOf[table] = new Map(rows.filter((r) => r.uid).map((r) => [r.id!, r.uid!]))
    next.idOf[table] = new Map(rows.filter((r) => r.uid).map((r) => [r.uid!, r.id!]))
  }
  return next
}

const uidField = (field: string) => field.replace(/Id$/, 'Uid')

export function toWire(table: SyncTable, row: Row, maps: RefMaps): Record<string, unknown> {
  const fks = FOREIGN_KEYS[table] ?? {}
  const data: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row)) {
    if (LOCAL_FIELDS.has(key) || value === undefined) continue
    const ref = fks[key]
    if (ref) {
      const uid = maps.uidOf[ref].get(value as number)
      if (uid) data[uidField(key)] = uid
    } else {
      data[key] = value
    }
  }
  return data
}

export function fromWire(table: SyncTable, data: Record<string, unknown>, maps: RefMaps): Row {
  const fks = Object.entries(FOREIGN_KEYS[table] ?? {}).map(([field, ref]) => [field, uidField(field), ref] as const)
  const wireKeys = new Set(fks.map(([, wire]) => wire))
  const row: Row = {}
  for (const [key, value] of Object.entries(data)) {
    if (LOCAL_FIELDS.has(key) || wireKeys.has(key)) continue
    row[key] = value
  }
  for (const [field, wire, ref] of fks) {
    const uid = data[wire]
    const id = typeof uid === 'string' ? maps.idOf[ref].get(uid) : undefined
    // 引用的记录在本机不存在（比如在别的设备上已删除）时留空
    if (id !== undefined) row[field] = id
  }
  return row
}

/** 本机待推送的改动：标记了 dirty 的记录和删除记录 */
export async function collectLocalChanges(db: BookkeepingDB): Promise<WireChange[]> {
  return db.transaction('r', [...SYNC_TABLES, TOMBSTONES], async () => {
    const maps = await loadRefMaps(db)
    const changes: WireChange[] = []
    for (const table of SYNC_TABLES) {
      const rows = (await db.table(table).where('dirty').equals(1).toArray()) as Row[]
      for (const row of rows) {
        changes.push({ table, uid: row.uid!, modifiedAt: row.modifiedAt ?? 0, data: toWire(table, row, maps) })
      }
    }
    for (const t of await db.syncTombstones.toArray()) {
      changes.push({ table: t.table, uid: t.uid, modifiedAt: t.deletedAt, data: null })
    }
    return changes
  })
}

/** 待推送的条数 */
export async function countPending(db: BookkeepingDB): Promise<number> {
  let n = await db.syncTombstones.count()
  for (const table of SYNC_TABLES) n += await db.table(table).where('dirty').equals(1).count()
  return n
}

/** 本机有没有自己的数据（不算没改过的默认分类和账户） */
export async function hasLocalData(db: BookkeepingDB): Promise<boolean> {
  if ((await db.syncTombstones.count()) > 0) return true
  for (const table of SYNC_TABLES) {
    if ((await db.table(table).filter((r: Row) => (r.modifiedAt ?? 1) > 0).count()) > 0) return true
  }
  return false
}

/**
 * 推送成功后清掉待推送标记。推送期间又改过的记录（modifiedAt 变了）保留标记，下次再推。
 */
export async function markPushed(db: BookkeepingDB, changes: WireChange[]): Promise<void> {
  if (changes.length === 0) return
  await applyRemoteChanges(db, SYNC_TABLES, async () => {
    for (const table of SYNC_TABLES) {
      const pushed = new Map(changes.filter((c) => c.table === table && c.data).map((c) => [c.uid, c.modifiedAt]))
      if (pushed.size === 0) continue
      const rows = (await db.table(table).where('uid').anyOf([...pushed.keys()]).toArray()) as Row[]
      const done = rows.filter((r) => r.dirty && r.modifiedAt === pushed.get(r.uid!))
      for (const row of done) delete row.dirty
      if (done.length) await db.table(table).bulkPut(done)
    }
    const deletes = changes.filter((c) => c.data === null)
    if (deletes.length) {
      const marks = await db.syncTombstones.bulkGet(deletes.map((c) => [c.table, c.uid]))
      const done = marks.filter((m, i): m is Tombstone => m?.deletedAt === deletes[i].modifiedAt)
      await db.syncTombstones.bulkDelete(done.map((m) => [m.table, m.uid]))
    }
  })
}

/**
 * 写入云端的改动，按修改时间后写为准：本机还没推送、且改得更晚的记录（或更晚的删除）保留本机的。
 * 按表的依赖顺序写入（先账户、分类、导入批次，再流水等），外键从 uid 换回本地 id。
 */
export async function applyRemote(db: BookkeepingDB, changes: WireChange[]): Promise<number> {
  if (changes.length === 0) return 0
  // 同一条出现多次时以最后一次（rev 最大）为准
  const latest = new Map<string, WireChange>()
  for (const c of changes) latest.set(`${c.table}\u0000${c.uid}`, c)
  let applied = 0
  await applyRemoteChanges(db, SYNC_TABLES, async () => {
    const maps = await loadRefMaps(db)
    for (const table of SYNC_TABLES) {
      const list = [...latest.values()].filter((c) => c.table === table)
      if (list.length === 0) continue
      const store = db.table(table)
      const locals = new Map(
        ((await store.where('uid').anyOf(list.map((c) => c.uid)).toArray()) as Row[]).map((r) => [r.uid!, r]),
      )
      const marks = await db.syncTombstones.bulkGet(list.map((c) => [table, c.uid]))
      for (const [i, c] of list.entries()) {
        const local = locals.get(c.uid)
        const mark = marks[i]
        if (local?.dirty && (local.modifiedAt ?? 0) > c.modifiedAt) continue
        if (mark && mark.deletedAt > c.modifiedAt) continue
        if (c.data === null) {
          if (local) await store.delete(local.id!)
          if (mark) await db.syncTombstones.delete([table, c.uid])
          if (local || mark) applied++
          continue
        }
        // 自己推上去的改动又拉回来了：内容相同，跳过
        if (local && !local.dirty && local.modifiedAt === c.modifiedAt) continue
        const row = fromWire(table, c.data, maps)
        row.uid = c.uid
        row.modifiedAt = c.modifiedAt
        if (local) row.id = local.id
        await store.put(row)
        applied++
      }
      if ((REF_TABLES as string[]).includes(table)) await loadRefMaps(db, maps, [table as RefTable])
    }
  })
  return applied
}

/** 换账号合并时，把本机已有的数据全部标记为待推送（保留原来的修改时间） */
export async function markAllForUpload(db: BookkeepingDB): Promise<void> {
  await applyRemoteChanges(db, SYNC_TABLES, async () => {
    for (const table of SYNC_TABLES) {
      const rows = ((await db.table(table).toArray()) as Row[]).filter((r) => !r.dirty && (r.modifiedAt ?? 0) > 0)
      for (const row of rows) row.dirty = 1
      if (rows.length) await db.table(table).bulkPut(rows)
    }
  })
}

/** 用云端数据替换本机前，清空本机数据，只留默认分类、账户和标签（随后从云端拉取） */
export async function resetLocalData(db: BookkeepingDB): Promise<void> {
  await applyRemoteChanges(db, SYNC_TABLES, async () => {
    for (const table of SYNC_TABLES) await db.table(table).clear()
    await db.syncTombstones.clear()
    await db.categories.bulkAdd(DEFAULT_CATEGORIES.map((c) => ({ ...c, modifiedAt: 0 })))
    await db.accounts.bulkAdd(DEFAULT_ACCOUNTS.map((a) => ({ ...a, modifiedAt: 0 })))
    await db.tags.bulkAdd(DEFAULT_TAGS.map((t) => ({ ...t, modifiedAt: 0 })))
  })
}

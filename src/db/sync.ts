import type { DBCore, DBCoreMutateRequest, DBCoreMutateResponse, DBCoreTable, DBCoreTransaction, Dexie, Middleware } from 'dexie'

/**
 * 同步元数据中间件（Dexie DBCore 层）。业务代码照常读写，这里在写入时自动：
 * - 给新记录分配 uid（跨设备唯一编号），保留已有记录的 uid
 * - 记下 modifiedAt 并标记 dirty = 1（待推送）
 * - 删除时在 syncTombstones 里留下删除记录，以便同步到其他设备
 * 从云端拉下来的改动用 applyRemoteChanges 写入，不会被标成待推送。
 * 数据库升级（versionchange 事务）期间不介入，由升级函数自己处理。
 */

/** 会同步的表 */
export const SYNC_TABLES = [
  'accounts',
  'categories',
  'importBatches',
  'transactions',
  'budgets',
  'rules',
  'importTemplates',
] as const

export type SyncTable = (typeof SYNC_TABLES)[number]

export const TOMBSTONES = 'syncTombstones'

/** 删除记录：在推送成功前一直保留 */
export interface Tombstone {
  table: SyncTable
  uid: string
  deletedAt: number
}

const SYNCED = new Set<string>(SYNC_TABLES)
const REMOTE = Symbol('taozhubu-remote')

type Trans = DBCoreTransaction & { mode?: IDBTransactionMode; [REMOTE]?: boolean }

export function newUid(): string {
  return crypto.randomUUID()
}

/**
 * 预算每个分类（以及总预算）只有一条，用固定的 uid，两台设备分别设置同一分类的预算时会认作同一条。
 */
export function budgetUid(categoryUid: string | undefined): string {
  return categoryUid ? `budget-${categoryUid}` : 'budget-total'
}

export function syncMiddleware(now: () => number = Date.now): Middleware<DBCore> {
  return {
    stack: 'dbcore',
    name: 'taozhubu-sync',
    // 放在 Dexie 自带的各层（hooks、liveQuery 观察与缓存，最低为 -1）之下，紧挨 IndexedDB：
    // 这里用原生 await，会丢掉 Dexie 的事务上下文，上面那些层依赖它
    level: -2,
    create(down) {
      const hasTombstones = () => down.schema.tables.some((t) => t.name === TOMBSTONES)
      return {
        ...down,
        transaction(stores, mode, options) {
          // 写同步表时，把删除记录表和分类表（预算的 uid 依赖分类的 uid）一起纳入事务
          if (mode === 'readwrite' && hasTombstones() && stores.some((s) => SYNCED.has(s))) {
            stores = [...new Set([...stores, TOMBSTONES, 'categories'])]
          }
          return down.transaction(stores, mode, options)
        },
        table(name) {
          const table = down.table(name)
          if (!SYNCED.has(name)) return table
          return {
            ...table,
            mutate: (req) => mutate(down, table, req, now),
          }
        },
      }
    },
  }
}

async function mutate(down: DBCore, table: DBCoreTable, req: DBCoreMutateRequest, now: () => number): Promise<DBCoreMutateResponse> {
  const trans = req.trans as Trans
  if (trans.mode === 'versionchange' || !down.schema.tables.some((t) => t.name === TOMBSTONES)) return table.mutate(req)
  const remote = trans[REMOTE] === true
  const tombstones = down.table(TOMBSTONES)
  const name = table.name as SyncTable

  if (req.type === 'add' || req.type === 'put') {
    const keyPath = table.schema.primaryKey.keyPath as string
    const values = req.values.map((v) => ({ ...v }))
    const keys = values.map((v, i) => req.keys?.[i] ?? v[keyPath])
    const lookup = req.type === 'put' ? keys.filter((k) => k !== undefined) : []
    const found = lookup.length ? await table.getMany({ trans, keys: lookup }) : []
    const existingUid = new Map(lookup.map((k, i) => [k, found[i]?.uid as string | undefined]))
    const at = now()
    const replaced: Tombstone[] = []
    for (const [i, v] of values.entries()) {
      const before = keys[i] === undefined ? undefined : existingUid.get(keys[i])
      // 没带 uid 的更新（比如旧格式备份恢复）沿用库里已有记录的 uid
      v.uid ??= before ?? (await generateUid(down, trans, name, v))
      // 同一个本地 id 换成了另一条记录（按 id 覆盖的备份恢复）：原来那条在其他设备上也要删掉
      if (before && before !== v.uid && !remote) replaced.push({ table: name, uid: before, deletedAt: at })
      if (!remote) {
        v.modifiedAt = at
        v.dirty = 1
      } else {
        delete v.dirty
      }
    }
    const res = await table.mutate({ ...req, values } as DBCoreMutateRequest)
    // 同一条记录删了又加回来（如撤销删除、重新设置预算）：撤销删除记录
    await tombstones.mutate({ type: 'delete', trans, keys: values.map((v) => [name, v.uid]) })
    if (replaced.length) await tombstones.mutate({ type: 'put', trans, values: replaced })
    return res
  }

  if (req.type === 'delete' || req.type === 'deleteRange') {
    if (!remote) {
      const rows =
        req.type === 'delete'
          ? await table.getMany({ trans, keys: req.keys })
          : (await table.query({ trans, values: true, query: { index: table.schema.primaryKey, range: req.range } })).result
      const at = now()
      const marks: Tombstone[] = rows.filter((r) => r?.uid).map((r) => ({ table: name, uid: r.uid as string, deletedAt: at }))
      if (marks.length) await tombstones.mutate({ type: 'put', trans, values: marks })
    }
    return table.mutate(req)
  }
  return table.mutate(req)
}

async function generateUid(down: DBCore, trans: DBCoreTransaction, table: SyncTable, value: { categoryId?: number }) {
  if (table !== 'budgets') return newUid()
  if (value.categoryId === undefined) return budgetUid(undefined)
  const category = await down.table('categories').get({ trans, key: value.categoryId })
  return category?.uid ? budgetUid(category.uid as string) : newUid()
}

/**
 * 在一个事务里写入从云端拉下来的改动：不标记 dirty、保留传入的 modifiedAt、删除时不留删除记录。
 */
export async function applyRemoteChanges<T>(db: Dexie, tables: readonly string[], fn: () => Promise<T>): Promise<T> {
  return db.transaction('rw', [...new Set([...tables, TOMBSTONES])], async (tx) => {
    ;(tx.idbtrans as unknown as Trans)[REMOTE] = true
    return fn()
  })
}

import { Dexie, type EntityTable } from 'dexie'
import type { Account, Budget, Category, CategoryRule, ImportBatch, ImportTemplate, Plan, SyncMeta, Tag, TagRule, Transaction } from '../types'
import {
  DEFAULT_ACCOUNT_TYPES,
  DEFAULT_ACCOUNTS,
  DEFAULT_CATEGORIES,
  DEFAULT_TAGS,
  defaultAccountUid,
  defaultCategoryUid,
} from './defaults'
import { BACKUP_APP, BACKUP_FORMAT, type Backup } from '../lib/backup'
import { budgetUid, newUid, syncMiddleware, TOMBSTONES, type Tombstone } from './sync'

export { DEFAULT_ACCOUNTS, DEFAULT_CATEGORIES, DEFAULT_TAGS }

/** 本地数据库，基于浏览器 IndexedDB。登录后经云同步在多台设备间同步（见 src/db/sync.ts）。 */
export class BookkeepingDB extends Dexie {
  transactions!: EntityTable<Transaction, 'id'>
  categories!: EntityTable<Category, 'id'>
  accounts!: EntityTable<Account, 'id'>
  budgets!: EntityTable<Budget, 'id'>
  importBatches!: EntityTable<ImportBatch, 'id'>
  rules!: EntityTable<CategoryRule, 'id'>
  importTemplates!: EntityTable<ImportTemplate, 'id'>
  tags!: EntityTable<Tag, 'id'>
  tagRules!: EntityTable<TagRule, 'id'>
  plans!: EntityTable<Plan, 'id'>
  syncTombstones!: Dexie.Table<Tombstone, [string, string]>
  /** 自动备份：数据库结构升级前、用云端数据替换本机前各留一份，可在设置页下载 */
  upgradeBackups!: Dexie.Table<UpgradeBackup, number>

  constructor(name = 'personal-bookkeeping') {
    super(name)
    this.version(1).stores({
      transactions: '++id, date, type, categoryId, accountId',
      categories: '++id, type, name',
      accounts: '++id, name',
    })
    // v2：转账、时间、商户、标签、来源、导入批次。旧记录补上 source = 'manual'。
    this.version(2)
      .stores({
        transactions: '++id, date, type, categoryId, accountId, transferAccountId, source, importBatchId, *tags',
      })
      .upgrade((tx) =>
        tx
          .table('transactions')
          .toCollection()
          .modify((row: Partial<Transaction>) => {
            row.source ??= 'manual'
          }),
      )
    // v3：分类图标 / 颜色 / 排序 / 归档，账户类型 / 初始余额 / 排序 / 归档
    this.version(3)
      .stores({
        categories: '++id, type, name, order',
        accounts: '++id, name, order',
      })
      .upgrade(async (tx) => {
        const presets = new Map(DEFAULT_CATEGORIES.map((c) => [c.name, c]))
        await tx
          .table('categories')
          .toCollection()
          .modify((c: Category) => {
            const preset = presets.get(c.name)
            c.icon ??= preset?.icon
            c.color ??= preset?.color
            c.order ??= c.id
            if (c.icon === undefined) delete c.icon
            if (c.color === undefined) delete c.color
          })
        await tx
          .table('accounts')
          .toCollection()
          .modify((a: Account) => {
            a.type ??= DEFAULT_ACCOUNT_TYPES[a.name] ?? 'other'
            a.initialBalance ??= 0
            a.order ??= a.id
          })
      })
    // v4：月度预算
    this.version(4).stores({ budgets: '++id, categoryId' })
    // v5：导入批次；流水按外部交易单号索引，用于重复导入时去重
    this.version(5).stores({
      transactions: '++id, date, type, categoryId, accountId, transferAccountId, source, importBatchId, *tags, externalId',
      importBatches: '++id, createdAt',
    })
    // v6：自动分类规则、字段映射模板
    this.version(6).stores({
      rules: '++id, order, categoryId',
      importTemplates: '++id, name',
    })
    // v7：云同步元数据。每张同步表加 uid（跨设备唯一）、dirty（待推送）索引，新增删除记录表。
    // 已有数据补上 uid 并标记为待推送；没改过的默认分类 / 账户用固定 uid，且不推送（每台设备都有同样一份）。
    this.version(7)
      .stores({
        transactions:
          '++id, &uid, dirty, date, type, categoryId, accountId, transferAccountId, source, importBatchId, *tags, externalId',
        categories: '++id, &uid, dirty, type, name, order',
        accounts: '++id, &uid, dirty, name, order',
        budgets: '++id, &uid, dirty, categoryId',
        importBatches: '++id, &uid, dirty, createdAt',
        rules: '++id, &uid, dirty, order, categoryId',
        importTemplates: '++id, &uid, dirty, name',
        [TOMBSTONES]: '[table+uid]',
        upgradeBackups: '++id',
      })
      .upgrade(async (tx) => {
        const now = Date.now()
        // 改动之前先把升级前的数据原样存一份
        const data = {} as Backup['data']
        for (const table of V6_TABLES) data[table] = await tx.table(table).toArray()
        if (V6_TABLES.some((t) => data[t].length > 0)) {
          await tx.table('upgradeBackups').add({
            fromVersion: 6,
            reason: 'upgrade',
            backup: { app: BACKUP_APP, format: BACKUP_FORMAT, schema: 6, exportedAt: new Date(now).toISOString(), data },
          } satisfies UpgradeBackup)
        }
        const touch = (row: SyncMeta, uid: string, pristine = false) => {
          row.uid ??= uid
          if (pristine) {
            row.modifiedAt = 0
            delete row.dirty
          } else {
            row.modifiedAt = now
            row.dirty = 1
          }
        }
        const categoryUids = new Map<number, string>()
        await tx
          .table('categories')
          .toCollection()
          .modify((c: Category) => {
            const i = (c.id ?? 0) - 1
            const preset = DEFAULT_CATEGORIES[i]
            const isDefault = preset?.name === c.name && preset.type === c.type
            const pristine =
              isDefault && preset.icon === c.icon && preset.color === c.color && preset.order === c.order && !c.archived
            touch(c, isDefault ? defaultCategoryUid(i + 1) : newUid(), pristine)
            categoryUids.set(c.id!, c.uid!)
          })
        await tx
          .table('accounts')
          .toCollection()
          .modify((a: Account) => {
            const i = (a.id ?? 0) - 1
            const preset = DEFAULT_ACCOUNTS[i]
            const isDefault = preset?.name === a.name
            const pristine =
              isDefault && preset.type === a.type && !a.initialBalance && preset.order === a.order && !a.archived && !a.note
            touch(a, isDefault ? defaultAccountUid(i + 1) : newUid(), pristine)
          })
        await tx
          .table('budgets')
          .toCollection()
          .modify((b: Budget) => {
            const categoryUid = b.categoryId === undefined ? undefined : categoryUids.get(b.categoryId)
            touch(b, b.categoryId !== undefined && !categoryUid ? newUid() : budgetUid(categoryUid))
          })
        for (const table of ['transactions', 'importBatches', 'rules', 'importTemplates']) {
          await tx
            .table(table)
            .toCollection()
            .modify((row: SyncMeta) => touch(row, newUid()))
        }
      })
    // v8：标签目录与商户标签，写入内置的初始标签（每台设备都有，不推送）
    this.version(8)
      .stores({
        tags: '++id, &uid, dirty, name, order',
        tagRules: '++id, &uid, dirty, merchant',
      })
      .upgrade((tx) => tx.table('tags').bulkAdd(DEFAULT_TAGS.map((t) => ({ ...t, modifiedAt: 0 }))))
    // v9：预算账单；流水按对应的预算期（planRef）索引
    this.version(9).stores({
      transactions:
        '++id, &uid, dirty, date, type, categoryId, accountId, transferAccountId, source, importBatchId, *tags, externalId, planRef',
      plans: '++id, &uid, dirty, startDate',
    })
    // 默认分类、账户和标签是每台设备都有的基线：modifiedAt 为 0、不推送，云端有改动时以云端为准
    this.on('populate', (tx) => {
      tx.table('categories').bulkAdd(DEFAULT_CATEGORIES.map((c) => ({ ...c, modifiedAt: 0 })))
      tx.table('accounts').bulkAdd(DEFAULT_ACCOUNTS.map((a) => ({ ...a, modifiedAt: 0 })))
      tx.table('tags').bulkAdd(DEFAULT_TAGS.map((t) => ({ ...t, modifiedAt: 0 })))
    })
    this.use(syncMiddleware())
  }
}

/** v6 时就有的表（v7 升级前备份用，之后新增的表不在其中） */
const V6_TABLES = ['accounts', 'categories', 'transactions', 'budgets', 'rules', 'importBatches', 'importTemplates'] as const

export interface UpgradeBackup {
  id?: number
  /** 备份时的数据库版本 */
  fromVersion: number
  /** upgrade：数据库升级前；replace：用云端数据替换本机前 */
  reason?: 'upgrade' | 'replace'
  backup: Backup
}

export const db = new BookkeepingDB()

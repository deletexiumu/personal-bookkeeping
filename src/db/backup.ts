import { BACKUP_APP, BACKUP_FORMAT, BACKUP_TABLES, type Backup, type BackupTable } from '../lib/backup'
import type { BookkeepingDB } from './index'

/** 导出全部数据 */
export async function exportBackup(db: BookkeepingDB, now = new Date()): Promise<Backup> {
  const data = {} as Backup['data']
  await db.transaction('r', BACKUP_TABLES.map((t) => db.table(t)), async () => {
    for (const table of BACKUP_TABLES) data[table] = await db.table(table).toArray()
  })
  return { app: BACKUP_APP, format: BACKUP_FORMAT, schema: db.verno, exportedAt: now.toISOString(), data }
}

export type RestorePlan = Record<BackupTable, { added: number; updated: number }>

/** 预估恢复结果：每张表新增多少、覆盖多少（同 ID） */
export async function planRestore(db: BookkeepingDB, backup: Backup): Promise<RestorePlan> {
  const plan = {} as RestorePlan
  for (const table of BACKUP_TABLES) {
    const ids = backup.data[table].map((r) => r.id as number)
    const existing = await db.table(table).bulkGet(ids)
    const updated = existing.filter(Boolean).length
    plan[table] = { added: ids.length - updated, updated }
  }
  return plan
}

/** 按 ID 合并恢复：同 ID 覆盖，新 ID 新增，备份里没有的本地数据保留 */
export async function restoreBackup(db: BookkeepingDB, backup: Backup): Promise<RestorePlan> {
  const plan = await planRestore(db, backup)
  await db.transaction('rw', BACKUP_TABLES.map((t) => db.table(t)), async () => {
    for (const table of BACKUP_TABLES) {
      if (backup.data[table].length > 0) await db.table(table).bulkPut(backup.data[table])
    }
  })
  return plan
}

/** 最近一次自动备份（数据库升级前、用云端数据替换本机前） */
export async function latestUpgradeBackup(db: BookkeepingDB): Promise<Backup | undefined> {
  return (await db.upgradeBackups.toCollection().last())?.backup
}

/** 清空本机数据前自动备份一份，只保留最近 3 份 */
export async function saveAutoBackup(db: BookkeepingDB, reason: 'replace'): Promise<void> {
  const backup = await exportBackup(db)
  await db.upgradeBackups.add({ fromVersion: db.verno, reason, backup })
  const keys = await db.upgradeBackups.toCollection().primaryKeys()
  if (keys.length > 3) await db.upgradeBackups.bulkDelete(keys.slice(0, keys.length - 3))
}

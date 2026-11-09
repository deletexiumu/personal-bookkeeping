/** JSON 备份格式：所有表原样导出，恢复时按 ID 合并（同 ID 覆盖，新 ID 新增） */

export const BACKUP_TABLES = [
  'accounts',
  'categories',
  'transactions',
  'budgets',
  'rules',
  'importBatches',
  'importTemplates',
  'tags',
  'tagRules',
] as const

export type BackupTable = (typeof BACKUP_TABLES)[number]

export const BACKUP_TABLE_LABELS: Record<BackupTable, string> = {
  accounts: '账户',
  categories: '分类',
  transactions: '流水',
  budgets: '预算',
  rules: '规则',
  importBatches: '导入记录',
  importTemplates: '映射模板',
  tags: '标签',
  tagRules: '商户标签',
}

export const BACKUP_APP = 'taozhubu'
export const BACKUP_FORMAT = 1

export interface Backup {
  app: typeof BACKUP_APP
  format: number
  /** 导出时的数据库版本 */
  schema: number
  exportedAt: string
  data: Record<BackupTable, Record<string, unknown>[]>
}

type Row = Record<string, unknown>

const isInt = (v: unknown) => Number.isSafeInteger(v)
const isStr = (v: unknown) => typeof v === 'string'
const isDate = (v: unknown) => isStr(v) && /^\d{4}-\d{2}-\d{2}$/.test(v as string)

/** 各表的最低字段校验，不合格的行跳过 */
const VALIDATORS: Record<BackupTable, (r: Row) => boolean> = {
  accounts: (r) => isStr(r.name),
  categories: (r) => isStr(r.name) && (r.type === 'expense' || r.type === 'income'),
  transactions: (r) =>
    ['expense', 'income', 'transfer'].includes(r.type as string) &&
    isInt(r.amount) &&
    (r.amount as number) > 0 &&
    isInt(r.accountId) &&
    isDate(r.date),
  budgets: (r) => isInt(r.amount),
  rules: (r) => isStr(r.keyword) && isInt(r.categoryId),
  importBatches: (r) => isStr(r.fileName) && isInt(r.createdAt),
  importTemplates: (r) => isStr(r.name) && Array.isArray(r.headers) && Array.isArray(r.columns),
  tags: (r) => isStr(r.name),
  tagRules: (r) => isStr(r.merchant) && Array.isArray(r.tags) && (r.tags as unknown[]).every(isStr),
}

export interface ParsedBackup {
  backup: Backup
  /** 各表因字段不合格跳过的行数 */
  skipped: Partial<Record<BackupTable, number>>
}

/** 解析备份文件；不是本应用的备份或格式更新时抛出错误 */
export function parseBackup(text: string): ParsedBackup {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('不是有效的 JSON 文件')
  }
  const obj = raw as Partial<Backup> | null
  if (!obj || obj.app !== BACKUP_APP || typeof obj.data !== 'object' || obj.data === null) {
    throw new Error('不是陶朱簿导出的备份文件')
  }
  if (typeof obj.format !== 'number' || obj.format > BACKUP_FORMAT) throw new Error('备份来自更新的版本，请先升级应用')
  const data = {} as Backup['data']
  const skipped: ParsedBackup['skipped'] = {}
  for (const table of BACKUP_TABLES) {
    const rows = (obj.data as Record<string, unknown>)[table]
    const list = Array.isArray(rows) ? rows : []
    const valid = list.filter((r): r is Row => typeof r === 'object' && r !== null && isInt((r as Row).id) && VALIDATORS[table](r as Row))
    data[table] = valid
    if (list.length > valid.length) skipped[table] = list.length - valid.length
  }
  return {
    backup: { app: BACKUP_APP, format: obj.format, schema: Number(obj.schema) || 0, exportedAt: String(obj.exportedAt ?? ''), data },
    skipped,
  }
}

/** 备份文件名，例如 taozhubu-backup-20261104.json */
export function backupFileName(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `taozhubu-backup-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}.json`
}

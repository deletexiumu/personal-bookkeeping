import { describe, expect, it } from 'vitest'
import { backupFileName, parseBackup } from './backup'

const valid = {
  app: 'taozhubu',
  format: 1,
  schema: 6,
  exportedAt: '2026-11-04T08:00:00.000Z',
  data: {
    accounts: [{ id: 1, name: '现金' }],
    categories: [{ id: 1, name: '餐饮', type: 'expense' }, { id: 2, name: '坏的', type: 'other' }],
    transactions: [
      { id: 1, type: 'expense', amount: 100, accountId: 1, date: '2026-11-04', source: 'manual', createdAt: 1, updatedAt: 1 },
      { id: 2, type: 'expense', amount: 1.5, accountId: 1, date: '2026-11-04' },
      { type: 'expense', amount: 100, accountId: 1, date: '2026-11-04' },
    ],
  },
}

describe('parseBackup', () => {
  it('校验字段，跳过不合格的行，缺少的表视为空', () => {
    const { backup, skipped } = parseBackup(JSON.stringify(valid))
    expect(backup.data.transactions).toHaveLength(1)
    expect(backup.data.categories).toHaveLength(1)
    expect(backup.data.rules).toEqual([])
    expect(skipped).toEqual({ categories: 1, transactions: 2 })
  })

  it('拒绝非 JSON、其他应用和更新版本的备份', () => {
    expect(() => parseBackup('{')).toThrow('不是有效的 JSON 文件')
    expect(() => parseBackup('{"app":"x","data":{}}')).toThrow('不是陶朱簿导出的备份文件')
    expect(() => parseBackup(JSON.stringify({ ...valid, format: 2 }))).toThrow('备份来自更新的版本')
  })

  it('备份文件名带日期', () => {
    expect(backupFileName(new Date(2026, 10, 4))).toBe('taozhubu-backup-20261104.json')
  })
})

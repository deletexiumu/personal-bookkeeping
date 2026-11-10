import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { PreviewItem } from '../lib/import/preview'
import { commitImport, revertImport } from './imports'
import { BookkeepingDB } from './index'
import { autoLinkTransaction, deletePlan, loadOccurrences, savePlan, setOccurrenceSkipped, setTransactionPlan, type PlanInput } from './plans'
import { addTransaction } from './transactions'

let db: BookkeepingDB

beforeEach(async () => {
  db = new BookkeepingDB(`test-${crypto.randomUUID()}`)
  await db.open()
})

afterEach(async () => {
  await db.delete()
})

const TODAY = '2026-11-10'
const rent: PlanInput = { name: '房租', type: 'expense', amount: 450000, categoryId: 5, repeat: 'monthly', startDate: '2026-09-15', keywords: ['谢志英'] }

describe('预算账单', () => {
  it('新建时对开始日期以来的已有流水回溯匹配，强对应的直接关联', async () => {
    const hit = await addTransaction(db, { type: 'expense', amount: 450000, accountId: 2, date: '2026-09-16', merchant: '谢志英' })
    const other = await addTransaction(db, { type: 'expense', amount: 450000, accountId: 2, date: '2026-10-15', merchant: '某超市' })
    const { id, linked } = await savePlan(db, rent, undefined, TODAY)
    expect(linked).toBe(1)
    const plan = (await db.plans.get(id))!
    expect(plan.uid).toBeTruthy()
    expect((await db.transactions.get(hit))!.planRef).toBe(`${plan.uid}@2026-09-15`)
    expect((await db.transactions.get(other))!.planRef).toBeUndefined()
    const list = await loadOccurrences(db, '2026-09-01', '2026-11-30', TODAY)
    expect(list.map((o) => o.status)).toEqual(['done', 'overdue', 'pending'])
  })

  it('跳过一期、手动关联与取消关联、删除预算时流水取消关联', async () => {
    const { id } = await savePlan(db, rent, undefined, TODAY)
    const uid = (await db.plans.get(id))!.uid!
    await setOccurrenceSkipped(db, id, '2026-10-15', true)
    const tx = await addTransaction(db, { type: 'expense', amount: 430000, accountId: 2, date: '2026-11-14', note: '转账' })
    await setTransactionPlan(db, tx, `${uid}@2026-11-15`)
    let list = await loadOccurrences(db, '2026-10-01', '2026-11-30', TODAY)
    expect(list.map((o) => [o.status, o.actual])).toEqual([
      ['skipped', 0],
      ['done', 430000],
    ])
    await setOccurrenceSkipped(db, id, '2026-10-15', false)
    list = await loadOccurrences(db, '2026-10-01', '2026-10-31', TODAY)
    expect(list[0].status).toBe('overdue')
    await deletePlan(db, id)
    expect((await db.transactions.get(tx))!.planRef).toBeUndefined()
    expect(await db.plans.count()).toBe(0)
  })

  it('记一笔后自动对上强对应的那一期', async () => {
    await savePlan(db, { ...rent, startDate: '2026-11-15' }, undefined, TODAY)
    const weak = await addTransaction(db, { type: 'expense', amount: 450000, accountId: 2, date: '2026-11-15', categoryId: 5 })
    expect(await autoLinkTransaction(db, weak, TODAY)).toBeUndefined()
    const tx = await addTransaction(db, { type: 'expense', amount: 450000, accountId: 2, date: '2026-11-13', merchant: '谢志英' })
    const occ = await autoLinkTransaction(db, tx, TODAY)
    expect(occ?.date).toBe('2026-11-15')
    expect((await db.transactions.get(tx))!.planRef).toBe(occ!.ref)
  })

  it('导入时对得上的行写入 planRef（合并的写在合并后那条上），撤销导入后那一期回到待发生', async () => {
    await savePlan(db, { ...rent, startDate: '2026-11-15' }, undefined, TODAY)
    await savePlan(db, { name: '工资', type: 'income', amount: 2000000, repeat: 'monthly', startDate: '2026-11-10', accountId: 2, categoryId: 20 }, undefined, TODAY)
    const bank = await addTransaction(db, { type: 'income', amount: 2000000, accountId: 2, date: '2026-11-10', source: 'import', categoryId: 20 })
    const items: PreviewItem[] = [
      {
        key: 0,
        row: { line: 2, date: '2026-11-15', type: 'expense', amount: 450000, merchant: '谢志英', ref: 'W1' },
        accountId: 3,
        categoryId: 5,
        selected: true,
      },
      {
        key: 1,
        row: { line: 3, date: '2026-11-10', type: 'income', amount: 2000000, merchant: '某公司', ref: 'W2' },
        accountId: 2,
        categoryId: 20,
        mergeWith: (await db.transactions.get(bank))!,
        selected: true,
      },
    ]
    const batchId = await commitImport(db, { source: 'wechat', fileName: 'w.xlsx', rowCount: 2, items, today: TODAY })
    expect((await db.importBatches.get(batchId))!.plannedCount).toBe(2)
    const inserted = await db.transactions.where('importBatchId').equals(batchId).first()
    expect(inserted!.planRef).toMatch(/@2026-11-15$/)
    expect((await db.transactions.get(bank))!.planRef).toMatch(/@2026-11-10$/)
    expect((await loadOccurrences(db, '2026-11-01', '2026-11-30', TODAY)).map((o) => o.status)).toEqual(['done', 'done'])
    await revertImport(db, batchId)
    expect((await loadOccurrences(db, '2026-11-15', '2026-11-15', TODAY))[0].status).toBe('pending')
  })

  it('用户选了不对应的行不写 planRef', async () => {
    await savePlan(db, { ...rent, startDate: '2026-11-15' }, undefined, TODAY)
    const items: PreviewItem[] = [
      { key: 0, row: { line: 2, date: '2026-11-15', type: 'expense', amount: 450000, merchant: '谢志英', ref: 'W1' }, accountId: 3, planChoice: 'off', selected: true },
    ]
    const batchId = await commitImport(db, { source: 'wechat', fileName: 'w.xlsx', rowCount: 1, items, today: TODAY })
    expect((await db.transactions.where('importBatchId').equals(batchId).first())!.planRef).toBeUndefined()
  })
})

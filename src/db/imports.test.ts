import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildPreview, type PreviewItem } from '../lib/import/preview'
import { commitImport, listImportBatches, loadDedupeCandidates, revertImport } from './imports'
import { BookkeepingDB } from './index'
import { addTransaction } from './transactions'

let db: BookkeepingDB

beforeEach(async () => {
  db = new BookkeepingDB(`test-${crypto.randomUUID()}`)
  await db.open()
})

afterEach(async () => {
  await db.delete()
})

const item = (key: number, selected = true): PreviewItem => ({
  key,
  row: { line: key + 2, date: '2026-10-31', time: '12:08', type: 'expense', amount: 100 * (key + 1), merchant: `商户${key}`, ref: `R${key}` },
  accountId: 2,
  categoryId: key === 0 ? 1 : undefined,
  selected,
})

describe('导入批次', () => {
  it('只写入勾选的行，记来源和批次', async () => {
    const batchId = await commitImport(db, { source: 'csv', fileName: 'a.csv', rowCount: 3, items: [item(0), item(1), item(2, false)] })
    const rows = await db.transactions.where('importBatchId').equals(batchId).toArray()
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ source: 'import', merchant: '商户0', categoryId: 1, accountId: 2, externalId: 'R0', time: '12:08' })
    expect(rows[1].categoryId).toBeUndefined()
    const [batch] = await listImportBatches(db)
    expect(batch).toMatchObject({ id: batchId, fileName: 'a.csv', rowCount: 3, importedCount: 2, status: 'done' })
  })

  it('保存时按交易单号去重：账本里已有的单号和本次重复的单号都不再写入', async () => {
    await addTransaction(db, { type: 'expense', amount: 100, accountId: 2, date: '2026-10-31', externalId: 'R0' })
    const dupInBatch = { ...item(2), key: 3 }
    const batchId = await commitImport(db, { source: 'wechat', fileName: 'b.xlsx', rowCount: 4, items: [item(0), item(1), item(2), dupInBatch] })
    const rows = await db.transactions.where('importBatchId').equals(batchId).toArray()
    expect(rows.map((r) => r.externalId)).toEqual(['R1', 'R2'])
    expect(await db.importBatches.get(batchId)).toMatchObject({ importedCount: 2 })
    expect(await db.transactions.where('externalId').equals('R0').count()).toBe(1)
  })

  it('重复导入同一份钱包账单：按单号给已有流水补上空字段，不论勾没勾选；已有的值和分类不改', async () => {
    const oldId = await addTransaction(db, {
      type: 'expense', amount: 3117, accountId: 3, date: '2026-10-28', merchant: '淘宝闪购', note: '盒马鲜生(中铁西城店)', externalId: 'A1', categoryId: 1, source: 'import',
    })
    const editedId = await addTransaction(db, { type: 'expense', amount: 500, accountId: 3, date: '2026-10-28', note: '我改过的备注', externalId: 'A2', payMethod: '花呗', source: 'import' })
    const [old, edited] = [(await db.transactions.get(oldId))!, (await db.transactions.get(editedId))!]
    const rowOf = (ref: string, goods: string, merchantRef: string) =>
      ({ line: 2, date: '2026-10-28', time: '18:36', type: 'expense' as const, amount: 3117, merchant: '淘宝闪购', goods, note: goods, ref, merchantRef, accountName: '余额宝' })
    const items = buildPreview([rowOf('A1', '盒马鲜生(中铁西城店)', 'M1'), rowOf('A2', '永辉超市', 'M2')], {
      categories: [], merchantHistory: new Map(), accounts: [], defaultAccountId: 3, existing: [old, edited], source: 'alipay',
    })
    expect(items.map((i) => [i.duplicateOf, i.selected])).toEqual([[old, false], [edited, false]])
    const batchId = await commitImport(db, { source: 'alipay', fileName: 'alipay.csv', rowCount: 2, items })
    // 原来商品说明写在备注里：补上商品说明后备注清空；时间、商户单号、付款方式补上
    const filled = (await db.transactions.get(oldId))!
    expect(filled).toMatchObject({ goods: '盒马鲜生(中铁西城店)', merchantOrderNo: 'M1', payMethod: '余额宝', time: '18:36', categoryId: 1, amount: 3117 })
    expect(filled.note).toBeUndefined()
    // 改过的备注保留，已有的付款方式不改
    expect(await db.transactions.get(editedId)).toMatchObject({ goods: '永辉超市', note: '我改过的备注', payMethod: '花呗', merchantOrderNo: 'M2' })
    expect(await db.importBatches.get(batchId)).toMatchObject({ importedCount: 0, filledCount: 2 })
    expect(await db.transactions.count()).toBe(2)
    // 再导一次没有可补的
    const again = buildPreview([rowOf('A1', '盒马鲜生(中铁西城店)', 'M1')], {
      categories: [], merchantHistory: new Map(), accounts: [], defaultAccountId: 3, existing: [filled], source: 'alipay',
    })
    expect(again[0].backfill).toBeUndefined()
  })

  it('补全也认合并进来的钱包明细（如已合并成转账的那条），没有订单号时补上', async () => {
    const id = await addTransaction(db, {
      type: 'transfer', amount: 220000, accountId: 5, transferAccountId: 3, date: '2026-11-01', merchant: '蚂蚁（杭州）基金销售有限公司', note: '支付宝', source: 'import',
      merged: [
        { label: '中信银行流水', date: '2026-11-01', note: '支付宝', bank: true },
        { label: '支付宝账单', date: '2026-11-01', note: '余额宝-单次转入', ref: 'A9' },
      ],
    })
    const t = (await db.transactions.get(id))!
    const row = { line: 2, date: '2026-11-01', time: '15:43', type: 'income' as const, amount: 220000, merchant: '余额宝', goods: '余额宝-单次转入', note: '余额宝-单次转入', ref: 'A9', skipReason: '不计收支' }
    const [it] = buildPreview([row], { categories: [], merchantHistory: new Map(), accounts: [], defaultAccountId: 3, existing: [t], source: 'alipay' })
    expect(it.duplicateOf).toBe(t)
    await commitImport(db, { source: 'alipay', fileName: 'alipay.csv', rowCount: 1, items: [it] })
    // 商户、备注已有，不改
    expect(await db.transactions.get(id)).toMatchObject({ externalId: 'A9', goods: '余额宝-单次转入', time: '15:43', merchant: '蚂蚁（杭州）基金销售有限公司', note: '支付宝' })
  })

  it('能合并的行更新已有流水，不新增，并记合并条数', async () => {
    await db.accounts.bulkPut([
      { id: 2, name: '招行卡' },
      { id: 3, name: '支付宝' },
    ])
    const walletId = await addTransaction(db, { type: 'expense', amount: 600, accountId: 3, date: '2026-10-31', merchant: '家和鲜包点', externalId: 'W1', categoryId: 1 })
    const wallet = (await db.transactions.get(walletId))!
    const bankRow: PreviewItem = {
      key: 0,
      row: { line: 2, date: '2026-10-31', type: 'expense', amount: 600, merchant: '家和鲜包点', note: '快捷支付' },
      accountId: 2,
      mergeWith: wallet,
      selected: true,
    }
    const batchId = await commitImport(db, { source: 'bank', fileName: '招商银行交易流水.pdf', rowCount: 2, items: [bankRow, item(1)], sourceLabel: '招商银行流水' })
    expect(await db.transactions.count()).toBe(2)
    expect(await db.importBatches.get(batchId)).toMatchObject({ importedCount: 1, mergedCount: 1 })
    const merged = (await db.transactions.get(walletId))!
    expect(merged).toMatchObject({ accountId: 2, externalId: 'W1', categoryId: 1, dirty: 1 })
    expect(merged.merged).toEqual([{ label: '招商银行流水', date: '2026-10-31', merchant: '家和鲜包点', note: '快捷支付', account: '招行卡', bank: true }])
  })

  it('预览之后已有那条在别处合并过时不再合并，照常新增', async () => {
    const walletId = await addTransaction(db, { type: 'expense', amount: 600, accountId: 3, date: '2026-10-31', externalId: 'W1' })
    const wallet = (await db.transactions.get(walletId))!
    await db.transactions.update(walletId, { merged: [{ label: '中信银行流水', date: '2026-10-31', bank: true }] })
    const bankRow: PreviewItem = { key: 0, row: { line: 2, date: '2026-10-31', type: 'expense', amount: 600, note: '快捷支付' }, accountId: 2, mergeWith: wallet, selected: true }
    const batchId = await commitImport(db, { source: 'bank', fileName: 'b.pdf', rowCount: 1, items: [bankRow] })
    expect(await db.importBatches.get(batchId)).toMatchObject({ importedCount: 1 })
    expect((await db.transactions.get(walletId))!.merged).toHaveLength(1)
  })

  it('要合并的已有流水已被删除时照常新增', async () => {
    const ghost = { id: 999, type: 'expense', amount: 600, accountId: 3, date: '2026-10-31', source: 'import', externalId: 'W1', createdAt: 1, updatedAt: 1 } as const
    const bankRow: PreviewItem = { key: 0, row: { line: 2, date: '2026-10-31', type: 'expense', amount: 600, note: '快捷支付' }, accountId: 2, mergeWith: ghost, selected: true }
    const batchId = await commitImport(db, { source: 'bank', fileName: 'b.pdf', rowCount: 1, items: [bankRow] })
    expect(await db.importBatches.get(batchId)).toMatchObject({ importedCount: 1 })
    expect(await db.transactions.count()).toBe(1)
  })

  it('本人账户间转账：已有那条改成转账，提现手续费另记一笔支出', async () => {
    await db.accounts.bulkPut([
      { id: 2, name: '招行卡', type: 'debit' },
      { id: 4, name: '微信', type: 'wechat' },
    ])
    const bankId = await addTransaction(db, { type: 'income', amount: 50606, accountId: 2, date: '2026-10-31', note: '网联收款', excluded: true })
    await db.transactions.update(bankId, { source: 'import' })
    const bank = (await db.transactions.get(bankId))!
    const wechatRow: PreviewItem = {
      key: 0,
      row: { line: 2, date: '2026-10-31', type: 'income', amount: 50657, ref: 'W1', merchant: '招商银行(1234)', kind: '零钱提现', note: '服务费¥0.51', skipReason: '不计收支' },
      accountId: 4,
      mergeWith: bank,
      transferPair: true,
      mergeAsTransfer: { from: 4, to: 2 },
      selected: true,
    }
    const batchId = await commitImport(db, { source: 'wechat', fileName: 'w.xlsx', rowCount: 1, items: [wechatRow] })
    expect(await db.transactions.get(bankId)).toMatchObject({ type: 'transfer', amount: 50606, accountId: 4, transferAccountId: 2 })
    const fee = await db.transactions.where('importBatchId').equals(batchId).toArray()
    expect(fee).toMatchObject([{ type: 'expense', amount: 51, accountId: 4, note: '提现手续费' }])
    expect(await db.importBatches.get(batchId)).toMatchObject({ importedCount: 0, mergedCount: 1 })
  })

  it('退款对上已有原支出：全额时两条都不计收支，部分时从原支出里扣', async () => {
    await db.accounts.bulkPut([{ id: 2, name: '招行卡', type: 'debit' }])
    const buyId = await addTransaction(db, { type: 'expense', amount: 1998300, accountId: 2, date: '2026-04-21', merchant: '机械革命', note: '快捷支付' })
    const buy = (await db.transactions.get(buyId))!
    const refundRow = (amount: number): PreviewItem['row'] => ({ line: 2, date: '2026-04-21', type: 'income', amount, merchant: '机械革命', note: '快捷退款' })
    const purchase = { tx: buy, accountId: 2, date: buy.date, amount: buy.amount, merchant: buy.merchant, note: buy.note }
    const full: PreviewItem = { key: 0, row: refundRow(1998300), accountId: 2, refundOf: { tx: buy, full: true, purchase }, selected: true }
    const batchId = await commitImport(db, { source: 'bank', fileName: 'cmb.pdf', rowCount: 1, items: [full], sourceLabel: '招商银行流水' })
    const after = (await db.transactions.get(buyId))!
    expect(after).toMatchObject({ excluded: true, amount: 1998300 })
    expect(after.merged).toMatchObject([{ refund: true, amount: 1998300, note: '快捷退款' }])
    const [inserted] = await db.transactions.where('importBatchId').equals(batchId).toArray()
    expect(inserted).toMatchObject({ type: 'income', excluded: true, merged: [{ amount: 1998300, note: '快捷支付' }] })

    // 部分退款：原支出已不计收支（全额退过）时不再扣，按普通收入写入
    const again: PreviewItem = { key: 0, row: refundRow(100), accountId: 2, refundOf: { tx: buy, full: false, purchase }, selected: true }
    const b2 = await commitImport(db, { source: 'bank', fileName: 'cmb.pdf', rowCount: 1, items: [again] })
    expect(await db.importBatches.get(b2)).toMatchObject({ importedCount: 1 })
    expect((await db.transactions.get(buyId))!.amount).toBe(1998300)
  })

  it('部分退款并进已有原支出，不新增记录', async () => {
    const buyId = await addTransaction(db, { type: 'expense', amount: 62890, accountId: 3, date: '2026-10-10', merchant: '小北租电动车' })
    const buy = (await db.transactions.get(buyId))!
    const purchase = { tx: buy, accountId: 3, date: buy.date, amount: buy.amount, merchant: buy.merchant }
    const item: PreviewItem = { key: 0, row: { line: 2, date: '2026-10-13', type: 'income', amount: 17457, merchant: '小北租电动车', note: '退款-服务费', ref: 'R1' }, accountId: 3, refundOf: { tx: buy, full: false, purchase }, selected: true }
    const batchId = await commitImport(db, { source: 'alipay', fileName: 'a.csv', rowCount: 1, items: [item], sourceLabel: '支付宝账单' })
    expect(await db.importBatches.get(batchId)).toMatchObject({ importedCount: 0, mergedCount: 1 })
    expect(await db.transactions.get(buyId)).toMatchObject({ amount: 45433, merged: [{ refund: true, amount: 17457, ref: 'R1', label: '支付宝账单' }] })
  })

  it('同一份账单里先买后退：全额时两条都不计收支，部分时原支出减掉退款', async () => {
    const buy = (key: number, amount: number): PreviewItem => ({ key, row: { line: key + 2, date: '2026-10-10', type: 'expense', amount, merchant: `店${key}`, ref: `B${key}` }, accountId: 3, selected: true })
    const p = (key: number, amount: number) => ({ key, accountId: 3, date: '2026-10-10', amount, merchant: `店${key}` })
    const items: PreviewItem[] = [
      buy(0, 1000),
      buy(1, 5000),
      { key: 2, row: { line: 4, date: '2026-10-11', type: 'income', amount: 1000, merchant: '店0', note: '退款', ref: 'F0' }, accountId: 3, refundOf: { key: 0, full: true, purchase: p(0, 1000) }, selected: true },
      { key: 3, row: { line: 5, date: '2026-10-11', type: 'income', amount: 1200, merchant: '店1', note: '退款', ref: 'F1' }, accountId: 3, refundOf: { key: 1, full: false, purchase: p(1, 5000) }, selected: true },
    ]
    const batchId = await commitImport(db, { source: 'alipay', fileName: 'a.csv', rowCount: 4, items, sourceLabel: '支付宝账单' })
    const rows = await db.transactions.where('importBatchId').equals(batchId).toArray()
    const byRef = new Map(rows.map((r) => [r.externalId, r]))
    expect(rows).toHaveLength(3)
    expect(byRef.get('B0')).toMatchObject({ excluded: true, amount: 1000, merged: [{ refund: true, ref: 'F0' }] })
    expect(byRef.get('F0')).toMatchObject({ excluded: true, type: 'income', merged: [{ ref: 'B0', amount: 1000 }] })
    expect(byRef.get('B1')).toMatchObject({ amount: 3800, merged: [{ refund: true, ref: 'F1', amount: 1200 }] })
    expect(byRef.get('B1')!.excluded).toBeUndefined()
    expect(await db.importBatches.get(batchId)).toMatchObject({ importedCount: 3, mergedCount: 1 })
  })

  it('同一笔已有支出被多次退款：依次扣，最后一笔退完余额时两条都不计收支', async () => {
    const buyId = await addTransaction(db, { type: 'expense', amount: 10000, accountId: 3, date: '2026-10-10', merchant: '小北租电动车' })
    await db.transactions.update(buyId, { source: 'import' })
    const buy = (await db.transactions.get(buyId))!
    const purchase = { tx: buy, accountId: 3, date: buy.date, amount: buy.amount, merchant: buy.merchant }
    const refund = (key: number, amount: number, date: string): PreviewItem => ({
      key,
      row: { line: key + 2, date, type: 'income', amount, merchant: '小北租电动车', note: '退款', ref: `R${key}` },
      accountId: 3,
      refundOf: { tx: buy, full: false, purchase },
      selected: true,
    })
    // 预览时都算成部分退款；保存时按扣完前一笔后的金额判断，第三笔正好退完
    const batchId = await commitImport(db, {
      source: 'alipay',
      fileName: 'a.csv',
      rowCount: 3,
      items: [refund(2, 3000, '2026-10-13'), refund(0, 2000, '2026-10-11'), refund(1, 5000, '2026-10-12')],
    })
    const after = (await db.transactions.get(buyId))!
    expect(after.amount).toBe(3000)
    expect(after.excluded).toBe(true)
    expect(after.merged!.map((m) => m.ref)).toEqual(['R0', 'R1', 'R2'])
    const inserted = await db.transactions.where('importBatchId').equals(batchId).toArray()
    expect(inserted).toMatchObject([{ externalId: 'R2', excluded: true, merged: [{ purchase: true, amount: 3000 }] }])
    expect(inserted[0].categoryId).toBeUndefined()
  })

  it('本批次的原支出没勾选时，退款按普通收入写入', async () => {
    const items: PreviewItem[] = [
      { key: 0, row: { line: 2, date: '2026-10-10', type: 'expense', amount: 1000, merchant: '店', ref: 'B0' }, accountId: 3, selected: false },
      { key: 1, row: { line: 3, date: '2026-10-11', type: 'income', amount: 1000, merchant: '店', note: '退款', ref: 'F0' }, accountId: 3, refundOf: { key: 0, full: true, purchase: { key: 0, accountId: 3, date: '2026-10-10', amount: 1000 } }, selected: true },
    ]
    const batchId = await commitImport(db, { source: 'alipay', fileName: 'a.csv', rowCount: 2, items })
    const rows = await db.transactions.where('importBatchId').equals(batchId).toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0].excluded).toBeUndefined()
  })

  it('整批撤销删除该批次流水，不影响其他记录', async () => {
    await addTransaction(db, { type: 'expense', amount: 1, accountId: 1, date: '2026-10-31' })
    const batchId = await commitImport(db, { source: 'csv', fileName: 'a.csv', rowCount: 2, items: [item(0), item(1)] })
    expect(await revertImport(db, batchId)).toBe(2)
    expect(await db.transactions.count()).toBe(1)
    expect(await db.importBatches.get(batchId)).toMatchObject({ status: 'reverted' })
    expect(await revertImport(db, batchId)).toBe(0)
  })

  it('去重候选：日期前后各两天，加上单号相同的流水', async () => {
    await addTransaction(db, { type: 'expense', amount: 1, accountId: 1, date: '2026-10-28' })
    await addTransaction(db, { type: 'expense', amount: 1, accountId: 1, date: '2026-10-29' })
    await addTransaction(db, { type: 'expense', amount: 1, accountId: 1, date: '2026-10-30' })
    await addTransaction(db, { type: 'expense', amount: 1, accountId: 1, date: '2026-11-02' })
    await addTransaction(db, { type: 'expense', amount: 1, accountId: 1, date: '2025-01-01', externalId: 'OLD' })
    const found = await loadDedupeCandidates(db, ['2026-11-01', '2026-10-31'], ['OLD'])
    expect(found.map((t) => t.date).sort()).toEqual(['2025-01-01', '2026-10-29', '2026-10-30', '2026-11-02'])
  })
})

import type { Account, Transaction } from '../types'

/**
 * 计算账户余额（分）：初始余额 + 收入 − 支出 − 转出 + 转入。
 * 钱包账单导入的不计收支流水（有交易单号）不计入余额：这类行的收支方向常常不可靠，如微信把提现记成收入；
 * 其余不计收支的（银行流水、手记）方向可靠，照常计入余额。信用卡余额为负表示欠款。
 */
export function computeBalances(accounts: Account[], transactions: Transaction[]): Map<number, number> {
  const balances = new Map<number, number>()
  for (const a of accounts) if (a.id !== undefined) balances.set(a.id, a.initialBalance ?? 0)
  const add = (id: number | undefined, delta: number) => {
    if (id !== undefined && balances.has(id)) balances.set(id, balances.get(id)! + delta)
  }
  for (const t of transactions) {
    if (t.excluded && t.externalId) continue
    if (t.type === 'income') add(t.accountId, t.amount)
    else if (t.type === 'expense') add(t.accountId, -t.amount)
    else {
      add(t.accountId, -t.amount)
      add(t.transferAccountId, t.amount)
    }
  }
  return balances
}

export interface NetWorth {
  /** 资产：余额为正的账户之和 */
  assets: number
  /** 负债：余额为负的账户之和（取正数） */
  liabilities: number
  net: number
}

export function netWorth(balances: Iterable<number>): NetWorth {
  let assets = 0
  let liabilities = 0
  for (const b of balances) {
    if (b >= 0) assets += b
    else liabilities -= b
  }
  return { assets, liabilities, net: assets - liabilities }
}

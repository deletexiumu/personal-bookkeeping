import type { Transaction } from '../types'

/**
 * 说明文字：账单的商品说明和备注拼在一起。早先导入的流水没有单独的商品说明（写在备注里），
 * 用它比对、搜索，新旧流水的结果一致
 */
export function describe(t: Pick<Transaction, 'goods' | 'note'>): string | undefined {
  return [t.goods?.trim(), t.note?.trim()].filter(Boolean).join(' · ') || undefined
}

/** 商户名：优先商户，没有时用商品说明和备注；都没有时为 undefined。分析页的商户排行和商户标签都按它归组 */
export function merchantOf(t: Pick<Transaction, 'merchant' | 'goods' | 'note'>): string | undefined {
  return t.merchant?.trim() || describe(t)
}

import type { Transaction } from '../types'

/** 商户名：优先商户，没有时用备注；两者都没有时为 undefined。分析页的商户排行和商户标签都按它归组 */
export function merchantOf(t: Pick<Transaction, 'merchant' | 'note'>): string | undefined {
  return t.merchant?.trim() || t.note?.trim() || undefined
}

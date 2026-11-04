/** 记一笔「沿用上次」：记住每种类型上次用的分类和账户。只存在本机浏览器。 */

export interface LastEntry {
  expenseCategoryId?: number
  incomeCategoryId?: number
  accountId?: number
  toAccountId?: number
}

const KEY = 'taozhubu:last-entry'

export function loadLastEntry(): LastEntry {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as LastEntry) : {}
  } catch {
    return {}
  }
}

export function saveLastEntry(patch: LastEntry): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...loadLastEntry(), ...patch }))
  } catch {
    // 隐私模式等情况下无法写入，忽略
  }
}

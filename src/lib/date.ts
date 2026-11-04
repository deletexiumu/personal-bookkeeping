/** 返回本地时区的今天，格式 YYYY-MM-DD */
export function today(now: Date = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** 取日期所在月份，格式 YYYY-MM */
export function monthOf(date: string): string {
  return date.slice(0, 7)
}

/** 月份加减，例如 shiftMonth('2026-01', -1) -> '2025-12' */
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number)
  const index = y * 12 + (m - 1) + delta
  const year = Math.floor(index / 12)
  return `${year}-${String((index % 12) + 1).padStart(2, '0')}`
}

/** '2026-11' -> '2026年11月' */
export function formatMonth(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return `${y}年${m}月`
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

/** 明细分组标题，例如「今天 · 11月4日 周三」「11月2日 周一」 */
export function formatDayLabel(date: string, todayDate: string = today()): string {
  const [y, m, d] = date.split('-').map(Number)
  const weekday = WEEKDAYS[new Date(y, m - 1, d).getDay()]
  const base = `${m}月${d}日 ${weekday}`
  if (date === todayDate) return `今天 · ${base}`
  const [ty, tm, td] = todayDate.split('-').map(Number)
  const yesterday = today(new Date(ty, tm - 1, td - 1))
  if (date === yesterday) return `昨天 · ${base}`
  return ty === y ? base : `${y}年${base}`
}

/** 返回本地时间，格式 HH:mm */
export function nowTime(now: Date = new Date()): string {
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
}

/** 日期加减天数，例如 shiftDate('2026-11-01', -1) -> '2026-10-31' */
export function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  return today(new Date(y, m - 1, d + days))
}

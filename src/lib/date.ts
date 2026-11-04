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

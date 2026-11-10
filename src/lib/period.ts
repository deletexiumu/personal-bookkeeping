import { shiftDate, shiftMonth, today } from './date'

/** 统计区间：周（周一开始）、自然月、自然年、自定义起止日期 */
export type PeriodKind = 'week' | 'month' | 'year' | 'custom'

export interface Period {
  kind: PeriodKind
  /** 起始日期（含），YYYY-MM-DD */
  start: string
  /** 结束日期（含），YYYY-MM-DD */
  end: string
}

export const PERIOD_LABELS: Record<PeriodKind, string> = {
  week: '周',
  month: '月',
  year: '年',
  custom: '自定义',
}

/** 与上一期对比时的说法 */
export const COMPARE_LABELS: Record<PeriodKind, string> = {
  week: '较上周',
  month: '较上月',
  year: '较去年',
  custom: '较上期',
}

function parts(date: string): [number, number, number] {
  const [y, m, d] = date.split('-').map(Number)
  return [y, m, d]
}

function lastDayOfMonth(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`
}

/** 日期所在的周 / 月 / 年；custom 视为当天 */
export function periodOf(kind: PeriodKind, date: string): Period {
  if (kind === 'week') {
    const [y, m, d] = parts(date)
    const offset = (new Date(y, m - 1, d).getDay() + 6) % 7
    const start = shiftDate(date, -offset)
    return { kind, start, end: shiftDate(start, 6) }
  }
  if (kind === 'month') {
    const month = date.slice(0, 7)
    return { kind, start: `${month}-01`, end: lastDayOfMonth(month) }
  }
  if (kind === 'year') {
    const year = date.slice(0, 4)
    return { kind, start: `${year}-01-01`, end: `${year}-12-31` }
  }
  return { kind, start: date, end: date }
}

/** 自定义区间：起止颠倒时自动交换 */
export function customPeriod(start: string, end: string): Period {
  return start <= end ? { kind: 'custom', start, end } : { kind: 'custom', start: end, end: start }
}

/** 两个日期之间的天数（含首尾） */
export function daysBetween(start: string, end: string): number {
  const [y1, m1, d1] = parts(start)
  const [y2, m2, d2] = parts(end)
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000) + 1
}

/** 前后切换：周 / 月 / 年按自然周期，自定义按相同天数平移 */
export function shiftPeriod(period: Period, delta: number): Period {
  const { kind, start, end } = period
  if (kind === 'week') return periodOf('week', shiftDate(start, delta * 7))
  if (kind === 'month') return periodOf('month', `${shiftMonth(start.slice(0, 7), delta)}-01`)
  if (kind === 'year') return periodOf('year', `${Number(start.slice(0, 4)) + delta}-01-01`)
  const length = daysBetween(start, end)
  return { kind, start: shiftDate(start, delta * length), end: shiftDate(end, delta * length) }
}

function shortDate(date: string, withYear: boolean): string {
  const [y, m, d] = parts(date)
  return withYear ? `${y}年${m}月${d}日` : `${m}月${d}日`
}

/** 区间标题，例如「2026年11月」「11月2日 – 8日」「2026年」 */
export function periodLabel(period: Period, todayDate: string = today()): string {
  const { kind, start, end } = period
  const [sy, sm] = parts(start)
  const [ey, em, ed] = parts(end)
  if (kind === 'month') return `${sy}年${sm}月`
  if (kind === 'year') return `${sy}年`
  const thisYear = Number(todayDate.slice(0, 4))
  const withYear = sy !== thisYear || ey !== thisYear
  if (start === end) return shortDate(start, withYear)
  if (sy === ey && sm === em && kind === 'week') return `${shortDate(start, withYear)} – ${ed}日`
  return `${shortDate(start, withYear)} – ${shortDate(end, withYear && sy !== ey)}`
}

/** 区间内已经过去的天数（含今天），用于日均；未来区间为 0 */
export function elapsedDays(period: Period, todayDate: string = today()): number {
  if (todayDate < period.start) return 0
  return daysBetween(period.start, todayDate < period.end ? todayDate : period.end)
}

/** 区间是否只在一个自然月内（可以直接跳到明细页查看） */
export function monthOfPeriod(period: Period): string | undefined {
  const month = period.start.slice(0, 7)
  return period.end.slice(0, 7) === month ? month : undefined
}

/** 区间在明细页能用哪种范围查看：一个自然月内返回 'YYYY-MM'，一个自然年内返回 'YYYY'，跨年返回 undefined */
export function listScopeOfPeriod(period: Pick<Period, 'start' | 'end'>): string | undefined {
  if (period.start.slice(0, 7) === period.end.slice(0, 7)) return period.start.slice(0, 7)
  if (period.start.slice(0, 4) === period.end.slice(0, 4)) return period.start.slice(0, 4)
  return undefined
}

/** 趋势图的一根柱子：一天或一个月 */
export interface Bucket {
  key: string
  start: string
  end: string
  /** 坐标轴上的短标签 */
  label: string
  /** 提示和表格里的完整标签 */
  title: string
}

const WEEKDAY_SHORT = ['日', '一', '二', '三', '四', '五', '六']

/** 自定义区间超过这么多天时按月聚合 */
export const MAX_DAY_BUCKETS = 62

/** 把区间切成趋势图的柱子：年和长自定义区间按月，其余按天 */
export function bucketsOf(period: Period): Bucket[] {
  const byMonth = period.kind === 'year' || (period.kind === 'custom' && daysBetween(period.start, period.end) > MAX_DAY_BUCKETS)
  const buckets: Bucket[] = []
  if (byMonth) {
    const firstYear = Number(period.start.slice(0, 4))
    for (let month = period.start.slice(0, 7); month <= period.end.slice(0, 7); month = shiftMonth(month, 1)) {
      const [y, m] = month.split('-').map(Number)
      const start = month === period.start.slice(0, 7) ? period.start : `${month}-01`
      const last = lastDayOfMonth(month)
      const end = last > period.end ? period.end : last
      const label = y !== firstYear && m === 1 ? `${y}年1月` : `${m}月`
      buckets.push({ key: month, start, end, label, title: `${y}年${m}月` })
    }
    return buckets
  }
  for (let date = period.start; date <= period.end; date = shiftDate(date, 1)) {
    const [y, m, d] = parts(date)
    const weekday = WEEKDAY_SHORT[new Date(y, m - 1, d).getDay()]
    const label = period.kind === 'week' ? `周${weekday}` : period.kind === 'month' ? String(d) : `${m}/${d}`
    buckets.push({ key: date, start: date, end: date, label, title: `${m}月${d}日 周${weekday}` })
  }
  return buckets
}

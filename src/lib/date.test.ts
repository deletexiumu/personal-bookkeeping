import { describe, expect, it } from 'vitest'
import { formatDayLabel, formatMonth, shiftMonth, today } from './date'

describe('date', () => {
  it('today 使用本地时区', () => {
    expect(today(new Date(2026, 10, 4, 23, 59))).toBe('2026-11-04')
  })

  it('shiftMonth 跨年加减', () => {
    expect(shiftMonth('2026-11', 1)).toBe('2026-12')
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
    expect(shiftMonth('2026-03', -14)).toBe('2025-01')
  })

  it('formatMonth', () => {
    expect(formatMonth('2026-01')).toBe('2026年1月')
  })

  it('formatDayLabel 标出今天、昨天和跨年日期', () => {
    expect(formatDayLabel('2026-11-04', '2026-11-04')).toBe('今天 · 11月4日 周三')
    expect(formatDayLabel('2026-11-03', '2026-11-04')).toBe('昨天 · 11月3日 周二')
    expect(formatDayLabel('2026-11-01', '2026-11-04')).toBe('11月1日 周日')
    expect(formatDayLabel('2025-12-31', '2026-01-01')).toBe('昨天 · 12月31日 周三')
    expect(formatDayLabel('2025-12-30', '2026-01-01')).toBe('2025年12月30日 周二')
  })
})

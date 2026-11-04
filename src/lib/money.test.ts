import { describe, expect, it } from 'vitest'
import { formatCents, parseAmountToCents, parseBalanceToCents } from './money'

describe('parseAmountToCents', () => {
  it('解析整数和小数金额', () => {
    expect(parseAmountToCents('12')).toBe(1200)
    expect(parseAmountToCents('12.3')).toBe(1230)
    expect(parseAmountToCents(' 0.01 ')).toBe(1)
    expect(parseAmountToCents('19.99')).toBe(1999)
  })

  it('拒绝非法输入', () => {
    for (const bad of ['', '0', '0.00', '-1', '1.234', 'abc', '1,000', '.5']) {
      expect(parseAmountToCents(bad)).toBeNull()
    }
  })
})

describe('formatCents', () => {
  it('格式化为人民币字符串', () => {
    expect(formatCents(0)).toBe('¥0.00')
    expect(formatCents(5)).toBe('¥0.05')
    expect(formatCents(123456)).toBe('¥1,234.56')
    expect(formatCents(-1999)).toBe('-¥19.99')
  })
})

describe('parseBalanceToCents', () => {
  it('允许 0、负数和空值', () => {
    expect(parseBalanceToCents('')).toBe(0)
    expect(parseBalanceToCents('0')).toBe(0)
    expect(parseBalanceToCents('-0')).toBe(0)
    expect(parseBalanceToCents('-500.5')).toBe(-50050)
    expect(parseBalanceToCents('1234.56')).toBe(123456)
  })

  it('拒绝非法输入', () => {
    for (const bad of ['abc', '1.234', '--1', '1,000']) expect(parseBalanceToCents(bad)).toBeNull()
  })
})

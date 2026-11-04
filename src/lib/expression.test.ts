import { describe, expect, it } from 'vitest'
import { applyKey, evaluateAmount, hasOperation, type KeypadKey } from './expression'

const cents = (expr: string) => {
  const r = evaluateAmount(expr)
  return r.ok ? r.cents : r.error
}

describe('evaluateAmount', () => {
  it('计算单个金额', () => {
    expect(cents('32')).toBe(3200)
    expect(cents('0.01')).toBe(1)
    expect(cents('19.9')).toBe(1990)
  })

  it('加减乘除，先乘除后加减', () => {
    expect(cents('12+8.5')).toBe(2050)
    expect(cents('30-4.55')).toBe(2545)
    expect(cents('12.5×3')).toBe(3750)
    expect(cents('100÷3')).toBe(3333)
    expect(cents('10+2*3')).toBe(1600)
    expect(cents('0.1+0.2')).toBe(30)
  })

  it('忽略结尾运算符', () => {
    expect(cents('12+')).toBe(1200)
  })

  it('拒绝非法结果', () => {
    expect(cents('')).toBe('请输入金额')
    expect(cents('0')).toBe('金额必须大于 0')
    expect(cents('5-8')).toBe('金额必须大于 0')
    expect(cents('1.234')).toBe('金额最多两位小数')
    expect(cents('5/0')).toBe('不能除以 0')
    expect(cents('abc')).toBe('金额最多两位小数')
  })

  it('hasOperation', () => {
    expect(hasOperation('12')).toBe(false)
    expect(hasOperation('12+')).toBe(false)
    expect(hasOperation('12+3')).toBe(true)
  })
})

describe('applyKey', () => {
  const type = (keys: string) =>
    [...keys].reduce((expr, k) => applyKey(expr, (k === '<' ? 'backspace' : k) as KeypadKey), '')

  it('输入数字与小数点', () => {
    expect(type('12.5')).toBe('12.5')
    expect(type('.5')).toBe('0.5')
    expect(type('1..2')).toBe('1.2')
    expect(type('1.234')).toBe('1.23')
    expect(type('007')).toBe('7')
  })

  it('运算符不能开头，连续输入时替换', () => {
    expect(type('+1')).toBe('1')
    expect(type('1+-2')).toBe('1-2')
    expect(type('1.+2')).toBe('1+2')
  })

  it('退格', () => {
    expect(type('12+<<')).toBe('1')
  })
})

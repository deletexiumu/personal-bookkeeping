import { describe, expect, it } from 'vitest'
import { hrefOf, parseHash } from './router'

describe('parseHash', () => {
  it('解析已知路由', () => {
    expect(parseHash('#/analysis')).toBe('analysis')
    expect(parseHash('#/import?source=wechat')).toBe('import')
    expect(parseHash('#/settings/appearance')).toBe('settings')
    expect(parseHash(hrefOf('api'))).toBe('api')
  })

  it('空路径和未知路径回退到明细', () => {
    expect(parseHash('')).toBe('transactions')
    expect(parseHash('#/')).toBe('transactions')
    expect(parseHash('#/nope')).toBe('transactions')
  })
})

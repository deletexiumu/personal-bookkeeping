import { describe, expect, it } from 'vitest'
import { describe as describeText, merchantOf } from './merchant'

describe('merchantOf / describe', () => {
  it('说明文字是商品说明和备注拼起来；商户为空时按它归组', () => {
    expect(describeText({ goods: '余额宝-单次转入', note: '自己存' })).toBe('余额宝-单次转入 · 自己存')
    expect(describeText({ note: '午饭' })).toBe('午饭')
    expect(describeText({})).toBeUndefined()
    expect(merchantOf({ merchant: '盒马', goods: '外卖订单' })).toBe('盒马')
    // 早先导入的流水把商品说明写在备注里，新导入的分开存：商户为空时归组结果一致
    expect(merchantOf({ goods: '寄件' })).toBe(merchantOf({ note: '寄件' }))
  })
})

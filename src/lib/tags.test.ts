import { describe, expect, it } from 'vitest'
import { formatTags, parseTags } from './tags'

describe('tags', () => {
  it('解析多种分隔符并去重', () => {
    expect(parseTags('#家庭 #周末')).toEqual(['家庭', '周末'])
    expect(parseTags('家庭，周末、出差,家庭')).toEqual(['家庭', '周末', '出差'])
    expect(parseTags('  ')).toEqual([])
  })

  it('格式化', () => {
    expect(formatTags(['家庭', '周末'])).toBe('#家庭 #周末')
    expect(formatTags(undefined)).toBe('')
  })
})

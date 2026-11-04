import { afterEach, describe, expect, it } from 'vitest'
import { applyPreferences, loadPreferences } from './preferences'

afterEach(() => localStorage.clear())

describe('外观设置', () => {
  it('读取时忽略无效值', () => {
    expect(loadPreferences()).toEqual({ theme: 'system', moneyColors: 'default' })
    localStorage.setItem('taozhubu:preferences', JSON.stringify({ theme: 'dark', moneyColors: 'purple' }))
    expect(loadPreferences()).toEqual({ theme: 'dark', moneyColors: 'default' })
    localStorage.setItem('taozhubu:preferences', '{oops')
    expect(loadPreferences()).toEqual({ theme: 'system', moneyColors: 'default' })
  })

  it('写到根元素上，默认值不留属性', () => {
    const root = document.createElement('html')
    applyPreferences({ theme: 'light', moneyColors: 'green-income' }, root)
    expect(root.dataset).toMatchObject({ theme: 'light', money: 'green-income' })
    applyPreferences({ theme: 'system', moneyColors: 'default' }, root)
    expect(root.dataset.theme).toBeUndefined()
    expect(root.dataset.money).toBeUndefined()
  })
})

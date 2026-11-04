import { useCallback, useState } from 'react'

/** 外观：跟随系统 / 浅色 / 深色 */
export type ThemePreference = 'system' | 'light' | 'dark'

/** 金额颜色：默认（收入绿、支出黑）、红收绿支、绿收红支 */
export type MoneyColors = 'default' | 'red-income' | 'green-income'

/** 只影响这台设备上的显示，存在 localStorage，不进备份 */
export interface Preferences {
  theme: ThemePreference
  moneyColors: MoneyColors
}

export const DEFAULT_PREFERENCES: Preferences = { theme: 'system', moneyColors: 'default' }

const KEY = 'taozhubu:preferences'
const THEMES: ThemePreference[] = ['system', 'light', 'dark']
const MONEY_COLORS: MoneyColors[] = ['default', 'red-income', 'green-income']

export function loadPreferences(): Preferences {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Preferences>
    return {
      theme: THEMES.includes(raw.theme as ThemePreference) ? (raw.theme as ThemePreference) : DEFAULT_PREFERENCES.theme,
      moneyColors: MONEY_COLORS.includes(raw.moneyColors as MoneyColors)
        ? (raw.moneyColors as MoneyColors)
        : DEFAULT_PREFERENCES.moneyColors,
    }
  } catch {
    return DEFAULT_PREFERENCES
  }
}

function savePreferences(preferences: Preferences) {
  try {
    localStorage.setItem(KEY, JSON.stringify(preferences))
  } catch {
    // 隐私模式等场景写不进去时，只在本次会话生效
  }
}

/** 写到 <html> 上：data-theme 对应 tokens.css 的手动深浅色，data-money 切换金额配色 */
export function applyPreferences(preferences: Preferences, root: HTMLElement = document.documentElement) {
  if (preferences.theme === 'system') delete root.dataset.theme
  else root.dataset.theme = preferences.theme
  if (preferences.moneyColors === 'default') delete root.dataset.money
  else root.dataset.money = preferences.moneyColors
}

export function usePreferences(): [Preferences, (patch: Partial<Preferences>) => void] {
  const [preferences, setPreferences] = useState(loadPreferences)
  const update = useCallback((patch: Partial<Preferences>) => {
    setPreferences((current) => {
      const next = { ...current, ...patch }
      savePreferences(next)
      applyPreferences(next)
      return next
    })
  }, [])
  return [preferences, update]
}

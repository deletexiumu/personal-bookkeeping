import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App.tsx'
import { applyPreferences, loadPreferences } from './app/preferences'
import { notifyPwa } from './app/pwa'
import '@fontsource-variable/inter/wght.css'
import './index.css'

// 渲染前套用外观设置，避免先闪一下默认配色
applyPreferences(loadPreferences())

// 发现新版本时提示用户刷新，而不是在记账过程中自动重载（桌面端关闭了 PWA，这里是空实现）
const updateSW = registerSW({
  onNeedRefresh: () => notifyPwa({ type: 'need-refresh', update: () => void updateSW(true) }),
  onOfflineReady: () => notifyPwa({ type: 'offline-ready' }),
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

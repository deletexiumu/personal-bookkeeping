import { readFileSync } from 'node:fs'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { configDefaults, defineConfig } from 'vitest/config'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

// 部署子路径：GitHub Pages 项目页为 /personal-bookkeeping/，其余场景默认根路径
const base = process.env.BASE_PATH ?? '/'

// Tauri CLI 执行 beforeDevCommand / beforeBuildCommand 时会注入 TAURI_ENV_* 变量。
// 桌面端的 WebView 使用自定义协议，不支持 Service Worker，所以打包桌面端时关闭 PWA。
const isTauri = Boolean(process.env.TAURI_ENV_PLATFORM)

// https://vite.dev/config/
export default defineConfig({
  base,
  // 让 Tauri 的 Rust 编译日志不被 Vite 清屏
  clearScreen: false,
  server: {
    // Tauri 开发模式依赖固定端口（见 src-tauri/tauri.conf.json 的 devUrl）
    port: 5173,
    strictPort: true,
    // 本地联调后端：cd server && DATA_DIR=.data COOKIE_SECURE=false pnpm dev
    proxy: { '/api': 'http://127.0.0.1:8787' },
  },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    // Windows 用 WebView2(Chromium)，macOS 用 WKWebView(Safari)
    target: isTauri
      ? process.env.TAURI_ENV_PLATFORM === 'windows'
        ? 'chrome105'
        : 'safari15'
      : undefined,
    sourcemap: Boolean(process.env.TAURI_ENV_DEBUG),
  },
  plugins: [
    react(),
    VitePWA({
      disable: isTauri,
      registerType: 'prompt',
      workbox: {
        // 预缓存 Inter 拉丁字符子集，离线时金额数字字体不回退
        globPatterns: ['**/*.{js,css,html}', 'assets/inter-latin-wght-normal-*.woff2'],
        // 后端接口不能被 Service Worker 当成页面导航回落到 index.html
        navigateFallbackDenylist: [/^\/api\//],
      },
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: '陶朱簿',
        short_name: '陶朱簿',
        description: '陶朱簿：简单、私密的个人记账应用',
        lang: 'zh-CN',
        start_url: base,
        scope: base,
        display: 'standalone',
        background_color: '#f4f6f9',
        theme_color: '#2f6bff',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // 后端有自己的测试配置（server/vitest.config.ts）
    exclude: [...configDefaults.exclude, 'server/**'],
  },
})

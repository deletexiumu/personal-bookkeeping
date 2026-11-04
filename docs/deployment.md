# 金匮簿：多端部署与 CI/CD

本文说明金匮簿（个人记账软件）在各个目标端的部署方式、多端代码怎么组织，以及仓库里的 GitHub Actions 工作流各自做什么、需要你在 GitHub 上配置什么。微信小程序的设计与开发另行文档说明，这里只讲它对代码组织和后端的影响。

## 1. 部署方案总览

| 目标端 | 方案 | 产物 | 什么时候发布 |
| --- | --- | --- | --- |
| Web / PWA | GitHub Pages（默认） | 静态站点，可安装为 PWA、离线可用 | 合并到 `main` 自动部署 |
| Web 自托管 | Docker 镜像（nginx） | `ghcr.io/deletexiumu/personal-bookkeeping` | `main` → `:edge`；打 `v*` 标签 → `:x.y.z`、`:latest` |
| macOS | Tauri 2 | `.dmg`（Apple Silicon / Intel 各一个） | 打 `v*` 标签，进入草稿 Release |
| Windows | Tauri 2 | `.exe`（NSIS 安装包）、`.msi` | 同上 |
| 离线静态包 | zip | `jinkuibu-web-vX.Y.Z.zip` | 同上，可丢到任意静态服务器 |
| 微信小程序 | 另行实现 | — | 微信开发者工具 / miniprogram-ci 上传 |

### 1.1 Web：GitHub Pages

- 地址：<https://deletexiumu.github.io/personal-bookkeeping/>
- 免费、零运维，适合个人版。构建时通过 `BASE_PATH` 设置子路径，PWA 的 `start_url` 和 `scope` 会跟着变。
- 以后绑定自定义域名时不用改代码，工作流会从 Pages 配置里读到根路径。

**国内访问提示**：GitHub Pages 在国内访问速度不稳定。如果主要用户在国内，建议把同一份 `dist/` 放到国内的静态托管（腾讯云 COS / 阿里云 OSS + CDN）或用下面的 Docker 镜像部署到国内云服务器。这两种都需要已备案的自定义域名。

其他可直接连仓库的静态托管（Cloudflare Pages、Vercel、Netlify）也可以用：构建命令 `pnpm build`，输出目录 `dist`，不需要额外配置。

### 1.2 Web：Docker 自托管

镜像名沿用仓库名 `personal-bookkeeping`。镜像是两阶段构建：Node 22 编译前端，运行时用非 root 的 `nginx-unprivileged`，监听 8080 端口，自带 `/healthz` 健康检查。nginx 已配置好单页应用回落，以及 PWA 需要的缓存策略（`index.html`、`sw.js` 每次校验，`/assets/` 长期缓存）。

```bash
# 直接用发布好的镜像
docker compose up -d            # 访问 http://localhost:8080

# 或在本地构建
docker build -t jinkuibu .
docker run -d -p 8080:8080 jinkuibu
```

镜像同时提供 `linux/amd64` 和 `linux/arm64`，可以跑在云服务器、NAS 或树莓派上。注意 PWA 的 Service Worker 要求 HTTPS（`localhost` 除外），对外提供服务时请在前面加一层带证书的反向代理（Caddy、nginx、Traefik 等）。

### 1.3 macOS / Windows：Tauri 2

桌面端选 Tauri 而不是 Electron，理由如下：

- **体积小**：使用系统自带的 WebView（macOS 是 WKWebView，Windows 是 WebView2），安装包只有几 MB；Electron 要自带 Chromium，通常超过 100 MB。
- **完全复用 Web 前端**：`src-tauri/` 直接加载 `dist/`，界面代码只写一份。
- **为后续功能留好位置**：账单导入（读取支付宝 / 微信 / 银行导出的 CSV、Excel）、本地 SQLite、系统托盘、开机启动、本地 API，都可以用 Rust 侧插件实现，比浏览器沙箱能力强。

需要注意的差异：

- macOS 的 WKWebView 等同 Safari，构建目标已设为 `safari15`；新特性要留意 Safari 兼容性。
- 应用名「金匮簿」是中文，Windows 的 `.msi` 只生成简体中文版（WiX 的英文语言包使用 1252 代码页，写不进中文名）；`.exe`（NSIS）安装包同时支持中英文。
- 桌面端不支持 Service Worker，打包时会自动关闭 PWA（`vite.config.ts` 通过 `TAURI_ENV_PLATFORM` 判断）。
- 桌面端数据保存在 WebView 的 IndexedDB 里，位于系统的应用数据目录，与浏览器里的 PWA 数据互不相通。跨端同步依赖后面的同步服务。

本地开发桌面端需要 Rust 工具链（`rustup`），然后：

```bash
pnpm desktop:dev      # 开发模式，热更新
pnpm desktop:build    # 打本机平台的安装包
```

### 1.4 对外接口（API）

当前是本地优先：数据只在本机。要提供接口，有两种形态，建议分两步走：

1. **自托管同步服务（建议优先做）**：新增 `apps/api`（推荐 Hono + SQLite，可切 PostgreSQL），提供 REST 接口和 OpenAPI 文档，同时作为多端同步的后端。打包成 Docker 镜像，和 Web 镜像放在同一个 `docker-compose.yml` 里一起部署。**微信小程序读不到浏览器里的数据，跨端只能经过这个服务**，所以它是小程序上线的前提。小程序要求后端是 HTTPS 且域名已 ICP 备案，并在小程序后台配置为合法请求域名。
2. **桌面端本地 API（可选）**：在 Tauri 里开一个只监听 `127.0.0.1` 的 HTTP 接口，方便脚本、快捷指令、自动化工具写入账目，不需要服务器。

两种形态共用 `packages/api-contract` 里的接口定义，见下一节。

## 2. 多端代码组织

现在仓库只有一个前端，保持单包结构最省事。等到开始做小程序或 API 时，再切换为 pnpm workspaces 的 monorepo：

```
apps/
  web/            # 现在的 src/、index.html、vite.config.ts
  desktop/        # 现在的 src-tauri/，加载 apps/web 的构建产物
  miniprogram/    # 微信小程序（推荐 Taro + React，延续现有 React 技术栈）
  api/            # 同步服务与开放接口（Hono）
packages/
  core/           # 纯 TypeScript：类型、金额与日期工具、账单导入解析、统计分析
  storage/        # 存储接口 + 各端实现：Dexie（Web/桌面）、小程序本地存储、HTTP 同步
  api-contract/   # 接口的 schema（zod）与生成的 OpenAPI，前后端共用
```

为了以后迁移顺利，现在写代码时遵守两条约定：

- `src/lib/`、`src/types.ts` 以及以后的导入解析、统计分析代码**不依赖 DOM、React 和 Dexie**，迁移时整块搬进 `packages/core`，三端共用。
- 读写数据统一经过 `src/db/` 里的函数，不在组件里直接调用 Dexie，迁移时只需在 `packages/storage` 里换实现。

CI 在切换 monorepo 时只需把 `pnpm build` 换成 `pnpm -r build`（或 `pnpm --filter`），各工作流的结构不变。

## 3. CI/CD 工作流

| 文件 | 触发 | 做什么 |
| --- | --- | --- |
| `.github/workflows/ci.yml` | PR、推送 `main` | lint、测试、构建；改到 `src-tauri/` 时额外跑 Rust `clippy`；改到 Docker 相关文件时额外验证镜像能构建 |
| `.github/workflows/deploy-web.yml` | 推送 `main`、手动 | 构建并部署到 GitHub Pages |
| `.github/workflows/docker.yml` | 推送 `main`、`v*` 标签、手动 | 构建多架构镜像并推送到 ghcr.io |
| `.github/workflows/release.yml` | `v*` 标签、手动 | 创建草稿 Release，构建 macOS（arm64 / x64）、Windows 安装包和 Web 静态包并上传；手动触发时只构建，产物在 Actions 页面下载 |
| `.github/dependabot.yml` | 定时 | 自动提 PR 升级 Actions、npm、Cargo 依赖 |

### 3.1 发版流程

版本号只维护一处：`package.json` 的 `version`（`src-tauri/tauri.conf.json` 直接引用它）。

```bash
# 1. 改版本号并合并到 main（通过 PR）
npm version 0.2.0 --no-git-tag-version
# 2. 在 main 上打标签并推送
git tag v0.2.0
git push origin v0.2.0
```

推送标签后，Release 工作流会先检查标签和 `package.json` 版本是否一致，然后构建各平台安装包，上传到一个**草稿** Release。到 GitHub 的 Releases 页面检查后，点 “Publish release” 正式发布。同一个标签也会触发 Docker 工作流，推送 `:0.2.0`、`:0.2`、`:latest` 镜像。

## 4. 需要你在 GitHub 上配置的事项

**必须（一次性）：**

1. **开启 GitHub Pages**：仓库 Settings → Pages → Build and deployment → Source 选 **GitHub Actions**。不开启的话 `deploy-web` 会失败。
2. **公开 Docker 镜像（可选但建议）**：第一次推送镜像后，到 GitHub 个人主页 → Packages → `personal-bookkeeping` → Package settings → Change visibility 设为 Public，别人才能免登录拉取。

**可选：代码签名（不配也能发布，只是安装时有安全提示）：**

在 Settings → Secrets and variables → Actions 中添加：

| Secret | 说明 |
| --- | --- |
| `APPLE_CERTIFICATE` | “Developer ID Application” 证书导出的 `.p12`，再 `base64` 编码后的内容 |
| `APPLE_CERTIFICATE_PASSWORD` | 导出 `.p12` 时设的密码 |
| `APPLE_SIGNING_IDENTITY` | 证书名称，如 `Developer ID Application: Your Name (TEAMID)` |
| `APPLE_ID`、`APPLE_PASSWORD`、`APPLE_TEAM_ID` | 用于公证（notarization）；`APPLE_PASSWORD` 是在 appleid.apple.com 生成的 App 专用密码 |

macOS 签名需要加入 Apple Developer Program（99 美元/年）。没有签名时，用户首次打开需在“访达”里右键 → 打开。

Windows 签名现在需要硬件密钥或云签名服务，个人项目建议以后用 Azure Trusted Signing，通过 `tauri.conf.json` 的 `bundle.windows.signCommand` 接入。没有签名时，Windows 会出现 SmartScreen 提示，点“更多信息 → 仍要运行”即可。

**以后再做：桌面端自动更新**。接入 Tauri 的 updater 插件时，需要用 `pnpm tauri signer generate` 生成更新签名密钥，并配置 `TAURI_SIGNING_PRIVATE_KEY`、`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 两个 Secret。

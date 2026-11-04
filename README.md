# 陶朱簿

> **笔笔分明，自有陶朱。**
>
> 个人记账软件 · Personal Bookkeeping

[![CI](https://github.com/deletexiumu/personal-bookkeeping/actions/workflows/ci.yml/badge.svg)](https://github.com/deletexiumu/personal-bookkeeping/actions/workflows/ci.yml)
[![License: PolyForm Noncommercial](https://img.shields.io/badge/license-PolyForm%20Noncommercial%201.0.0-blue)](./LICENSE)

**陶朱簿**是一款面向个人的记账软件：多端可用、支持多种方式导入账单、自带统计分析，并提供开放接口，让你的账本数据始终掌握在自己手里。

**个人免费使用，商业使用需要授权**，详见 [商业授权说明](./COMMERCIAL.md)。

## 产品定位

- **个人优先**：为个人和家庭的日常收支管理设计，不做企业财务。
- **数据自主**：本地优先存储，可完整导出；同步与备份由你自己决定放在哪里。
- **少录入**：尽量通过导入账单而不是手工逐笔记账。
- **看得懂**：把收支数据变成清晰的趋势、构成和预算执行情况。
- **可扩展**：通过开放 API 接入你自己的脚本、自动化或其他工具。

## 核心能力

以下为产品目标能力，正在逐步实现。

| 能力 | 说明 |
| --- | --- |
| 记账 | 收入、支出、转账；金额、分类、账户、日期、标签、备注 |
| 多种导入 | 微信支付账单、支付宝账单、银行流水（CSV / Excel）、通用 CSV 模板、JSON 备份恢复；导入时自动识别分类并去重 |
| 统计分析 | 按月 / 年的收支趋势、分类构成、账户余额变化、预算执行与超支提醒、自定义时间范围对比 |
| 开放接口 | 提供 REST API，可查询账目、写入记录、批量导入、获取分析结果，便于自动化与第三方集成 |
| 导出备份 | 导出 CSV / JSON，随时迁移 |

## 支持平台

| 平台 | 状态 |
| --- | --- |
| Web（PWA，可安装、可离线） | 开发中 |
| 微信小程序 | 规划中 |
| macOS 桌面端 | 规划中 |
| Windows 桌面端 | 规划中 |

## 当前技术栈

- **React 19 + TypeScript + Vite**：前端界面
- **PWA（vite-plugin-pwa）**：可安装到手机/电脑桌面，离线可用
- **IndexedDB（Dexie）**：数据保存在本机，不上传任何服务器
- **Vitest + oxlint**：测试与代码检查

金额统一以「分」为单位的整数存储，避免浮点误差。

## 本地开发

需要 Node.js 20+ 和 pnpm 10。

```bash
pnpm install
pnpm dev        # 启动开发服务器
pnpm test       # 运行测试
pnpm lint       # 代码检查
pnpm build      # 类型检查并构建到 dist/
pnpm preview    # 本地预览构建结果（可测试 PWA 安装与离线）

# 桌面端（macOS / Windows，需要 Rust 工具链）
pnpm desktop:dev    # 桌面端开发模式
pnpm desktop:build  # 打本机平台的安装包
```

## 部署与发布

- **Web / PWA**：合并到 `main` 后自动部署到 GitHub Pages
- **自托管**：Docker 镜像 `ghcr.io/deletexiumu/personal-bookkeeping`，`docker compose up -d` 即可运行
- **macOS / Windows**：基于 Tauri 2，打 `v*` 标签后自动构建安装包到 GitHub Releases

详细说明、发版流程和需要配置的 GitHub 设置见 [docs/deployment.md](./docs/deployment.md)。

## 目录约定

```
.
├── .github/workflows/ # CI、Web 部署、Docker 镜像、桌面端发布
├── deploy/docker/     # 自托管 nginx 配置
├── docs/              # 设计与需求文档
├── public/            # 图标等静态资源
├── src/
│   ├── components/    # 界面组件
│   ├── db/            # 本地数据库（Dexie）与数据操作
│   ├── lib/           # 金额、日期等工具函数
│   └── types.ts       # 数据类型定义
├── src-tauri/         # 桌面端（Tauri 2）外壳
├── Dockerfile         # 自托管镜像
└── vite.config.ts     # Vite、PWA 与 Vitest 配置
```

## 参与贡献

分支命名、提交规范以及贡献代码的授权条款见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

## 许可证

陶朱簿采用 [PolyForm Noncommercial License 1.0.0](./LICENSE)：

- ✅ 个人使用、学习研究、非营利组织使用：免费
- ✅ 在非商用前提下修改、自行部署、再分发（须保留 LICENSE 与版权声明）
- ❌ 公司内部使用、作为付费产品或 SaaS 提供、集成进商业产品：需要 [商业授权](./COMMERCIAL.md)

注意：非商用许可不属于 OSI 定义的「开源许可证」，陶朱簿是源码公开（source-available）而非开源软件。

Copyright (c) 2026 deletexiumu

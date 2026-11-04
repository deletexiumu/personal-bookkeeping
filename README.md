# Personal Bookkeeping 个人记账

一个面向个人使用的记账软件，目标是让日常收支记录足够简单、数据完全掌握在自己手里。

## 技术栈

- **React 19 + TypeScript + Vite**：前端界面
- **PWA（vite-plugin-pwa）**：可安装到手机/电脑桌面，离线可用
- **IndexedDB（Dexie）**：数据只保存在本机浏览器，不上传任何服务器
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
```

## 规划功能

- 收支记录：金额、分类、账户、日期、备注
- 分类与账户管理（现金、银行卡、支付宝、微信等）
- 按月/按分类的统计与图表
- 预算设置与超支提醒
- 数据导入导出（CSV / JSON），便于备份与迁移

## 目录约定

```
.
├── docs/              # 设计与需求文档
├── public/            # 图标等静态资源
├── src/
│   ├── components/    # 界面组件
│   ├── db/            # 本地数据库（Dexie）与数据操作
│   ├── lib/           # 金额、日期等工具函数
│   └── types.ts       # 数据类型定义
└── vite.config.ts     # Vite、PWA 与 Vitest 配置
```

## 开发约定

- **分支**：从 `main` 拉出，命名格式为 `<type>_<name>_<feature>`，例如 `feat_knowing_transaction-list`；PR 目标分支为 `main`。
- **提交信息**：遵循 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/)，描述使用中文，例如 `feat: 新增收支记录列表`。
- 常用 type：`feat`、`fix`、`docs`、`style`、`refactor`、`test`、`chore`。

## 许可证

[MIT](./LICENSE)

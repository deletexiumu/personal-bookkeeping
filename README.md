# Personal Bookkeeping 个人记账

一个面向个人使用的记账软件，目标是让日常收支记录足够简单、数据完全掌握在自己手里。

> 项目处于初始化阶段，技术栈与脚手架将在后续 PR 中加入。

## 规划功能

- 收支记录：金额、分类、账户、日期、备注
- 分类与账户管理（现金、银行卡、支付宝、微信等）
- 按月/按分类的统计与图表
- 预算设置与超支提醒
- 数据导入导出（CSV / JSON），便于备份与迁移

## 目录约定

```
.
├── docs/        # 设计与需求文档
├── src/         # 源代码（脚手架搭建后加入）
└── README.md
```

## 开发约定

- **分支**：从 `main` 拉出，命名格式为 `<type>_<name>_<feature>`，例如 `feat_knowing_transaction-list`；PR 目标分支为 `main`。
- **提交信息**：遵循 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/)，描述使用中文，例如 `feat: 新增收支记录列表`。
- 常用 type：`feat`、`fix`、`docs`、`style`、`refactor`、`test`、`chore`。

## 许可证

[MIT](./LICENSE)

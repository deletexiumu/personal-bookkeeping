# 后端服务

`server/` 是陶朱簿的后端：账号、登录会话，以后加上多端同步和开放接口。整体方案（登录方式、同步策略、分阶段计划）见用户体系方案文档，这里只讲代码和运维。

- 运行时：Node 22，框架 Hono，参数校验 zod，数据访问 Drizzle ORM。
- 数据库：配了 `DATABASE_URL` 就用 PostgreSQL；不配时用内嵌的 PGlite（PostgreSQL 编译成 WebAssembly），数据存在 `DATA_DIR` 目录里，不需要单独装数据库。两种情况跑的是同一套迁移。
- 所有接口都在 `/api` 下。线上由反向代理把同一域名的 `/api/` 转给后端，Web 端同源访问，不需要 CORS。

## 本地开发

```bash
pnpm install                                   # 在仓库根目录，前后端依赖一起装
cd server
DATA_DIR=.data COOKIE_SECURE=false pnpm dev    # http://localhost:8787/api/healthz
pnpm test                                      # 默认用内存里的 PGlite
TEST_DATABASE_URL=postgres://… pnpm test       # 换成真实的 PostgreSQL（会清空表）
pnpm typecheck
```

前端联调：另开一个终端在仓库根目录运行 `pnpm dev`，Vite 会把 `/api` 代理到 `127.0.0.1:8787`，打开 `http://localhost:5173/#/login` 即可注册登录。

改了 `src/db/schema.ts` 后运行 `pnpm db:generate` 生成迁移 SQL（`server/drizzle/`），连同 schema 一起提交。服务启动时自动执行未执行过的迁移。迁移只做加法（加表、加列），这样部署失败回滚到旧镜像时旧代码仍能用新库。

## 配置（环境变量）

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `DATABASE_URL` | 无 | PostgreSQL 连接串；不填用内嵌 PGlite |
| `DATA_DIR` | `/data` | 内嵌数据库的数据目录 |
| `PORT` | `8787` | 监听端口 |
| `REGISTRATION` | `open` | `open` 开放注册、`invite` 需要邀请码、`closed` 关闭注册 |
| `SESSION_TTL_DAYS` | `30` | 会话有效天数，使用中自动续期 |
| `COOKIE_SECURE` | `true` | 会话 Cookie 是否只走 HTTPS；本地用 http 调试时设 `false` |
| `TRUST_PROXY` | `true` | 是否信任反向代理传来的 `X-Real-IP`，用于按 IP 限频 |
| `CORS_ORIGINS` | 桌面端 WebView 的来源 | 允许跨域访问的来源，逗号分隔。跨域请求只能用 Bearer 令牌，不带 Cookie；Web 端同源，不需要配 |
| `SYNC_MAX_RECORDS` | `200000` | 每个账号在云端最多存多少条记录（各表合计，含删除记录），开放注册时防滥用 |

## 接口

错误统一返回 `{ "error": { "code": "...", "message": "给用户看的中文提示", "field"?: "出错的字段" } }`。

| 方法与路径 | 说明 |
| --- | --- |
| `GET /api/healthz` | 健康检查（会查一次数据库） |
| `GET /api/auth/config` | 注册开关：`{ registration }` |
| `POST /api/auth/register` | `{ email, password, inviteCode?, tokenMode? }` 注册并登录 |
| `POST /api/auth/login` | `{ email, password, tokenMode? }` 登录 |
| `POST /api/auth/logout` | 退出当前设备 |
| `GET /api/auth/me` | 当前账号 |
| `POST /api/auth/password` | `{ currentPassword, newPassword }` 改密码，其他设备下线 |
| `GET /api/auth/sessions` | 已登录设备列表 |
| `DELETE /api/auth/sessions/:id` | 让某台设备下线 |
| `DELETE /api/auth/account` | `{ password }` 注销账号，删除全部云端数据 |
| `POST /api/sync/push` | `{ changes: [{ table, uid, modifiedAt, data }] }` 上传本机改动（一次最多 500 条），返回 `{ accepted, conflicts }` |
| `GET /api/sync/pull?since=&limit=` | 拉取 `rev` 大于 `since` 的改动，按 `rev` 升序；`more` 为 true 时用返回的 `cursor` 接着拉 |
| `GET /api/sync/status` | 云端各表的记录数 |

**令牌怎么传**：`tokenMode` 默认 `cookie`，令牌写进 HttpOnly、SameSite=Strict、Path=/api 的 Cookie，页面脚本读不到，Web 端用这个。桌面端和小程序不同源，传 `tokenMode: "bearer"`，令牌在响应的 `token` 字段，之后放在 `Authorization: Bearer` 头里。数据库只存令牌的 SHA-256。

**安全措施**：密码用 scrypt 加盐哈希；邮箱不存在时也跑一次哈希，响应时间不暴露邮箱是否注册；同一邮箱 15 分钟内失败 10 次、同一 IP 15 分钟内尝试 50 次后限频；用 Cookie 时改动类请求必须是 JSON（配合 SameSite=Strict 防跨站请求）；接口响应一律 `Cache-Control: no-store`。

## 管理命令

```bash
node dist/admin.js invite 7               # 生成 7 天有效的邀请码
node dist/admin.js reset-password 邮箱     # 重置为随机密码，所有设备下线
node dist/admin.js stats                  # 账号数、云端记录数
```

**用内嵌数据库时**，同一时间只能有一个进程打开数据目录，两个进程同时写会损坏数据。所以要先停服务，在一个临时容器里执行，再启动（在 `/opt/taozhubu/` 下）：

```bash
docker compose stop api
docker compose run --rm api node dist/admin.js invite 7
docker compose start api
```

服务运行时会在数据目录里放一个每 10 秒刷新的锁文件，忘了停服务时管理命令会拒绝执行并提示上面的命令。

**用 PostgreSQL 时**没有这个限制，直接对运行中的容器执行：`docker exec taozhubu-api node dist/admin.js invite 7`。

## 云同步

离线优先：所有读写都在本机 IndexedDB 里完成，登录后在后台和云端同步，断网时照常记账，联网后自动补上。

**服务端**（`server/src/sync/routes.ts`，表 `sync_records`）：每个账号每张表每个 `uid` 一行，`data` 是一行数据（外键已换成 uid），删除时为空。推送时按客户端的 `modifiedAt` 后写为准，云端更新（或相同）时不覆盖，在 `conflicts` 里返回云端版本。每次写入从序列 `sync_rev` 取一个新的 `rev`，客户端按 `rev` 增量拉取；同一账号的推送在事务里先锁住账号行，保证 `rev` 按提交顺序出现，拉取不会漏掉。

**客户端数据模型**（Dexie v7，`src/db/sync.ts`）：

- **uid**：七张业务表（账户、分类、流水、预算、规则、导入记录、映射模板）每行都有跨设备唯一的 `uid`。本地仍用自增数字 `id`，同步时外键（如流水的 `categoryId`）换成 `categoryUid` 传输，拉下来再换回本机的 `id`（`src/db/syncData.ts`）。
- **modifiedAt / dirty**：本机每次新增、修改都会写 `modifiedAt`（毫秒时间戳）并标 `dirty = 1`，表示待推送；推送成功后清掉。
- **删除记录**：删除一行时在 `syncTombstones` 表里记下 `[表名, uid]`，推送后清掉；同一个 uid 又被加回来（撤销删除、从备份恢复）时自动撤掉删除记录。
- **固定 uid**：默认分类、默认账户用 `default-category-N` / `default-account-N`，`modifiedAt` 为 0、不推送，每台设备都有同样一份，不会互相覆盖；改过之后才推送。预算按分类固定为 `budget-total` / `budget-<分类 uid>`，同一分类在各设备上是同一条预算。
- **云端写入**：拉下来的改动通过 `applyRemoteChanges` 写入，不会被标记为待推送，也不留删除记录。

以上字段都由数据库中间件自动维护，业务代码照常增删改即可。

**同步流程**（`src/app/sync.ts`）：每轮先拉取全部新改动、写入本机（本机还没推送且改得更晚的保留本机的），再分批推送本机改动。登录后、每分钟、联网时、切回页面时、本机有改动 2 秒后各触发一次；同一时间只跑一轮。

**第一次和账号同步**：本机没有自己的数据，或云端是空的（新注册），直接同步。两边都有数据时弹窗让用户选：合并到云端（推荐），或用云端数据替换本机（先自动备份本机数据）。换账号登录时同样处理。

**自动备份**：从 v6 升级、用云端数据替换本机前，都会把本机数据原样存一份（`upgradeBackups` 表，最多留 3 份），设置页「导出与备份」里可以下载，用「从备份恢复」导回。

**退出登录**：默认保留本机数据，下次登录同一账号接着同步；可以勾选同时清除本机数据（公用电脑）。

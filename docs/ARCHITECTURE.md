# 架构与核心机制

## 分层总览

```
┌──────────────────────────────────────────────────────────────┐
│  浏览器（React 19 + Tailwind 4 + Base UI）                     │
│  app/(dashboard)/*  12 个页面   components/*.tsx  7 个业务组件  │
└───────────────────────────┬──────────────────────────────────┘
                            │ fetch（cookie 携带 JWT）
┌───────────────────────────▼──────────────────────────────────┐
│  Next.js App Router  ·  44 个 Route Handler                    │
│  src/app/api/**/route.ts                                      │
│  统一约定：getAuthUser → 参数解析 → Prisma → serialize + camel │
└───────────────────────────┬──────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
┌───────────────┐  ┌────────────────┐  ┌──────────────────────┐
│ src/services  │  │ src/lib        │  │ Prisma 7             │
│ crawler.ts    │  │ auth / crypto  │  │ @prisma/adapter-pg   │
│ scheduler.ts  │  │ api-utils      │  │ ↓                    │
│ identity-     │  │ cli/*          │  │ PostgreSQL 18.2      │
│ health.ts     │  │                │  │ 14 张表              │
└───────┬───────┘  └────────┬───────┘  └──────────────────────┘
        │                   │
        └─────────┬─────────┘
                  ▼
        ┌──────────────────────────────┐
        │  tencent-channel-cli（外部）  │
        │  execFile 子进程 + 凭据文件    │
        └──────────────┬───────────────┘
                       ▼
                腾讯频道开放接口
```

**关键设计约束：项目自身不发 HTTP 请求去抓数据**，所有外部数据都经 `tencent-channel-cli` 子进程。因此爬取能力上限、限流表现、字段稳定性都由这个 CLI 决定，它是本项目最大的外部风险源。

## 目录结构

```
src/
├── app/
│   ├── (dashboard)/          # 登录后的主界面（共享 DashboardShell 布局）
│   │   ├── page.tsx          # 仪表盘：DAU/WAU/MAU、趋势、Top 发帖评论
│   │   ├── feeds/            # 帖子管理
│   │   ├── comments/         # 评论管理
│   │   ├── members/          # 成员管理
│   │   ├── violations/       # 违规记录 + config/ 违规配置
│   │   ├── crawl/            # 爬取管理（含 SSE 实时进度）
│   │   └── settings/         # 系统设置（用户/身份/自动规则/操作日志）
│   ├── login/ register/ identity-setup/   # 未登录流程
│   └── api/                  # 44 个 Route Handler
├── components/
│   ├── ui/                   # 23 个基础组件（Base UI 封装）
│   ├── DashboardShell.tsx    # 侧边栏 + 顶栏布局
│   ├── DataTable.tsx         # 通用表格（分页/排序/筛选）
│   ├── FeedDetail.tsx        # 帖子详情（评论与回复树）
│   ├── CrawlDashboard.tsx    # 爬取任务面板
│   ├── ViolationDialog.tsx   # 违规处置弹窗
│   └── MemberDetailDialog.tsx
├── lib/
│   ├── auth.ts               # JWT 签发/校验、密码哈希、refresh token
│   ├── crypto.ts             # aes-256-gcm 加解密（管理员 token）
│   ├── db.ts                 # Prisma client 单例
│   ├── api-utils.ts          # 统一响应、鉴权助手、BigInt 序列化、snake→camel
│   ├── api-client.ts         # 前端 fetch 封装（自动解包 data）
│   ├── identity-cache.ts     # 管理员身份缓存
│   ├── events.ts             # 任务事件总线（驱动 SSE）
│   └── cli/
│       ├── credentials.ts    # CLI 凭据文件的读写与身份切换
│       ├── executor.ts       # CLI 调用、重试、限流、身份轮转
│       ├── feed.ts           # 帖子/评论/回复类命令封装
│       └── member.ts         # 成员类命令封装
└── services/
    ├── crawler.ts            # 1783 行，爬取引擎
    ├── scheduler.ts          # 444 行，定时调度与任务锁
    └── identity-health.ts    # 管理员身份健康检查
```

## 爬取引擎

### 三种任务模式

| 模式 | 入口函数 | 触发方式 | 扫描范围 | 单轮评论补拉上限 |
|------|---------|---------|---------|----------------|
| `full` | `runFullCrawl` (crawler.ts:441) | 仅手动 | 全部帖子，单线程扫完 | 不限 |
| `light` | `runUpdateCrawl` mode=`light` (crawler.ts:801) | 定时，每分钟 | 最新 3 页（约 3000 帖） | 200 |
| `deep` | `runUpdateCrawl` mode=`deep` | 定时，每天 3:30 | 全部帖子 | 5000 |
| `members` | `runMemberCrawl` (crawler.ts:1323) | 定时，每 10 分钟 | 成员列表 | — |

模式常量：`LIGHT_MAX_PAGES = 3`（crawler.ts:810）、`LIGHT_COMMENTS_MAX = 200` / `DEEP_COMMENTS_MAX = 5000`（crawler.ts:811-812）。

### 增量爬取的四阶段

以 `light` / `deep` 为例（crawler.ts:801 起）：

**Phase 1 — 扫描列表，产出「需要拉评论的帖子集合」**

主循环翻页（crawler.ts:1026），配合游标 worker 并行（crawler.ts:994）。以下任一条件成立即结束扫描：

- 返回空页或 `nextCursor` 为空
- `light` 模式达到 `LIGHT_MAX_PAGES` 页（crawler.ts:1029）
- 翻页游标与并行 worker 已覆盖的集合重叠（crawler.ts:1049）

扫描过程中产生 `changedFeedIds`（crawler.ts:898）：新帖、状态复活、字段有变化的帖子。

**Phase 1 收尾 — 对账闸门（本项目最重要的机制）**

```ts
// crawler.ts:1076
const commentFeedIds = new Set<string>(changedFeedIds);
// 随后遍历，逐个比对：
const declared = feed.comment_count ?? 0;
const actual   = 库里该帖的活跃评论数 + 活跃回复数;
if (actual !== declared) commentFeedIds.add(feed.feed_id);   // crawler.ts:1123
```

**不变量：只要频道侧声明的评论数与库内实际数不一致，该帖就必须重新拉评论**，无论 `comment_count` 字段本身有没有变化。这是保证评论不丢的前提——仅凭「计数字段变化」判断，会漏掉计数字段已同步但评论实际缺失的帖子，那些帖子将永远不会再被补拉。

`stats.reconcileFeeds` 记录本轮因对账而被追加的帖子数（crawler.ts:1127）。

**Phase 2 — 拉评论与回复**

进入条件是 `commentFeedIds.size > 0`（crawler.ts:1143），**入口用 `commentFeedIds` 而不是 `changedFeedIds`**。单轮上限 `commentsBatchMax`，超出的部分留到下一轮（crawler.ts:1147-1149）。

成功拉回的完整数据登记进两个集合，供后续删除检测使用：
- `refetchedComments`：feed_id → 评论 ID 集合
- `refetchedReplies`（crawler.ts:905）：comment_id → 回复 ID 集合

拉取异常时对应帖子标记 `feedCommentsComplete = false`，**不登记、并跳过其删除检测**，防止把「没拉到」误判成「已删除」。

**Phase 2.5 — 补帖子详情**（正文、分享链接等）

**Phase 3 — 删除检测**（crawler.ts:1297，仅在 `oldestSeenTime !== null` 时执行）

`detectDeletions`（crawler.ts:1462）覆盖三张表：

| 对象 | 判定依据 |
|------|---------|
| 帖子 | 本轮扫描范围内未出现 → `status = 'deleted'` |
| 评论 | 属于本轮**完整拉回**的帖子，且不在 `refetchedComments` 中 |
| 回复 | 属于本轮**完整拉回**的评论，且不在 `refetchedReplies` 中（crawler.ts:1528） |

**不变量：删除检测只依据「事实 ID 差集」**——即本轮真的从接口拿回来的 ID 集合与库内记录的差集。任何基于计数推断（如「数量变少就删最旧的」）的做法都会误删真实数据，必须坚持 ID-diff。

删除只置 `status` + `deleted_at`，内容字段原样保留（这也是已删除评论仍能显示原文的原因）。

### stats 字段

写入 `CrawlTask.stats`（Json），前端爬取面板直接消费，**改字段名要同步前端**：

| 字段 | 出现于 | 含义 |
|------|-------|------|
| `feedsTotal` / `commentsTotal` / `detailsTotal` / `membersTotal` | full | 各类抓取总数 |
| `newFeeds` / `updatedFeeds` | 增量 | 新增 / 变化帖子数 |
| `commentsAdded` / `commentsProcessed` | 增量 | 新入库评论数 / 处理过的评论数 |
| `changedFeedIds` | 增量 | 变化帖子数 |
| `cursors` | 增量 | 翻页游标信息 |
| `reconcileFeeds` | 增量 | 因对账被追加的帖子数 |
| `deletions` | 增量 | 本轮检测到的删除数 |
| `rateLimits` / `errors` | 全部 | 限流次数 / 错误数 |
| `autoActions` | 增量 | 自动规则执行的处置数 |
| `mode` | 增量 | `light` / `deep` |
| `timing` / `wallTimeSec` | full | 各阶段耗时 / 总耗时 |

### 取消机制

`CrawlCancelledError`（crawler.ts:27）+ 协作取消点 `checkAbort`（crawler.ts:38）。调度器持有 `AbortController`，取消时抛错上抛，任务标记为 `cancelled` 而非 `failed`。

## 任务调度与锁

### 调度器初始化

`initScheduler()`（scheduler.ts:262）先做两件事，再注册定时任务：

1. 僵尸任务回收：`running` → `interrupted`；超过 6 小时的 `pending` → `interrupted`（scheduler.ts:267-281）
2. `destroyScheduler()` 清掉旧任务，避免重复注册

**cron 配置优先级**：环境变量 > `.crawl_config.json` > 代码默认值（scheduler.ts:70-72）。配置文件探测会依次尝试当前工作目录及其上两级（scheduler.ts:29），因为 standalone 构建的运行目录与仓库根不一致。

### 定时任务

| 任务 | cron | 默认值 |
|------|------|--------|
| update（light） | `CRAWL_CRON` / 配置 `update` / `DEFAULT_CRON` | `* * * * *`（每分钟，scheduler.ts:16） |
| update（deep） | `CRAWL_DEEP_CRON` / 配置 `update_deep` / `DEFAULT_DEEP_CRON` | `30 3 * * *`（scheduler.ts:22） |
| members | `MEMBER_CRON` / 配置 `member` / `MEMBER_CRON` | `*/10 * * * *`（scheduler.ts:19） |
| 身份健康检查 | 硬编码 | `*/30 * * * *`（scheduler.ts:335） |

> `full` 全量爬取**从不被 cron 调度**，只能从爬取管理页手动触发。

### 任务锁矩阵

`triggerCrawl`（scheduler.ts:97）以数据库为锁载体，冲突判定在 `conflictWhere`（scheduler.ts:114-133）：

| 新任务 | 被什么阻塞 | 不阻塞它的 |
|--------|-----------|-----------|
| `full` | 任何 `pending` / `running` 任务（含自身） | — |
| 任意任务 | 已有 `full` 在跑 | — |
| `deep` | `full`、`deep` | `light`、`members` |
| `light` | `full`、`light` | `deep`、`members` |
| `members` | `full` | `light`、`deep` |

设计要点：

- **`deep` 只与 `full` / `deep` 互斥**。若把 light / members 也算作冲突，每分钟执行的 light 会在 3:30 同一分钟抢走锁，导致 deep 永远排不上（饥饿）。
- **`light` 与自身互斥**。否则对账补拉这类耗时较长的轮次会与下一分钟的轮次叠加，任务越堆越多。
- 历史数据里 `mode` 为 `NULL` 的任务一律视为**非 deep**（scheduler.ts:112），保证 3:30 的 deep 不被早期记录阻塞。

### 任务状态流转

`scheduler.ts:145` 先 `create`（`status = 'pending'`，记录 `mode`），再用 `updateMany` **原子领取** 转为 `running`（scheduler.ts:158）；领取失败的一方标记为 `cancelled`，避免同一任务被跑两遍。

终态守卫在 `updateTaskStatus`（crawler.ts:107）：已是 `completed` / `cancelled` / `failed` / `interrupted` 的任务不会被后续写入覆盖。

## CLI 集成层

这是项目与外部世界唯一的通道，也是最需要小心的地方。

### 凭据存储

| 位置 | 内容 |
|------|------|
| 数据库 `admin_identities.token` | **密文**（aes-256-gcm，密钥来自 `ENCRYPT_KEY`） |
| 文件系统 `<CLI_CREDENTIALS_DIR|~/.qqcli>/credentials/{id}/credentials.env` | **明文工作副本**，内容为 `QQ_AI_CONNECT_TOKEN="..."`，写入时 `chmod 0600`（Windows 上该步骤会被忽略） |
| CLI 默认凭据 `~/.qqcli/.env` | CLI 自身的当前登录态 |

切换身份（`credentials.ts`）：从库里读出密文 → `decrypt` → 写入该身份自己的 `credentials.env`；调用 CLI 时通过环境变量 `QQ_AI_CONNECT_DOTENV` 指向该文件，从而在**单个子进程内**切换身份，互不干扰。

`saveCurrentTokenToIdentity`（credentials.ts:116-157）负责把 CLI 当前的 token 加密回写数据库（CLI 扫码登录后的落库路径）。

**注意：数据库密文与磁盘明文是两份数据，可能不一致。** 身份异常时先确认两处是否指向同一个 token。

### 执行器（executor.ts）

| 项 | 值 |
|----|----|
| 调用方式 | `execFile`（promisify，异步，非 shell） |
| 超时 | `CLI_TIMEOUT_MS`，默认 `600_000`（10 分钟），`maxBuffer` 100 MB |
| 最大重试 | `MAX_RETRIES = 5`（executor.ts:11） |
| 单请求最多切身份 | `MAX_IDENTITY_SWITCHES = 3`（executor.ts:14） |
| 请求间隔 | `CLI_REQUEST_DELAY_MS`，默认 0（executor.ts:25） |
| 身份池缓存 | 60 秒（executor.ts:45） |

**错误码与处理**（`CliErrorCode`，executor.ts:225 附近）：

| 码 | 含义 | 处理 |
|----|------|------|
| `153` | 限流 | 切身份 + 该身份指数退避（`30s × 2^(n-1)`，封顶 300s）+ 全局 153 冷却 |
| `151` | 登录态校验 | 3 秒后重试 |
| `8011` | token 失效/未登录 | `markIdentityAuthFailed` 永久标记失效（防止复活），并切身份；无可用身份则抛错 |
| `10014` | 数据已删除 | 返回 `null`，静默跳过 |
| `-2` | 超时 | **立即抛错，不重试**（否则 5 × 600s 会把任务拖死） |
| `-1` | ENOENT / 其它 | 3 秒后重试 |

**限流与身份轮转**：按 `domain.action` 维度独立计时（`_lastCallTimes`，executor.ts:26），并行阶段之间互不阻塞；`autoSelectIdentity` 按 delayKey 做 round-robin（executor.ts:149）。

**写操作不静默切身份**：调用方显式传入 `adminIdentityId` 时（如违规处置），执行器不会自动换身份，避免「用错号执行了处置」；只有读取类任务才允许自动轮转。

> ⚠️ 身份冷却状态、`authFailed` 标记、身份池缓存**全部是进程内存态**。多进程/多实例部署时这些状态不共享，限流与失效标记会失效。当前是单进程 standalone 部署，一旦改成多实例必须把这份状态外置。

### 命令封装

统一入口 `executeCli(domain, action, body, adminIdentityId)`。

- `feed.ts`：`get-guild-feeds`、`get-feed-comments`、`get-feed-detail`、`get-next-page-replies`、`move-feed`、`del-feed`、`do-comment`、`do-reply`
- `member.ts`：`guild-member-search`、`get-user-info`、`modify-member-shut-up`、`kick-guild-member`、`push-group-dm-msg`

**接口返回结构不稳定，封装层做了多种兼容**（接手时别当成冗余代码删掉）：

- 主体取 `data.feed || data`（feed.ts）、`data.members || data.results`（member.ts）
- 游标字段可能是 `feed_attach_info` / `attach_info` / `next_pos`
- `has_more ?? (nextPos !== "")`
- `getFeedDetail` 的字段映射用 `?? undefined`，**避免用空字符串覆盖数据库里已有的正文**
- 13 位时间戳按毫秒解析、10 位按秒解析，无时区信息时补 `+08:00`（crawler.ts:51-63）

**其它已知的接口怪癖**（都在 crawler.ts 注释里）：

- 列表接口不返回 `channel_id`，用 `channel_name` 回退（crawler.ts:547）
- 成员接口的键是中文（`昵称` / `加入时间`），已做兼容（crawler.ts:384）
- PostgreSQL 拒绝 `0x00` 空字节，入库前递归清理（crawler.ts:154）
- 图片数组比较做了 jsonb 规范化，避免键序/数组序差异被误判为「内容变化」（crawler.ts:172）

## 鉴权与加密

### 登录态

| 项 | 实现 |
|----|------|
| 签名 | `jose` 的 `SignJWT` / `jwtVerify`，HS256，密钥 `JWT_SECRET`（缺失即抛错，无默认值） |
| Access Token | 有效期 **15 分钟**，cookie `gp_access` |
| Refresh Token | **不透明随机串**（48 字节 base64url），数据库只存 SHA-256 哈希，有效期 **7 天**，cookie `gp_refresh` |
| Cookie 属性 | `HttpOnly` + `SameSite=strict`，生产环境加 `Secure` |
| 刷新 | 轮换式：旧 token 撤销 + 签发新 token，防止重放 |

**登录会撤销该用户的全部 refresh token**，即同一账号同时只有一个活跃会话（多端登录会互相踢下线）。

### 用户状态机

`PlatformUser.role`：`admin` | `operator`（默认）
`PlatformUser.status`：`active` | `pending` | `disabled`

流程：`POST /api/auth/register` 创建 `{ role: "operator", status: "pending" }` → 管理员在 `/api/auth/register/pending` 查看待审列表 → `approve` 置为 `active` 并自动创建一个同名 `AdminIdentity`；或 `reject` 直接删除该用户。

**权限判定没有统一助手**，各路由内联判断 `auth.role !== "admin"` 后返回 403。新增管理端接口时需自行加上这段检查。`/api/auth/session` 对 admin 跳过管理员身份校验，对 operator 则要求其存在同名的 `AdminIdentity`。

密码使用 bcrypt，cost 12（auth.ts:29-38）。

### 字段加密

`crypto.ts`：`aes-256-gcm`，IV 12 字节，认证标签 16 字节，密文格式 `iv:tag:ciphertext`（全 hex）。密钥派生方式为 `sha256(ENCRYPT_KEY)`——**不是直接取 ENCRYPT_KEY 的字节**，换密钥时两侧必须一致。

`decrypt` 同时接受 3 段（GCM）与 2 段（历史 CBC）格式，后者是早期版本遗留的兼容路径；`encrypt` 只产出 GCM。

目前**只有 `admin_identities.token` 一个字段加密存储**。`operation_logs.snapshot` 是明文 Json。

**轮换 `ENCRYPT_KEY` 必须重加密存量 token**，否则所有管理员身份立即失效。做法：用旧密钥逐条 `decrypt`、用新密钥 `encrypt`、回写数据库（`scripts/` 下有参考实现思路，执行前务必备份）。

## 实时进度（SSE）

爬取管理页通过 `/api/crawl/stream` 订阅任务事件，事件总线的实现在 `src/lib/events.ts`。

**不要提高推送频率**：浏览器对同一域名的 SSE 连接数有限制，每秒超过 1 条会触发 `ERR_INSUFFICIENT_RESOURCES`（crawler.ts:18 注释）。

## 前端结构

- 布局：`app/(dashboard)/layout.tsx` + `DashboardShell.tsx`（侧边栏导航 + 顶栏），页面只关心内容区。
- 数据获取：`lib/api-client.ts` 的封装自动解包 `{ success, data }`，遇到含 `page` / `total` 的分页结构会保留分页壳。
- UI 组件：`components/ui/` 是 Base UI 之上的薄封装，统一了项目配色与尺寸，新增交互优先复用。
- 图表：Recharts；配色遵循中文财经惯例（涨用红、跌用绿）。

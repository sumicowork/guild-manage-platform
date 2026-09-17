# 数据模型

PostgreSQL 18.2，14 张表，全部在 `prisma/schema.prisma` 中定义。下面按业务域分组说明字段语义与使用约定。

## 通用约定

### 两套 ID

每张业务表都有两个标识：

| 字段 | 类型 | 来源 | 用途 |
|------|------|------|------|
| `id` | `BigInt` 自增 | 本系统 | 内部主键、外键关联 |
| 业务 ID（`feed_id` / `comment_id` / `reply_id` / `tinyid`） | `String` | 腾讯频道接口 | 唯一索引、跨系统对账、爬取去重 |

跨表关联**混用两种**：`Comment.feed_id → Feed.feed_id`（业务 ID），而 `MemberTag.member_id → Member.id`（内部 ID）。改关联时先确认当前用的是哪一种。

### BigInt 的序列化

Prisma 的 `BigInt` 无法被 `JSON.stringify` 直接处理。所有 API 路由返回前都经过 `serializeBigInt`，把 BigInt **递归转成字符串**（`api-utils.ts`），随后 `toCamelCase` 将 snake_case 字段名转为 camelCase 给前端。

因此前端拿到的 `id` 是字符串而不是数字，比较时不要用 `===` 跟数字比。

### 软删除

`feeds` / `comments` / `replies` / `members` 都有 `status` + 删除时间字段，**从不物理删除**：

| 模型 | 状态字段 | 删除时间字段 |
|------|---------|-------------|
| `Feed` / `Comment` / `Reply` | `status`（`active` / `deleted`） | `deleted_at` |
| `Member` | `status`（`active` / `left`） | `left_at` |

删除时**只改状态，内容字段原样保留**，历史原文因此仍可读。

### 无数据库级枚举约束

`status`、`role`、`action`、`target_type` 等全部是 `String`，取值由应用层约定，数据库不校验。新增取值时需同时改代码与前端映射表，没有 schema 层面的约束兜底。

### 时间字段

- `created_at` / `updated_at`：本系统写入时间。
- `create_time`：业务时间（帖子/评论的发布时间），**`timestamp without time zone` 且存的是 UTC**。按北京时间的「日」做分桶统计时必须加 8 小时，否则零点附近的记录会落到前一天。
- `create_time_raw`：接口返回的原始毫秒时间戳（`BigInt`），用于需要精确对齐接口值的场合。

---

## 内容域

### Feed（帖子）

表名 `feeds`。索引覆盖 `author_id`、`channel_name`、`status`、`create_time`、`create_time_raw`。

| 字段 | 说明 |
|------|------|
| `feed_id` | 唯一业务 ID |
| `author` / `author_id` | 作者昵称 / 作者 tinyid |
| `channel_name` / `channel_id` | 所属版块名 / ID。**列表接口不返回 `channel_id`**，多数记录该字段为空，按版块统计应使用 `channel_name` |
| `content` | 正文（`String`，注意这里是文本而非 Json） |
| `content_snippet` | 正文摘要，列表页用 |
| `images` | `Json`，图片 URL 数组 |
| `prefer_count` / `comment_count` | 点赞数 / 评论数声明值 |
| `feed_type` | 帖子类型（接口原值） |
| `status` | `active` / `deleted` |
| `share_url` | 分享链接 |

**`comment_count` 的语义要特别注意**：它是**顶层评论数 + 回复数**之和，而不是顶层评论数。评论对账闸门正是用它与「库内活跃评论数 + 活跃回复数」比对。

### Comment（评论）

表名 `comments`。挂在一个 `Feed` 下。

| 字段 | 说明 |
|------|------|
| `comment_id` | 唯一业务 ID |
| `feed_id` | 所属帖子（业务 ID 关联） |
| `content` | **`Json`**，接口原始结构，形如 `{ text, images, sticker, at_users }` |
| `content_text` | 从 `content` 抽出的纯文本，**前端展示用的是这个字段** |
| `content_text` 缺失时 | 前端会渲染空内容；不要退回用占位文案覆盖 |
| `like_count` / `reply_count` | 点赞数 / 回复数 |
| `comment_index` | 在帖子内的序号 |
| `status` | `active` / `deleted` |

> API 层把 `content_text` 映射成了响应里的 `content` 字段（`api/feeds/[id]/route.ts`）。所以在组件里写 `comment.content` 拿到的是**纯文本**，不是 Json 对象；要读图片得用响应里的 `contentImages`。

### Reply（回复）

表名 `replies`。同时关联 `Feed` 与 `Comment`。

| 字段 | 说明 |
|------|------|
| `reply_id` | 唯一业务 ID |
| `comment_id` / `feed_id` | 所属评论 / 所属帖子 |
| `content` / `content_text` | 与 `Comment` 同构：Json 原文 + 纯文本 |
| `target_reply_id` / `target_user` / `target_user_id` | 被回复的那条回复及其作者。层中层的「回复的回复」在这里表达，仍然归属同一个顶层 `Comment` |

索引覆盖 `comment_id`、`feed_id`、`author_id`、`status`。

---

## 成员域

### Member（成员）

表名 `members`，以 `tinyid` 为唯一键。

| 字段 | 说明 |
|------|------|
| `tinyid` | 唯一业务 ID（频道内用户标识） |
| `nickname` / `global_nickname` | 频道昵称 / 全局昵称 |
| `avatar_seq` | 头像序号 |
| `role` | 频道角色（接口原值，如频道主 / 管理员 / 成员） |
| `country` / `city` / `gender` | 资料字段，接口未提供时为空 |
| `join_time` / `join_time_human` | 加入时间（`DateTime`）/ 接口原始文本 |
| `status` | `active` / `left` |
| `left_at` | 退出的时间 |

### MemberTag（成员标签）

表名 `member_tags`。`member_id` 指向 `Member.id`（内部 BigInt，非 tinyid）；`(member_id, tag)` 唯一；`created_by` 记录打标签的平台用户。

---

## 违规域

### Violation（违规记录）

表名 `violations`。一条记录对应一次处置动作，是审计的核心表。

| 字段组 | 字段 | 说明 |
|--------|------|------|
| 目标 | `target_type` | `feed` / `comment` / `reply` |
| | `target_id` | 目标业务 ID（冗余字段，便于统一查询） |
| | `target_feed_id` / `target_comment_id` / `target_reply_id` | 分别外键到三张表，仅对应类型有值 |
| | `target_author` / `target_author_id` | 被处置者昵称 / tinyid，`target_author_id` 外键到 `Member.tinyid` |
| 事由 | `violation_reason` | 违规原因（对应 `violation_reasons.name` 的取值） |
| | `violation_detail` | 补充说明 |
| 动作 | `action_type` | `delete` / `move` 等 |
| | `action_detail` | `Json`，动作参数（如移帖的目标版块） |
| 通知 | `notification_sent` / `notification_type` / `notification_text` | 是否已推送通知及通知内容 |
| 操作者 | `operator_user_id` | 外键到 `PlatformUser.id` |
| | `operator_admin_id` / `operator_admin_name` | 实际执行的频道管理员身份（CLI 身份） |

索引覆盖 `target_type`、`violation_reason`、`created_at`、`operator_user_id`、`target_author_id` 以及三个 `target_*_id`。

### ViolationReason（违规原因配置）

表名 `violation_reasons`。`name` 唯一，`is_builtin` 区分内置与自建（内置项应限制删除），`notification_template` 存通知文案模板，`sort_order` 控制展示顺序。

新增原因时注意：`Violation.violation_reason` 存的是**名称字符串而非外键**，改名会让历史记录与新配置脱钩。

---

## 系统域

### PlatformUser（平台用户）

表名 `platform_users`。登录后台的人。

| 字段 | 说明 |
|------|------|
| `username` | 唯一登录名 |
| `password` | bcrypt 哈希（cost 12） |
| `display_name` | 展示名 |
| `role` | `admin` / `operator`（默认 `operator`） |
| `status` | `active` / `pending` / `disabled` |

`admin` 拥有配置管理与审批权限；`operator` 只能使用内容与成员模块。

### RefreshToken（续期令牌）

表名 `refresh_tokens`。

| 字段 | 说明 |
|------|------|
| `token_hash` | 唯一，**只存 SHA-256 哈希**，数据库泄露也无法复用 |
| `user_id` | 外键到 `PlatformUser`，`onDelete: Cascade` |
| `expires_at` | 过期时间（7 天） |
| `revoked_at` | 非空即已撤销（登出，或被轮换后的新 token 替换） |

登录会撤销该用户的全部 token（单会话），刷新走轮换（旧撤销 + 新签发）。

### AdminIdentity（频道管理员身份）

表名 `admin_identities`。执行腾讯频道操作的账号身份。

| 字段 | 说明 |
|------|------|
| `nickname` | 管理员昵称（轮转日志里显示的就是它） |
| `token` | **密文**，aes-256-gcm，密钥由 `ENCRYPT_KEY` 经 sha256 派生 |
| `token_expires` | 过期时间（接口未提供时为空） |

一个身份同时只能被一个进程使用其凭据文件；执行器通过 round-robin 在多个身份间轮换以规避限流。身份失效（CLI 错误码 8011）会被进程内标记为永久失效。

### CrawlTask（爬取任务）

表名 `crawl_tasks`。

| 字段 | 说明 |
|------|------|
| `task_type` | `update` / `members` / `full` |
| `status` | `pending` / `running` / `completed` / `cancelled` / `failed` / `interrupted` |
| `triggered_by` | `cron` / `manual` |
| `triggered_by_user` | 手动触发时的平台用户 ID |
| `started_at` / `finished_at` | 起止时间 |
| `stats` | `Json`，各阶段统计，前端爬取面板直接消费 |
| `error_log` | 错误摘要 |
| `mode` | `light` / `deep`；`full` 与 `members` 任务为 null |

**任务锁就建立在这张表上**：`status in ('pending','running')` 的记录参与冲突判定，判定矩阵见 [ARCHITECTURE.md](ARCHITECTURE.md#任务锁矩阵)。

> 这张表**没有清理机制**，截至 2026-09-17 已有 90,795 行。它是一个持续增长的纯追加表，做长期维护时需要引入归档或定期清理策略。

### AutoRule（自动处置规则）

表名 `auto_rules`。按作者维度自动执行处置。

| 字段 | 说明 |
|------|------|
| `name` | 规则名称 |
| `target_author_id` | 目标作者 tinyid |
| `action` | `delete` / `move` |
| `target_channel_id` | 移帖目标版块 ID，`action = "move"` 时必填 |
| `enabled` | 是否启用 |

规则命中后由爬取流程执行处置，命中次数计入 `stats.autoActions`。

### OperationLog（操作日志）

表名 `operation_logs`。审计追踪用，只增不改。

| 字段 | 说明 |
|------|------|
| `action` | 动作标识，如 `violation.delete` |
| `target_type` / `target_id` | 被操作对象 |
| `snapshot` | `Json`，操作前对象快照，用于回溯。**明文存储，不含加密** |
| `operator_id` / `operator_name` | 操作者（ID 为外键，名称冗余存储便于查询） |
| `detail` | 附加说明 |

### AppConfig（键值配置）

表名 `app_config`。`key` 为主键，`value` 为字符串。存放需要在运行时修改的系统级配置（如通知模板）。

---

## schema 变更流程

**项目没有 `prisma/migrations/` 目录**，数据库没有迁移历史。改 schema 时必须：

1. 先核对线上表结构的真实状态（不要假设它与 `schema.prisma` 一致——历史上出现过手工 `ALTER TABLE` 添加字段的情况，例如 `crawl_tasks.mode`）。
2. 修改 `schema.prisma`。
3. 选择落地方式：开发环境用 `npx prisma db push`；生产环境优先手写幂等的 `ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...`，避免 `db push` 在数据表上做不可预期的重建。
4. 运行 `npx prisma generate` 更新 Client（`src/generated/prisma` 不入库，不生成就没有类型）。
5. 跑 `npm run check` 确认类型。

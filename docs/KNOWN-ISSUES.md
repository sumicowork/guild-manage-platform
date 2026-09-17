# 已知问题与技术债

按处理优先级排列。每条给出定位、影响范围与建议方向，接手时可直接当待办列表用。

## P1 — 影响正确性或资源，建议优先处理

### 1. 统计接口每请求新建连接池且不释放

**位置**：`src/app/api/statistics/route.ts:9`

```ts
export async function GET(req: NextRequest) {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
```

每次请求都创建一个新的 `pg` 连接池，函数结束时没有调用 `pool.end()`，池随请求累积。仪表盘刷新、统计页轮询都会持续泄漏连接，长期运行会耗尽 PostgreSQL 的连接数上限。

**方向**：把池提到模块级单例（或在 `finally` 中关闭）；同一文件内的三条原生 SQL 查询共用这一个池。

### 2. 管理员身份的限流与失效状态只存在于进程内存

**位置**：`src/lib/cli/executor.ts:26`（`_lastCallTimes`）、`authFailed` 标记、`_identityPoolCache`（executor.ts:45 及附近）

身份冷却计时、CLI 错误码 8011 导致的「永久失效」标记、身份池缓存全部是进程内状态。

**影响**：当前是单进程 standalone 部署，行为正常。一旦改成多实例/多 worker，各进程的限流计数与失效标记互不可见，会出现「已被判失效的身份被另一个进程继续使用」以及限流形同虚设。

**方向**：改多实例前先把这份状态外置（Redis / 数据库表），或明确约束部署形态为单进程。

### 3. `crawl_tasks` 持续增长且无清理机制

**现状**：截至 2026-09-17 已有 90,795 行。light 任务每分钟一次，即每天新增约 1,440 行。

**影响**：任务锁建立在 `status in ('pending','running')` 的查询上，表的持续膨胀会逐步拖慢锁判定与爬取管理页的列表查询。

**方向**：增加归档策略（例如保留近 N 天明细，历史只留统计聚合），或定期把终态任务迁移到归档表。改造时注意别破坏任务锁所依赖的状态查询。

### 4. 数据库没有迁移历史

`prisma/migrations/` 不存在，schema 变更靠 `prisma db push` 或手写 `ALTER TABLE` 落地，且历史上出现过手工加列（如 `crawl_tasks.mode`）。

**影响**：`schema.prisma` 与线上真实表结构可能不一致，改 schema 时没有安全网。

**方向**：以线上实际结构为准，用 `prisma migrate diff` 生成基线迁移后纳入版本控制；在那之前，每次改 schema 都要先核对线上结构（见 [DATA-MODEL.md](DATA-MODEL.md#schema-变更流程)）。

### 5. 会话是单点的，且 access token 无法即时撤销

- 登录会撤销该用户的全部 refresh token（`login/route.ts`），同一账号无法多端同时在线，新登录会把旧会话踢下线。若产品需要多端并存，需要改这里。
- access token 有效期 15 分钟且无吊销列表，登出后旧 access token 在剩余有效期内仍可用。当前风险有限（时长很短），但涉及安全敏感操作时需知晓。

### 6. `Violation.violation_reason` 存的是名称而非外键

违规记录里存的是原因**名称字符串**，而配置表 `violation_reasons` 的 `name` 是唯一键。重命名或删除某个违规原因后，历史记录会与新配置脱钩（统计、筛选都会对不上）。

**方向**：若要支持改名，改成存 `id` 并保留名称冗余字段；或明确约束「违规原因不可重命名」。

## P2 — 结构性技术债

### 7. `Member` 的关联方式不统一

- `MemberTag.member_id` → `Member.id`（内部 BigInt）
- `Violation.target_author_id` → `Member.tinyid`（业务字符串）

同一张表被两种键关联，写查询时极易用错。改关联前先确认当前用的是哪一种。

### 8. 同名字段 `content` 的类型不一致

- `Feed.content` 是 `String`（正文文本）
- `Comment.content` / `Reply.content` 是 `Json`（`{ text, images, sticker, at_users }`）

而 API 层又把 `content_text` 映射成了响应里的 `content`。三个层面的 `content` 含义都不同，是本项目最容易写错的地方。详见 [DATA-MODEL.md](DATA-MODEL.md#内容域)。

### 9. 完全没有自动化测试

`package.json` 没有 `test` 脚本，`src/` 下没有任何 `*.test.*` / `*.spec.*`。同时 `next.config.ts` 设了 `typescript.ignoreBuildErrors = true`，构建流程也不做类型检查。

**现状下的质量保障完全依赖 `npm run check` 与人工验证。** 爬取引擎（`crawler.ts`，1783 行）是最需要测试覆盖的部分，尤其是删除检测与对账闸门这两个直接关系到数据完整性的逻辑——它们目前无法离线验证，只能靠线上数据观察。

**方向**：优先为 `detectDeletions` 的 ID-diff 判定与对账闸门写单元测试（可 mock Prisma 与 CLI 层）。

### 10. `full` 全量爬取是单线程的

`runFullCrawl`（`crawler.ts:441`）的 Phase 1 单线程翻页，数据量增大后耗时线性增长。增量路径已经改成多 worker 并行，全量路径仍在用旧结构。

### 11. 调度器内存态的 `runningTasks` 与真实锁不一致

`scheduler.ts:75` 的 `runningTasks` 按 `task_type` 索引，而 `light` 与 `deep` 共用同一个 `update` 类型，两者会互相覆盖显示。真实的互斥由数据库承担，这个内存态仅用于状态展示，不要拿它做逻辑判断。

### 12. 存量数据质量问题

早期爬取迭代留下了字段缺失的历史包袱：

- `feeds.content` 有相当比例的 NULL（依赖 `scripts/fix_details.cjs` 这类脚本回填）
- 早期记录可能缺少 `channel_id`、`content_snippet` 等字段
- `comment_count` 与实际评论数的偏差是常态（这正是对账闸门存在的原因）

**基于历史数据做统计时，要交代数据来源与覆盖范围，不要把统计口径当作业务真值。**

## 易踩的坑（速查）

改代码前值得再扫一眼的几条，详细说明见 [DEVELOPMENT.md](DEVELOPMENT.md)：

| 坑 | 要点 |
|----|------|
| Base UI 的 `SelectValue` | 会渲染原始 value（英文标识），必须自己按 value 查表渲染中文标签 |
| Prisma raw SQL | `$queryRaw` 与 `@prisma/adapter-pg` 不兼容，需要原生 SQL 时直连 `pg` 的 `Pool` |
| 聚合排序 | 同层 `ORDER BY` 不能引用聚合别名，要包一层子查询 |
| BigInt 序列化 | 前端拿到的 `id` 是字符串，不要与数字比较 |
| 时间分桶 | `create_time` 存 UTC，按北京时间分「日」要加 8 小时；不要依赖驱动层日期格式化 |
| `comment_count` | 语义是「顶层评论 + 回复」，不是顶层评论数 |
| SSE 推送频率 | 每秒超过 1 条会触发浏览器 `ERR_INSUFFICIENT_RESOURCES` |
| 删除检测 | 只依据事实 ID 差集；拉取异常的帖子必须跳过检测 |
| 评论补拉入口 | 用 `commentFeedIds`（变化帖 + 对账不一致帖），不要退回只用 `changedFeedIds` |
| 任务锁 | `deep` 只与 `full`/`deep` 互斥，`light` 与自身互斥——这两条都是为了避免饥饿与堆积，不要改成「任意任务互斥」 |
| 凭据 | 项目从环境变量读取密钥，源码与提交里不得出现明文凭据 |

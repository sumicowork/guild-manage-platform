# 开发规范

## 改代码的标准流程

```bash
npm run check          # 1. tsc --noEmit，唯一的类型门禁
npm run lint           # 2. ESLint
npm run dev            # 3. 本地验证
```

**`npm run check` 不能省。** `next.config.ts` 设了 `typescript.ignoreBuildErrors = true`（构建机内存有限，跑不起类型检查），所以类型错误不会阻断构建，只有这一步能拦住。

提交信息沿用 Conventional Commits：

```
feat(feeds): 已删除评论/回复改为显示原文，仅用「已删除」标签标注
fix(scheduler): light 任务自身互斥，避免对账补拉时的堆积并发
security: 恢复 ecosystem.config.js 与 fix_details.cjs（脱敏版，凭据一律走环境变量）
chore: ...
```

scope 用模块名（`feeds` / `comments` / `members` / `violations` / `crawl` / `scheduler` / `statistics` / `settings`）。

## API 约定

### 响应结构

```jsonc
// 成功
{ "success": true, "data": <任意>, "page": 1, "pageSize": 20, "total": 132, "totalPages": 7 }
// 失败
{ "error": "帖子不存在" }
```

由 `api-utils.ts` 的 `success()` / `error()` 统一产出。前端 `lib/api-client.ts` 会自动解包 `data`，但保留含 `page` / `total` 的分页壳。

### 路由的统一形状

```ts
export const dynamic = "force-dynamic";   // 所有数据路由都需要，否则会被静态化

export async function GET(req: NextRequest) {
  const auth = await getAuthUser(req);
  if (!auth) return unauthorized();

  // 管理端接口需自行内联判断，没有统一助手：
  if (auth.role !== "admin") return forbidden();

  const { searchParams } = new URL(req.url);
  const page = parsePage(searchParams);
  const pageSize = parsePageSize(searchParams);   // 上限 100

  const where = { /* 组装过滤条件 */ };
  const [rows, total] = await Promise.all([
    prisma.xxx.findMany({ where, orderBy, skip, take }),
    prisma.xxx.count({ where }),
  ]);

  const mapped = toCamelCase(serializeBigInt(rows));
  return success(mapped, { page, pageSize, total, totalPages: Math.ceil(total / pageSize) });
}
```

**处理顺序固定**：`serializeBigInt` → `toCamelCase`（先转 BigInt 为字符串，再改字段名）。

### 通用查询参数

| 参数 | 说明 |
|------|------|
| `page` / `pageSize` | 分页，默认 1 / 20，`pageSize` 上限 100 |
| `search` | 模糊搜索（帖子搜 `content_snippet`，评论搜 `content_text`） |
| `sort` / `direction` | 排序字段与方向 |
| `dateFrom` / `dateTo` | 时间范围 |
| `status` / `channel` / `author` | 业务筛选，按路由而定 |

## 前端规范

### Base UI 的 Select 不能用 `SelectValue`

项目用的是 `@base-ui/react`，不是 Radix。`<SelectValue />` 会把**原始 value 字符串**直接渲染出来（用户看到的是 `delete` 这样的英文标识），而不是选项的中文文本。项目惯例是在 `SelectTrigger` 内自己按 value 查表渲染标签：

```tsx
// 正确
<SelectItem value="delete">删除帖子</SelectItem>
...
<SelectTrigger>
  <span className="text-sm">{{ delete: '删除帖子', move: '移帖' }[value]}</span>
</SelectTrigger>
```

### 选项必须给人类可读名称

表单里**不出现裸 ID**：

- 版块选择用下拉（数据来自 `/api/channels`），不要让使用者手填版块 ID。
- 作者展示为「昵称 + 小字 tinyid」。
- 动作、状态一律中文标签，用 value→label 的映射表。

### 评论文案的层级口径

`Comment` 与 `Reply` 只在 CLI 层和数据库层区分。**前端统一称「评论」**，不出现「回复」二字，避免使用者被层级术语绕晕。改文案时保持这个口径。

### 其它

- 复用 `components/ui/` 的基础组件，新增交互优先在既有组件上扩展。
- 表格统一走 `DataTable.tsx`（分页、排序、筛选已封装）。
- 图表用 Recharts，配色遵循中文财经惯例：**涨用红、跌用绿**。
- 金额/统计单位用 `¥`。

## 数据库访问的两个约束

### Prisma 的 raw SQL 不可用，需要原生 SQL 时直连 `pg`

项目通过 `@prisma/adapter-pg` 接入 PostgreSQL，Prisma 自带的 `$queryRaw` / `$queryRawUnsafe` 与该适配器不兼容，会报 `column does not exist` 这类误导性错误。两条路：

1. **优先**：用纯 Prisma API 表达（`findMany` / `groupBy` / `count`），必要时在 JS 侧做内存分组。
2. **确实需要原生 SQL 时**（如带 `FILTER` 的多维聚合）：直接 `import { Pool } from "pg"`，用连接串建池后 `pool.query()`。参考实现见 `src/app/api/statistics/route.ts`。

### 聚合别名不能出现在同层 `ORDER BY`

PostgreSQL 不允许在同一层的 `ORDER BY` 里引用 `SELECT` 中定义的聚合别名（报 `42703`）。**把聚合包进子查询，在外层排序**：

```sql
SELECT author_id, posts, comments FROM (
  SELECT author_id,
    COUNT(*) FILTER (WHERE source = 'feed')::int    AS posts,
    COUNT(*) FILTER (WHERE source = 'comment')::int AS comments
  FROM (
    SELECT author_id, 'feed'    AS source FROM feeds    WHERE create_time >= $1 AND author_id <> ''
    UNION ALL
    SELECT author_id, 'comment' AS source FROM comments WHERE create_time >= $1 AND author_id <> ''
  ) u
  GROUP BY author_id
) g
ORDER BY posts + comments DESC
LIMIT 10
```

统计页的 Top 发帖评论榜用的就是这个形状。

### 时间分桶要绕开驱动层的时区转换

`pg` 驱动把 `timestamp without time zone` 按 UTC 解读，而库里的 `create_time` 存的就是 UTC 值。做「按天」聚合时不要在 SQL 里依赖日期格式化，而是先在应用层把日期算成 `YYYY-MM-DD` 字符串再作为参数传入（`statistics/route.ts` 里的 `fmt` 助手就是这个用途）。

### 连接池

`statistics/route.ts` 目前是**每个请求 `new Pool()`**，且没有在结束时 `pool.end()`。新增原生 SQL 查询时不要照抄这个写法——复用同一个池，或至少在 `finally` 里关闭。

## 环境变量

| 变量 | 必填 | 默认 | 说明 |
|------|------|------|------|
| `DATABASE_URL` | ✅ | — | PostgreSQL 连接串，`?schema=public` |
| `JWT_SECRET` | ✅ | — | JWT 签名密钥，`openssl rand -hex 32` |
| `ENCRYPT_KEY` | ✅ | — | 管理员 token 加密密钥，经 sha256 派生为 AES-256 密钥 |
| `GUILD_ID` | 建议 | — | 目标频道 ID |
| `CLI_PATH` | 建议 | `tencent-channel-cli` | CLI 可执行文件 |
| `CLI_CREDENTIALS_DIR` | — | `~/.qqcli` | 凭据文件根目录，按身份分子目录 |
| `CLI_REQUEST_DELAY_MS` | — | `0` | 同类请求最小间隔；多身份轮转时可适当调低 |
| `CLI_TIMEOUT_MS` | — | `600000` | 单次 CLI 调用超时（10 分钟） |
| `CRAWL_CRON` | — | `* * * * *` | light 增量爬取周期 |
| `CRAWL_DEEP_CRON` | — | `30 3 * * *` | deep 全量爬取周期 |
| `MEMBER_CRON` | — | `*/10 * * * *` | 成员同步周期 |
| `NODE_ENV` | — | — | 生产环境下 cookie 加 `Secure` |

> `JWT_SECRET` 与 `ENCRYPT_KEY` 缺失时应用会**直接抛错拒绝启动**（`auth.ts` / `crypto.ts` 里 fail-fast），不会退化成默认值。这是有意设计，不要在本地调试时为了图省事加默认值。
>
> 两个密钥的取值**不要写进任何入库的文件**。仓库里出现过把凭据写进 `ecosystem.config.js` 与 `scripts/fix_details.cjs` 的情况，现已改为全部从环境变量读取；新增脚本时沿用环境变量模式。

### 凭据落盘的红线

系统对凭据的持久化只允许两种形态：

| 数据 | 允许的存储形态 |
|------|--------------|
| 平台用户密码 | bcrypt 哈希（cost 12），**仅此一份** |
| 频道管理员 token | 数据库中的 aes-256-gcm 密文 + CLI 工作目录下的凭据文件（`chmod 0600`） |
| JWT / refresh token | 仅 cookie 与哈希值，refresh token 数据库里只有 SHA-256 |

注册、改密、审批等任何流程都不得把明文密码写入文件、日志或数据库。审批通过后由管理员另行通知使用者初始密码——不要在服务端留副本。

## 修改爬虫前的检查清单

`crawler.ts` 是本项目最敏感的文件——它同时承担数据采集与删除判定，改错会造成数据丢失。动手前确认：

1. **评论拉取的入口是 `commentFeedIds`**（变化帖 + 对账不一致帖），不要退回只用 `changedFeedIds`。只用后者会漏掉「计数已同步但评论实际缺失」的帖子，这些帖子将永久不再补拉。
2. **删除判定只能基于事实 ID 差集**：`detectDeletions` 依据的是本轮真的从接口拉回来的 ID 集合（`refetchedComments` / `refetchedReplies`）。任何基于计数推断的删除逻辑都会误删真实数据。
3. **拉取异常的帖子必须跳过删除检测**（`feedCommentsComplete = false` 分支），否则「没拉到」会被当成「已删除」。
4. **改 `stats` 字段名要同步前端**爬取面板。
5. **改任务锁矩阵要理解饥饿问题**（见 [ARCHITECTURE.md](ARCHITECTURE.md#任务锁矩阵)），deep 与 light 的互斥关系不能随手改成「任何任务互斥」。
6. 单轮数量上限（`LIGHT_MAX_PAGES`、`LIGHT_COMMENTS_MAX`、`DEEP_COMMENTS_MAX`）与 CLI 限流强相关，调大前先确认账号池能承受。

## 目录内的一次性脚本

`scripts/` 下有两类文件：

- 长期保留的运维脚本：`fix_details.cjs`（补帖正文）、`fix-times.ts`（时间校正）
- 下划线前缀的临时探查脚本（`_*.cjs`）：已在 `.gitignore` 中忽略，属于调试产物，可以随时清理

新增一次性脚本时用下划线前缀，避免进入版本控制。

# 频道管理平台（guild-platform）

腾讯频道（QQ 频道）「米游全肯定基地」的社区管理后台。面向频道管理员，把原本靠手工翻帖子完成的内容巡查、违规处置、成员管理工作，做成带增量爬取、批量处置和审计留痕的 Web 系统。

单个频道专用（`GUILD_ID = 82203161765285899`），不做多频道切换。

## 功能模块

| 模块 | 页面 | 能力 |
|------|------|------|
| 仪表盘 | `/` | DAU / WAU / MAU、趋势图、Top 发帖评论榜 |
| 帖子管理 | `/feeds` | 浏览、搜索、筛选、查看评论与回复、标记违规 |
| 评论管理 | `/comments` | 跨帖评论检索、标记违规 |
| 成员管理 | `/members` | 成员列表、详情、历史发言、标签 |
| 违规记录 | `/violations` | 处置记录、多维筛选、Excel 导出 |
| 违规配置 | `/violations/config` | 违规原因与通知模板维护 |
| 爬取管理 | `/crawl` | 任务列表、手动触发、实时进度（SSE）、调度配置 |
| 系统设置 | `/settings` | 平台用户与审批、管理员身份（CLI 凭据）、自动处置规则、操作日志 |

## 技术栈

| 层 | 选型 | 版本 |
|----|------|------|
| 框架 | Next.js（App Router，standalone 输出） | 16.2.9 |
| UI | React + Tailwind CSS + Base UI (`@base-ui/react`) | 19.2.4 / 4.x / 1.6 |
| 语言 | TypeScript | 5.x |
| ORM | Prisma（`prisma-client` generator，输出到 `src/generated/prisma`） | 7.8 |
| 数据库 | PostgreSQL | 18.2 |
| 调度 | node-cron | 4.4 |
| 鉴权 | 自建 JWT（jose）+ bcryptjs | — |
| 图表 | Recharts | 3.8 |
| 数据源 | tencent-channel-cli（外部 CLI，本项目最关键的依赖） | 1.0.7+ |

代码规模：44 个 API 路由、12 个页面、约 17,000 行 TS/TSX（不含生成的 Prisma Client）。

## 本地启动

```bash
npm ci --legacy-peer-deps        # 依赖
npx prisma generate              # 生成 Prisma Client（必需，src/generated 不入库）
npm run check                    # 类型检查
npm run dev                      # 开发服务器
```

`.env` 必填项：

```env
DATABASE_URL="postgresql://<user>:<password>@<host>:5432/guild_platform?schema=public"
JWT_SECRET="<openssl rand -hex 32>"
ENCRYPT_KEY="<openssl rand -hex 32>"   # 用于加密管理员 CLI 凭据
GUILD_ID="82203161765285899"
CLI_PATH="tencent-channel-cli"
```

可选：`CLI_CREDENTIALS_DIR`、`CLI_REQUEST_DELAY_MS`、`CLI_TIMEOUT_MS`、`CRAWL_CRON`、`CRAWL_DEEP_CRON`、`MEMBER_CRON`。

爬取功能额外要求本机装好 `tencent-channel-cli` 并至少有一个已登录的管理员身份，详见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) 的 CLI 集成层。

## 两条必须知道的约束

1. **`npm run check` 是唯一的类型门禁。** `next.config.ts` 里 `typescript.ignoreBuildErrors = true`（构建环境内存受限），类型错误不会让构建失败，只有 `tsc --noEmit` 能拦住。
2. **没有 `prisma/migrations/` 目录。** schema 变更靠 `prisma db push` 或手写 `ALTER TABLE` 落地，数据库没有迁移历史。改 `schema.prisma` 前先确认线上表结构，见 [docs/DATA-MODEL.md](docs/DATA-MODEL.md)。

## 文档索引

| 文档 | 内容 |
|------|------|
| [docs/OVERVIEW.md](docs/OVERVIEW.md) | 项目定位、模块边界、需求来源、当前状态 |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 分层架构、爬虫三阶段、任务锁、CLI 集成、鉴权与加密 |
| [docs/DATA-MODEL.md](docs/DATA-MODEL.md) | 14 个数据模型、字段语义、BigInt 与 Json 处理约定 |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | API 约定、前端规范、命名与提交约定、验证流程 |
| [docs/KNOWN-ISSUES.md](docs/KNOWN-ISSUES.md) | 按优先级排列的缺陷、技术债、易踩的坑 |

需求原始规格见仓库外的 `../PROJECT_PROMPT.md`（构建该平台时的完整需求文档）。

`AGENTS.md` / `CLAUDE.md` 是 Next.js 官方注入的 agent 规则（本项目用的 Next.js 16 与训练数据中的版本有破坏性差异，写代码前应先读 `node_modules/next/dist/docs/`）。

`archive/` 存放早期容器化方案的部署文档与启动入口，与当前运行方式无关，原因见 [archive/README.md](archive/README.md)。

## 仓库之外的目录内容

上层目录 `..` 里还有本项目的历史资料，**不属于代码库**，仅供查证：

| 内容 | 说明 |
|------|------|
| `PROJECT_PROMPT.md` | 需求规格，设计基线 |
| `操作手册.md` / `操作手册V1.0.pdf` | 面向频道管理员的平台使用说明 |
| `82203161765285899_20260528_151950*.json` | 平台上线前用 Python 抓的全量原始数据，可用于校验或重建 |
| `guild_scraper.py` | 平台化之前的 Python 爬虫，其逻辑已被 `src/services/crawler.ts` 取代 |
| 若干 `*.py` / `*.js` 分析脚本、`年度报告-*.html`、`*.xlsx` | 一次性分析产物 |

> 注意：上层目录中的部分探查脚本仍在硬编码数据库连接串，其中的口令已因密钥轮换而失效。这些脚本需要恢复使用时，请改为从环境变量读取连接串。

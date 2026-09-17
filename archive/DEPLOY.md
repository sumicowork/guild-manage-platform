## 频道管理平台 — 云服务器部署指南

### 一、服务器环境要求

| 项目 | 最低要求 | 推荐 |
|------|---------|------|
| 操作系统 | Ubuntu 22.04 LTS / CentOS 8+ | Ubuntu 24.04 LTS |
| CPU | 1 核 | 2 核 |
| 内存 | 2 GB | 4 GB |
| 硬盘 | 20 GB | 40 GB SSD |
| 带宽 | 1 Mbps | 5 Mbps |
| 域名 | 已备案（国内）| 已备案 + SSL 证书 |

---

### 二、服务器软件安装（按顺序执行）

#### 2.1 安装 Node.js 20.x

```bash
# 使用 NodeSource 安装
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# 验证
node -v   # 应显示 v20.x.x
npm -v    # 应显示 10.x.x
```

#### 2.2 安装 PostgreSQL 16

```bash
sudo apt install -y postgresql postgresql-contrib

# 启动并设为开机自启
sudo systemctl enable --now postgresql

# 创建数据库和用户
sudo -u postgres psql <<EOF
CREATE USER guild WITH PASSWORD '你的强密码';
CREATE DATABASE guild_platform OWNER guild;
GRANT ALL PRIVILEGES ON DATABASE guild_platform TO guild;
EOF
```

#### 2.3 安装 PM2（进程管理）

```bash
sudo npm install -g pm2
pm2 startup   # 按提示执行输出的命令，实现开机自启
```

#### 2.4 安装 Nginx（反向代理）

```bash
sudo apt install -y nginx
sudo systemctl enable --now nginx
```

#### 2.5 安装 tencent-channel-cli

```bash
sudo npm install -g tencent-channel-cli
tencent-channel-cli version    # 确认版本 >= 1.0.6
tencent-channel-cli login --json   # 扫码登录管理员账号
```

---

### 三、需要上传的文件

**只需上传以下目录/文件（不需要上传 node_modules 和 .next）：**

```
guild-platform/
├── prisma/
│   └── schema.prisma
├── src/                          # 全部源代码
│   ├── app/
│   ├── components/
│   ├── lib/
│   └── services/
├── scripts/
│   └── (运维脚本)
├── public/                       # 静态资源（如有）
├── .env                          # ⚠️ 需修改后上传
├── .env.local                    # ⚠️ 需修改后上传
├── package.json
├── package-lock.json
├── next.config.ts
├── tsconfig.json
├── postcss.config.mjs
├── components.json
└── eslint.config.mjs
```

**不需要上传的（加入 .gitignore 的）：**
- `node_modules/` — 服务器上 npm install 重新生成
- `.next/` — 服务器上 next build 重新生成
- `src/generated/` — prisma generate 重新生成
- `output/` — JSON 原始数据文件太大，用迁移脚本单独处理

**打包上传命令（在本地执行）：**

```bash
# 方式一：git 推送（推荐）
cd C:\Users\sumi\Guild\guild-platform
git init
git add -A
git commit -m "init: 频道管理平台"
git remote add origin https://你的git仓库地址
git push -u origin main

# 方式二：手动打包
cd C:\Users\sumi\Guild
tar -czf guild-platform.tar.gz --exclude='node_modules' --exclude='.next' --exclude='src/generated' guild-platform/
# 用 scp/sftp 上传到服务器
scp guild-platform.tar.gz root@你的服务器IP:/opt/
```

---

### 四、服务器部署步骤

#### 4.1 在服务器上拉取/解压代码

```bash
# 如果用 git
cd /opt
git clone 你的仓库地址 guild-platform
cd guild-platform

# 如果用手动上传
cd /opt
tar -xzf guild-platform.tar.gz
cd guild-platform
```

#### 4.2 配置环境变量

编辑 `.env` 文件：

```bash
nano .env
```

```env
DATABASE_URL="postgresql://guild:你的强密码@localhost:5432/guild_platform?schema=public"
JWT_SECRET="替换为一个随机字符串_至少32位"
ENCRYPT_KEY="替换为32位随机字符串"
GUILD_ID="82203161765285899"
CLI_PATH="tencent-channel-cli"
```

创建 `.env.local`（Next.js 运行时变量）：

```bash
nano .env.local
```

```env
NEXT_PUBLIC_APP_URL="https://你的域名"
```

> **生成随机密钥：** `openssl rand -hex 32`

#### 4.3 安装依赖 + 构建

```bash
npm ci --production=false
npx prisma generate
npx prisma db push          # 创建数据库表结构
npm run build               # 构建 Next.js 应用
```

#### 4.4 用 PM2 启动应用

```bash
pm2 start npm --name "guild-platform" -- start
pm2 save
pm2 status                  # 确认运行状态
```

应用默认运行在 `http://localhost:3000`。

#### 4.5 配置 Nginx 反向代理

```bash
sudo nano /etc/nginx/sites-available/guild-platform
```

写入：

```nginx
server {
    listen 80;
    server_name 你的域名;

    # HTTP -> HTTPS 重定向（配置 SSL 后启用）
    # return 301 https://$server_name$request_uri;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;

        # 大文件上传（Excel导出等）
        client_max_body_size 10M;
    }
}
```

启用配置：

```bash
sudo ln -s /etc/nginx/sites-available/guild-platform /etc/nginx/sites-enabled/
sudo nginx -t               # 检查配置语法
sudo systemctl reload nginx
```

#### 4.6 配置 SSL（HTTPS）

**方式一：Let's Encrypt 免费证书（推荐）**

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d 你的域名
# 按提示操作，会自动修改 Nginx 配置并设置自动续期
```

**方式二：手动上传证书**

```bash
# 上传证书文件
sudo mkdir -p /etc/nginx/ssl
sudo cp 你的证书.crt /etc/nginx/ssl/
sudo cp 你的私钥.key /etc/nginx/ssl/

# 修改 Nginx 配置，添加：
```

```nginx
server {
    listen 443 ssl;
    server_name 你的域名;

    ssl_certificate /etc/nginx/ssl/你的证书.crt;
    ssl_certificate_key /etc/nginx/ssl/你的私钥.key;
    ssl_protocols TLSv1.2 TLSv1.3;

    location / {
        proxy_pass http://127.0.0.1:3000;
        # ... 同上面的 proxy 配置
    }
}

server {
    listen 80;
    server_name 你的域名;
    return 301 https://$server_name$request_uri;
}
```

#### 4.7 配置防火墙

```bash
# Ubuntu UFW
sudo ufw allow 22/tcp     # SSH
sudo ufw allow 80/tcp     # HTTP
sudo ufw allow 443/tcp    # HTTPS
sudo ufw enable

# 云服务器安全组：还需在云控制台的安全组中放行 80 和 443 端口
```

---

### 五、访问验证

```bash
# 在服务器上检查应用状态
pm2 status
pm2 logs guild-platform --lines 20

# 检查 Nginx 状态
sudo systemctl status nginx

# 测试访问
curl http://localhost:3000/api/auth/session
# 应返回 {"error":"未授权"}
```

浏览器打开 `https://你的域名`，用 `admin` / `admin123` 登录。

---

### 六、日常运维

#### 6.1 更新代码

```bash
cd /opt/guild-platform
git pull                          # 拉取最新代码
npm ci --production=false         # 安装依赖
npx prisma generate               # 更新 Prisma Client
npx prisma db push                # 更新数据库结构（如有变更）
npm run build                     # 重新构建
pm2 restart guild-platform        # 重启应用
```

#### 6.2 查看日志

```bash
pm2 logs guild-platform           # 实时日志
pm2 logs guild-platform --lines 100  # 最近100行
```

#### 6.3 数据库备份

```bash
# 手动备份
pg_dump -U guild guild_platform > backup_$(date +%Y%m%d).sql

# 定时备份（添加 crontab）
crontab -e
# 添加：0 3 * * * pg_dump -U guild guild_platform > /opt/backups/guild_$(date +\%Y\%m\%d).sql
```

#### 6.4 修改默认密码

首次登录后请立即修改默认管理员密码。目前需要通过数据库直接修改：

```bash
sudo -u postgres psql guild_platform -c "
UPDATE platform_users SET password = '\$2a\$12\$新的bcrypt哈希' WHERE username = 'admin';
"
```

> 或者在平台的"系统设置"页面删除默认账号并创建新账号。

---

### 七、文件清单汇总

| 类别 | 需要上传 | 说明 |
|------|---------|------|
| `prisma/` | ✅ | 数据库 schema |
| `src/` | ✅ | 全部源代码 |
| `scripts/` | ✅ | 数据迁移脚本 |
| `package.json` | ✅ | 依赖声明 |
| `package-lock.json` | ✅ | 锁定依赖版本 |
| `next.config.ts` | ✅ | Next.js 配置 |
| `tsconfig.json` | ✅ | TypeScript 配置 |
| `postcss.config.mjs` | ✅ | PostCSS 配置 |
| `components.json` | ✅ | shadcn/ui 配置 |
| `eslint.config.mjs` | ✅ | ESLint 配置 |
| `.env` | ✅（改后上传） | 环境变量 |
| `.env.local` | ✅（改后上传） | Next.js 运行变量 |
| `node_modules/` | ❌ | 服务器 npm ci 生成 |
| `.next/` | ❌ | 服务器 next build 生成 |
| `src/generated/` | ❌ | prisma generate 生成 |
| `output/*.json` | ⚠️ 单独上传 | 迁移用，放服务器 /opt/output/ |
| `PROJECT_PROMPT.md` | ❌ | 需求文档，不需要部署 |
| `DEPLOY.md` | ❌ | 本文档 |

---

### 八、一键启动（内置 start.js）

项目根目录的 `start.js` 是统一入口脚本，会依次执行初始化 + 启动服务：

```bash
node start.js
```

`start.js` 内部流程：

```
start.js
    │
    ├─① 等待 PostgreSQL 就绪（循环检测，最多30次）
    │
    ├─② npx prisma db push（自动创建/更新表结构）
    │
    ├─③ 检查 feeds 表是否有数据
    │     ├─ 无数据 → 查找 JSON 文件 → 执行迁移导入
    │     └─ 有数据 → 跳过导入
    │
    └─④ next start（前台进程）
```

> 如果需要首次导入历史数据，将 JSON 文件放在项目根目录（与 `start.js` 同级），或者设置环境变量 `JSON_DATA_DIR` 指向包含 JSON 文件的目录。

### 九、环境变量清单

| 变量 | 必填 | 说明 | 示例 |
|------|------|------|------|
| `DATABASE_URL` | ✅ | PostgreSQL 连接串 | `postgresql://user:pass@host:5432/db` |
| `JWT_SECRET` | ✅ | JWT 签名密钥（32位随机串） | `openssl rand -hex 32` 生成 |
| `ENCRYPT_KEY` | ✅ | Token 加密密钥（32位） | 32位随机字符 |
| `GUILD_ID` | ❌ | 目标频道 ID | `82203161765285899` |
| `CLI_PATH` | ❌ | tencent-channel-cli 路径 | `tencent-channel-cli` |
| `CLI_CREDENTIALS_DIR` | ❌ | 凭证文件存储目录，默认 `~/.qqcli`；多身份时在 `{dir}/credentials/{id}/` 下 | `~/.qqcli` |
| `JSON_DATA_DIR` | ❌ | JSON 数据目录（首次导入用） | `/data` |
| `PORT` | ❌ | 服务端口（默认 3000） | `3000` |
| `NODE_ENV` | ❌ | 环境模式 | `production` |

> **生成随机密钥：** `openssl rand -hex 32`

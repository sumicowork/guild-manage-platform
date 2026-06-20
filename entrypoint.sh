#!/bin/sh
set -e

echo "================================================"
echo "  频道管理平台 — 容器启动入口"
echo "================================================"

# ─── 1. 等待 PostgreSQL 就绪 ───
if [ -n "$DATABASE_URL" ]; then
    echo "[1/5] 等待 PostgreSQL 就绪..."
    # 从 DATABASE_URL 提取主机和端口
    DB_HOST=$(echo "$DATABASE_URL" | sed -n 's/.*@\([^:]*\).*/\1/p')
    DB_PORT=$(echo "$DATABASE_URL" | sed -n 's/.*:\([0-9]*\)\/.*/\1/p')
    DB_PORT=${DB_PORT:-5432}
    DB_HOST=${DB_HOST:-localhost}

    for i in $(seq 1 30); do
        if curl -s "http://$DB_HOST:$DB_PORT" >/dev/null 2>&1 || \
           nc -z "$DB_HOST" "$DB_PORT" 2>/dev/null; then
            echo "  ✓ PostgreSQL 已就绪"
            break
        fi
        if [ "$i" -eq 30 ]; then
            echo "  ⚠ PostgreSQL 未就绪，继续尝试…"
        else
            echo "  ⏳ 等待 PostgreSQL... ($i/30)"
            sleep 2
        fi
    done
fi

# ─── 2. 更新数据库结构 ───
echo "[2/5] 执行数据库迁移（db push）..."
npx prisma db push --accept-data-loss 2>&1 | grep -v "already exists" || true
echo "  ✓ 数据库结构已更新"

# ─── 3. 检查是否需要导入初始数据 ───
echo "[3/5] 检查数据状态..."
DATA_COUNT=$(node -e "
const { PrismaClient } = require('./src/generated/prisma/client');
const p = new PrismaClient();
p.feed.count().then(c => { console.log(c); p.\$disconnect(); });
" 2>/dev/null || echo "0")

if [ "$DATA_COUNT" = "0" ] || [ "$DATA_COUNT" = "0n" ]; then
    echo "  → 数据库为空"

    # 检查 JSON 数据文件是否存在
    JSON_DIR="${JSON_DATA_DIR:-/data}"
    MAIN_JSON="$JSON_DIR/82203161765285899_20260528_151950.json"

    if [ -f "$MAIN_JSON" ]; then
        echo "[4/5] 从 JSON 导入历史数据..."
        # 将 JSON_DATA_DIR 中的所有 .json 文件链接到 output/ 目录
        # 会自动匹配伴生文件: *_comments.json, *_detail.json
        mkdir -p /app/output
        for f in "$JSON_DIR"/*.json; do
            [ -f "$f" ] && ln -sf "$f" /app/output/
        done
        echo "  文件来源: $JSON_DIR"
        echo "  文件列表:"
        ls -la /app/output/*.json 2>/dev/null | sed 's/^/    /'
        node --loader ts-node/esm scripts/migrate-data.ts 2>&1 || \
        npx tsx scripts/migrate-data.ts 2>&1 || \
        echo "  ⚠ 数据迁移失败（可忽略，后续手动导入）"
        echo "  ✓ 历史数据导入完成"
    else
        echo "[4/5] 跳过数据导入（未找到 JSON 文件）"
        echo "  💡 将 JSON 文件挂载到 $JSON_DIR 目录后可自动导入"
    fi
else
    echo "  → 数据库已有 $DATA_COUNT 条帖子，跳过导入"
fi

# ─── 5. 启动 Next.js 服务（前台进程） ───
echo "================================================"
echo "  启动服务：端口 3000"
echo "================================================"

# 这条命令会保持前台运行，容器不会退出
exec npm start

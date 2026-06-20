#!/bin/sh
set -e

echo "================================================"
echo "  频道管理平台 — 容器启动入口"
echo "================================================"

# ─── 1. 等待 PostgreSQL 就绪 ───
if [ -n "$DATABASE_URL" ]; then
    echo "[1/2] 等待 PostgreSQL 就绪..."
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

# ─── 2. 委托给 start.js 处理剩余所有步骤 ───
# start.js 会: db push → 数据导入检查 → 重建 .next/ → next start
echo "[2/2] 启动 start.js（db push + 构建 + 服务启动）..."
echo "================================================"

exec node /start.js

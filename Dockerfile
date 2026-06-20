# ========= 多阶段构建 =========

# ---- 阶段1：安装依赖 + 构建 ----
FROM node:20-alpine AS builder

WORKDIR /app

# 安装构建所需工具
RUN apk add --no-cache openssl

# 先装依赖（利用缓存）
COPY package.json package-lock.json ./
RUN npm ci --production=false

# 复制源码
COPY src/ src/
COPY prisma/ prisma/
COPY scripts/ scripts/
COPY tsconfig.json next.config.ts postcss.config.mjs components.json eslint.config.mjs ./
COPY public/ public/

# 生成 Prisma Client + 构建
RUN npx prisma generate
RUN npm run build

# ---- 阶段2：运行环境 ----
FROM node:20-alpine AS runner

WORKDIR /app

RUN apk add --no-cache openssl curl

# 创建非 root 用户
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# 从 builder 复制产物
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/src ./src
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/postcss.config.mjs ./postcss.config.mjs
COPY --from=builder /app/components.json ./components.json
COPY --from=builder /app/eslint.config.mjs ./eslint.config.mjs
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/tsconfig.json ./tsconfig.json

# 复制启动脚本（start.js 会在每次启动时重建前端）
COPY start.js entrypoint.sh /
COPY output/ output/
RUN chmod +x /entrypoint.sh && chown -R nextjs:nodejs /app

USER nextjs

EXPOSE 3000

ENV NODE_ENV=production

ENTRYPOINT ["/bin/sh", "/entrypoint.sh"]

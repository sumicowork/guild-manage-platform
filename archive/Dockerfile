# ── Stage 1: Build (本机执行，内存充足) ──
FROM node:22-alpine AS builder
WORKDIR /app
RUN apk add --no-cache openssl

COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps

COPY prisma ./prisma
COPY tsconfig.json next.config.ts postcss.config.mjs eslint.config.mjs components.json ./
RUN npx prisma generate

COPY src ./src
COPY public ./public
RUN NODE_OPTIONS='--max-old-space-size=2048' npm run build

# ── Stage 2: Runtime (轻量，只跑服务) ──
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN apk add --no-cache openssl

COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/next.config.ts ./
COPY --from=builder /app/tsconfig.json ./
COPY --from=builder /app/public ./public

EXPOSE 3000
CMD ["node", "node_modules/.bin/next", "start", "-p", "3000"]
